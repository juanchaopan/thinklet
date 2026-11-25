import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ChildLinkLoginRequest,
  ChildLoginLinkInfo,
  ChildLoginRequest,
  ChildLoginResponse,
  RememberedChild,
  SetChildPasswordRequest,
} from '@thinklet/contracts';
import type { Executor } from '../../infrastructure/database/database.module.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { AuditService, byChild } from '../audit/audit.service.js';
import { FamiliesService } from '../family/families.service.js';
import {
  ChildLoginRepository,
  type ChildLoginStore,
  type LoginCandidate,
} from './child-login.repository.js';
import { ChildPasswords, type LoginSubject } from './child-passwords.js';
import { rememberedUntil } from './device-cookie.js';
import { deviceNameOf } from './device-name.js';
import type { ActiveLoginLink } from './login-links.js';
import { hashToken, newToken } from './tokens.js';

const loginFailed = () => new ApiError('login_failed', HttpStatus.UNAUTHORIZED);
const wrongPassword = () => new ApiError('wrong_password', HttpStatus.UNAUTHORIZED);
const passwordAlreadySet = () => new ApiError('password_already_set', HttpStatus.CONFLICT);
const passwordNotSet = () => new ApiError('password_not_set', HttpStatus.CONFLICT);

/** A remembered login that no longer works, whatever the reason: revoked, expired or never there. */
export const rememberInvalid = () => new ApiError('remember_invalid', HttpStatus.UNAUTHORIZED);

/** A login link that cannot be used, whatever the reason, so the answer reveals nothing. */
export const linkInvalid = () => new ApiError('link_invalid', HttpStatus.NOT_FOUND);

/** What a login needs of the browser it happens on. */
export interface Browser {
  /** The browser's device token from its cookie, or undefined when it has none. */
  deviceToken: string | undefined;
  /** The browser's User-Agent, which only the device name is taken from. */
  userAgent: string | undefined;
  /**
   * The client's IP address as the proxy in front of the api wrote it, the
   * source the rate limits count failed logins by; undefined without one.
   */
  clientIp: string | undefined;
}

/** A child's login that succeeded, for the controller to sign the child in with. */
export interface CompletedLogin {
  child: ChildLoginResponse;
  /** The device token to set in the browser's cookie, renewing it; undefined leaves the cookie as it is. */
  deviceToken: string | undefined;
  /**
   * The issue time of the child's session, taken under the child's lock
   * with the login's checks and writes; a password reset after the login
   * is later than it, and so ends the session.
   */
  issuedAt: Date;
}

/** A login link that could be used when read, before any lock, with its child as it was then. */
interface FoundLink {
  link: ActiveLoginLink;
  child: LoginCandidate;
}

/** The locked child of a login, with the store and the transaction the login's writes are made in. */
interface LockedLogin {
  store: ChildLoginStore;
  child: LoginCandidate;
  transaction: Executor;
}

/**
 * The part of a login done under the child's lock: it refuses a login the
 * child's current row no longer allows, makes the login's writes and
 * returns the device token for the browser's cookie.
 */
type LockedStep = (login: LockedLogin) => Promise<string | undefined>;

/** What a login on a link checks, and changes, of the link's locked child before the link is used. */
type LinkStep = (login: LockedLogin) => Promise<void> | void;

/**
 * A child's logins (`.docs/design/interfaces.md`, "孩子登录"): with the
 * family code, the account and the password, by a remembered avatar, and
 * by a login link, where a child without a password sets one. Every
 * successful login leaves the browser remembering the child or not, as the
 * child chose. Signing the child in is the controller's: it sets the
 * cookies of the completed login. A login itself is not an audit event;
 * the password a child sets is, by the child, in the login's transaction.
 *
 * The logins that check a password, with the account and on a link, are
 * made within ChildPasswords' limits: once it is known whom the login is
 * for, a source at its limit is refused before the password is verified,
 * and a wrong one counts against the source.
 *
 * Each login ends in one transaction that locks the child's row and then
 * re-checks what was checked before it, writes the browser's row and takes
 * the session's issue time. A password reset locks the same row first, so
 * it runs wholly before the login, which the re-check then refuses, or
 * wholly after it, when it forgets the browser and ends the session. The
 * slow work of a password, hashing or verifying it, is done before the
 * transaction, so no lock is held during it: the re-check compares the
 * child's password hash with the one verified.
 *
 * The login links are in Redis; while Redis cannot be reached, a link can
 * be neither read nor used, and the other logins go on.
 */
@Injectable()
export class ChildLoginService {
  constructor(
    private readonly repository: ChildLoginRepository,
    private readonly families: FamiliesService,
    private readonly passwords: ChildPasswords,
    private readonly audit: AuditService,
  ) {}

  /**
   * Logs the child in with the family code, the account and the password.
   * A wrong code, account or password, and a child without a password yet,
   * are all 401 `login_failed`. The password is checked every time, against
   * a stand-in hash when there is no child or no password, so the time
   * taken does not tell which was wrong either. The login counts against
   * the child found, or against the code and account typed when they match
   * no child.
   */
  async login(request: ChildLoginRequest, browser: Browser): Promise<CompletedLogin> {
    const familyId = await this.families.findIdByCode(request.code);
    const candidate =
      familyId === undefined
        ? undefined
        : await this.repository.findLoginCandidate(familyId, request.account);
    const subject: LoginSubject =
      candidate === undefined
        ? { code: request.code, account: request.account }
        : { childId: candidate.id };
    return this.passwords.attempt(browser.clientIp, subject, async () => {
      const passwordHash = candidate?.passwordHash ?? null;
      const matches = await this.passwords.verify(request.password, passwordHash);
      if (candidate === undefined || passwordHash === null || !matches) {
        throw loginFailed();
      }
      return this.locked(candidate.id, loginFailed, ({ store, child }) => {
        if (child.passwordHash !== passwordHash) {
          throw loginFailed();
        }
        return this.applyRemember(store, child.id, request.remember, browser);
      });
    });
  }

  /**
   * The children the browser still remembers, with their families' current
   * codes and their accounts to fill in the form should a remembered login
   * fail; none without a device token.
   */
  async remembered(deviceToken: string | undefined): Promise<RememberedChild[]> {
    if (deviceToken === undefined) {
      return [];
    }
    const records = await this.repository.listRemembered(hashToken(deviceToken), new Date());
    const familyIds = [...new Set(records.map((record) => record.familyId))];
    const codes = await this.families.codesOf(familyIds);
    return records.flatMap(({ childId, familyId, nickname, account }) => {
      const familyCode = codes.get(familyId);
      return familyCode === undefined ? [] : [{ childId, nickname, familyCode, account }];
    });
  }

  /**
   * Logs in a child the browser remembers, without a password, and renews
   * the browser's remembering for 30 days. A browser that does not remember
   * the child (revoked, expired, another child's, no device token) is 401
   * `remember_invalid`.
   */
  async loginRemembered(childId: string, deviceToken: string | undefined): Promise<CompletedLogin> {
    if (deviceToken === undefined) {
      throw rememberInvalid();
    }
    return this.locked(childId, rememberInvalid, async ({ store, child }) => {
      const now = new Date();
      const renewed = await store.renewDevice(
        child.id,
        hashToken(deviceToken),
        now,
        rememberedUntil(now),
      );
      if (!renewed) {
        throw rememberInvalid();
      }
      return deviceToken;
    });
  }

  /** Whose login link it is and whether the child still has to set a password; reading it does not use it. */
  async linkInfo(token: string): Promise<ChildLoginLinkInfo> {
    const { child } = await this.findActiveLink(token);
    return {
      childId: child.id,
      nickname: child.nickname,
      needsPassword: child.passwordHash === null,
    };
  }

  /**
   * Sets the first password of the link's child, uses the link and logs
   * the child in; the password is recorded as `child.password_set` by the
   * child. A child who has a password by then is 409 `password_already_set`.
   */
  async setPasswordWithLink(
    token: string,
    request: SetChildPasswordRequest,
    browser: Browser,
  ): Promise<CompletedLogin> {
    const found = await this.findActiveLink(token);
    if (found.child.passwordHash !== null) {
      throw passwordAlreadySet();
    }
    const passwordHash = await this.passwords.hash(request.password);
    return this.loginOnLink(
      found.link,
      request.remember,
      browser,
      async ({ store, child, transaction }) => {
        if (child.passwordHash !== null) {
          throw passwordAlreadySet();
        }
        await store.setPassword(child.id, passwordHash);
        await this.audit.record(transaction, {
          actor: byChild(child.id),
          action: 'child.password_set',
          targetId: child.id,
          familyId: child.familyId,
          details: { via: 'qr' },
        });
      },
    );
  }

  /**
   * Logs the link's child in with the password the child has, using the
   * link. A wrong password is 401 `wrong_password` and leaves the link as
   * it was; a child without a password is 409 `password_not_set`. A
   * password changed while it was verified is wrong as well. The login
   * counts against the link's child.
   */
  async loginWithLink(
    token: string,
    request: ChildLinkLoginRequest,
    browser: Browser,
  ): Promise<CompletedLogin> {
    const { link, child } = await this.findActiveLink(token);
    const verified = child.passwordHash;
    if (verified === null) {
      throw passwordNotSet();
    }
    return this.passwords.attempt(browser.clientIp, { childId: child.id }, async () => {
      if (!(await this.passwords.verify(request.password, verified))) {
        throw wrongPassword();
      }
      return this.loginOnLink(link, request.remember, browser, ({ child: locked }) => {
        if (locked.passwordHash === null) {
          throw passwordNotSet();
        }
        if (locked.passwordHash !== verified) {
          throw wrongPassword();
        }
      });
    });
  }

  /**
   * The login link of the token, with its child read without a lock, when
   * the link can be used now and its child is still there; else 404
   * `link_invalid`.
   */
  private async findActiveLink(token: string): Promise<FoundLink> {
    const link = await this.repository.findLink(hashToken(token));
    const child =
      link === undefined ? undefined : await this.repository.findCandidate(link.childId);
    if (link === undefined || child === undefined) {
      throw linkInvalid();
    }
    return { link, child };
  }

  /**
   * Logs the child of a link found before the transaction in. Under the
   * child's lock the link is read again, so a link used meanwhile is
   * `link_invalid` before anything else; the step checks the child and may
   * set its password, the browser is remembered or forgotten, and then the
   * link is used, in one Redis script, as the last step of the transaction.
   * Of two logins on one link at once only the first uses it: the other
   * finds it used, and should both come to use it, Redis lets one only,
   * and the other's writes are rolled back. A step that refuses leaves the
   * link as it was.
   */
  private loginOnLink(
    link: ActiveLoginLink,
    remember: boolean,
    browser: Browser,
    step: LinkStep,
  ): Promise<CompletedLogin> {
    return this.locked(link.childId, linkInvalid, async (login) => {
      if ((await this.repository.findLink(link.tokenHash)) === undefined) {
        throw linkInvalid();
      }
      await step(login);
      const deviceToken = await this.applyRemember(login.store, login.child.id, remember, browser);
      if (!(await this.repository.takeLink(link))) {
        throw linkInvalid();
      }
      return deviceToken;
    });
  }

  /**
   * Completes a login of the child in one transaction holding the child's
   * lock: the step runs on the locked child, and the session's issue time
   * is taken after it. A child gone by then is refused with `gone`.
   */
  private locked(childId: string, gone: () => ApiError, step: LockedStep): Promise<CompletedLogin> {
    return this.repository.transaction(async (store, transaction) => {
      const child = await store.lockChild(childId);
      if (child === undefined) {
        throw gone();
      }
      const deviceToken = await step({ store, child, transaction });
      return {
        child: { id: child.id, nickname: child.nickname },
        deviceToken,
        issuedAt: new Date(),
      };
    });
  }

  /**
   * Remembers the child on the browser for 30 days from now, making the
   * browser a device token when it has none, and returns the token for the
   * cookie. When the child is not to be remembered, it forgets the child on
   * this browser and leaves the cookie, which other children may share.
   */
  private async applyRemember(
    store: ChildLoginStore,
    childId: string,
    remember: boolean,
    browser: Browser,
  ): Promise<string | undefined> {
    if (!remember) {
      if (browser.deviceToken !== undefined) {
        await store.forgetDevice(childId, hashToken(browser.deviceToken));
      }
      return undefined;
    }
    const { token, hash } =
      browser.deviceToken === undefined
        ? newToken()
        : { token: browser.deviceToken, hash: hashToken(browser.deviceToken) };
    const now = new Date();
    await store.rememberDevice({
      childId,
      tokenHash: hash,
      name: deviceNameOf(browser.userAgent),
      now,
      expiresAt: rememberedUntil(now),
    });
    return token;
  }
}

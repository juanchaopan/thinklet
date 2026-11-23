import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ChildLinkLoginRequest,
  ChildLoginLinkInfo,
  ChildLoginRequest,
  ChildLoginResponse,
  RememberedChild,
  SetChildPasswordRequest,
} from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { PasswordHasher } from '../../infrastructure/passwords/password-hasher.js';
import { FamiliesService } from '../family/families.service.js';
import {
  ChildLoginRepository,
  type ChildLoginStore,
  type LinkRecord,
} from './child-login.repository.js';
import { loginLinkStatus } from './children.service.js';
import { rememberedUntil } from './device-cookie.js';
import { deviceNameOf } from './device-name.js';
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
}

/** A child's login that succeeded, for the controller to sign the child in with. */
export interface CompletedLogin {
  child: ChildLoginResponse;
  /** The device token to set in the browser's cookie, renewing it; undefined leaves the cookie as it is. */
  deviceToken: string | undefined;
}

/** What a login on a link checks, and changes, of the link's child before the link is used. */
type LinkStep = (store: ChildLoginStore, link: LinkRecord) => Promise<void>;

/** The link, when it can be used at `now`; else 404 `link_invalid`. */
function requireActive(link: LinkRecord | undefined, now: Date): LinkRecord {
  if (link === undefined || loginLinkStatus(link, now) !== 'active') {
    throw linkInvalid();
  }
  return link;
}

/**
 * A child's logins (`.docs/design/interfaces.md`, "孩子登录"): with the
 * family code, the account and the password, by a remembered avatar, and
 * by a login link, where a child without a password sets one. Every
 * successful login leaves the browser remembering the child or not, as the
 * child chose. Signing the child in is the controller's: it sets the
 * cookies of the completed login.
 */
@Injectable()
export class ChildLoginService {
  /** A hash of a random password, made once and checked when there is no hash to check. */
  private standIn: Promise<string> | undefined;

  constructor(
    private readonly repository: ChildLoginRepository,
    private readonly families: FamiliesService,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Logs the child in with the family code, the account and the password.
   * A wrong code, account or password, and a child without a password yet,
   * are all 401 `login_failed`. A password is checked against a hash every
   * time, a stand-in one with the same cost when there is no child or no
   * password, so the time taken does not tell which was wrong either.
   */
  async login(request: ChildLoginRequest, browser: Browser): Promise<CompletedLogin> {
    const familyId = await this.families.findIdByCode(request.code);
    const candidate =
      familyId === undefined
        ? undefined
        : await this.repository.findLoginCandidate(familyId, request.account);
    const passwordHash = candidate?.passwordHash ?? null;
    const matches = await this.hasher.verify(
      request.password,
      passwordHash ?? (await this.standInHash()),
    );
    if (candidate === undefined || passwordHash === null || !matches) {
      throw loginFailed();
    }
    const child = { id: candidate.id, nickname: candidate.nickname };
    return this.complete(child, request.remember, browser);
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
    const now = new Date();
    const renewed = await this.repository.renewDevice(
      childId,
      hashToken(deviceToken),
      now,
      rememberedUntil(now),
    );
    const nickname = renewed ? await this.repository.findNickname(childId) : undefined;
    if (nickname === undefined) {
      throw rememberInvalid();
    }
    return { child: { id: childId, nickname }, deviceToken };
  }

  /** Whose login link it is and whether the child still has to set a password; reading it does not use it. */
  async linkInfo(token: string): Promise<ChildLoginLinkInfo> {
    const link = requireActive(await this.repository.findLinkByToken(hashToken(token)), new Date());
    return {
      childId: link.childId,
      nickname: link.nickname,
      needsPassword: link.passwordHash === null,
    };
  }

  /**
   * Sets the first password of the link's child, uses the link and logs
   * the child in. A child who has a password by then is 409
   * `password_already_set`.
   */
  setPasswordWithLink(
    token: string,
    request: SetChildPasswordRequest,
    browser: Browser,
  ): Promise<CompletedLogin> {
    return this.loginOnLink(token, request.remember, browser, async (store, link) => {
      if (link.passwordHash !== null) {
        throw passwordAlreadySet();
      }
      await store.setPassword(link.childId, await this.hasher.hash(request.password));
    });
  }

  /**
   * Logs the link's child in with the password the child has, using the
   * link. A wrong password is 401 `wrong_password` and leaves the link as
   * it was; a child without a password is 409 `password_not_set`.
   */
  loginWithLink(
    token: string,
    request: ChildLinkLoginRequest,
    browser: Browser,
  ): Promise<CompletedLogin> {
    return this.loginOnLink(token, request.remember, browser, async (_store, link) => {
      if (link.passwordHash === null) {
        throw passwordNotSet();
      }
      if (!(await this.hasher.verify(request.password, link.passwordHash))) {
        throw wrongPassword();
      }
    });
  }

  /**
   * Logs the child of an active link in: the step checks the child and may
   * set its password, then the link is used. The link and the child are
   * locked for all of it, so of two logins on one link at once only the
   * first uses it and the other finds it used, and a password reset of the
   * child waits or is waited for. A step that refuses leaves the link as it
   * was.
   */
  private async loginOnLink(
    token: string,
    remember: boolean,
    browser: Browser,
    step: LinkStep,
  ): Promise<CompletedLogin> {
    const child = await this.repository.transaction(async (store) => {
      const link = requireActive(await store.lockLinkByToken(hashToken(token)), new Date());
      await step(store, link);
      await store.markLinkUsed(link.linkId, new Date());
      return { id: link.childId, nickname: link.nickname };
    });
    return this.complete(child, remember, browser);
  }

  /** The logged-in child, with the browser remembering the child or not, as chosen. */
  private async complete(
    child: ChildLoginResponse,
    remember: boolean,
    browser: Browser,
  ): Promise<CompletedLogin> {
    return { child, deviceToken: await this.applyRemember(child.id, remember, browser) };
  }

  /**
   * Remembers the child on the browser for 30 days from now, making the
   * browser a device token when it has none, and returns the token for the
   * cookie. When the child is not to be remembered, it forgets the child on
   * this browser and leaves the cookie, which other children may share.
   */
  private async applyRemember(
    childId: string,
    remember: boolean,
    browser: Browser,
  ): Promise<string | undefined> {
    if (!remember) {
      if (browser.deviceToken !== undefined) {
        await this.repository.forgetDevice(childId, hashToken(browser.deviceToken));
      }
      return undefined;
    }
    const { token, hash } =
      browser.deviceToken === undefined
        ? newToken()
        : { token: browser.deviceToken, hash: hashToken(browser.deviceToken) };
    const now = new Date();
    await this.repository.rememberDevice({
      childId,
      tokenHash: hash,
      name: deviceNameOf(browser.userAgent),
      now,
      expiresAt: rememberedUntil(now),
    });
    return token;
  }

  /** The stand-in hash, made on first use with the cost of every new hash. */
  private standInHash(): Promise<string> {
    this.standIn ??= this.hasher.hash(newToken().token);
    return this.standIn;
  }
}

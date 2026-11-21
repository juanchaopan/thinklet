import { HttpStatus, Injectable } from '@nestjs/common';
import {
  NAME_MAX_LENGTH,
  truncateCharacters,
  type MeFamily,
  type MeResponse,
} from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { FamilyRepository, type MembershipRecord } from './family.repository.js';

/** The version of the user agreement and privacy policy a login agrees to (`.docs/design/rules.md`, "协议同意"). */
export const CONSENT_VERSION = '2026-11-21';

/** The name of a parent whose identity provider gave neither a name nor an email. */
export const FALLBACK_PARENT_NAME = '家长';

/** The claims of an ID token; the parent's account is built from `name` and `email`. */
export type LoginClaims = Readonly<Record<string, unknown>>;

/** A claim's text with the surrounding spaces removed, or undefined when it has none. */
function textOf(claim: unknown): string | undefined {
  if (typeof claim !== 'string') {
    return undefined;
  }
  const text = claim.trim();
  return text === '' ? undefined : text;
}

/** The email of the login, or null when the identity provider gave none. */
export function emailOf(claims: LoginClaims): string | null {
  return textOf(claims['email']) ?? null;
}

/** The part of an email before its `@`; the whole value when it has none. */
function localPart(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

/**
 * The name a new parent starts with: the ID token's name, else the part of
 * the email before the `@`, cut to 20 characters (`.docs/design/rules.md`,
 * "家长账号"). With neither, a generic name the parent can change.
 */
export function initialName(claims: LoginClaims): string {
  const email = emailOf(claims);
  const source = textOf(claims['name']) ?? (email === null ? undefined : textOf(localPart(email)));
  const name = source === undefined ? '' : truncateCharacters(source, NAME_MAX_LENGTH).trim();
  return name === '' ? FALLBACK_PARENT_NAME : name;
}

/** A family as the parent's own list shows it; only its admin sees the pending requests. */
function toMeFamily({ pendingRequests, ...family }: MembershipRecord): MeFamily {
  return family.role === 'admin' ? { ...family, pendingRequests } : family;
}

const unauthenticated = () => new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);

/** The parents' accounts. */
@Injectable()
export class FamilyService {
  constructor(private readonly repository: FamilyRepository) {}

  /**
   * Records a login from the identity provider and returns the parent's id.
   * The first login creates the parent with their initial name; every login
   * updates the email and records the agreement's version and time.
   */
  recordLogin(issuer: string, subject: string, claims: LoginClaims): Promise<string> {
    return this.repository.upsertParentLogin({
      issuer,
      subject,
      name: initialName(claims),
      email: emailOf(claims),
      consentVersion: CONSENT_VERSION,
      consentedAt: new Date(),
    });
  }

  /** The signed-in parent with their families. A parent that no longer exists is not signed in. */
  async getMe(parentId: string): Promise<MeResponse> {
    const [parent, memberships] = await Promise.all([
      this.repository.findParent(parentId),
      this.repository.listMemberships(parentId),
    ]);
    if (parent === undefined) {
      throw unauthenticated();
    }
    return { ...parent, families: memberships.map(toMeFamily) };
  }

  /** Changes the parent's own name, already trimmed and checked, and returns them as `getMe` does. */
  async updateName(parentId: string, name: string): Promise<MeResponse> {
    if (!(await this.repository.updateParentName(parentId, name))) {
      throw unauthenticated();
    }
    return this.getMe(parentId);
  }
}

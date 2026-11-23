import { childLoginLinkSchema, type Child } from '@thinklet/contracts';
import request from 'supertest';
import { addChild, childPath } from './children.js';
import { TEST_APP_ORIGIN } from './containers.js';
import { as, type Parent } from './families.js';
import { cookieHeader, setCookiesOf, type Target } from './login.js';

// Helpers for tests of a child's login: a browser that keeps the cookies
// the api sets, login links made by a parent through the api, and children
// with a password set through a link, as a child sets it.

/** The User-Agent of Safari on an iPad, the device a child most often logs in on. */
export const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** The child's session cookie and the device cookie. */
export const CHILD_SESSION_COOKIE = 'thinklet_child_session';
export const DEVICE_COOKIE = 'thinklet_device';

/** The body of a login with the family code, the account and the password. */
export interface ChildLoginBody {
  code: string;
  account: string;
  password: string;
  remember: boolean;
}

/**
 * A browser for the child routes. It keeps the cookies the api sets and
 * drops those it clears, the way a browser does; supertest's own agent
 * would not send Secure cookies over plain HTTP. Every request carries this
 * site's Origin and the browser's User-Agent.
 */
export class ChildBrowser {
  /** The browser's cookies by name; a test may change them as a user could. */
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly target: Target,
    private readonly userAgent = IPAD_SAFARI,
  ) {}

  async get(path: string): Promise<request.Response> {
    return this.keep(await this.sent(request(this.target).get(path)));
  }

  async post(path: string, body?: object): Promise<request.Response> {
    return this.keep(await this.sent(request(this.target).post(path)).send(body));
  }

  /** Logs in with the family code, the account and the password. */
  login(body: ChildLoginBody): Promise<request.Response> {
    return this.post('/api/child-auth/login', body);
  }

  /** Clicks the avatar of a remembered child. */
  loginRemembered(childId: string): Promise<request.Response> {
    return this.post(`/api/child-auth/remembered/${childId}/login`);
  }

  /** The signed-in child, as the child's pages read it. */
  me(): Promise<request.Response> {
    return this.get('/api/child/me');
  }

  /** Takes on the parent's login cookies, as a browser a parent is signed in on. */
  signInParent(parent: Parent): void {
    for (const [name, value] of Object.entries(parent.cookies)) {
      this.cookies.set(name, value);
    }
  }

  private sent(call: request.Test): request.Test {
    const sent = call.set('Origin', TEST_APP_ORIGIN).set('User-Agent', this.userAgent);
    return this.cookies.size === 0
      ? sent
      : sent.set('Cookie', cookieHeader(Object.fromEntries(this.cookies)));
  }

  private keep(response: request.Response): request.Response {
    for (const [name, cookie] of Object.entries(setCookiesOf(response))) {
      if (cookie.value === '') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, cookie.value);
      }
    }
    return response;
  }
}

/** A login link a parent made for the child through the api: its id and its token. */
export interface NewLoginLink {
  id: string;
  token: string;
}

/** Makes a login link of the child as the parent through the api. */
export async function newLoginLink(
  target: Target,
  parent: Parent,
  familyId: string,
  childId: string,
): Promise<NewLoginLink> {
  const response = await as(target, parent).post(`${childPath(familyId, childId)}/login-links`);
  if (response.status !== 201) {
    throw new Error(`No login link was made: ${response.status}`);
  }
  const { id, url } = childLoginLinkSchema.parse(response.body);
  return { id, token: url.slice(url.lastIndexOf('/') + 1) };
}

/** The address of a login link's routes. */
export const linkPath = (token: string) => `/api/child-login-links/${token}`;

/** A child who has set a password, with the password to log in with. */
export interface ChildWithPassword extends Child {
  password: string;
}

/**
 * Adds a child and sets its password through a login link from a browser
 * of its own, as the child does on first scanning a QR code. That browser
 * is thrown away, so no browser of the test is signed in as the child or
 * remembers it.
 */
export async function addChildWithPassword(
  target: Target,
  parent: Parent,
  familyId: string,
  child: { nickname?: string; account?: string } = {},
): Promise<ChildWithPassword> {
  const added = await addChild(target, parent, familyId, child);
  const { token } = await newLoginLink(target, parent, familyId, added.id);
  const password = `pw ${crypto.randomUUID().slice(0, 8)}`;
  const response = await new ChildBrowser(target).post(`${linkPath(token)}/password`, {
    password,
    remember: false,
  });
  if (response.status !== 200) {
    throw new Error(`The password was not set: ${response.status}`);
  }
  return { ...added, password };
}

import { Controller, Get, Header, HttpCode, Post, Query, Redirect, Req, Res } from '@nestjs/common';
import { logoutResponseSchema, type LogoutResponse } from '@thinklet/contracts';
import type { Request, Response } from 'express';
import { readCookie } from '../../infrastructure/authentication/cookies.js';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { AuthService, LOGIN_FAILED_PATH } from './auth.service.js';
import {
  clearLoginTransactionCookie,
  clearParentSessionCookies,
  ID_TOKEN_COOKIE,
  LOGIN_TRANSACTION_COOKIE,
  setLoginTransactionCookie,
  setParentSessionCookies,
} from './session-cookies.js';

/** The redirect a handler answers with. */
interface RedirectTo {
  url: string;
}

/** The query string of a request, with its leading `?`, or an empty string. */
function queryOf(request: Request): string {
  const start = request.originalUrl.indexOf('?');
  return start === -1 ? '' : request.originalUrl.slice(start);
}

/**
 * The parent's login routes (`.docs/design/interfaces.md`, "登录"). They
 * need no login. Login and callback answer with full-page redirects; a
 * login that does not succeed returns to the home page with
 * `?login=failed`.
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  async login(
    @Query('returnTo') returnTo: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RedirectTo> {
    const started = await this.authService.startLogin(returnTo);
    if (!started.ok) {
      return { url: LOGIN_FAILED_PATH };
    }
    setLoginTransactionCookie(response, started.loginTransactionToken);
    return { url: started.authorizationUrl };
  }

  @Get('callback')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  async callback(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RedirectTo> {
    const completed = await this.authService.completeLogin(
      readCookie(request, LOGIN_TRANSACTION_COOKIE),
      queryOf(request),
    );
    clearLoginTransactionCookie(response);
    if (!completed.ok) {
      return { url: LOGIN_FAILED_PATH };
    }
    setParentSessionCookies(response, completed.sessionToken, completed.idToken);
    return { url: completed.returnTo };
  }

  /**
   * Builds the identity provider's logout address first and clears the
   * parent's login cookies only once it is built; a child signed in on the
   * same browser stays signed in. When the address cannot be built (the
   * provider's discovery fails or times out), the request fails with the
   * login untouched, so the page that stays signed in tells the truth and
   * the parent can try again.
   */
  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutResponse> {
    const body = logoutResponseSchema.parse({
      endSessionUrl: await this.authService.endSessionUrl(readCookie(request, ID_TOKEN_COOKIE)),
    });
    clearParentSessionCookies(response);
    return body;
  }
}

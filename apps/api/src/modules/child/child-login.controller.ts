import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  childLinkLoginRequestSchema,
  childLoginLinkInfoSchema,
  childLoginRequestSchema,
  childLoginResponseSchema,
  rememberedChildListSchema,
  setChildPasswordRequestSchema,
  type ChildLinkLoginRequest,
  type ChildLoginLinkInfo,
  type ChildLoginRequest,
  type ChildLoginResponse,
  type RememberedChild,
  type SetChildPasswordRequest,
} from '@thinklet/contracts';
import type { Request, Response } from 'express';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { ChildSessionService } from '../auth/child-session.service.js';
import { ChildLoginService, type Browser, type CompletedLogin } from './child-login.service.js';
import { linkTokenPipe, rememberedChildIdPipe } from './children-params.js';
import { readDeviceToken, setDeviceCookie } from './device-cookie.js';

/** The browser a request comes from, as a login needs it. */
function browserOf(request: Request): Browser {
  return { deviceToken: readDeviceToken(request), userAgent: request.headers['user-agent'] };
}

/**
 * A child's login and logout (`.docs/design/interfaces.md`, "孩子登录"):
 * `/api/child-auth/*` and `/api/child-login-links/{token}`. They need no
 * login, and the ones that change data still need this site's Origin. A
 * login signs the child in on the browser in place of any child signed in
 * there, and leaves a parent signed in there alone.
 */
@Public()
@Controller()
export class ChildLoginController {
  constructor(
    private readonly loginService: ChildLoginService,
    private readonly sessions: ChildSessionService,
  ) {}

  @Post('child-auth/login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body(new ZodValidationPipe(childLoginRequestSchema)) body: ChildLoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChildLoginResponse> {
    return this.signIn(response, await this.loginService.login(body, browserOf(request)));
  }

  /** The children this browser remembers; none without a device cookie. */
  @Get('child-auth/remembered')
  @Header('Cache-Control', 'no-store')
  async remembered(@Req() request: Request): Promise<RememberedChild[]> {
    return rememberedChildListSchema.parse(
      await this.loginService.remembered(readDeviceToken(request)),
    );
  }

  @Post('child-auth/remembered/:childId/login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async loginRemembered(
    @Param('childId', rememberedChildIdPipe) childId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChildLoginResponse> {
    return this.signIn(
      response,
      await this.loginService.loginRemembered(childId, readDeviceToken(request)),
    );
  }

  /** Signs the child out of this browser; the device cookie, and so the avatars, stay. */
  @Post('child-auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    this.sessions.signOut(response);
  }

  @Get('child-login-links/:token')
  @Header('Cache-Control', 'no-store')
  async linkInfo(@Param('token', linkTokenPipe) token: string): Promise<ChildLoginLinkInfo> {
    return childLoginLinkInfoSchema.parse(await this.loginService.linkInfo(token));
  }

  @Post('child-login-links/:token/password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async setPasswordWithLink(
    @Param('token', linkTokenPipe) token: string,
    @Body(new ZodValidationPipe(setChildPasswordRequestSchema)) body: SetChildPasswordRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChildLoginResponse> {
    return this.signIn(
      response,
      await this.loginService.setPasswordWithLink(token, body, browserOf(request)),
    );
  }

  @Post('child-login-links/:token/login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async loginWithLink(
    @Param('token', linkTokenPipe) token: string,
    @Body(new ZodValidationPipe(childLinkLoginRequestSchema)) body: ChildLinkLoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChildLoginResponse> {
    return this.signIn(
      response,
      await this.loginService.loginWithLink(token, body, browserOf(request)),
    );
  }

  /** Sets the cookies of a completed login: the child's login, and the device token when it is renewed. */
  private async signIn(response: Response, login: CompletedLogin): Promise<ChildLoginResponse> {
    const body = childLoginResponseSchema.parse(login.child);
    await this.sessions.signIn(response, login.child.id);
    if (login.deviceToken !== undefined) {
      setDeviceCookie(response, login.deviceToken);
    }
    return body;
  }
}

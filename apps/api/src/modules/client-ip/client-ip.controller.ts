import { Controller, Get, Header, Req } from '@nestjs/common';
import {
  CLIENT_IP_CANDIDATE_HEADERS,
  clientIpResponseSchema,
  type ClientIpResponse,
} from '@thinklet/contracts';
import type { Request } from 'express';
import { Public } from '../../infrastructure/authentication/public.decorator.js';

/** A header's value as one string, a header sent more than once joined as Node joins it. */
function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : value.join(', ');
}

/**
 * The temporary `GET /api/client-ip` (`.docs/design/interfaces.md`): it
 * shows the requester the candidate headers of its own request, to check
 * which one the proxy in staging writes the client's address into. It
 * needs no login and changes nothing; the request log never writes these
 * headers. It goes once CLIENT_IP_HEADER is settled.
 */
@Public()
@Controller('client-ip')
export class ClientIpController {
  @Get()
  @Header('Cache-Control', 'no-store')
  echo(@Req() request: Request): ClientIpResponse {
    return clientIpResponseSchema.parse(
      Object.fromEntries(
        CLIENT_IP_CANDIDATE_HEADERS.map((name) => [name, headerValue(request.headers[name])]),
      ),
    );
  }
}

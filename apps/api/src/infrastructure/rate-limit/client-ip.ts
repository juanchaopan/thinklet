import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Environment } from '../config/environment.js';

/**
 * The client's IP address in a header value. A proxy that adds the address
 * to a list, as `X-Forwarded-For` does, puts it last, after whatever the
 * client sent itself; so the last entry is taken, the only one a client
 * cannot choose. Node joins a header sent more than once with commas, and
 * a list that arrives as several values is joined the same way.
 */
export function clientIpIn(value: string | readonly string[] | undefined): string | undefined {
  const joined = typeof value === 'string' ? value : value?.join(',');
  const last = joined
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .at(-1);
  return last?.toLowerCase();
}

/**
 * Reads a request's source from the one header the proxy in front of the
 * api writes it into, named by CLIENT_IP_HEADER. The connection's own
 * address is the proxy's, so it is never used.
 */
@Injectable()
export class ClientIpHeader {
  private readonly name: string;

  constructor(config: ConfigService<Environment, true>) {
    this.name = config.get('CLIENT_IP_HEADER', { infer: true });
  }

  /** The client's IP address as the proxy wrote it; undefined when the request has none. */
  read(request: Request): string | undefined {
    return clientIpIn(request.headers[this.name]);
  }
}

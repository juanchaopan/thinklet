import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Environment } from '../config/environment.js';
import { ClientIpHeader, clientIpIn } from './client-ip.js';

describe('clientIpIn', () => {
  it('takes the address a proxy wrote alone', () => {
    expect(clientIpIn('203.0.113.7')).toBe('203.0.113.7');
  });

  it('takes the last address of a list, the one the nearest proxy added', () => {
    expect(clientIpIn('198.51.100.20, 203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpIn(['198.51.100.20', '203.0.113.7'])).toBe('203.0.113.7');
  });

  it('ignores spaces and empty entries', () => {
    expect(clientIpIn(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(clientIpIn('203.0.113.7, ,')).toBe('203.0.113.7');
  });

  it('writes an IPv6 address in lower case, so one address is one source', () => {
    expect(clientIpIn('2001:DB8::1')).toBe('2001:db8::1');
  });

  it.each([undefined, '', ' , ', []])('finds no address in %j', (value) => {
    expect(clientIpIn(value)).toBeUndefined();
  });
});

describe('ClientIpHeader', () => {
  const config = { get: () => 'x-real-ip' } as unknown as ConfigService<Environment, true>;
  const requestWith = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  it('reads the configured header only', () => {
    const header = new ClientIpHeader(config);

    expect(header.read(requestWith({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(header.read(requestWith({ 'x-forwarded-for': '203.0.113.7' }))).toBeUndefined();
  });
});

import { createHmac } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '@/common';
import { authConfig } from '@/config/app.config';
import { TokenService } from '@/modules/auth';

/**
 * Token compatibility with the legacy backend.
 *
 * The legacy service implements HS256 by hand rather than using a library. If
 * the two disagree on encoding by even one character, tokens stop crossing
 * between them and every operator is logged out at cutover. These tests build a
 * token the legacy way and check both directions.
 */
describe('TokenService', () => {
  const secret = 'test-secret-not-a-real-key';

  const buildService = async (): Promise<TokenService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: new JwtService({}) },
        {
          provide: authConfig.KEY,
          useValue: { jwtSecret: secret, jwtExpiresIn: '1h' },
        },
      ],
    }).compile();

    return moduleRef.get(TokenService);
  };

  const payload: JwtPayload = {
    user_id: 'a0d00000000000000000005f',
    role_id: 'a0d000000000000000000060',
    role_name: 'admin',
    permissions: ['user.manage'],
    username: 'operator',
    display_name: 'Operator',
    token_version: 3,
    groups: ['a0d000000000000000000061'],
    allowed_hooks: null,
  };

  /** base64url without padding — the encoding the legacy implementation uses. */
  const base64Url = (input: Buffer | string): string =>
    Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  /** Mints a token exactly the way the legacy backend does. */
  const signLegacyStyle = (body: JwtPayload): string => {
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const claims = base64Url(
      JSON.stringify({ ...body, iat: now, exp: now + 3600 }),
    );
    const signature = base64Url(
      createHmac('sha256', secret).update(`${header}.${claims}`).digest(),
    );
    return `${header}.${claims}.${signature}`;
  };

  it('verifies a token minted the legacy way', async () => {
    const service = await buildService();
    const verified = service.verify(signLegacyStyle(payload));

    expect(verified.user_id).toBe(payload.user_id);
    expect(verified.permissions).toEqual(payload.permissions);
    expect(verified.token_version).toBe(payload.token_version);
    expect(verified.allowed_hooks).toBeNull();
  });

  it('produces a token the legacy verifier would accept', async () => {
    const service = await buildService();
    const token = service.sign(payload);
    const [header, claims, signature] = token.split('.');

    expect(header).toBeDefined();
    expect(claims).toBeDefined();

    // Legacy checks the algorithm explicitly and rejects anything else.
    expect(
      JSON.parse(Buffer.from(header!, 'base64url').toString()),
    ).toMatchObject({
      alg: 'HS256',
      typ: 'JWT',
    });

    // Recomputing the HMAC the legacy way must reproduce the signature.
    const expected = base64Url(
      createHmac('sha256', secret).update(`${header!}.${claims!}`).digest(),
    );
    expect(signature).toBe(expected);
  });

  it('carries every field the dashboard and guards depend on', async () => {
    const service = await buildService();
    const verified = service.verify(service.sign(payload));

    // Dropping any of these silently changes what a session can do.
    for (const field of Object.keys(payload)) {
      expect(verified).toHaveProperty(field);
    }
  });

  it('rejects a tampered payload', async () => {
    const service = await buildService();
    const token = service.sign(payload);
    const [header, , signature] = token.split('.');

    // Re-encode the claims with escalated permissions, keeping the signature.
    const forged = base64Url(
      JSON.stringify({
        ...payload,
        permissions: ['*'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    expect(() => service.verify(`${header!}.${forged}.${signature!}`)).toThrow(
      'invalid or expired token',
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const service = await buildService();
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const claims = base64Url(
      JSON.stringify({ ...payload, iat: now, exp: now + 3600 }),
    );
    const wrongSignature = base64Url(
      createHmac('sha256', 'a-different-secret')
        .update(`${header}.${claims}`)
        .digest(),
    );

    expect(() =>
      service.verify(`${header}.${claims}.${wrongSignature}`),
    ).toThrow('invalid or expired token');
  });

  it('rejects an expired token', async () => {
    const service = await buildService();
    const past = Math.floor(Date.now() / 1000) - 10;
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({ ...payload, iat: past - 3600, exp: past }),
    );
    const signature = base64Url(
      createHmac('sha256', secret).update(`${header}.${claims}`).digest(),
    );

    expect(() => service.verify(`${header}.${claims}.${signature}`)).toThrow(
      'invalid or expired token',
    );
  });
});

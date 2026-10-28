import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { authConfig } from '@/config/app.config';
import type { JwtPayload } from '@/common';

/**
 * Signs and verifies the service's JWTs.
 *
 * The legacy backend implements HS256 by hand. This uses `@nestjs/jwt`, which
 * produces the same standard encoding — verified by a test that checks a token
 * minted by one backend is accepted by the other. What must not change is the
 * algorithm, the secret and the payload field names; those are the contract.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  sign(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.config.jwtSecret,
      // Cast: the library types this as a template-literal duration, but the
      // value is configuration and only known at runtime. Validated at boot.
      expiresIn: this.config.jwtExpiresIn as `${number}h`,
      algorithm: 'HS256',
    });
  }

  /**
   * [FEAT-20260808-HTTPONLY-S1] Expiry of a signed token, as epoch milliseconds.
   *
   * Derived from the JWT `exp` claim itself (not recomputed from config), so it
   * is exactly when THIS token dies — the source of truth for both the response
   * `expiresAt` (the FE session timer once the token is cookie-only and can no
   * longer be decoded client-side) and the cookie `maxAge`.
   *
   * Returns null only if the token somehow carries no `exp`, which a token this
   * service just signed always does.
   */
  expiresAt(token: string): number | null {
    const decoded = this.jwtService.decode<JwtPayload | null>(token);
    if (!decoded || typeof decoded.exp !== 'number') return null;
    // `exp` is seconds since epoch (RFC 7519); callers want milliseconds.
    return decoded.exp * 1000;
  }

  /**
   * Verifies signature and expiry.
   *
   * Every failure becomes the same 401 with the same message the legacy backend
   * used. Distinguishing "expired" from "bad signature" in the response would
   * tell an attacker which half of a guess was right.
   */
  verify(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: this.config.jwtSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}

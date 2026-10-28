import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import type { Request } from 'express';
import type { Model } from 'mongoose';

import { IS_PUBLIC_KEY, type AuthenticatedUser } from '@/common';
import { User, type UserDocument } from '@/modules/admin';

import { ACCESS_TOKEN_COOKIE } from '../auth-cookie';
import { TokenService } from '../token.service';

/**
 * Authenticates every request unless the route is marked `@Public()`.
 *
 * Registered globally, so the default is deny. The legacy backend worked the
 * other way round — everything open, with a hand-maintained list of paths that
 * needed a token — and forgetting an entry there silently published an
 * endpoint. Here, forgetting an annotation makes a route return 401: visible
 * immediately, and safe in the meantime.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('missing authentication token');

    const payload = this.tokenService.verify(token);

    /**
     * A valid signature is not enough — the account must still be usable.
     *
     * This is what makes revocation immediate: deactivating, deleting or logging
     * an account out bumps `token_version`, and every token issued before that
     * stops working on its next request rather than lingering until it expires.
     */
    const user = await this.userModel
      .findById(payload.user_id)
      .select('active deleted_at token_version')
      .lean()
      .exec();

    if (!user || !user.active || user.deleted_at) {
      throw new UnauthorizedException('invalid or expired token');
    }

    if ((payload.token_version || 0) !== (user.token_version || 0)) {
      throw new UnauthorizedException('invalid or expired token');
    }

    request.user = {
      userId: payload.user_id,
      roleId: payload.role_id,
      roleName: payload.role_name,
      permissions: payload.permissions ?? [],
      // [FIX-20260820-SESSIONCEILING] plumbing only — the guard never enforces
      // it. Without this line `refresh` cannot see the deadline it must honour.
      sessionExpiresAt: payload.sess_exp,
      username: payload.username,
      displayName: payload.display_name,
      tokenVersion: payload.token_version ?? 0,
      groups: payload.groups ?? [],
      allowedHooks: payload.allowed_hooks,
    };

    return true;
  }

  /**
   * Resolves the token, preferring the HttpOnly cookie and falling back to the
   * headers.
   *
   * [FEAT-20260808-HTTPONLY-S1] The cookie is read FIRST so a browser that has
   * migrated to cookie auth needs nothing in its headers. The `Authorization:
   * Bearer` and legacy `x-access-token` paths are kept UNCHANGED underneath, so
   * every existing Bearer client keeps authenticating identically during the
   * migration — dual-support, zero breakage. (Requires cookie-parser, mounted in
   * main.ts, to populate `request.cookies`.)
   */
  private extractToken(request: Request): string | undefined {
    // cookie-parser populates `req.cookies` with string values (or undefined).
    const { cookies } = request as {
      cookies?: Record<string, string | undefined>;
    };
    const cookieToken = cookies?.[ACCESS_TOKEN_COOKIE];
    if (typeof cookieToken === 'string' && cookieToken.trim() !== '') {
      return cookieToken;
    }

    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7).trim();
    }

    const legacyHeader = request.headers['x-access-token'];
    return typeof legacyHeader === 'string' ? legacyHeader : undefined;
  }
}

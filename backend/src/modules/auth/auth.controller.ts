import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser, Public, type AuthenticatedUser } from '@/common';
import { cookieConfig } from '@/config/app.config';
import { normalizeLoginUsername } from '@/infra/rate-limit/login-user-key';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';

import {
  clearAuthCookie,
  setAuthCookie,
  type CookieAttributes,
} from './auth-cookie';
import { AuthService, type AuthResponse } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { WsTicketService, type WsTicketResult } from './ws-ticket.service';

/**
 * Paths are `/api/auth/*`, matching the legacy backend exactly — the dashboard
 * has them compiled in.
 */
@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: RateLimitService,
    private readonly wsTicket: WsTicketService,
    @Inject(cookieConfig.KEY)
    private readonly cookie: ConfigType<typeof cookieConfig>,
  ) {}

  /** Cookie attributes for this environment, shared by the set + clear paths. */
  private cookieAttributes(): CookieAttributes {
    return {
      domain: this.cookie.domain,
      secure: this.cookie.secure,
      sameSite: this.cookie.sameSite,
    };
  }

  /**
   * [FEAT-20260808-HTTPONLY-S1] Sets the HttpOnly auth cookie from a login/
   * refresh result, in ADDITION to the body token + X-Auth-Key header the caller
   * already set. maxAge tracks the JWT expiry so cookie and token die together;
   * if expiry is somehow absent the cookie is skipped rather than made a
   * never-expiring session cookie.
   */
  private issueCookie(response: Response, result: AuthResponse): void {
    if (result.expiresAt === null) return;
    const maxAgeMs = result.expiresAt - Date.now();
    if (maxAgeMs <= 0) return;
    setAuthCookie(response, result.token, this.cookieAttributes(), maxAgeMs);
  }

  /**
   * Rate limited per client IP: without it, this endpoint is an offline
   * password-guessing oracle with unlimited attempts. The limiter fails open,
   * so a Redis outage degrades protection rather than locking everyone out.
   *
   * ── สามแกน ไม่ทับกัน (เจ้าของสั่ง 23/08/2026) ────────────────────────────
   *   แกน 1 · ต่อ IP · **ทุก** request        · 30 / 60 วิ   · เพดานดิบ
   *   แกน 2 · ต่อ IP · **เฉพาะรหัสผิด**       · 15 / 300 วิ  · `[FEAT-20260823-LOGINFAIL]`
   *   แกน 3 · ต่อ บัญชี · **เฉพาะรหัสผิด**    · 5 / 300 วิ   · `[FEAT-20260823-LOGINUSER]`
   *
   * แต่ละแกนกันคนละเคส — เอาออกแกนไหนก็มีรูตรงนั้น:
   *   แกน 1 → คนยิงรัวเป็นร้อยครั้ง/นาที (ไม่ว่าจะถูกหรือผิด)
   *   แกน 2 → **ยิงจาก IP เดิมแล้วสุ่มชื่อผู้ใช้ไปเรื่อย ๆ** (แกน 3 จับไม่ได้เพราะ
   *            คนละ username = คนละตัวนับ แต่ทุกครั้งคือรหัสผิด)
   *   แกน 3 → botnet เปลี่ยน IP ทุกครั้ง แต่จิ้มบัญชีเดิม (แกน 1-2 จับไม่ได้)
   *
   * ⭐ ข้อกำหนดเจ้าของ 23/08: *"Ip office ไม่ชน / admin หลายคนคละ user =
   *    ใช้จริงมีโอกาสผิดได้ 1-2 ครั้งต่อการ login ไม่กระทบ admin คนอื่น"*
   *    ทำได้เพราะ **ล็อกอินที่ถูกไม่กินโควตาแกน 2 และ 3 เลย** และแกน 1 ตั้งไว้ 30
   *    ซึ่งทราฟฟิกออฟฟิศจริงไม่มีทางชน. แอดมิน 5 คนพิมพ์ผิดคนละ 2 ครั้ง = 10
   *    ยังต่ำกว่า 15 ของแกน 2 และแยกบัญชีกันด้วยแกน 3.
   *
   * ทำไมแกน 2-3 นับเฉพาะตอนผิด: ถ้านับทุกครั้ง คนที่ล็อกอินถูกบ่อย ๆ (หลายแท็บ,
   * token หมดอายุ) จะโดนล็อกตัวเอง — และออฟฟิศ IP เดียวจะชนกันเองทันที.
   * แบบนี้ล็อกอินถูกไม่เสียโควตาเลย และ Mongo ล่ม/500 ก็ไม่เสีย —
   * เสียเฉพาะ "รหัสผิด" ซึ่งคือสิ่งที่ต้องการกัน.
   *
   * ปิดทีละแกนได้: `RATE_LIMIT_LOGIN_FAIL_ENABLED=false` /
   * `RATE_LIMIT_LOGIN_USER_ENABLED=false` ⇒ ไม่มี Redis call เพิ่มของแกนนั้น
   * และโค้ดเดินเส้นเดิมทุกบรรทัด. ตัวเลขทั้งสามแกนตั้งแยกกันได้อิสระ.
   * revert: ลบบล็อก `[FEAT-20260823-LOGINFAIL]`/`[FEAT-20260823-LOGINUSER]`
   *         ข้างล่าง + ไฟล์ login-user-key.ts
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive a token' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const clientIp = this.rateLimit.resolveClientIp(request);
    const verdict = await this.rateLimit.consume('login', clientIp);
    if (verdict.limited) {
      // Status and message match the legacy middleware exactly.
      throw new HttpException(
        'rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    /* [FEAT-20260823-LOGINFAIL] แกน 2 — รหัสผิดต่อ IP. ปิดอยู่ ⇒ ค่าว่าง
       และทุกบรรทัดที่ใช้มันข้ามหมด (ไม่มี Redis call). */
    const failIpKey = this.rateLimit.isLoginFailEnabled() ? clientIp : '';

    /* [FEAT-20260823-LOGINUSER] แกน 3 — ต่อบัญชี. `''` (ไม่มีชื่อ) หรือแกนนี้
       ปิดอยู่ ⇒ `userKey` เป็นค่าว่าง และทุกบรรทัดข้างล่างข้ามหมด. */
    const userKey = this.rateLimit.isLoginUserEnabled()
      ? normalizeLoginUsername(dto.username)
      : '';

    if (
      (await this.rateLimit.isLoginIpFailBlocked(failIpKey)) ||
      (await this.rateLimit.isLoginUserBlocked(userKey))
    ) {
      // ข้อความและสถานะเดียวกับชั้น IP — client ไม่ต้องรู้ว่าโดนชั้นไหน
      throw new HttpException(
        'rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let result: AuthResponse;
    try {
      result = await this.authService.login(dto.username, dto.password);
    } catch (err) {
      /* นับเฉพาะ "รหัสผิด" จริง ๆ — `UnauthorizedException` เป็นตัวเดียวที่
         `authService.login` โยนเมื่อ user ไม่มีหรือรหัสไม่ตรง (auth.service.ts:80-82).
         Mongo ล่มหรือ error อื่นโยนคนละชนิด ⇒ ไม่กินโควตาบัญชีใคร. */
      if (err instanceof UnauthorizedException) {
        await this.rateLimit.chargeLoginIpFailure(failIpKey);
        await this.rateLimit.chargeLoginUserFailure(userKey);
      }
      throw err; // ส่งต่อของเดิมทั้งดุ้น ห้ามแปลง ห้ามกลืน
    }

    // Legacy clients read the token from this header as well as the body.
    response.set('X-Auth-Key', result.token);
    // [FEAT-20260808-HTTPONLY-S1] Additive HttpOnly cookie; body + header stay.
    this.issueCookie(response, result);
    return result;
  }

  /** Re-issues a token, picking up permission changes since it was minted. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a valid token for a fresh one' })
  async refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.refresh(
      user.userId,
      // [FIX-20260820-SESSIONCEILING] the deadline the CURRENT token carries.
      user.sessionExpiresAt,
    );
    response.set('X-Auth-Key', result.token);
    // [FEAT-20260808-HTTPONLY-S1] Re-issue the cookie with the fresh token.
    this.issueCookie(response, result);
    return result;
  }

  /**
   * Revokes the caller's tokens.
   *
   * Authenticated, matching the legacy backend: its skip-auth list does not name
   * this path, so a request without a valid token gets 401 there and must here
   * too. (Logging out with an already-expired token is a no-op anyway — the
   * token it would revoke is dead.)
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the caller tokens' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    await this.authService.logout(user?.userId);
    // [FEAT-20260808-HTTPONLY-S1] Clear the auth cookie so the browser stops
    // sending it. Same attributes as the set, or the browser keeps the old one.
    clearAuthCookie(response, this.cookieAttributes());
    return { message: 'logout successful' };
  }

  /**
   * [FEAT-20260808-HTTPONLY-S1] Mints a short-lived, single-use WebSocket
   * connection ticket.
   *
   * Authenticated by the global guard — cookie OR Bearer, so it works before and
   * after the FE migrates. The dashboard cannot attach auth to a WebSocket
   * handshake header, and a cookie-only token cannot be read to build
   * `?token=`; it calls this instead and connects with `?ticket=<t>`, which
   * omnidesk-ws consumes via GETDEL (single-use). The ticket carries the caller's
   * resolved OA allowlist so omnidesk-ws applies the SAME per-tenant fan-out filter.
   */
  @Post('ws-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mint a single-use WebSocket connection ticket' })
  async wsTicketMint(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WsTicketResult> {
    return this.wsTicket.mint(user);
  }
}

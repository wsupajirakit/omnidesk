/** Public surface of the auth module — import '@/modules/auth'. */

export { AuthModule } from './auth.module';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { TokenService } from './token.service';
// [FIX-20260818-SECAUDIT] The class joins the type it already exported: the
// barrel is how anything outside this module reaches it, and the login-audit
// cases construct the service directly. Leaf imports are what the layering rule
// forbids, so widening by one named export is the honest way in.
export { AuthService, type AuthResponse } from './auth.service';
// [FEAT-20260808-HTTPONLY-S1] WS ticket minting + auth-cookie helpers.
export {
  WsTicketService,
  type WsTicketPayload,
  type WsTicketResult,
} from './ws-ticket.service';
export {
  ACCESS_TOKEN_COOKIE,
  buildCookieOptions,
  clearAuthCookie,
  setAuthCookie,
  type CookieAttributes,
} from './auth-cookie';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ConfigType } from '@nestjs/config';
import type { Model, Types } from 'mongoose';

import type { JwtPayload } from '@/common';
import { verifyPassword } from '@/common/utils/password';
import { authConfig } from '@/config/app.config';
// [FIX-20260818-SECAUDIT] plan §2.2b M3 — the trail this module never wrote to.
import { AuditLogService, recordUserSecurityEvent } from '@/modules/audit';
import { User, type UserDocument } from '@/modules/admin';

import { TokenService } from './token.service';

/** Login/refresh response body. Field names are read directly by the dashboard. */
export interface AuthResponse {
  token: string;
  /**
   * [FEAT-20260808-HTTPONLY-S1] Token expiry as epoch milliseconds, derived from
   * the JWT `exp`. Additive: legacy clients ignore an unknown field. Once the
   * token moves to a cookie-only delivery the FE can no longer decode it for the
   * session timer, so the backend states the expiry explicitly here.
   */
  expiresAt: number | null;
  user: {
    id: string;
    username: string;
    display_name: string;
    role_id: string | null;
    groups: Array<{ id: string; group_name?: string }>;
    allowed_hooks: string[] | null;
    preferences: Record<string, unknown> | null;
  };
  role: { id: string; name: string } | null;
  permissions: string[];
}

/** Roles whose permissions come from the role rather than the account. */
const SUPER_ROLES = ['superadmin', 'superuser'];

/** Populates role (with its menu tree) and groups, as the legacy queries do. */
const POPULATE = [
  {
    path: 'role',
    populate: { path: 'menu_access', populate: { path: 'parent_menu' } },
  },
  { path: 'groups' },
];

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly tokenService: TokenService,
    // [FIX-20260818-SECAUDIT] see the write in `login`
    private readonly auditLogService: AuditLogService,
    // [FIX-20260820-SESSIONCEILING] reads `sessionMaxLifetimeMin`.
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  /**
   * Authenticates a username and password.
   *
   * Both "no such user" and "wrong password" return the same message, so the
   * response cannot be used to discover which usernames exist.
   */
  async login(username: string, password: string): Promise<AuthResponse> {
    const normalized = username.trim().toLowerCase();

    const user = await this.userModel
      .findOne({
        username: normalized,
        active: true,
        deleted_at: { $exists: false },
      })
      .populate(POPULATE)
      .exec();

    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('invalid username or password');
    }

    /**
     * Bumping token_version on every login invalidates any token issued earlier,
     * so one account cannot hold two live sessions.
     *
     * `timestamps: false` keeps updated_at untouched — logging in is not an edit
     * of the record, and the dashboard sorts by that column.
     */
    const refreshed = await this.userModel
      .findByIdAndUpdate(
        user._id,
        { $inc: { token_version: 1 }, last_login: new Date() },
        { new: true, timestamps: false },
      )
      .populate(POPULATE)
      .exec();

    if (!refreshed)
      throw new UnauthorizedException('invalid username or password');

    /**
     * [FIX-20260818-SECAUDIT] plan §2.2b M3 — a sign-in leaves a trace.
     *
     * Until this line, `grep audit src/modules/auth/` returned nothing: the one
     * event every incident review starts from was the one event nobody recorded.
     * The actor is the account itself, because nobody else performed it.
     *
     * Written AFTER the credentials are accepted and never on the refusal path:
     * a failed attempt needs an `action` value the schema's enum does not have,
     * and a `ref_id` an unknown username cannot supply. That gap is deliberate
     * and written up — see the header of `security-events.ts`.
     *
     * Fire-and-forget by construction, so a Mongo hiccup in the audit collection
     * cannot lock everybody out of the dashboard.
     */
    recordUserSecurityEvent(this.auditLogService, {
      action: 'login',
      targetUserId: refreshed._id,
      actor: {
        user_id: String(refreshed._id),
        username: refreshed.username,
        display_name: refreshed.display_name,
      },
      groupId: (refreshed.groups as unknown[] | undefined)?.[0] ?? null,
      note: `Signed in: ${refreshed.username}`,
    });

    // A fresh sign-in starts a fresh window.
    return this.buildResponse(refreshed, this.sessionDeadline());
  }

  /**
   * Issues a fresh token for an already-authenticated caller, picking up any
   * permission or allowlist change since the current token was minted.
   */
  async refresh(userId: string, sessExp?: number): Promise<AuthResponse> {
    const user = await this.userModel
      .findOne({ _id: userId, active: true, deleted_at: { $exists: false } })
      .populate(POPULATE)
      .exec();

    if (!user) throw new UnauthorizedException('invalid or expired token');

    /*
     * ==== [FIX-20260820-SESSIONCEILING] renewal stops moving the wall
     *
     * There is no refresh token here: the access token IS the renewal
     * credential, so anyone holding a live one could renew it indefinitely and
     * the only thing that ever stopped them was somebody bumping
     * `token_version` by hand. This gives the sign-in an absolute deadline that
     * travels inside the token and is CARRIED FORWARD unchanged on every
     * renewal — `sessExp ?? deadline`, never `deadline` on its own. That single
     * `??` is the whole fix.
     *
     * Absent claim = a token minted before this shipped. It is STAMPED, not
     * refused, so the deploy logs nobody out and the ceiling starts applying one
     * window later. token เก่าไม่โดนเตะ · แค่ถูกประทับเวลาให้.
     *
     * Enforced HERE and not in the guard on purpose: at the wall the caller's
     * current token keeps working until its own `exp` (<= JWT_EXPIRES_IN), so
     * nobody is ejected mid-request — only the next renewal is refused, and the
     * dashboard already has a "sign in again" path for that.
     *
     * The message is the same string every other auth refusal uses; nothing
     * here tells a caller WHY it was refused.
     *
     * revert: drop `sessExp` from the signature, this block, the `sess_exp`
     * lines in buildResponse, and SESSION_MAX_LIFETIME_MIN.
     */
    const deadline = this.sessionDeadline();
    if (
      deadline !== undefined &&
      sessExp !== undefined &&
      Math.floor(Date.now() / 1000) >= sessExp
    ) {
      throw new UnauthorizedException('invalid or expired token');
    }

    return this.buildResponse(user, sessExp ?? deadline);
  }

  /** Epoch seconds, or `undefined` when the knob is 0 — the feature is off. */
  private sessionDeadline(): number | undefined {
    const mins = this.auth.sessionMaxLifetimeMin;
    return mins > 0 ? Math.floor(Date.now() / 1000) + mins * 60 : undefined;
  }

  /**
   * Revokes every token for the account by bumping its version.
   *
   * Never reports failure: the client discards its token either way, and a
   * user who is told logout failed has no useful action to take.
   */
  async logout(userId: string | undefined): Promise<void> {
    if (!userId) return;

    try {
      await this.userModel
        .findByIdAndUpdate(
          userId,
          { $inc: { token_version: 1 } },
          { timestamps: false },
        )
        .exec();
    } catch {
      // Intentionally swallowed — see above.
    }
  }

  /**
   * Effective permissions for an account.
   *
   * A user's own permissions win; the role's are only a template used when the
   * account is created. Unioning the two was tried and reverted — it restored
   * every role permission to accounts that had been deliberately narrowed,
   * making per-account checkboxes meaningless.
   *
   * Login and refresh must both call this, or a refresh would silently change
   * what the caller can do.
   */
  private resolvePermissions(user: UserDocument): string[] {
    const role = user.role as unknown as {
      name?: string;
      permissions?: string[];
    } | null;

    if (role?.name && SUPER_ROLES.includes(role.name)) {
      return role.permissions ?? [];
    }
    return user.permissions ?? [];
  }

  private buildResponse(user: UserDocument, sessExp?: number): AuthResponse {
    const role = user.role as unknown as {
      _id: Types.ObjectId;
      name: string;
      permissions?: string[];
    } | null;
    const permissions = this.resolvePermissions(user);

    /**
     * `groups` is either raw ObjectIds or populated documents depending on the
     * query, and both shapes reach this method.
     */
    type PopulatedGroup = { _id: Types.ObjectId; group_name?: string };
    const isPopulated = (group: unknown): group is PopulatedGroup =>
      typeof group === 'object' && group !== null && '_id' in group;

    const groups = (user.groups ?? []) as unknown as Array<
      Types.ObjectId | PopulatedGroup
    >;

    /** `null` means "no allowlist" — every OA in the user's groups. */
    const allowedHooks = Array.isArray(user.allowed_hooks)
      ? user.allowed_hooks.map((id) => String(id))
      : null;

    const payload: JwtPayload = {
      user_id: String(user._id),
      role_id: role ? String(role._id) : null,
      role_name: role ? role.name : null,
      permissions,
      username: user.username,
      display_name: user.display_name,
      token_version: user.token_version || 0,
      // Omitted entirely when the knob is off, so the signed payload is
      // byte-identical to today's.
      ...(sessExp !== undefined ? { sess_exp: sessExp } : {}),
      groups: groups.map((group) =>
        isPopulated(group) ? String(group._id) : String(group),
      ),
      allowed_hooks: allowedHooks,
    };

    const token = this.tokenService.sign(payload);

    return {
      token,
      // [FEAT-20260808-HTTPONLY-S1] Explicit expiry so the FE can run the
      // session timer without decoding the token (it may be cookie-only).
      expiresAt: this.tokenService.expiresAt(token),
      user: {
        id: String(user._id),
        username: user.username,
        display_name: user.display_name,
        role_id: role ? String(role._id) : null,
        groups: groups.map((group) =>
          isPopulated(group)
            ? { id: String(group._id), group_name: group.group_name }
            : { id: String(group) },
        ),
        allowed_hooks: allowedHooks,
        // `null` = never set, so the client falls back to its own defaults.
        preferences:
          user.preferences && typeof user.preferences === 'object'
            ? user.preferences
            : null,
      },
      role: role ? { id: String(role._id), name: role.name } : null,
      permissions,
    };
  }
}

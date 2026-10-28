import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { hashPassword, verifyPassword } from '@/common/utils/password';

import type {
  ChangePasswordDto,
  GenerateTempKeyDto,
  KillUserSessionsDto,
  ResetPasswordWithTempKeyDto,
  UpdatePreferencesDto,
} from './dto';
import { User } from './schemas/user.schema';
// [FIX-20260818-RANKCALLSITES]
import { UsersAccessService } from './users-access.service';

const TEMP_KEY_SECRET =
  process.env.TEMP_KEY_SECRET || process.env.JWT_SECRET || 'temp-key-secret';

const deriveKey = (): Buffer =>
  createHash('sha256').update(TEMP_KEY_SECRET).digest();

const encryptUserId = (userId: string): string => {
  const iv = randomBytes(12);
  const key = deriveKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(userId, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
};

const decryptUserId = (token: string): string | null => {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const encrypted = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const key = deriveKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};

const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') {
    return patch;
  }
  const out =
    base && typeof base === 'object' && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  const patchObj = patch as Record<string, unknown>;
  for (const key of Object.keys(patchObj)) {
    out[key] = deepMerge(out[key], patchObj[key]);
  }
  return out;
};

@Injectable()
export class UsersPrefsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    // [FIX-20260818-RANKCALLSITES] both privileged routes below now ask whether
    // the caller outranks the account they are about to act on.
    private readonly accessService: UsersAccessService,
  ) {}

  async changePassword(
    authUser: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const userId = authUser.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('invalid or expired token');
    }
    if (!dto.old_password) {
      throw new BadRequestException('old_password is required');
    }
    if (!dto.password) {
      throw new BadRequestException('password is required');
    }
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const oldMatches = verifyPassword(dto.old_password, user.password_hash);
    if (!oldMatches) {
      throw new BadRequestException('old_password is incorrect');
    }
    user.password_hash = hashPassword(dto.password);
    user.token_version = (user.token_version || 0) + 1;
    await user.save();
    return { message: 'password updated successfully' };
  }

  /**
   * [FIX-20260818-RANKCALLSITES] NOT in the audit — found by enumerating the family.
   *
   * This route took `user_id` from the body and did not receive the caller at
   * all, so an `admin` could mint a reset key for a `superadmin` and post it to
   * the PUBLIC `/reset-password-temp` route to sign in as them. That route is
   * itself sound — the key is encrypted, bound to the user, expiring and rate
   * limited — which is precisely why the door had to be closed on the ISSUING
   * side. Closing H12 alone would have left this path wide open.
   *
   * The dashboard does not call this route, so nothing on screen changes.
   */
  async generateTempKey(
    dto: GenerateTempKeyDto,
    authUser?: AuthenticatedUser,
  ): Promise<{ temp_key: string; expires_at: Date }> {
    const userId = dto.user_id;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('user_id is required');
    }
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!(await this.accessService.mayActOnUser(authUser, user.role))) {
      throw new ForbiddenException('insufficient role level');
    }
    const tempKey = encryptUserId(String(userId));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.temp_key = tempKey;
    user.temp_key_expires_at = expiresAt;
    await user.save();
    return { temp_key: tempKey, expires_at: expiresAt };
  }

  async resetPasswordWithTempKey(
    dto: ResetPasswordWithTempKeyDto,
  ): Promise<{ message: string }> {
    const tempKey = (dto.temp_key || '').trim();
    const password = dto.password;
    if (!tempKey) {
      throw new BadRequestException('temp_key is required');
    }
    if (!password) {
      throw new BadRequestException('password is required');
    }
    const embeddedUserId = decryptUserId(tempKey);
    if (!embeddedUserId || !Types.ObjectId.isValid(embeddedUserId)) {
      throw new BadRequestException('Invalid temp_key');
    }
    const user = await this.userModel
      .findOne({
        _id: embeddedUserId,
        temp_key: tempKey,
        deleted_at: { $exists: false },
      })
      .exec();
    if (!user) {
      throw new NotFoundException('Invalid temp_key');
    }
    if (!user.temp_key_expires_at || user.temp_key_expires_at < new Date()) {
      throw new BadRequestException('temp_key expired');
    }
    user.password_hash = hashPassword(password);
    user.temp_key = '';
    user.temp_key_expires_at = undefined;
    user.token_version = (user.token_version || 0) + 1;
    await user.save();
    return { message: 'password updated successfully' };
  }

  /**
   * [FIX-20260818-RANKCALLSITES] NOT in the audit — same family as generateTempKey.
   *
   * Revoking sessions is a forced logout rather than a takeover, so this is the
   * mildest of the three; it is fixed with them because a guard applied to two
   * doors out of three is the state that produced this finding in the first
   * place. The dashboard does not call this route either.
   */
  async killUserSessions(
    idFromParam: string | undefined,
    dto?: KillUserSessionsDto,
    authUser?: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const userId = idFromParam || dto?.user_id;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('user_id is required');
    }
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!(await this.accessService.mayActOnUser(authUser, user.role))) {
      throw new ForbiddenException('insufficient role level');
    }
    user.token_version = (user.token_version || 0) + 1;
    await user.save();
    return { message: 'sessions revoked' };
  }

  async getMyPreferences(
    authUser: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> | null }> {
    const userId = authUser.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('invalid or expired token');
    }
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .select('preferences')
      .lean()
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return {
      data:
        user.preferences && typeof user.preferences === 'object'
          ? user.preferences
          : null,
    };
  }

  async updateMyPreferences(
    authUser: AuthenticatedUser,
    dto: UpdatePreferencesDto,
  ): Promise<{ data: Record<string, unknown> }> {
    const userId = authUser.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('invalid or expired token');
    }
    const patch = dto.preferences ?? dto;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new BadRequestException('preferences must be an object');
    }
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .exec();
    if (!user) throw new NotFoundException('User not found');

    const base =
      user.preferences && typeof user.preferences === 'object'
        ? user.preferences
        : {};
    const merged = deepMerge(base, patch) as Record<string, unknown>;
    user.preferences = merged;
    user.markModified('preferences');
    await user.save();
    return { data: user.preferences };
  }
}

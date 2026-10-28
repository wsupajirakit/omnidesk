import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { hashPassword } from '@/common/utils/password';
import { seedConfig } from '@/config/app.config';
import { Menu, type MenuDocument } from '@/modules/content';

import { Role, type RoleDocument } from '../schemas/role.schema';
import { User } from '../schemas/user.schema';
import { DEFAULT_MENUS, DEFAULT_ROLES, type SeedRole } from './acl-seed.data';

/**
 * [FEAT-20260808-ACLSEED] ACL bootstrap seeder — the NestJS port of legacy
 * `runAclMigration` (aclMigrationService.js). Seeds DEFAULT_MENUS,
 * DEFAULT_ROLES and the three seed users so a BLANK database has something to
 * log in as. On an already-populated database it is a no-op.
 *
 * ── idempotency contract (ported verbatim, prod is a blank DB) ──────────────
 *  · menus  — created if absent; if present, only the code-owned structure is
 *             refreshed (label / required_permissions / order / meta). `visible`
 *             and `deleted_at` are NEVER touched, so an admin-hidden or deleted
 *             menu does not resurrect. (legacy [FIX-20260729-SEEDPASS])
 *  · roles  — skip-if-exists. A role's permissions/description become admin-owned
 *             the moment it exists; a re-run never clobbers a UI grant/revoke.
 *  · users  — skip-if-exists. Re-running NEVER resets a live password. Passwords
 *             come from INIT_* env (sane defaults) and only seed a fresh account.
 *
 * ── pluggable / zero-impact ─────────────────────────────────────────────────
 * Boot-time seeding is gated by `ACL_SEED_ON_BOOT` (default true). Setting it
 * false makes this provider dormant; removing it from AdminModule removes the
 * feature entirely with no other code change. Boot seeding is wrapped so a seed
 * failure logs and continues — it must never take the whole service down.
 */
@Injectable()
export class AclSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AclSeederService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(Menu.name) private readonly menuModel: Model<Menu>,
    @Inject(seedConfig.KEY)
    private readonly seed: ConfigType<typeof seedConfig>,
  ) {}

  /**
   * Runs the seeder on boot when enabled. Never throws: a blank-DB seed is a
   * best-effort convenience, not a request path, so a failure is logged and the
   * app keeps booting rather than crash-looping.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.seed.aclSeedOnBoot) {
      this.logger.log('ACL_SEED_ON_BOOT=false — skipping ACL seeder');
      return;
    }
    try {
      const summary = await this.run();
      this.logger.log(
        `ACL seed done — menus(+${summary.menusCreated}/~${summary.menusUpdated}) ` +
          `roles(+${summary.rolesCreated}) users(+${summary.usersCreated})`,
      );
    } catch (error) {
      this.logger.error(
        `ACL seed failed (continuing boot): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Seed roles, menus and users. Returns a per-collection insert/update count
   * so callers (and the idempotency test) can assert a second run inserts
   * nothing.
   */
  async run(): Promise<AclSeedSummary> {
    await this.ensureCollections();
    const menus = await this.seedMenus();
    const roles = await this.seedRoles(menus.docs);
    const users = await this.ensureSeedUsers();
    return {
      menusCreated: menus.created,
      menusUpdated: menus.updated,
      rolesCreated: roles.created,
      usersCreated: users.created,
    };
  }

  /**
   * Best-effort collection + index creation for a blank DB, so the unique
   * `menus.path` index exists before the first insert. `createCollection`
   * throws if the collection already exists — swallowed on purpose.
   */
  private async ensureCollections(): Promise<void> {
    await Promise.all([
      this.userModel.createCollection().catch(() => undefined),
      this.roleModel.createCollection().catch(() => undefined),
      this.menuModel.createCollection().catch(() => undefined),
    ]);
    await Promise.all([
      this.userModel.syncIndexes().catch(() => undefined),
      this.roleModel.syncIndexes().catch(() => undefined),
      this.menuModel.syncIndexes().catch(() => undefined),
    ]);
  }

  /**
   * Create missing menus; refresh the code-owned structure of existing ones.
   * NEVER touches `visible` / `deleted_at` (see class comment). Returns every
   * non-deleted menu so roles can resolve their `menu_keys` to ObjectIds.
   */
  private async seedMenus(): Promise<{
    docs: MenuDocument[];
    created: number;
    updated: number;
  }> {
    let created = 0;
    let updated = 0;
    for (const menu of DEFAULT_MENUS) {
      const existing = await this.menuModel.findOne({ path: menu.path }).exec();
      if (existing) {
        await this.menuModel
          .updateOne(
            { _id: existing._id },
            {
              $set: {
                label: menu.label,
                required_permissions: menu.required_permissions,
                order: menu.order,
                meta: menu.meta,
              },
            },
          )
          .exec();
        updated += 1;
        continue;
      }
      await this.menuModel.create({
        label: menu.label,
        path: menu.path,
        // Spread the readonly seed arrays into mutable ones for Mongoose.
        required_permissions: [...menu.required_permissions],
        order: menu.order,
        visible: true,
        meta: menu.meta,
      });
      created += 1;
    }
    const docs = await this.menuModel
      .find({ deleted_at: { $exists: false } })
      .exec();
    return { docs, created, updated };
  }

  /** Create missing roles (skip-if-exists). Resolves menu_keys → menu _ids. */
  private async seedRoles(menus: MenuDocument[]): Promise<{ created: number }> {
    const menuMap = new Map<string, MenuDocument>();
    for (const menu of menus) {
      const key = (menu.meta as { key?: string } | undefined)?.key;
      if (key) menuMap.set(key, menu);
    }

    let created = 0;
    for (const role of DEFAULT_ROLES) {
      const existing = await this.roleModel.findOne({ name: role.name }).exec();
      if (existing) continue;

      await this.roleModel.create({
        name: role.name,
        description: role.description,
        active: true,
        permissions: [...role.permissions],
        menu_access: this.resolveMenuAccess(role, menuMap),
      });
      created += 1;
    }
    return { created };
  }

  private resolveMenuAccess(
    role: SeedRole,
    menuMap: Map<string, MenuDocument>,
  ): Types.ObjectId[] {
    const ids: Types.ObjectId[] = [];
    for (const key of role.menu_keys) {
      const menu = menuMap.get(key);
      if (menu) ids.push(menu._id);
    }
    return ids;
  }

  /**
   * Seed the three bootstrap accounts (skip-if-exists). Credentials come from
   * INIT_* env with sane defaults; usernames are trimmed + lowercased to match
   * the unique index and the legacy normalisation.
   */
  private async ensureSeedUsers(): Promise<{ created: number }> {
    const adminRole = await this.roleModel.findOne({ name: 'admin' }).exec();
    const superadminRole = await this.roleModel
      .findOne({ name: 'superadmin' })
      .exec();
    if (!adminRole || !superadminRole) {
      throw new Error('roles must exist before seeding users');
    }

    let created = 0;
    created += await this.upsertUser({
      username: this.seed.adminUsername,
      password: this.seed.adminPassword,
      displayName: this.seed.adminDisplayName,
      role: adminRole,
    });
    created += await this.upsertUser({
      username: this.seed.devUsername,
      password: this.seed.devPassword,
      displayName: this.seed.devDisplayName,
      role: superadminRole,
    });
    created += await this.upsertUser({
      username: this.seed.suUsername,
      password: this.seed.suPassword,
      displayName: this.seed.suDisplayName,
      role: superadminRole,
    });
    return { created };
  }

  /**
   * Create one user only if absent. Existing accounts are left completely
   * untouched — password / role / display_name stay as the admin last set them
   * (legacy [FIX-20260729-SEEDPASS]: a re-run must never reset a live password).
   *
   * @returns 1 if a row was inserted, 0 if it already existed.
   */
  private async upsertUser(params: {
    username: string;
    password: string;
    displayName: string;
    role: RoleDocument;
  }): Promise<number> {
    const username = params.username.trim().toLowerCase();
    const existing = await this.userModel.findOne({ username }).exec();
    if (existing) return 0;

    await this.userModel.create({
      username,
      password_hash: hashPassword(params.password),
      display_name: params.displayName,
      role: params.role._id,
      active: true,
    });
    return 1;
  }
}

/** Per-collection insert/update counts from one `run()`. */
export interface AclSeedSummary {
  menusCreated: number;
  menusUpdated: number;
  rolesCreated: number;
  usersCreated: number;
}

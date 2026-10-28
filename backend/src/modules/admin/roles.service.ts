import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { escapeRegex } from '@/common/utils/escape-regex';
import { Menu } from '@/modules/content';

import type { CreateRoleDto, UpdateRoleDto } from './dto';
import { Role } from './schemas/role.schema';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(Menu.name) private readonly menuModel: Model<Menu>,
  ) {}

  public buildRole(
    role: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!role) return null;
    const menuAccess = Array.isArray(role['menu_access'])
      ? role['menu_access']
      : [];
    return {
      id: role['_id'],
      name: role['name'],
      description: role['description'] || '',
      permissions: role['permissions'] || [],
      menu_access: menuAccess.map(
        (menu: { _id?: unknown; label?: unknown; path?: unknown }) => ({
          id: menu._id,
          label: menu.label,
          path: menu.path,
        }),
      ),
      active: role['active'],
      created_at: role['created_at'],
      updated_at: role['updated_at'],
    };
  }

  private async resolveMenus(menuIds?: string[]): Promise<Types.ObjectId[]> {
    if (!Array.isArray(menuIds) || menuIds.length === 0) return [];
    const validIds = menuIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return [];
    const menus = await this.menuModel
      .find({ _id: { $in: validIds }, deleted_at: { $exists: false } })
      .exec();
    return menus.map((m) => m._id);
  }

  async listRoles(
    active?: boolean,
    name?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };
    if (active !== undefined) {
      filters['active'] = active;
    }
    if (name) {
      filters['name'] = new RegExp(escapeRegex(name), 'i');
    }
    const roles = await this.roleModel
      .find(filters)
      .populate('menu_access')
      .sort({ created_at: -1 })
      .lean()
      .exec();

    return roles.map((r) =>
      this.buildRole(r as unknown as Record<string, unknown>),
    ) as Array<Record<string, unknown>>;
  }

  /**
   * ⚠️ No `ObjectId.isValid` guard, deliberately — legacy has none either
   * (legacy-api/src/controllers/admin/roleController.js:54-66). A malformed id
   * must reach Mongoose so its own `CastError` surfaces; the controller's
   * `MongooseReadErrorInterceptor` then answers 500 with Mongoose's message,
   * matching legacy's catch at roleController.js:65. Adding a guard here would
   * turn that 500 into a 404 and hide WHICH field was rejected.
   */
  async getRoleById(id: string): Promise<Record<string, unknown>> {
    const role = await this.roleModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('menu_access')
      .lean()
      .exec();

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.buildRole(role as unknown as Record<string, unknown>) as Record<
      string,
      unknown
    >;
  }

  async createRole(dto: CreateRoleDto): Promise<Record<string, unknown>> {
    const existing = await this.roleModel
      .findOne({ name: dto.name, deleted_at: { $exists: false } })
      .exec();
    if (existing) {
      throw new ConflictException('Role already exists');
    }

    const menuAccess = await this.resolveMenus(dto.menu_access);
    const permissions = Array.isArray(dto.permissions)
      ? dto.permissions.map((p) => p && p.trim()).filter(Boolean)
      : [];

    const role = new this.roleModel({
      name: dto.name,
      description: dto.description || '',
      permissions,
      menu_access: menuAccess,
    });

    await role.save();

    const populated = await this.roleModel
      .findById(role._id)
      .populate('menu_access')
      .lean()
      .exec();

    return this.buildRole(
      populated as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
  }

  /**
   * ⚠️ No id guard — see `getRoleById`. Legacy's catch here is **400**, not 500
   * (roleController.js:132), so the controller mounts the 400-mapping
   * `MongooseErrorInterceptor` on this handler instead of the read one.
   */
  async updateRole(
    id: string,
    dto: UpdateRoleDto,
  ): Promise<Record<string, unknown>> {
    const role = await this.roleModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .exec();

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (dto.name) {
      role.name = dto.name;
    }
    if (typeof dto.description === 'string') {
      role.description = dto.description;
    }
    if (dto.active !== undefined) {
      role.active = Boolean(dto.active);
    }
    if (Array.isArray(dto.permissions)) {
      role.permissions = dto.permissions
        .map((p) => (p ? p.trim() : ''))
        .filter(Boolean);
    }
    if (dto.menu_access) {
      role.menu_access = await this.resolveMenus(dto.menu_access);
    }

    await role.save();

    const populated = await this.roleModel
      .findById(role._id)
      .populate('menu_access')
      .lean()
      .exec();

    return this.buildRole(
      populated as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
  }

  /**
   * ⚠️ No id guard — see `getRoleById`. Legacy's catch here is 500
   * (roleController.js:150), so this handler takes the read interceptor.
   */
  async deleteRole(id: string): Promise<void> {
    const role = await this.roleModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .exec();

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    role.active = false;
    role.deleted_at = new Date();
    await role.save();
  }
}

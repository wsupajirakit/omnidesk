import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { CreateMenuDto, UpdateMenuDto } from './dto';
import { Menu, type MenuDocument } from './schemas/menu.schema';

export interface SanitizedParentMenu {
  id: unknown;
  label: string;
  path: string;
}

export interface SanitizedMenu {
  id: unknown;
  label: string;
  path: string;
  parent_menu: SanitizedParentMenu | null;
  required_permissions: string[];
  order: number;
  visible: boolean;
  meta: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

@Injectable()
export class MenusService {
  constructor(
    @InjectModel(Menu.name)
    private readonly menuModel: Model<MenuDocument>,
  ) {}

  public sanitizeMenu(menu: MenuDocument | null): SanitizedMenu | null {
    if (!menu) return null;
    const raw = (menu.toObject ? menu.toObject() : menu) as unknown as Record<
      string,
      unknown
    >;
    const parentObj = raw['parent_menu'] as Record<string, unknown> | undefined;

    return {
      id: raw['_id'],
      label: (raw['label'] as string) || '',
      path: (raw['path'] as string) || '',
      parent_menu:
        parentObj && parentObj['_id']
          ? {
              id: parentObj['_id'],
              label: (parentObj['label'] as string) || '',
              path: (parentObj['path'] as string) || '',
            }
          : null,
      required_permissions: (raw['required_permissions'] as string[]) || [],
      order: (raw['order'] as number) ?? 0,
      visible: (raw['visible'] as boolean) ?? true,
      meta: (raw['meta'] as Record<string, unknown>) || {},
      created_at: raw['created_at'] as Date | undefined,
      updated_at: raw['updated_at'] as Date | undefined,
    };
  }

  private async validateParent(
    parentId?: string | null,
  ): Promise<MenuDocument | null> {
    if (!parentId) return null;
    if (!mongoose.isValidObjectId(parentId)) {
      throw new Error('Invalid parent menu id');
    }
    const parent = await this.menuModel.findOne({
      _id: parentId,
      deleted_at: { $exists: false },
    });
    if (!parent) {
      throw new Error('Parent menu not found');
    }
    return parent;
  }

  public async listMenus(): Promise<Array<SanitizedMenu | null>> {
    const menus = await this.menuModel
      .find({ deleted_at: { $exists: false } })
      .populate('parent_menu')
      .sort({ order: 1 });
    return menus.map((m) => this.sanitizeMenu(m));
  }

  public async getMenuById(id: string): Promise<SanitizedMenu> {
    const menu = await this.menuModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('parent_menu');
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }
    const sanitized = this.sanitizeMenu(menu);
    if (!sanitized) throw new NotFoundException('Menu not found');
    return sanitized;
  }

  public async createMenu(dto: CreateMenuDto): Promise<SanitizedMenu> {
    try {
      const parent = await this.validateParent(dto.parent_menu);
      const reqPerms = Array.isArray(dto.required_permissions)
        ? dto.required_permissions
            .map((perm) => (perm ? perm.trim() : ''))
            .filter(Boolean)
        : [];

      const menu = new this.menuModel({
        label: dto.label,
        path: dto.path,
        parent_menu: parent ? parent._id : undefined,
        required_permissions: reqPerms,
        order: typeof dto.order === 'number' ? dto.order : 0,
        visible: dto.visible !== undefined ? Boolean(dto.visible) : true,
        meta: dto.meta || {},
      });

      await menu.save();
      const populated = await this.menuModel
        .findById(menu._id)
        .populate('parent_menu');
      const sanitized = this.sanitizeMenu(populated);
      if (!sanitized) throw new NotFoundException('Menu build error');
      return sanitized;
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      if (err.code === 11000) {
        throw new ConflictException('Menu path already exists');
      }
      throw error;
    }
  }

  public async updateMenu(
    id: string,
    dto: UpdateMenuDto,
  ): Promise<SanitizedMenu> {
    const menu = await this.menuModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }

    if (dto.label) menu.label = dto.label;
    if (dto.path) menu.path = dto.path;
    if (dto.parent_menu !== undefined) {
      const parent = await this.validateParent(dto.parent_menu);
      menu.parent_menu = parent ? parent._id : undefined;
    }
    if (Array.isArray(dto.required_permissions)) {
      menu.required_permissions = dto.required_permissions
        .map((perm) => (perm ? perm.trim() : ''))
        .filter(Boolean);
    }
    if (typeof dto.order === 'number') menu.order = dto.order;
    if (dto.visible !== undefined) menu.visible = Boolean(dto.visible);
    if (dto.meta && typeof dto.meta === 'object') {
      menu.meta = { ...menu.meta, ...dto.meta };
    }

    await menu.save();
    const populated = await this.menuModel
      .findById(menu._id)
      .populate('parent_menu');
    const sanitized = this.sanitizeMenu(populated);
    if (!sanitized) throw new NotFoundException('Menu update error');
    return sanitized;
  }

  public async deleteMenu(id: string): Promise<void> {
    const menu = await this.menuModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }
    menu.visible = false;
    menu.deleted_at = new Date();
    await menu.save();
  }
}

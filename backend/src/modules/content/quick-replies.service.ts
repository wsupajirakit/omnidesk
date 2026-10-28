import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import type {
  CreateQuickReplyCategoryDto,
  CreateQuickReplyDto,
  UpdateQuickReplyCategoryDto,
  UpdateQuickReplyDto,
} from './dto';
import {
  QuickReplyCategory,
  type QuickReplyCategoryDocument,
} from './schemas/quick-reply-category.schema';
import {
  QuickReply,
  type QuickReplyDocument,
} from './schemas/quick-reply.schema';

/**
 * A failure in the shape this area actually answers: `{ success: false, error }`.
 *
 * Unlike the rest of the API — which uses the bare `{ error }` envelope — every
 * quick-reply route wraps BOTH outcomes in `success`, and the dashboard's quick
 * reply panel branches on that flag. Returning `{ error }` alone would leave it
 * reading `undefined` and treating a rejection as a success. `AllExceptionsFilter`
 * forwards a body carrying `success: false` untouched.
 */
const fail = (status: HttpStatus, error: string): HttpException =>
  new HttpException({ success: false, error }, status);

@Injectable()
export class QuickRepliesService {
  constructor(
    @InjectModel(QuickReplyCategory.name)
    private readonly categoryModel: Model<QuickReplyCategoryDocument>,
    @InjectModel(QuickReply.name)
    private readonly replyModel: Model<QuickReplyDocument>,
  ) {}

  private actorName(user?: AuthenticatedUser | null): string {
    return user?.displayName || user?.username || 'แอดมิน';
  }

  private toObjectId(id?: string | null): mongoose.Types.ObjectId | null {
    if (!id || !mongoose.isValidObjectId(id)) return null;
    return new mongoose.Types.ObjectId(id);
  }

  public async listQuickReplies(): Promise<{
    success: boolean;
    data: { categories: Array<Record<string, unknown>> };
  }> {
    const [cats, replies] = await Promise.all([
      this.categoryModel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find({ deleted_at: null } as any)
        .sort({ order: 1, created_at: 1 })
        .lean(),
      this.replyModel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find({ deleted_at: null } as any)
        .sort({ order: 1, created_at: 1 })
        .lean(),
    ]);

    const byCat = new Map<string, Record<string, unknown>>();
    for (const c of cats) {
      byCat.set(String(c._id), {
        ...(c as unknown as Record<string, unknown>),
        replies: [],
      });
    }

    for (const r of replies) {
      const bucket = byCat.get(String(r.category_id));
      if (bucket) {
        (bucket['replies'] as Array<Record<string, unknown>>).push(
          r as unknown as Record<string, unknown>,
        );
      }
    }

    return {
      success: true,
      data: { categories: Array.from(byCat.values()) },
    };
  }

  public async createCategory(
    user: AuthenticatedUser,
    dto: CreateQuickReplyCategoryDto,
  ): Promise<{ success: boolean; data: unknown }> {
    const name = (dto.name || '').trim();
    if (!name) {
      throw fail(HttpStatus.BAD_REQUEST, 'Category name is required');
    }
    const cat = await this.categoryModel.create({
      name,
      order: Number(dto.order) || 0,
      created_by: this.toObjectId(user.userId),
      created_by_name: this.actorName(user),
    });
    const obj = (cat as unknown as { toObject?: () => unknown }).toObject
      ? (cat as unknown as { toObject: () => unknown }).toObject()
      : cat;
    return { success: true, data: obj };
  }

  public async updateCategory(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateQuickReplyCategoryDto,
  ): Promise<{ success: boolean; data: unknown }> {
    if (!mongoose.isValidObjectId(id)) {
      throw fail(HttpStatus.BAD_REQUEST, 'Invalid id');
    }
    const cat = await this.categoryModel.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!cat) {
      throw fail(HttpStatus.NOT_FOUND, 'Category not found');
    }

    if (dto.name !== undefined) {
      cat.name = String(dto.name).trim();
    }
    if (dto.order !== undefined) {
      cat.order = Number(dto.order) || 0;
    }
    cat.updated_by = this.toObjectId(user.userId);
    cat.updated_by_name = this.actorName(user);
    await cat.save();

    const obj = (cat as unknown as { toObject?: () => unknown }).toObject
      ? (cat as unknown as { toObject: () => unknown }).toObject()
      : cat;
    return { success: true, data: obj };
  }

  public async deleteCategory(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ success: boolean; data: { _id: string } }> {
    if (!mongoose.isValidObjectId(id)) {
      throw fail(HttpStatus.BAD_REQUEST, 'Invalid id');
    }
    const cat = await this.categoryModel.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!cat) {
      throw fail(HttpStatus.NOT_FOUND, 'Category not found');
    }

    const now = new Date();
    const by = this.toObjectId(user.userId);
    const byName = this.actorName(user);

    cat.deleted_at = now;
    cat.deleted_by = by;
    cat.deleted_by_name = byName;
    await cat.save();

    await this.replyModel.updateMany(
      { category_id: id, deleted_at: null },
      { $set: { deleted_at: now, deleted_by: by, deleted_by_name: byName } },
    );

    return { success: true, data: { _id: id } };
  }

  public async createReply(
    user: AuthenticatedUser,
    dto: CreateQuickReplyDto,
  ): Promise<{ success: boolean; data: unknown }> {
    const text = (dto.text || '').trim();
    const categoryId = dto.category_id;
    if (!text) throw fail(HttpStatus.BAD_REQUEST, 'Text is required');
    if (!mongoose.isValidObjectId(categoryId)) {
      throw fail(HttpStatus.BAD_REQUEST, 'Valid category_id is required');
    }

    const cat = await this.categoryModel.findOne({
      _id: categoryId,
      deleted_at: null,
    });
    if (!cat) throw fail(HttpStatus.NOT_FOUND, 'Category not found');

    const reply = await this.replyModel.create({
      category_id: new mongoose.Types.ObjectId(categoryId),
      text,
      order: Number(dto.order) || 0,
      created_by: this.toObjectId(user.userId),
      created_by_name: this.actorName(user),
    });

    const obj = (reply as unknown as { toObject?: () => unknown }).toObject
      ? (reply as unknown as { toObject: () => unknown }).toObject()
      : reply;
    return { success: true, data: obj };
  }

  public async updateReply(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateQuickReplyDto,
  ): Promise<{ success: boolean; data: unknown }> {
    if (!mongoose.isValidObjectId(id)) {
      throw fail(HttpStatus.BAD_REQUEST, 'Invalid id');
    }
    const reply = await this.replyModel.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!reply) {
      throw fail(HttpStatus.NOT_FOUND, 'Reply not found');
    }

    if (dto.text !== undefined) {
      reply.text = String(dto.text).trim();
    }
    if (dto.order !== undefined) {
      reply.order = Number(dto.order) || 0;
    }
    if (
      dto.category_id !== undefined &&
      mongoose.isValidObjectId(dto.category_id)
    ) {
      reply.category_id = new mongoose.Types.ObjectId(dto.category_id);
    }

    reply.updated_by = this.toObjectId(user.userId);
    reply.updated_by_name = this.actorName(user);
    await reply.save();

    const obj = (reply as unknown as { toObject?: () => unknown }).toObject
      ? (reply as unknown as { toObject: () => unknown }).toObject()
      : reply;
    return { success: true, data: obj };
  }

  public async deleteReply(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ success: boolean; data: { _id: string } }> {
    if (!mongoose.isValidObjectId(id)) {
      throw fail(HttpStatus.BAD_REQUEST, 'Invalid id');
    }
    const reply = await this.replyModel.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!reply) {
      throw fail(HttpStatus.NOT_FOUND, 'Reply not found');
    }

    reply.deleted_at = new Date();
    reply.deleted_by = this.toObjectId(user.userId);
    reply.deleted_by_name = this.actorName(user);
    await reply.save();

    return { success: true, data: { _id: id } };
  }
}

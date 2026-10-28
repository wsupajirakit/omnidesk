import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
// [FEAT-20260817-ASSIGNDATERANGE] shared date policy (Bangkok days + 3-day cap)
import { resolveLogDateRange } from '@/common/utils/date-range';
import {
  AssignHistory,
  ChatRoom,
  type AssignHistoryDocument,
  type ChatRoomDocument,
} from '@/modules/chat';
import { Hook, type HookDocument } from '@/modules/hooks';

import type {
  CreateAssignHistoryDto,
  ListAssignHistoriesQueryDto,
  UpdateAssignHistoryDto,
} from './dto';

@Injectable()
export class AssignHistoriesService {
  constructor(
    @InjectModel(AssignHistory.name)
    private readonly assignHistoryModel: Model<AssignHistoryDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
  ) {}

  private formatAssignHistory(
    history: unknown,
  ): Record<string, unknown> | null {
    if (!history) return null;
    const doc = (
      typeof (history as { toObject?: () => Record<string, unknown> })
        .toObject === 'function'
        ? (history as { toObject: () => Record<string, unknown> }).toObject()
        : history
    ) as Record<string, unknown>;

    const { chat_room_id, assign_to, changed_by_id, ticket_id, ...rest } = doc;

    return {
      ...rest,
      chat_room_id:
        chat_room_id &&
        typeof chat_room_id === 'object' &&
        '_id' in chat_room_id
          ? chat_room_id._id
          : chat_room_id || null,
      chat_room_data:
        chat_room_id && typeof chat_room_id === 'object' ? chat_room_id : null,
      assign_to:
        assign_to && typeof assign_to === 'object' && '_id' in assign_to
          ? assign_to._id
          : assign_to || null,
      assign_to_data:
        assign_to && typeof assign_to === 'object' ? assign_to : null,
      changed_by_id:
        changed_by_id &&
        typeof changed_by_id === 'object' &&
        '_id' in changed_by_id
          ? changed_by_id._id
          : changed_by_id || null,
      changed_by_data:
        changed_by_id && typeof changed_by_id === 'object'
          ? changed_by_id
          : null,
      ticket_id:
        ticket_id && typeof ticket_id === 'object' && '_id' in ticket_id
          ? ticket_id._id
          : ticket_id || null,
      ticket_data:
        ticket_id && typeof ticket_id === 'object' ? ticket_id : null,
    };
  }

  /**
   * ⚠️ Every failure here is **500** with one fixed string — not the Mongoose
   * message, and not a 400. Legacy `createAssignHistory`
   * (legacy-api/src/controllers/chat/assignHistoryController.js:28-37) wraps
   * `new AssignHistory(req.body)` in
   * `catch { res.status(500).json({ success: false,
   *   error: "Failed to create assignment history" }) }`, logging the real
   * reason server-side and telling the caller nothing more. So a missing
   * `chat_room_id` (schema `required: true`) and a malformed one (CastError)
   * are indistinguishable to the client — deliberately, since this endpoint is
   * written by the ticket UI, not typed by a human.
   *
   * This is why `MongooseErrorInterceptor` is NOT mounted on this route: it
   * would surface the driver's text and a 400, which legacy never sends here.
   */
  public async createAssignHistory(
    // Widened from the DTO class: the controller now passes the raw body so an
    // undeclared key is DROPPED by Mongoose rather than rejected by the global
    // pipe, which is what legacy does (assign-histories.controller.ts write
    // routes explain why). `CreateAssignHistoryDto` still documents the shape.
    dto: CreateAssignHistoryDto | Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const history = await this.assignHistoryModel.create(dto);
      return { success: true, data: this.formatAssignHistory(history) };
    } catch {
      throw new InternalServerErrorException({
        success: false,
        error: 'Failed to create assignment history',
      });
    }
  }

  public async listAssignHistories(
    queryDto: ListAssignHistoriesQueryDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const {
      chat_room_id,
      assign_to,
      changed_by_id,
      ticket_id,
      action,
      from,
      to,
      page = '1',
      limit = '10',
    } = queryDto;

    const filter: Record<string, unknown> = {};

    if (!isSuperUser(auth)) {
      const userGroupIds = Array.isArray(auth?.groups) ? auth.groups : [];
      const allowedHooks = await this.hookModel
        .find({ group: { $in: userGroupIds } })
        .select('_id')
        .lean();
      const allowedHookIds = allowedHooks.map((h) => h._id);

      const allowedRooms = await this.chatRoomModel
        .find({ hook_id: { $in: allowedHookIds } })
        .select('_id')
        .lean();
      const allowedRoomIds = allowedRooms.map((r) => r._id);

      filter['chat_room_id'] = { $in: allowedRoomIds };

      if (chat_room_id && isValidObjectId(chat_room_id)) {
        const reqRoomId = new Types.ObjectId(chat_room_id);
        if (allowedRoomIds.some((id) => String(id) === String(reqRoomId))) {
          filter['chat_room_id'] = reqRoomId;
        } else {
          filter['chat_room_id'] = new Types.ObjectId();
        }
      }
    } else {
      if (chat_room_id && isValidObjectId(chat_room_id)) {
        filter['chat_room_id'] = new Types.ObjectId(chat_room_id);
      }
    }

    if (assign_to !== undefined) {
      if (assign_to === 'null' || assign_to === '') {
        filter['assign_to'] = null;
      } else if (isValidObjectId(assign_to)) {
        filter['assign_to'] = new Types.ObjectId(assign_to);
      }
    }
    if (changed_by_id && isValidObjectId(changed_by_id)) {
      filter['changed_by_id'] = new Types.ObjectId(changed_by_id);
    }
    if (ticket_id && isValidObjectId(ticket_id)) {
      filter['ticket_id'] = new Types.ObjectId(ticket_id);
    }
    if (action) {
      filter['action'] = action;
    }

    /**
     * [FEAT-20260817-ASSIGNDATERANGE] the same bounded window the log pages use.
     *
     * Owner, 17/08: "assign-history เพิ่ม filter วันที่ range ได้แค่สามวัน (default
     * วันนี้) เหมือน webhooklog". The policy — Bangkok calendar days and
     * MAX_RANGE_DAYS = 3 — lives in `resolveLogDateRange` and is enforced HERE,
     * not in the dashboard: a client cap can always be bypassed.
     *
     * Optional on purpose: a caller that sends neither bound gets the previous
     * unfiltered listing, so nothing that exists today breaks. The collection now
     * carries a `created_at` index for exactly this query (owner approved 17/08).
     * ไม่ส่ง = เหมือนเดิมทุกอย่าง.
     * revert: delete this block + `from`/`to` in the DTO and the FE control.
     */
    const range = resolveLogDateRange(from, to);
    if (range.filter) filter['created_at'] = range.filter;

    const total = await this.assignHistoryModel.countDocuments(filter);

    let query = this.assignHistoryModel
      .find(filter)
      .populate({
        path: 'chat_room_id',
        populate: { path: 'user_id' },
      })
      .populate('assign_to', 'username display_name email role')
      .populate('changed_by_id', 'username display_name email role')
      .populate({
        path: 'ticket_id',
        populate: { path: 'line_user_id' },
      })
      .sort({ created_at: -1 });

    if (limit !== 'all') {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      query = query.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const histories = await query.lean();
    const formatted = histories.map((h) => this.formatAssignHistory(h));

    const response: Record<string, unknown> = {
      success: true,
      data: formatted,
    };

    if (limit !== 'all') {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      response['pagination'] = {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      };
    } else {
      response['pagination'] = {
        total,
        page: 1,
        limit: 'all',
        pages: 1,
      };
    }

    return response;
  }

  public async getAssignHistoryById(
    id: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID');
    }

    const history = await this.assignHistoryModel
      .findById(id)
      .populate({
        path: 'chat_room_id',
        populate: { path: 'user_id' },
      })
      .populate('assign_to', 'username display_name email role')
      .populate('changed_by_id', 'username display_name email role')
      .populate({
        path: 'ticket_id',
        populate: { path: 'line_user_id' },
      })
      .lean();

    if (!history) {
      throw new NotFoundException('Assignment history not found');
    }

    return { success: true, data: this.formatAssignHistory(history) };
  }

  public async updateAssignHistory(
    id: string,
    // Widened for the same reason as createAssignHistory above.
    dto: UpdateAssignHistoryDto | Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID');
    }

    const history = await this.assignHistoryModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .populate({
        path: 'chat_room_id',
        populate: { path: 'user_id' },
      })
      .populate('assign_to', 'username display_name email role')
      .populate('changed_by_id', 'username display_name email role')
      .populate({
        path: 'ticket_id',
        populate: { path: 'line_user_id' },
      })
      .lean();

    if (!history) {
      throw new NotFoundException('Assignment history not found');
    }

    return { success: true, data: this.formatAssignHistory(history) };
  }

  public async deleteAssignHistory(
    id: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID');
    }

    const history = await this.assignHistoryModel.findByIdAndDelete(id);
    if (!history) {
      throw new NotFoundException('Assignment history not found');
    }

    return {
      success: true,
      message: 'Assignment history deleted successfully',
    };
  }
}

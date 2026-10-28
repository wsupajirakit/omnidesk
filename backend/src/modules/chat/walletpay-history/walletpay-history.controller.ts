/**
 * ==== [FEAT-20260816-WALLETPAYCARD] GET the WalletPay result feed for one member ====
 *
 * ROUTE  GET /api/chat/member/:lineUserId/walletpay-history?page=1&limit=10
 * GUARD  the panel's own permission (`ticket.manage`) — NOT `handoff.manage`,
 *        so support agents can read their own ticket's legs without being given
 *        the chain console (see the service header for the full argument).
 *
 * ⚠️ FAIL-SOFT IS THE POINT (owner: "อย่าให้พังเด็ดขาด stand alone"). Every
 * error — a bad id, a dead collection, an unexpected document shape — is
 * swallowed and answered as an EMPTY PAGE with HTTP 200. The WalletPay card is
 * decoration on a screen whose real job is the ticket; it must never be able to
 * turn a working panel into an error state. The failure is logged for us, and
 * the customer-facing flow does not know this endpoint exists.
 * การ์ดนี้พังได้ แต่ห้ามลากหน้า ticket พังไปด้วย.
 *
 * WHY IT LIVES HERE, not in `chat.controller.ts`: that file is already the
 * module's entry point for a dozen concerns; a self-contained feature gets its
 * own controller in its own folder so it can be deleted in one move.
 * revert: delete this folder + the two lines registering it in `chat.module.ts`.
 */
import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common';

import {
  WalletpayHistoryPage,
  WalletpayHistoryService,
} from './walletpay-history.service';

@ApiTags('chat')
@Controller('api/chat')
export class WalletpayHistoryController {
  private readonly logger = new Logger(WalletpayHistoryController.name);

  constructor(private readonly service: WalletpayHistoryService) {}

  @Get('member/:lineUserId/walletpay-history')
  @RequirePermissions('ticket.manage')
  @ApiOperation({
    summary:
      'WalletPay leg history for one member (read-only, masked, paginated)',
  })
  async list(
    @Param('lineUserId') lineUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<WalletpayHistoryPage> {
    try {
      return await this.service.list(
        String(lineUserId ?? ''),
        Number(page) || 1,
        Number(limit) || 10,
      );
    } catch (e) {
      // Never surface a 500 to the panel — an empty card is the safe answer.
      this.logger.error(
        `[WALLETPAYCARD] history failed for ${String(lineUserId)}: ${(e as Error).message}`,
      );
      return {
        rows: [],
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        total: 0,
        has_next: false,
      };
    }
  }
}

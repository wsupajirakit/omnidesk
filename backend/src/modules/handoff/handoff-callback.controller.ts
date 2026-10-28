import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  CurrentUser,
  Public,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { CallbackPublicGuard } from './callback-public.guard';
import {
  AttachCallbackDto,
  DismissCallbackDto,
  ListCallbacksQueryDto,
} from './dto';
import {
  HandoffCallbackService,
  type ListCallbacksResult,
} from './handoff-callback.service';
import { TargetErrorFilter } from './target-error.filter';

/** Express augments the request with the raw body when `rawBody` is enabled. */
type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * Inbound callbacks and the inbox that manages them. `{ error }` envelope.
 */
@ApiTags('handoff')
@Controller('api/handoff')
@UseFilters(TargetErrorFilter)
export class HandoffCallbackController {
  constructor(private readonly callbackService: HandoffCallbackService) {}

  /**
   * The raw bytes exactly as they arrived.
   *
   * The signature is computed over the bytes the sender signed, so the body
   * must never be re-serialised: `JSON.stringify(req.body)` reorders keys and
   * drops whitespace, which changes the digest and fails every valid callback.
   * `rawBody: true` is set in main.ts for this reason. The fallback exists only
   * so a missing raw body degrades to a signature mismatch rather than a crash.
   */
  private rawBodyOf(request: RawBodyRequest): Buffer {
    if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
    if (Buffer.isBuffer(request.body)) return request.body;
    return Buffer.alloc(0);
  }

  /**
   * PUBLIC — a target calls this back.
   *
   * `@Public()` mirrors the legacy skip-auth list (apiRoutes.js:127-128): no
   * bearer token is checked on this route, so the HMAC verified inside the
   * service is the ENTIRE security boundary. Do not add other logic before
   * that check, and do not relax it.
   *
   * The response is written through `@Res` because the status varies with the
   * verdict (400 malformed / 401 unauthorized / 404 unknown target / 429 /
   * 200) and the body pairs with it — the service returns both together.
   */
  @Public()
  @UseGuards(CallbackPublicGuard)
  @Post('callback/:target_key')
  @ApiOperation({ summary: 'Receive an inbound callback (public, HMAC-gated)' })
  async receive(
    @Param('target_key') targetKey: string,
    @Req() request: RawBodyRequest,
    @Res() response: Response,
  ): Promise<void> {
    const outcome = await this.callbackService.receive({
      targetKey,
      jobRefFromPath: '',
      rawBody: this.rawBodyOf(request),
      headers: request.headers,
      query: request.query,
      // The socket address, NOT the forwarded header: that one is spoofable,
      // and it is what the rate-limit quota is counted against.
      remoteIp: request.socket?.remoteAddress ?? '',
    });
    response.status(outcome.status).json(outcome.body);
  }

  /** Same endpoint, with the job reference carried in the path. */
  @Public()
  @UseGuards(CallbackPublicGuard)
  @Post('callback/:target_key/:job_ref')
  @ApiOperation({ summary: 'Receive an inbound callback for a known job' })
  async receiveForJob(
    @Param('target_key') targetKey: string,
    @Param('job_ref') jobRef: string,
    @Req() request: RawBodyRequest,
    @Res() response: Response,
  ): Promise<void> {
    const outcome = await this.callbackService.receive({
      targetKey,
      jobRefFromPath: String(jobRef ?? ''),
      rawBody: this.rawBodyOf(request),
      headers: request.headers,
      query: request.query,
      remoteIp: request.socket?.remoteAddress ?? '',
    });
    response.status(outcome.status).json(outcome.body);
  }

  /* ── inbox management ───────────────────────────────────────────────── */

  @Get('callbacks')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'List inbound callbacks' })
  async list(
    @Query() query: ListCallbacksQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListCallbacksResult> {
    return await this.callbackService.list(query, user);
  }

  @Post('callbacks/:id/attach')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Attach a callback to a job by hand' })
  async attach(
    @Param('id') id: string,
    @Body() body: AttachCallbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.callbackService.attach(id, body?.job_id ?? '', user);
  }

  @Post('callbacks/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Dismiss a callback' })
  async dismiss(
    @Param('id') id: string,
    @Body() body: DismissCallbackDto,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.callbackService.dismiss(id, body?.reason ?? '');
  }
}

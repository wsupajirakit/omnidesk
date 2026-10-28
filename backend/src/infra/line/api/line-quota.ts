import { Injectable } from '@nestjs/common';
import axios from 'axios';

import {
  LINE_CONSUMPTION_URL,
  LINE_INSIGHT_FOLLOWERS_URL,
  LINE_QUOTA_URL,
} from '../line-endpoints';
import { describeLineFailure, lineRequestIdOf } from '../push/line-push-error';

/**
 * ==== [FEAT-20260820-LINEPUSH25] quota reads — the GET side of infra/line ====
 *
 * Phase 2.5. Standalone and UNPLUGGED like the rest of this folder: the live
 * quota path (`GET /hook/:id/quota` → hooks.service.ts:805-867 `lineGet` +
 * `getHookQuota`, consumed by the dashboard's useHookQuota) keeps running its
 * own fetch until a Phase-3 migration deliberately swaps it.
 *
 * Deliberate differences from the live `lineGet`, stated up front:
 *  · axios instead of fetch — ONE http stack for the whole LINE layer
 *  · envelope result instead of throw — same never-throws contract as
 *    LinePushService.send(); the migrating caller converts to its own 500
 * Same semantics preserved: 5s budget (hooks.service.ts:122), payloads
 * returned UNFLATTENED, `remaining = max(limit-used, 0)` and `null` for the
 * unlimited `type:'none'` plan (hooks.service.ts:844-866).
 *
 * ⚠️ Token policy is the CALLER's: the live path takes `access_token` ONLY
 * (owner 15/08, hooks.service.ts:837-842). This layer takes a plain string
 * and must never learn where it came from. นโยบาย token อยู่ฝั่งผู้เรียกเสมอ.
 *
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

/** parity with hooks.service.ts:122 — the quota reads run a tight 5s budget. */
const QUOTA_TIMEOUT_MS = 5_000;

export interface LineApiReadResult {
  ok: boolean;
  /** HTTP status; 0 = transport failure or no call made. */
  status: number;
  lineRequestId?: string;
  data?: unknown;
  reason?: string;
}

export interface LineQuotaSummary {
  ok: boolean;
  status: number;
  /** LINE's `/quota` body, unflattened (e.g. {type:'limited', value:1000}). */
  quota?: unknown;
  /** LINE's `/quota/consumption` body, unflattened ({totalUsage:n}). */
  consumption?: unknown;
  /** limit - used, floored at 0; null when unlimited or on failure. */
  remaining: number | null;
  reason?: string;
}

@Injectable()
export class LineQuotaApi {
  async getMessageQuota(token: string): Promise<LineApiReadResult> {
    return this.getJson(LINE_QUOTA_URL, token);
  }

  async getQuotaConsumption(token: string): Promise<LineApiReadResult> {
    return this.getJson(LINE_CONSUMPTION_URL, token);
  }

  /**
   * [FEAT-20260917-INSIGHTFOLLOWERS] LINE follower insight proxy (GET /v2/bot/insight/followers?date=yyyyMMdd).
   * Returns followers, targetedReaches, blocks and status.
   */
  async getInsightFollowers(
    token: string,
    dateStr?: string,
  ): Promise<LineApiReadResult> {
    const url = dateStr
      ? `${LINE_INSIGHT_FOLLOWERS_URL}?date=${encodeURIComponent(dateStr)}`
      : LINE_INSIGHT_FOLLOWERS_URL;
    return this.getJson(url, token);
  }

  /** Both reads + the derived `remaining`, shaped like getHookQuota's answer. */
  async getQuotaSummary(token: string): Promise<LineQuotaSummary> {
    const [quota, consumption] = await Promise.all([
      this.getMessageQuota(token),
      this.getQuotaConsumption(token),
    ]);
    if (!quota.ok || !consumption.ok) {
      const failed = !quota.ok ? quota : consumption;
      return {
        ok: false,
        status: failed.status,
        reason: failed.reason,
        remaining: null,
      };
    }
    const limit = Number((quota.data as Record<string, unknown>)?.['value']);
    const used = Number(
      (consumption.data as Record<string, unknown>)?.['totalUsage'],
    );
    // `type:'none'` (unlimited) carries no `value` → NaN → null, never 0.
    const remaining =
      Number.isFinite(limit) && Number.isFinite(used)
        ? Math.max(limit - used, 0)
        : null;
    return {
      ok: true,
      status: 200,
      quota: quota.data,
      consumption: consumption.data,
      remaining,
    };
  }

  private async getJson(
    url: string,
    token: string,
  ): Promise<LineApiReadResult> {
    if (!token) {
      return {
        ok: false,
        status: 0,
        reason: 'missing channel access token — no call made',
      };
    }
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: QUOTA_TIMEOUT_MS,
      });
      return {
        ok: true,
        status: res.status,
        lineRequestId: lineRequestIdOf(
          res.headers as Record<string, string | undefined>,
        ),
        data: res.data,
      };
    } catch (err) {
      const failure = describeLineFailure(err);
      return {
        ok: false,
        status: failure.status,
        lineRequestId: failure.lineRequestId,
        reason: failure.reason,
        data: failure.data,
      };
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import axios, { type AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { Model, Types, isValidObjectId } from 'mongoose';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
import {
  providerFeatureOn,
  providerLogRedactPaths,
  providerPrefetchProfileFirst,
  redactForLog,
} from '@/modules/customer-provider';
// [FIX-20260905-GLOBALNS] the one copy of the environment-segment rule
import { RedisService, redisEnvNamespace } from '@/infra/redis';
// Leaf import, not the barrel — see the note in external.module.ts: ChatModule
// imports this module, so the barrel would close a boot-breaking cycle.
// eslint-disable-next-line no-restricted-imports
import { Member } from '@/modules/chat/schemas/member.schema';
import {
  CustomTool,
  CustomToolEndpoint,
  EndpointIdempotency,
  EndpointProfileMap,
  Hook,
} from '@/modules/hooks';
import { WebhookLogWriter } from '@/modules/system';

// [FEAT-20260814-SITERULESCACHE] Cache policy + fan-in guard for the site-rules
// endpoint. Same-module import (external/site-rules/), so no barrel is involved.
import { fetchInPrefetchOrder } from './utils/prefetch-order';
// [FEAT-20261016-CUSTCACHE] per-customer answer cache (loan: 12 h / 30 min / 12 h)
import { openCustomerCache } from './customer-cache/customer-cache.session';
import type { CustomerCacheMode } from './customer-cache/customer-cache.store';
import {
  CIRCUIT_OPEN_STATUS,
  customToolCircuitOpenMessage,
} from './utils/circuit-open';
import {
  isSiteRulesEndpoint,
  resolveCacheTtlSec,
  shouldUseCache,
} from './site-rules/site-rules-cache.policy';
import {
  runSingleFlight,
  type SingleFlightRedis,
} from './site-rules/site-rules-single-flight';

import { asText } from './utils/as-text';
import { checkHeaderToken } from './utils/header-safe-token';
import { type HmacConfig, buildSignatureHeaders } from './utils/hmac-signer';
import { isFetchOk, withStamp } from './utils/raw-data-stamp';
import { evaluateResult, mapResult, pickByPath } from './utils/result-rules';

const TOOL_CACHE_TTL_MS = 60 * 1000;
const CB_FAIL_THRESHOLD = 5;
const CB_FAIL_WINDOW_SEC = 60;
const CB_COOLDOWN_SEC = 30;
const LOGIN_FAIL_COOLDOWN_SEC = 60;

export interface CallResult {
  success: boolean;
  status: number;
  data: unknown;
  duration?: number;
  /**
   * The endpoint's configured verb, echoed back unchanged (`ep.method`, not the
   * upper-cased value actually sent). Legacy documents the return shape as
   * `{ success, data, status, duration, method, url }` and sets it at every
   * return site (customToolService.js:543); it was missing here, so
   * `POST /hook/:id/execute-external-endpoint` dropped the field the Dynamic
   * Tag preview renders.
   */
  method?: string;
  url?: string;
  error?: string;
  idempotent_retry?: number;
  idempotency_enabled?: boolean;
  outcome_unknown?: boolean;
  timed_out?: boolean;
  _cache?: string;
  _cached_at?: string;
}

/**
 * [FEAT-20260808-PAYTOOL-P2] One file to attach to a `form-data` request (the
 * walletpay slip image). Purely additive: no existing caller passes any, so the
 * multipart branch stays byte-identical until the payment runner supplies one.
 * revert: delete this interface + the `fileParts` plumbing in `_request`/`call`.
 */
export interface CustomToolFilePart {
  field: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
}

export interface ExtractedProfile {
  name: string;
  phone: string;
  code: string;
  ok: boolean;
}

export interface ExtractedTier {
  code: string;
  name: string;
  level: number | null;
  raw: unknown;
}

/**
 * A tool as it reaches the request path.
 *
 * `_id` is a real `ObjectId` for every stored tool, but `testConnection` also
 * previews a tool the admin has not saved yet and labels it `'draft'` — hence
 * the string arm. Everything downstream only ever stringifies it (redis keys,
 * the per-member token path), so both are safe.
 */
type ToolRef = CustomTool & { _id: Types.ObjectId | string };
/** a hook-level token held in memory (`[FIX-20261015-EMPTYUIDTOKEN]`) */
type HookLevelToken = Record<string, unknown>;

@Injectable()
export class CustomToolService {
  private readonly logger = new Logger(CustomToolService.name);

  /**
   * [FIX-20260905-GLOBALNS] `<env>.<db8>` — see `infra/redis/redis-namespace.ts`.
   *
   * ⚠️ THE OBJECT ID IS NOT AN ENVIRONMENT SEPARATOR. These keys lead with
   * `String(toolId)`, and that looked safe: ids are unique per database. It is
   * only true while the databases were populated independently. Staging here is
   * seeded from a production `mongodump`, and a restored document keeps its
   * `_id` byte for byte — so the same tool carries the same id on both sides and
   * `custool:cb:open:<id>:<endpoint>` becomes one key shared by two deployments,
   * on one Redis host with one `REDIS_DB`. dump มาก็ `_id` เดิม ⇒ ชนกันได้จริง
   */
  private readonly envNamespace: string;
  private readonly toolCache = new Map<
    string,
    { tool: ToolRef; expiresAt: number }
  >();

  constructor(
    @InjectModel(CustomTool.name)
    private readonly customToolModel: Model<CustomTool>,
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    @InjectModel(Member.name) private readonly memberModel: Model<Member>,
    /* [FEAT-20260827-WLOGONEDOOR] was `@InjectModel(WebhookLog)` — write-only
     * (the per-endpoint prefetch row), never read. ExternalModule already
     * imports SystemModule, which exports this door. */
    private readonly wlog: WebhookLogWriter,
    private readonly cryptoService: CryptoService,
    private readonly redisService: RedisService,
    // [FIX-20260905-GLOBALNS] the two halves of the environment segment
    @Inject(realtimeConfig.KEY)
    realtime: ConfigType<typeof realtimeConfig>,
    @Inject(mongoConfig.KEY)
    mongo: ConfigType<typeof mongoConfig>,
  ) {
    this.envNamespace = redisEnvNamespace(realtime.wsEnv, mongo.uri);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL CACHING & LOOKUP
  // ─────────────────────────────────────────────────────────────────────────

  async getTool(
    toolId: string | Types.ObjectId,
    opts: { skipCache?: boolean } = {},
  ): Promise<ToolRef | null> {
    if (!toolId) return null;
    const idStr = String(toolId);
    if (!opts.skipCache) {
      const hit = this.toolCache.get(idStr);
      if (hit && hit.expiresAt > Date.now()) return hit.tool;
    }
    if (!isValidObjectId(idStr)) return null;

    const tool = (await this.customToolModel
      .findById(idStr)
      .lean()
      .exec()) as ToolRef | null;
    if (!tool || tool.status === false) {
      this.toolCache.delete(idStr);
      return null;
    }
    this.toolCache.set(idStr, {
      tool,
      expiresAt: Date.now() + TOOL_CACHE_TTL_MS,
    });
    return tool;
  }

  async getToolForHook(
    hook: Partial<Hook> | null | undefined,
  ): Promise<ToolRef | null> {
    if (!hook || hook.custom_tool_status === false || !hook.custom_tool_id)
      return null;
    return this.getTool(hook.custom_tool_id);
  }

  invalidate(toolId: string | Types.ObjectId): void {
    if (toolId) this.toolCache.delete(String(toolId));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENDPOINT FINDERS
  // ─────────────────────────────────────────────────────────────────────────

  findEndpoint(tool: CustomTool, key: string): CustomToolEndpoint | null {
    if (!tool || !tool.endpoints || !key) return null;
    const target = String(key).toUpperCase();
    return (
      tool.endpoints.find(
        (e) => e.status !== false && String(e.key).toUpperCase() === target,
      ) || null
    );
  }

  findFlagged(
    tool: CustomTool,
    flag: 'is_login' | 'is_refresh' | 'is_profile',
  ): CustomToolEndpoint | null {
    if (!tool || !tool.endpoints) return null;
    return (
      tool.endpoints.find((e) => e.status !== false && e[flag] === true) || null
    );
  }

  findByRole(
    tool: CustomTool,
    role: string,
    fallbackKey: string | null = null,
  ): CustomToolEndpoint | null {
    if (!tool || !tool.endpoints) return null;
    if (role) {
      const ep = tool.endpoints.find(
        (e) => e.status !== false && e.role === role,
      );
      if (ep) return ep;
    }
    return fallbackKey ? this.findEndpoint(tool, fallbackKey) : null;
  }

  describeRoles(tool: CustomTool): Record<string, string> {
    if (!tool || !tool.endpoints) return {};
    const roles: Record<string, string> = {};
    for (const e of tool.endpoints) {
      if (e.status !== false && e.role) roles[e.role] = e.key;
    }
    return roles;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CIRCUIT BREAKER & LOGIN COOLDOWN (Redis-backed)
  // ─────────────────────────────────────────────────────────────────────────

  private async _cbIsOpen(
    toolId: Types.ObjectId | string,
    epKey: string,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const val = await client.get(
        `custool:${this.envNamespace}:cb:open:${String(toolId)}:${epKey}`,
      );
      return !!val;
    } catch {
      return false;
    }
  }

  private async _cbSuccess(
    toolId: Types.ObjectId | string,
    epKey: string,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const failKey = `custool:${this.envNamespace}:cb:fails:${String(toolId)}:${epKey}`;
      const openKey = `custool:${this.envNamespace}:cb:open:${String(toolId)}:${epKey}`;
      const wasOpen = await client.get(openKey);
      await client.del(failKey);
      await client.del(openKey);
      if (wasOpen) {
        this.logger.log(`[CUSTOM TOOL] [${epKey}] RECOVERED — circuit CLOSED.`);
      }
    } catch {
      // best-effort
    }
  }

  private async _cbFailure(
    toolId: Types.ObjectId | string,
    epKey: string,
    reason: string,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const failKey = `custool:${this.envNamespace}:cb:fails:${String(toolId)}:${epKey}`;
      const count = await client.incr(failKey);
      if (count === 1) await client.expire(failKey, CB_FAIL_WINDOW_SEC);
      this.logger.warn(
        `[CUSTOM TOOL] [${epKey}] failure ${count}/${CB_FAIL_THRESHOLD} (reason: ${reason})`,
      );
      if (count >= CB_FAIL_THRESHOLD) {
        await client.setex(
          `custool:${this.envNamespace}:cb:open:${String(toolId)}:${epKey}`,
          CB_COOLDOWN_SEC,
          String(Date.now()),
        );
        this.logger.error(
          `[CUSTOM TOOL] [${epKey}] TRIPPED — circuit OPEN for ${CB_COOLDOWN_SEC}s.`,
        );
      }
    } catch {
      // best-effort
    }
  }

  private _loginFailKey(
    toolId: Types.ObjectId | string,
    userId: string,
  ): string {
    return `custool:${this.envNamespace}:login:fail:${String(toolId)}:${userId || 'global'}`;
  }

  private async _isLoginCooldown(
    toolId: Types.ObjectId | string,
    userId: string,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const val = await client.get(this._loginFailKey(toolId, userId));
      return !!val;
    } catch {
      return false;
    }
  }

  private async _markLoginFail(
    toolId: Types.ObjectId | string,
    userId: string,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      await client.setex(
        this._loginFailKey(toolId, userId),
        LOGIN_FAIL_COOLDOWN_SEC,
        '1',
      );
    } catch {
      // best-effort
    }
  }

  private async _clearLoginFail(
    toolId: Types.ObjectId | string,
    userId: string,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      await client.del(this._loginFailKey(toolId, userId));
    } catch {
      // best-effort
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEMPLATE RESOLUTION & PICKING HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  _resolve(
    template: string | undefined | null,
    variables: Record<string, unknown> = {},
  ): string {
    if (!template) return '';
    let res = String(template);
    for (const [k, v] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${k}\\s*}}`, 'g');
      res = res.replace(regex, v == null ? '' : asText(v));
    }
    return res;
  }

  _renderPayload(
    payloadTpl: Record<string, unknown> | undefined | null,
    body: Record<string, unknown> = {},
    vars: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const combinedVars = { ...body, ...vars };
    const merged = { ...(payloadTpl || {}), ...body };
    const out: Record<string, unknown> = {};

    for (const [k, val] of Object.entries(merged)) {
      if (typeof val === 'string') {
        out[k] = this._resolve(val, combinedVars);
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        out[k] = this._renderPayload(
          val as Record<string, unknown>,
          {},
          combinedVars,
        );
      } else {
        out[k] = val;
      }
    }
    return out;
  }

  _pick(obj: unknown, path?: string | null): unknown {
    return pickByPath(obj, path);
  }

  _pickToken(
    data: unknown,
    tokenPath?: string | null,
    fallbackKey = 'access_token',
  ): string | null {
    if (!data) return null;
    if (tokenPath) {
      const picked = this._pick(data, tokenPath);
      if (picked && typeof picked === 'string') return picked;
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (typeof obj[fallbackKey] === 'string') return obj[fallbackKey];
      const nested = obj.data as Record<string, unknown> | undefined;
      if (nested && typeof nested[fallbackKey] === 'string')
        return nested[fallbackKey];
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOKEN PERSISTENCE ON MEMBER
  // ─────────────────────────────────────────────────────────────────────────

  /* [FIX-20261015-EMPTYUIDTOKEN] hook-level tokens (no member), per tool, for the life of
     the process. Created lazily so a service built without its constructor still works. */
  private hookLevelTokens?: Map<string, HookLevelToken>;
  private _hookLevelTokens(): Map<string, HookLevelToken> {
    return (this.hookLevelTokens ??= new Map<string, HookLevelToken>());
  }

  async _readTokenDoc(
    tool: ToolRef,
    userId: string,
  ): Promise<{
    access_token?: string;
    expires_at?: Date | string;
    refresh_token?: string;
  } | null> {
    /* [FIX-20261015-EMPTYUIDTOKEN] a hook-level call (no member) reads the in-process
       token — never a member row whose line_user_id is "" (EMPTYUIDFETCH stopped writing
       those; an old one could hold a stale token). */
    if (!userId) return this._hookLevelTokens().get(String(tool._id)) ?? null;
    const member = await this.memberModel
      .findOne({ line_user_id: userId })
      .lean()
      .exec();
    const meta = member?.meta;
    const tokens = meta?.custom_tool_tokens as
      | Record<
          string,
          {
            access_token?: string;
            expires_at?: Date | string;
            refresh_token?: string;
          }
        >
      | undefined;
    return tokens?.[String(tool._id)] || null;
  }

  /**
   * Token lifetime is not configuration — it is whatever the upstream said in
   * its login response (`data.expires_in`, else `expires_in`, in seconds),
   * falling back to an hour. Legacy customToolService.js:426-427.
   *
   * There is deliberately no stored `token_ttl` field: a hardcoded TTL that
   * disagrees with the upstream's real expiry either wastes a valid token or
   * keeps using a dead one until the first 401.
   */
  private _expiresInSec(data: unknown): number {
    return (
      Number(
        this._pick(data, 'data.expires_in') ||
          (data as Record<string, unknown> | null)?.expires_in,
      ) || 3600
    );
  }

  async _writeToken(
    tool: ToolRef,
    userId: string,
    tokenData: Record<string, unknown>,
  ): Promise<void> {
    /* [FIX-20261014-EMPTYUIDFETCH] the upsert below would CREATE a member whose
       line_user_id is "" — a row any empty-id lookup then matches.
       [FIX-20261015-EMPTYUIDTOKEN] so a hook-level token is kept in the process instead,
       keyed by tool, and reused until it expires — the same reuse the "" row gave before,
       without the row (otherwise every Refresh / broadcast logged in again).
       revert: delete these lines (and the matching line in `_readTokenDoc`). */
    if (!userId) {
      this._hookLevelTokens().set(String(tool._id), {
        ...tokenData,
        updated_at: new Date(),
      });
      return;
    }
    const field = `meta.custom_tool_tokens.${String(tool._id)}`;
    await this.memberModel
      .updateOne(
        { line_user_id: userId },
        { $set: { [field]: { ...tokenData, updated_at: new Date() } } },
        { upsert: true },
      )
      .exec();
  }

  async getToken(tool: ToolRef, userId: string): Promise<string | null> {
    if (!tool || tool.auth_type === 'none') return null;
    // api_key / basic / hmac_signature never log in — their header is assembled
    // at request time from credentials already on the tool (legacy
    // customToolService.js:458 `if (tool.auth_type !== "jwt_login") return null`).
    if (tool.auth_type !== 'jwt_login') return null;

    const doc = await this._readTokenDoc(tool, userId);
    if (doc && doc.access_token) {
      if (!doc.expires_at || new Date(doc.expires_at) > new Date()) {
        const safe = checkHeaderToken(doc.access_token);
        if (safe.ok) return safe.value!;
      }
      if (doc.refresh_token) {
        const refreshed = await this.refresh(tool, userId);
        if (refreshed) return refreshed;
      }
    }
    return this.login(tool, userId);
  }

  async login(tool: ToolRef, userId: string): Promise<string | null> {
    if (await this._isLoginCooldown(tool._id, userId)) {
      this.logger.warn(
        `[CUSTOM TOOL] login skipped — cooldown active (${LOGIN_FAIL_COOLDOWN_SEC}s).`,
      );
      return null;
    }

    const ep = this.findFlagged(tool, 'is_login');
    if (!ep) {
      this.logger.warn(
        `[CUSTOM TOOL] tool "${tool.name}" set to jwt_login but no endpoint is flagged is_login.`,
      );
      return null;
    }

    const username =
      (this.cryptoService.safeDecrypt(tool.username) as string) || '';
    const password =
      (this.cryptoService.safeDecrypt(tool.password) as string) || '';
    const body = this._renderPayload(
      ep.payload,
      {},
      { username, password, line_user_id: userId },
    );

    const res = await this._request(
      tool,
      ep,
      userId,
      body,
      null,
      {},
      { isAuthCall: true },
    );

    const token = this._pickToken(res.data, ep.token_path, 'access_token');
    const refresh_token =
      this._pickToken(res.data, ep.refresh_token_path, 'refresh_token') ||
      undefined;

    if (res.success && token) {
      const safe = checkHeaderToken(token);
      if (!safe.ok) {
        this.logger.error(
          `[CUSTOM TOOL] login success but token invalid: ${safe.message}`,
        );
        await this._markLoginFail(tool._id, userId);
        return null;
      }

      const expires_at = new Date(
        Date.now() + this._expiresInSec(res.data) * 1000,
      );
      await this._writeToken(tool, userId, {
        access_token: safe.value,
        refresh_token,
        expires_at,
      });
      await this._clearLoginFail(tool._id, userId);
      return safe.value!;
    }

    this.logger.warn(
      `[CUSTOM TOOL] login failed for tool "${tool.name}" user ${userId}: ${res.error || 'no token'}`,
    );
    await this._markLoginFail(tool._id, userId);
    return null;
  }

  async refresh(tool: ToolRef, userId: string): Promise<string | null> {
    const ep = this.findFlagged(tool, 'is_refresh');
    if (!ep) return this.login(tool, userId);

    const doc = await this._readTokenDoc(tool, userId);
    if (!doc || !doc.refresh_token) return this.login(tool, userId);

    const body = this._renderPayload(
      ep.payload,
      {},
      { refresh_token: doc.refresh_token, line_user_id: userId },
    );
    const res = await this._request(
      tool,
      ep,
      userId,
      body,
      null,
      {},
      { isAuthCall: true },
    );

    const token = this._pickToken(res.data, ep.token_path, 'access_token');
    const newRefresh =
      this._pickToken(res.data, ep.refresh_token_path, 'refresh_token') ||
      doc.refresh_token;

    if (res.success && token) {
      const safe = checkHeaderToken(token);
      if (!safe.ok) return this.login(tool, userId);

      const expires_at = new Date(
        Date.now() + this._expiresInSec(res.data) * 1000,
      );
      await this._writeToken(tool, userId, {
        access_token: safe.value,
        refresh_token: newRefresh,
        expires_at,
      });
      return safe.value!;
    }

    return this.login(tool, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CORE REQUEST EXECUTOR
  // ─────────────────────────────────────────────────────────────────────────

  async _request(
    tool: ToolRef,
    ep: CustomToolEndpoint,
    userId: string,
    body: Record<string, unknown> = {},
    overrideToken: string | null = null,
    extraHeaders: Record<string, string> = {},
    opts: {
      isAuthCall?: boolean;
      idempotencyKey?: string;
      // [FEAT-20260808-PAYTOOL-P2] optional file attachments for a form-data leg.
      fileParts?: CustomToolFilePart[];
    } = {},
  ): Promise<CallResult> {
    const startTime = Date.now();

    if (!opts.isAuthCall && (await this._cbIsOpen(tool._id, ep.key))) {
      return {
        success: false,
        status: CIRCUIT_OPEN_STATUS,
        data: { message: customToolCircuitOpenMessage(ep.key) },
        duration: 0,
        method: ep.method,
        url: '',
        error: 'circuit_open',
      };
    }

    const method = String(ep.method || 'POST').toUpperCase();

    const vars: Record<string, unknown> = {
      line_user_id: userId,
      userId,
      lineuserid: userId,
      channel_user_id: userId,
    };

    // `web_code` is deliberately NOT seeded here. Legacy `_resolve`
    // (customToolService.js:275-289) only iterates the keys that actually EXIST
    // in its variable bag, so a placeholder whose key is absent is never visited
    // and survives into the URL LITERALLY. Seeding `web_code: body.web_code || ''`
    // made an absent value render as an empty string instead, which is a
    // different URL from legacy's on the test-fire route — that route passes an
    // empty body (testConnection, customToolService.js:1523), so legacy emits
    // `?web_code={{web_code}}` and this emitted `?web_code=`.
    // Legacy is the spec even where it looks wrong. `web_code` still reaches the
    // path at runtime through the `...body` spread below, because
    // getCombinedData puts it in the body from `hook.customer_link_web_code`.
    //
    // Legacy resolves the path against vars AND body (customToolService.js:581),
    // not vars alone; that is what lets the runtime `web_code` land in the path.
    const pathResolved = this._resolve(ep.path, { ...vars, ...body });

    const baseUrl = (tool.base_url || '').replace(/\/+$/, '');
    const cleanPath = pathResolved.replace(/^\/+/, '');
    const url = `${baseUrl}/${cleanPath}`;

    let headers: Record<string, string> = { ...extraHeaders };

    // Branch order and the `ep.require_jwt` gate on every arm mirror legacy
    // customToolService.js:630-666. `auth_type: 'bearer'` does not exist —
    // neither in the schema enum nor in any of the 35 stored tools.
    const jwt = ep.require_jwt
      ? overrideToken || (await this.getToken(tool, userId))
      : null;

    if (ep.require_jwt && jwt) {
      const safe = checkHeaderToken(jwt);
      if (!safe.ok) {
        return {
          success: false,
          status: 0,
          data: { message: safe.message },
          error: safe.message,
          method: ep.method,
          url,
        };
      }
      headers['Authorization'] = `Bearer ${safe.value}`;
    } else if (tool.auth_type === 'api_key' && ep.require_jwt) {
      const k = (this.cryptoService.safeDecrypt(tool.api_key) as string) || '';
      if (k) headers[tool.api_key_header || 'Authorization'] = k;
    } else if (tool.auth_type === 'basic' && ep.require_jwt) {
      const p = (this.cryptoService.safeDecrypt(tool.password) as string) || '';
      const b64 = Buffer.from(`${tool.username}:${p}`).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    }

    // One `field` serves as both header name and body field; `location` picks
    // which. Legacy customToolService.js:623-626 / 711-712.
    const idem: Partial<EndpointIdempotency> = ep.idempotency || {};
    const idemKey = idem.enabled === true ? opts.idempotencyKey || '' : '';
    if (idemKey && (idem.location || 'header') === 'header') {
      headers[idem.field || 'Idempotency-Key'] = idemKey;
    }

    let reqData: unknown = undefined;

    if (method === 'GET') {
      // Legacy builds the GET query from the CALL BODY ONLY — not from a
      // rendered `ep.payload` (customToolService.js:585-594). Two rules there
      // that `_renderPayload` does not reproduce:
      //   1. a key whose placeholder already appears in `ep.path` is SKIPPED,
      //      so it is not sent twice (once substituted in the path, once as a
      //      query param). Without this, a runtime CUSTOMER_PROFILE call would
      //      emit `web_code` twice.
      //   2. empty/null/undefined values are dropped.
      // `payloadVars` is still built below for the HMAC signer, which reads the
      // same bag legacy hands it.
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || v === null || v === '') continue;
        if (String(ep.path || '').includes(`{{${k}}}`)) continue;
        params.append(k, asText(v));
      }
      const payloadVars = this._renderPayload(ep.payload, body, vars);
      const queryString = params.toString();
      // Legacy joins with `&` when the resolved path ALREADY carries a query
      // string (customToolService.js:593: `path.includes("?") ? "&" : "?"`).
      // Hardcoding `?` produced a second `?` — e.g. SITE_RULES came out as
      // `...site-rules?web_code=demo-omnidesk?line_user_id=...`, so every param
      // after the first became part of the previous value at the destination.
      const finalUrl = queryString
        ? `${url}${url.includes('?') ? '&' : '?'}${queryString}`
        : url;

      if (tool.auth_type === 'hmac_signature' && ep.require_jwt) {
        headers = {
          ...headers,
          ...this._signHeaders(tool, ep, {
            body: undefined,
            contentType: '',
            method: 'GET',
            path: `/${cleanPath}`,
            url: finalUrl,
            payloadVars,
            callBody: body,
            vars,
          }),
        };
      }

      return this._executeHttp(
        finalUrl,
        { method: 'GET', headers, timeout: Number(tool.timeout_ms) || 8000 },
        tool,
        ep,
        startTime,
        opts,
      );
    }

    const payloadVars = this._renderPayload(ep.payload, body, vars);
    // Injected after templating so the template cannot overwrite the key.
    if (idemKey && idem.location === 'body') {
      payloadVars[idem.field || 'Idempotency-Key'] = idemKey;
    }

    const reqType = (ep.request_type || 'json').toLowerCase();

    if (reqType === 'form-data') {
      const form = new FormData();
      for (const [k, v] of Object.entries(payloadVars)) {
        if (v !== undefined && v !== null) form.append(k, asText(v));
      }
      // [FEAT-20260808-PAYTOOL-P2] additive: attach file parts (the walletpay slip
      // image) when the caller supplies them. No caller passes `fileParts` today,
      // so every generic form-data tool is byte-identical. Mirrors legacy
      // multipart_slip.js:63 (`form.append(field, buffer, {filename, contentType})`).
      // revert: drop this loop.
      for (const fp of opts.fileParts || []) {
        if (fp && fp.field && fp.buffer) {
          form.append(fp.field, fp.buffer, {
            filename: fp.filename || 'file',
            contentType: fp.contentType || 'application/octet-stream',
          });
        }
      }
      reqData = form;
      headers = {
        ...headers,
        ...(form.getHeaders() as Record<string, string>),
      };
    } else if (reqType === 'form' || reqType === 'urlencoded') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(payloadVars)) {
        if (v !== undefined && v !== null) params.append(k, asText(v));
      }
      reqData = params.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      reqData = JSON.stringify(payloadVars);
      headers['Content-Type'] = 'application/json';
    }

    if (tool.auth_type === 'hmac_signature' && ep.require_jwt) {
      headers = {
        ...headers,
        ...this._signHeaders(tool, ep, {
          body: reqData,
          contentType: headers['Content-Type'] || headers['content-type'] || '',
          method,
          path: `/${cleanPath}`,
          url,
          payloadVars,
          callBody: body,
          vars,
        }),
      };
    }

    return this._executeHttp(
      url,
      {
        method,
        headers,
        data: reqData,
        timeout: Number(tool.timeout_ms) || 8000,
      },
      tool,
      ep,
      startTime,
      opts,
    );
  }

  /**
   * Build the HMAC signature headers for one request.
   *
   * Two things here are easy to get wrong and were both wrong in the port:
   *
   * 1. The secret is `tool.api_key`, not a field of its own. HMAC tools reuse
   *    that column deliberately — it is already encrypted at rest and already
   *    carries the "blank means unchanged" edit convention (legacy
   *    customToolService.js:777).
   * 2. `tool.hmac` holds the *formula*, and mongoose materialises every unset
   *    key as `''`/`null`. Those must be dropped before they reach the signer,
   *    or an empty string overwrites the signer's default and every signature
   *    comes out wrong (legacy customToolService.js:756-759).
   *
   * Signing failure is never fatal: the request still goes out and the upstream
   * answers 401, which the normal error path already handles.
   */
  private _signHeaders(
    tool: ToolRef,
    ep: CustomToolEndpoint,
    ctx: {
      body: unknown;
      contentType: string;
      method: string;
      path: string;
      url: string;
      payloadVars: Record<string, unknown>;
      callBody: Record<string, unknown>;
      vars: Record<string, unknown>;
    },
  ): Record<string, string> {
    try {
      const cfg: HmacConfig = {};
      for (const [k, v] of Object.entries(
        (tool.hmac || {}) as Record<string, unknown>,
      )) {
        if (v === '' || v === null || v === undefined) continue;
        (cfg as Record<string, unknown>)[k] = v;
      }

      const wcField = cfg.web_code_field || 'web_code';
      const webCode = asText(
        ctx.payloadVars[wcField] ??
          ctx.callBody[wcField] ??
          ctx.vars[wcField] ??
          '',
      );

      const secret =
        (this.cryptoService.safeDecrypt(tool.api_key) as string) || '';
      if (!secret) {
        this.logger.error(
          `[CUSTOM TOOL] [${ep.key}] auth_type is hmac_signature but tool "${tool.name}" has no api_key (secret) set.`,
        );
      }

      const signed = buildSignatureHeaders({
        secret,
        webCode,
        body: ctx.body,
        contentType: ctx.contentType,
        method: ctx.method,
        path: ctx.path,
        url: ctx.url,
        config: cfg,
      });
      // Never log the signature or the secret — only which web_code was signed.
      this.logger.log(
        `[CUSTOM TOOL] [${ep.key}] signed (hmac) web_code=${webCode || '(empty)'} ts=${signed.timestamp}`,
      );
      return signed.headers;
    } catch (e: unknown) {
      this.logger.error(
        `[CUSTOM TOOL] [${ep.key}] hmac sign error: ${(e as Error).message}`,
      );
      return {};
    }
  }

  private async _executeHttp(
    url: string,
    axiosOpts: AxiosRequestConfig,
    tool: ToolRef,
    ep: CustomToolEndpoint,
    startTime: number,
    opts: { isAuthCall?: boolean } = {},
  ): Promise<CallResult> {
    try {
      const res = await axios<unknown>({ url, ...axiosOpts });
      const duration = Date.now() - startTime;
      if (!opts.isAuthCall) this._cbSuccess(tool._id, ep.key).catch(() => {});

      const verdict = evaluateResult(ep.result_rules, res.data, res.status);
      const mapped = mapResult(ep.result_map, res.data);

      if (verdict) {
        return {
          success: verdict.ok,
          status: res.status,
          data: mapped ? { ...mapped, _raw: res.data } : res.data,
          duration,
          method: ep.method,
          url,
          error: verdict.ok ? undefined : verdict.error_code,
        };
      }

      return {
        success: res.status >= 200 && res.status < 300,
        status: res.status,
        data: res.data,
        duration,
        method: ep.method,
        url,
      };
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const axiosErr = err as {
        message: string;
        code?: string;
        response?: { status?: number; data?: unknown };
      };

      const status = axiosErr.response?.status || 0;
      const isTimeout =
        axiosErr.code === 'ECONNABORTED' ||
        /timeout/i.test(axiosErr.message || '');
      const isServerErr = status >= 500;
      const isNetwork = !axiosErr.response;

      if (!opts.isAuthCall && (isTimeout || isServerErr || isNetwork)) {
        const reason = isTimeout
          ? 'timeout'
          : isServerErr
            ? `http_${status}`
            : 'network';
        this._cbFailure(tool._id, ep.key, reason).catch(() => {});
      }

      const body = axiosErr.response?.data;
      const verdict = evaluateResult(ep.result_rules, body, status);

      const outcome_unknown = isTimeout || isNetwork;

      if (verdict) {
        return {
          success: verdict.ok,
          status,
          data: body || { message: axiosErr.message },
          duration,
          method: ep.method,
          url,
          error: verdict.error_code,
          outcome_unknown,
          timed_out: isTimeout,
        };
      }

      return {
        success: false,
        status,
        data: body || { message: axiosErr.message },
        duration,
        method: ep.method,
        url,
        error: axiosErr.message,
        outcome_unknown,
        timed_out: isTimeout,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CALL METHODS
  // ─────────────────────────────────────────────────────────────────────────

  async call(
    tool: ToolRef | null,
    key: string,
    userId: string,
    body: Record<string, unknown> = {},
    opts: {
      role?: string;
      idempotencyKey?: string;
      // [FEAT-20260808-PAYTOOL-P2] forwarded to `_request` for a form-data leg.
      fileParts?: CustomToolFilePart[];
      // [FEAT-20260808-PAYTOOL-P2] extra request headers merged in as-is (the
      // payment runner's Shop-API validate-slip signature). Additive: existing
      // callers pass none ⇒ `_request`'s `extraHeaders` stays `{}` ⇒ byte-identical.
      extraHeaders?: Record<string, string>;
      // [FEAT-20260808-PAYTOOL-P2D] MONEY-LEG guard: bar the idempotency
      // auto-retry for this call. A payment leg (topup/walletpay) must never blindly
      // re-POST on a timeout — the retry path drops the per-request X-Signature
      // (and the ~5-min timestamp would be stale anyway), so a retried money leg
      // would 401, and worse could double-move money if it ever succeeded. The
      // runner classifies a timeout as REVIEW instead. Existing generic callers
      // pass nothing ⇒ retry behaviour is byte-identical. revert: drop this opt.
      disableRetry?: boolean;
    } = {},
  ): Promise<CallResult> {
    if (!tool) {
      return {
        success: false,
        error: 'no_tool',
        status: 0,
        data: { message: 'ยังไม่ได้ผูก custom tool' },
      };
    }

    const ep = opts.role
      ? this.findByRole(tool, opts.role, key)
      : this.findEndpoint(tool, key);
    if (!ep) {
      const what = opts.role
        ? `role "${opts.role}" (หรือ key "${key}")`
        : `endpoint key "${key}"`;
      return {
        success: false,
        error: `unknown_endpoint: ${opts.role || key}`,
        status: 0,
        data: { message: `tool "${tool.name}" ไม่มี ${what} (หรือถูกปิดอยู่)` },
      };
    }

    const token = ep.require_jwt ? await this.getToken(tool, userId) : null;

    const idem: Partial<EndpointIdempotency> = ep.idempotency || {};
    const canRetry =
      opts.disableRetry !== true && // [PAYTOOL-P2D] money legs never auto-retry
      idem.enabled === true &&
      !!opts.idempotencyKey &&
      Number(idem.retry_on_timeout) > 0;
    const maxRetry = canRetry
      ? Math.min(Number(idem.retry_on_timeout) || 0, 3)
      : 0;

    let res = await this._request(
      tool,
      ep,
      userId,
      body,
      token,
      opts.extraHeaders || {},
      opts,
    );
    for (
      let attempt = 1;
      attempt <= maxRetry && res?.outcome_unknown;
      attempt++
    ) {
      this.logger.warn(
        `[CUSTOM TOOL] [${ep.key}] outcome unknown (${res.timed_out ? 'timeout' : 'network'}) — retry ${attempt}/${maxRetry}`,
      );
      res = await this._request(tool, ep, userId, body, token, {}, opts);
      if (res) res.idempotent_retry = attempt;
    }
    if (res) res.idempotency_enabled = idem.enabled === true;
    return res;
  }

  async callByHook(
    hook: Hook | null | undefined,
    key: string,
    userId: string,
    body: Record<string, unknown> = {},
  ): Promise<CallResult> {
    const tool = await this.getToolForHook(hook);
    return this.call(tool, key, userId, body);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROLE PICKING & CACHING
  // ─────────────────────────────────────────────────────────────────────────

  pickByRole(
    combined:
      | Record<string, { role?: string; [key: string]: unknown }>
      | null
      | undefined,
    role: string,
    fallbackKeyRe: RegExp | null = null,
  ): { key: string; block: { role?: string; [key: string]: unknown } } | null {
    if (!combined || typeof combined !== 'object' || !role) return null;
    for (const [key, block] of Object.entries(combined)) {
      if (block && block.role === role) return { key, block };
    }
    if (fallbackKeyRe) {
      for (const [key, block] of Object.entries(combined)) {
        if (fallbackKeyRe.test(key)) return { key, block };
      }
    }
    return null;
  }

  _sharedCacheKey(
    toolId: Types.ObjectId | string,
    epKey: string,
    webCode?: string,
  ): string {
    /* [FIX-20260905-GLOBALNS] Namespaced like the breaker keys above, and for
       the same reason: `toolId` is a Mongo `_id`, and staging here is seeded
       from a production `mongodump`, so a restored tool carries the SAME id on
       both deployments. This is a 30-minute cache of an upstream response —
       a collision serves one environment's partner data to the other. */
    return `custool:${this.envNamespace}:shared:${String(toolId)}:${String(epKey).toUpperCase()}:${webCode || '-'}`;
  }

  async _fetchWithCache(
    tool: ToolRef,
    ep: CustomToolEndpoint,
    userId: string,
    body: Record<string, unknown>,
    token: string | null,
  ): Promise<CallResult> {
    /* [FEAT-20260814-SITERULESCACHE] TTL now comes from the policy, not straight
       off the row. For every endpoint that already carried a positive
       `cache_ttl_sec` this returns the identical number, so behaviour is
       unchanged; a site-rules endpoint with none gets the 30-minute fallback.
       ⚠️ This line matters beyond the read gate: `setex` below is called with
          it, and `setex(key, 0, …)` is an error in Redis. Leaving the old
          `Number(...) || 0` here while opening the gate elsewhere would throw on
          the write path. ต้องแก้ตรงนี้ด้วย ไม่งั้น setex พัง */
    const ttl = resolveCacheTtlSec(ep);
    const webCode = (body || {}).web_code as string | undefined;
    const cacheKey = this._sharedCacheKey(tool._id, ep.key, webCode);

    try {
      const r = this.redisService.getClient();
      if (r) {
        const hit = await r.get(cacheKey);
        if (hit) {
          const parsed = JSON.parse(hit) as {
            cached_at: string;
            result: CallResult;
          };
          this.logger.log(`[CUSTOM TOOL] [${ep.key}] cache HIT (ttl=${ttl}s)`);
          return {
            ...parsed.result,
            _cache: 'hit',
            _cached_at: parsed.cached_at,
          };
        }
      }
    } catch (e: unknown) {
      this.logger.warn(
        `[CUSTOM TOOL] [${ep.key}] cache read error: ${(e as Error).message}`,
      );
    }

    /* [FEAT-20260814-SITERULESCACHE] Cache-miss fan-in. When a 30-minute entry
       expires, every member messaging in that moment would otherwise fire its
       own upstream call. `runSingleFlight` lets the first caller fetch and the
       rest reuse its result — same rule for members and admins alike.
       ⚠️ Fail-open by construction: no Redis, an unavailable lock, or a leader
          that never writes all fall through to `_request` exactly as before, so
          this can only ever cost the extra call it was trying to avoid — never
          an error or a hang. See the file header of site-rules-single-flight.ts.
       revert: replace this block with the bare `await this._request(...)`. */
    const readCachedResult = async (): Promise<CallResult | null> => {
      try {
        const r = this.redisService.getClient();
        if (!r) return null;
        const raw = await r.get(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          cached_at: string;
          result: CallResult;
        };
        return {
          ...parsed.result,
          _cache: 'hit',
          _cached_at: parsed.cached_at,
        };
      } catch {
        return null; // unreadable cache ⇒ let the caller fetch
      }
    };

    let lockRedis: SingleFlightRedis | null = null;
    try {
      lockRedis = this.redisService.getClient();
    } catch {
      lockRedis = null; // Redis unavailable ⇒ plain fetch, today's behaviour
    }

    const result = await runSingleFlight<CallResult>({
      redis: lockRedis,
      cacheKey,
      readCache: readCachedResult,
      fetchFn: () => this._request(tool, ep, userId, body, token),
      logger: this.logger,
    });

    // A follower that reused the leader's cached value must not rewrite it.
    if (result?._cache === 'hit') return result;

    /* [FEAT-20260814-SITERULESCACHE] `ttl > 0` guard. The caller normally gates
       this method behind `shouldUseCache(ep)`, but `_fetchWithCache` is public
       and reachable directly, and `setex(key, 0, …)` is an ERROR in Redis —
       caught and logged below, yet still a wasted round trip and a misleading
       "cache write error" line for an endpoint that was never meant to cache.
       Found by a test driving this method with a profile endpoint, which is
       exactly how a future caller could reach it. เช็คในตัวเองด้วย ไม่พึ่งผู้เรียก */
    if (ttl > 0 && result?.success === true && result?.status === 200) {
      try {
        const r = this.redisService.getClient();
        if (r) {
          const payload = JSON.stringify({
            cached_at: new Date().toISOString(),
            result,
          });
          await r.setex(cacheKey, ttl, payload);
          this.logger.log(`[CUSTOM TOOL] [${ep.key}] cache SET (ttl=${ttl}s)`);
        }
      } catch (e: unknown) {
        this.logger.warn(
          `[CUSTOM TOOL] [${ep.key}] cache write error: ${(e as Error).message}`,
        );
      }
    }
    return { ...result, _cache: 'miss' };
  }

  async invalidateSharedCache(
    toolId: Types.ObjectId | string,
    epKey: string,
    webCode?: string,
  ): Promise<boolean> {
    try {
      const r = this.redisService.getClient();
      if (!r) return false;
      const n = await r.del(this._sharedCacheKey(toolId, epKey, webCode));
      this.logger.log(`[CUSTOM TOOL] [${epKey}] cache invalidated (${n})`);
      return n > 0;
    } catch (e: unknown) {
      this.logger.warn(
        `[CUSTOM TOOL] [${epKey}] cache invalidate error: ${(e as Error).message}`,
      );
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMBINED DATA & PROFILE EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────

  async getCombinedData(
    userId: string,
    hook:
      | (Partial<Hook> & {
          _id?: Types.ObjectId;
          // [FIX-20260818-GROUPFIELD] renamed so the compiler enforces the fix.
          group?: Types.ObjectId | null;
        })
      | null
      | undefined,
    /* [FEAT-20261016-CUSTCACHE] `customerCache` — the CALLER says whether a kept answer may
       stand in for the call: the webhook prefetch `use`, the admin refresh `refresh`; absent
       (slip detail, customer-link, …) = live and untouched. Only a provider that declares a
       policy (loan) ever reaches Redis; shop-api ignores the option entirely. */
    opts: { logSource?: string; customerCache?: CustomerCacheMode } = {},
  ): Promise<Record<string, unknown>> {
    const tool = await this.getToolForHook(hook);
    if (!tool) {
      this.logger.warn(
        '[CUSTOM TOOL] getCombinedData: hook not bound to active tool',
      );
      return {};
    }

    /* [FEAT-20260827-BPPREFETCHPOST] Prefetch is decided by PURPOSE, not by
       HTTP verb. acme's 4 php read endpoints are POST (php reads its
       params from the body) — the old trailing `method === 'GET'` clause
       dropped them all, which killed 13 of its 15 dynamic tags. The right
       question is what an endpoint is FOR: purpose 'data' prefetches,
       'auth'/'write' never do. Proven a no-op for every other tool by DB
       survey twice (27/08 and 06/09: 15 non-GET endpoint rows across all
       tools, every one purpose 'write'/'auth' — v2.md §12.8b). Guarded by
       custom-tool-prefetch-purpose.spec.ts and the filter-equivalence spec.
       revert: re-add `String(e.method || 'GET').toUpperCase() === 'GET'`. */
    const candidateEndpoints = (tool.endpoints || []).filter(
      (e) =>
        e.status !== false &&
        !e.is_login &&
        !e.is_refresh &&
        e.purpose !== 'auth' &&
        e.purpose !== 'write',
    );
    /* [FIX-20261014-EMPTYUIDFETCH] no member ⇒ only the site-rules endpoint: the two
       empty-id callers (Refresh button, broadcast) are here for site rules alone, and a
       per-member endpoint fired with no member is a guaranteed failure on the partner's
       side (loan profile: a 404 HTML page). revert: `dataEndpoints = candidateEndpoints`. */
    const dataEndpoints = candidateEndpoints.filter(
      (e) =>
        (!!userId || isSiteRulesEndpoint(e)) &&
        /* [FEAT-20261018-SITERULESWORLD] no site-rules world (loan) ⇒ never call one, even if a
           tool carries it · shop-api declares nothing ⇒ this term is always true */
        (!isSiteRulesEndpoint(e) || providerFeatureOn('siteRules')),
    );
    if (!dataEndpoints.length) return {};

    const token = await this.getToken(tool, userId);

    const identity: Record<string, string> = { line_user_id: userId };
    if (hook?.customer_link_web_code)
      identity.web_code = hook.customer_link_web_code;

    /* [FEAT-20261016-CUSTCACHE] null unless the caller asked, a customer is named and the provider
       declares a policy (loan) — shop-api never gets one. Wiring: `customer-cache/customer-cache.session.ts`. */
    const custCache = openCustomerCache({
      mode: opts.customerCache,
      userId,
      tool,
      envNamespace: this.envNamespace,
      redis: () => this.redisService.getClient(),
      log: (m) => this.logger.log(m),
    });

    /* [FEAT-20261014-PROFILEFIRST] same per-endpoint fetch; only the ORDER is decided
       elsewhere — all at once unless the provider declares profile-first (loan_v1). */
    const results = await fetchInPrefetchOrder(
      dataEndpoints,
      async (ep) => {
        try {
          /* [FEAT-20261016-CUSTCACHE] per-customer endpoints go through the session (the shared
             site-rules cache below keeps its own path). revert: delete this line. */
          if (custCache && !shouldUseCache(ep)) {
            const r = await custCache.fetch(ep, () =>
              this._request(tool, ep, userId, { ...identity }, token),
            );
            return { ep, r };
          }
          /* [FEAT-20260814-SITERULESCACHE] The gate. Identical answer to the
             old `Number(ep.cache_ttl_sec) > 0` for every endpoint that had a
             configured TTL; site rules with none now say yes. Every other
             endpoint — profile above all — still fetches live every time.
             revert: restore `Number(ep.cache_ttl_sec) > 0`. */
          const useCache = shouldUseCache(ep);
          return {
            ep,
            r: useCache
              ? await this._fetchWithCache(
                  tool,
                  ep,
                  userId,
                  { ...identity },
                  token,
                )
              : await this._request(tool, ep, userId, { ...identity }, token),
          };
        } catch (err: unknown) {
          this.logger.error(
            `[CUSTOM TOOL] [${ep.key}] critical: ${(err as Error).message}`,
          );
          return {
            ep,
            r: {
              success: false,
              status: 0,
              data: { message: (err as Error).message },
              error: (err as Error).message,
              duration: 0,
            },
          };
        }
      },
      {
        profileFirst: !!userId && providerPrefetchProfileFirst(),
        keepWithoutProfile: (ep) => isSiteRulesEndpoint(ep),
      },
    );

    const combined: Record<
      string,
      {
        success: boolean;
        status: number;
        data: unknown;
        duration: number;
        is_profile: boolean;
        role: string;
      }
    > = {};
    for (const { ep, r } of results) {
      combined[ep.key] = {
        success: r.success,
        status: r.status,
        data: r.data || { message: r.error },
        duration: r.duration || 0,
        is_profile: ep.is_profile === true,
        role: ep.role || '',
      };
    }

    for (const { ep, r } of results) {
      /* [FEAT-20261016-CUSTCACHE] no row for an answer nobody fetched */
      if (custCache?.servedFromCache(ep.key)) continue;
      this.wlog
        .persist({
          hook_id: hook?._id ? hook._id : undefined,
          hook_alias: hook?.alias,
          // [FIX-20260818-GROUPFIELD] see customer-link.service.ts — the Hook
          // declares `group`, never `group_id`.
          group_id: hook?.group ? hook.group : null,
          channel: 'customer_link',
          action_type: `customer_link_fetch_${String(ep.key || '').toLowerCase()}`,
          method: ep.method || 'GET',
          endpoint: r?.url || ep.path || '',
          status: r?.success ? 'success' : 'error',
          http_status: typeof r?.status === 'number' ? r.status : undefined,
          error_message: r?.success ? undefined : r?.error,
          duration_ms: typeof r?.duration === 'number' ? r.duration : undefined,
          raw_request: { ...identity, endpoint_key: ep.key },
          /* [FEAT-20261014-LOGREDACT] the provider's declared personal fields only; none
             declared (shop-api) = the same object as before */
          raw_response: redactForLog(r?.data, providerLogRedactPaths()),
          request_meta: {
            tool_name: tool?.name || null,
            endpoint_key: ep.key,
            source: opts.logSource || 'webhook_prefetch',
          },
          reference_id: userId || undefined,
        })
        .catch((e: Error) =>
          this.logger.error(`[CLINKLOG] log prefetch error: ${e.message}`),
        );
    }

    const profileEp = dataEndpoints.find((e) => e.is_profile === true);
    /* [FIX-20261015-PROFILEWARN] ask the tool's own list: an empty-id call drops the profile
       on purpose (EMPTYUIDFETCH) and must not report the tool as having none. */
    if (!candidateEndpoints.some((e) => e.is_profile === true)) {
      this.logger.warn(
        `[CUSTOM TOOL] tool "${tool.name}" has no endpoint flagged is_profile.`,
      );
    }

    if (profileEp) {
      const block = combined[profileEp.key];
      if (block?.success !== true || block?.status !== 200) {
        this.logger.warn(
          `[CUSTOM TOOL] [${profileEp.key}] profile endpoint not successful — skip updating raw_profile_data.`,
        );
      }
      /* [FEAT-20261016-CUSTCACHE] a kept answer was stored when it was fetched — rewriting it
         would move `profile_data_updated_at` and make old data look fresh */
      if (isFetchOk(block) && !custCache?.servedFromCache(profileEp.key)) {
        try {
          const $set = withStamp(
            {},
            'raw_profile_data',
            'profile_data_updated_at',
            block.data,
          );
          const tier = this.extractTier(combined, tool);
          if (tier) $set.tier = { ...tier, updated_at: new Date() };
          await this.memberModel
            .updateOne({ line_user_id: userId }, { $set })
            .exec();
        } catch (memberErr: unknown) {
          this.logger.error(
            `[CUSTOM TOOL] [${profileEp.key}] raw_profile_data update error: ${(memberErr as Error).message}`,
          );
        }
      }
    }

    try {
      const hookId = hook?._id;
      if (hookId) {
        const srKey =
          Object.keys(combined).find(
            (k) => combined[k]?.role === 'site_rules',
          ) || Object.keys(combined).find((k) => /site.?rule/i.test(k));
        const srBlock = srKey ? combined[srKey] : null;
        if (isFetchOk(srBlock)) {
          await this.hookModel
            .updateOne(
              { _id: hookId },
              {
                $set: withStamp(
                  {},
                  'raw_site_rules_data',
                  'site_rules_updated_at',
                  srBlock?.data,
                ),
              },
            )
            .exec();
        }
      }
    } catch (srErr: unknown) {
      this.logger.error(
        `[CUSTOM TOOL] raw_site_rules_data update error: ${(srErr as Error).message}`,
      );
    }

    return combined;
  }

  extractTier(
    combined:
      Record<string, { success?: boolean; data?: unknown }> | null | undefined,
    tool: CustomTool | null | undefined,
  ): ExtractedTier | null {
    try {
      if (!combined || !tool) return null;
      const ep = (tool.endpoints || []).find((e) => e.is_profile === true);
      if (!ep) return null;
      const block = combined[ep.key];
      if (!block?.success) return null;

      const d = block.data;
      const mapped = (ep.profile_map || {}).tier;

      const candidates = [
        ...(mapped ? [mapped] : []),
        'data.profile.tier',
        'data.customer.tier',
        'data.member.tier',
        'result.user.tier',
        'profile.tier',
        'tier',
      ];
      let raw: unknown = null;
      for (const path of candidates) {
        const v = this._pick(d, path);
        if (v !== null && v !== undefined && v !== '') {
          raw = v;
          break;
        }
      }
      if (raw === null) return null;

      const toLevel = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        const code = obj.code ?? obj.key ?? obj.slug ?? obj.id ?? '';
        const name = obj.name ?? obj.label ?? obj.title ?? '';
        return {
          code: asText(code ?? ''),
          name: asText(name ?? ''),
          level: toLevel(obj.level ?? obj.rank ?? obj.tier_level),
          raw,
        };
      }

      if (typeof raw === 'number') {
        return { code: '', name: '', level: toLevel(raw), raw };
      }

      const str = asText(raw);
      return { code: str, name: str, level: toLevel(str), raw };
    } catch (e: unknown) {
      this.logger.error(
        `[MEMBERTIER] extractTier error: ${(e as Error).message}`,
      );
      return null;
    }
  }

  extractProfile(
    combined:
      Record<string, { success?: boolean; data?: unknown }> | null | undefined,
    tool: CustomTool | null | undefined,
  ): ExtractedProfile {
    const empty: ExtractedProfile = {
      name: 'N/A',
      phone: 'N/A',
      code: 'N/A',
      ok: false,
    };
    if (!combined || !tool) return empty;

    const ep = (tool.endpoints || []).find((e) => e.is_profile === true);
    if (!ep) return empty;

    const block = combined[ep.key];
    if (!block?.success) return empty;

    const d = block.data;
    const map: Partial<EndpointProfileMap> = ep.profile_map || {};

    const pick = (mapped: string | undefined, fallbacks: string[]): string => {
      if (mapped) {
        const v = this._pick(d, mapped);
        if (v !== null && v !== undefined && v !== '') return asText(v);
      }
      for (const f of fallbacks) {
        const v = this._pick(d, f);
        if (v !== null && v !== undefined && v !== '') return asText(v);
      }
      return 'N/A';
    };

    return {
      name: pick(map.name, [
        'data.customer.customer_name',
        'data.profile.bank.account_name',
        'data.profile.name',
        'result.user.fullname',
        'customer_name',
      ]),
      phone: pick(map.phone, [
        'data.customer.customer_tel',
        'data.profile.phone',
        'result.user.mobile',
        'customer_tel',
      ]),
      code: pick(map.code, [
        'data.contract.code',
        'data.profile.member_id',
        'result.user.code',
        'member_id',
      ]),
      ok: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST CONNECTION
  // ─────────────────────────────────────────────────────────────────────────

  async testConnection(
    toolOrId:
      // `_id` also allows a string so an already-resolved `ToolRef` — what
      // `getToolForHook` hands back, and what POST /hook/:id/test-external-api
      // passes in — is accepted without a cast, alongside the saved-tool id and
      // the unsaved draft this method was originally written for.
      | (CustomTool & { base_url?: string; _id?: Types.ObjectId | string })
      | string
      | Types.ObjectId,
    {
      userId = 'TEST_USER',
      endpointKey = null,
    }: { userId?: string; endpointKey?: string | null } = {},
  ): Promise<{
    ok: boolean;
    message?: string;
    steps?: Array<Record<string, unknown>>;
  }> {
    const tool =
      typeof toolOrId === 'object' && (toolOrId as CustomTool).base_url
        ? {
            _id: (toolOrId as { _id?: Types.ObjectId })._id || 'draft',
            ...(toolOrId as CustomTool),
          }
        : await this.getTool(toolOrId as string, { skipCache: true });

    if (!tool) return { ok: false, message: 'ไม่พบ tool หรือถูกปิดอยู่' };

    const steps: Array<Record<string, unknown>> = [];

    let token: string | null = null;
    if (tool.auth_type === 'jwt_login') {
      const ep = this.findFlagged(tool, 'is_login');
      if (!ep)
        return { ok: false, message: 'ไม่มีเส้นที่ติดธง is_login', steps };

      const body =
        ep.payload && Object.keys(ep.payload).length
          ? ep.payload
          : { username: '{{username}}', password: '{{password}}' };
      const res = await this._request(tool, ep, userId, body, null);
      token = this._pickToken(res.data, ep.token_path, 'access_token');

      steps.push({
        key: ep.key,
        label: ep.label || 'login',
        method: ep.method,
        url: res.url,
        ok: res.success && !!token,
        status: res.status,
        duration_ms: res.duration,
        response: this._maskSecrets(res.data),
        message: res.success
          ? token
            ? 'ได้ token แล้ว'
            : `ตอบ 200 แต่อ่าน token ตาม token_path "${ep.token_path}" ไม่เจอ`
          : res.error,
      });

      if (!token) return { ok: false, message: 'login ไม่สำเร็จ', steps };
    }

    if (endpointKey) {
      const ep = this.findEndpoint(tool, endpointKey);
      if (!ep) {
        steps.push({
          key: endpointKey,
          ok: false,
          message: 'ไม่พบ endpoint key นี้',
        });
        return { ok: false, message: `ไม่พบ endpoint "${endpointKey}"`, steps };
      }
      const res = await this._request(tool, ep, userId, {}, token);
      steps.push({
        key: ep.key,
        label: ep.label || '',
        method: ep.method,
        url: res.url,
        ok: res.success,
        status: res.status,
        duration_ms: res.duration,
        message: res.success ? 'ยิงสำเร็จ' : res.error,
        response: res.data,
      });
    }

    return { ok: steps.every((s) => s.ok), steps };
  }

  _maskSecrets(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    const SECRET_KEYS =
      /^(access_token|refresh_token|token|id_token|secret|password)$/i;

    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[k] =
            SECRET_KEYS.test(k) && typeof val === 'string'
              ? `${val.slice(0, 12)}… (ซ่อนไว้)`
              : walk(val);
        }
        return out;
      }
      return v;
    };
    return walk(data);
  }
}

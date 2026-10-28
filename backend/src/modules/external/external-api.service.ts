import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import axios, { type AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { Model, Types, isValidObjectId } from 'mongoose';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
// [FIX-20260905-GLOBALNS] the one copy of the environment-segment rule
import { RedisService, redisEnvNamespace } from '@/infra/redis';
// Leaf import, not the barrel — see the note in external.module.ts: ChatModule
// imports this module, so the barrel would close a boot-breaking cycle.
// eslint-disable-next-line no-restricted-imports
import { Member } from '@/modules/chat/schemas/member.schema';
import { Hook } from '@/modules/hooks';
import { SystemConfigService, WebhookLogWriter } from '@/modules/system';

import { asText } from './utils/as-text';
import { isFetchOk, withStamp } from './utils/raw-data-stamp';

const ENABLE_EXTERNAL_CACHE = false;
const EXTERNAL_CACHE_TTL = 10 * 60 * 1000;

const CB_ENABLED = true;
const CB_FAIL_THRESHOLD = 5;
const CB_FAIL_WINDOW_SEC = 60;
const CB_COOLDOWN_SEC = 30;

const LOGIN_FAIL_COOLDOWN_SEC = 60;

export interface ApiConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface EndpointConfig {
  path: string;
  method: string;
  requireJwt: boolean;
  payload: Record<string, unknown>;
  request_type?: string;
  is_login?: boolean;
  sub_type?: string;
  [key: string]: unknown;
}

export interface RequestExecutionResult {
  success: boolean;
  data: unknown;
  status: number;
  headers?: Record<string, unknown>;
  duration: number;
  method: string;
  url: string;
  error?: string;
  circuit_open?: boolean;
}

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  /**
   * [FIX-20260905-GLOBALNS] `<env>.<db8>` — see `infra/redis/redis-namespace.ts`.
   *
   * WHY THIS FILE NEEDED IT AND THE 18/08 FIX WAS NOT ENOUGH. That fix put the
   * OA into the breaker key so one customer's failing upstream could not trip
   * every customer on it. It could not fix what it never looked at: `_hookKey`
   * answers the literal `'global'` for a context carrying neither alias nor
   * `_id`, and two live callers pass exactly that (`hook-outbound.service.ts`
   * hands `getCombinedData` a `null` context and a bare-credentials object). So
   * `cb:open:global:<endpoint>` and `login:fail:global` are CONSTANT across every
   * deployment — the same shape as `qcache:...:ALL:...`, which is the key that
   * put staging's rows on the production dashboard on 05/09.
   *
   * With staging and production on one Redis host and one `REDIS_DB`, five
   * failures on staging's `global` context opened production's breaker for 30s
   * against an upstream that was answering perfectly.
   */
  private readonly envNamespace: string;
  private readonly apiCache = new Map<
    string,
    { data: RequestExecutionResult; expiresAt: number }
  >();

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    @InjectModel(Member.name) private readonly memberModel: Model<Member>,
    /* [FEAT-20260827-WLOGONEDOOR] was `@InjectModel(WebhookLog)`. This service
     * only ever WROTE the collection (six acme rows), never read it, so
     * the model is gone entirely — a service that cannot reach the model cannot
     * drift back to writing it directly. ExternalModule already imports
     * SystemModule (external.module.ts:39), which exports this door. */
    private readonly wlog: WebhookLogWriter,
    private readonly systemConfigService: SystemConfigService,
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
  // CIRCUIT BREAKER HELPERS (Redis-backed, best-effort)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ==== [FIX-20260818-CBTENANTKEY] Which tenant a Redis key belongs to.
   *
   * This expression existed TWICE in this file — once in `_loginFailKey` and
   * once inline in `getCombinedData` — before the breaker needed it as a third
   * consumer. One definition, three callers, rather than a third copy.
   *
   * The two differed: `_loginFailKey` also accepted a plain string. Every caller
   * of both was checked (webhook.service.ts:1512-1513, members.service.ts:251
   * and :412, customer-link.service.ts:1201, hook-outbound.service.ts:971,976)
   * and all pass an OBJECT, so keeping the string branch is a strict superset
   * that no live path exercises differently.
   *
   * `global` for a context with no identity is deliberate: `hook-outbound`
   * passes a literal config object with neither alias nor `_id`, and there is no
   * tenant to separate it by. It also keeps the key space BOUNDED — every
   * component here comes from the database, never from caller input, so this
   * cannot be grown without limit by an attacker.
   */
  private _hookKey(hookContext: unknown): string {
    if (hookContext && typeof hookContext === 'object') {
      const obj = hookContext as { alias?: string; _id?: unknown };
      return obj.alias || (obj._id ? asText(obj._id) : 'global');
    }
    if (typeof hookContext === 'string') return hookContext;
    return 'global';
  }

  /**
   * [FIX-20260818-CBTENANTKEY] audit_18_aug H7 — the key carries the OA.
   *
   * It was `cb:open:${endpointKey}`: the endpoint NAME alone. OAs sharing an
   * integration share that name — measured live, two hooks point at the same
   * custom tool — so five failures against one customer's upstream opened the
   * breaker for every customer on it. `hookContext` was already a parameter of
   * `_executeRequest`, which calls all three of these, so nothing needed
   * threading through.
   *
   * revert: drop the `hookContext` parameter from these three and rebuild the
   *         keys from `endpointKey` alone.
   */
  private async _cbIsOpen(
    endpointKey: string,
    hookContext?: unknown,
  ): Promise<boolean> {
    if (!CB_ENABLED) return false;
    try {
      const client = this.redisService.getClient();
      const val = await client.get(
        `cb:${this.envNamespace}:open:${this._hookKey(hookContext)}:${endpointKey}`,
      );
      return !!val;
    } catch {
      return false;
    }
  }

  private async _cbRecordSuccess(
    endpointKey: string,
    hookContext?: unknown,
  ): Promise<void> {
    if (!CB_ENABLED) return;
    try {
      const client = this.redisService.getClient();
      // [FIX-20260818-CBTENANTKEY] scoped — see `_cbIsOpen`
      const scoped = `${this._hookKey(hookContext)}:${endpointKey}`;
      const failKey = `cb:${this.envNamespace}:fails:${scoped}`;
      const openKey = `cb:${this.envNamespace}:open:${scoped}`;
      const wasOpen = await client.get(openKey);
      await client.del(failKey);
      await client.del(openKey);
      if (wasOpen) {
        this.logger.log(
          `[CIRCUIT] [${endpointKey}] RECOVERED — upstream responding again, circuit CLOSED.`,
        );
      }
    } catch {
      // best-effort
    }
  }

  private async _cbRecordFailure(
    endpointKey: string,
    reason: string,
    hookContext?: unknown,
  ): Promise<void> {
    if (!CB_ENABLED) return;
    try {
      const client = this.redisService.getClient();
      // [FIX-20260818-CBTENANTKEY] scoped — see `_cbIsOpen`
      const scoped = `${this._hookKey(hookContext)}:${endpointKey}`;
      const failKey = `cb:${this.envNamespace}:fails:${scoped}`;
      const count = await client.incr(failKey);
      if (count === 1) await client.expire(failKey, CB_FAIL_WINDOW_SEC);
      this.logger.warn(
        `[CIRCUIT] [${endpointKey}] qualifying failure ${count}/${CB_FAIL_THRESHOLD} (reason: ${reason}).`,
      );
      if (count >= CB_FAIL_THRESHOLD) {
        await client.setex(
          `cb:${this.envNamespace}:open:${scoped}`,
          CB_COOLDOWN_SEC,
          String(Date.now()),
        );
        this.logger.error(
          `[CIRCUIT] [${endpointKey}] TRIPPED — circuit OPEN for ${CB_COOLDOWN_SEC}s. Short-circuiting upstream calls.`,
        );
      }
    } catch {
      // best-effort
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIN FAIL-FAST HELPERS (Redis-backed, best-effort)
  // ─────────────────────────────────────────────────────────────────────────

  private _loginFailKey(hookContext: unknown): string {
    // [FIX-20260818-CBTENANTKEY] behaviour unchanged; the expression moved to
    // `_hookKey` so the breaker could share it instead of copying it.
    return `login:${this.envNamespace}:fail:${this._hookKey(hookContext)}`;
  }

  private async _isLoginInCooldown(hookContext: unknown): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const val = await client.get(this._loginFailKey(hookContext));
      return !!val;
    } catch {
      return false;
    }
  }

  private async _markLoginFail(hookContext: unknown): Promise<void> {
    try {
      const client = this.redisService.getClient();
      await client.setex(
        this._loginFailKey(hookContext),
        LOGIN_FAIL_COOLDOWN_SEC,
        '1',
      );
    } catch {
      // best-effort
    }
  }

  private async _clearLoginFail(hookContext: unknown): Promise<void> {
    try {
      const client = this.redisService.getClient();
      await client.del(this._loginFailKey(hookContext));
    } catch {
      // best-effort
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIG & ENDPOINT RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────

  async _getApiConfig(hookIdOrHook: unknown = null): Promise<{
    config: ApiConfig;
    endpoints: Record<string, unknown>;
    source: string;
  }> {
    let hook: (Hook & { _id: unknown }) | null = null;
    const isId = (val: unknown): boolean => {
      if (!val) return false;
      if (typeof val === 'string') return isValidObjectId(val);
      return val instanceof Types.ObjectId;
    };

    if (isId(hookIdOrHook)) {
      try {
        hook = await this.hookModel
          .findById(hookIdOrHook as string)
          .lean()
          .exec();
      } catch {
        hook = null;
      }
    } else if (hookIdOrHook && typeof hookIdOrHook === 'object') {
      hook = hookIdOrHook as Hook & { _id: unknown };
    }

    const keys = [
      'EXTERNAL_API_BASE_URL',
      'EXTERNAL_API_USERNAME',
      'EXTERNAL_API_PASSWORD',
    ];
    const configs = await Promise.all(
      keys.map((k) => this.systemConfigService.getConfigByKey(k)),
    );

    const globalConfig: ApiConfig = {
      baseUrl: (
        (configs[0]?.value as string) ||
        process.env.EXTERNAL_API_BASE_URL ||
        ''
      ).replace(/\/$/, ''),
      username:
        (configs[1]?.value as string) ||
        process.env.EXTERNAL_API_USERNAME ||
        '',
      password:
        (configs[2]?.value as string) ||
        process.env.EXTERNAL_API_PASSWORD ||
        '',
    };

    let baseUrl = globalConfig.baseUrl;
    let username = globalConfig.username;
    let password = globalConfig.password;

    let urlSrc = 'System Config (Global)';
    let userSrc = 'System Config (Global)';
    let passSrc = 'System Config (Global)';

    if (hook) {
      if (hook.external_api_url) {
        baseUrl = hook.external_api_url.replace(/\/$/, '');
        urlSrc = `Hook (Alias: ${hook.alias || String(hook._id)})`;
      }
      if (hook.external_user) {
        username = hook.external_user;
        userSrc = `Hook (Alias: ${hook.alias || String(hook._id)})`;
      }
      if (hook.external_password) {
        password =
          (this.cryptoService.safeDecrypt(hook.external_password) as string) ||
          '';
        passSrc = `Hook (Alias: ${hook.alias || String(hook._id)})`;
      }
    }

    this.logger.log(
      `[EXTERNAL API] Configuration Sources: URL=${urlSrc} -> ${baseUrl}, User=${userSrc} -> ${username}, Pass=${passSrc}`,
    );

    return {
      config: { baseUrl, username, password },
      endpoints: (hook?.external_endpoints as Record<string, unknown>) || {},
      source: urlSrc,
    };
  }

  async _getEndpoint(
    key: string,
    hookEndpoints: unknown = {},
    defaultPath = '',
    defaultMethod = 'POST',
    defaultRequireJwt = true,
  ): Promise<EndpointConfig> {
    let path = '';
    let method = defaultMethod;
    let requireJwt = defaultRequireJwt;
    let payload: Record<string, unknown> = {};
    let endpointConfig: Record<string, unknown> = {};
    let endpointSource = 'Default (Hardcoded)';

    let hookData: unknown = null;
    if (hookEndpoints) {
      if (hookEndpoints instanceof Map) {
        hookData = hookEndpoints.get(key);
      } else if (typeof hookEndpoints === 'object') {
        hookData = (hookEndpoints as Record<string, unknown>)[key];
      }
    }

    if (hookData) {
      endpointSource = 'Hook';
      endpointConfig =
        typeof hookData === 'object'
          ? { ...(hookData as Record<string, unknown>) }
          : { path: hookData };
      path = (endpointConfig.path as string) || defaultPath;
      method = (endpointConfig.method as string) || defaultMethod;
      requireJwt =
        endpointConfig.require_jwt !== undefined
          ? Boolean(endpointConfig.require_jwt)
          : defaultRequireJwt;
      payload = (endpointConfig.payload as Record<string, unknown>) || {};
    } else {
      const configKey = `EXTERNAL_ENDPOINT_${key.toUpperCase()}`;
      const sysConfigs = await Promise.all([
        this.systemConfigService.getConfigByKey(configKey),
        this.systemConfigService.getConfigByKey(`${configKey}_METHOD`),
        this.systemConfigService.getConfigByKey(`${configKey}_REQUIRE_JWT`),
      ]);

      if (sysConfigs[0] && sysConfigs[0].value) {
        endpointSource = 'System Config';
        path = sysConfigs[0].value as string;
        method = (sysConfigs[0].custom_method ||
          sysConfigs[1]?.value ||
          defaultMethod) as string;
        requireJwt =
          sysConfigs[0].require_jwt !== undefined
            ? Boolean(sysConfigs[0].require_jwt)
            : sysConfigs[2]?.value === 'false'
              ? false
              : defaultRequireJwt;
        endpointConfig = { ...sysConfigs[0] };
      } else {
        path = defaultPath;
      }
    }

    this.logger.log(
      `[EXTERNAL API] Endpoint [${key}] source: ${endpointSource} | Method: ${method} | JWT: ${requireJwt}`,
    );

    return {
      ...endpointConfig,
      path: (path || '').replace(/^\/+/, ''),
      method: (method || 'POST').toUpperCase(),
      requireJwt: Boolean(requireJwt),
      payload: payload || {},
    };
  }

  _resolvePath(
    template: string,
    variables: Record<string, unknown> = {},
  ): string {
    if (!template) return '';
    let resolved = template;
    const uid = (variables.line_user_id || variables.userId || '') as string;
    const replacementVars: Record<string, string> = {
      lineuserid: uid,
      channel_user_id: uid,
    };
    for (const [k, v] of Object.entries(variables)) {
      replacementVars[k] = v == null ? '' : asText(v);
    }

    for (const [key, value] of Object.entries(replacementVars)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      resolved = resolved.replace(regex, value || '');
    }
    return resolved;
  }

  async _executeRequest(
    endpointKey: string,
    userId: string,
    token: string | null,
    hookContext: unknown,
    defaultPath = '',
    defaultMethod = 'POST',
    defaultRequireJwt = true,
    additionalData: Record<string, unknown> = {},
  ): Promise<RequestExecutionResult> {
    const { config, endpoints } = await this._getApiConfig(hookContext);
    const endpointConfig = await this._getEndpoint(
      endpointKey,
      endpoints,
      defaultPath,
      defaultMethod,
      defaultRequireJwt,
    );

    const resolvedPath = this._resolvePath(endpointConfig.path, {
      line_user_id: userId,
      userId,
    });
    const url = `${config.baseUrl}/${resolvedPath}`;

    const cacheKey = `${userId}_${endpointKey}_${resolvedPath}_${JSON.stringify(additionalData)}`;
    if (ENABLE_EXTERNAL_CACHE && this.apiCache.has(cacheKey)) {
      const entry = this.apiCache.get(cacheKey)!;
      if (Date.now() < entry.expiresAt) {
        this.logger.log(
          `[EXTERNAL API] [CACHE HIT] Returning cached data for ${endpointKey} (User: ${userId})`,
        );
        return entry.data;
      }
      this.apiCache.delete(cacheKey);
    }

    // [FIX-20260818-CBTENANTKEY] `hookContext` is this method's own parameter —
    // the breaker had simply never been told which tenant it was guarding.
    if (await this._cbIsOpen(endpointKey, hookContext)) {
      this.logger.warn(
        `[CIRCUIT] [${endpointKey}] OPEN — short-circuiting request (User: ${userId}).`,
      );
      return {
        success: false,
        error: 'circuit_open: upstream temporarily unavailable',
        data: { message: 'circuit_open: upstream temporarily unavailable' },
        status: 503,
        duration: 0,
        method: endpointConfig.method,
        url,
        circuit_open: true,
      };
    }

    let requestData: unknown = null;
    let headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    const requestType = (endpointConfig.request_type || 'form').toLowerCase();
    let body: Record<string, unknown> = {};

    if (endpointConfig.method !== 'GET') {
      body = {
        ...(endpointConfig.payload || {}),
        ...additionalData,
      };

      const variables: Record<string, unknown> = {
        line_user_id: userId,
        userId,
        lineuserid: userId,
        username: config.username,
        password: config.password,
      };

      for (const key in body) {
        if (typeof body[key] === 'string') {
          body[key] = this._resolvePath(body[key], variables);
        }
      }

      if (
        endpointKey !== 'LOGIN' &&
        !endpointConfig.is_login &&
        !endpointConfig.path.includes('{{line_user_id}}') &&
        !endpointConfig.path.includes('{{channel_user_id}}') &&
        !endpointConfig.path.includes('{{userId}}')
      ) {
        const bodyValues = Object.values(body).map((v) => String(v));
        const hasUserIdInBody = bodyValues.some((v) => v === userId);
        if (
          !hasUserIdInBody &&
          !body.userid &&
          !body.userId &&
          !body.line_user_id &&
          !body.channel_user_id
        ) {
          body.userid = userId;
        }
      }

      if (requestType === 'json') {
        requestData = JSON.stringify(body);
        headers['content-type'] = 'application/json';
      } else if (requestType === 'form-data') {
        const form = new FormData();
        Object.keys(body).forEach((key) => form.append(key, body[key]));
        requestData = form;
        headers = {
          ...headers,
          ...(form.getHeaders() as Record<string, string>),
        };
      } else {
        const params = new URLSearchParams();
        Object.keys(body).forEach((key) => {
          if (body[key] !== undefined && body[key] !== null) {
            params.append(key, asText(body[key]));
          }
        });
        requestData = params;
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
    }

    if (endpointConfig.requireJwt && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    headers['User-Agent'] = 'PostmanRuntime/7.39.0';
    headers['Accept'] = '*/*';
    headers['Accept-Encoding'] = 'gzip, deflate, br';
    headers['Connection'] = 'keep-alive';

    const startTime = Date.now();
    try {
      const axiosConfig: AxiosRequestConfig = {
        method: endpointConfig.method,
        url,
        headers,
        timeout: 4000,
        data: endpointConfig.method !== 'GET' ? requestData : undefined,
      };

      const response = await axios(axiosConfig);
      const rawData: unknown = response.data;

      const finalResult: RequestExecutionResult = {
        success: true,
        data: rawData,
        status: response.status,
        headers: response.headers,
        duration: Date.now() - startTime,
        method: endpointConfig.method,
        url,
      };

      if (ENABLE_EXTERNAL_CACHE && endpointKey !== 'LOGIN') {
        this.apiCache.set(cacheKey, {
          data: finalResult,
          expiresAt: Date.now() + EXTERNAL_CACHE_TTL,
        });
      }

      this._cbRecordSuccess(endpointKey, hookContext).catch(() => {});
      return finalResult;
    } catch (err: unknown) {
      const axiosError = err as {
        message: string;
        code?: string;
        response?: { status?: number; data?: unknown };
      };
      this.logger.error(
        `[EXTERNAL API] [${endpointKey}] Request Error: ${axiosError.message}`,
      );

      const status = axiosError.response?.status;
      const isTimeout =
        axiosError.code === 'ECONNABORTED' ||
        /timeout/i.test(axiosError.message || '');
      const isServerErr = typeof status === 'number' && status >= 500;
      const isNetwork = !axiosError.response;
      if (isTimeout || isServerErr || isNetwork) {
        const reason = isTimeout
          ? 'timeout'
          : isServerErr
            ? `http_${status}`
            : 'network';
        this._cbRecordFailure(endpointKey, reason, hookContext).catch(() => {});
      }

      const errorData = axiosError.response?.data || {
        message: axiosError.message,
      };
      return {
        success: false,
        error: axiosError.message,
        data: errorData,
        status: axiosError.response?.status || 500,
        duration: Date.now() - startTime,
        method: endpointConfig.method,
        url,
      };
    }
  }

  /**
   * `hookContext`, not `hookId`, and `token` may be null — both widened to
   * match every sibling method on this class and, more importantly, to match
   * the legacy call site: hookController.js:3283 hands over the whole lean hook
   * document, and `_loginFailKey` / the token cache key read `alias` off it.
   * Passing the bare id instead would silently key those caches differently
   * from legacy, which shows up as an extra outbound login, not as an error.
   */
  async executeExternalEndpoint(
    hookContext: unknown,
    endpointKey: string,
    userId: string,
    token: string | null,
    additionalData: Record<string, unknown> = {},
  ): Promise<RequestExecutionResult> {
    return this._executeRequest(
      endpointKey,
      userId,
      token,
      hookContext,
      '',
      'POST',
      true,
      additionalData,
    );
  }

  async login(
    userId: string,
    hookContext: unknown = null,
  ): Promise<string | null> {
    if (await this._isLoginInCooldown(hookContext)) {
      this.logger.warn(
        `[EXTERNAL API] [LOGIN] Skipped — recent failure cached (${LOGIN_FAIL_COOLDOWN_SEC}s cooldown).`,
      );
      return null;
    }
    const { config, endpoints, source } = await this._getApiConfig(hookContext);

    let loginKey = 'LOGIN';
    let loginConfig: Record<string, unknown> | null = null;

    if (endpoints) {
      if (endpoints instanceof Map) {
        const entries = (
          endpoints as Map<string, Record<string, unknown>>
        ).entries();
        for (const [key, val] of entries) {
          if (val && val.is_login) {
            loginKey = key;
            loginConfig = val;
            break;
          }
        }
        if (!loginConfig)
          loginConfig =
            (endpoints.get('LOGIN') as Record<string, unknown>) || null;
      } else {
        const obj = endpoints as Record<string, { is_login?: boolean }>;
        for (const key in obj) {
          if (obj[key] && obj[key].is_login) {
            loginKey = key;
            loginConfig = obj[key];
            break;
          }
        }
        if (!loginConfig)
          loginConfig = (obj['LOGIN'] as Record<string, unknown>) || null;
      }
    }

    const hasLoginInHook = !!loginConfig;
    let result: RequestExecutionResult;

    if (hasLoginInHook) {
      this.logger.log(
        `[EXTERNAL API] [LOGIN] Executing DYNAMIC login via Key: [${loginKey}] from ${source}`,
      );
      result = await this._executeRequest(
        loginKey,
        userId,
        null,
        hookContext,
        'api/v1/auth/login',
        'POST',
        false,
      );
    } else {
      this.logger.log(
        `[EXTERNAL API] [LOGIN] Executing HARDCODED default login`,
      );
      const url = `${config.baseUrl}/api/v1/auth/login`;
      const body = { username: config.username, password: config.password };
      const startTime = Date.now();
      try {
        const response = await axios.post(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        result = {
          success: true,
          data: response.data,
          status: response.status,
          headers: response.headers,
          duration: Date.now() - startTime,
          method: 'POST',
          url,
        };
      } catch (err: unknown) {
        const axiosErr = err as {
          message: string;
          response?: { status?: number; data?: { message?: string } };
        };
        const errorMsg = axiosErr.response?.data?.message || axiosErr.message;
        result = {
          success: false,
          data: null,
          error: errorMsg,
          status: axiosErr.response?.status || 500,
          duration: Date.now() - startTime,
          method: 'POST',
          url,
        };
      }
    }

    if (!result.success) {
      this.logger.error(`[EXTERNAL API] Login failed: ${result.error || ''}`);
      await this._markLoginFail(hookContext);
      return null;
    }

    const resData = result.data as Record<string, unknown>;
    const nestedData = resData?.data as Record<string, unknown> | undefined;
    const access_token = (resData?.access_token || nestedData?.access_token) as
      string | undefined;

    if (access_token) {
      const expires_in = (resData?.expires_in ||
        nestedData?.expires_in ||
        3600) as number;
      const expires_at = new Date(Date.now() + expires_in * 1000);
      const setCookie = result.headers?.['set-cookie'];
      const session_cookie = Array.isArray(setCookie)
        ? (setCookie[0] as string)
        : (setCookie as string) || '';

      // [FIX-20260818-CBTENANTKEY] was a byte-identical copy of `_hookKey`.
      const hookKey = this._hookKey(hookContext);

      await this.memberModel
        .updateOne(
          { line_user_id: userId },
          {
            $set: {
              [`meta.external_tokens.${hookKey}`]: {
                access_token,
                expires_at,
                session_cookie,
                updated_at: new Date(),
              },
              'meta.external_api': {
                access_token,
                expires_at,
                session_cookie,
              },
            },
          },
          { upsert: true },
        )
        .exec();

      await this._clearLoginFail(hookContext);
      return access_token;
    }

    await this.wlog
      .persist({
        channel: 'acme_api_login',
        // Same mirror and same field-name correction as get_profile below.
        log_source: 'acme_api_login',
        action_type: 'login',
        method: result.method,
        endpoint: result.url,
        status: result.success ? 'success' : 'error',
        http_status: result.status,
        raw_request: { userId },
        raw_response: result.data || { error: result.error },
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log login: ${logErr.message}`,
        ),
      );

    await this._markLoginFail(hookContext);
    return null;
  }

  async getValidToken(
    userId: string,
    hookContext: unknown = null,
  ): Promise<string | null> {
    const user = await this.memberModel
      .findOne({ member_user_id: userId })
      .lean()
      .exec();

    // [FIX-20260818-CBTENANTKEY] was a byte-identical copy of `_hookKey`.
    const hookKey = this._hookKey(hookContext);

    const meta = user?.meta;
    const tokens = meta?.external_tokens as
      | Record<
          string,
          {
            access_token?: string;
            expires_at?: Date | string;
            session_cookie?: string;
          }
        >
      | undefined;
    const hookToken = tokens?.[hookKey];

    if (
      hookToken &&
      hookToken.access_token &&
      new Date(hookToken.expires_at as Date) > new Date()
    ) {
      return hookToken.access_token;
    }

    const externalMeta = meta?.external_api as
      | {
          access_token?: string;
          expires_at?: Date | string;
          session_cookie?: string;
        }
      | undefined;
    if (
      externalMeta &&
      externalMeta.access_token &&
      new Date(externalMeta.expires_at as Date) > new Date()
    ) {
      return externalMeta.access_token;
    }

    return this.login(userId, hookContext);
  }

  async getCustomerProfile(
    userId: string,
    token: string | null,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const result = await this._executeRequest(
      'CUSTOMER_PROFILE',
      userId,
      token,
      hookContext,
      'api/v1/customer/{{line_user_id}}',
      'GET',
      true,
    );

    const apiStatus = result.success ? 'success' : 'error';
    const apiResponse = result.data || { message: result.error };

    if (
      result.success &&
      (apiResponse as Record<string, unknown>)?.success &&
      isFetchOk(result)
    ) {
      await this.memberModel
        .updateOne(
          { line_user_id: userId },
          {
            $set: withStamp(
              {},
              'raw_profile_data',
              'profile_data_updated_at',
              apiResponse,
            ),
          },
        )
        .exec();
    }

    await this.wlog
      .persist({
        channel: 'acme_api_get_profile',
        // Mirror of `channel`, normally applied by WebhookLogService.createLog.
        // Applied here because this service writes the model directly; without
        // it the row keeps the schema default `line_api`, and the webhook-log
        // list — which reads `log_source` — files it under the wrong source.
        log_source: 'acme_api_get_profile',
        action_type: 'get_profile',
        method: result.method,
        endpoint: result.url,
        status: apiStatus,
        http_status: result.status,
        // Legacy writes raw_request/raw_response here
        // (externalApiService.js:680-681), NOT the *_summary pair.
        raw_request: { userId },
        raw_response: apiResponse,
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log profile view: ${logErr.message}`,
        ),
      );

    return {
      status: apiStatus,
      data: apiResponse,
      duration: result.duration,
    };
  }

  async getInstallment(
    userId: string,
    token: string | null,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const result = await this._executeRequest(
      'INSTALLMENT_CURRENT',
      userId,
      token,
      hookContext,
      'api/line/v1/installment_current.php',
      'POST',
      true,
    );

    const apiStatus = result.success ? 'success' : 'error';
    const apiResponse = result.data || { message: result.error };

    await this.wlog
      .persist({
        channel: 'acme_api_get_installment',
        action_type: 'get_installment',
        method: result.method,
        endpoint: result.url,
        status: apiStatus,
        http_status: result.status,
        payload_summary: { userId },
        response_summary: apiResponse,
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log installment: ${logErr.message}`,
        ),
      );

    return { status: apiStatus, data: apiResponse, duration: result.duration };
  }

  async getPaymentHistory(
    userId: string,
    token: string | null,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const result = await this._executeRequest(
      'PAYMENT_HISTORY',
      userId,
      token,
      hookContext,
      'api/line/v1/payment_history.php',
      'POST',
      true,
    );

    const apiStatus = result.success ? 'success' : 'error';
    const apiResponse = result.data || { message: result.error };

    await this.wlog
      .persist({
        channel: 'acme_api_get_payment_history',
        action_type: 'get_payment_history',
        method: result.method,
        endpoint: result.url,
        status: apiStatus,
        http_status: result.status,
        payload_summary: { userId },
        response_summary: apiResponse,
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log payment history: ${logErr.message}`,
        ),
      );

    return { status: apiStatus, data: apiResponse, duration: result.duration };
  }

  async getContract(
    userId: string,
    token: string | null,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const result = await this._executeRequest(
      'CONTRACT_INFO',
      userId,
      token,
      hookContext,
      'api/line/v1/contract.php',
      'POST',
      true,
    );

    const apiStatus = result.success ? 'success' : 'error';
    const apiResponse = result.data || { message: result.error };

    await this.wlog
      .persist({
        channel: 'acme_api_get_contract_info',
        action_type: 'get_contract_info',
        method: result.method,
        endpoint: result.url,
        status: apiStatus,
        http_status: result.status,
        payload_summary: { userId },
        response_summary: apiResponse,
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log contract info: ${logErr.message}`,
        ),
      );

    return { status: apiStatus, data: apiResponse, duration: result.duration };
  }

  async getInstallmentList(
    userId: string,
    token: string | null,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const result = await this._executeRequest(
      'ALL_INSTALLMENTS',
      userId,
      token,
      hookContext,
      'api/line/v1/installment.php',
      'POST',
      true,
    );

    const apiStatus = result.success ? 'success' : 'error';
    const apiResponse = result.data || { message: result.error };

    await this.wlog
      .persist({
        channel: 'acme_api_get_installment_list',
        action_type: 'get_installment_list',
        method: result.method,
        endpoint: result.url,
        status: apiStatus,
        http_status: result.status,
        payload_summary: { userId, url: result.url },
        response_summary: apiResponse,
        duration_ms: result.duration,
        reference_id: userId,
      })
      .catch((logErr: Error) =>
        this.logger.error(
          `[EXTERNAL API] Failed to log installment list: ${logErr.message}`,
        ),
      );

    return { status: apiStatus, data: apiResponse, duration: result.duration };
  }

  async getCombinedData(
    userId: string,
    hookContext: unknown = null,
  ): Promise<Record<string, unknown>> {
    const { endpoints, source } = await this._getApiConfig(hookContext);
    this.logger.log(
      `[EXTERNAL API] Initiating Dynamic Combined Data Fetch. Source: ${source}`,
    );

    try {
      const token = await this.getValidToken(userId, hookContext);
      const endpointEntries = Object.entries(endpoints || {});
      const redisClient = this.redisService.getClient();

      // [FIX-20260818-CBTENANTKEY] second copy of this expression, removed —
      // `_hookKey` is the one definition now.
      const hookAlias = this._hookKey(hookContext);
      const REDIS_CACHE_TTL_SEC = 12 * 60 * 60;

      let profileEntry: [string, unknown] | null = null;
      const otherEntries: Array<[string, unknown]> = [];

      for (const entry of endpointEntries) {
        const [key, configRaw] = entry;
        const endpointConfig = (configRaw as Record<string, unknown>) || {};
        if (key === 'LOGIN' || endpointConfig.is_login === true) continue;
        const isProfileEndpoint =
          key === 'CUSTOMER_PROFILE' ||
          (typeof endpointConfig.path === 'string' &&
            endpointConfig.path.includes('api/v1/customer')) ||
          endpointConfig.sub_type === 'api/v1/customer';

        if (isProfileEndpoint && !profileEntry) {
          profileEntry = entry;
        } else {
          if (isProfileEndpoint) {
            this.logger.warn(
              `[EXTERNAL API] Found >1 profile endpoint — using [${profileEntry![0]}] as profile.`,
            );
          }
          otherEntries.push(entry);
        }
      }

      const responses: Array<{
        key: string;
        result: RequestExecutionResult;
      }> = [];
      let profileFailed = false;

      if (profileEntry) {
        const [profileKey] = profileEntry;
        const redisKey = `customer_profile:${this.envNamespace}:${hookAlias}:${userId}`;
        let profileResult: RequestExecutionResult | null = null;

        try {
          const cached = await redisClient.get(redisKey);
          if (cached) {
            profileResult = JSON.parse(cached) as RequestExecutionResult;
            this.logger.log(
              `[EXTERNAL API] [${profileKey}] Loaded from Redis cache.`,
            );
          }
        } catch (err: unknown) {
          this.logger.error(
            `[EXTERNAL API] Redis Get Error: ${(err as Error).message}`,
          );
        }

        if (!profileResult) {
          if (!token) {
            profileResult = {
              success: false,
              data: { message: 'no_token' },
              error: 'no_token',
              status: 500,
              duration: 0,
              method: 'GET',
              url: '',
            };
            this.logger.warn(
              `[EXTERNAL API] [${profileKey}] Skipped — no auth token. Treating as no-profile.`,
            );
          } else {
            try {
              profileResult = await this._executeRequest(
                profileKey,
                userId,
                token,
                hookContext,
                '',
                'POST',
                true,
              );
            } catch (err: unknown) {
              profileResult = {
                success: false,
                data: { message: (err as Error).message },
                error: (err as Error).message,
                status: 500,
                duration: 0,
                method: 'POST',
                url: '',
              };
            }

            try {
              if (profileResult.success && profileResult.status === 200) {
                await redisClient.setex(
                  redisKey,
                  REDIS_CACHE_TTL_SEC,
                  JSON.stringify(profileResult),
                );
                this.logger.log(
                  `[EXTERNAL API] [${profileKey}] Cached to Redis for 12 hours.`,
                );
              } else {
                await redisClient.setex(
                  redisKey,
                  30 * 60,
                  JSON.stringify(profileResult),
                );
                this.logger.log(
                  `[EXTERNAL API] [${profileKey}] Failed/404, Cached to Redis for 30 minutes.`,
                );
              }
            } catch (err: unknown) {
              this.logger.error(
                `[EXTERNAL API] Redis Set Error: ${(err as Error).message}`,
              );
            }

            if (isFetchOk(profileResult)) {
              try {
                await this.memberModel
                  .updateOne(
                    { line_user_id: userId },
                    {
                      $set: withStamp(
                        {},
                        'raw_profile_data',
                        'profile_data_updated_at',
                        profileResult.data,
                      ),
                    },
                  )
                  .exec();
              } catch (memberErr: unknown) {
                this.logger.error(
                  `[EXTERNAL API] [${profileKey}] raw_profile_data update error: ${(memberErr as Error).message}`,
                );
              }
            }
          }
        }

        responses.push({ key: profileKey, result: profileResult });
        profileFailed = !profileResult.success || profileResult.status === 404;
      }

      if (profileFailed) {
        this.logger.log(
          '[EXTERNAL API] Profile fetch failed or 404. Skipping remaining requests.',
        );
      } else {
        const fetchTasks = otherEntries.map(async ([key]) => {
          const redisKey = `extapi:${this.envNamespace}:${hookAlias}:${key}:${userId}`;
          try {
            try {
              const cached = await redisClient.get(redisKey);
              if (cached) {
                this.logger.log(
                  `[EXTERNAL API] [${key}] Loaded from Redis cache.`,
                );
                return {
                  key,
                  result: JSON.parse(cached) as RequestExecutionResult,
                };
              }
            } catch (err: unknown) {
              this.logger.error(
                `[EXTERNAL API] [${key}] Redis Get Error: ${(err as Error).message}`,
              );
            }

            const result = await this._executeRequest(
              key,
              userId,
              token,
              hookContext,
              '',
              'POST',
              true,
            );
            if (!result.success) {
              this.logger.warn(
                `[EXTERNAL API] [${key}] Fetch failed: ${result.error || ''}`,
              );
            }

            if (result.success && result.status === 200) {
              try {
                await redisClient.setex(
                  redisKey,
                  REDIS_CACHE_TTL_SEC,
                  JSON.stringify(result),
                );
                this.logger.log(
                  `[EXTERNAL API] [${key}] Cached to Redis for 12 hours.`,
                );
              } catch (err: unknown) {
                this.logger.error(
                  `[EXTERNAL API] [${key}] Redis Set Error: ${(err as Error).message}`,
                );
              }
            }
            return { key, result };
          } catch (err: unknown) {
            this.logger.error(
              `[EXTERNAL API] [${key}] Critical Error: ${(err as Error).message}`,
            );
            return {
              key,
              result: {
                success: false,
                data: { message: (err as Error).message },
                error: (err as Error).message,
                status: 500,
                duration: 0,
                method: 'POST',
                url: '',
              },
            };
          }
        });
        const otherResponses = await Promise.all(fetchTasks);
        responses.push(...otherResponses);
      }

      const combinedResult: Record<string, unknown> = {};

      for (const { key, result } of responses) {
        const apiResponse = {
          status: result.success ? 'success' : 'error',
          data: result.data || { message: result.error },
          duration: result.duration || 0,
        };

        combinedResult[key] = apiResponse;

        const endpointData = await this._getEndpoint(key, endpoints);
        const resolvedPath = this._resolvePath(endpointData.path, {
          line_user_id: userId,
          userId,
        });
        combinedResult[`Path : ${resolvedPath}`] = apiResponse;
        combinedResult[resolvedPath] = apiResponse;

        const templatePath = (endpointData.path || '').replace(/^\/+/, '');
        if (templatePath) {
          combinedResult[`Path : ${templatePath}`] = apiResponse;
          combinedResult[templatePath] = apiResponse;
        }

        const rawData = apiResponse.data;
        combinedResult[key.toLowerCase()] = rawData;
        if (endpointData.sub_type) {
          combinedResult[`Path : ${endpointData.sub_type}`] = rawData;
          combinedResult[endpointData.sub_type] = rawData;
        }

        if (profileEntry && key === profileEntry[0]) {
          combinedResult['Path : api/v1/customer'] = rawData;
          combinedResult['api/v1/customer'] = rawData;
        }

        if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
          const objRaw = rawData as Record<string, unknown>;
          Object.keys(objRaw).forEach((uKey) => {
            const commonKeys = [
              'data',
              'customer',
              'member',
              'contract',
              'product',
              'installment',
            ];
            if (!combinedResult[uKey] || commonKeys.includes(uKey)) {
              combinedResult[uKey] = objRaw[uKey];
            }
          });
        }
      }

      this.logger.log(
        `[EXTERNAL API] Combined Fetch Complete. Fetched ${responses.length} endpoints.`,
      );
      return combinedResult;
    } catch (error: unknown) {
      this.logger.error(
        `[EXTERNAL API] Combined Data Fetch Error: ${(error as Error).message}`,
      );
      return { _error: (error as Error).message };
    }
  }
}

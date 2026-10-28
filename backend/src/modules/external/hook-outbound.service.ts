/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/hook/hookController.js
 *   · pushMessage              (2561) → POST /hook/:id/push
 *   · testExternalApi          (2951) → POST /hook/:id/test-external-api
 *   · executeExternalEndpoint  (3175) → POST /hook/:id/execute-external-endpoint
 *   · compareExternalApi       (3299) → POST /hook/compare-external-api
 * and legacy-api/src/controllers/hook/customToolController.js
 *   · testCustomTool           (504)  → POST /api/custom-tools/:id/test
 *
 * WHY THESE FIVE LIVE HERE AND NOT IN THE HOOKS MODULE
 * Every one of them fires an OUTBOUND request — LINE's push API, the operator's
 * external API, or a custom tool — so all five need ExternalApiService /
 * CustomToolService. Those live in this module, and this module already imports
 * `@/modules/hooks` for the Hook and CustomTool schemas. Wiring it the other way
 * (HooksModule importing ExternalModule) closes that loop, and this repo has
 * already been bitten once by a module cycle resolving to a half-initialised
 * module at boot — see the note on the `User` import in hooks.module.ts.
 * Routing is unaffected: Nest matches per method, and none of the five collide
 * with a route HooksController or CustomToolsController declares.
 *
 * ⚠️ THE PATHS ARE AT THE ROOT, NOT UNDER /api (except the custom-tool one).
 * The dashboard has `/hook/...` compiled in — services/dynamicTagService.ts and
 * components/HookFormModal.tsx call three of these directly.
 *
 * ⚠️ NO @RequirePermissions ON THE FOUR /hook ROUTES, deliberately: the legacy
 * routes carry no `authorize(...)` either. Same reasoning as hooks.controller.ts
 * — the accounts that use these screens hold the permission through their role,
 * not in their own claim, so a decorator 403s exactly them. Access is enforced
 * per hook by group scoping below. The custom-tool route DOES carry
 * `custom_tools.manage`, because legacy gates it (apiRoutes.js:507).
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types, isValidObjectId } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
// [FIX-20260818-PROBESSRF] `assertPublicUrl` moved to common/utils so the system
// module could reach it without closing a cycle. Same function, same behaviour.
// Direct path, matching how every other util here is imported (image-processor,
// date-range, escape-regex, password) — `@/common` deliberately re-exports none.
import { assertPublicUrl } from '@/common/utils/assert-public-url';
// [FIX-20260809-SEC-COMPARELEAK] the repo's existing credential masker — see
// the note at the compare-external-api response for why no new helper.
import { maskCredsDeep } from '@/common/utils/mask-creds';
import { CryptoService } from '@/infra/crypto';
import {
  Hook,
  // [FIX-20260818-OUTBOUNDSCOPE] audit H9 — the allowlist tier these routes never had
  assertHookInScope,
} from '@/modules/hooks';
// Deep import: `normalizeEndpoints` is not on the hooks barrel, and adding it
// there would widen that module's public surface for one caller. The draft-test
// route must normalise endpoints the SAME way `create` does, or a draft would
// be tested under different rules than the tool it becomes.
import { normalizeEndpoints } from '@/modules/hooks/custom-tool-normalize';
import { CustomTool } from '@/modules/hooks/schemas/custom-tool.schema';
import { SystemConfigService } from '@/modules/system';

import { CustomToolService } from './custom-tool.service';
import { ExternalApiService } from './external-api.service';
import { checkHeaderToken } from './utils/header-safe-token';

/** A hook row read with `.lean()` — an untyped bag of schema fields. */
type LeanHook = Record<string, unknown>;

/** A free-form JSON body. Legacy validates in the handler; so do we. */
export type OutboundBody = Record<string, unknown>;

/** Legacy's login probe budget (hookController.js:3129). */
const LOGIN_TEST_TIMEOUT_MS = 10_000;

/**
 * `String(value)` for a value whose static type is `unknown`.
 *
 * The legacy handlers call `String(...)` on these body fields directly, and
 * that includes the "[object Object]" it yields when the caller posts an object
 * where a string belongs. Reproducing that is the point: the same junk has to
 * reach the same URL or payload it reaches today, so a caller that is quietly
 * broken against legacy stays quietly broken here rather than changing shape.
 */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * Renders a hook's `group` value as the id string used for comparison.
 * Mirrors the private helper of the same name in hooks.service.ts — the three
 * shapes the field really holds are ObjectId, bare string, and a populated
 * subdocument, and a plain `String()` on the last silently yields
 * "[object Object]", which reads as "insufficient group access" not as a bug.
 */
function groupIdToString(groupId: unknown): string {
  if (typeof groupId === 'string') return groupId;
  if (groupId instanceof Types.ObjectId) return groupId.toHexString();
  if (groupId && typeof groupId === 'object') {
    const id = (groupId as { _id?: unknown })._id;
    if (typeof id === 'string') return id;
    if (id instanceof Types.ObjectId) return id.toHexString();
  }
  return '';
}

/** Structural fingerprint of a value — types only, keys sorted. */
function getStructure(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    // Arrays are assumed homogeneous for comparison purposes: the first
    // element's structure stands for the whole list.
    return [getStructure(obj[0])];
  }
  if (obj !== null && typeof obj === 'object') {
    const structure: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      structure[key] = getStructure((obj as Record<string, unknown>)[key]);
    }
    return structure;
  }
  return typeof obj;
}

interface StructureDiff {
  match: boolean;
  diffs?: Array<{ path: string; error: string }>;
}

/** Compares two fingerprints and names every place they differ. */
function compareStructures(base: unknown, target: unknown): StructureDiff {
  if (JSON.stringify(base) === JSON.stringify(target)) return { match: true };

  const diffs: Array<{ path: string; error: string }> = [];

  const findDiffs = (b: unknown, t: unknown, path = ''): void => {
    if (typeof b !== typeof t) {
      diffs.push({
        path,
        error: `Type mismatch: expected ${typeof b}, got ${typeof t}`,
      });
      return;
    }

    if (Array.isArray(b)) {
      if (!Array.isArray(t)) {
        diffs.push({
          path,
          error: `Structure mismatch: expected Array, got ${typeof t}`,
        });
      } else if (b.length > 0 && t.length > 0) {
        findDiffs(b[0], t[0], `${path}[]`);
      }
      return;
    }

    if (b !== null && typeof b === 'object') {
      const bRec = b as Record<string, unknown>;
      const tRec = (t ?? {}) as Record<string, unknown>;
      const bKeys = Object.keys(bRec);
      const tKeys = Object.keys(tRec);

      const missing = bKeys.filter((k) => !tKeys.includes(k));
      const extra = tKeys.filter((k) => !bKeys.includes(k));
      if (missing.length > 0) {
        diffs.push({ path, error: `Missing keys: ${missing.join(', ')}` });
      }
      if (extra.length > 0) {
        diffs.push({ path, error: `Extra keys: ${extra.join(', ')}` });
      }

      for (const key of bKeys.filter((k) => tKeys.includes(k))) {
        findDiffs(bRec[key], tRec[key], path ? `${path}.${key}` : key);
      }
    }
  };

  findDiffs(base, target);
  return { match: false, diffs };
}

@Injectable()
export class HookOutboundService {
  private readonly logger = new Logger(HookOutboundService.name);

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    /* [FIX-20260820-KILLDEADPUSH] `webhookLogModel` was injected only for the
       deleted push route's own audit row; the remaining routes log through
       ExternalApiService. */
    // Read-only, and only by the draft test: a blank secret on the edit form
    // means "keep the stored one", so the saved row has to be reloaded.
    @InjectModel(CustomTool.name)
    private readonly customToolModel: Model<CustomTool>,
    private readonly crypto: CryptoService,
    private readonly systemConfig: SystemConfigService,
    private readonly externalApi: ExternalApiService,
    private readonly customTool: CustomToolService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Access helpers — same semantics and the same three messages as the
  // private pair in hooks.service.ts:249-274. Not shared through a common
  // helper in this change: collapsing them would edit a 1,900-line service
  // that 380 golden cases currently pin, for no behavioural gain.
  // ─────────────────────────────────────────────────────────────────────

  private getAllowedGroupIds(user?: AuthenticatedUser): string[] {
    const groups = Array.isArray(user?.groups) ? user.groups : [];
    return groups.filter((id) => isValidObjectId(id)).map((id) => String(id));
  }

  private ensureGroupAccess(
    user: AuthenticatedUser | undefined,
    groupId: unknown,
  ): void {
    if (isSuperUser(user)) return;

    const allowed = this.getAllowedGroupIds(user);
    if (allowed.length === 0) {
      throw new ForbiddenException('group access is required');
    }
    if (!groupId) {
      throw new ForbiddenException('group is required');
    }
    if (!allowed.includes(groupIdToString(groupId))) {
      throw new ForbiddenException('insufficient group access');
    }
  }

  /** `x || ""` — legacy treats any falsy value as the empty string. */
  private static asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private static asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  async testExternalApi(
    id: string,
    body: OutboundBody,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Hook ID format');
    }

    const hook = await this.hookModel.findById(id).lean<LeanHook>().exec();
    // Plain NotFoundException — this route answers `{ error: 'Hook not found' }`
    // where /hook/:id answers `{ message: ... }`.
    if (!hook) throw new NotFoundException('Hook not found');

    // [SEC-H1] group guard. Without it any user could borrow any hook's
    // credential by putting a foreign hook id in the URL (IDOR).
    this.ensureGroupAccess(user, hook['group']);
    // [FIX-20260818-OUTBOUNDSCOPE] audit H9 — same gap as pushMessage.
    await assertHookInScope(user, this.hookModel, hook['_id']);

    /**
     * [FIX-20260729-DYTAGTOOL] "PRIMARY CREDENTIAL SOURCE".
     * A tag can serve a whole group, so the preview has to name which OA's
     * credential to borrow. Not sent = use the hook in the URL, which is the
     * single-OA case. Runtime is unaffected: the webhook resolves the tool from
     * the OA the message arrived on.
     */
    let credHook: LeanHook = hook;
    const primaryCredId = body['primary_credential_source'];
    if (
      primaryCredId &&
      isValidObjectId(primaryCredId) &&
      str(primaryCredId) !== id
    ) {
      const picked = await this.hookModel
        .findById(str(primaryCredId))
        .lean<LeanHook>()
        .exec();
      if (!picked) {
        throw new BadRequestException(
          'ไม่พบ OA ที่เลือกเป็นแหล่ง credential (PRIMARY CREDENTIAL SOURCE) — เลือกใหม่อีกครั้ง',
        );
      }
      credHook = picked;
    }

    // ── OA wired to a custom tool: login through the tool, same call the
    //    Custom Tools page's test button makes. No endpoint is fired.
    if (credHook['custom_tool_status'] === true && credHook['custom_tool_id']) {
      const started = Date.now();
      try {
        const tool = await this.customTool.getToolForHook({
          custom_tool_status: credHook['custom_tool_status'] as boolean,
          custom_tool_id: credHook['custom_tool_id'] as Types.ObjectId,
        });
        if (!tool) {
          throw new BadRequestException(
            'OA นี้เปิดใช้ Custom Tool ไว้ แต่หา tool ที่ผูกไม่เจอ (อาจถูกลบหรือปิดอยู่) — ตรวจที่เมนู Custom Tools',
          );
        }

        const result = await this.customTool.testConnection(tool, {
          userId: 'TEST_USER',
        });
        const steps = result.steps ?? [];
        const loginStep: Record<string, unknown> =
          steps.find((s) => s['ok'] && s['key']) ?? steps[0] ?? {};

        return {
          request: {
            url: loginStep['url'] || `${tool.base_url}`,
            method: loginStep['method'] || 'POST',
            headers: { 'Content-Type': 'application/json' },
            // The real credential never goes back to the screen.
            body: { username: tool.username || '', password: '********' },
          },
          response: {
            status: loginStep['status'] ?? null,
            statusText: loginStep['ok'] ? 'OK' : 'FAILED',
            headers: {},
            data: loginStep['response'] ?? null,
          },
          error: result.ok
            ? null
            : {
                message:
                  result.message || loginStep['message'] || 'login ไม่สำเร็จ',
              },
          duration_ms: Date.now() - started,
          token: result.ok
            ? '(ได้ token แล้ว — ถูกซ่อนไว้เพื่อความปลอดภัย)'
            : null,
          source: 'custom_tool',
          tool_name: tool.name || '',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        this.logger.error(
          `[DYTAGTOOL] custom tool login test failed: ${(error as Error).message}`,
        );
        // Legacy: 500 with this exact prefix (hookController.js:3049).
        throw new InternalServerErrorException(
          `ทดสอบ login ผ่าน Custom Tool ไม่สำเร็จ: ${(error as Error).message}`,
        );
      }
    }

    // ── Original wiring: credentials inline on the hook / system config ──
    // ⚠️ 500, not 400, on rejection — see the note on assertPublicUrl.
    assertPublicUrl(body['external_api_url']);

    let baseUrl =
      HookOutboundService.asString(body['external_api_url']) ||
      HookOutboundService.asString(credHook['external_api_url']);
    let username =
      HookOutboundService.asString(body['external_user']) ||
      HookOutboundService.asString(credHook['external_user']);
    let password =
      HookOutboundService.asString(body['external_password']) ||
      HookOutboundService.asString(
        this.crypto.safeDecrypt(
          HookOutboundService.asString(credHook['external_password']),
        ),
      );

    if (!baseUrl) {
      const row = await this.systemConfig.getConfigByKey(
        'EXTERNAL_API_BASE_URL',
      );
      baseUrl = HookOutboundService.asString(row?.value);
    }
    if (!username) {
      const row = await this.systemConfig.getConfigByKey(
        'EXTERNAL_API_USERNAME',
      );
      username = HookOutboundService.asString(row?.value);
    }
    if (!password) {
      const row = await this.systemConfig.getConfigByKey(
        'EXTERNAL_API_PASSWORD',
      );
      password = HookOutboundService.asString(row?.value);
    }

    if (!baseUrl) {
      throw new BadRequestException(
        'API URL not configured in Hook or System Config',
      );
    }
    baseUrl = baseUrl.replace(/\/$/, '');

    /**
     * [FEAT-20260728-DYNPROFILE] Resolve the login endpoint the way
     * externalApiService.login() does — `is_login: true`, then the key "LOGIN",
     * then the hardcoded fallback path. A hook with no endpoint config lands on
     * exactly the old behaviour.
     */
    const hookEndpoints =
      HookOutboundService.asRecord(credHook['external_endpoints']) ?? {};
    let loginKey: string | null = null;
    let loginCfg: Record<string, unknown> | null = null;
    for (const [epKey, epVal] of Object.entries(hookEndpoints)) {
      const row = HookOutboundService.asRecord(epVal);
      if (row && row['is_login'] === true) {
        loginKey = epKey;
        loginCfg = row;
        break;
      }
    }
    if (!loginCfg && hookEndpoints['LOGIN']) {
      loginKey = 'LOGIN';
      loginCfg = HookOutboundService.asRecord(hookEndpoints['LOGIN']);
    }

    let testUrl = `${baseUrl}/api/v1/auth/login`;
    let loginMethod = 'POST';
    let loginRequestType = 'json';
    let payload: Record<string, unknown> = { username, password };

    if (loginCfg && loginCfg['path']) {
      testUrl = `${baseUrl}/${str(loginCfg['path']).replace(/^\/+/, '')}`;
      loginMethod = str(loginCfg['method'] || 'POST').toUpperCase();
      loginRequestType = str(loginCfg['request_type'] || 'json').toLowerCase();
      const configured = HookOutboundService.asRecord(loginCfg['payload']);
      const rawPayload =
        configured && Object.keys(configured).length > 0
          ? configured
          : { username: '{{username}}', password: '{{password}}' };
      payload = {};
      for (const [pk, pv] of Object.entries(rawPayload)) {
        payload[pk] =
          typeof pv === 'string'
            ? pv
                .replace(/{{\s*username\s*}}/g, username)
                .replace(/{{\s*password\s*}}/g, password)
            : pv;
      }
      this.logger.log(
        `[TEST-EXTERNAL-API] Dynamic login via [${loginKey}] → ${loginMethod} ${testUrl}`,
      );
    }

    const isFormLogin =
      loginRequestType === 'form' || loginRequestType === 'form-data';
    const loginContentType = isFormLogin
      ? 'application/x-www-form-urlencoded'
      : 'application/json';

    const startTime = Date.now();
    let responseDetails: Record<string, unknown> = {};
    let errorDetails: Record<string, unknown> | null = null;

    try {
      const axiosRes = await axios({
        method: loginMethod,
        url: testUrl,
        data:
          loginMethod !== 'GET'
            ? isFormLogin
              ? new URLSearchParams(
                  payload as unknown as Record<string, string>,
                )
              : payload
            : undefined,
        headers: { 'Content-Type': loginContentType },
        timeout: LOGIN_TEST_TIMEOUT_MS,
        validateStatus: () => true, // capture every status, do not throw
      });
      responseDetails = {
        status: axiosRes.status,
        statusText: axiosRes.statusText,
        headers: axiosRes.headers,
        data: axiosRes.data,
      };
    } catch (err) {
      errorDetails = {
        message: (err as Error).message,
        code: (err as { code?: string }).code,
      };
    }

    const data = HookOutboundService.asRecord(responseDetails['data']);
    const nested = HookOutboundService.asRecord(data?.['data']);
    return {
      request: {
        url: testUrl,
        method: loginMethod,
        headers: { 'Content-Type': loginContentType },
        body: payload,
      },
      response: responseDetails,
      error: errorDetails,
      duration_ms: Date.now() - startTime,
      token: data?.['access_token'] ?? nested?.['access_token'] ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /hook/:id/execute-external-endpoint  — the preview button on the
  // Dynamic Tag form (dashboard: services/dynamicTagService.ts:192)
  // ═══════════════════════════════════════════════════════════════════════

  async executeExternalEndpoint(
    id: string,
    body: OutboundBody,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const endpointKey = body['endpoint_key'];
    const lineUserId = body['line_user_id'];
    const token = body['token'];
    const additionalData =
      HookOutboundService.asRecord(body['additional_data']) ?? {};

    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Hook ID format');
    }
    if (!endpointKey) {
      throw new BadRequestException('endpoint_key is required');
    }
    if (!lineUserId) {
      throw new BadRequestException('line_user_id is required');
    }

    const hook = await this.hookModel.findById(id).lean<LeanHook>().exec();
    if (!hook) throw new NotFoundException('Hook not found');

    // [SEC-H1] group guard — same IDOR as test-external-api.
    this.ensureGroupAccess(user, hook['group']);
    // [FIX-20260818-OUTBOUNDSCOPE] audit H9 — same gap as pushMessage.
    await assertHookInScope(user, this.hookModel, hook['_id']);

    /**
     * [FIX-20260730-TOKENLEAK] Do not trust a token that came from the browser.
     * The login route deliberately returns a STATUS LABEL rather than the real
     * token; the frontend stores that label and posts it back here. Putting it
     * in a header would produce `Authorization: Bearer <Thai sentence>`, which
     * Node rejects outright. Anything unusable is dropped and the service logs
     * in for itself — so the real token never travels through the browser.
     */
    const tokenCheck = checkHeaderToken(token);
    const safeToken = tokenCheck.ok ? (tokenCheck.value ?? null) : null;
    if (token && !tokenCheck.ok) {
      this.logger.warn(
        `[EXEC-ENDPOINT] ไม่ใช้ token ที่ client ส่งมา (${tokenCheck.reason}) — ให้ระบบ login เอง`,
      );
    }

    /**
     * [FIX-20260730-DYTAGROUTE] Fire down the right pipe. This route used to go
     * to externalApiService unconditionally, so an OA that had moved to a
     * custom tool (and has no external_api_url at all) was pointed at stale
     * config and got an HTML page back. The condition is the same one the
     * webhook and the login route use, so there is no third standard.
     */
    if (hook['custom_tool_status'] === true && hook['custom_tool_id']) {
      const tool = await this.customTool.getToolForHook({
        custom_tool_status: hook['custom_tool_status'] as boolean,
        custom_tool_id: hook['custom_tool_id'] as Types.ObjectId,
      });
      if (!tool) {
        throw new BadRequestException(
          'OA นี้เปิดใช้ Custom Tool ไว้ แต่หา tool ที่ผูกไม่เจอ (อาจถูกลบหรือปิดอยู่) — ตรวจที่เมนู Custom Tools',
        );
      }

      /**
       * [FIX-20260802-PREVIEWWEBCODE] The preview needs the OA's `web_code` for
       * the same reason the webhook does: without it `{{web_code}}` stays
       * unresolved, hmacSigner signs an empty value and the far end answers
       * "signature verification failed". A value the operator typed still wins.
       */
      const previewIdentity: Record<string, unknown> = { ...additionalData };
      if (
        hook['customer_link_web_code'] &&
        previewIdentity['web_code'] === undefined
      ) {
        previewIdentity['web_code'] = hook['customer_link_web_code'];
      }

      const r = await this.customTool.call(
        tool,
        str(endpointKey),
        str(lineUserId),
        previewIdentity,
      );
      // Reshaped into what the frontend already expects.
      return {
        success: r.success === true,
        data: r.data,
        status: r.status,
        duration: r.duration,
        method: r.method,
        url: r.url,
        ...(r.success ? {} : { error: r.error }),
      };
    }

    return this.externalApi.executeExternalEndpoint(
      hook,
      str(endpointKey),
      str(lineUserId),
      safeToken,
      additionalData,
    ) as unknown as Record<string, unknown>;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /hook/compare-external-api  — the "compare structure" button in the
  // hook form (dashboard: components/HookFormModal.tsx:602)
  // ═══════════════════════════════════════════════════════════════════════

  async compareExternalApi(
    body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    const externalApiUrl = body['external_api_url'];
    const externalUser = body['external_user'];
    const externalPassword = body['external_password'];

    // [SEC-H1] this route takes the URL straight off the body = SSRF.
    // ⚠️ 500, not 400, on rejection — see the note on assertPublicUrl.
    assertPublicUrl(externalApiUrl);

    const baseUserId = body['current_line_user_id'] || body['line_user_id'];
    const targetUserId = body['new_line_user_id'] || body['line_user_id'];

    if (!baseUserId || !targetUserId) {
      throw new BadRequestException(
        'line_user_id (or current_line_user_id and new_line_user_id) is required for comparison',
      );
    }

    // 1. "Current" — read through the system config.
    const currentData = await this.externalApi.getCombinedData(
      str(baseUserId),
      null,
    );
    // 2. "New" — read through the credentials the form supplied.
    const newData = await this.externalApi.getCombinedData(str(targetUserId), {
      external_api_url: externalApiUrl,
      external_user: externalUser,
      external_password: externalPassword,
    });

    // 3. Compare, path by path.
    const comparison: Record<string, unknown> = {};
    const paths = Object.keys(currentData).filter((k) => !k.startsWith('_'));

    for (const path of paths) {
      const baseRaw = currentData[path];
      const targetRaw = newData[path];
      const baseStructure = getStructure(baseRaw);
      const targetStructure = getStructure(targetRaw);
      const diff = compareStructures(baseStructure, targetStructure);

      comparison[path] = {
        success: diff.match,
        diffs: diff.diffs || [],
        raw: { current: baseRaw, new: targetRaw },
        structure: { current: baseStructure, new: targetStructure },
      };
    }

    const rows = Object.values(comparison) as Array<{ success: boolean }>;
    return {
      success: true,
      current_line_user_id: baseUserId,
      new_line_user_id: targetUserId,
      /**
       * ==== [FIX-20260809-SEC-COMPARELEAK] secrets are masked in this reply ====
       *
       * WHAT WAS WRONG: this block returned `password: externalPassword` as
       * PLAINTEXT, and `current` embeds the whole `_getApiConfig()` result which
       * carries the stored credentials too. Anyone who could reach the endpoint
       * got working credentials back in a JSON body — and the route has no
       * permission guard (hook-outbound.controller.ts:55, unlike the tools
       * controller at :112 which does). ทั้งสองช่องเคยคืนรหัสผ่านดิบ.
       *
       * WHY `maskCredsDeep` AND NOT A NEW HELPER: the repo already has one
       * (`common/utils/mask-creds.ts`), already used by payment-runner and
       * handoff-chain, and its key pattern is WIDER than a hand-rolled list —
       * it catches secret/password/token/signature/api_key/access_token/
       * refresh_token/client_secret/web_code/bearer/authorization/x-sign.
       * Adding a second masking helper would leave two competing definitions
       * and the next reader guessing which one is authoritative.
       *
       * ⚠️ NOTHING ELSE IN THE RESPONSE CHANGES. `maskCredsDeep` only rewrites
       * values whose KEY looks like a credential; every other field — baseUrl,
       * username, endpoints, the whole `comparison` and `summary` — is returned
       * byte-identical. The compare screen never displayed the password anyway,
       * so the UI is unaffected. ผลลัพธ์อื่นเหมือนเดิมทุกอย่าง.
       *
       * ⚠️ THIS IS MASKING ONLY — the route is still UNGUARDED. Adding
       * `@RequirePermissions` is a separate, behaviour-CHANGING commit: it can
       * lock out a caller that legitimately uses this today, so it must be
       * verified against real callers first rather than bundled in here.
       *
       * HOW TO CHANGE: to expose a field that the masker wrongly hides, rename
       * it so it does not match the credential pattern — do NOT unwrap this
       * call. revert: drop the two maskCredsDeep() wrappers.
       */
      configs: {
        // The WHOLE `{ config, endpoints, source }`, not just `config` —
        // legacy embeds the full return value here (hookController.js:3372).
        current: maskCredsDeep(await this.externalApi._getApiConfig(null)),
        target: maskCredsDeep({
          baseUrl: externalApiUrl,
          username: externalUser,
          password: externalPassword,
        }),
      },
      comparison,
      summary: {
        total: paths.length,
        matched: rows.filter((c) => c.success).length,
        mismatched: rows.filter((c) => !c.success).length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/custom-tools/:id/test
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fires for real at the configured destination (login, plus one endpoint when
   * `endpoint_key` is given) — but never writes a token belonging to a real
   * customer: the user id is `TEST_USER` unless one is supplied.
   *
   * A missing / disabled / soft-deleted tool is NOT a 404: `getTool` answers
   * null and `testConnection` reports it as `{ ok: false, message }` inside a
   * 200, which is what the form renders. That includes a malformed id.
   */
  async testCustomTool(
    id: string,
    body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    const result = await this.customTool.testConnection(id, {
      endpointKey: (body?.['endpoint_key'] as string) || null,
      userId: (body?.['user_id'] as string) || 'TEST_USER',
    });
    return { data: result };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/custom-tools/test-draft — legacy customToolController.js:463-502
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Tests a tool that has NOT been saved yet — the "ทดสอบ" button on the create
   * form, where there is no `_id` to look anything up by.
   *
   * Two things here are easy to get wrong and are copied from legacy exactly:
   *
   * 1. **A blank secret means "keep the stored one", not "send empty".** The
   *    edit form never receives the real password or api_key back (they are
   *    stripped on read), so an operator editing a saved tool submits them
   *    blank. Legacy:471-477 therefore reloads the saved document by `b.id` and
   *    borrows whichever secret was left blank. Without this, pressing test on
   *    an existing tool would authenticate with an empty password and report a
   *    failure that says nothing about the real configuration.
   *
   * 2. **A newly typed secret arrives as plaintext and must be encrypted first**
   *    (legacy:486-487), because `testConnection` reads both through
   *    `safeDecrypt`. Handing it plaintext would decrypt to gibberish. The
   *    already-stored values are left as-is — they are ciphertext already.
   *
   * `_id: 'draft'` (legacy:480) is not cosmetic: the circuit breaker and token
   * cache key off it, so an unsaved draft cannot trip or poison the breaker
   * belonging to a real saved tool.
   */
  async testDraftCustomTool(
    body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    const baseUrl = body?.['base_url'];
    if (!baseUrl || !String(baseUrl).trim()) {
      throw new BadRequestException('ต้องระบุ base_url');
    }
    // [FIX-20260808-CUSTOOLSSRF] H-S4 — test-draft takes `base_url` straight from
    // the request body and fires axios at it, so without this an operator could
    // point it at http://169.254.169.254/... or an internal host and read the
    // reflected response (SSRF). Scoped to the DRAFT test path only: the real
    // custom-tool runtime (webhook) resolves base_url from the stored, admin-set
    // tool, not from a request body, so it is untouched. Same private/loopback
    // hostname guard the external-api routes already use (500, not 400, by design).
    assertPublicUrl(baseUrl);

    const rawPassword = body['password'] ? String(body['password']) : '';
    const rawApiKey = body['api_key'] ? String(body['api_key']) : '';

    // Carried over from the saved row when the form left them blank.
    let storedPassword = '';
    let storedApiKey = '';
    const draftId = body['id'] ? String(body['id']) : '';
    if ((!rawPassword || !rawApiKey) && draftId && isValidObjectId(draftId)) {
      const saved = await this.customToolModel
        .findById(draftId)
        .lean<Record<string, unknown>>()
        .exec();
      if (saved) {
        if (!rawPassword) storedPassword = (saved['password'] as string) || '';
        if (!rawApiKey) storedApiKey = (saved['api_key'] as string) || '';
      }
    }

    const draft = {
      _id: draftId || 'draft',
      name: body['name'] ? String(body['name']) : '(ร่าง)',
      base_url: String(baseUrl).trim().replace(/\/+$/, ''),
      auth_type: body['auth_type'] ? String(body['auth_type']) : 'jwt_login',
      username: body['username'] ? String(body['username']) : '',
      // Newly typed → encrypt. Left blank → the stored ciphertext, untouched.
      password: rawPassword
        ? (this.crypto.encrypt(rawPassword) ?? '')
        : storedPassword,
      api_key: rawApiKey
        ? (this.crypto.encrypt(rawApiKey) ?? '')
        : storedApiKey,
      api_key_header: body['api_key_header']
        ? String(body['api_key_header'])
        : 'Authorization',
      timeout_ms: Number(body['timeout_ms']) || 8000,
      status: true,
      endpoints: normalizeEndpoints(body['endpoints']),
    };

    const result = await this.customTool.testConnection(
      draft as unknown as Parameters<CustomToolService['testConnection']>[0],
      {
        endpointKey: (body['endpoint_key'] as string) || null,
        userId: (body['user_id'] as string) || 'TEST_USER',
      },
    );
    return { data: result };
  }
}

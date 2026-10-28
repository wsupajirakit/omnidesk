/**
 * Outbound credential validation for the hook write path.
 *
 * Sources, ported 1:1:
 *   legacy-api/src/services/hook/lineKeyService.js        (verifyLineKey)
 *   legacy-api/src/services/core-bot/customAIKeyService.js (verifyKey)
 *   legacy-api/src/services/core-bot/docValidationService.js (verifyDocId)
 *
 * ⚠️ R10. Every method here makes a REAL request to a third party. They exist
 * because `POST /hook` refuses a credential it cannot verify, and dropping that
 * check would let a typo'd key be stored as valid — the failure then surfaces
 * days later as a silent webhook outage. What must never happen is a *test*
 * driving one of these with a value read from the database: the local database
 * is a clone of production, so that is a real billed call with a live key
 * leaving the machine. The golden suite therefore exercises only the paths that
 * return before the call is made (`undefined` = untouched, `""` = cleared,
 * unchanged value = re-use the stored ciphertext) and the report records the
 * success path as deliberately untested.
 *
 * Legacy uses axios; `fetch` is used here to avoid adding a dependency. The
 * observable contract is the error message, which is reproduced verbatim below.
 */

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { buildAiKeyProbe } from './ai-vendor/ai-key-probe';

const LINE_INFO_ENDPOINT = 'https://api.line.me/v2/bot/info';
const DOC_URL = (docId: string): string =>
  `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit`;
const DOC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 5000;

interface FetchOutcome {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  text: string;
  json: Record<string, unknown> | null;
  networkError: string | null;
}

@Injectable()
export class HookCredentialCheckService {
  /**
   * Verifies a LINE channel access token by asking LINE who it belongs to.
   * Legacy: lineKeyService.js:5-34.
   */
  async verifyLineKey(channelAccessToken: string): Promise<void> {
    if (!channelAccessToken) {
      throw new BadRequestException('Line key is required');
    }

    const outcome = await this.request(LINE_INFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    });
    if (outcome.ok) return;

    const message = this.messageFrom(outcome);
    throw new BadRequestException(
      `Line Access Token ! Line key verification failed: ${message.trim()}`,
    );
  }

  /**
   * Verifies an AI key against THE VENDOR THAT ISSUED IT.
   *
   * Legacy: customAIKeyService.js:7-29. The thrown error carries no statusCode
   * there, so the legacy handler answers **500 carrying this message verbatim**.
   *
   * [FIX-20260821-AIKEYERRVISIBLE] Both throws below were a plain `Error` to
   * reproduce that 500. It only ever reproduced HALF of it:
   * `AllExceptionsFilter.resolve` branches on `instanceof HttpException`, not on
   * status, so a plain Error became `500 internal error` — the status matched
   * and the message, which this file's header calls THE observable contract,
   * was destroyed. The operator saving a mistyped key saw a modal reading only
   * `internal error` and had nothing to act on. คีย์ผิดต้องบอกว่าผิดตรงไหน
   *
   * `InternalServerErrorException` keeps the status legacy answers AND lets the
   * text through. Do NOT "fix" this to `BadRequestException`: legacy really is
   * 500 here, and `common/interceptors/mongoose-error.interceptor.ts:69-76`
   * records the house rule that moving the status to rescue the body trades one
   * divergence for another. Pinned by
   * `z-test/unit/hook-ai-key-error-visible.spec.ts` — including a case proving
   * the filter's `internal error` default is NOT widened for anything else.
   *
   * [FIX-20260818-VENDORKEYPROBE · plan §7.4] This used to build Google's URL
   * unconditionally, so a DeepSeek key was posted to Google, rejected, and the
   * save failed — a DeepSeek key could not be stored at all, and the credential
   * reached a vendor it did not belong to. Which endpoint to ask now comes from
   * `ai-vendor/ai-key-probe.ts`, keyed by the hook's own `ai_vendor`.
   *
   * Gemini behaviour is unchanged byte for byte (same URL, key in the query
   * string, no headers) — every key stored today is a Gemini key.
   *
   * ⚠️ A probe whose answer we do not trust (`rejectOnFailure: false`) may fail
   * WITHOUT blocking the save. Rejecting on an endpoint we have never actually
   * called would make a working key unsaveable, which is the bug being fixed.
   */
  async verifyCustomAiKey(key: string, vendor?: string | null): Promise<void> {
    if (!key) throw new InternalServerErrorException('API key is required');

    const probe = buildAiKeyProbe(key, vendor);
    const outcome = await this.request(probe.url, {
      ...(Object.keys(probe.headers).length ? { headers: probe.headers } : {}),
    });
    if (outcome.ok) return;
    if (!probe.rejectOnFailure) return;

    const message = this.messageFrom(outcome);
    throw new InternalServerErrorException(
      `Custom AI KEY ! Key verification failed: ${message.trim()}`,
    );
  }

  /**
   * Verifies a Google Doc id is a readable document.
   * Legacy: docValidationService.js:7-52 — every failure mode, including a
   * network error, collapses to the same `invalid DOC_ID`.
   */
  async verifyDocId(docId: string): Promise<void> {
    if (!docId) throw new BadRequestException('invalid DOC_ID');

    const outcome = await this.request(DOC_URL(docId), {
      headers: { 'User-Agent': DOC_USER_AGENT },
      redirect: 'follow',
    });

    const valid =
      outcome.status === 200 &&
      outcome.url.includes('/edit') &&
      (outcome.text.includes('docs-icon-editors') ||
        outcome.text.includes('editor'));
    if (!valid) throw new BadRequestException('invalid DOC_ID');
  }

  /** Axios's error-message precedence, reproduced for `fetch`. */
  private messageFrom(outcome: FetchOutcome): string {
    if (outcome.networkError) return outcome.networkError;
    const body = outcome.json ?? {};
    const nested = body['error'];
    const nestedMessage =
      nested && typeof nested === 'object'
        ? (nested as Record<string, unknown>)['message']
        : undefined;

    for (const candidate of [
      body['message'],
      nestedMessage,
      body['error_description'],
    ]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    return `HTTP ${outcome.status} ${outcome.statusText}`;
  }

  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<FetchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* not JSON — the Docs check reads the raw HTML instead */
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        text,
        json,
        networkError: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: '',
        url: '',
        text: '',
        json: null,
        networkError: (error as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

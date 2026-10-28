import { BadRequestException, Injectable } from '@nestjs/common';
import { assertPublicUrl } from '@/common/utils/assert-public-url';

import type { TestCustomRequestDto } from './dto/system-config.dto';
import { SystemConfigService } from './system-config.service';

/** Legacy used a 10s axios timeout on both probes. */
const PROBE_TIMEOUT_MS = 10_000;

interface ProbeResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: unknown;
}

interface ProbeError {
  message: string;
  code?: string;
}

export interface ProbeResult {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: ProbeResponse;
  error: ProbeError | null;
  duration_ms: number;
  timestamp: string;
}

/**
 * Operator-driven outbound probes behind `/config/test-external-api` and
 * `/config/test-custom`.
 *
 * Uses the global `fetch` rather than pulling axios in for two calls. The
 * behaviour legacy relied on — never throw on a non-2xx status, capture it
 * instead (`validateStatus: () => true`) — is what `fetch` already does, so the
 * captured shape is unchanged.
 */
@Injectable()
export class ExternalProbeService {
  constructor(private readonly configService: SystemConfigService) {}

  private async send(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ response: ProbeResponse; error: ProbeError | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body:
          method === 'GET' || method === 'HEAD'
            ? undefined
            : JSON.stringify(body),
        signal: controller.signal,
      });
      // Match axios: parse JSON when the peer says JSON, otherwise keep text.
      const contentType = res.headers.get('content-type') ?? '';
      const data: unknown = contentType.includes('application/json')
        ? await res.json()
        : await res.text();
      return {
        response: {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          data,
        },
        error: null,
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      return {
        response: {},
        error: {
          message: error.message,
          ...(error.code !== undefined ? { code: error.code } : {}),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Probes the configured external API's login endpoint.
   *
   * ⚠️ Deviation from legacy, deliberate: legacy echoed the request body back
   * to the caller, which put `EXTERNAL_API_PASSWORD` in plaintext in the HTTP
   * response. The password is still *sent* upstream — that is the point of the
   * probe — but the echoed copy is masked. Returning a stored credential to a
   * browser is the one thing parity does not justify (R4 outranks parity).
   */
  async testExternalApi(): Promise<ProbeResult> {
    const keys = [
      'EXTERNAL_API_BASE_URL',
      'EXTERNAL_API_PASSWORD',
      'EXTERNAL_API_USERNAME',
    ];
    const configs = await Promise.all(
      keys.map((key) => this.configService.getConfigByKey(key)),
    );

    const configMap = new Map<string, string | null>();
    keys.forEach((key, i) => {
      const value = configs[i]?.['value'];
      configMap.set(key, typeof value === 'string' ? value : null);
    });

    const baseUrlRaw = configMap.get('EXTERNAL_API_BASE_URL');
    if (!baseUrlRaw) {
      throw new BadRequestException('EXTERNAL_API_BASE_URL not configured');
    }

    const baseUrl = baseUrlRaw.replace(/\/$/, '');
    const testUrl = `${baseUrl}/api/v1/auth/login`;
    const username = configMap.get('EXTERNAL_API_USERNAME');
    const password = configMap.get('EXTERNAL_API_PASSWORD');

    const startTime = Date.now();
    const { response, error } = await this.send(
      testUrl,
      'POST',
      { 'Content-Type': 'application/json' },
      { username, password },
    );

    return {
      request: {
        url: testUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Masked — see the note on this method.
        body: { username, password: password ? '***' : null },
      },
      response,
      error,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /** Sends whatever the operator described and reports what came back. */
  async testCustomRequest(dto: TestCustomRequestDto): Promise<ProbeResult> {
    if (!dto.url) {
      throw new BadRequestException('url is required');
    }
    /**
     * [FIX-20260818-PROBESSRF] audit_18_aug H14 — refuse BEFORE the request.
     *
     * This route returns the peer's status, every response header and the full
     * body, so it is a READ SSRF: cloud metadata, loopback services and the
     * internal network were one superadmin request away, and the answer came
     * back verbatim. Guarding after the fetch would already have leaked it.
     *
     * The shared guard is reused rather than reimplemented — it is the only SSRF
     * helper in the repo and was hardened today for the IPv6 bracket forms and
     * the link-local / unique-local / CGNAT ranges the original list missed.
     */
    assertPublicUrl(dto.url, 'url');
    const method = (dto.method ?? 'POST').toUpperCase();
    const headers = dto.headers ?? {};
    const data = dto.data ?? {};

    const startTime = Date.now();
    const { response, error } = await this.send(dto.url, method, headers, data);

    return {
      request: { url: dto.url, method, headers, body: data },
      response,
      error,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

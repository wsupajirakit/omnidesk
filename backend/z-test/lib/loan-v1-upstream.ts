/**
 * [FLOWTEST-20261014-LOANV1FIXTURE] The loan_v1 upstream, answered from its REAL answers.
 *
 * One place that turns the generated fixture (`z-test/fixtures/loan-v1-endpoints.ts`) into
 * what the shipped `CustomToolService` really produces: the real tool (seed bundle), the real
 * `_request` + `result_rules`, the real combined-data shape. Only axios is replaced.
 *
 * Shared by the fixture guard and the webhook flow matrix so neither carries its own copy of
 * the combined-data shape (line-flow-test §2: one truth per real shape).
 *
 * 🔴 THE CALLING SPEC MUST `jest.mock('axios')` — this file drives the mocked default export.
 */
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';

import { CryptoService } from '@/infra/crypto';
import { RedisService } from '@/infra/redis';
import { CustomToolService } from '@/modules/external';
import { WebhookLogWriter } from '@/modules/system';

import { LOAN_V1_SEED_BUNDLE } from '../../src/cli/custom-tool-seed/bundles/loan-v1.bundle';
import { LOAN_V1_ENDPOINTS } from '../fixtures/loan-v1-endpoints';

export interface SnapshotEndpoint {
  key: string;
  path: string;
  purpose?: string;
  is_login?: boolean;
  is_profile?: boolean;
  profile_map?: { name?: string; phone?: string; code?: string };
}
export interface SnapshotTool {
  name: string;
  base_url: string;
  endpoints: SnapshotEndpoint[];
}
export interface Sample {
  http_status: number | null;
  body: unknown;
}
export interface EndpointFixture {
  source: { rows: number; success: number; failure: number };
  success: Sample;
  failures: readonly Sample[];
}

/** the tool exactly as the seed CLI writes it */
export const LOAN_TOOL = LOAN_V1_SEED_BUNDLE.tool as unknown as SnapshotTool;
export const LOAN_FIXTURE = LOAN_V1_ENDPOINTS as unknown as Record<
  string,
  EndpointFixture
>;

/** Which endpoint a URL belongs to — by the static part of each tool path, longest first. */
const staticPart = (p: string): string => p.split('{{')[0]!.split('?')[0]!;
const ENDPOINT_BY_URL = [...LOAN_TOOL.endpoints].sort(
  (a, b) => staticPart(b.path).length - staticPart(a.path).length,
);
const keyForUrl = (url: string): string | undefined =>
  ENDPOINT_BY_URL.find((e) => url.includes(staticPart(e.path)))?.key;

/** Answer every call the way the upstream answered for real, per endpoint. */
export function answerWith(pick: (f: EndpointFixture) => Sample): void {
  (axios as unknown as jest.MockedFunction<typeof axios>).mockImplementation(
    ((cfg: { url?: string }) => {
      const key = keyForUrl(String(cfg.url));
      const f = key ? LOAN_FIXTURE[key] : undefined;
      if (!f)
        return Promise.reject(
          new Error(`no fixture answers ${String(cfg.url)}`),
        );
      const s = pick(f);
      if (s.http_status === 0 || s.http_status === null) {
        /* a transport failure: no response at all (the real row is a timeout) */
        return Promise.reject(
          Object.assign(
            new Error(String((s.body as { message?: string })?.message)),
            {
              code: 'ECONNABORTED',
            },
          ),
        );
      }
      if (s.http_status >= 400) {
        return Promise.reject(
          Object.assign(new Error(`status ${s.http_status}`), {
            response: { status: s.http_status, data: s.body },
          }),
        );
      }
      return Promise.resolve({ status: s.http_status, data: s.body });
    }) as never,
  );
}

/** The shipped service, with only "which tool / login / breaker storage" stubbed. */
export async function makeLoanToolService(): Promise<CustomToolService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CustomToolService,
      { provide: CryptoService, useValue: { safeDecrypt: (v: string) => v } },
      {
        provide: RedisService,
        useValue: {
          getClient: () => {
            throw new Error('no redis in unit test');
          },
        },
      },
      {
        provide: WebhookLogWriter,
        useValue: { persist: jest.fn().mockResolvedValue({}) },
      },
      { provide: getModelToken('CustomTool'), useValue: {} },
      { provide: getModelToken('Hook'), useValue: {} },
      {
        provide: getModelToken('Member'),
        useValue: { updateOne: () => ({ exec: () => Promise.resolve({}) }) },
      },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  const svc = moduleRef.get(CustomToolService);
  jest.spyOn(svc, 'getToolForHook').mockResolvedValue(LOAN_TOOL as never);
  jest.spyOn(svc, 'getToken').mockResolvedValue('tok');
  return svc;
}

/**
 * What the webhook's profile fetch receives for one customer, produced by the real engine:
 * `'linked'` = every endpoint's real success · `'unlinked'` = the real 404 profile + php
 * `status:false` failures.
 */
export async function loanCombined(
  who: 'linked' | 'unlinked',
  userId = 'U00000000000000000000000000000000',
): Promise<Record<string, unknown>> {
  const svc = await makeLoanToolService();
  answerWith((f) => (who === 'linked' ? f.success : f.failures[0]!));
  return await svc.getCombinedData(userId, {
    _id: 'h1',
    alias: 'loan-oa',
  } as never);
}

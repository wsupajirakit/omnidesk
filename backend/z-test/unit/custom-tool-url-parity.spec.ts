/**
 * Pins the URL CustomToolService builds against the URL legacy builds.
 *
 * Every expectation below is a string CAPTURED FROM THE RUNNING LEGACY BACKEND
 * (legacy-api), not a value derived by reading the port. Legacy's
 * `customToolService._request` was driven in-process against the real
 * `Shop-API v1` endpoint definitions and its `.url` recorded verbatim. Legacy is
 * the specification even where it looks wrong, so where legacy emits an
 * unsubstituted `{{web_code}}` this asserts exactly that.
 *
 * The three rules these cases lock down, all of which the port had broken:
 *
 *  1. `_resolve` only visits keys that EXIST in its variable bag. A placeholder
 *     whose key is absent survives LITERALLY. The port seeded
 *     `web_code: body.web_code || ''`, turning an absent value into `''` — a
 *     different URL on the test-fire route, which passes an empty body.
 *  2. The path is resolved against vars AND body, so a runtime `web_code`
 *     reaches a `{{web_code}}` sitting in the path.
 *  3. The GET query is built from the call body only, SKIPPING any key whose
 *     placeholder already appears in the path. Without the skip, `web_code`
 *     goes out twice on CUSTOMER_PROFILE.
 *
 * R10: axios is mocked, no credentials are used (auth_type 'none'), so nothing
 * leaves the process.
 */
import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { CryptoService } from '@/infra/crypto';
import { RedisService } from '@/infra/redis';
import { CustomToolService } from '@/modules/external';

jest.mock('axios');
const mockedAxios = axios as unknown as jest.MockedFunction<typeof axios>;

const BASE = 'https://api.example.com';
const UID = 'Ubad099ef9766d47be58cc2fd4c16244e';
const WEB_CODE = 'demo-omnidesk';

/** The real `Shop-API v1` endpoint definitions, as stored in `custom_tools`. */
const EP_PROFILE = {
  key: 'CUSTOMER_PROFILE',
  method: 'GET',
  path: 'shop-api/v1/customer?line_user_id={{line_user_id}}&web_code={{web_code}}',
  require_jwt: false,
  is_profile: true,
  role: 'profile',
  status: true,
};

const EP_SITE_RULES = {
  key: 'SITE_RULES',
  method: 'GET',
  path: 'shop-api/v1/site-rules?web_code={{web_code}}',
  require_jwt: false,
  role: '',
  status: true,
};

const TOOL = {
  _id: 'probe',
  name: 'Shop-API v1',
  base_url: BASE,
  auth_type: 'none',
  timeout_ms: 300,
};

describe('CustomToolService builds the same URL as legacy', () => {
  let service: CustomToolService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Fail every call the same way legacy's probe did; only `.url` is asserted.
    mockedAxios.mockRejectedValue(
      Object.assign(new Error('probe'), {
        response: { status: 599, data: {} },
      }),
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
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
        { provide: getModelToken('CustomTool'), useValue: {} },
        { provide: getModelToken('Hook'), useValue: {} },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    service = moduleRef.get(CustomToolService);
  });

  const urlFor = async (
    ep: Record<string, unknown>,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<string> => {
    const res = await service._request(
      TOOL as never,
      ep as never,
      userId,
      body,
      null,
    );
    return String((res as { url?: string }).url ?? '');
  };

  describe('test-fire route — empty body, so {{web_code}} stays literal', () => {
    it('CUSTOMER_PROFILE matches legacy verbatim', async () => {
      expect(await urlFor(EP_PROFILE, 'TEST_USER', {})).toBe(
        `${BASE}/shop-api/v1/customer?line_user_id=TEST_USER&web_code={{web_code}}`,
      );
    });

    it('SITE_RULES matches legacy verbatim', async () => {
      expect(await urlFor(EP_SITE_RULES, 'TEST_USER', {})).toBe(
        `${BASE}/shop-api/v1/site-rules?web_code={{web_code}}`,
      );
    });
  });

  describe('runtime route — web_code arrives from hook.customer_link_web_code', () => {
    const identity = { line_user_id: UID, web_code: WEB_CODE };

    it('CUSTOMER_PROFILE substitutes in the path and does not duplicate web_code', async () => {
      expect(await urlFor(EP_PROFILE, UID, { ...identity })).toBe(
        `${BASE}/shop-api/v1/customer?line_user_id=${UID}&web_code=${WEB_CODE}`,
      );
    });

    it('SITE_RULES appends line_user_id because its path has no placeholder for it', async () => {
      expect(await urlFor(EP_SITE_RULES, UID, { ...identity })).toBe(
        `${BASE}/shop-api/v1/site-rules?web_code=${WEB_CODE}&line_user_id=${UID}`,
      );
    });

    it('a body key with no placeholder in the path is appended as a query param', async () => {
      expect(
        await urlFor(EP_SITE_RULES, UID, { ...identity, extra_flag: 'zz' }),
      ).toBe(
        `${BASE}/shop-api/v1/site-rules?web_code=${WEB_CODE}&line_user_id=${UID}&extra_flag=zz`,
      );
    });
  });

  /**
   * The four real hooks that point at this tool, with the `web_code` each one
   * actually stores. `getCombinedData` builds `identity` as
   * `{ line_user_id }` plus `web_code` only when `hook.customer_link_web_code`
   * is set (custom-tool.service.ts:1141-1143, legacy customToolService.js:1123-1124),
   * so this reproduces that body exactly. Expectations captured from legacy.
   */
  describe.each([
    ['omnideskdevoa', 'demo-omnidesk'],
    ['devtwo', 'sim_beta'],
    ['demo-oa-three', 'demo-omnidesk'],
    ['devfour', 'demo-omnidesk'],
  ])('hook %s (web_code=%s)', (_alias, wc) => {
    const identity = { line_user_id: UID, web_code: wc };

    it('CUSTOMER_PROFILE carries that hook web_code exactly once', async () => {
      const built = await urlFor(EP_PROFILE, UID, { ...identity });
      expect(built).toBe(
        `${BASE}/shop-api/v1/customer?line_user_id=${UID}&web_code=${wc}`,
      );
      expect(built.match(/web_code=/g)).toHaveLength(1);
    });

    it('SITE_RULES carries that hook web_code exactly once', async () => {
      const built = await urlFor(EP_SITE_RULES, UID, { ...identity });
      expect(built).toBe(
        `${BASE}/shop-api/v1/site-rules?web_code=${wc}&line_user_id=${UID}`,
      );
      expect(built.match(/web_code=/g)).toHaveLength(1);
    });
  });
});

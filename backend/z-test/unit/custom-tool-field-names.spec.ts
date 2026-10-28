/**
 * Guards the field names CustomToolService reads off a stored tool.
 *
 * A module was merged that read `tool.auth_token`, `tool.hmac_secret`,
 * `tool.hmac_config`, `endpoint.token_ttl_sec`, `endpoint.timeout_sec` and
 * `endpoint.idempotency.body_field`. None of those exist — not on the schema,
 * not in any of the 35 stored `custom_tools` documents. It compiled against
 * nothing and every test written for it used the same invented vocabulary, so
 * the tests agreed with the bug.
 *
 * These tests therefore assert two things that a self-consistent test cannot:
 *
 *  1. Every name the service reads is a path the *schema* declares — the schema
 *     is generated from the real documents, so it is the outside authority.
 *  2. Feeding a tool the invented names changes nothing about the outbound
 *     request, while the real names change it. A read of a misspelled field is
 *     `undefined`, which silently falls back to a default; only asserting the
 *     real name has an effect catches that.
 *
 * R10: every credential here is a literal invented for the test and axios is
 * mocked, so nothing leaves the process.
 */
import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
import { RedisService } from '@/infra/redis';
import { CustomToolService } from '@/modules/external';
import { CustomToolSchema } from '@/modules/hooks';
import { WebhookLogWriter } from '@/modules/system';

jest.mock('axios');
const mockedAxios = axios as jest.MockedFunction<typeof axios>;

const FAKE_SECRET = 'test-only-not-a-real-secret';

describe('CustomToolService reads the field names real documents carry', () => {
  let service: CustomToolService;

  const mockCrypto = {
    // Mirrors the real safeDecrypt contract: `enc:`-prefixed in, plain out.
    safeDecrypt: jest.fn((val: string) => val?.replace('enc:', '') || ''),
  };
  const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomToolService,
        { provide: getModelToken('CustomTool'), useValue: {} },
        { provide: getModelToken('Hook'), useValue: {} },
        {
          provide: getModelToken('Member'),
          useValue: {
            findOne: jest.fn().mockReturnValue({
              lean: () => ({ exec: () => Promise.resolve(null) }),
            }),
            updateOne: jest
              .fn()
              .mockReturnValue({ exec: () => Promise.resolve({}) }),
          },
        },
        {
          /* [FEAT-20260827-WLOGONEDOOR] the service no longer injects the
           * WebhookLog MODEL — every webhook_logs write goes through the door. */
          provide: WebhookLogWriter,
          useValue: { persist: jest.fn().mockResolvedValue({}) },
        },
        { provide: CryptoService, useValue: mockCrypto },
        {
          provide: RedisService,
          useValue: { getClient: () => mockRedisClient },
        },
        /* [FIX-20260905-GLOBALNS] `CustomToolService` / `ExternalApiService` now
           derive a per-environment Redis namespace at construction, so the two
           config slices they read have to exist in the testing module too. */
        {
          provide: realtimeConfig.KEY,
          useValue: { wsEnv: 'dev' },
        },
        {
          provide: mongoConfig.KEY,
          useValue: { uri: 'mongodb://127.0.0.1:27017/testdb' },
        },
      ],
    }).compile();

    service = module.get(CustomToolService);
  });

  /** The config axios was called with. Fails loudly if no call was made. */
  const lastCall = (): Record<string, unknown> => {
    const call = mockedAxios.mock.calls[0];
    if (!call) throw new Error('axios was never called');
    return call[0] as unknown as Record<string, unknown>;
  };
  const lastHeaders = () =>
    lastCall().headers as Record<string, string | undefined>;

  const makeTool = (over: Record<string, unknown> = {}) =>
    ({
      _id: 'a0d00000000000000000000a',
      name: 'Fixture Tool',
      base_url: 'https://api.example.test',
      auth_type: 'none',
      username: '',
      password: '',
      api_key: '',
      api_key_header: 'Authorization',
      timeout_ms: 8000,
      status: true,
      endpoints: [],
      ...over,
    }) as never;

  const makeEndpoint = (over: Record<string, unknown> = {}) =>
    ({
      key: 'FIXTURE',
      path: 'api/thing',
      method: 'POST',
      request_type: 'json',
      require_jwt: false,
      status: true,
      payload: {},
      ...over,
    }) as never;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. The schema is the outside authority on the vocabulary.
  // ───────────────────────────────────────────────────────────────────────────

  describe('schema declares every name the service relies on', () => {
    const endpointSchema = CustomToolSchema.path('endpoints') as unknown as {
      schema: { path: (p: string) => unknown };
    };

    it.each(['timeout_ms', 'api_key', 'api_key_header', 'auth_type'])(
      'tool schema declares %s',
      (p) => {
        expect(CustomToolSchema.path(p)).toBeDefined();
      },
    );

    it.each(['cache_ttl_sec', 'token_path', 'request_type'])(
      'endpoint schema declares %s',
      (p) => {
        expect(endpointSchema.schema.path(p)).toBeDefined();
      },
    );

    // The exact names the broken module invented. If one of these ever starts
    // resolving, someone has added a field to satisfy code instead of data.
    it.each(['auth_token', 'hmac_secret', 'hmac_config', 'timeout_sec'])(
      'tool schema does NOT declare invented field %s',
      (p) => {
        expect(CustomToolSchema.path(p)).toBeUndefined();
      },
    );

    it.each(['token_ttl_sec', 'timeout_sec', 'body_field', 'header_name'])(
      'endpoint schema does NOT declare invented field %s',
      (p) => {
        expect(endpointSchema.schema.path(p)).toBeUndefined();
      },
    );

    it('nests the hmac recipe under `hmac`, with the sub-keys the signer reads', () => {
      for (const k of [
        'algorithm',
        'encoding',
        'message',
        'headers',
        'timestamp_unit',
        'canonical_json',
        'web_code_field',
      ]) {
        expect(CustomToolSchema.path(`hmac.${k}`)).toBeDefined();
      }
    });

    it('keeps one `field` + `location` for idempotency, not a header/body pair', () => {
      // Declared with raw(), so it is an inline nested path (see below).
      expect(
        (
          endpointSchema.schema as unknown as {
            pathType: (p: string) => string;
          }
        ).pathType('idempotency'),
      ).toBe('nested');
      for (const k of ['enabled', 'location', 'field', 'retry_on_timeout']) {
        expect(endpointSchema.schema.path(`idempotency.${k}`)).toBeDefined();
      }
    });

    /**
     * `hmac` and `idempotency` must stay INLINE NESTED paths — the product of
     * `@Prop(raw({...}))`. A sub-schema (`@Prop({ type: SomeSchema })`) reports
     * `pathType` 'real' instead, and crucially does not materialise its
     * defaults on a newly created document: the object stays `undefined` until
     * something assigns to it. Reads of existing rows look identical, so this
     * only breaks on create — which is why it is asserted rather than trusted.
     */
    it('declares hmac and idempotency as nested paths, not sub-schemas', () => {
      expect(CustomToolSchema.pathType('hmac')).toBe('nested');
      expect(
        (
          endpointSchema.schema as unknown as {
            pathType: (p: string) => string;
          }
        ).pathType('idempotency'),
      ).toBe('nested');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. The real names drive behaviour; the invented ones are inert.
  // ───────────────────────────────────────────────────────────────────────────

  describe('timeout comes from tool.timeout_ms, in milliseconds', () => {
    it('passes timeout_ms straight to axios', async () => {
      await service._request(
        makeTool({ timeout_ms: 1234 }),
        makeEndpoint(),
        'U1',
        {},
      );
      expect(lastCall().timeout).toBe(1234);
    });

    it('falls back to 8000 rather than reading a per-endpoint timeout', async () => {
      // `timeout_sec` on the endpoint is the invented name — it must be ignored.
      await service._request(
        makeTool({ timeout_ms: undefined }),
        makeEndpoint({ timeout_sec: 99 }),
        'U1',
        {},
      );
      expect(lastCall().timeout).toBe(8000);
      expect(lastCall().timeout).not.toBe(99_000);
    });
  });

  describe('idempotency uses the single `field`, dispatched by `location`', () => {
    it('puts the key in the header named by `field`', async () => {
      await service._request(
        makeTool(),
        makeEndpoint({
          idempotency: {
            enabled: true,
            location: 'header',
            field: 'X-Vendor-Idem',
            retry_on_timeout: 1,
          },
        }),
        'U1',
        {},
        null,
        {},
        { idempotencyKey: 'KEY-1' },
      );
      expect(lastHeaders()['X-Vendor-Idem']).toBe('KEY-1');
      // The invented default the broken code used.
      expect(lastHeaders()['X-Idempotency-Key']).toBeUndefined();
    });

    it('puts the key in the body field named by `field` when location is body', async () => {
      await service._request(
        makeTool(),
        makeEndpoint({
          idempotency: {
            enabled: true,
            location: 'body',
            field: 'txnRef',
            retry_on_timeout: 1,
          },
        }),
        'U1',
        {},
        null,
        {},
        { idempotencyKey: 'KEY-2' },
      );
      expect(JSON.parse(lastCall().data as string)).toMatchObject({
        txnRef: 'KEY-2',
      });
    });

    it('injects nothing when `enabled` is false, even with a key supplied', async () => {
      await service._request(
        makeTool(),
        makeEndpoint({
          idempotency: {
            enabled: false,
            location: 'header',
            field: 'X-Vendor-Idem',
            retry_on_timeout: 0,
          },
        }),
        'U1',
        {},
        null,
        {},
        { idempotencyKey: 'KEY-3' },
      );
      expect(lastHeaders()['X-Vendor-Idem']).toBeUndefined();
    });
  });

  describe('hmac signing reads api_key for the secret and hmac for the recipe', () => {
    const hmacEndpoint = makeEndpoint({ require_jwt: true });

    it('signs with tool.api_key and honours hmac.headers / hmac.algorithm', async () => {
      await service._request(
        makeTool({
          auth_type: 'hmac_signature',
          api_key: `enc:${FAKE_SECRET}`,
          hmac: {
            algorithm: 'sha512',
            encoding: 'base64',
            message: '{{web_code}}|{{timestamp}}',
            headers: { 'X-Sig': '{{signature}}', 'X-Ts': '{{timestamp}}' },
            timestamp_unit: 'seconds',
            canonical_json: null,
            web_code_field: 'site_code',
          },
        }),
        hmacEndpoint,
        'U1',
        { site_code: 'ABC' },
      );

      const h = lastHeaders();
      // Header names come from hmac.headers, not from the signer's defaults.
      expect(h['X-Sig']).toBeDefined();
      expect(h['X-Ts']).toBeDefined();
      expect(h['X-Signature']).toBeUndefined();
      // base64 encoding requested, so the digest must not be plain hex.
      expect(h['X-Sig']).not.toMatch(/^[0-9a-f]+$/);
      // The secret was taken from api_key, decrypted once.
      expect(mockCrypto.safeDecrypt).toHaveBeenCalledWith(`enc:${FAKE_SECRET}`);
    });

    it('falls back to signer defaults when hmac holds mongoose’s empty strings', async () => {
      // This is the shape every stored document actually has: `''` and `null`
      // for every unset key. They must be dropped, not passed through, or they
      // overwrite the signer defaults and every signature comes out wrong.
      await service._request(
        makeTool({
          auth_type: 'hmac_signature',
          api_key: `enc:${FAKE_SECRET}`,
          hmac: {
            algorithm: '',
            encoding: '',
            message: '',
            headers: null,
            timestamp_unit: '',
            canonical_json: null,
            web_code_field: '',
          },
        }),
        hmacEndpoint,
        'U1',
        {},
      );

      const h = lastHeaders();
      expect(h['X-Signature']).toBeDefined();
      expect(h['X-Timestamp']).toBeDefined();
      // Default encoding is hex.
      expect(h['X-Signature']).toMatch(/^[0-9a-f]+$/);
    });

    it('never looks for hmac_secret or hmac_config', async () => {
      await service._request(
        makeTool({
          auth_type: 'hmac_signature',
          api_key: '',
          // The invented names, carrying values that would be obvious if read.
          hmac_secret: 'enc:should-never-be-used',
          hmac_config: { headers: { 'X-Invented': '{{signature}}' } },
        }),
        hmacEndpoint,
        'U1',
        {},
      );

      expect(lastHeaders()['X-Invented']).toBeUndefined();
      expect(mockCrypto.safeDecrypt).not.toHaveBeenCalledWith(
        'enc:should-never-be-used',
      );
    });
  });

  describe('non-jwt auth types build their header from stored credentials', () => {
    it('api_key goes in the header named by api_key_header', async () => {
      await service._request(
        makeTool({
          auth_type: 'api_key',
          api_key: 'enc:fixture-key',
          api_key_header: 'Shop-Api-Key',
        }),
        makeEndpoint({ require_jwt: true }),
        'U1',
        {},
      );
      expect(lastHeaders()['Shop-Api-Key']).toBe('fixture-key');
    });

    it('basic uses username + password, and no auth_token field exists', async () => {
      await service._request(
        makeTool({
          auth_type: 'basic',
          username: 'user1',
          password: 'enc:pw1',
          // Invented field — must not become a Bearer header.
          auth_token: 'enc:should-never-be-used',
        }),
        makeEndpoint({ require_jwt: true }),
        'U1',
        {},
      );
      const auth = lastHeaders()['Authorization'];
      expect(auth).toBe(`Basic ${Buffer.from('user1:pw1').toString('base64')}`);
      expect(auth).not.toContain('Bearer');
    });
  });

  describe('token lifetime comes from the login response, not a stored field', () => {
    it('honours expires_in from the response body', async () => {
      const memberUpdate = jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve({}) });
      (
        service as unknown as { memberModel: { updateOne: unknown } }
      ).memberModel.updateOne = memberUpdate;

      mockedAxios.mockResolvedValue({
        status: 200,
        data: { access_token: 'tok-abc', expires_in: 120 },
        headers: {},
      });

      const before = Date.now();
      await service.login(
        makeTool({
          auth_type: 'jwt_login',
          endpoints: [
            makeEndpoint({
              key: 'LOGIN',
              is_login: true,
              token_path: 'access_token',
              // Invented field carrying a wildly different value.
              token_ttl_sec: 99999,
            }),
          ],
        }),
        'U1',
      );

      const written = memberUpdate.mock.calls[0]?.[1] as {
        $set: Record<string, { expires_at: Date }>;
      };
      const stored = Object.values(written.$set)[0]?.expires_at as Date;
      const ttlMs = new Date(stored).getTime() - before;

      // ~120s from the response, not ~99999s from the invented field.
      expect(ttlMs).toBeGreaterThan(100_000);
      expect(ttlMs).toBeLessThan(140_000);
    });

    it('defaults to 3600s when the response omits expires_in', async () => {
      const memberUpdate = jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve({}) });
      (
        service as unknown as { memberModel: { updateOne: unknown } }
      ).memberModel.updateOne = memberUpdate;

      mockedAxios.mockResolvedValue({
        status: 200,
        data: { access_token: 'tok-abc' },
        headers: {},
      });

      const before = Date.now();
      await service.login(
        makeTool({
          auth_type: 'jwt_login',
          endpoints: [
            makeEndpoint({
              key: 'LOGIN',
              is_login: true,
              token_path: 'access_token',
            }),
          ],
        }),
        'U1',
      );

      const written = memberUpdate.mock.calls[0]?.[1] as {
        $set: Record<string, { expires_at: Date }>;
      };
      const stored = Object.values(written.$set)[0]?.expires_at as Date;
      const ttlMs = new Date(stored).getTime() - before;
      expect(ttlMs).toBeGreaterThan(3_500_000);
      expect(ttlMs).toBeLessThan(3_700_000);
    });
  });
});

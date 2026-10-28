import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
import { RedisService } from '@/infra/redis';
import {
  buildSignatureHeaders,
  checkHeaderToken,
  CustomToolService,
  evaluateResult,
  ExternalApiService,
  goEscape,
  hasContent,
  isFresh,
  isHeaderSafeToken,
  isFetchOk,
  mapResult,
  pickByPath,
  sortKeysDeep,
  withStamp,
} from '@/modules/external';
import { type CustomTool } from '@/modules/hooks';
import { SystemConfigService, WebhookLogWriter } from '@/modules/system';

describe('ExternalModule Services (Pure Logic & Unit Tests - R10 Enforced)', () => {
  let externalApiService: ExternalApiService;
  let customToolService: CustomToolService;

  const mockHookModel = {
    findById: jest.fn(),
    updateOne: jest.fn(),
  };

  const mockCustomToolModel = {
    findById: jest.fn(),
  };

  const mockMemberModel = {
    findOne: jest.fn(),
    updateOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  };

  /* [FIX-20260828-WLOGDOOROUT] `ExternalApiService` stopped taking the raw model
     when the webhook_logs writes moved behind one door
     (`[FEAT-20260827-WLOGONEDOOR]`) — it takes `WebhookLogWriter` and calls
     `persist()` (external-api.service.ts:74, :807 and five siblings). This spec
     still handed in `getModelToken('WebhookLog')`, so Nest could not construct
     the service and all 22 cases in this file failed with
     "Nest can't resolve dependencies … argument WebhookLogWriter at index [2]".
     The model double is kept — the token is harmless and other providers may
     still want it — and the DOOR is what the service actually receives now.
     เปลี่ยน dep แล้วต้องตามแก้ที่สร้าง service ไม่งั้นพังทั้งไฟล์ */
  const mockWebhookLogModel = {
    create: jest.fn().mockResolvedValue({}),
  };

  /** The door. `persist()` is fire-and-forget in the service, so resolving is
   *  all it needs to do; the cases here assert on HTTP behaviour, not on rows. */
  const mockWebhookLogWriter = {
    persist: jest.fn().mockResolvedValue(undefined),
  };

  const mockSystemConfigService = {
    getConfigByKey: jest.fn().mockResolvedValue(null),
  };

  const mockCryptoService = {
    safeDecrypt: jest.fn((val: string) => val?.replace('enc:', '') || ''),
    tryDecryptSecret: jest.fn((val: string) => val?.replace('enc:', '') || ''),
  };

  const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalApiService,
        CustomToolService,
        { provide: getModelToken('Hook'), useValue: mockHookModel },
        { provide: getModelToken('CustomTool'), useValue: mockCustomToolModel },
        { provide: getModelToken('Member'), useValue: mockMemberModel },
        { provide: getModelToken('WebhookLog'), useValue: mockWebhookLogModel },
        // [FIX-20260828-WLOGDOOROUT] the dependency the service actually declares
        { provide: WebhookLogWriter, useValue: mockWebhookLogWriter },
        { provide: SystemConfigService, useValue: mockSystemConfigService },
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: RedisService, useValue: mockRedisService },
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

    externalApiService = module.get<ExternalApiService>(ExternalApiService);
    customToolService = module.get<CustomToolService>(CustomToolService);
  });

  describe('ExternalApiService Utility Methods', () => {
    it('should resolve path variables correctly', () => {
      const template = 'api/v1/customer/{{line_user_id}}/order/{{order_id}}';
      const resolved = externalApiService._resolvePath(template, {
        line_user_id: 'U123456',
        order_id: 'ORD-999',
      });
      expect(resolved).toBe('api/v1/customer/U123456/order/ORD-999');
    });

    it('should leave unmapped template keys as is if not in replacement vars', () => {
      const template = 'api/v1/user/{{userId}}/detail/{{missing_key}}';
      const resolved = externalApiService._resolvePath(template, {
        userId: 'U99',
      });
      expect(resolved).toBe('api/v1/user/U99/detail/{{missing_key}}');
    });
  });

  describe('CustomToolService Endpoint & Role Resolution', () => {
    const dummyTool = {
      _id: 'a0d00000000000000000000a',
      name: 'Test Tool',
      base_url: 'https://api.example.com',
      auth_type: 'none',
      status: true,
      endpoints: [
        {
          key: 'CUSTOMER_LOOKUP',
          path: 'api/customer',
          method: 'GET',
          status: true,
          is_profile: true,
          role: 'profile',
        },
        {
          key: 'LOGIN_EP',
          path: 'api/login',
          method: 'POST',
          status: true,
          is_login: true,
          role: 'auth',
        },
        {
          key: 'SITE_RULES',
          path: 'api/rules',
          method: 'GET',
          status: true,
          role: 'site_rules',
        },
      ],
    } as unknown as CustomTool & { _id: unknown };

    it('should find endpoint by key case-insensitively', () => {
      const ep = customToolService.findEndpoint(dummyTool, 'customer_lookup');
      expect(ep).toBeDefined();
      expect(ep?.key).toBe('CUSTOMER_LOOKUP');
    });

    it('should find flagged endpoint', () => {
      const loginEp = customToolService.findFlagged(dummyTool, 'is_login');
      expect(loginEp?.key).toBe('LOGIN_EP');

      const profileEp = customToolService.findFlagged(dummyTool, 'is_profile');
      expect(profileEp?.key).toBe('CUSTOMER_LOOKUP');
    });

    it('should find endpoint by role', () => {
      const ep = customToolService.findByRole(dummyTool, 'site_rules');
      expect(ep?.key).toBe('SITE_RULES');
    });

    it('should describe all roles in tool', () => {
      const roles = customToolService.describeRoles(dummyTool);
      expect(roles).toEqual({
        profile: 'CUSTOMER_LOOKUP',
        auth: 'LOGIN_EP',
        site_rules: 'SITE_RULES',
      });
    });

    it('should render payload with template variable substitution', () => {
      const tpl = {
        user_id: '{{line_user_id}}',
        nested: { action: '{{action}}' },
        static_num: 123,
      };
      const rendered = customToolService._renderPayload(
        tpl,
        {},
        { line_user_id: 'U555', action: 'FETCH' },
      );
      expect(rendered).toEqual({
        user_id: 'U555',
        nested: { action: 'FETCH' },
        static_num: 123,
      });
    });

    it('should extract profile info using profile_map or fallbacks', () => {
      const combined = {
        CUSTOMER_LOOKUP: {
          success: true,
          status: 200,
          data: {
            data: {
              customer: {
                customer_name: 'John Doe',
                customer_tel: '0812345678',
              },
              contract: {
                code: 'CTR-001',
              },
            },
          },
        },
      };
      const profile = customToolService.extractProfile(combined, dummyTool);
      expect(profile.ok).toBe(true);
      expect(profile.name).toBe('John Doe');
      expect(profile.phone).toBe('0812345678');
      expect(profile.code).toBe('CTR-001');
    });

    it('should extract tier object correctly', () => {
      const combined = {
        CUSTOMER_LOOKUP: {
          success: true,
          status: 200,
          data: {
            tier: { code: 'VIP_GOLD', name: 'Gold Member', level: 2 },
          },
        },
      };
      const tier = customToolService.extractTier(combined, dummyTool);
      expect(tier).toBeDefined();
      expect(tier?.code).toBe('VIP_GOLD');
      expect(tier?.name).toBe('Gold Member');
      expect(tier?.level).toBe(2);
    });

    it('should mask secrets when returning preview response', () => {
      const secretData = {
        access_token: 'secret_jwt_token_value_here_123456',
        password: 'super_secret_password',
        user: { name: 'Admin' },
      };
      const masked = customToolService._maskSecrets(secretData) as Record<
        string,
        unknown
      >;
      expect(masked.access_token).toContain('(ซ่อนไว้)');
      expect(masked.password).toContain('(ซ่อนไว้)');
      expect((masked.user as Record<string, unknown>).name).toBe('Admin');
    });
  });

  describe('Raw Data Stamp Utility', () => {
    it('should detect non-empty content correctly', () => {
      expect(hasContent(null)).toBe(false);
      expect(hasContent(undefined)).toBe(false);
      expect(hasContent('')).toBe(false);
      expect(hasContent('   ')).toBe(false);
      expect(hasContent([])).toBe(false);
      expect(hasContent({})).toBe(false);

      expect(hasContent('hello')).toBe(true);
      expect(hasContent([1])).toBe(true);
      expect(hasContent({ a: 1 })).toBe(true);
      expect(hasContent(0)).toBe(true);
      expect(hasContent(false)).toBe(true);
    });

    it('should identify valid fetch response with isFetchOk', () => {
      expect(isFetchOk(null)).toBe(false);
      expect(isFetchOk({ success: false, status: 200, data: { a: 1 } })).toBe(
        false,
      );
      expect(isFetchOk({ success: true, status: 500, data: { a: 1 } })).toBe(
        false,
      );
      expect(isFetchOk({ success: true, status: 200, data: {} })).toBe(false);
      expect(
        isFetchOk({ success: true, status: 200, data: { ok: true } }),
      ).toBe(true);
    });

    it('should stamp data and date atomically', () => {
      const setObj: Record<string, unknown> = {};
      withStamp(setObj, 'raw_profile_data', 'profile_data_updated_at', {
        name: 'Test',
      });
      expect(setObj.raw_profile_data).toEqual({ name: 'Test' });
      expect(setObj.profile_data_updated_at).toBeInstanceOf(Date);
    });

    it('should evaluate freshness correctly', () => {
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      const stale = new Date(Date.now() - 60 * 60 * 1000);
      expect(isFresh(recent)).toBe(true);
      expect(isFresh(stale)).toBe(false);
    });
  });

  describe('Result Rules Utility', () => {
    it('should pick value by dot path', () => {
      const obj = { data: { user: { id: 42 } } };
      expect(pickByPath(obj, 'data.user.id')).toBe(42);
      expect(pickByPath(obj, 'data.user.missing')).toBeUndefined();
    });

    it('should evaluate rules correctly', () => {
      const rules = [
        { path: 'status', value: 'OK', op: 'eq', action: 'success' },
        {
          path: 'code',
          value: '500',
          op: 'eq',
          action: 'fail',
          error_code: 'SERVER_ERR',
        },
      ];

      const successVerdict = evaluateResult(rules, { status: 'OK' }, 200);
      expect(successVerdict?.ok).toBe(true);
      expect(successVerdict?.error_code).toBe('LINK_OK');

      const failVerdict = evaluateResult(rules, { code: '500' }, 500);
      expect(failVerdict?.ok).toBe(false);
      expect(failVerdict?.error_code).toBe('SERVER_ERR');
    });

    it('should map write results correctly', () => {
      const body = { res: { member: 'M123', tel: '0800000000' } };
      const mapConfig = { member_id: 'res.member', phone: 'res.tel' };
      const mapped = mapResult(mapConfig, body);
      expect(mapped).toEqual({
        member_id: 'M123',
        phone: '0800000000',
        name: null,
      });
    });
  });

  describe('Header Safe Token Utility', () => {
    it('should accept valid ascii/latin1 tokens', () => {
      expect(isHeaderSafeToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
        true,
      );
      expect(checkHeaderToken('valid_token_123').ok).toBe(true);
    });

    it('should reject invalid or non-printable/thai tokens', () => {
      const check = checkHeaderToken(
        '(ได้ token แล้ว — ถูกซ่อนไว้เพื่อความปลอดภัย)',
      );
      expect(check.ok).toBe(false);
      expect(check.reason).toBe('invalid_char');
    });
  });

  describe('HMAC Signer Utility', () => {
    it('should escape Go characters correctly', () => {
      const escaped = goEscape('{"name":"A&B<C>"}');
      expect(escaped).toBe('{"name":"A\\u0026B\\u003cC\\u003e"}');
    });

    it('should sort keys deeply for canonical payload', () => {
      const sorted = sortKeysDeep({ z: 1, a: { y: 2, b: 3 } });
      expect(Object.keys(sorted as object)).toEqual(['a', 'z']);
    });

    it('should build signature headers with expected variables', () => {
      const res = buildSignatureHeaders({
        secret: 'test_secret_key',
        webCode: 'WEB001',
        body: { line_user_id: 'U100' },
        contentType: 'application/json',
        method: 'POST',
        path: '/api/v1/test',
        now: 1700000000000,
        nonce: 'fixed_nonce_value',
      });

      expect(res.timestamp).toBe('1700000000');
      expect(res.headers['X-Timestamp']).toBe('1700000000');
      expect(res.headers['X-Signature']).toBeDefined();
      expect(typeof res.headers['X-Signature']).toBe('string');
    });
  });
});

/**
 * [FEAT-20260808-GROUPB-*] Group B parity — items that RESTORE legacy behaviour
 * and therefore CHANGE FE-visible output (intended). Each case asserts the NEW
 * output MATCHES legacy's shape, plus that the unrelated result is unchanged.
 *
 * All services are constructed directly with hand-stubbed models / fakes — no
 * Mongo, no DI container, no external keys.
 */

import type { AuthenticatedUser } from '@/common';
import { ImageStorageService } from '@/modules/content';
import { InsightReportsService, TicketsService } from '@/modules/tickets';
import {
  IMAGE_MIME,
  resolveSafeImagePath,
} from '@/infra/static/hardened-image-serve.middleware';

const USER: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'admin',
  groups: [],
} as unknown as AuthenticatedUser;

/** Wait a microtask so a fire-and-forget `void ...` promise chain runs. */
const flush = () => new Promise((r) => setImmediate(r));

// ─────────────────────────────────────────────────────────────────────────────
// Item 4 · admin-create ticket:new — hook_name lookup (legacy ticketController.js:114-134)
// ─────────────────────────────────────────────────────────────────────────────
describe('[FEAT-20260808-GROUPB-HOOKNAME] createTicket ticket:new carries the OA name', () => {
  const HOOK_ID = 'a0d00000000000000000001b';

  function makeService(
    hookDoc: Record<string, unknown> | null,
    hookFindRejects = false,
  ) {
    const publish = jest.fn().mockResolvedValue(undefined);
    const created = { _id: 'tkt1', hook_id: HOOK_ID };
    const ticketModel = {
      create: jest.fn().mockResolvedValue(created),
    };
    const lean = hookFindRejects
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(hookDoc);
    const hookModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean }),
      }),
    };

    const service = new TicketsService(
      ticketModel as never,
      {} as never, // assignHistoryModel
      {} as never, // chatRoomModel
      {} as never, // chatMessageModel
      {} as never, // memberModel
      {} as never, // customerTagModel
      hookModel as never,
      { publish } as never, // realtimePublisher
      {} as never, // auditLogService
      /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
      {
        resolve: () => ({
          tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
        }),
      } as never,
    );
    // Bypass the DB-touching populate; ticket:new only needs _id + hook_id.
    (service as unknown as Record<string, unknown>)['populateAttachedFiles'] =
      jest.fn().mockResolvedValue({ _id: 'tkt1', hook_id: HOOK_ID });
    return { service, publish, hookModel };
  }

  it('emits hook_name from display_name (legacy precedence) — was always ""', async () => {
    const { service, publish } = makeService({
      display_name: 'ครัวคุณต๋อย OA',
      line_oa_name: 'kitchen',
      alias: 'k1',
    });
    await service.createTicket({ hook_id: HOOK_ID });
    await flush();

    expect(publish).toHaveBeenCalledTimes(1);
    const [type, data] = publish.mock.calls[0];
    expect(type).toBe('ticket:new');
    expect(data).toMatchObject({
      hook_id: HOOK_ID,
      hook_name: 'ครัวคุณต๋อย OA',
    });
  });

  it('falls back display_name → line_oa_name → alias → "" (legacy order)', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ line_oa_name: 'kitchen', alias: 'k1' }, 'kitchen'],
      [{ alias: 'k1' }, 'k1'],
      [{}, ''],
    ];
    for (const [doc, expected] of cases) {
      const { service, publish } = makeService(doc);
      await service.createTicket({ hook_id: HOOK_ID });
      await flush();
      expect(publish.mock.calls[0][1].hook_name).toBe(expected);
    }
  });

  it('a hook read error re-emits with hook_name:"" (legacy .catch) — badge still appears', async () => {
    const { service, publish } = makeService(null, true);
    await service.createTicket({ hook_id: HOOK_ID });
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1]).toMatchObject({
      hook_id: HOOK_ID,
      hook_name: '',
    });
  });

  it('no hook_id → no publish at all (unchanged: never fan out un-scoped)', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const ticketModel = { create: jest.fn().mockResolvedValue({ _id: 'x' }) };
    const service = new TicketsService(
      ticketModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { publish } as never,
      {} as never,
      /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
      {
        resolve: () => ({
          tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
        }),
      } as never,
    );
    (service as unknown as Record<string, unknown>)['populateAttachedFiles'] =
      jest.fn().mockResolvedValue({ _id: 'x' }); // no hook_id
    await service.createTicket({});
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 2 · dashboard image upload (legacy imageStorageController.js:116-169)
// ─────────────────────────────────────────────────────────────────────────────
describe('[FEAT-20260808-GROUPB-IMGUPLOAD] createFromDashboard stores the real image + audits', () => {
  const OBJ_ID = 'a0d00000000000000000001c';

  function makeService() {
    const saved: Record<string, unknown>[] = [];
    const audit = { createAuditLog: jest.fn().mockResolvedValue({}) };

    class FakeStorageModel {
      static rows: Record<string, unknown>[] = saved;
      _id = 'stor1';
      priority = 5;
      image_url = '';
      storage_type = '';
      constructor(public doc: Record<string, unknown>) {
        Object.assign(this, doc);
      }
      async save() {
        saved.push(this.doc);
        return this;
      }
      static findOne() {
        // getNextPriority — no prior rows → priority 1.
        return { sort: () => Promise.resolve(null) };
      }
      static findById() {
        return {
          populate: () =>
            Promise.resolve({
              toObject: () => ({
                _id: 'stor1',
                image_url: (saved[0]?.['image_url'] as string) ?? '',
                priority: 1,
              }),
            }),
        };
      }
    }
    const objectImageModel = {
      findById: jest.fn().mockResolvedValue({ _id: OBJ_ID }),
    };

    const service = new ImageStorageService(
      FakeStorageModel as never,
      objectImageModel as never,
      audit as never,
    );
    return { service, saved, audit, objectImageModel };
  }

  const FILE = {
    filename: 'dashboard_123_uuid.png',
    originalname: 'promo.PNG',
    path: '/nope/does-not-exist.png',
    size: 2048,
  };

  it('persists the legacy field set with the request-host absolute URL (no more stub)', async () => {
    const { service, saved } = makeService();
    const out = await service.createFromDashboard(
      USER,
      OBJ_ID,
      FILE,
      'https://api.example.com',
    );

    expect(saved).toHaveLength(1);
    const row = saved[0]!;
    // legacy shape — the stub stored none of this
    expect(row['image_url']).toBe(
      'https://api.example.com/uploads/images/dashboard_123_uuid.png',
    );
    expect(row['origin_path']).toBe('dashboard_upload');
    expect(row['storage_type']).toBe('dashboard');
    expect(row['image_type']).toBe('png'); // ext, no dot, lower-cased
    expect(row['file_path']).toBe(FILE.path);
    expect(row['source']).toBe('object');
    expect(row['media_kind']).toBe('image');
    // compressImage errors on the fake path → falls back to file.size (legacy)
    expect(row['file_size']).toBe(2048);
    // the returned URL is NOT the dead stub
    expect(out.image_url).not.toContain('dashboard-upload-stub');
  });

  it('writes one image_storage create audit row (P2-1 4th site)', async () => {
    const { service, audit } = makeService();
    await service.createFromDashboard(
      USER,
      OBJ_ID,
      FILE,
      'https://api.example.com',
    );
    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'create',
      parent: 'image_storage',
    });
  });

  it('missing object_image_id / file → legacy error strings (unchanged rejections)', async () => {
    const { service } = makeService();
    await expect(
      service.createFromDashboard(USER, undefined, FILE, 'https://x'),
    ).rejects.toThrow('object_image_id is required');
    await expect(
      service.createFromDashboard(USER, OBJ_ID, undefined, 'https://x'),
    ).rejects.toThrow('No file uploaded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 3 · insight ai_handled.by_category gate (legacy insightReportController.js:476)
// ─────────────────────────────────────────────────────────────────────────────
describe('[FEAT-20260808-GROUPB-INSIGHTCAT] isAiSumCategoryEnabled — legacy truthiness', () => {
  const stub = {} as never;

  function makeService(configValue: unknown, rejects = false) {
    const systemConfig = {
      getConfigByKey: rejects
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest
            .fn()
            .mockResolvedValue(
              configValue === undefined ? null : { value: configValue },
            ),
    };
    const service = new InsightReportsService(
      stub, // ticketModel
      stub, // assignHistoryModel
      stub, // chatMessageModel
      stub, // chatRoomModel
      stub, // userModel
      stub, // hookModel
      stub, // queryCache
      systemConfig as never,
    );
    return service as unknown as {
      isAiSumCategoryEnabled(): Promise<boolean>;
    };
  }

  it('ON only for explicit truthy: true / 1 / "true" (case/space-insensitive)', async () => {
    for (const v of [true, 1, 'true', 'TRUE', '  true  ']) {
      expect(await makeService(v).isAiSumCategoryEnabled()).toBe(true);
    }
  });

  it('OFF for absent / false / 0 / "" / "false" / malformed (safe default)', async () => {
    for (const v of [undefined, false, 0, '', 'false', 'yes', {}]) {
      expect(await makeService(v).isAiSumCategoryEnabled()).toBe(false);
    }
  });

  it('a config read error falls back to OFF (legacy) — never flips behaviour', async () => {
    expect(await makeService(true, true).isAiSumCategoryEnabled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 5 · hardened image serving (legacy index.js:84-113)
// ─────────────────────────────────────────────────────────────────────────────
describe('[FEAT-20260808-GROUPB-IMGSERVE] resolveSafeImagePath — legacy three guards', () => {
  const DIR = '/app/public/uploads/images';

  it('accepts a bare image filename and resolves under the images dir', () => {
    expect(resolveSafeImagePath(DIR, 'kbank.png')).toBe(`${DIR}/kbank.png`);
    expect(resolveSafeImagePath(DIR, 'a.jpeg')).toBe(`${DIR}/a.jpeg`);
    expect(resolveSafeImagePath(DIR, 'a.webp')).toBe(`${DIR}/a.webp`);
  });

  it('rejects traversal / separators / NUL (layer 1)', () => {
    for (const bad of [
      '../../../index.js',
      '..%2Fx', // literal .. still present
      'sub/child.png',
      'a\\b.png',
      'a\0.png',
      '',
    ]) {
      expect(resolveSafeImagePath(DIR, bad)).toBeNull();
    }
  });

  it('rejects non-image extensions (layer 3) even with a clean name', () => {
    for (const bad of ['config.js', 'secret.env', 'data.json', 'noext']) {
      expect(resolveSafeImagePath(DIR, bad)).toBeNull();
    }
  });

  it('the MIME allowlist matches legacy IMAGE_MIME exactly', () => {
    expect(IMAGE_MIME).toEqual({
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    });
  });
});

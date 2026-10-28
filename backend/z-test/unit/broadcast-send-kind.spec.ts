/**
 * [FEAT-20260823-BCASTSENDKIND] The column that opts ONE campaign in.
 * ===========================================================================
 * เจ้าของสั่ง 23/08: *"ทำทั้งหมดอย่าให้เป็นหนี้ … ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด"*
 *
 * 🔴 THE PROPERTY THIS WHOLE FILE DEFENDS: turning the new pipeline on moved
 *    NOTHING. Every campaign stored before 23/08 has no `send_kind`, and a job
 *    without one takes the sender it has always taken — flag on or off, port
 *    bound or not. The flag stopped being "does anything change?" and became
 *    "is the choice available at all?".
 *
 * The same six whitelists `title_detail` had to cross are crossed again here,
 * because each of them drops a field silently and each has already done so
 * once on this feature. เคยตกมาแล้วรอบหนึ่ง ต้องเทสทุกชั้นอีก.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import {
  BroadcastsService,
  CreateBroadcastDto,
  UpdateBroadcastDto,
  NEW_PATH_SEND_KINDS,
  usesNewSendPath,
} from '@/modules/content';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const through = (body: unknown, metatype: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype: metatype as never });

const HOOK_ID = 'a0d000000000000000000029';
const USER = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;
/* [FEAT-20260823-BCASTDESC] Required on CREATE since 23/08 — a new campaign
     must say what it is for. Update stays lenient so a campaign that predates
     the column can still be edited. */
const BASE = {
  name: 'promo',
  description: 'ทดสอบ',
  hook_ids: [HOOK_ID],
  message: { type: 'text' as const, text: 'hi' },
};

function makeService() {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const stored: Record<string, unknown> = {
    _id: 'a0d000000000000000000012',
    name: 'promo',
    status: 'draft',
  };
  const broadcastModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created.push(doc);
      return Promise.resolve({ ...stored, ...doc });
    }),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(stored) })),
    findByIdAndUpdate: jest.fn((_id: unknown, u: Record<string, unknown>) => {
      updated.push(u);
      return { lean: () => Promise.resolve({ ...stored, ...u }) };
    }),
  };
  const service = new BroadcastsService(
    broadcastModel as never,
    {
      find: jest.fn(() => ({
        select: jest.fn().mockResolvedValue([{ _id: HOOK_ID }]),
      })),
    } as never,
    {
      findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
    } as never,
    { create: jest.fn() } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    { createAuditLog: jest.fn().mockResolvedValue({}) } as never,
  );
  return { service, created, updated };
}

const ID = 'a0d000000000000000000012';

describe('send_kind — a job that never asked never moves', () => {
  it('🔴 absent ⇒ the old sender, with the flag ON', () => {
    expect(usesNewSendPath(undefined, true)).toBe(false);
  });

  it('🔴 create writes NO KEY when nothing was chosen', async () => {
    /* Not `null` — a new job that made no choice must be byte-identical to
       every job that predates the column, or a reader cannot tell them apart.
       ไม่เลือก = ไม่มีคีย์ ไม่ใช่ null. */
    const { service, created } = makeService();
    await service.createBroadcast(USER, { ...BASE });
    expect(created[0]).not.toHaveProperty('send_kind');
  });

  it('an empty string is a clear, not an error', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, { ...BASE, send_kind: '' });
    expect(created[0]).not.toHaveProperty('send_kind');
  });
});

describe('send_kind — the value must survive every whitelist', () => {
  it('🔴 the pipe lets it through on CREATE', async () => {
    const out = (await through(
      { ...BASE, send_kind: 'multicast' },
      CreateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out['send_kind']).toBe('multicast');
  });

  it('🔴 the pipe lets it through on UPDATE', async () => {
    const out = (await through(
      { send_kind: 'broadcast' },
      UpdateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out['send_kind']).toBe('broadcast');
  });

  it('🔴 create stores it', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, { ...BASE, send_kind: 'multicast' });
    expect(created[0]).toMatchObject({ send_kind: 'multicast' });
  });

  it('🔴 update stores it, and an empty box clears it back to the old sender', async () => {
    const { service, updated } = makeService();
    await service.updateBroadcast(USER, ID, { send_kind: 'multicast' });
    expect(updated[0]).toMatchObject({ send_kind: 'multicast' });

    const second = makeService();
    await second.service.updateBroadcast(USER, ID, { send_kind: '' });
    expect(second.updated[0]).toHaveProperty('send_kind', null);
  });

  it('a request that omits it leaves the stored value alone', async () => {
    const { service, updated } = makeService();
    await service.updateBroadcast(USER, ID, { name: 'renamed' });
    expect(updated[0]).not.toHaveProperty('send_kind');
  });

  it('🔴 sanitize sends it BACK — otherwise the form clears it on next save', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'p',
      status: 'draft',
      send_kind: 'multicast',
    } as never);
    expect(out?.send_kind).toBe('multicast');
  });

  it('a job that never chose reads back as null, not undefined', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'p',
      status: 'draft',
    } as never);
    expect(out).toHaveProperty('send_kind', null);
  });
});

describe('send_kind — a typo is refused, never stored', () => {
  it('🔴 `multicastt` is a 400 that names the allowed values', async () => {
    /* Stored silently it would look deliberate in the row and route the
       campaign down the OLD path — the admin would swear they had switched it
       and the evidence would agree. พิมพ์ผิดแล้วเงียบ = หาไม่เจอทั้งวัน. */
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, { ...BASE, send_kind: 'multicastt' }),
    ).rejects.toThrow(/send_kind must be one of/);
  });

  it('case matters — `MULTICAST` is refused too', async () => {
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, { ...BASE, send_kind: 'MULTICAST' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the refusal lists exactly what the switch will route', () => {
    /* One list, read from the switch — a second copy would let a job be saved
       that nothing routes, or refuse one that would have worked.
       ค่าที่เซฟผ่าน กับ ค่าที่เปิดประตู ต้องเป็นชุดเดียวกัน. */
    expect([...NEW_PATH_SEND_KINDS].sort()).toEqual(['broadcast', 'multicast']);
    for (const kind of NEW_PATH_SEND_KINDS) {
      expect(usesNewSendPath(kind, true)).toBe(true);
    }
  });
});

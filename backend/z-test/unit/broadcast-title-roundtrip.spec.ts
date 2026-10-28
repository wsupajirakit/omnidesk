/**
 * [FEAT-20260823-BCASTTITLE] `title_detail` — the WAY IN and the WAY BACK.
 * ===========================================================================
 * WHY THIS FILE EXISTS. `broadcast-title.spec.ts` proves the RULE: what counts
 * as a valid title and what `altText` a card ends up with. Every one of its 15
 * cases passed while the feature was unreachable, because a value has to cross
 * four hand-written whitelists before it can ever reach the renderer:
 *
 *   1. `ValidationPipe` — `main.ts:132-139`, `whitelist` + `forbidNonWhitelisted`
 *   2. `createBroadcast` — builds the document field by field
 *   3. `updateBroadcast` — copies `if (dto.x !== undefined)`, field by field
 *   4. `sanitizeBroadcast` — builds the RESPONSE field by field
 *
 * Miss any one and the field is gone with no error to trace. Miss (4) in
 * particular and the write still works — the form simply re-opens blank and
 * the next save writes that blank over the real value, which reports to the
 * admin as "it doesn't save". เขียนติดแล้วไม่พอ ต้องอ่านกลับได้ด้วย.
 *
 * ⚠️ WHAT THIS DOES NOT PROVE. The pipe and the service run for real here; the
 *    HTTP layer and the auth guard do not. The controller hands `dto` straight
 *    to the service (`broadcasts.controller.ts:82-86`) with no field handling
 *    of its own, so that seam carries no whitelist of its own to get wrong.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import {
  BroadcastsService,
  CreateBroadcastDto,
  UpdateBroadcastDto,
} from '@/modules/content';

/** The pipe with `main.ts:132-139`'s options — the real stripper, not a stand-in. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const through = (body: unknown, metatype: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype: metatype as never });

const HOOK_ID = 'a0d000000000000000000029';

const VALID_BODY = {
  name: 'promo',
  hook_ids: [HOOK_ID],
  message: { type: 'text', text: 'hello' },
};

describe('title_detail — layer 1: the pipe must let it in', () => {
  it('🔴 survives the whitelist on CREATE', async () => {
    /* Without the `@IsString()` on `CreateBroadcastDto.title_detail`, the pipe
       does not merely drop this — `forbidNonWhitelisted` makes it a 400, so
       the dashboard's save fails outright with
       "property title_detail should not exist". Loud, but it never reaches
       Mongo either way. */
    const out = (await through(
      { ...VALID_BODY, title_detail: 'โปรโมชั่น 2026' },
      CreateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out['title_detail']).toBe('โปรโมชั่น 2026');
  });

  it('🔴 survives the whitelist on UPDATE', async () => {
    const out = (await through(
      { title_detail: 'promo week' },
      UpdateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out['title_detail']).toBe('promo week');
  });

  it('an empty string is NOT dropped — it is how the box is cleared', async () => {
    const out = (await through(
      { title_detail: '' },
      UpdateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out).toHaveProperty('title_detail', '');
  });

  it('null reaches the service too — @IsOptional skips, it does not strip', async () => {
    const out = (await through(
      { title_detail: null },
      UpdateBroadcastDto,
    )) as Record<string, unknown>;
    expect(out).toHaveProperty('title_detail', null);
  });

  it('ANCHOR: the harness really is strict — an undeclared field is refused', async () => {
    /* If this ever passes, the four cases above prove nothing: they would be
       running against a permissive pipe that lets everything through.
       เทสข้างบนจะไร้ความหมายทันทีถ้าอันนี้ผ่าน. */
    await expect(
      through({ ...VALID_BODY, title_detai: 'typo' }, CreateBroadcastDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a non-string is refused at the edge, before any rule runs', async () => {
    await expect(
      through({ ...VALID_BODY, title_detail: 42 }, CreateBroadcastDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/* ── layers 2-4: the service ─────────────────────────────────────────────── */

/* `roleName: 'superadmin'` is read from `SUPER_ROLE_NAMES` in
   `src/common/auth/super-role.ts:33`, not from memory — a wrong value here
   would send every case down the group-scoping branch and fail for a reason
   that has nothing to do with titles. */
const USER = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

/** The minimum a create needs before it ever looks at the title. */
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
    title_detail: 'ของเดิม',
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
  const groupModel = {
    findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
  };

  /* `ensureValidHookIds` calls `.find().select('_id')` and counts what comes
     back, so the fake must return one row per requested id or the create dies
     with "Hook not found" long before the title matters. */
  const hookModel = {
    find: jest.fn(() => ({
      select: jest.fn().mockResolvedValue([{ _id: HOOK_ID }]),
    })),
  };

  const service = new BroadcastsService(
    broadcastModel as never,
    hookModel as never,
    groupModel as never,
    { create: jest.fn() } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    { createAuditLog: jest.fn().mockResolvedValue({}) } as never,
  );
  return { service, created, updated, stored };
}

describe('title_detail — layer 2: CREATE must copy it', () => {
  it('🔴 a valid title reaches the document handed to Mongo', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      title_detail: 'โปรโมชั่น 2026',
    });
    expect(created[0]).toMatchObject({ title_detail: 'โปรโมชั่น 2026' });
  });

  it('no title writes NO KEY — not a null into every new row', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, { ...BASE });
    expect(created[0]).not.toHaveProperty('title_detail');
  });

  it('an empty box is a choice, not an error', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      title_detail: '',
    });
    expect(created[0]).not.toHaveProperty('title_detail');
  });

  it('🔴 a broken title is REFUSED here, while the form is still open', async () => {
    /* The send path falls back instead of failing — that is the right trade at
       send time and the wrong one now. ตอนเซฟต้องปฏิเสธ ตอนส่งค่อยใช้ค่าเริ่มต้น. */
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, {
        ...BASE,
        title_detail: 'สวัสดี {{member.display_name}}',
      }),
    ).rejects.toThrow(/tags/);
  });

  it('the refusal names the rule that was broken, not just "invalid"', async () => {
    const { service } = makeService();
    const bodies = [
      ['  ', /only spaces/],
      [' promo', /start or end with a space/],
      ['promo!!!', /Thai, English, digits/],
      ['ก'.repeat(401), /at most 400/],
    ] as const;
    for (const [title, expected] of bodies) {
      await expect(
        service.createBroadcast(USER, {
          ...BASE,
          title_detail: title,
        }),
      ).rejects.toThrow(expected);
    }
  });
});

describe('title_detail — layer 3: UPDATE must copy it', () => {
  it('🔴 a new title is written', async () => {
    const { service, updated } = makeService();
    await service.updateBroadcast(USER, 'a0d000000000000000000012', {
      title_detail: 'ใหม่',
    });
    expect(updated[0]).toMatchObject({ title_detail: 'ใหม่' });
  });

  it('🔴 an empty box CLEARS a stored title — null, explicitly', async () => {
    /* An update writes `$set`, so clearing has to be an explicit null. Treating
       `''` as "no change" would make a filled box impossible to empty. */
    const { service, updated } = makeService();
    await service.updateBroadcast(USER, 'a0d000000000000000000012', {
      title_detail: '',
    });
    expect(updated[0]).toHaveProperty('title_detail', null);
  });

  it('a request that omits the field leaves the stored value alone', async () => {
    const { service, updated } = makeService();
    await service.updateBroadcast(USER, 'a0d000000000000000000012', {
      name: 'renamed',
    });
    expect(updated[0]).not.toHaveProperty('title_detail');
  });

  it('a broken title on update is refused as well', async () => {
    const { service } = makeService();
    await expect(
      service.updateBroadcast(USER, 'a0d000000000000000000012', {
        title_detail: '{{x}}',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('title_detail — layer 4: the way BACK', () => {
  it('🔴 sanitize returns the stored title', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'promo',
      status: 'draft',
      title_detail: 'โปรโมชั่น 2026',
    } as never);
    expect(out?.title_detail).toBe('โปรโมชั่น 2026');
  });

  it('a row that never had one reads back as null, not undefined', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'promo',
      status: 'draft',
    } as never);
    expect(out).toHaveProperty('title_detail', null);
  });

  it('🔴 create ANSWERS with the title it just stored', async () => {
    /* The form reads the create response straight back into its state. If the
       value is absent HERE, the field blanks the moment the modal re-opens. */
    const { service } = makeService();
    const out = await service.createBroadcast(USER, {
      ...BASE,
      title_detail: 'โปรโมชั่น 2026',
    });
    expect(out).toMatchObject({ title_detail: 'โปรโมชั่น 2026' });
  });

  it('🔴 update ANSWERS with the title it just stored', async () => {
    const { service } = makeService();
    const out = await service.updateBroadcast(
      USER,
      'a0d000000000000000000012',
      {
        title_detail: 'ใหม่',
      },
    );
    expect(out.title_detail).toBe('ใหม่');
  });
});

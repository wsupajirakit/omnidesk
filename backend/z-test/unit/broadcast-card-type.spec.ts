/**
 * [FEAT-20260823-BCASTCARDTYPE] A card whose body differs per person.
 * ===========================================================================
 * The last column the send matrix was waiting for. `send_kind` picks the
 * endpoint; `card_type` picks the row.
 *
 * 🔴 THE BOTTLENECK THIS FILE EXISTS TO PROVE ABSENT. A personal card is
 *    rendered SYNCHRONOUSLY, so its values must already be in memory. The
 *    obvious shapes are both wrong: looking a member up during the render is
 *    impossible, and awaiting one before each send would put a `members` read
 *    beside every LINE request on the one path that already costs a request
 *    per person. Values are loaded ONE PAGE AT A TIME, so a 10,000-person run
 *    reads `members` twenty times and not ten thousand.
 *    โหลดต่อหน้า ไม่ใช่ต่อคน.
 *
 * 🔴 AND THE PAGE IS FORGOTTEN. Holding every page would grow with the
 *    audience — the same unbounded set `chunk.ts` bounds its de-dupe against.
 */
import { BadRequestException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import {
  BroadcastsService,
  PagedRecipientVarSource,
  PersonalCardMessageBuilder,
  RECIPIENT_VAR_COLUMNS,
  toTranslateFn,
} from '@/modules/content';

const NO_DICT = toTranslateFn(() => null);

const HOOK = {
  _id: 'hookA',
  domain_name: 'alpha.example',
  company_name: 'Alpha Co',
  description: 'the alpha OA',
};

const member = (line: string, name: string) => ({
  line_user_id: line,
  display_name: name,
  full_name: name,
});

function makeSource(rows = [member('U1', 'Ann'), member('U2', 'Bob')]) {
  const calls: Array<readonly string[]> = [];
  const source = new PagedRecipientVarSource({
    reader: {
      findMembersByLineIds: (ids) => {
        calls.push([...ids]);
        return Promise.resolve(
          rows.filter((r) => ids.includes(r.line_user_id)),
        );
      },
    },
    translate: NO_DICT,
    hook: HOOK,
    storedSiteRules: undefined,
  });
  return { source, calls };
}

describe('per-recipient values — one read per PAGE', () => {
  it('🔴 a page of many recipients is ONE query', async () => {
    const { source, calls } = makeSource();
    await source.prefetch(['U1', 'U2']);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['U1', 'U2']);
    expect(source.loaded).toBe(2);
  });

  it('🔴 the previous page is FORGOTTEN, so memory does not grow', async () => {
    /* Holding every page would grow with the audience. A recipient is rendered
       while their page is loaded and never again. ลืมหน้าเก่า. */
    const { source } = makeSource();
    await source.prefetch(['U1']);
    expect(source.varsFor('U1')).not.toBeNull();

    await source.prefetch(['U2']);
    expect(source.varsFor('U2')).not.toBeNull();
    expect(source.varsFor('U1')).toBeNull();
  });

  it('an empty page asks nothing at all', async () => {
    const { source, calls } = makeSource();
    await source.prefetch([]);
    expect(calls).toHaveLength(0);
  });

  it('🔴 selects only the columns a card needs', () => {
    /* `raw_profile_data` is the big one; the rest are names. Pulling the whole
       member row would drag every column across the network per page. */
    expect(Object.keys(RECIPIENT_VAR_COLUMNS).sort()).toEqual([
      'display_name',
      'full_name',
      'line_user_id',
      'nickname',
      'phone_number',
      'raw_profile_data',
    ]);
  });
});

describe('per-recipient values — the right person, or nobody', () => {
  it('🔴 each recipient gets THEIR OWN values', async () => {
    const { source } = makeSource();
    await source.prefetch(['U1', 'U2']);

    expect(source.varsFor('U1')?.['member.display_name']).toBe('Ann');
    expect(source.varsFor('U2')?.['member.display_name']).toBe('Bob');
  });

  it('the OA values ride along, the same for everyone on that OA', async () => {
    const { source } = makeSource();
    await source.prefetch(['U1', 'U2']);
    expect(source.varsFor('U1')?.['hook_domain']).toBe('alpha.example');
    expect(source.varsFor('U2')?.['hook_domain']).toBe('alpha.example');
  });

  it('🔴 a recipient with no member row is NULL, never somebody else', async () => {
    const { source } = makeSource();
    await source.prefetch(['U1', 'U404']);
    expect(source.varsFor('U404')).toBeNull();
  });

  it('🔴 a read that THROWS leaves the page empty — it does not send blanks', async () => {
    /* A campaign that cannot read its members must not ship cards full of
       `N/A` to real customers. อ่านไม่ได้ = ไม่ส่ง ไม่ใช่ส่งการ์ดว่าง. */
    const source = new PagedRecipientVarSource({
      reader: {
        findMembersByLineIds: () => Promise.reject(new Error('mongo down')),
      },
      translate: NO_DICT,
      hook: HOOK,
      storedSiteRules: undefined,
    });
    await expect(source.prefetch(['U1'])).resolves.toBeUndefined();
    expect(source.varsFor('U1')).toBeNull();
  });
});

describe('PersonalCardMessageBuilder — one person per request', () => {
  const CARD = {
    type: 'text' as const,
    text: 'สวัสดี {{member.display_name}}',
  };
  const textOf = (m: unknown): unknown =>
    (m as Record<string, unknown> | undefined)?.['text'];

  it('🔴 renders that recipient’s real name', async () => {
    const { source } = makeSource();
    await source.prefetch(['U1']);
    const b = new PersonalCardMessageBuilder(CARD, source);
    const out = b.messagesFor({ index: 0, to: ['U1'] });
    expect(textOf(out.messages[0])).toBe('สวัสดี Ann');
  });

  it('🔴 REFUSES a batch — one body cannot serve two people', async () => {
    /* More than one id means `recipientsPerRequest` was ignored upstream, and
       rendering "the first one" would send that person's name to everybody
       else. ยอมให้ chunk ล้ม ดีกว่าส่งผิดคน. */
    const { source } = makeSource();
    await source.prefetch(['U1', 'U2']);
    const b = new PersonalCardMessageBuilder(CARD, source);
    expect(b.messagesFor({ index: 0, to: ['U1', 'U2'] }).messages).toEqual([]);
  });

  it('🔴 an unknown recipient produces NOTHING, not an N/A card', async () => {
    const { source } = makeSource();
    await source.prefetch(['U1']);
    const b = new PersonalCardMessageBuilder(CARD, source);
    expect(b.messagesFor({ index: 0, to: ['U404'] }).messages).toEqual([]);
  });

  it('🔴 forwards hookId, so a multi-OA source picks the right values', () => {
    /* Dropping it makes a multi-OA source answer `null` for everyone — every
       chunk refused, with nothing in the logs pointing here.
       ไม่ส่งต่อ = ทุก chunk ถูกปฏิเสธเงียบ ๆ. */
    const seen: Array<string | undefined> = [];
    const b = new PersonalCardMessageBuilder(CARD, {
      varsFor: (_id, hookId) => {
        seen.push(hookId);
        return { 'member.display_name': 'Ann' };
      },
    });
    b.messagesFor({ index: 0, to: ['U1'] }, 'hookA');
    expect(seen).toEqual(['hookA']);
  });
});

/* ── the round trip, and the pair that cannot exist ──────────────────────── */

const HOOK_ID = 'a0d000000000000000000029';
const ID = 'a0d000000000000000000012';
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

function makeService(stored: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const row = { _id: ID, name: 'promo', status: 'draft', ...stored };
  const broadcastModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created.push(doc);
      return Promise.resolve({ ...row, ...doc });
    }),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(row) })),
    findByIdAndUpdate: jest.fn((_id: unknown, u: Record<string, unknown>) => {
      updated.push(u);
      return { lean: () => Promise.resolve({ ...row, ...u }) };
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

describe('card_type — a job that never asked keeps one card for everybody', () => {
  it('🔴 create writes NO KEY when nothing was chosen', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, { ...BASE });
    expect(created[0]).not.toHaveProperty('card_type');
  });

  it('🔴 sanitize sends it back, so the form does not clear it on next save', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'p',
      status: 'draft',
      card_type: 'personal',
    } as never);
    expect(out?.card_type).toBe('personal');
  });

  it('a job that never chose reads back as null', () => {
    const { service } = makeService();
    const out = service.sanitizeBroadcast({
      _id: 'x',
      name: 'p',
      status: 'draft',
    } as never);
    expect(out).toHaveProperty('card_type', null);
  });

  it('create stores a real choice', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      send_kind: 'multicast',
      card_type: 'personal',
    });
    expect(created[0]).toMatchObject({ card_type: 'personal' });
  });

  it('🔴 a typo is refused, never stored', async () => {
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, { ...BASE, card_type: 'personall' }),
    ).rejects.toThrow(/card_type must be one of/);
  });
});

describe('🔴 broadcast + personal is refused while the form is still open', () => {
  /**
   * `/message/broadcast` sends ONE request with no recipient list, so there is
   * nowhere to put a per-person value. The matrix says so (`allowed: false`)
   * and the run refuses it — but by then the admin has saved and scheduled a
   * campaign and finds out only when it does not go.
   * ปฏิเสธตอนเซฟ ดีกว่ารู้ตอนถึงเวลาส่งแล้วส่งไม่ได้.
   */
  it('refused on create', async () => {
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, {
        ...BASE,
        send_kind: 'broadcast',
        card_type: 'personal',
      }),
    ).rejects.toThrow(/cannot be sent by broadcast/);
  });

  it('multicast + personal is fine', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      send_kind: 'multicast',
      card_type: 'personal',
    });
    expect(created[0]).toMatchObject({
      send_kind: 'multicast',
      card_type: 'personal',
    });
  });

  it('🔴 an update cannot build the pair ONE FIELD AT A TIME', async () => {
    /* The job is already `broadcast`; this request names only the card type.
       Checking the request alone would let it through.
       ต้องเทียบกับค่าที่เก็บไว้ ไม่ใช่แค่ค่าที่ส่งมา. */
    const { service } = makeService({ send_kind: 'broadcast' });
    await expect(
      service.updateBroadcast(USER, ID, { card_type: 'personal' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 nor from the other side', async () => {
    const { service } = makeService({ card_type: 'personal' });
    await expect(
      service.updateBroadcast(USER, ID, { send_kind: 'broadcast' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clearing the card type frees the job to be a broadcast again', async () => {
    const { service, updated } = makeService({ card_type: 'personal' });
    await service.updateBroadcast(USER, ID, {
      card_type: '',
      send_kind: 'broadcast',
    });
    expect(updated[0]).toMatchObject({
      card_type: null,
      send_kind: 'broadcast',
    });
  });
});

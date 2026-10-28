/**
 * [PERF-20260820-LISTPROFILE] the ticket list stops shipping what nobody reads
 * ============================================================================
 * Owner, 2026-08-20, on a 2.7 MB response: "limit=all คืน 2.7 MB ต่อ request …
 * โตขึ้นเรื่อย ๆ ตามข้อมูล" → "dive ยืนยันไม่กระทบส่วนอื่นทั้งสิ้น มีคนใช้ด้วยไหม" →
 * "proof test before + vs after".
 *
 * WHAT THE MEASUREMENT SHOWED. Every row of the list carries the member document
 * WHOLE — `formatTicket` ships it as `line_user_data`, deliberately. Inside it,
 * `raw_profile_data` is ~83% of the member, and inside THAT, five keys are ~97%
 * of the weight:
 *     promotion 2039 · finance 954 · bonus 370 · activity 313 · transaction 159
 *     ── against bank 63 · tier 43 · phone 12, which are the ones actually read.
 *
 * WHO READS `raw_profile_data` OFF A LIST ROW — all three, and only these three:
 *   · the tier badge      `memberTier.ts`      → profile.tier
 *   · the client search   `memberSearchText.ts`→ profile.phone, bank.account_no,
 *                                                bank.account_name
 *   · the green avatar ring `hasRawProfile`    → "profile has ANY key at all"
 *
 * WHO DOES NOT: `PersonalPanel` reads promotion/finance/bonus/activity/
 * transaction — but from its OWN `getRawProfile(memberId)` fetch, not from the
 * row (PersonalPanel.tsx:1373 → 1589-1590 → 1608-1611). The single-ticket
 * endpoints and `GET /api/line-users/:id/raw-profile` are untouched by this rule.
 *
 * ⚠️ WHY A DENY-LIST AND NOT AN ALLOW-LIST — this is the whole design decision.
 * `hasRawProfile` is `Object.keys(profile).length > 0`. Keeping only the four
 * leaves that are read would empty the profile of any customer who happens to
 * carry none of them, and their green ring would silently go out. Removing five
 * named heavy keys can never do that: every other key survives untouched.
 * ตัดแบบ deny-list เท่านั้น · allow-list ทำกรอบเขียวหายได้.
 *
 * revert: delete this file and the call in `enrichTicketRows`; the list ships the
 * whole profile again.
 */
import {
  HEAVY_PROFILE_KEYS,
  trimListProfile,
} from '@/modules/tickets/list-profile-trim';

const heavy = () => ({
  promotion: { a: 'x'.repeat(50) },
  finance: { b: 'y'.repeat(50) },
  bonus: { c: 1 },
  activity: [1, 2, 3],
  transaction: { statement: [{ amount: 1 }] },
});
const read = () => ({
  tier: { code: 'gold', level: 3 },
  phone: '0955550010',
  bank: { account_no: '5864854725', account_name: 'judy', code: 'BBL' },
});
const other = () => ({ line_user_id: 'U1', web_code: 'ABC', status: 1 });

describe('⭐ what the three readers need survives, byte for byte', () => {
  it('tier, phone and bank come through untouched', () => {
    const out = trimListProfile({
      data: { profile: { ...heavy(), ...read() } },
    }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(out.data.profile['tier']).toEqual(read().tier);
    expect(out.data.profile['phone']).toBe(read().phone);
    expect(out.data.profile['bank']).toEqual(read().bank);
  });

  it('⭐ every key that is NOT on the heavy list survives — that is what keeps the green ring on', () => {
    /* `hasRawProfile` counts keys. An allow-list would empty this profile and put
       the ring out for a customer the system does know. */
    const out = trimListProfile({
      data: { profile: { ...heavy(), ...other() } },
    }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(Object.keys(out.data.profile).sort()).toEqual(
      Object.keys(other()).sort(),
    );
    expect(Object.keys(out.data.profile).length).toBeGreaterThan(0);
  });

  it('⭐ a profile made ONLY of heavy keys still reads as "has a profile"', () => {
    /* the edge the deny-list has to survive: strip everything and the object
       would be empty. A marker keeps the ring lit without carrying the weight.
       ตัดหมดแล้วต้องยังนับว่ามีโปรไฟล์ */
    const out = trimListProfile({ data: { profile: heavy() } }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(Object.keys(out.data.profile).length).toBeGreaterThan(0);
  });
});

describe('⭐ the heavy keys are gone', () => {
  it.each([...HEAVY_PROFILE_KEYS])('%s is removed', (key) => {
    const out = trimListProfile({
      data: { profile: { ...heavy(), ...read() } },
    }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(key in out.data.profile).toBe(false);
  });

  it('the payload really does get smaller', () => {
    const full = { data: { profile: { ...heavy(), ...read() } } };
    const before = JSON.stringify(full).length;
    const after = JSON.stringify(trimListProfile(full)).length;
    expect(after).toBeLessThan(before / 2);
  });
});

describe('⭐ every shape the profile arrives in', () => {
  it('data.profile — the shape the webhook writes', () => {
    const out = trimListProfile({
      data: { profile: { ...heavy(), tier: 1 } },
    }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(out.data.profile).toEqual({ tier: 1 });
  });

  it('profile at the root', () => {
    const out = trimListProfile({ profile: { ...heavy(), tier: 1 } }) as {
      profile: Record<string, unknown>;
    };
    expect(out.profile).toEqual({ tier: 1 });
  });

  it('the profile keys sitting at the very root', () => {
    const out = trimListProfile({ ...heavy(), tier: 1 }) as Record<
      string,
      unknown
    >;
    expect(out).toEqual({ tier: 1 });
  });

  it('sibling keys outside the profile are never touched', () => {
    const out = trimListProfile({
      success: true,
      data: { meta: 'keep', profile: { ...heavy(), tier: 1 } },
    }) as { success: boolean; data: Record<string, unknown> };
    expect(out.success).toBe(true);
    expect(out.data['meta']).toBe('keep');
  });
});

describe('⭐ it never throws and never invents a profile', () => {
  it('null, undefined and non-objects come back as they went in', () => {
    for (const v of [null, undefined, 0, '', 'text', 42, true]) {
      expect(trimListProfile(v)).toBe(v);
    }
  });

  it('an empty profile stays empty — no marker where there was nothing', () => {
    /* a customer with no profile must NOT gain a ring. ไม่มีโปรไฟล์ = ต้องไม่มี */
    const out = trimListProfile({ data: { profile: {} } }) as {
      data: { profile: Record<string, unknown> };
    };
    expect(Object.keys(out.data.profile).length).toBe(0);
  });

  it('the input object is not mutated', () => {
    const input = { data: { profile: { ...heavy(), tier: 1 } } };
    const copy = JSON.parse(JSON.stringify(input)) as unknown;
    trimListProfile(input);
    expect(input).toEqual(copy);
  });
});

describe('⭐ it is actually wired into the LIST — and only there', () => {
  /* the service is ~1.5k lines and its row formatter is private, so the wiring is
     asserted against the source with comments stripped: a mention inside a note
     must never satisfy this. คอมเมนต์ต้องไม่นับเป็นการต่อสาย. */
  const src = require('node:fs')
    .readFileSync(
      require('node:path').join(
        process.cwd(),
        'src/modules/tickets/tickets.service.ts',
      ),
      'utf8',
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '') as string;

  it('⭐ the row formatter applies it — remove this and the 2.7 MB comes back', () => {
    expect(src).toContain('trimListProfile(member[');
  });

  it('it runs on the LIST path only — one call, inside enrichTicketRows', () => {
    /* `formatTicket` is shared with getTicketById / reopen / openFromRoom /
       updateTicket, which must keep shipping the full document. A second call
       would mean one of those started losing it too.
       เส้นรายตัวต้องได้ครบเหมือนเดิม ⇒ ต้องเรียกที่เดียว */
    expect(src.split('trimListProfile(').length - 1).toBe(1);
    const enrich = src.indexOf('enrichTicketRows');
    const call = src.indexOf('trimListProfile(member[');
    expect(enrich).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(enrich);
  });

  it('it only reshapes raw_profile_data — the rest of the member is passed through', () => {
    /* the spread keeps every other member field; losing display_name or
       phone_number here would empty the cards. */
    expect(src.replace(/\s+/g, ' ')).toContain(
      '...member, raw_profile_data: trimListProfile(',
    );
  });
});

/**
 * [FEAT-20260822-BCASTRAWREAD] The parts that are OURS rather than cloned: the
 * reader over what Mongo stores, and the substitution that must leave no braces.
 */
import {
  BROADCAST_VAR_EMPTY,
  buildBroadcastVars,
  dataAgeDays,
  findLeftoverTags,
  hasProfileData,
  isCardClean,
  normalizeEmpties,
  readProfileObject,
  safeImageUrl,
  stripBraceRuns,
  substituteCard,
} from '@/modules/content';

const translate = () => null;
const STORED_PROFILE = {
  data: {
    profile: {
      web_code: 'WEB1',
      phone: '0812345678',
      bank: { account_name: 'JUDY' },
    },
  },
  success: true,
};
const STORED_SITE = {
  data: { shop: { wallet: { wallet_setting: { is_open_deposit: true } } } },
  success: true,
};

describe('reader — the shape Mongo stores, not the shape the API returns', () => {
  it('reads the stored envelope', () => {
    expect(readProfileObject(STORED_PROFILE)?.['web_code']).toBe('WEB1');
    expect(hasProfileData(STORED_PROFILE)).toBe(true);
  });

  it('tolerates the older envelopes and a bare profile', () => {
    expect(
      readProfileObject({ data: { data: { profile: { web_code: 'A' } } } })?.[
        'web_code'
      ],
    ).toBe('A');
    expect(
      readProfileObject({ profile: { web_code: 'B' } })?.['web_code'],
    ).toBe('B');
    expect(readProfileObject({ web_code: 'C' })?.['web_code']).toBe('C');
  });

  it('🔴 says "no data" instead of inventing some', () => {
    // 11 of 13 members on the dev database have no blob at all.
    for (const bad of [
      null,
      undefined,
      '',
      42,
      [],
      { data: {} },
      { unrelated: 1 },
    ]) {
      expect(readProfileObject(bad)).toBeNull();
      expect(hasProfileData(bad)).toBe(false);
    }
  });

  it('reports data age without ever enforcing it', () => {
    const now = new Date('2026-08-22T00:00:00Z');
    expect(dataAgeDays(new Date('2026-08-17T00:00:00Z'), now)).toBe(5);
    expect(dataAgeDays(null, now)).toBeNull();
    expect(dataAgeDays(new Date('nope'), now)).toBeNull();
    // A future stamp is clamped rather than reported as negative days.
    expect(dataAgeDays(new Date('2026-09-01T00:00:00Z'), now)).toBe(0);
  });
});

describe('var map — four families in one place', () => {
  const vars = buildBroadcastVars({
    storedProfile: STORED_PROFILE,
    storedSiteRules: STORED_SITE,
    member: { display_name: 'judy', full_name: '', phone_number: '0812345678' },
    hook: {
      domain_name: 'example.com',
      company_name: 'Example',
      description: 'desc',
    },
    translate,
  });

  it('carries profile tags both prefixed and bare, as upstream does', () => {
    expect(vars['profile.phone']).toBe(vars['phone']);
    expect(vars['phone']).toBe('0812345678');
  });

  it('carries site_rules tags ONLY prefixed', () => {
    expect(Object.keys(vars).some((k) => k.startsWith('site_rules.'))).toBe(
      true,
    );
    expect(vars['dep_open']).toBeUndefined();
  });

  it('reads member columns straight off the row', () => {
    expect(vars['member.display_name']).toBe('judy');
    /* ⚠️ CHANGED, and the old expectation was the bug. This asserted `''` —
       pinning the very behaviour the owner's rule forbids. A column with no
       value is "we do not have this", which is `N/A`; `''` cannot even be sent
       (LINE refuses a flex text of empty string). ค่าที่ไม่มี = N/A ไม่ใช่ค่าว่าง. */
    expect(vars['member.full_name']).toBe(BROADCAST_VAR_EMPTY);
  });

  it('🔴 member.name walks the agreed fallback order', () => {
    expect(vars['member.name']).toBe('0812345678'); // full_name empty → phone
    const noneAtAll = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: {},
      hook: null,
      translate,
    });
    expect(noneAtAll['member.name']).toBe('member');
  });

  it('reads the hook context family off the hook row', () => {
    expect(vars['hook_domain']).toBe('example.com');
    expect(vars['hook_name']).toBe('Example');
  });

  it('🔴 a missing blob costs that family, never the whole map', () => {
    const partial = buildBroadcastVars({
      storedProfile: 'garbage',
      storedSiteRules: STORED_SITE,
      member: { display_name: 'ann' },
      hook: { domain_name: 'x.com' },
      translate,
    });
    expect(partial['member.display_name']).toBe('ann');
    expect(partial['hook_domain']).toBe('x.com');
    expect(Object.keys(partial).some((k) => k.startsWith('site_rules.'))).toBe(
      true,
    );
  });

  it('never lets an object become text', () => {
    const v = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: { display_name: { nested: true } as unknown as string },
      hook: null,
      translate,
    });
    /* An object means the map was built wrong. `N/A` is the honest answer;
       `String({})` would have shipped `[object Object]` to a customer. */
    expect(v['member.display_name']).toBe(BROADCAST_VAR_EMPTY);
  });

  it('🔴 the upstream "no value" marker becomes N/A, not a literal dash', () => {
    /* THE BUG THIS FILE MISSED. The cloned formatter answers `-` for a value it
       does not have — that is upstream's own marker and the drift specs require
       the clone to keep it. But `-` is a perfectly good string, so `substitute`
       had no reason to reject it and a customer would have read a bare dash in
       their card. `''` only survived by luck: substitute rejects empty strings
       on its own. เครื่องหมายขีดคือ "ไม่มีค่า" ของต้นทาง ต้องแปลงเป็น N/A ก่อนลงการ์ด. */
    const v = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: { display_name: '-', full_name: '  ' },
      hook: { domain_name: '-' },
      translate,
    });
    expect(v['member.display_name']).toBe(BROADCAST_VAR_EMPTY);
    expect(v['member.full_name']).toBe(BROADCAST_VAR_EMPTY);
    expect(v['hook_domain']).toBe(BROADCAST_VAR_EMPTY);

    // และไม่มีค่าไหนในแผนที่ทั้งอันที่เป็น '' หรือ '-' เหลืออยู่เลย
    for (const [tag, value] of Object.entries(v)) {
      expect([tag, value]).not.toEqual([tag, '']);
      expect([tag, value]).not.toEqual([tag, '-']);
    }
  });
});

describe('the escapes an audit found in the fallback itself', () => {
  it('🔴 E10 — a caller passing a DASH as the fallback still gets N/A', () => {
    /* This guarded only `''`, so `'-'` sailed through and every missing value
       rendered as the very marker the feature exists to remove — inside the
       one function whose docblock says the fallback "must never be empty". */
    const r = substituteCard('ยอด {{nope}} บาท', {}, '-');
    expect(r.card).toBe(`ยอด ${BROADCAST_VAR_EMPTY} บาท`);
  });

  it('🔴 E10 — whitespace as a fallback is refused too', () => {
    expect(substituteCard('{{nope}}', {}, '   ').card).toBe(
      BROADCAST_VAR_EMPTY,
    );
  });

  it('a real fallback the caller chose is respected', () => {
    expect(substituteCard('{{nope}}', {}, 'ไม่ระบุ').card).toBe('ไม่ระบุ');
  });

  it('🔴 E8 — a zero-width space is not a value, though trim() keeps it', () => {
    /* U+200B is a format character, not WhiteSpace, so `trim()` leaves it and
       a name field holding one rendered as a blank where a name belongs. */
    const v = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: { display_name: '\u200B', full_name: '\u00AD' },
      hook: null,
      translate,
    });
    expect(v['member.display_name']).toBe(BROADCAST_VAR_EMPTY);
    expect(v['member.full_name']).toBe(BROADCAST_VAR_EMPTY);
  });

  it('does not eat a real value that merely contains an invisible', () => {
    const v = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: { display_name: 'สม\u200Bชาย' },
      hook: null,
      translate,
    });
    expect(v['member.display_name']).toBe('สม\u200Bชาย');
  });
});

describe('substitution — and the promise that no brace survives', () => {
  const vars = { hook_domain: 'example.com', 'member.name': 'judy' };

  it('replaces what it knows', () => {
    const r = substituteCard(
      {
        type: 'text',
        text: 'สวัสดีคุณ {{member.name}} เข้าเว็บ {{hook_domain}}',
      },
      vars,
      'N/A',
    );
    expect((r.card as { text: string }).text).toBe(
      'สวัสดีคุณ judy เข้าเว็บ example.com',
    );
    expect([...r.resolved].sort()).toEqual(['hook_domain', 'member.name']);
    expect(r.unknown).toEqual([]);
  });

  it('🔴 sweeps a tag nobody knew about — an unresolved brace can 400 the card', () => {
    const r = substituteCard({ text: '{{who.is.this}}' }, vars, 'N/A');
    expect((r.card as { text: string }).text).toBe('N/A');
    expect(r.unknown).toEqual(['who.is.this']);
  });

  it('🔴 never substitutes an empty string — LINE rejects that outright', () => {
    const r = substituteCard({ text: '{{a}}' }, { a: '' }, 'N/A');
    expect((r.card as { text: string }).text).toBe('N/A');
  });

  it('refuses an empty fallback rather than obeying it', () => {
    const r = substituteCard({ text: '{{a}}' }, {}, '');
    expect((r.card as { text: string }).text).toBe('N/A');
  });

  it('reaches into arrays, nested objects and keys', () => {
    const r = substituteCard(
      {
        body: { contents: [{ text: '{{hook_domain}}' }] },
        '{{member.name}}': 1,
      },
      vars,
      'N/A',
    );
    expect(isCardClean(r.card)).toBe(true);
    expect(JSON.stringify(r.card)).toContain('judy');
  });

  it('tolerates spaces inside the braces, as the specs emit them', () => {
    const r = substituteCard({ text: '{{ hook_domain }}' }, vars, 'N/A');
    expect((r.card as { text: string }).text).toBe('example.com');
  });

  it('🔴 the leftover check reads the SERIALISED card, not a shallow look', () => {
    expect(findLeftoverTags({ a: [{ b: { c: '{{x}}' } }] })).toEqual(['x']);
    expect(isCardClean({ a: [{ b: { c: '{{x}}' } }] })).toBe(false);
  });

  it('a card that cannot be serialised is reported, not called clean', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(isCardClean(circular)).toBe(false);
  });

  it('the whole pipeline leaves a sendable card', () => {
    // map → N/A pass → image repair → substitute → clean
    const raw = buildBroadcastVars({
      storedProfile: null,
      storedSiteRules: null,
      member: { display_name: 'ann' },
      hook: { domain_name: 'x.com' },
      translate,
    });
    const filled = normalizeEmpties(raw);
    const card = {
      type: 'bubble',
      hero: { type: 'image', url: safeImageUrl('{{promo_img}}') },
      body: {
        text: 'hi {{member.display_name}} · {{profile.bank_account_name}}',
      },
    };
    const out = substituteCard(card, filled, BROADCAST_VAR_EMPTY);
    expect(isCardClean(out.card)).toBe(true);
    expect(JSON.stringify(out.card)).not.toContain('{{');
    expect(JSON.stringify(out.card)).toContain('ann');
  });
});

describe('🔴 D6 — a brace cannot be used to hide from the brace sweep', () => {
  /* MEASURED 23/08 against `ANY_BRACES = /\{\{[^{}]*\}\}/g`: every string below
     was delivered VERBATIM while `isCardClean` answered `true`. A character
     class that excludes `{` and `}` cannot match a pair that CONTAINS one, and
     both the substituter's second pass and the gate used that same class.
     ปีกกาชั้นในทำให้ทั้งคนแทนค่าและคนเฝ้าประตูตาบอดพร้อมกัน. */
  const NESTED = ['{{ a } b }}', 'hello {{x} }}', '{{ {tag} }}', '{{a{{b}}'];

  it('substitutes every one of them away', () => {
    for (const text of NESTED) {
      const out = JSON.stringify(substituteCard({ text }, {}, 'N/A').card);
      expect([text, out.includes('{{')]).toEqual([text, false]);
      expect([text, out.includes('}}')]).toEqual([text, false]);
    }
  });

  it('reports each as an unknown tag rather than swallowing it', () => {
    for (const text of NESTED) {
      expect([
        text,
        substituteCard({ text }, {}, 'N/A').unknown.length > 0,
      ]).toEqual([text, true]);
    }
  });

  it('🔴 `{{a{{b}}` no longer leaks the opener the tag pass leaves behind', () => {
    /* The tag pass reads `{{b}}` out of the middle and leaves `{{aN/A` — an
       opener with no closer, which a pair-shaped regex can never see. */
    expect(
      substituteCard({ text: '{{a{{b}}' }, { b: 'x' }, 'N/A').card,
    ).toEqual({
      text: 'N/A',
    });
  });

  it('🔴 the gate SEES them, so isCardClean stops reporting clean', () => {
    for (const text of NESTED) {
      expect([text, isCardClean({ text })]).toEqual([text, false]);
      expect([text, findLeftoverTags({ text }).length]).not.toEqual([text, 0]);
    }
  });

  it('🔴 an opener with no closer is a leftover, not silence', () => {
    expect(findLeftoverTags({ text: 'hi {{name' })).toEqual(['name']);
    expect(isCardClean({ text: 'hi {{name' })).toBe(false);
    expect(substituteCard({ text: 'hi {{name' }, {}, 'N/A').card).toEqual({
      text: 'hi N/A',
    });
  });

  it('🔴 cuts a nested pair at ITS OWN closer, not at end of string', () => {
    /* A survivor caught this: with the pair pattern back to `[^{}]*` the nested
       tag fell through to the unclosed-opener pass, which eats to the end — so
       the sweep was "clean" while it also ate the words after the tag. The pair
       must be seen AS a pair. ปีกกาปิดของตัวเองต้องหยุดการกวาด ไม่ใช่กินยาวถึงท้าย. */
    const r = substituteCard(
      { text: '{{ {tag} }} บาท และ {{member.name}}' },
      { 'member.name': 'judy' },
      'N/A',
    );
    expect(r.card).toEqual({ text: 'N/A บาท และ judy' });
  });

  it('🔴 the backstop CUTTER removes the run, it does not merely mark it', () => {
    /* `stripBraceRuns` is the builder's backstop — deliberately a scanner, so it
       cannot go blind at the same instant the substituter's regex does. Tested
       DIRECTLY because in normal operation substitution has already cleaned the
       card, so a defect in here is invisible until the day it is the only thing
       standing between a customer and `{{…}}`. ด่านสำรองต้องทดสอบตรง ๆ. */
    expect(stripBraceRuns('hi {{name', 'N/A')).toBe('hi N/A');
    expect(stripBraceRuns('{{ {tag} }} บาท', 'N/A')).toBe('N/A บาท');
    expect(stripBraceRuns('{{a}} กับ {{b}}', 'N/A')).toBe('N/A กับ N/A');
    // and it must not widen onto a single brace either
    expect(stripBraceRuns('ราคา {100} บาท', 'N/A')).toBe('ราคา {100} บาท');
  });

  it('does not widen onto a single brace', () => {
    const r = substituteCard({ text: 'ราคา {100} บาท' }, {}, 'N/A');
    expect(r.card).toEqual({ text: 'ราคา {100} บาท' });
    expect(r.unknown).toEqual([]);
    expect(isCardClean(r.card)).toBe(true);
  });
});

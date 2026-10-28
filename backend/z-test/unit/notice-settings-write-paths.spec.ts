/* [FEAT-20260822-NOTICEMODE] the hook "notice" settings mode — write paths
 * ===========================================================================
 * Seven additive columns (deposit/withdraw notice trios + follow switch) that
 * are written ONLY by two dedicated routes:
 *
 *     'PUT'   /hook/notice/:id     — per OA
 *     'PATCH' /hook/notice/bulk    — many OAs, same fields, same gate
 *
 * The mode deliberately joins NEITHER `ALLOWED_UPDATES` NOR
 * `BULK_SETTING_FIELDS` — both echo into messages that golden specs compare
 * with legacy byte for byte (see ignore-abandon-write-paths.spec.ts for that
 * story). The cases below pin both lists as UNCHANGED; that is an assertion,
 * not an incidental detail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

// through the barrel — a module-internal path is an eslint error here
import {
  CLONEABLE_TABS,
  FIELD_TAB,
  NEVER_CLONE,
  NOTICE_SCOPES,
  NOTICE_FIELDS,
  SENSITIVE_FIELD,
  fieldsForTabs,
  parseNoticeFields,
  noticeCardViolation,
  withoutUndefined,
  diffNoticeChanges,
  readNoticeScope,
} from '@/modules/hooks';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const CARD = 'a0d000000000000000000070'; // a valid ObjectId shape

describe('⭐ parseNoticeFields — the shape gate', () => {
  it('⭐ the string "false" cannot flip a toggle — typeof, never coercion', () => {
    /* the global pipe's enableImplicitConversion makes Boolean('false') true
       BEFORE any DTO validator runs — the raw-bag + typeof pattern is the only
       guard that works (measured on the abandon switch, not reasoned). */
    expect(() => parseNoticeFields({ notice_deposit_status: 'false' })).toThrow(
      BadRequestException,
    );
    expect(() => parseNoticeFields({ follow_player_status: 1 })).toThrow(
      'follow_player_status must be a boolean',
    );
  });

  it('⭐ scope accepts exactly text | all | slip — owner added slip 22/08', () => {
    expect([...NOTICE_SCOPES]).toEqual(['text', 'all', 'slip']);
    expect(parseNoticeFields({ notice_withdraw_scope: 'slip' })).toEqual({
      notice_withdraw_scope: 'slip',
    });
    expect(() =>
      parseNoticeFields({ notice_withdraw_scope: 'everything' }),
    ).toThrow('notice_withdraw_scope must be one of: text, all, slip');
  });

  it('a flex id is an ObjectId or null — nothing else', () => {
    expect(parseNoticeFields({ notice_deposit_flex_id: CARD })).toEqual({
      notice_deposit_flex_id: CARD,
    });
    expect(parseNoticeFields({ notice_deposit_flex_id: null })).toEqual({
      notice_deposit_flex_id: null,
    });
    expect(() => parseNoticeFields({ notice_deposit_flex_id: '' })).toThrow(
      'notice_deposit_flex_id must be a flex message id or null',
    );
  });

  it('⭐ one gate for every route — bulk takes cards too (owner: no debt)', () => {
    /* cards are GLOBAL documents (clone already fans one onto many OAs), so
       the bulk route shares this exact parse — status + card + scope can be
       switched on across many OAs in ONE request, and D6 holds because the
       card arrives in the same write. เจ้าของ 22/08: "เอาดีที่สุด ห้ามเป็นหนี้". */
    expect(
      parseNoticeFields({
        notice_withdraw_status: true,
        notice_withdraw_scope: 'slip',
        notice_withdraw_flex_id: CARD,
      }),
    ).toEqual({
      notice_withdraw_status: true,
      notice_withdraw_scope: 'slip',
      notice_withdraw_flex_id: CARD,
    });
    // and a COMPLETE side passes the D6 gate even on a bare row ([R2]: a
    // side needs its disable card AND its off-time card — D16 "เลือกให้ครบ")
    expect(
      noticeCardViolation(
        {
          notice_withdraw_status: true,
          notice_withdraw_flex_id: CARD,
          notice_withdraw_offtime_flex_id: CARD,
        },
        {},
      ),
    ).toBeNull();
  });

  it('a body with no notice field is refused, unknown keys are ignored', () => {
    expect(() => parseNoticeFields({ unrelated: true })).toThrow(
      'no notice field to update',
    );
    expect(
      parseNoticeFields({ notice_deposit_status: false, unrelated: true }),
    ).toEqual({ notice_deposit_status: false });
  });
});

describe('⭐ noticeCardViolation — D6, "ไม่ให้เซฟ เตือนเลือกให้ครบ"', () => {
  it('⭐ switching ON without a card is refused — judged on the EFFECTIVE state', () => {
    // card-less row, body turns the toggle on
    expect(noticeCardViolation({ notice_deposit_status: true }, {})).toBe(
      'deposit notice needs a flex card before it can be on',
    );
    // row already ON, body removes the card — same refusal, other direction
    expect(
      noticeCardViolation(
        { notice_withdraw_flex_id: null },
        { notice_withdraw_status: true, notice_withdraw_flex_id: CARD },
      ),
    ).toBe('withdraw notice needs a flex card before it can be on');
  });

  it('ON together with the WHOLE side in one write is legal ([R2] both cards)', () => {
    expect(
      noticeCardViolation(
        {
          notice_deposit_status: true,
          notice_deposit_flex_id: CARD,
          notice_deposit_offtime_flex_id: CARD,
        },
        {},
      ),
    ).toBeNull();
  });

  it('⭐ [R2] the off-time card is part of "ครบ" — missing it is refused', () => {
    expect(
      noticeCardViolation(
        { notice_deposit_status: true, notice_deposit_flex_id: CARD },
        {},
      ),
    ).toBe('deposit off-time notice needs a flex card before it can be on');
  });

  it('⭐ [R2] the slip cards are required ONLY when deposit scope is slip', () => {
    const fullSide = {
      notice_deposit_status: true,
      notice_deposit_flex_id: CARD,
      notice_deposit_offtime_flex_id: CARD,
    };
    // scope text (absent = text) → the all-cards are NOT demanded
    expect(noticeCardViolation(fullSide, {})).toBeNull();
    // scope slip → both all-cards must be present
    expect(
      noticeCardViolation({ ...fullSide, notice_deposit_scope: 'slip' }, {}),
    ).toBe('all off-time notice needs a flex card before it can be on');
    expect(
      noticeCardViolation(
        {
          ...fullSide,
          notice_deposit_scope: 'slip',
          notice_all_offtime_flex_id: CARD,
          notice_all_disable_flex_id: CARD,
        },
        {},
      ),
    ).toBeNull();
    // scope slip already ON THE ROW counts the same (effective state)
    expect(
      noticeCardViolation(fullSide, { notice_deposit_scope: 'slip' }),
    ).toBe('all off-time notice needs a flex card before it can be on');
  });

  it('⭐ follow_player_status needs no card', () => {
    expect(noticeCardViolation({ follow_player_status: true }, {})).toBeNull();
  });

  it('turning a toggle OFF is always legal, card or not', () => {
    expect(
      noticeCardViolation(
        { notice_deposit_status: false },
        { notice_deposit_status: true, notice_deposit_flex_id: CARD },
      ),
    ).toBeNull();
  });
});

describe('⭐ diffNoticeChanges — behavioural reads, the lean-row rule', () => {
  it('⭐ a row that predates the columns counts as OFF / text / no card', () => {
    /* .lean() skips schema defaults — every existing row answers undefined.
       Switching ON must therefore see a CHANGE on such a row. */
    expect(diffNoticeChanges({ follow_player_status: true }, {})).toEqual([
      { field: 'follow_player_status', from: false, to: true },
    ]);
  });

  it('⭐ writing the behavioural default onto an absent row is NO change', () => {
    /* audits stay honest and repeated calls leave no rows — the sibling rule */
    expect(diffNoticeChanges({ notice_deposit_status: false }, {})).toEqual([]);
    expect(diffNoticeChanges({ notice_withdraw_scope: 'text' }, {})).toEqual(
      [],
    );
  });

  it('an unknown stored scope reads as text, so writing "all" is a change', () => {
    expect(readNoticeScope('junk')).toBe('text');
    expect(
      diffNoticeChanges(
        { notice_withdraw_scope: 'all' },
        { notice_withdraw_scope: 'junk' },
      ),
    ).toEqual([{ field: 'notice_withdraw_scope', from: 'text', to: 'all' }]);
  });

  it('flex ids compare as strings — an ObjectId row equals its own id', () => {
    expect(
      diffNoticeChanges(
        { notice_deposit_flex_id: CARD },
        {
          notice_deposit_flex_id: CARD,
        },
      ),
    ).toEqual([]);
  });
});

describe('⭐ the legacy whitelists are left exactly as they were', () => {
  /* the exact three-entry content of BULK_SETTING_FIELDS is already pinned by
     ignore-abandon-write-paths.spec.ts — not repeated here (no duplicates).
     These cases only assert the NOTICE fields joined NEITHER list. */
  it('⭐ no notice field joined BULK_SETTING_FIELDS', () => {
    const helpers = src('src/modules/hooks/hook-write.helpers.ts');
    const from = helpers.indexOf('BULK_SETTING_FIELDS: readonly string[] = [');
    const list = helpers.slice(from, helpers.indexOf('];', from));
    for (const field of NOTICE_FIELDS) {
      expect(list).not.toContain(`'${field}'`);
    }
  });

  it('⭐ no notice field joined ALLOWED_UPDATES', () => {
    const svc = src('src/modules/hooks/hooks.service.ts');
    const from = svc.indexOf('ALLOWED_UPDATES: readonly string[] = [');
    const list = svc.slice(from, svc.indexOf('];', from));
    for (const field of NOTICE_FIELDS) {
      expect(list).not.toContain(`'${field}'`);
    }
  });
});

describe('⭐ the routes exist and the service does the sibling plumbing', () => {
  const ctl = src('src/modules/hooks/hooks.controller.ts');
  const svc = src('src/modules/hooks/hooks.service.ts');

  it("route-coverage: 'PUT' notice/:id and 'PATCH' notice/bulk are declared", () => {
    expect(ctl).toContain("@Put('notice/:id')");
    expect(ctl).toContain("@Patch('notice/bulk')");
    /* the raw bag, not a validated DTO class — see the typeof case above */
    const at = ctl.slice(ctl.indexOf("@Put('notice/:id')"));
    expect(at.slice(0, at.indexOf('async') + 300)).toContain(
      '@Body() body: HookBody',
    );
  });

  it('⭐ both write paths evict the hook cache', () => {
    const one = svc.slice(svc.indexOf('async updateHookNotice'));
    const oneBody = one.slice(0, one.indexOf('async bulkUpdateHookNotice'));
    expect(oneBody).toContain('this.hookCache.cacheHook(');
    expect(oneBody).toContain('previousAlias');
    const bulk = svc.slice(svc.indexOf('async bulkUpdateHookNotice'));
    const bulkBody = bulk.slice(0, bulk.indexOf('assertPaymentTargetsReady'));
    expect(bulkBody).toContain('this.hookCache.cacheHook(');
  });

  it('bulk checks access before writing anything — all or nothing', () => {
    const bulk = svc.slice(svc.indexOf('async bulkUpdateHookNotice'));
    const body = strip(bulk.slice(0, bulk.indexOf('updateMany')));
    expect(body).toContain('loadBulkTargets');
    expect(body).toContain('BlockedHooksException');
  });

  it('per-hook runs the same two-tier access guard as its siblings', () => {
    const one = svc.slice(svc.indexOf('async updateHookNotice'));
    const body = one.slice(0, one.indexOf('findByIdAndUpdate'));
    expect(body).toContain('this.ensureGroupAccess(');
    expect(body).toContain('assertHookInScope(');
  });
});

describe('⭐ the schema columns are additive with safe defaults', () => {
  const schema = src('src/modules/hooks/schemas/hook.schema.ts');

  it('toggles default false, scopes default text, cards default null', () => {
    const at = schema.slice(schema.indexOf('notice_deposit_status'));
    const block = at.slice(0, at.indexOf('follow_player_status') + 200);
    expect(schema).toContain('notice_deposit_status!: boolean;');
    expect(block).toContain("enum: ['text', 'all', 'slip'], default: 'text'");
    expect(block).toContain('notice_deposit_flex_id?: Types.ObjectId | null;');
    expect(block).toContain('follow_player_status!: boolean;');
  });
});

describe('⭐ clone — the notice tab travels, and the pair never splits', () => {
  /* owner, 22/08 round 4: cloneable — "ทำได้แต่ต้องห้ามพังของเดิม proof test
     seamless เลือกไม่เลือกก็ได้". Structural style copied from
     clone-payment-pairing.spec.ts. */
  it('⭐ every notice field sits on the notice tab, and the tab is cloneable', () => {
    for (const field of NOTICE_FIELDS) expect(FIELD_TAB[field]).toBe('notice');
    const keys = CLONEABLE_TABS.map((t) => t.key);
    expect(keys).toContain('notice');
    // appended LAST — the four legacy tabs keep their positions
    expect(keys[keys.length - 1]).toBe('notice');
  });

  it('selecting the tab yields the whole trio — a status never travels alone', () => {
    const fields = fieldsForTabs(['notice']);
    expect([...fields].sort()).toEqual([...NOTICE_FIELDS].sort());
  });

  it('⭐ none of the seven is opt-in-per-field, none is never-clone', () => {
    for (const field of NOTICE_FIELDS) {
      expect(SENSITIVE_FIELD[field]).toBeFalsy();
      expect(NEVER_CLONE.has(field)).toBe(false);
    }
  });

  it('⭐ a field-picked status drags its card onto a card-less target only', () => {
    /* the per-target mirror of the ai_vendor ↔ custom_ai_key drag: ON moving
       to a target with no card of its own pulls the source's card along; a
       target that has a card keeps it. */
    const svc = src('src/modules/hooks/hooks.service.ts');
    const at = svc.indexOf('for (const pair of N.NOTICE_CARD_PAIRS)');
    expect(at).toBeGreaterThan(-1);
    const block = svc.slice(at, svc.indexOf('// Sharing web_code', at));
    expect(block).toContain('updates[pair.status] === true');
    expect(block).toContain('!fields.includes(pair.flex)');
    expect(block).toContain('N.readNoticeFlex(target[pair.flex]) === null');
    expect(block).toContain('updates[pair.flex] = source[pair.flex]');
  });

  it('the four legacy tabs keep their exact field lists — appended, not mixed', () => {
    for (const tab of ['ai', 'slip', 'notifications', 'external_api']) {
      const fields = fieldsForTabs([tab]);
      for (const f of NOTICE_FIELDS) expect(fields).not.toContain(f);
    }
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] #12 · clone must not wedge a hook ───────────
 * RED first. `noticeCardViolation` guards the two write routes; the clone path
 * never called it, so a field-pick could leave a target with a toggle ON, a
 * scope of 'slip' and no all-cards — the exact state those routes refuse. The
 * hook then goes quiet at runtime AND rejects every later PUT, including edits
 * to the other side. clone ต้องไม่สร้าง state ที่ route ของตัวเองห้าม. */
describe('⭐ #12 the clone path enforces the same card gate', () => {
  it('⭐ the clone loop REFUSES a violating target, not merely computes it', () => {
    /* ⚠️ THE FIRST VERSION OF THIS CASE ONLY CHECKED THAT THE CALL EXISTED,
       and a mutation that replaced `if (noticeViolation)` with `if (false)`
       left it green — a test that measured nothing. Pin the branch AND its
       exit, so removing either goes red. เทสต้องจับตอนกลไกถูกถอด ไม่ใช่แค่ชื่อ. */
    const svc = src('src/modules/hooks/hooks.service.ts');
    const at = svc.indexOf('async cloneHookSettings');
    expect(at).toBeGreaterThan(-1);
    const body = svc.slice(at);
    const upToWrite = body.slice(
      0,
      body.indexOf('await this.hookModel.updateOne'),
    );
    expect(upToWrite).toContain('N.noticeCardViolation(');
    expect(upToWrite).toMatch(/if \(noticeViolation\) \{/);
    // the refusal must SKIP the target, never fall through to the write
    const branch = upToWrite.slice(upToWrite.indexOf('if (noticeViolation)'));
    expect(branch).toContain("reason: 'notice_cards_incomplete'");
    expect(branch.slice(0, branch.indexOf('}\n\n'))).toContain('continue;');
  });

  it('⭐ a scope-only pick that would break D6 is refused, not written', () => {
    /* target: toggle ON, both side cards, scope text, no all-cards.
       pick: only the scope, from a source whose scope is 'slip'. */
    const target = {
      notice_deposit_status: true,
      notice_deposit_flex_id: CARD,
      notice_deposit_offtime_flex_id: CARD,
      notice_deposit_scope: 'text',
    };
    expect(noticeCardViolation({ notice_deposit_scope: 'slip' }, target)).toBe(
      'all off-time notice needs a flex card before it can be on',
    );
  });
});

/* [FIX-20260822-NOTICECOLLIDE] the gate must not punish unrelated clones. */
describe('⭐ the clone gate is scoped to clones that touch notice fields', () => {
  it('⭐ an unrelated clone onto a badly-configured target still goes through', () => {
    const svc = src('src/modules/hooks/hooks.service.ts');
    const at = svc.indexOf('async cloneHookSettings');
    const body = svc.slice(
      at,
      svc.indexOf('await this.hookModel.updateOne', at),
    );
    expect(body).toContain('const touchesNotice = N.NOTICE_FIELDS.some(');
    expect(body).toMatch(/touchesNotice\s*\n?\s*\?\s*N\.noticeCardViolation/);
  });

  it('⭐ a notice-touching clone is still judged on the effective state', () => {
    // (unit-level proof of the rule the clone now calls)
    expect(
      noticeCardViolation(
        { notice_deposit_scope: 'slip' },
        {
          notice_deposit_status: true,
          notice_deposit_flex_id: CARD,
          notice_deposit_offtime_flex_id: CARD,
        },
      ),
    ).toBe('all off-time notice needs a flex card before it can be on');
  });
});

/* ── [FIX-20260822-CLONEUNDEF] #12b · the gate must judge the REAL write ─────
 * Found by an adversarial review of #12, and confirmed against the compiled
 * gate: the clone differ writes `updates[field] = source[field]`, so a source
 * row that never stored a notice field lands an explicit `undefined` in the
 * bag. Mongoose strips undefined out of `$set` — nothing is written — but the
 * gate read that key as PRESENT and its value as "off", skipped the card
 * requirement, and let the clone leave exactly the locked-out state #12 was
 * written to prevent. undefined ไม่ใช่การเขียน ต้องตัดทิ้งก่อนตัดสิน. */
describe('⭐ #12b an `undefined` in the clone bag is not a write', () => {
  /* an OA the routes are happy with today: deposit notice ON, scope 'text',
     both deposit cards bound, no `all` cards (scope 'text' does not need them). */
  const target = {
    notice_deposit_status: true,
    notice_deposit_scope: 'text',
    notice_deposit_flex_id: 'a'.repeat(24),
    notice_deposit_offtime_flex_id: 'b'.repeat(24),
  };

  it('⭐ a scope-only clone from a source that never stored the toggle is REFUSED', () => {
    /* the field pick includes the toggle, but the source never stored it */
    const bag = {
      notice_deposit_status: undefined,
      notice_deposit_scope: 'slip',
    };
    // the shape the gate used to see: the toggle reads as OFF → no card needed
    expect(noticeCardViolation(bag, target)).toBeNull();
    // the shape it sees now: the toggle stays ON from the row → 'all' cards
    // are required by scope 'slip', and this clone would leave none.
    expect(noticeCardViolation(withoutUndefined(bag), target)).toMatch(
      /all off-time/,
    );
  });

  it('⭐ the mirror: an undefined CARD must not refuse a clone that changes nothing', () => {
    const bag = { notice_deposit_offtime_flex_id: undefined };
    // read literally, the card is being cleared → refusal for a no-op clone
    expect(noticeCardViolation(bag, target)).toMatch(/off-time/);
    // read as what will actually be written: nothing changes, nothing refused
    expect(noticeCardViolation(withoutUndefined(bag), target)).toBeNull();
  });

  it('⭐ withoutUndefined touches nothing else — false, null and 0 all survive', () => {
    expect(
      withoutUndefined({
        a: false,
        b: null,
        c: 0,
        d: '',
        e: undefined,
      }),
    ).toEqual({ a: false, b: null, c: 0, d: '' });
  });

  it('⭐ the clone path judges the effective bag, not the raw one', () => {
    const svc = src('src/modules/hooks/hooks.service.ts');
    const at = svc.indexOf('async cloneHookSettings');
    const body = svc.slice(at, at + 40000);
    expect(body).toContain('N.withoutUndefined(updates)');
    // and the gate reads that bag, never `updates` directly
    expect(body).toContain('N.noticeCardViolation(effectiveUpdates, target)');
    expect(body).not.toContain('N.noticeCardViolation(updates, target)');
  });
});

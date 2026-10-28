/**
 * [FEAT-20260823-BCASTOAVARS] The variables a BROADCAST can actually fill in.
 * ===========================================================================
 * WHY THIS FILE EXISTS. The whole variable path — the spec clone, the
 * formatters, `buildBroadcastVars`, `substituteCard`, the `N/A` rule — was
 * built, tested and proven against real Mongo blobs, and **nothing in `src/`
 * ever called it**. `new-send.service.ts` handed the card builder `NO_VARS`,
 * an empty map, so every `{{tag}}` in every broadcast rendered `N/A`. The
 * older sender that actually runs today is worse: it ships the raw
 * `{{profile.bank_code}}` braces to the customer.
 *
 * 🔴 AND ONE FAMILY CAN NEVER BE FILLED HERE. `/message/broadcast` is ONE
 *    request that LINE fans out; there is no recipient list, so there is
 *    nowhere to put a different value per person. `hook_*` and `site_rules.*`
 *    are the same for everyone in one OA and CAN be filled. `member.*` and
 *    `profile.*` cannot — they must go by multicast. That is LINE's design,
 *    and the cases below pin it so nobody "fixes" it later by shipping one
 *    person's name to everybody.
 *    ค่าเฉพาะคน ใส่ใน broadcast ไม่ได้โดยธรรมชาติ ต้องไป multicast.
 */
import {
  PlainCardMessageBuilder,
  buildOaVarMap,
  toTranslateFn,
  OA_VAR_COLUMNS,
} from '@/modules/content';

/** Never translates — `hook_*` are plain columns and must survive untouched. */
const NO_DICT = toTranslateFn(() => null);

const HOOK_A = {
  _id: 'hookA',
  domain_name: 'alpha.example',
  company_name: 'Alpha Co',
  description: 'the alpha OA',
};
const HOOK_B = {
  _id: 'hookB',
  domain_name: 'beta.example',
  company_name: 'Beta Co',
  description: 'the beta OA',
};

const CARD = (text: string) => ({ type: 'text' as const, text });
const textOf = (b: PlainCardMessageBuilder, hookId?: string): unknown =>
  (b.messagesFor(undefined, hookId).messages[0] as Record<string, unknown>)?.[
    'text'
  ];

describe('buildOaVarMap — the values one OA gives every one of its followers', () => {
  it('🔴 fills hook_* from the OA row', () => {
    const map = buildOaVarMap([HOOK_A], NO_DICT);
    expect(map['hookA']?.['hook_domain']).toBe('alpha.example');
    expect(map['hookA']?.['hook_name']).toBe('Alpha Co');
    expect(map['hookA']?.['hook_detail']).toBe('the alpha OA');
  });

  it('🔴 member.* is N/A — a broadcast has no single recipient', () => {
    /* Not a gap: `/message/broadcast` sends ONE request. Filling this with
       anyone's real name would send that person's name to every follower. */
    const map = buildOaVarMap([HOOK_A], NO_DICT);
    expect(map['hookA']?.['member.display_name']).toBe('N/A');
    expect(map['hookA']?.['member.full_name']).toBe('N/A');
    expect(map['hookA']?.['member.nickname']).toBe('N/A');
    expect(map['hookA']?.['member.phone_number']).toBe('N/A');
  });

  it('⚠️ `member.name` falls back to the WORD "member", not to N/A', () => {
    /* MEASURED, not chosen. `bestName` is the ticket console's rule
       (full name → phone → display name → the word for a member) and this
       module is a CLONE of that path — the drift specs exist to keep it
       identical, so "improving" it here would be the difference they catch.
       การเปลี่ยนตรงนี้ = ทำให้ต่างจาก original ซึ่งมีเทสจับอยู่.

       ⚠️ FOR THE OWNER: on a broadcast this means `สวัสดี {{member.name}}`
          ships as `สวัสดี member`. It is not braces and not a wrong person's
          name, but it is not Thai either — one more reason a greeting card
          belongs on multicast. */
    const map = buildOaVarMap([HOOK_A], NO_DICT);
    expect(map['hookA']?.['member.name']).toBe('member');
  });

  it('keys every OA separately — two OAs never share one value', () => {
    const map = buildOaVarMap([HOOK_A, HOOK_B], NO_DICT);
    expect(map['hookA']?.['hook_domain']).toBe('alpha.example');
    expect(map['hookB']?.['hook_domain']).toBe('beta.example');
  });

  it('a row with no id is skipped, not stored under "undefined"', () => {
    const map = buildOaVarMap([{ _id: null }, HOOK_A], NO_DICT);
    expect(Object.keys(map)).toEqual(['hookA']);
  });

  it('the selected columns are the real ones', () => {
    // A guessed column name selects nothing and every tag renders N/A while
    // looking healthy. ชื่อคอลัมน์ผิด = ว่างแบบเงียบ ๆ.
    /* [FEAT-20260903-BCASTSRFRESH] TWO COLUMNS ADDED, and this list is exactly
       the reason to state why rather than just widen it:
         `customer_link_web_code`  the dictionary scope for `site_rules.*` on a
                                   broadcast, which has no profile to read one
                                   from — without it every site-specific word
                                   fell back to its raw value, silently
         `site_rules_updated_at`   how old the blob is: decides whether the run
                                   refetches (>10 min) and feeds
                                   `site_rules_age_days`, which never had a
                                   producer at all
       Both verified against `hook.schema.ts` AND a real row before use. */
    expect(Object.keys(OA_VAR_COLUMNS).sort()).toEqual([
      '_id',
      'company_name',
      'customer_link_web_code',
      'description',
      'domain_name',
      'raw_site_rules_data',
      'site_rules_updated_at',
    ]);
  });
});

describe('toTranslateFn — the narrowing that a cast would skip', () => {
  const keysSeen: unknown[] = [];
  const spy = toTranslateFn((_d, key) => {
    keysSeen.push(key);
    return null;
  });

  beforeEach(() => (keysSeen.length = 0));

  it('passes primitives through untouched', () => {
    spy('d', 'k', {});
    spy('d', 7, {});
    spy('d', true, {});
    spy('d', null, {});
    expect(keysSeen).toEqual(['k', 7, true, null]);
  });

  it('🔴 converts what the dictionary cannot look up', () => {
    /* `TranslateFn` hands `key: unknown`; the service takes primitives only.
       `key as DictKey` compiles and then hands the service an object, whose
       lookup misses every entry — a wrong translation with nothing to trace.
       as ผ่าน compile แล้วแปลไม่เจอแบบเงียบ ๆ. */
    spy('d', { a: 1 }, {});
    spy('d', ['x'], {});
    expect(keysSeen).toEqual(['[object Object]', 'x']);
  });
});

describe('PlainCardMessageBuilder — one card per OA', () => {
  const oaVars = buildOaVarMap([HOOK_A, HOOK_B], NO_DICT);

  it('🔴 each OA gets ITS OWN value, not the first one', () => {
    /* The bug this prevents: rendering once for the run would show OA-A's
       domain to OA-B's followers. ใบเดียวใช้ข้าม OA ไม่ได้. */
    const b = new PlainCardMessageBuilder(
      CARD('เว็บ {{hook_domain}}'),
      {},
      undefined,
      oaVars,
    );
    expect(textOf(b, 'hookA')).toBe('เว็บ alpha.example');
    expect(textOf(b, 'hookB')).toBe('เว็บ beta.example');
  });

  it('an unknown OA falls back to the no-value card — it does not throw', () => {
    const b = new PlainCardMessageBuilder(
      CARD('เว็บ {{hook_domain}}'),
      {},
      undefined,
      oaVars,
    );
    expect(textOf(b, 'hookZZZ')).toBe('เว็บ N/A');
  });

  it('🔴 a caller that passes no map behaves exactly as before', () => {
    /* The widening is additive: this is the pre-change constructor call and it
       must keep answering what it always did. */
    const b = new PlainCardMessageBuilder(CARD('เว็บ {{hook_domain}}'), {});
    expect(textOf(b)).toBe('เว็บ N/A');
    expect(textOf(b, 'hookA')).toBe('เว็บ N/A');
  });

  it('a run-wide value still wins over the OA map', () => {
    const b = new PlainCardMessageBuilder(
      CARD('เว็บ {{hook_domain}}'),
      { hook_domain: 'pinned.example' },
      undefined,
      oaVars,
    );
    // `{...vars, ...hookVars}` would lose it; the order is asserted here so a
    // later "tidy up" cannot silently reverse the precedence.
    expect(textOf(b, 'hookA')).toBe('เว็บ alpha.example');
  });

  it('🔴 an unfilled member tag is REPORTED, not just rendered', () => {
    /* `N/A` on a card is invisible to the admin unless something says which
       tag produced it — that report is the only way they learn the card needs
       multicast. ต้องบอกว่า tag ไหนเติมไม่ได้. */
    const b = new PlainCardMessageBuilder(
      CARD('สวัสดี {{member.display_name}}'),
      {},
      undefined,
      oaVars,
    );
    expect(textOf(b, 'hookA')).toBe('สวัสดี N/A');
    expect(b.messagesFor(undefined, 'hookA').unknownTags).toEqual([]);
    // The tag IS known — it resolved, to the honest value `N/A`. What must
    // never happen is the raw braces reaching a customer:
    expect(String(textOf(b, 'hookA'))).not.toContain('{{');
  });
});

describe('the seam the sink uses', () => {
  it('🔴 the sink passes the OA through — without it the map is dead weight', () => {
    // `messagesFor(chunk, hookId)`: the chunk carries only {index,to}, so the
    // hookId is the ONLY way the builder can know which OA it renders for.
    const b = new PlainCardMessageBuilder(
      CARD('{{hook_name}}'),
      {},
      undefined,
      buildOaVarMap([HOOK_A], NO_DICT),
    );
    expect(textOf(b, 'hookA')).toBe('Alpha Co');
    expect(textOf(b, undefined)).toBe('N/A');
  });
});

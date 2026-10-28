/* [FEAT-20260821-IGNOREABANDON] "leave this one alone" — per OA and per customer
 * ===========================================================================
 * The owner asked for a switch that stops the abandon chase, and asked for it
 * under four constraints, each of which has a case below:
 *   · *"member column จริงไม่ใช่ config follow ไม่เกี่ยว"* — a column of its own on
 *     both collections, never the `config` bag and never a `follow_up.*` path;
 *   · *"เงื่อนไขการวางก็วางไว้ตรงที่เชค abadnon นั้นแหละ"* — the guard sits at the
 *     abandon check, which means AFTER level 0, so the clear step keeps running;
 *   · *"ย้ายไปอยู่แท็บ ai จะได้ clone ได้"* — on the AI tab AND in `FIELD_TAB`,
 *     because the first alone copies nothing;
 *   · *"ทุกอย่างต้อง seamless + อิสระ ถอดได้"* — a caller that never heard of the
 *     field behaves exactly as it did before the field existed.
 *
 * ⚠️ THE ONE THAT MATTERS MOST is `=== true`. Both columns declare
 * `default: false`, and that default does not survive `.lean()` — the hot path
 * reads hooks and members lean, so every pre-existing row answers `undefined`.
 * Written as `!== false` or `?? true`, this feature would switch itself ON for
 * the entire database on deploy, silently. The cases under "undefined is not
 * true" exist to make that mistake impossible to ship.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  abandonIsSwitchedOff,
  runFollowUpGate,
} from '@/modules/webhook/follow-up';
// the same import shape 138 other specs in this folder already use
import { FIELD_TAB, CLONEABLE_TABS } from '@/modules/hooks/hook-field-tabs';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('⭐ either side can switch the chase off', () => {
  it('the OA switches it off for every customer on it', () => {
    expect(
      abandonIsSwitchedOff({ hook: { ignore_abandon_assist: true } }),
    ).toBe(true);
  });

  it('one customer switches it off for themselves', () => {
    expect(
      abandonIsSwitchedOff({ member: { ignore_abandon_assist: true } }),
    ).toBe(true);
  });

  it('a customer opted out stays out on a chasing OA', () => {
    expect(
      abandonIsSwitchedOff({
        hook: { ignore_abandon_assist: false },
        member: { ignore_abandon_assist: true },
      }),
    ).toBe(true);
  });

  it('neither side asking for it leaves the chase on', () => {
    expect(
      abandonIsSwitchedOff({
        hook: { ignore_abandon_assist: false },
        member: { ignore_abandon_assist: false },
      }),
    ).toBe(false);
  });
});

describe('⭐ undefined is not true — the whole database is not opted out', () => {
  /* the deploy-day trap: `.lean()` skips schema defaults, so every existing row
     reads `undefined`. ค่าเก่าอ่านได้ undefined ไม่ใช่ false. */
  it('a row that predates the column keeps being chased', () => {
    expect(abandonIsSwitchedOff({ hook: {}, member: {} })).toBe(false);
    expect(
      abandonIsSwitchedOff({
        hook: { ignore_abandon_assist: undefined },
        member: { ignore_abandon_assist: undefined },
      }),
    ).toBe(false);
  });

  it('⭐ no truthy value other than the boolean counts', () => {
    /* a string 'false' from a form, a 1 from a legacy row, a stray object —
       every one of these is truthy in JS and none of them means yes here. */
    for (const v of ['true', 'false', 1, 0, 'yes', {}, [], 'on']) {
      expect(abandonIsSwitchedOff({ hook: { ignore_abandon_assist: v } })).toBe(
        false,
      );
    }
  });

  it('the source says `=== true`, in both places it is read', () => {
    const rule = src('src/modules/webhook/follow-up/ignore-abandon.rule.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(rule).toContain('=== true');
    expect(rule).not.toMatch(/!==\s*false/);
    expect(rule).not.toMatch(/\?\?\s*true/);
  });
});

describe('⭐ a row can arrive as anything and nothing throws', () => {
  /* folder rule 7: never throw beside a live conversation. */
  it('null, undefined, a bare id string, a number', () => {
    for (const row of [null, undefined, 'a-member-id', 42, true]) {
      expect(abandonIsSwitchedOff({ hook: row, member: row })).toBe(false);
    }
  });

  it('no input at all', () => {
    expect(abandonIsSwitchedOff(null)).toBe(false);
    expect(abandonIsSwitchedOff(undefined)).toBe(false);
  });
});

describe('⭐ the guard sits at the abandon check, not in front of the gate', () => {
  const deps = () =>
    ({
      chatMessageModel: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              lean: () => ({ exec: () => Promise.resolve([]) }),
            }),
          }),
        }),
      },
      memberModel: {
        updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
      },
      warn: () => undefined,
    }) as never;

  it('⭐ level 0 still clears a customer who finally registered', async () => {
    /* the reason the guard is not first: turning the chase off must not strand
       an already-marked row. ปิดการตาม ≠ ปิดการล้างค่า. */
    const memberModel = {
      updateOne: jest.fn(() => ({
        exec: () => Promise.resolve({ modifiedCount: 1 }),
      })),
    };
    /* the clear only writes when there IS a mark to remove — a member without
       one short-circuits before touching the database. */
    const verdict = await runFollowUpGate(
      {
        hasProfile: true,
        room: { _id: 'r1' },
        member: {
          _id: 'm1',
          line_user_id: 'U1',
          config: { follow_up: { line: { abandon_trigger_at: new Date() } } },
        },
        channelUserId: 'U1',
        hook: { ignore_abandon_assist: true },
      },
      { ...(deps() as object), memberModel } as never,
    );
    expect(memberModel.updateOne).toHaveBeenCalled();
    expect(verdict.memberNeedRegister).toBe(false);
    expect(verdict.handOffToRegister).toBe(false);
  });

  it('⭐ level 2 does not fire for an already-marked customer', async () => {
    const marked = {
      _id: 'm1',
      config: { follow_up: { line: { abandon_trigger_at: new Date() } } },
    };
    const on = await runFollowUpGate(
      {
        hasProfile: false,
        room: { _id: 'r1' },
        member: marked,
        channelUserId: 'U1',
      },
      deps(),
    );
    expect(on.handOffToRegister).toBe(true);

    const off = await runFollowUpGate(
      {
        hasProfile: false,
        room: { _id: 'r1' },
        member: marked,
        channelUserId: 'U1',
        hook: { ignore_abandon_assist: true },
      },
      deps(),
    );
    expect(off.handOffToRegister).toBe(false);
  });

  it('⭐ level 1 never reads chat history when the switch is off', async () => {
    /* not just a different answer — the query must not happen at all. */
    const find = jest.fn(() => ({
      sort: () => ({
        limit: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      }),
    }));
    await runFollowUpGate(
      {
        hasProfile: false,
        room: { _id: 'r1' },
        member: { _id: 'm1' },
        channelUserId: 'U1',
        hook: { ignore_abandon_assist: true },
      },
      { ...(deps() as object), chatMessageModel: { find } } as never,
    );
    expect(find).not.toHaveBeenCalled();
  });
});

describe('⭐ seamless — a caller that never heard of the field is unchanged', () => {
  it('omitting `hook` behaves exactly as before the field existed', async () => {
    const deps = {
      chatMessageModel: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              lean: () => ({ exec: () => Promise.resolve([]) }),
            }),
          }),
        }),
      },
      memberModel: { updateOne: () => ({ exec: () => Promise.resolve({}) }) },
      warn: () => undefined,
    } as never;
    const marked = {
      _id: 'm1',
      config: { follow_up: { line: { abandon_trigger_at: new Date() } } },
    };
    const verdict = await runFollowUpGate(
      {
        hasProfile: false,
        room: { _id: 'r1' },
        member: marked,
        channelUserId: 'U1',
      },
      deps,
    );
    expect(verdict.handOffToRegister).toBe(true);
  });

  it('the gate field is optional, so old callers still typecheck', () => {
    const gate = src('src/modules/webhook/follow-up/follow-up.gate.ts');
    expect(gate).toMatch(/hook\?:/);
  });
});

describe('⭐ the field travels when a hook is cloned', () => {
  it('⭐ it is mapped in FIELD_TAB — CLONEABLE_TABS alone copies nothing', () => {
    /* `CLONEABLE_TABS` says which tab may be targeted; `FIELD_TAB` says which
       fields go. Without the second, a clone succeeds and copies nothing, with
       no error. `doc_retrieval` is the proof: it is absent here and cannot be
       cloned today. */
    expect(FIELD_TAB['ignore_abandon_assist']).toBe('ai');
    expect(CLONEABLE_TABS.map((t) => t.key)).toContain('ai');
  });
});

describe('⭐ the write path cannot drop it silently', () => {
  const hooks = src('src/modules/hooks/hooks.service.ts');

  it('⭐ it is on ALLOWED_UPDATES — otherwise edit returns 200 and changes nothing', () => {
    /* createHook does not use this list, so omitting the field here produces the
       classic report: "create works, edit does not". */
    expect(hooks).toMatch(/'ignore_abandon_assist',/);
  });

  it('both create and update run it through the parser', () => {
    const calls = hooks.match(/parseIgnoreAbandonAssist\(/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('the update branch keys on hasOwnProperty, so an explicit clear lands', () => {
    const idx = hooks.indexOf(
      "hasOwnProperty.call(updates, 'ignore_abandon_assist')",
    );
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('⭐ it is a column, not a settings bag entry', () => {
  it('⭐ member declares it as its own @Prop', () => {
    const member = src('src/modules/chat/schemas/member.schema.ts');
    expect(member).toMatch(
      /@Prop\(\{ type: Boolean, default: false \}\)\s*\n\s*ignore_abandon_assist\?: boolean;/,
    );
  });

  it('⭐ nothing routes it through the member-config registry', () => {
    /* owner: "member column จริงไม่ใช่ config follow ไม่เกี่ยว"
     *
     * ⚠️ [FIX-20260904-REGKEYNOTPROSE] This asserted on the FILE TEXT — the
     * registry source must not contain the string at all. That was a proxy for
     * the rule, and the proxy broke: `[FEAT-20260904-REGANYSTAMP]` added a
     * comment there explaining that the close-case dialog sets this member
     * column, which is exactly the kind of cross-reference that file exists to
     * carry ("SAY IT HERE BECAUSE THIS FILE IS WHERE PEOPLE COME TO ASK"). The
     * suite went red over a sentence while the rule itself was never broken.
     *
     * The rule is about ROUTING: the field must not be a key of the registry.
     * Asking the exported object is both narrower and stronger than a text
     * scan — it survives a rename of the file, and it cannot be satisfied by
     * spelling the key differently in prose.
     * กฎคือ "ห้ามเป็นคีย์ใน registry" ไม่ใช่ "ห้ามเอ่ยชื่อ" — ถามตัวออบเจกต์ตรง ๆ */

    const { MEMBER_CONFIG_KEYS } =
      require('@/modules/chat/config/member-config.registry') as {
        MEMBER_CONFIG_KEYS: Record<string, unknown>;
      };
    expect(Object.keys(MEMBER_CONFIG_KEYS)).not.toContain(
      'ignore_abandon_assist',
    );
  });

  it('the rule file never names a follow_up path', () => {
    const rule = src('src/modules/webhook/follow-up/ignore-abandon.rule.ts');
    expect(rule).not.toMatch(/follow_up\./);
  });

  it('hook declares it as a column too', () => {
    const hook = src('src/modules/hooks/schemas/hook.schema.ts');
    expect(hook).toMatch(
      /@Prop\(\{ type: Boolean, default: false \}\)\s*\n\s*ignore_abandon_assist!: boolean;/,
    );
  });
});

describe('⭐ อิสระ — the leaf can be lifted out on its own', () => {
  it('⭐ the rule file imports nothing at all', () => {
    /* folder rule 3: deciding is separate from storing, so this can run over
       plain rows in a cron, a CLI or a test. */
    const rule = src('src/modules/webhook/follow-up/ignore-abandon.rule.ts');
    expect(rule).not.toMatch(/^\s*import\s/m);
  });

  it('only the gate composes it — no helper reaches for it', () => {
    /* folder rule 5. */
    const dir = 'src/modules/webhook/follow-up/';
    for (const f of [
      'abandon-trigger.helper.ts',
      'abandon-trigger.rule.ts',
      'clear-follow-up.helper.ts',
    ]) {
      expect(src(dir + f)).not.toContain('ignore-abandon.rule');
    }
  });
});

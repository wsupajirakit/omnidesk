/**
 * [FIX-20260918-AUTOTRANSOR] Either level may switch translation on — crossed.
 * =============================================================================
 * Owner's rule, 18/09: *"ถ้า room false = ไปอ่าน hook ไม่ใช่หยุดแปล หยุดเว้นว่า room
 * false แล้ว hook ก็ปิดเหมือนกันอีก อันนี้คือไม่แปล"*.
 *
 * The bug this replaces was real and the owner hit it: the OA switch was ticked
 * ON and inbound messages still were not translated, because the room had been
 * saved as `false` and the old rule treated that as an override.
 *
 * The backend owns the decision (`room-translate-settings.ts`) and its own cross
 * matrix proves it. What THIS file guards is that the dashboard agrees — a
 * header badge or a modal switch that disagrees with the server is its own bug,
 * and this rule lived in two hand-written copies until today.
 */
import { describe, it, expect } from 'vitest';

import {
  isAutoTranslateOn,
  type RoomAutoTranslateFields,
} from '../services/chat/roomAutoTranslate';

/* Everything a room can hold for its own switch. The last three all mean "this
   room asks for nothing" and must behave identically — that equivalence is what
   makes the schema default flipping from `null` to `false` safe. */
const ROOM: Array<[string, boolean | null | undefined]> = [
  ['room ON', true],
  ['room OFF', false],
  ['room null', null],
  ['room absent', undefined],
];
const HOOK: Array<[string, boolean | null | undefined]> = [
  ['hook ON', true],
  ['hook OFF', false],
  ['hook absent', undefined],
];

const build = (
  room: boolean | null | undefined,
  hook: boolean | null | undefined,
): RoomAutoTranslateFields => ({
  ...(room === undefined ? {} : { auto_translate: room }),
  ...(hook === undefined ? {} : { hook_auto_translate: hook }),
});

describe('[AUTOTRANSOR] the 12 combinations, crossed', () => {
  const cases = ROOM.flatMap(([rn, rv]) =>
    HOOK.map(([hn, hv]) => [`${rn} + ${hn}`, rv, hv] as const),
  );

  it('covers all twelve', () => {
    expect(cases).toHaveLength(12);
  });

  it.each(cases)('%s', (_name, rv, hv) => {
    // The rule, stated once: OR.
    expect(isAutoTranslateOn(build(rv, hv))).toBe(Boolean(rv) || Boolean(hv));
  });

  it('🔴 room OFF + hook ON is ON — the case the owner reported', () => {
    expect(isAutoTranslateOn(build(false, true))).toBe(true);
  });

  it('🔴 only both-off is off', () => {
    const off = [
      build(false, false),
      build(false, undefined),
      build(null, false),
      build(undefined, undefined),
    ];

    for (const room of off) expect(isAutoTranslateOn(room)).toBe(false);
    expect(isAutoTranslateOn(build(true, false))).toBe(true);
  });

  it('false, null and absent are the same answer against every hook state', () => {
    for (const [, hv] of HOOK) {
      const answers = [false, null, undefined].map((rv) =>
        isAutoTranslateOn(build(rv, hv)),
      );

      expect(new Set(answers).size).toBe(1);
    }
  });
});

describe('[AUTOTRANSOR] the server decides when it has spoken', () => {
  it("prefers the backend's effective answer over the local OR", () => {
    /* The backend computes this from the same two inputs. If the two ever
       disagree the server is right — the dashboard is not allowed to overrule
       a decision the translation path already made. */
    expect(
      isAutoTranslateOn({
        auto_translate: false,
        hook_auto_translate: false,
        effective_auto_translate: true,
      }),
    ).toBe(true);

    expect(
      isAutoTranslateOn({
        auto_translate: true,
        hook_auto_translate: true,
        effective_auto_translate: false,
      }),
    ).toBe(false);
  });

  it('falls back to the OR before the settings fetch returns', () => {
    // `effective_auto_translate` absent = the payload has not arrived yet.
    expect(isAutoTranslateOn({ auto_translate: false, hook_auto_translate: true })).toBe(true);
  });

  it.each([
    ['null instead of a boolean', null],
    ['undefined', undefined],
  ])('an effective value of %s is not trusted — it falls back', (_n, eff) => {
    expect(
      isAutoTranslateOn({
        auto_translate: false,
        hook_auto_translate: true,
        effective_auto_translate: eff as boolean | null,
      }),
    ).toBe(true);
  });

  it('🔴 no room at all is OFF, never a crash', () => {
    expect(isAutoTranslateOn(null)).toBe(false);
    expect(isAutoTranslateOn(undefined)).toBe(false);
    expect(isAutoTranslateOn({})).toBe(false);
  });
});

describe('[AUTOTRANSOR] both screens read the one rule', () => {
  /* A drift guard in this repo's established shape: the two components that
     used to hand-write this must now call the helper. A third copy appearing is
     exactly how the header and the modal started disagreeing. */
  it.each([
    'components/chat/room-header/parts/HeaderActions.tsx',
    'components/chat/room-header/parts/room-translate/RoomTranslateModal.tsx',
  ])('%s calls isAutoTranslateOn and hand-writes nothing', async (file) => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', file), 'utf8');

    expect(src).toContain('isAutoTranslateOn(');
    expect(src).not.toMatch(/auto_translate !== null && .*auto_translate !== undefined/);
  });
});

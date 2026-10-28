/**
 * [FEAT-20260902-NOWBLOCK] The switch — one constant in code, default off.
 *
 * Two properties are worth more than the rest and both are pinned below:
 *   · **OFF is what happens when nothing is configured**, so every environment that
 *     nobody updates keeps today's exact behaviour;
 *   · **the hook is carried but not read**, so the day the answer becomes per-OA the
 *     change is inside `resolveNowBlockMode` and no call site moves.
 *
 * ── 🔴 03/09/2026 — THIS FILE WAS REWRITTEN WHEN THE ENV LAYER WAS REMOVED ──
 * It used to flip the feature on by setting `process.env.AI_NOW_BLOCK`. The owner
 * removed that layer (*"เอา env ออก — const ตัวเดียวใน code"*), so the lever is now the
 * module boundary: the door calls `resolveNowBlockMode` through the deep module path,
 * and a spy on it is what turns the block ON for a test. The OFF cases were NOT
 * rewritten — they never set the variable, and OFF is the case that matters most.
 *
 * ⚠️ The namespace import below is a DEEP path on purpose, the same shape
 * `broadcast-new-path-switch.spec.ts:19` uses: `index.ts` imports
 * `./now-block.mode` directly, so the barrel re-export is a different binding and a
 * spy placed on it would never be seen by the door. Test-only — production code
 * still goes through the barrel.
 *
 * revert: delete this file with the `now-block/` folder.
 */
/* eslint-disable no-restricted-imports -- a spy needs the module object the door
   actually calls into, which a barrel re-export does not give, and the folder is
   deliberately not re-exported from `@/modules/webhook` (it has no DI, no provider
   and nothing outside the webhook module may reach it). Test-only; the layering
   rule is about production code. Same shape as broadcast-new-path-switch.spec.ts:19. */
import * as modeModule from '@/modules/webhook/now-block/now-block.mode';
import {
  NOW_BLOCK_DEFAULT_MODE,
  resolveNowBlockMode,
} from '@/modules/webhook/now-block/now-block.mode';
import { nowBlockText } from '@/modules/webhook/now-block';
import { validateEnv } from '@/config/env.schema';
/* eslint-enable no-restricted-imports */

const bangkok = (hh: number, mm = 0): Date =>
  new Date(Date.UTC(2026, 8, 2, hh - 7, mm, 0));

/** Turn the feature ON for one case. Restored by `restoreAllMocks` in `afterEach`. */
const switchOn = (): jest.SpyInstance =>
  jest.spyOn(modeModule, 'resolveNowBlockMode').mockReturnValue('on');

/* The three keys the schema requires, so a case can build a valid environment — the same
   placeholders `translate-timeout.spec.ts` uses. Nothing here connects to anything. */
const ENV_BASE = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/not-a-real-db',
  JWT_SECRET: 'unit-test-not-a-real-secret',
  ENCRYPTION_KEY: 'unit-test-not-a-real-key',
} as const;

afterEach(() => {
  jest.restoreAllMocks();
  validateEnv({ ...ENV_BASE }); // back to "nobody set AI_NOW_BLOCK"
});

describe('[NOWBLOCK] the switch defaults to off', () => {
  it('is off out of the box — the constant and the resolver agree', () => {
    expect(NOW_BLOCK_DEFAULT_MODE).toBe('off');
    expect(resolveNowBlockMode(null)).toBe('off');
    expect(resolveNowBlockMode(undefined)).toBe('off');
  });

  /* FLIPPED 18/10/2026 ([FEAT-20261018-NOWBLOCKENV]) — the owner brought the env layer back:
     "ต้องอ่าน AI_NOW_BLOCK จาก env ถ้าหาไม่เจอหรือไม่มีค่า = off · คนที่ไม่ตั้งห้ามพัง". These
     cases used to pin "an AI_NOW_BLOCK left in the environment does NOTHING" (owner 03/09).
     They now pin the opposite on purpose: the variable is read, and every value that is not
     a clear yes — unset, empty, off, a typo — stays OFF. The full matrix is in the
     [NOWBLOCKENV] suite below. */
  it('an AI_NOW_BLOCK=on in the validated environment turns it on (env layer, 18/10)', () => {
    validateEnv({ ...ENV_BASE, AI_NOW_BLOCK: 'on' });
    expect(resolveNowBlockMode(null)).toBe('on');
  });
});

describe('[NOWBLOCK] PIN — the hook is carried but not yet read', () => {
  /* This case pins TODAY's shape, deliberately. The parameter exists so that a
     per-OA switch is a change inside `resolveNowBlockMode` and nowhere else; until
     that change is made, an OA document must not be able to turn the feature on by
     itself. The day layer 1 lands, this case is expected to be REWRITTEN in the same
     commit — that is the signal it is doing its job, not a failure. */
  it('an OA field cannot turn the block on while layer 1 is unimplemented', () => {
    expect(resolveNowBlockMode({ ai_now_block: 'on' })).toBe('off');
    expect(resolveNowBlockMode({ ai_now_block: true })).toBe('off');
  });

  it('a malformed OA document is off, never an error', () => {
    expect(resolveNowBlockMode({})).toBe('off');
    expect(resolveNowBlockMode({ ai_now_block: null })).toBe('off');
  });
});

describe('[NOWBLOCK] what the seat actually receives — OFF', () => {
  /* `null` is the whole safety model. The caller adds nothing when it sees null, so
     OFF means the prompt keeps today's bytes — not "a shorter block", not "an empty
     block", nothing at all. ปิด = ไม่มี now เลย เหลือแต่บรรทัด today เดิม */
  it('returns null when the switch is off', () => {
    expect(nowBlockText({ hook: null, instant: bangkok(14) })).toBeNull();
  });

  it('returns null for every hour of the day while off — no window is an exception', () => {
    for (let hh = 0; hh < 24; hh += 1) {
      expect(
        nowBlockText({
          hook: null,
          instant: bangkok(hh),
          datetimeTh: 'วันพุธที่ 02 กันยายน 69',
        }),
      ).toBeNull();
    }
  });
});

describe('[NOWBLOCK] what the seat actually receives — ON', () => {
  it('returns the block when the switch is on', () => {
    switchOn();
    const text = nowBlockText({
      hook: null,
      instant: bangkok(14),
      datetimeTh: 'วันพุธที่ 02 กันยายน 69 14:00:00',
    });
    expect(text).toContain('[START_OF_NOW]');
    expect(text).toContain('status = OPEN');
  });

  /* The door must ASK on every call, not capture an answer once. It is the same
     reason the resolver exists at all: layer 1 will make the answer depend on which
     OA is asking, and a value read once could never vary per call. */
  it('asks the resolver on every call, so a per-OA answer could vary', () => {
    const spy = switchOn();
    nowBlockText({ hook: null, instant: bangkok(14) });
    nowBlockText({ hook: null, instant: bangkok(15) });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  /* A diagnostics feature must never cost a customer an answer. An unusable instant
     is the one input that throws inside the folder; the door swallows it. */
  it('returns null rather than throwing when the instant is unusable', () => {
    switchOn();
    expect(
      nowBlockText({ hook: null, instant: new Date('not a date') }),
    ).toBeNull();
    expect(
      nowBlockText({ hook: null, instant: undefined as unknown as Date }),
    ).toBeNull();
  });
});

/* ── [FEAT-20261018-NOWBLOCKENV] AI_NOW_BLOCK — read from the environment, OFF unless clearly on ──
   Owner 18/10/2026: "ต้องอ่าน AI_NOW_BLOCK จาก env ถ้าหาไม่เจอหรือไม่มีค่า = off · คนที่ไม่ตั้งห้ามพัง".
   shop-api's server does not set it ⇒ OFF ⇒ its "today" line is exactly as before. */
describe('[NOWBLOCKENV] the AI_NOW_BLOCK matrix', () => {
  it('⭐ PIN — not set at all ⇒ off (every server nobody touched)', () => {
    validateEnv({ ...ENV_BASE });
    expect(resolveNowBlockMode(null)).toBe('off');
  });
  it.each(['', '   ', 'off', 'OFF', 'false', '0', 'no', 'onn', 'enable'])(
    '⭐ PIN — AI_NOW_BLOCK=%p ⇒ off (only a clear yes turns it on)',
    (value) => {
      validateEnv({ ...ENV_BASE, AI_NOW_BLOCK: value });
      expect(resolveNowBlockMode(null)).toBe('off');
    },
  );
  it.each(['on', 'ON', ' on ', 'true', 'TRUE', '1'])(
    '⭐ TARGET — AI_NOW_BLOCK=%p ⇒ on',
    (value) => {
      validateEnv({ ...ENV_BASE, AI_NOW_BLOCK: value });
      expect(resolveNowBlockMode(null)).toBe('on');
    },
  );
  it('🔴 never breaks boot: any value passes validation', () => {
    for (const v of ['', 'on', 'garbage', '💥']) {
      expect(() => validateEnv({ ...ENV_BASE, AI_NOW_BLOCK: v })).not.toThrow();
    }
  });
  it('🔴 never throws on the reply path, even before the environment is validated', () => {
    jest.isolateModules(() => {
      // a fresh module registry: env.schema has validated nothing yet, so its getter throws
      const fresh = jest.requireActual<typeof modeModule>(
        '@/modules/webhook/now-block/now-block.mode',
      );
      expect(fresh.resolveNowBlockMode(null)).toBe('off');
    });
  });
  it('⭐ end to end through the door: on ⇒ a [START_OF_NOW] block · unset ⇒ nothing', () => {
    const req = {
      instant: new Date(Date.UTC(2026, 8, 2, 9, 2, 0)),
      hook: null,
    };
    validateEnv({ ...ENV_BASE, AI_NOW_BLOCK: 'on' });
    expect(nowBlockText(req)).toContain('[START_OF_NOW]');
    validateEnv({ ...ENV_BASE });
    expect(nowBlockText(req)).toBeNull();
  });
});

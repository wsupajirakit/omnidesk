/**
 * [FEAT-20260821-RATELADDER] The per-user escalation policy, as pure functions
 * over a config object. Everything the owner asked to be removable is a field
 * here, and every case below removes one to prove the rest still stands:
 *   · the ladder itself (`enabled`)        · any single level (delete a row)
 *   · the halving (`halveMax`)             · the floor (`minMax`)
 *   · any event type (`countedTypes`)      · the reply text / silence (`reply`)
 */
import {
  DEFAULT_USER_RATE_LADDER,
  levelFor,
  limitsAtLevel,
  isCountedType,
  replyTextFor,
  type UserRateLadderConfig,
} from '@/modules/webhook';

const base = { limit: 3, windowSeconds: 30 }; // = RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS (lv1, from env)
const cfg = (
  over: Partial<UserRateLadderConfig> = {},
): UserRateLadderConfig => ({ ...DEFAULT_USER_RATE_LADDER, ...over });

describe('levelFor — strikes → level (1-based; level 1 = today)', () => {
  it('0 strikes → level 1 · 1 → 2 · 2 → 3 · 3 → 4', () => {
    expect([0, 1, 2, 3].map((s) => levelFor(s, cfg()))).toEqual([1, 2, 3, 4]);
  });
  it('beyond the last row it stays on the last row (ceiling = ชั้นที่ 4)', () => {
    expect(levelFor(9, cfg())).toBe(4);
  });
  it('ladder disabled → always level 1, whatever the strikes', () => {
    expect(levelFor(5, cfg({ enabled: false }))).toBe(1);
  });
  it('a removed level is simply gone — two rows → ceiling is level 3', () => {
    const two = cfg({ levels: DEFAULT_USER_RATE_LADDER.levels.slice(0, 2) });
    expect(levelFor(9, two)).toBe(3);
  });
});

describe('limitsAtLevel — window × k, max ÷ 2 (floor), never below minMax', () => {
  it('level 1 = the base numbers untouched', () => {
    expect(limitsAtLevel(1, base, cfg())).toEqual({
      limit: 3,
      windowSeconds: 30,
    });
  });
  it('level 2 = ×2 window, max halved to 2 (3/2 → 1 → floored up to minMax 2)', () => {
    expect(limitsAtLevel(2, base, cfg())).toEqual({
      limit: 2,
      windowSeconds: 60,
    });
  });
  /* [FEAT-20260823-L4X6] ชั้นสุดท้าย ×6 ไม่ใช่ ×4 (เจ้าของสั่ง 23/08) —
     90 วิ → 180 วิ. ชั้น 2-3 ไม่แตะ. */
  it('level 3 = ×3 · level 4 = ×6 (เพดานหนักขึ้น 23/08)', () => {
    expect(limitsAtLevel(3, base, cfg()).windowSeconds).toBe(90);
    expect(limitsAtLevel(4, base, cfg()).windowSeconds).toBe(180);
  });
  it('a bigger base halves properly: 10 → 5, and stays 5 on every higher level (÷2 once, not per level)', () => {
    const big = { limit: 10, windowSeconds: 30 };
    expect(limitsAtLevel(2, big, cfg()).limit).toBe(5);
    expect(limitsAtLevel(4, big, cfg()).limit).toBe(5);
  });
  it('halving switched off on a row → that level keeps the base max', () => {
    const c = cfg({ levels: [{ windowMultiplier: 2, halveMax: false }] });
    expect(limitsAtLevel(2, base, c)).toMatchObject({
      limit: 3,
      windowSeconds: 60,
    });
  });
  it('minMax is the floor: minMax 1 lets 3/2 → 1', () => {
    expect(limitsAtLevel(2, base, cfg({ minMax: 1 })).limit).toBe(1);
  });
});

describe('isCountedType — every event type is its own switch', () => {
  it('defaults: text · image · sticker · video · audio · file all counted (owner: ทุก event)', () => {
    for (const t of ['text', 'image', 'sticker', 'video', 'audio', 'file'])
      expect(isCountedType(t, cfg())).toBe(true);
  });
  it('switch one off → that type is not counted, the others are', () => {
    const c = cfg({
      countedTypes: {
        ...DEFAULT_USER_RATE_LADDER.countedTypes,
        sticker: false,
      },
    });
    expect(isCountedType('sticker', c)).toBe(false);
    expect(isCountedType('text', c)).toBe(true);
  });
  it('an unknown/absent type is not counted (postback, follow, location…)', () => {
    expect(isCountedType('location', cfg())).toBe(false);
    expect(isCountedType(undefined, cfg())).toBe(false);
  });
});

describe('replyTextFor — the hard-coded sentence, wrapped so it can change or go silent', () => {
  it("default = today's exact sentence", () => {
    expect(replyTextFor(1, cfg())).toBe('กรุณารอสักครู่และลองใหม่อีกครั้ง');
  });
  it('a level may carry its own text', () => {
    const c = cfg({
      levels: [
        { windowMultiplier: 2, halveMax: true, replyText: 'ช้าลงหน่อยนะคะ' },
      ],
    });
    expect(replyTextFor(2, c)).toBe('ช้าลงหน่อยนะคะ');
    expect(replyTextFor(1, c)).toBe('กรุณารอสักครู่และลองใหม่อีกครั้ง');
  });
  it('null = silent: no reply at all, at one level or everywhere', () => {
    expect(
      replyTextFor(
        2,
        cfg({
          levels: [{ windowMultiplier: 2, halveMax: true, replyText: null }],
        }),
      ),
    ).toBeNull();
    expect(replyTextFor(1, cfg({ reply: { text: null } }))).toBeNull();
  });
});

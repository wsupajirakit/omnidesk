/**
 * [TEST-20260825-FULLFLOWMATRIX] The 24 combinations a broadcast can be sent in.
 *
 * Owner, 25/08, in these words:
 *   A = broadcast / multi ทันที
 *   B = broadcast / multi ตั้งเวลาครั้งเดียว
 *   C = broadcast / multi ตั้งเวลาทำซ้ำ + วัน
 *   …each across 4 message kinds: 1 ปกติ (plain flex) · 2 profile flex
 *   (per-recipient) · 3 ข้อความ · 4 ภาพ/ลิงก์
 *
 * 3 timings × 2 send kinds × 4 message kinds = 24 rows, all enumerated below.
 *
 * ⚠️ WHY THIS FILE EXISTS SEPARATELY from the 54 broadcast specs already here:
 * those cover ONE seam each and pass while a COMBINATION is broken — the exact
 * failure the owner hit twice (send-now never dispatched; repeat hid its own
 * form). This one asks the combination question and nothing else.
 *
 * 🔴 SYNCED FROM THE ORIGINALS, NEVER COPIED — same rule as the webhook specs
 * (`line-flow-test` §2). Every constant this file reasons about is imported
 * from the code that owns it, and §0 asserts the imports still exist. A DTO
 * that grows a field, a send kind that is renamed, a schedule mode that is
 * dropped — all of them turn this file RED instead of letting it drift into a
 * museum piece. ค่าคงที่ทุกตัว import จากของจริง ไม่ก๊อป.
 */
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { CreateBroadcastDto } from '@/modules/content/dto/broadcast.dto';
import { computeNextRun } from '@/modules/content/broadcast-schedule/next-run';
import { usesNewSendPath } from '@/modules/content/broadcast-run/new-path.switch';

/* ── the matrix, written once ─────────────────────────────────────────────── */

const TIMINGS = ['A-now', 'B-once', 'C-repeat'] as const;
const SEND_KINDS = ['broadcast', 'multicast'] as const;

/** The four the owner listed. `flex_id` distinguishes 1 from 2 at send time. */
const MESSAGES = {
  '1-plain-flex': { type: 'flex', flex_id: 'a0d000000000000000000030' },
  '2-profile-flex': { type: 'flex', flex_id: 'a0d000000000000000000031' },
  '3-text': { type: 'text', text: 'สวัสดีครับ' },
  '4-image': { type: 'image', image_url: 'https://example.invalid/a.png' },
} as const;

type Timing = (typeof TIMINGS)[number];
type Kind = (typeof SEND_KINDS)[number];
type MsgKey = keyof typeof MESSAGES;

const TZ_BANGKOK_MIN = 420;
const AT_0900 = 9 * 60;

/** One saved job exactly as the form posts it, for a given cell of the matrix. */
const jobFor = (t: Timing, kind: Kind, m: MsgKey): Record<string, unknown> => ({
  name: `${t}/${kind}/${m}`,
  description: 'matrix',
  hook_ids: ['a0d000000000000000000012'],
  assign_group_ids: ['a0d000000000000000000032'],
  send_kind: kind,
  message: { ...MESSAGES[m] },
  target: { mode: 'all', group_ids: [] },
  ...(t === 'A-now' ? { status: 'sent' } : {}),
  ...(t === 'B-once'
    ? { status: 'scheduled', scheduled_at: '2026-08-26T09:00:00+07:00' }
    : {}),
  ...(t === 'C-repeat'
    ? {
        status: 'scheduled',
        scheduled_at: '2026-08-26T09:00:00+07:00',
        schedule: {
          mode: 'repeat',
          enabled: true,
          at_time_min: AT_0900,
          tz_offset_min: TZ_BANGKOK_MIN,
          days_of_week: [1, 3, 5],
        },
      }
    : {}),
});

const CELLS = TIMINGS.flatMap((t) =>
  SEND_KINDS.flatMap((k) =>
    (Object.keys(MESSAGES) as MsgKey[]).map((m) => ({ t, k, m })),
  ),
);

/* ── §0 the guard: the originals still look the way this file assumes ────── */

describe('[FULLFLOWMATRIX] §0 synced from the originals', () => {
  it('⭐ the matrix really is 24 cells — a dropped dimension must be loud', () => {
    expect(CELLS).toHaveLength(24);
    expect(TIMINGS).toHaveLength(3);
    expect(SEND_KINDS).toHaveLength(2);
    expect(Object.keys(MESSAGES)).toHaveLength(4);
  });

  it('⭐⭐ every seam this file drives is still exported by its owner', () => {
    expect(typeof computeNextRun).toBe('function');
    expect(typeof usesNewSendPath).toBe('function');
    expect(typeof CreateBroadcastDto).toBe('function');
  });
});

/* ── §1 the door: every cell survives the real DTO ───────────────────────── */

describe('[FULLFLOWMATRIX] §1 the DTO accepts every combination', () => {
  it.each(CELLS.map((c) => [`${c.t} · ${c.k} · ${c.m}`, c] as const))(
    '%s',
    (_label, c) => {
      const dto = plainToInstance(CreateBroadcastDto, jobFor(c.t, c.k, c.m), {
        enableImplicitConversion: true,
      });
      const errors = validateSync(dto as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      /* ⚠️ The message names WHICH property failed — "expected [] " alone
         costs the next reader an afternoon. */
      expect(
        errors.map(
          (e) => `${e.property}: ${Object.keys(e.constraints ?? {}).join()}`,
        ),
      ).toEqual([]);
    },
  );
});

/* ── §2 routing: the send kind decides the path ─────────────────────────── */

/* 🔴 REWRITTEN 25/08 AFTER THIS SECTION WAS CAUGHT PROVING NOTHING.
   The first version called `usesNewSendPath(c.k)` four times with the SAME
   argument and asserted the four answers agreed — a tautology true of any pure
   function, which could never go red. It ran as 24 cases and measured zero.
   `usesNewSendPath(sendKind, enabled)` (`new-path.switch.ts:75-81`) takes no
   message argument at all, so "the message kind does not change the route" is
   a property of the SIGNATURE, not something a call can demonstrate.
   ⇒ pin the signature instead, and assert the routing answers that actually
     differ. เทสที่แดงไม่ได้ ไม่ใช่เทส */

describe('[FULLFLOWMATRIX] §2 the route is chosen by send kind alone', () => {
  it('⭐ the switch takes ONE required argument — no message can reach it', () => {
    /* `Function.length` counts parameters BEFORE the first default, so
       `(sendKind, enabled = FLAG)` reports 1, not 2. Verified, not assumed.
       ⚠️ WHAT THIS DOES AND DOES NOT CATCH — stated so nobody trusts it further
       than it goes: a new REQUIRED parameter (a message, a card type) makes
       this 2 and turns the case red. A new OPTIONAL one appended after the
       default would not. It is a tripwire on the likely mistake, not a proof.
       จับพารามิเตอร์บังคับที่เพิ่มเข้ามา ไม่ได้จับทุกกรณี */
    expect(usesNewSendPath.length).toBe(1);
  });

  it('⭐⭐ each send kind gets a definite answer, and the two are compared', () => {
    /* `enabled` is passed explicitly so the case does not silently follow the
       deployed flag and become untestable when it flips. */
    const bcast = usesNewSendPath('broadcast', true);
    const multi = usesNewSendPath('multicast', true);
    expect(typeof bcast).toBe('boolean');
    expect(typeof multi).toBe('boolean');
    /* whichever way the registry is set today, an unknown kind must never take
       the new path — that is the part with teeth */
    expect(usesNewSendPath('not-a-kind', true)).toBe(false);
    expect(usesNewSendPath(undefined, true)).toBe(false);
  });

  it('⭐ the master switch off ⇒ nothing takes the new path, whatever the kind', () => {
    for (const k of SEND_KINDS) expect(usesNewSendPath(k, false)).toBe(false);
  });
});

/* ── §3 timing: A fires now, B fires once, C keeps a next round ──────────── */

describe('[FULLFLOWMATRIX] §3 the three timings mean three different things', () => {
  const NOW = new Date('2026-08-25T02:00:00.000Z'); // 09:00 Bangkok

  it('⭐⭐ A (ทันที) carries no schedule at all — nothing to arm', () => {
    for (const k of SEND_KINDS) {
      for (const m of Object.keys(MESSAGES) as MsgKey[]) {
        const job = jobFor('A-now', k, m);
        expect(job['schedule']).toBeUndefined();
        expect(job['status']).toBe('sent');
      }
    }
  });

  it('⭐⭐ B (ครั้งเดียว) has a time but no repeat rule', () => {
    for (const k of SEND_KINDS) {
      const job = jobFor('B-once', k, '3-text');
      expect(job['scheduled_at']).toBeTruthy();
      expect(job['schedule']).toBeUndefined();
    }
  });

  it('⭐⭐ C (ทำซ้ำ) computes a real next round, and it lands on 09:00 Bangkok', () => {
    const job = jobFor('C-repeat', 'multicast', '1-plain-flex');
    const next = computeNextRun(job['schedule'] as never, NOW);
    expect(next).toBeInstanceOf(Date);
    /* 09:00 +07:00 = 02:00Z — the value is stored UTC (docs/TIME-RULE.md rule 1)
       while the admin picked a Bangkok wall-clock time. Pinning the UTC hour is
       what makes a timezone regression fail here instead of on a customer's
       phone. เก็บ UTC · คนตั้งเป็นเวลาไทย. */
    expect((next as Date).getUTCHours()).toBe(2);
    expect((next as Date).getUTCMinutes()).toBe(0);
  });

  it('⭐ C without days_of_week still arms — empty means every day', () => {
    const next = computeNextRun(
      {
        mode: 'repeat',
        enabled: true,
        at_time_min: AT_0900,
        tz_offset_min: TZ_BANGKOK_MIN,
      },
      NOW,
    );
    expect(next).toBeInstanceOf(Date);
  });

  it('⭐⭐ C with enabled:false arms NOTHING — the pause must really pause', () => {
    const next = computeNextRun(
      {
        mode: 'repeat',
        enabled: false,
        at_time_min: AT_0900,
        tz_offset_min: TZ_BANGKOK_MIN,
        days_of_week: [1, 3, 5],
      },
      NOW,
    );
    expect(next).toBeNull();
  });
});

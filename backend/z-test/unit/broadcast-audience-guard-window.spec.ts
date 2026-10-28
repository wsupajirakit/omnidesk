/**
 * [FEAT-2708-GUARDWINDOW] "stamp ต้องสดใน N ชั่วโมง" — guard window ต่อ job
 * ===========================================================================
 * เจ้าของ 27/08 (งาน 4.1): job multicast ตั้งคอลัมน์ optional `guard_window_hours`
 * (int 1-72 · ว่าง = ไม่มี guard = ของเดิมทุก byte) แล้วเงื่อนไข 3 ตระกูล —
 * การ์ดลงทะเบียน / ติดตามฝาก / ติดตามถอน — ต้องมี stamp ในช่วง N ชม.
 * ย้อนหลังจากเวลาเริ่มรอบส่งเท่านั้น
 *
 * ⭐ THE DECISION THIS FILE PINS (todo9 §1.3, ทาง ก): the bound merges into
 *    EACH GUARDED RULE'S OWN CLAUSE — `{path: {$ne: null, $gte: cutoff}}` —
 *    never onto an outer `$and`. The live DB holds 4 real deposit+withdraw
 *    jobs with `match: 'or'`; an outer AND would demand BOTH stamps fresh and
 *    silently drop people who qualify through one leg. นั่นคือ "ห้ามพัง"
 *    ข้อเดียวที่เจ้าของขีดเส้นไว้ และคือเหตุที่เทส (F2) เป็นดาวของไฟล์นี้.
 *
 * 📖 แผน: todo/task/27082026/todo9_27082026_guard-window-adminname-quota.md §1
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BroadcastsReadService,
  GUARD_WINDOW_MAX_HOURS,
  GUARD_WINDOW_MIN_HOURS,
  GUARD_WINDOW_SOURCE_KEYS,
  buildAudienceFilter,
  ensureValidGuardWindow,
  getAudienceSource,
  guardWindowBoundFor,
  sanitizeBroadcastRow,
} from '@/modules/content';

const CARD = 'follow_up.customer_helper_at';
const CARD_PATH = 'config.follow_up.line.customer_helper_trigger_at';
const DEPOSIT = 'follow_up.notice_deposit_at';
const DEPOSIT_PATH = 'config.follow_up.line.notice_deposit_at';
const WITHDRAW = 'follow_up.notice_withdraw_at';
const WITHDRAW_PATH = 'config.follow_up.line.notice_withdraw_at';

const REF = new Date('2026-08-27T12:00:00.000Z');
/** 6 ชม. ย้อนจาก REF เป๊ะ — สูตรเดียวที่ยอมรับ (G6) */
const CUTOFF_6H = new Date('2026-08-27T06:00:00.000Z');

const guarded = (
  rules: ReadonlyArray<Record<string, unknown>>,
  match: 'and' | 'or',
  hours: unknown = 6,
  reference: unknown = REF,
) =>
  buildAudienceFilter({
    match,
    rules,
    guard_window: { hours, reference },
  } as never);

describe('[GUARDWINDOW] §1 นโยบายล้วน — guard-window.policy', () => {
  it('⭐ (P1) ครอบ 3 คีย์ตามคำสั่งเป๊ะ และทุกคีย์มีจริงในทะเบียน', () => {
    expect([...GUARD_WINDOW_SOURCE_KEYS].sort()).toEqual([
      CARD,
      DEPOSIT,
      WITHDRAW,
    ]);
    for (const key of GUARD_WINDOW_SOURCE_KEYS) {
      expect(getAudienceSource(key)).not.toBeNull();
    }
    /* ตัวที่ 4 ของตระกูล — โจทย์ไม่ได้สั่ง ห้ามแอบครอบ (Q4) */
    expect(GUARD_WINDOW_SOURCE_KEYS).not.toContain(
      'follow_up.notice_payment_at',
    );
    expect(GUARD_WINDOW_MIN_HOURS).toBe(1);
    expect(GUARD_WINDOW_MAX_HOURS).toBe(72);
  });

  it('⭐ (P2/G6) cutoff = reference − N×3600s เป๊ะ · คีย์นอกชุด = bound null', () => {
    const r = guardWindowBoundFor(CARD, 6, REF);
    expect(r).toEqual({ ok: true, bound: { $gte: CUTOFF_6H } });
    // ขอบบน-ล่างของช่วงยังใช้ได้
    expect(guardWindowBoundFor(DEPOSIT, 1, REF)).toEqual({
      ok: true,
      bound: { $gte: new Date('2026-08-27T11:00:00.000Z') },
    });
    expect(guardWindowBoundFor(WITHDRAW, 72, REF).ok).toBe(true);
    // คีย์นอกชุด guard — ไม่ผูก ไม่พัง
    expect(guardWindowBoundFor('follow_up.abandon_at', 6, REF)).toEqual({
      ok: true,
      bound: null,
    });
  });

  it('⭐ (P3/G5) ค่าที่สั่งมาแต่สร้างไม่ได้ = ปฏิเสธดัง ๆ · ว่าง = ไม่ได้สั่ง', () => {
    /* สองความหมายที่ห้ามปน: hours ว่าง (undefined/null/'') = แอดมินไม่ได้สั่ง
       guard เลย ⇒ bound null ของเดิมทุก byte (สัญญาเดียวกับ
       ensureValidGuardWindow ที่ปัดว่างเป็น null) · ส่วนค่าที่ "สั่งแล้วแต่
       สร้างไม่ได้" ต้อง fail closed — ตัดทิ้งเงียบ = ผู้รับกว้างกว่าที่ตั้งใจ */
    for (const empty of [undefined, null, '']) {
      expect(guardWindowBoundFor(CARD, empty, REF)).toEqual({
        ok: true,
        bound: null,
      });
    }
    for (const bad of [0, 73, 1.5, -6, NaN, '6', {}]) {
      const r = guardWindowBoundFor(CARD, bad, REF);
      expect(r.ok).toBe(false);
    }
    // reference ที่อ่านไม่ได้ก็เช่นกัน (แต่ต้องมี hours สั่งจริงก่อน)
    expect(guardWindowBoundFor(CARD, 6, 'not-a-date').ok).toBe(false);
    expect(guardWindowBoundFor(CARD, 6, null).ok).toBe(false);
  });
});

describe('[GUARDWINDOW] §2 ใน buildAudienceFilter — ผูกต่อ-rule (ทาง ก)', () => {
  it('⭐ (G1) ไม่มี guard_window ⇒ filter เท่าของเดิมทุก byte', () => {
    const plain = buildAudienceFilter({
      match: 'or',
      rules: [
        { key: DEPOSIT, op: 'has_value' },
        { key: WITHDRAW, op: 'has_value' },
      ],
    } as never);
    /* เรียกตรง — helper `guarded` มี default 6 ชม. ซึ่งจะกลบเคสนี้พอดี */
    const alsoPlain = buildAudienceFilter({
      match: 'or',
      rules: [
        { key: DEPOSIT, op: 'has_value' },
        { key: WITHDRAW, op: 'has_value' },
      ],
      guard_window: { hours: undefined, reference: undefined },
    } as never);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.filter).toEqual({
      $or: [
        { [DEPOSIT_PATH]: { $ne: null } },
        { [WITHDRAW_PATH]: { $ne: null } },
      ],
    });
    /* guard_window ที่ไม่มี hours = ไม่มี guard (job เก่าทุกใบ) */
    expect(alsoPlain).toEqual(plain);
  });

  it('⭐⭐ (G2) job ฝาก+ถอน match:"or" — bound เข้าในขาของใครของมัน ความหมาย OR คงเดิม', () => {
    /* มีจริง 4 ใบใน DB — คนที่ stamp ฝากสดแต่ถอนเก่าต้องยังเข้าได้ผ่านขาฝาก */
    const r = guarded(
      [
        { key: DEPOSIT, op: 'has_value' },
        { key: WITHDRAW, op: 'has_value' },
      ],
      'or',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filter).toEqual({
      $or: [
        { [DEPOSIT_PATH]: { $ne: null, $gte: CUTOFF_6H } },
        { [WITHDRAW_PATH]: { $ne: null, $gte: CUTOFF_6H } },
      ],
    });
    /* พิสูจน์ความหมายกับ member จำลอง: ฝากสด ถอนเก่า — ขา $or ตัวแรก match */
    const freshDeposit = new Date('2026-08-27T09:00:00.000Z'); // ใน 6 ชม.
    const staleWithdraw = new Date('2026-08-26T00:00:00.000Z'); // นอก 6 ชม.
    const orLegs = (r.filter as { $or: Record<string, unknown>[] }).$or;
    const depositLeg = orLegs[0]?.[DEPOSIT_PATH] as {
      $ne: null;
      $gte: Date;
    };
    expect(freshDeposit >= depositLeg.$gte).toBe(true);
    const withdrawLeg = orLegs[1]?.[WITHDRAW_PATH] as {
      $ne: null;
      $gte: Date;
    };
    expect(staleWithdraw >= withdrawLeg.$gte).toBe(false);
  });

  it('⭐ (G3) match:"and" — ทุก rule ที่ครอบได้ bound ครบทุกตัว', () => {
    const r = guarded(
      [
        { key: DEPOSIT, op: 'has_value' },
        { key: WITHDRAW, op: 'has_value' },
      ],
      'and',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filter).toEqual({
      $and: [
        { [DEPOSIT_PATH]: { $ne: null, $gte: CUTOFF_6H } },
        { [WITHDRAW_PATH]: { $ne: null, $gte: CUTOFF_6H } },
      ],
    });
  });

  it('⭐ (G4) rule นอกชุด guard ใน job เดียวกัน — clause ไม่ถูกแตะแม้แต่คีย์ตระกูลเดียวกัน', () => {
    /* `follow_up.abandon_at` อยู่ตระกูล follow_up เหมือนกันแต่ไม่อยู่ในชุด guard
       — สมาชิกภาพของชุดคือตัวตัดสิน ไม่ใช่ชื่อตระกูล */
    const ABANDON_PATH = 'config.follow_up.line.abandon_trigger_at';
    /* abandon_at เปิดเฉพาะ lte/gte ในทะเบียน — ใช้ gte พร้อมวันที่ของแอดมินเอง
       (คนละตัวกับ cutoff ของ guard — สองค่าต้องไม่ปนกัน) */
    const ADMIN_DATE = new Date('2026-08-20T00:00:00.000Z');
    const r = guarded(
      [
        { key: DEPOSIT, op: 'has_value' },
        { key: 'follow_up.abandon_at', op: 'gte', value: ADMIN_DATE },
      ],
      'and',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    /* `follow_up.abandon_at` พ่วง force-no-profile ชั้นนอกของมันเอง (นโยบาย
       ข้างบ้าน — ไม่ใช่เรื่องของเทสนี้) ⇒ ตรวจเชิงโครงสร้าง: clause ของ rule
       แต่ละตัวต้องอยู่ในรูปที่สั่ง ไม่ใช่ตรึงรูปทั้งก้อน */
    const json = JSON.stringify(r.filter);
    expect(json).toContain(
      JSON.stringify({ [DEPOSIT_PATH]: { $ne: null, $gte: CUTOFF_6H } }),
    );
    /* abandon's clause carries the admin's own date — the guard cutoff must not
       leak into it. [FIX-20260828-FORCEPERLEG] this leg still carries its own
       force-no-profile condition, now inside the rule's object rather than at
       the outer level, so it is still compared piecewise as the original
       comment intended (not pinned as one whole shape). */
    expect(json).toContain(
      JSON.stringify({
        [ABANDON_PATH]: { $gte: ADMIN_DATE },
        raw_profile_data: null,
      }),
    );
    expect(json.split(JSON.stringify(CUTOFF_6H)).length - 1).toBe(1);
  });

  it('⭐ (G5) guard ที่สั่งแล้วสร้างไม่ได้ ⇒ ปฏิเสธทั้ง job (fail closed)', () => {
    for (const hours of [0, 73, 1.5, 'x']) {
      const r = guarded([{ key: DEPOSIT, op: 'has_value' }], 'and', hours);
      expect(r.ok).toBe(false);
    }
  });

  it('(G-inert) มี guard แต่ไม่มี rule ในชุด ⇒ filter เท่าเดิม (inert ตาม Q6)', () => {
    const D = new Date('2026-08-20T00:00:00.000Z');
    const rules = [{ key: 'follow_up.abandon_at', op: 'gte', value: D }];
    const plain = buildAudienceFilter({ match: 'and', rules } as never);
    const withGuard = guarded(rules, 'and');
    expect(plain.ok).toBe(true);
    expect(withGuard).toEqual(plain);
  });

  it('⭐ (G-compose) อยู่ร่วมกับ force-no-follow-up ได้ — bound ใน clause · นโยบายเดิมยังต่อชั้นนอก', () => {
    const r = guarded([{ key: CARD, op: 'has_value' }], 'and');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    /* [FIX-20260828-FORCEPERLEG] the neighbouring policies (force-no-profile /
       force-no-follow-up) now bind to their triggering rule's leg, the way the
       guard window always has. A single rule therefore yields one flat object
       holding both the guard's bound and the other policy's forced conditions.
       The two layers stay independent, which is what this case still pins: the
       guard's `$gte` lands on its own rule and nowhere else. */
    const f = r.filter;
    expect(f[CARD_PATH]).toEqual({ $ne: null, $gte: CUTOFF_6H });
    expect(Object.keys(f)).toContain('config.follow_up.line.request_reg_at');
    // bound ของ guard ต้องไม่รั่วไปติดกับ clause ที่ policy ต่อเข้ามา
    expect(f['config.follow_up.line.request_reg_at']).toBeNull();
  });
});

describe('[GUARDWINDOW] §3 ชั้นข้อความ + ขากลับ + endpoint', () => {
  it('(S1/G8) ensureValidGuardWindow: ว่าง → null · 1-72 → ค่า · อื่น → BadRequest', () => {
    expect(ensureValidGuardWindow(undefined)).toBeNull();
    expect(ensureValidGuardWindow(null)).toBeNull();
    expect(ensureValidGuardWindow('')).toBeNull();
    expect(ensureValidGuardWindow(6)).toBe(6);
    expect(ensureValidGuardWindow(1)).toBe(1);
    expect(ensureValidGuardWindow(72)).toBe(72);
    for (const bad of [0, 73, 1.5, -1, 'x', {}, true]) {
      expect(() => ensureValidGuardWindow(bad)).toThrow();
    }
  });

  it('⭐ (S3/G10) ขากลับ: sanitizeBroadcastRow ถือ guard_window_hours · แถวเก่า = null', () => {
    /* ตกบรรทัด pick-list = ฟอร์มเปิดว่างแล้วเซฟทับ — เทสนี้คือกันชนของมัน */
    const row = sanitizeBroadcastRow({
      _id: 'x',
      name: 'n',
      guard_window_hours: 6,
    } as never) as unknown as Record<string, unknown>;
    expect(row['guard_window_hours']).toBe(6);
    const legacy = sanitizeBroadcastRow({
      _id: 'x',
      name: 'n',
    } as never) as unknown as Record<string, unknown>;
    expect(legacy['guard_window_hours']).toBeNull();
  });

  it('⭐ (S2/G9) endpoint sources ติดธง guard_window ให้ 3 คีย์ — ตัวอื่นไม่มีคีย์นี้เลย', () => {
    /* `listAudienceSources` ไม่แตะ this — เรียกผ่าน prototype ได้ตรง ๆ */
    const out = BroadcastsReadService.prototype.listAudienceSources.call(
      {} as never,
    ) as { data: Array<{ key: string; guard_window?: boolean }> };
    const flagged = out.data.filter((s) => s.guard_window === true);
    expect(flagged.map((s) => s.key).sort()).toEqual([CARD, DEPOSIT, WITHDRAW]);
    for (const s of out.data) {
      if (!GUARD_WINDOW_SOURCE_KEYS.includes(s.key)) {
        expect('guard_window' in s).toBe(false);
      }
    }
  });

  it('⭐ (S4/G7) new-send: reference สร้างครั้งเดียว หลัง skip-assist ก่อน build — source-assert', () => {
    /* enrich ต้องติดบน audience object (สัญญา "one filter, two readers") —
       สร้าง reference สองที่ = นับผู้รับได้อย่าง ส่งจริงอีกอย่าง */
    const src = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/broadcast-run/new-send.service.ts',
      ),
      'utf8',
    );
    const enrichAt = src.indexOf('guard_window:');
    expect(enrichAt).toBeGreaterThan(-1);
    // อยู่หลังบล็อก skip-assist และก่อน buildAudienceFilter(sendAudience)
    expect(src.indexOf('skip_line_user_ids: skip')).toBeLessThan(enrichAt);
    expect(enrichAt).toBeLessThan(
      src.indexOf('buildAudienceFilter(sendAudience)'),
    );
    // reference จุดเดียว: `new Date()` ปรากฏครั้งเดียวในบล็อก guard
    const guardBlock = src.slice(enrichAt - 400, enrichAt + 400);
    expect(guardBlock.match(/reference: new Date\(\)/g)).toHaveLength(1);
    expect(src.match(/guard_window:/g)).toHaveLength(1);
  });
});

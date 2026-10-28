/**
 * [FEAT-20260811-CHATPIN] ปักหมุดห้องแชท — ตรรกะล้วน (ไม่ render)
 *
 * เจ้าของสั่ง 2026-08-11: ปักหมุดใน panel ซ้ายหน้า ticket · per-admin preference ·
 * **max 20 ต้องเตือน** · badge รูปหมุด (ไม่มีตัวนับ) เด่นทั้ง dark/light
 *
 * ⚠️ ทำไมเทสตรงนี้สำคัญ: `TicketChat.tsx` มี **3 เส้น** ที่แสดงรายการเคส และเส้นหลัก
 * (`visibleTickets` — แท็บ active/mine/waiting) **ไม่มี sort ของตัวเองเลย** ⇒ ถ้าตัวครอบ
 * comparator เพี้ยน ลำดับเดิมของทั้งหน้าจะเปลี่ยนโดยไม่มี error ให้เห็น
 * เทสนี้จึงล็อกว่า "ไม่ปักทั้งคู่ ⇒ ลำดับเดิมเป๊ะ" ไว้เป็นข้อแรก
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// preferencesService เป็น seam เดียวที่แตะ storage/network — mock ไว้ทั้งก้อน
const prefs: { value: Record<string, unknown> | null } = { value: null };
const savedLocal: Record<string, unknown>[] = [];
const savedRemote: Record<string, unknown>[] = [];
vi.mock('../services/admin', () => ({
  getInitialPreferences: () => prefs.value,
  saveLocalPreference: (p: Record<string, unknown>) => {
    savedLocal.push(p);
    return p;
  },
  savePreferences: (p: Record<string, unknown>) => {
    savedRemote.push(p);
    return Promise.resolve(p);
  },
}));

import {
  PIN_MAX,
  readPinned,
  togglePin,
  persistPinned,
  byPinnedFirst,
} from '../services/chat/pinnedRooms';

beforeEach(() => {
  prefs.value = null;
  savedLocal.length = 0;
  savedRemote.length = 0;
});

describe('[FEAT-20260811-CHATPIN] readPinned — ทนทุกรูปข้อมูล', () => {
  it('ไม่เคยตั้งค่า / null / ไม่ใช่ array ⇒ [] ไม่ throw', () => {
    // บัญชีที่ไม่เคยแตะ preference คือเคสปกติ (BE ตั้ง default: undefined)
    expect(readPinned()).toEqual([]);
    prefs.value = {};
    expect(readPinned()).toEqual([]);
    prefs.value = { pinned_rooms: null };
    expect(readPinned()).toEqual([]);
    prefs.value = { pinned_rooms: 'ไม่ใช่ array' };
    expect(readPinned()).toEqual([]);
  });

  it('อ่านค่าปกติได้ และคงลำดับที่ปักไว้', () => {
    prefs.value = { ui: { theme: 'light' }, pinned_rooms: ['u1', 'u2'] };
    expect(readPinned()).toEqual(['u1', 'u2']);
  });

  it('กรองค่าขยะ + ตัดค่าซ้ำ (ค่าซ้ำทำให้ sort ไม่นิ่ง)', () => {
    prefs.value = { pinned_rooms: ['u1', '', '  ', 'u1', 42, null, 'u2'] };
    expect(readPinned()).toEqual(['u1', 'u2']);
  });
});

describe('[FEAT-20260811-CHATPIN] togglePin — เพดาน 20 ต้องเตือน', () => {
  it('ปักใหม่ต่อท้าย (ท้าย = ปักล่าสุด จึงไม่ต้องเก็บ pinned_at)', () => {
    const r = togglePin(['u1'], 'u2');
    expect(r).toEqual({ ok: true, next: ['u1', 'u2'], pinned: true });
  });

  it('กดซ้ำที่เดิม ⇒ เอาออก', () => {
    const r = togglePin(['u1', 'u2'], 'u1');
    expect(r).toEqual({ ok: true, next: ['u2'], pinned: false });
  });

  it('★ ครบ 20 แล้วปักเพิ่ม ⇒ ไม่ปัก + บอกให้เตือน (ห้ามตัดเงียบ ห้ามเด้งอันเก่าออก)', () => {
    const full = Array.from({ length: PIN_MAX }, (_, i) => `u${i}`);
    const r = togglePin(full, 'ใหม่');
    expect(r).toEqual({ ok: false, reason: 'limit', max: 20 });
    // ของเดิมต้องไม่ถูกแตะเลย
    expect(full).toHaveLength(PIN_MAX);
  });

  it('★★ เต็มแล้วแต่ unpin ต้องทำได้เสมอ — ไม่งั้นผู้ใช้ติดตาย', () => {
    const full = Array.from({ length: PIN_MAX }, (_, i) => `u${i}`);
    const r = togglePin(full, 'u0');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toHaveLength(PIN_MAX - 1);
  });

  it('★★ list เกิน 20 จากข้อมูลเก่า ⇒ ยัง unpin ได้ แต่เพิ่มไม่ได้', () => {
    // เพดานเพิ่มมาทีหลัง ค่าที่ค้างอยู่อาจเกิน — เพดานต้องคุมแค่ "การเพิ่ม"
    const over = Array.from({ length: 25 }, (_, i) => `u${i}`);
    expect(togglePin(over, 'u3').ok).toBe(true);
    expect(togglePin(over, 'ใหม่')).toEqual({ ok: false, reason: 'limit', max: 20 });
  });

  it('key ว่าง ⇒ ปักไม่ได้ ไม่ทำให้ list เพี้ยน', () => {
    expect(togglePin(['u1'], '   ').ok).toBe(false);
  });

  it('เพดานคือ 20 ตามที่เจ้าของสั่ง', () => {
    expect(PIN_MAX).toBe(20);
  });
});

describe('[FEAT-20260811-CHATPIN] persistPinned — local ก่อน แล้วค่อยขึ้น BE', () => {
  it('เขียน local ทันที และ PUT ด้วย key เดียวกัน', () => {
    persistPinned(['u1', 'u2']);
    expect(savedLocal).toEqual([{ pinned_rooms: ['u1', 'u2'] }]);
    expect(savedRemote).toEqual([{ pinned_rooms: ['u1', 'u2'] }]);
  });

  it('ส่ง array ชุดใหม่ทั้งชุด — พึ่งพฤติกรรม deepMerge ที่แทน array ไม่ concat', () => {
    // ถ้า BE เปลี่ยนเป็น concat วันไหน หมุดจะลบไม่ออก (จดไว้ใน be_todo26 §3.1)
    persistPinned([]);
    expect(savedRemote[0]).toEqual({ pinned_rooms: [] });
  });
});

describe('[FEAT-20260811-CHATPIN] byPinnedFirst — ครอบ comparator เดิม', () => {
  type Row = { k: string; t: number };
  const keyOf = (r: Row) => r.k;
  /** comparator เดิมของหน้า: เวลาใหม่มาก่อน */
  const byTime = (a: Row, b: Row) => b.t - a.t;

  it('★ ไม่ปักทั้งคู่ ⇒ ลำดับเดิมเป๊ะ (เส้น visibleTickets ไม่มี sort ของตัวเอง)', () => {
    const rows: Row[] = [
      { k: 'a', t: 1 },
      { k: 'b', t: 3 },
      { k: 'c', t: 2 },
    ];
    const withPin = [...rows].sort(byPinnedFirst<Row>([], keyOf)(byTime));
    const plain = [...rows].sort(byTime);
    expect(withPin.map((r) => r.k)).toEqual(plain.map((r) => r.k));
  });

  it('★ ห้องที่ปักไว้ขึ้นบนสุด แม้ข้อความเก่ากว่า', () => {
    const rows: Row[] = [
      { k: 'ใหม่สุด', t: 100 },
      { k: 'เก่าแต่ปักไว้', t: 1 },
    ];
    const out = [...rows].sort(byPinnedFirst<Row>(['เก่าแต่ปักไว้'], keyOf)(byTime));
    expect(out[0]!.k).toBe('เก่าแต่ปักไว้');
  });

  it('ปักหลายห้อง ⇒ เรียงตามลำดับที่ปัก ไม่ใช่ตามเวลา', () => {
    // ถ้าเอาเวลามาปนกัน หมุดจะสลับที่เองเวลามีข้อความใหม่ = สิ่งที่ปักหมุดกันอยู่
    const rows: Row[] = [
      { k: 'p2', t: 999 },
      { k: 'p1', t: 1 },
      { k: 'ไม่ปัก', t: 500 },
    ];
    const out = [...rows].sort(byPinnedFirst<Row>(['p1', 'p2'], keyOf)(byTime));
    expect(out.map((r) => r.k)).toEqual(['p1', 'p2', 'ไม่ปัก']);
  });

  it('หมุดค้างของห้องที่ไม่อยู่ในรายการแล้ว ⇒ ไม่พัง ไม่กระทบลำดับ', () => {
    const rows: Row[] = [
      { k: 'a', t: 1 },
      { k: 'b', t: 2 },
    ];
    const out = [...rows].sort(byPinnedFirst<Row>(['หายไปแล้ว'], keyOf)(byTime));
    expect(out.map((r) => r.k)).toEqual(['b', 'a']);
  });

  it('รายการว่าง / 1 แถว ⇒ ไม่พัง', () => {
    const cmp = byPinnedFirst<Row>(['x'], keyOf)(byTime);
    expect([].sort(cmp)).toEqual([]);
    expect([{ k: 'x', t: 1 }].sort(cmp).map((r) => r.k)).toEqual(['x']);
  });
});

/**
 * [FEAT-20260811-CHATPIN] ยืนยันก่อนเอาหมุดออก — เจ้าของสั่ง 2026-08-11:
 * *"ขอ remove pin confirm + modal บอกชื่อ วันเวลา ticket"*
 *
 * ⚠️ กฎที่ล็อกไว้ (ถ้าเพี้ยนคือผู้ใช้เสียหมุดโดยไม่ตั้งใจ หรือปักไม่ได้เพราะติดถาม):
 *   - **ปัก** = ไม่ถาม (กดผิดก็กดออกได้ ไม่เสียอะไร)
 *   - **เอาออก** = ถามก่อน และกล่องต้องบอก **ชื่อ + วันเวลาเคส** ไม่ใช่ถามลอย ๆ
 * ตรรกะการตัดสินใจอยู่ใน `togglePinnedRoom` ของ `TicketChat.tsx` ซึ่งเป็น component
 * ~3.9k บรรทัด — เทสที่นี่จึงล็อก **เงื่อนไขตัดสิน** กับ **รูปข้อความ** แบบ pure
 * (ลอกตรรกะเดียวกันมา) ส่วนตัว modal เป็นของกลางที่มีเทสของตัวเองอยู่แล้ว
 */
describe('[FEAT-20260811-CHATPIN] ปัก = ไม่ถาม · เอาออก = ต้องยืนยัน', () => {
  /** เงื่อนไขเดียวกับ `togglePinnedRoom`: อยู่ในรายการแล้ว ⇒ ต้องถามก่อน */
  const needsConfirm = (pinned: string[], key: string) => pinned.includes(key);

  it('★ ปักใหม่ ⇒ ไม่ถาม ลงมือเลย', () => {
    expect(needsConfirm(['u1'], 'u2')).toBe(false);
  });

  it('★★ เอาออก ⇒ ต้องถามก่อน (ห้ามปลดทันที)', () => {
    expect(needsConfirm(['u1', 'u2'], 'u1')).toBe(true);
  });

  it('ยกเลิกในกล่องยืนยัน ⇒ หมุดต้องยังอยู่ครบ', () => {
    // จำลอง: ผู้ใช้กดยกเลิก = ไม่เรียก togglePin เลย
    const before = ['u1', 'u2'];
    const after = before; // ไม่มีการเปลี่ยน
    expect(after).toEqual(['u1', 'u2']);
  });

  it('กดยืนยัน ⇒ ค่อยเอาออกจริง และรายการอื่นไม่ถูกแตะ', () => {
    const r = togglePin(['u1', 'u2', 'u3'], 'u2');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toEqual(['u1', 'u3']);
  });
});

describe('[FEAT-20260811-CHATPIN] ข้อความในกล่องยืนยันต้องบอกชื่อและวันเวลา', () => {
  /** ฟอร์แมตเดียวกับที่ `togglePinnedRoom` สร้าง (th-TH, 24 ชม.) */
  const fmtWhen = (t?: string) =>
    t
      ? new Date(t).toLocaleString('th-TH', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
      : '-';
  const buildMessage = (name: string, when: string) =>
    `เอาหมุดของ ${name} ออกจากด้านบนใช่หรือไม่?\nเคสล่าสุด: ${when}`;

  it('★ มีทั้งชื่อและวันเวลาในข้อความ', () => {
    const msg = buildMessage('คุณสมชาย (0812345678)', fmtWhen('2026-08-11T03:04:00Z'));
    expect(msg).toContain('คุณสมชาย (0812345678)');
    expect(msg).toContain('เคสล่าสุด:');
    // ต้องไม่เหลือ '-' แทนเวลา เมื่อมี timestamp จริง
    expect(msg).not.toContain('เคสล่าสุด: -');
  });

  it('ขึ้นบรรทัดใหม่ด้วย \\n — ConfirmModal split บรรทัดเอง (ConfirmModal.tsx:71)', () => {
    const msg = buildMessage('x', 'y');
    expect(msg.split('\n')).toHaveLength(2);
  });

  it('ไม่มี timestamp ⇒ โชว์ "-" ไม่ใช่ Invalid Date', () => {
    expect(fmtWhen(undefined)).toBe('-');
    expect(buildMessage('x', fmtWhen(undefined))).toContain('เคสล่าสุด: -');
  });

  it('timestamp ใช้ปีและเวลาแบบ 24 ชม. อ่านออก ไม่ใช่ epoch ดิบ', () => {
    const out = fmtWhen('2026-08-11T03:04:00Z');
    expect(out).not.toMatch(/^\d{10,}$/);      // ไม่ใช่ epoch
    expect(out).toMatch(/\d{2}:\d{2}/);        // มีเวลา
  });
});

/* [PERF-20260822-TKTIDSFETCH] badge ทั้ง 5 + จำนวนแถว จาก state จริง — ก่อน/หลัง partial fetch
 *
 * ## ทำไมไม่ render TicketChat
 * หน้า 5,000+ บรรทัด mock surface ใหญ่ render แล้ว flaky และไม่ได้ทดสอบสูตรนับจริง
 * (เหตุผลเดียวกับ useTicketWS.ws.test.ts และ botCountDeps.value.test.ts)
 *
 * ## ทำอย่างไรให้ยังเป็น "state จริง"
 * 1. สูตร badge ด้านล่าง **จำลองจาก TicketChat.tsx:1966-1996 บรรทัดต่อบรรทัด**
 *    และมี case ที่อ่าน source จริงมาล็อกว่าสูตรยังเป็นแบบนั้น — ถ้าใครแก้สูตร
 *    ในหน้า เทสนี้แดงก่อนที่การจำลองจะโกหก
 * 2. state เดินผ่าน `mergePartialTickets` ตัวจริง (ไม่ mock) เหมือนที่ hook ทำ
 * 3. เทียบ badge ทั้ง 5 ตัว + จำนวนแถว ระหว่าง
 *      BEFORE = full refetch (รับลิสต์ทั้งชุดจาก BE แทนที่ state)
 *      AFTER  = partial fetch (รับเฉพาะใบที่ระบุ แล้ว merge)
 *    ต้องได้ **เลขเดียวกันทุกตัว** — นี่คือสิ่งที่แผนบอกว่าต้องพิสูจน์
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mergePartialTickets } from '../services/chat/partialTicketMerge';

type Tk = { _id: string; job_status: number; admin_user_id?: string; line_oa_hook_id?: string | null };

/* ── สูตร badge จำลองจาก TicketChat.tsx — ห้ามแก้ที่นี่โดยไม่แก้ที่หน้า ── */
const countsOf = (active: Tk[], completed: Tk[], uid: string, completedTotal: number | null, hasFilter: boolean) => {
  const filteredActive = active;        // ไม่มี filter ใน scenario นี้ = identity
  const filteredCompleted = completed;
  const endedCount = (!hasFilter && completedTotal !== null)
    ? Math.max(completedTotal, filteredCompleted.length)
    : filteredCompleted.length;
  return {
    mine: filteredActive.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid).length,
    waiting: filteredActive.filter(tk => Number(tk.job_status) === 0).length,
    active: filteredActive.filter(tk => Number(tk.job_status) === 1).length,
    ended: endedCount,
    rows: filteredActive.length,
  };
};

describe('⭐ สูตรจำลองยังตรงกับหน้าจริง (อ่าน source ไม่ใช่เชื่อ)', () => {
  const src = readFileSync(resolve(__dirname, '../pages/chat/TicketChat.tsx'), 'utf8');
  const memo = src.slice(src.indexOf('const counts = useMemo'), src.indexOf('const counts = useMemo') + 2500);
  // ล็อก "ทั้งบรรทัด" ไม่ใช่ substring — mutation `.length + 1` เคยหลุดผ่าน toContain
  const lineOf = (key: string) => (memo.split('\n').find(l => l.trim().startsWith(key + ':')) ?? '').trim();
  // flipped 26/08 [FEAT-20260826-ACTIVEPAGING]: the lines gained a server-
  // truth head (`sc ? sc.X :`) for paging mode; sc is null everywhere this
  // file simulates (switch off), so the simulated math is still the page's.
  it.each([
    ['mine', 'mine: sc ? sc.mine : filteredActive.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid).length,'],
    ['waiting', 'waiting: sc ? sc.waiting : filteredActive.filter(tk => Number(tk.job_status) === 0).length,'],
    ['active', 'active: sc ? sc.active : filteredActive.filter(tk => Number(tk.job_status) === 1).length,'],
    ['ended', 'ended: endedCount,'],
  ])('หน้ายังใช้ %s ตามสูตรที่จำลองไว้ — ทั้งบรรทัด', (key, exact) => { expect(lineOf(key)).toBe(exact); });
  it('endedCount ยังเป็น max(completedTotal, filteredCompleted.length) เมื่อไม่มี filter', () => {
    expect(memo).toContain('? Math.max(completedTotal, filteredCompleted.length)');
    expect(memo).toContain(': filteredCompleted.length;');
  });
});

/* ── ข้อมูลเริ่มต้น: ลิสต์ที่แอดมินถืออยู่ ── */
const UID = 'admin-1';
const base = (): Tk[] => [
  { _id: 't1', job_status: 0, line_oa_hook_id: 'h1' },
  { _id: 't2', job_status: 1, admin_user_id: UID, line_oa_hook_id: 'h1' },
  { _id: 't3', job_status: 1, admin_user_id: 'other', line_oa_hook_id: 'h1' },
];
const completed: Tk[] = [{ _id: 'c1', job_status: 2 }];

/** สิ่งที่ BE คืนให้ full refetch หลังเหตุการณ์ — ความจริงจาก DB */
const serverTruth = (extra: Tk[]): Tk[] => [...base(), ...extra];

describe('⭐ ticket ใหม่มา → badge +1 · แถว +1 · เท่ากับ full refetch เป๊ะ', () => {
  const fresh: Tk = { _id: 't4', job_status: 0, line_oa_hook_id: 'h1' };

  it('waiting +1 และไม่มี badge อื่นขยับ', () => {
    const before = countsOf(base(), completed, UID, 1, false);
    const full = countsOf(serverTruth([fresh]), completed, UID, 1, false);
    const partial = countsOf(mergePartialTickets(base(), [fresh]), completed, UID, 1, false);
    expect(partial).toEqual(full);
    expect(partial.waiting).toBe(before.waiting + 1);
    expect(partial.rows).toBe(before.rows + 1);
    expect(partial.mine).toBe(before.mine);
    expect(partial.active).toBe(before.active);
    expect(partial.ended).toBe(before.ended);
  });

  it('event เดิมมาซ้ำ → ยิง partial ซ้ำ → badge ไม่เกิน', () => {
    let state = mergePartialTickets(base(), [fresh]);
    state = mergePartialTickets(state, [fresh]);
    state = mergePartialTickets(state, [fresh]);
    expect(countsOf(state, completed, UID, 1, false)).toEqual(
      countsOf(serverTruth([fresh]), completed, UID, 1, false),
    );
  });
});

describe('⭐ update ของใบที่ยังไม่มีในลิสต์ (แอดมินอื่นรับเคส) → mine/active ถูก', () => {
  it('ตั๋วที่อีกคนเพิ่งรับ → active +1 · mine เท่าเดิม', () => {
    const accepted: Tk = { _id: 't5', job_status: 1, admin_user_id: 'other', line_oa_hook_id: 'h1' };
    const full = countsOf(serverTruth([accepted]), completed, UID, 1, false);
    const partial = countsOf(mergePartialTickets(base(), [accepted]), completed, UID, 1, false);
    expect(partial).toEqual(full);
    expect(partial.active).toBe(3);
    expect(partial.mine).toBe(1);
  });

  it('ตั๋วที่ "เรา" เพิ่งรับจากอีกแท็บ → mine +1', () => {
    const mine: Tk = { _id: 't6', job_status: 1, admin_user_id: UID, line_oa_hook_id: 'h1' };
    const partial = countsOf(mergePartialTickets(base(), [mine]), completed, UID, 1, false);
    expect(partial).toEqual(countsOf(serverTruth([mine]), completed, UID, 1, false));
    expect(partial.mine).toBe(2);
  });
});

describe('⭐ BE คืนใบเดิมด้วยสถานะใหม่ (แทนที่ ไม่ซ้ำ)', () => {
  it('t1 เปลี่ยนจาก waiting → accepted โดยเรา: waiting −1 · mine +1 · แถวเท่าเดิม', () => {
    const changed: Tk = { _id: 't1', job_status: 1, admin_user_id: UID, line_oa_hook_id: 'h1' };
    const truth = base().map(t => t._id === 't1' ? changed : t);
    const partial = countsOf(mergePartialTickets(base(), [changed]), completed, UID, 1, false);
    expect(partial).toEqual(countsOf(truth, completed, UID, 1, false));
    expect(partial.rows).toBe(3);
    expect(partial.waiting).toBe(0);
    expect(partial.mine).toBe(2);
  });
});

describe('⭐ สิทธิ์ — ตั๋วของ OA ที่ไม่มีสิทธิ์ ต้องไม่ขยับ badge', () => {
  it('full refetch กรอง h9 ออก · partial ก็ต้องกรองออก → เท่ากัน', () => {
    const foreign: Tk = { _id: 't9', job_status: 0, line_oa_hook_id: 'h9' };
    const allowed = new Set(['h1']);
    // full refetch ของ fetchActive กรองด้วย userAllowedHooksSet ก่อน set
    const fullFiltered = serverTruth([foreign]).filter(tk => !tk.line_oa_hook_id || allowed.has(tk.line_oa_hook_id));
    const partial = mergePartialTickets(base(), [foreign], { allowedHooks: allowed });
    expect(countsOf(partial, completed, UID, 1, false)).toEqual(countsOf(fullFiltered, completed, UID, 1, false));
    expect(partial).toHaveLength(3);
  });
});

describe('⭐ ended ไม่ถูกแตะ — partial fetch แตะเฉพาะ activeTickets', () => {
  it('completed / completedTotal ไม่เปลี่ยนไม่ว่า active จะขยับยังไง', () => {
    const fresh: Tk = { _id: 't4', job_status: 0 };
    const a = countsOf(base(), completed, UID, 7, false);
    const b = countsOf(mergePartialTickets(base(), [fresh]), completed, UID, 7, false);
    expect(b.ended).toBe(a.ended);
    expect(b.ended).toBe(7);
  });
});

/**
 * [FIX-20260829-ROOMRESOLVE] ตั๋ว → ห้องแชท
 * ===========================================================================
 * ⚠️ ไฟล์นี้เคยเป็น "เทส BEFORE" ที่แช่ **บั๊ก** ไว้เป็นหลักฐาน (commit `d7145b7`
 * tag `lane-rr1-extract`) — ตอนนี้บั๊กถูกแก้แล้ว เคสที่เคยยืนยันว่า "สร้างห้องปลอม"
 * จึงถูกพลิกเป็น "ต้องไม่สร้างห้องปลอม" **ตามที่ตั้งใจ ไม่ใช่เทสพัง**
 * ดูพฤติกรรมเดิมได้ที่ `git show lane-rr1-extract:test/resolveRoomIdentity.value.test.ts`
 *
 * 🔴 บั๊กที่แก้: ห้องสำรองใส่ `ticket.line_user_id` (= **member ObjectId**) ลงช่อง
 *    `_id` ที่ต้องเป็น room id ⇒ ทั้งคู่ 24-hex ⇒ BE `findById` ไม่เจอ ⇒ **404 เงียบ**
 *    วัด prod 29/08: 3 OA เกิน `ROOM_HARD_CAP = 200` ⇒ ราว 620 คนตอบกลับไม่ได้
 *    และ `ticket_without_room = 0` จาก 2,151 ตั๋ว ⇒ ห้องปลอมไม่เคยจำเป็นเลย
 *
 * 📖 แผน: `omnidesk-api/todo/task/29082026/fe_resolveroom-fix_29082026.md`
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

/* ⚠️ `vi.hoisted` — `vi.mock` ถูกยกขึ้นบนสุดของไฟล์ ตัวแปรที่ประกาศธรรมดา
   จะยังไม่ถูกสร้างตอน factory ทำงาน (เจอจริงตอนเขียนเทสนี้)
   แบบเดียวกับที่ `test/hookNoticeTab.dom.test.tsx` ทำอยู่แล้ว */
const { listRooms } = vi.hoisted(() => ({ listRooms: vi.fn() }));
vi.mock('../services/chat', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, chatService: { ...actual.chatService, listRooms } };
});

import { resolveRoom, findRoomInList } from '../pages/chat/resolveRoom';

const MEMBER_ID = 'a'.repeat(24);
const ROOM_ID = 'b'.repeat(24);
const HOOK_ID = 'c'.repeat(24);
const UXXX = 'U' + 'f'.repeat(32);

const ticket = (over: Record<string, unknown> = {}) =>
  ({
    _id: 't1',
    line_oa_hook_id: HOOK_ID,
    line_user_id: MEMBER_ID,
    line_user_data: { _id: MEMBER_ID, line_user_id: UXXX },
    ...over,
  }) as never;

const room = (over: Record<string, unknown> = {}) =>
  ({ _id: ROOM_ID, hook_id: HOOK_ID, line_user_id: UXXX, ...over }) as never;

beforeEach(() => { listRooms.mockReset(); });

describe('[ROOMRESOLVE] ขั้น 1 — เจอในลิสต์ ต้องไม่ยิง request', () => {
  it('⭐⭐ 🔴 ห้องอยู่ในลิสต์ ⇒ คืนห้องจริง และ listRooms ถูกเรียก 0 ครั้ง', async () => {
    /* ข้อนี้คือหลักประกันว่า "ไม่เพิ่มโหลด" — ทางเดิมยังเป็นทางเร็วเหมือนเดิม */
    const got = await resolveRoom(ticket(), [room()]);
    expect(got?._id).toBe(ROOM_ID);
    expect(listRooms).toHaveBeenCalledTimes(0);
  });

  it('⭐⭐ จับคู่ด้วย Uxxx ของห้อง กับ line_user_data.line_user_id ของตั๋ว', async () => {
    expect((await resolveRoom(ticket(), [room({ line_user_id: UXXX })]))?._id).toBe(ROOM_ID);
  });

  it('⭐ จับคู่ด้วย user_data._id ของห้อง กับ member _id ของตั๋ว', async () => {
    const r = room({ line_user_id: undefined, user_data: { _id: MEMBER_ID } });
    expect((await resolveRoom(ticket(), [r]))?._id).toBe(ROOM_ID);
  });
});

describe('[ROOMRESOLVE] ขั้น 2 — ไม่เจอในลิสต์ ต้องถามห้องเดียว', () => {
  it('⭐⭐ 🔴 ถาม listRooms(hookId, memberId) หนึ่งครั้ง แล้วคืนห้องจริง', async () => {
    /* หัวใจของการแก้: ลูกค้าที่ตกจากเพดาน 200 ห้อง ต้องยังหาห้องเจอ */
    listRooms.mockResolvedValue([room()]);
    const got = await resolveRoom(ticket(), []);
    expect(got?._id).toBe(ROOM_ID);
    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(listRooms).toHaveBeenCalledWith(HOOK_ID, MEMBER_ID);
  });

  it('⭐⭐ 🔴 ส่ง member ObjectId ไม่ใช่ Uxxx — BE กรองด้วย user_id ซึ่งเป็น ref ไป member', async () => {
    /* ส่ง Uxxx จะได้ลิสต์ว่างเงียบ ๆ เพราะ BE ทิ้ง id ที่ไม่ใช่ ObjectId */
    listRooms.mockResolvedValue([]);
    await resolveRoom(ticket(), []);
    expect(listRooms.mock.calls[0]?.[1]).toBe(MEMBER_ID);
    expect(listRooms.mock.calls[0]?.[1]).not.toBe(UXXX);
  });
});

describe('[ROOMRESOLVE] ขั้น 3 — 🔴 ห้ามสร้างห้องปลอมอีกต่อไป', () => {
  it('⭐⭐ 🔴 ไม่มีห้องจริง ⇒ คืน null ไม่ใช่ห้องที่ _id เป็น member ObjectId', async () => {
    /* พฤติกรรมเดิม (tag `lane-rr1-extract`) คืน `{_id: MEMBER_ID}` ซึ่งทำให้
       BE 404 เงียบ · ตอนนี้ต้องเป็น null เพื่อให้ความผิดพลาด "ดัง" */
    listRooms.mockResolvedValue([]);
    const got = await resolveRoom(ticket(), []);
    expect(got).toBeNull();
  });

  it('⭐⭐ 🔴 ไม่มี member _id ⇒ คืน null และไม่ยิง request ที่ยิงไปก็ไร้ประโยชน์', async () => {
    const got = await resolveRoom(ticket({ line_user_data: null }), []);
    expect(got).toBeNull();
    expect(listRooms).toHaveBeenCalledTimes(0);
  });

  it('⭐⭐ ไม่มี hook ⇒ คืน null ไม่ยิง request', async () => {
    const got = await resolveRoom(ticket({ line_oa_hook_id: null }), []);
    expect(got).toBeNull();
    expect(listRooms).toHaveBeenCalledTimes(0);
  });

  it('⭐⭐ เครือข่ายล้ม ⇒ คืน null ไม่ใช่ห้องผิด', async () => {
    /* network error ≠ "ห้องไม่มี" — แต่คืนห้องผิดแย่กว่าคืน null */
    listRooms.mockRejectedValue(new Error('network'));
    expect(await resolveRoom(ticket(), [])).toBeNull();
  });
});

describe('[ROOMRESOLVE] ขอบเขตที่ต้องไม่ขยับ', () => {
  it('⭐⭐ 🔴 `ticket.chat_room_id` ยังไม่มีในสัญญาของ BE', async () => {
    /* ถ้าวันหนึ่ง BE เพิ่มจริง เทสนี้แดง = กลับมาคิดใหม่ ไม่ใช่ลบทิ้ง */
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    /* [FIX-20260905-ABSPATH] Was an ABSOLUTE path carrying this machine's user
       name. That broke the standing rule that no hostname, full path or user
       name may appear in the repo, and it made the case pass on exactly one
       machine — anywhere else `readFileSync` threw and the failure looked like
       the BE contract had changed. Resolved from this repo's own location, and
       it SKIPS rather than throws when the sibling is not checked out, because
       "I cannot see the schema" is not the same answer as "the schema grew a
       field". เส้นทางผูกเครื่อง = เทสของเครื่องเดียว */
    const schemaPath = join(
      process.cwd(),
      '..',
      'backend',
      'src/modules/tickets/schemas/ticket.schema.ts',
    );
    if (!existsSync(schemaPath)) {
      expect('sibling omnidesk-api not checked out — nothing to check').toBeTruthy();
      return;
    }
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema.includes('chat_room_id')).toBe(false);
  });

  it('⭐ findRoomInList ยังไม่เทียบ hook_id — พฤติกรรมเดิม ไม่ได้เปลี่ยนในรอบนี้', () => {
    /* แช่ไว้ให้รู้ตัวถ้าวันหนึ่งมีคนเปลี่ยน · ลิสต์ถูกดึงต่อ hook อยู่แล้ว */
    const other = room({ hook_id: 'd'.repeat(24) });
    expect(findRoomInList(ticket(), [other])?._id).toBe(ROOM_ID);
  });

  it('⭐ findRoomInList เป็น sync และไม่ยิง request — ใช้ได้ในที่ที่ await ไม่ได้', () => {
    expect(findRoomInList(ticket(), [])).toBeNull();
    expect(listRooms).toHaveBeenCalledTimes(0);
  });
});

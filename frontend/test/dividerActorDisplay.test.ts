/**
 * [FEAT-2708-DIVIDERDISPLAY] แสดงแค่ displayName บน divider — ตอน "วาด" เท่านั้น
 * ===========================================================================
 * เจ้าของ 27/08 (พร้อม screenshot แถวเก่า): *"เฉพาะตอนแสดงผลให้แสดแค่
 * displayname admin"* — ข้อมูลเก็บเหมือนเดิมทุกไบต์ (`"เปิดเคส โดย dev
 * (Developer)"` อยู่ใน content ตามเดิม) · ตัวนี้ strip เฉพาะตอน render
 * ⇒ แถวเก่า/ใหม่บนจออ่านเหมือนกันหมด และไม่มี migrate อะไรทั้งนั้น
 *
 * กติกาที่ตรึง:
 *   · ครอบเฉพาะ variant ที่ BE ประกอบ "… โดย <user> (<display>)" เท่านั้น —
 *     variant อื่น (multicast/suppressed_reply/note/บอท) ห้ามแตะแม้ข้อความ
 *     จะบังเอิญหน้าตาเหมือน (กัน regex กินชื่อ job ที่มีวงเล็บ)
 *   · คู่ท้ายสตริงเท่านั้น: "รับเคส โดย dev (Developer)" → "รับเคส โดย Developer"
 *   · ไม่มีวงเล็บท้าย = คืนเดิมเป๊ะ (แถวยุคที่เก็บชื่อเดี่ยว + fallback username)
 */
import { describe, expect, it } from 'vitest';
import {
  ACTOR_DIVIDER_VARIANTS,
  dividerActorDisplay,
} from '../components/chat/dividerActorDisplay';

describe('[DIVIDERDISPLAY] strip เฉพาะตอนวาด', () => {
  it('⭐⭐ คู่ u (d) ท้ายข้อความ → เหลือ displayName เดี่ยว (ทุก variant ที่มี actor)', () => {
    expect(dividerActorDisplay('เปิดเคส โดย dev (Developer)', 'open_by_admin')).toBe(
      'เปิดเคส โดย Developer',
    );
    expect(dividerActorDisplay('รับเคส โดย dev (Developer)', 'accept')).toBe(
      'รับเคส โดย Developer',
    );
    expect(dividerActorDisplay('ปิดเคส โดย admin (Administrator)', 'close')).toBe(
      'ปิดเคส โดย Administrator',
    );
    expect(dividerActorDisplay('โอนเคส โดย dev (Developer)', 'assign')).toBe(
      'โอนเคส โดย Developer',
    );
  });

  it('⭐ ไม่มีคู่วงเล็บท้าย = คืนเดิมทุกไบต์ (ยุคชื่อเดี่ยว/fallback username)', () => {
    expect(dividerActorDisplay('ปิดเคส โดย Administrator', 'close')).toBe(
      'ปิดเคส โดย Administrator',
    );
    expect(dividerActorDisplay('รับเคส โดย dev', 'accept')).toBe('รับเคส โดย dev');
  });

  it('⭐⭐ variant นอกชุด actor ห้ามแตะ — ข้อความหน้าตาเหมือนก็ห้าม', () => {
    /* ชื่อ job มีวงเล็บได้จริง — regex ที่ไม่ล็อก variant จะกินมัน */
    expect(
      dividerActorDisplay('Multicast จาก job "ชวนลูกค้า โดย ทีม (พิเศษ)"', 'broadcast_transcript'),
    ).toBe('Multicast จาก job "ชวนลูกค้า โดย ทีม (พิเศษ)"');
    expect(dividerActorDisplay('บอทกลับมาดูแลแล้ว', 'bot')).toBe('บอทกลับมาดูแลแล้ว');
    expect(dividerActorDisplay('อะไรก็ได้ โดย a (b)', undefined)).toBe('อะไรก็ได้ โดย a (b)');
  });

  it('ชุด variant ตรงกับ writer ฝั่ง BE (accept/assign/close/open/reopen/claim)', () => {
    for (const v of ['accept', 'assign', 'close', 'open_by_admin', 'reopen_by_admin', 'claim']) {
      expect(ACTOR_DIVIDER_VARIANTS.has(v)).toBe(true);
    }
    expect(ACTOR_DIVIDER_VARIANTS.has('bot')).toBe(false);
    expect(ACTOR_DIVIDER_VARIANTS.has('broadcast_transcript')).toBe(false);
  });
});

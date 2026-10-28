/**
 * [FEAT-20260824-BCASTCLEARNOTICE] เราบอกเขาไปแล้วว่าแบงค์ปกติ ⇒ ลบป้าย "เคยแจ้งปัญหา" ทิ้ง
 * ===========================================================================
 * เจ้าของ 24/08:
 *   *"follow_up.notice_deposit_at / notice_withdraw_at เราจะต้องเคลียร์ออก หาก
 *     multicast สำเร็จ (ของ member คนนั้น ๆ)"* ·
 *   *"ถ้ามันติดค่า notice มาเพราะแบงค์มีปัญหาใหม่ไง"* ·
 *   *"เราจะยิงช่วยที่แบงค์ปกติไง"* · *"เพราะมันเคลียร์ค่านะถูกแล้ว"*
 *
 * ── NO AUDIT ROW IS WRITTEN HERE, AND THAT IS ON PURPOSE ────────────────────
 * Checked 01/09/2026 after a real question: a member had been sent a notice
 * card, yet the follow-up panel showed n/a for both sides and the audit page
 * held nothing at all. The reading "the stamp was never written" is the wrong
 * one — a later multicast had cleared it, exactly as designed.
 *
 * WHERE THE TRACE ACTUALLY IS: `broadcasts_histories`. Every run records
 * `triggered_by` / `triggered_by_user` / `triggered_by_name`, `started_at`,
 * `hook_id`, and `targeted` / `sent` / `failed`. So WHO cleared it, WHEN, for
 * WHICH OA and HOW MANY people is already answerable — it simply is not in
 * `hook_audit_logs`, which is where anyone would look first.
 * ร่องรอยมีอยู่แล้ว แต่คนละที่กับที่คนไปหา
 *
 * WHETHER ONE NAMED MEMBER WAS IN A RUN **IS** ANSWERABLE — from `chat_messages`,
 * not from the history row. `broadcast-transcript/transcript.writer.ts` writes a
 * bot row into EVERY recipient's room, tagged
 * `metadata.campaign = { kind, job_id, run_id }`. So: find that row in the
 * member's room, read `run_id`, and the run that cleared the stamp is named.
 * ⚠️ It lives with the conversation, so it goes when the room does.
 *
 * What is genuinely not stored is the list of members who MATCHED but were never
 * sent to — no transcript row exists for them. That is what
 * `broadcast-history/recipient-ledger.ts` is for, and all three of its switches
 * are OFF: turning one on starts storing customer identifiers and needs the same
 * approval as any schema change.
 *
 * WHY THIS FILE DOES NOT WRITE ONE ANYWAY: it takes `{ lineUserIds }` and
 * nothing else — no actor, no audit model — and widening that signature would
 * grow the contract of a file whose whole point is that it can be lifted out.
 * One row per member per run would also swell the audit table far faster than
 * anything else writing to it. Diagnosing this is a query, not a new column.
 *
 * To trace a specific case: find the notice card in `chat_messages`, then look
 * for `broadcasts_histories` rows on the same `hook_id` with `started_at` after
 * it and `sent > 0`. A multicast run there is the thing that cleared the stamp.
 * 📖 todo/task/01092026/be_todo112_01092026.md — the ready-made query
 *
 * ── ความหมายของ stamp และทำไมล้างถึงถูก ──────────────────────────────────────
 * `notice_deposit_at` / `notice_withdraw_at` ถูกประทับโดย notice runtime
 * (`webhook/notice-runtime/cases/case-a..d`) ตอน **แบงค์มีปัญหา** — ปิดฝาก ปิดถอน
 * หรืออยู่นอกเวลาทำการ ⇒ ตัว stamp แปลว่า *"เคยส่งการ์ดบอกเขาไปแล้วว่าแบงค์มีปัญหา"*
 *
 * พอแคมเปญ multicast ยิงไปบอกว่าแบงค์กลับมาปกติ **เหตุผลของ stamp หมดอายุทันที**
 * ⇒ ล้างทิ้งคือสิ่งที่ถูก และถ้าแบงค์มีปัญหา **ใหม่** notice runtime ก็ประทับใหม่เอง
 * ไม่ต้องมีใครไปยุ่ง — วงจรปิดในตัวมันเอง
 *
 * 🔴 นี่คือการเปลี่ยนชั้นของคีย์ และประกาศไว้ที่ตัวกลางแล้ว
 *    `chat/config/member-config.registry.ts` เคยเขียนว่าคีย์กลุ่มนี้
 *    *"clear NOBODY, AND THAT IS THE DESIGN"* — จัดเป็น ROLLING RECORD ที่ปล่อยให้
 *    อายุของมันจางไปเอง เจ้าของตัดสิน 24/08 ว่า **ล้างได้ ไม่ได้ห้าม** และให้ไป
 *    ประกาศที่ตัวกลางว่า multicast เป็นคนล้าง ⇒ บัญชี CONSUMERS ที่นั่นถูกแก้ใน
 *    commit เดียวกัน (`member-config.spec.ts` grep โค้ดเทียบบัญชี ถ้าไม่ตรงมันแดง)
 *    แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางเสมอ.
 *
 * 🔴 IMPORT `../../chat/config` ตรง ๆ ไม่ใช่ `@/modules/chat`
 *    `chat.module.ts:8` import `@/modules/content` อยู่ ⇒ ดึง barrel ของ chat กลับมา
 *    คือวงจร ซึ่งพังแบบ schema เป็น `undefined` ตอน boot
 *    โฟลเดอร์ `chat/config` ไม่ import อะไรนอกจาก mongoose จึงหยิบมาได้อย่างปลอดภัย
 *    — วิธีเดียวกับที่ `customer-link/clear-follow-up-on-register.helper.ts` ใช้อยู่แล้ว
 *
 * ⚠️ MULTICAST เท่านั้น — `/message/broadcast` ไม่มีรายชื่อผู้รับ LINE กระจายเองและ
 *    ไม่บอกว่าใครได้รับ ⇒ ไม่มีใครให้ล้างอย่างถูกต้อง ตัวเรียกส่ง list ที่ได้จาก
 *    `DeliveryCollector` ซึ่งเก็บเฉพาะ chunk ที่ LINE ตอบรับ
 *
 * ⚠️ ล้าง **เฉพาะคนที่ได้รับจริง** ไม่ใช่ทุกคนที่เล็งไว้ — chunk ที่ยิงไม่ผ่านคือคน
 *    ที่ยังไม่ได้รู้ว่าแบงค์ปกติแล้ว ป้ายของเขาต้องอยู่ต่อ
 *    ยิงไม่ถึง = ยังไม่ได้บอก ⇒ ห้ามล้าง.
 *
 * ⚠️ ไม่เคยโยน — ป้ายเป็นผลพลอยได้ ข้อความอยู่บนมือถือลูกค้าไปแล้ว การล้างพลาด
 *    ต้องไม่ทำให้แคมเปญที่สำเร็จกลายเป็นล้มเหลว (กฎเดียวกับ transcript writer)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 📖 กำลังจะสร้างแคมเปญเหรอ — สี่ข้อที่ฝั่ง "เลือกผู้รับ" จะไม่บอกคุณเอง
 * ═══════════════════════════════════════════════════════════════════════════
 * ไฟล์นี้คือปลายทางของแคมเปญ (ล้างป้ายหลังยิงถึง) แต่คนที่เปิดไฟล์นี้มักกำลังคิด
 * เรื่อง **ต้นทาง** อยู่ด้วย ⇒ เขียนไว้ตรงนี้เลย จะได้ไม่ต้องไปเดาที่ทะเบียนตัวกรอง
 * ทะเบียนเต็ม: `content/audience/sources/audience-source.registry.ts`
 *
 * ① **"ยังค้างอยู่จริง" มีตัวเดียวจากหก** — `follow_up.abandon_at` เท่านั้นที่เป็น
 *    ธง (ถูกลบตอนลูกค้าสมัคร ทั้งสองเส้นทาง) ⇒ แคมเปญชวนสมัครต้องใช้ตัวนี้
 *    อีกห้าตัว (`request_reg_at` · `customer_helper_at` · `notice_deposit_at` ·
 *    `notice_withdraw_at` · `notice_payment_at`) ตอบว่า **"เคยเป็น X"** ไม่ใช่
 *    "ยังเป็น X อยู่" · เลือกผิด = ยิงโดนคนที่ทำเรื่องนั้นเสร็จไปนานแล้ว
 *
 * ② **สอง stamp ที่ไฟล์นี้ล้าง ก็ยังไม่ใช่ธง** — ที่ล้างได้เพราะ *แคมเปญ* พูดเรื่อง
 *    นั้นไปแล้ว ไม่ใช่เพราะ *ลูกค้า* ทำอะไร ⇒ "ไม่มี stamp" ยังแปลได้สองอย่างเสมอ:
 *    ไม่เคยถูกแจ้ง **หรือ** ถูกแจ้งแล้วและเราบอกทีหลังว่าปกติแล้ว
 *    ⇒ เล็ง `notice_*` = "เคยได้รับแจ้งเตือนเรื่องนี้" ไม่ใช่ "ตอนนี้ยังเดือดร้อนอยู่"
 *
 * ③ 🔴 **คิวรี่ที่รันจริงอาจไม่ใช่คิวรี่ที่แอดมินกด** —
 *    `content/audience/sources/force-no-profile.policy.ts` จะ AND
 *    `{raw_profile_data: null}` ("ยังไม่ผูกข้อมูล") เข้าไปทั้งงาน **ทันทีที่กฎข้อใด
 *    ข้อหนึ่งเอ่ยถึง** `follow_up.abandon_at` / `follow_up.request_reg_at` /
 *    `follow_up.customer_helper_at` · เหตุผล: สามตัวนั้นเป็น RECORD ที่ไม่มีใครลบ
 *    ป้ายของมันลงท้ายว่า "ยังไม่ลงทะเบียน" ⇒ ถ้าไม่บังคับ ป้ายจะโกหก
 *    ⚠️ **กับดักที่เจอได้จริงกับแคมเปญแบบนี้**: `notice_*` ทั้งสามตัว **ไม่อยู่**
 *       ในลิสต์บังคับ (ถูกแล้ว — แคมเปญ "แบงค์กลับมาปกติ" ต้องถึงคนที่ผูกข้อมูล
 *       แล้วด้วย) **แต่การบังคับดูที่ "ทั้งงาน" ไม่ใช่ "รายกฎ"** ⇒ ถ้าเอากฎ
 *       `notice_deposit_at` ไปผสมกับกฎชวนสมัครในงานเดียวกัน ทั้งงานจะถูกหด
 *       เหลือเฉพาะคนที่ยังไม่ผูกข้อมูล **แบบเงียบ ๆ** ⇒ ลูกค้าที่ผูกแล้วจะไม่ได้รับ
 *       ข่าวว่าแบงค์กลับมาปกติ · อยากได้ทั้งสองกลุ่ม = **แยกเป็นคนละ job**
 *    ⚠️ ปิดสวิตช์ `FORCE_NO_PROFILE_ENABLED` เมื่อไหร่: แคมเปญชวนสมัครทุกตัวจะ
 *       เริ่มยิงโดนคนที่สมัครไปแล้วในรอบถัดไปทันที ไม่มี error ไม่มี log ป้ายยังเขียน
 *       เหมือนเดิม และกลุ่มที่พลาดจะ **โตขึ้นเรื่อย ๆ** ตามเวลา เพราะ RECORD ไม่มี
 *       ใครลบ · ส่วนแคมเปญแบบไฟล์นี้ (notice) จะไม่ขยับเลย เพราะไม่เคยถูกบังคับ
 *
 * ④ **"ไม่มีโปรไฟล์" ยังไม่เท่ากับ "ไม่เคยสมัคร"** — แอดมินลบโปรไฟล์ลูกค้าได้
 *    (ปุ่มสำหรับ developer) ⇒ คนที่สมัครแล้วแต่ถูกล้าง จะผ่านเงื่อนไขบังคับในข้อ ③
 *    เหมือนคนที่ไม่เคยสมัครทุกประการ · เงื่อนไขที่ปิดรูนี้คือ
 *    `raw_profile_cleared_at: null` ซึ่ง **ยังไม่ได้ต่อสาย** — วันนี้ต้องเติมเป็นกฎ
 *    ที่สองในแคมเปญเอง (source `raw_profile_cleared_at` + op `no_value`)
 *    รายละเอียดเต็ม: [DOC-20260825-REGSTATUS] ใน
 *    `chat/config/member-config.registry.ts`
 *
 * 📖 ภาพรวมทั้งฟีเจอร์แบบอ่านคนเดียวจบ (ป้ายไหนหมายถึงอะไร ดูได้จากกี่ที่ เลขจริง
 *    จากฐาน): `docs/follow-up-status-spec.md`
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * เปลี่ยนใจทีหลังทำยังไง — 5 แบบที่นึกออก และแต่ละแบบแตะตรงไหนบ้าง
 * ═══════════════════════════════════════════════════════════════════════════
 * เขียนไว้ตรงนี้เพราะนี่คือไฟล์ที่คนจะเปิดตอนอยากเปลี่ยน ไม่ใช่ใน note ที่ไม่มีใครหา
 * ⚠️ ทุกแบบต้องไปอัปเดตบัญชี CONSUMERS ที่ `chat/config/member-config.registry.ts`
 *    ใน commit เดียวกัน ไม่งั้น `member-config-consumers.spec.ts` แดง
 *
 * ① เลิกล้างทั้งหมด (กลับไปเป็นเหมือนก่อน 24/08)
 *    · ลบโฟลเดอร์ `broadcast-follow-up/` + บรรทัด export ใน `content/index.ts`
 *    · ลบบล็อก `[FEAT-20260824-BCASTCLEARNOTICE]` ใน `new-send.service.ts`
 *    · registry: คืนบรรทัดเป็น `clear NOBODY, AND THAT IS THE DESIGN`
 *      (ประโยคเดิมเก็บไว้ในหัวข้อ HISTORY ของ entry นั้นแล้ว ลอกกลับได้เลย)
 *    · `member-config.spec.ts`: เอาไฟล์นี้ออกจากรายชื่อ readers
 *    · ลบ `z-test/unit/broadcast-clear-notice.spec.ts`
 *    การส่งไม่ถูกแตะเลยไม่ว่าทางไหน — ไม่มีใครอ่านค่าที่นี่ไปตัดสินใจ
 *
 * ② เปลี่ยนว่าจะล้างคีย์ไหน (เช่น อยากล้าง `notice_payment_at` ด้วย)
 *    แก้ `MULTICAST_CLEARS_KEYS` ที่เดียว **แต่ตอบให้ได้ก่อนว่าแคมเปญพูดเรื่องนั้นจริงไหม**
 *    ล้างป้ายที่แคมเปญไม่ได้พูดถึง = อ้างว่าบอกลูกค้าไปแล้วทั้งที่ไม่ได้บอก
 *    ⚠️ คีย์ใหม่ต้องประกาศใน `MEMBER_CONFIG_KEYS` ก่อน ไม่งั้น `clearMemberConfigMany`
 *       จะ throw (ซึ่งถูกแล้ว — กันพิมพ์ผิดแล้วล้างพลาดเงียบ ๆ)
 *    · เทส `'ล้าง deposit กับ withdraw เท่านั้น'` จะแดง — ต้องแก้ให้ตรงเจตนาใหม่
 *
 * ③ ล้างเฉพาะบางแคมเปญ ไม่ใช่ทุก multicast
 *    วันนี้ทุก multicast ที่สำเร็จล้างหมด ⇒ แคมเปญโปรโมชันที่ไม่เกี่ยวกับแบงค์ก็ล้างด้วย
 *    ถ้าจะแยก: เพิ่มสวิตช์ระดับ job (เช่น `clear_notice_on_send` ใน `broadcasts` schema)
 *    แล้วเช็คใน `new-send.service.ts` ก่อนเรียก — **ห้ามเช็คในไฟล์นี้**
 *    ไฟล์นี้ตอบแค่ "ล้างของใครบ้าง" ไม่ใช่ "ควรล้างไหม" คนละคำถาม
 *    ⚠️ field ใหม่บน `broadcasts` = แก้ schema ⇒ ต้องขออนุมัติก่อนตามกฎ dev-local §3
 *
 * ④ ให้ broadcast (ไม่ใช่แค่ multicast) ล้างด้วย
 *    **ทำไม่ได้ และไม่ควรพยายาม** — `/message/broadcast` ไม่มีรายชื่อผู้รับ LINE
 *    กระจายเองและไม่บอกว่าใครได้รับ ⇒ ไม่มีใครให้ล้างอย่างซื่อสัตย์
 *    ถ้าล้างทุกคนใน OA จะไปล้างของคนที่ไม่ได้รับด้วย ซึ่งกู้คืนไม่ได้
 *    เดียวกับเหตุผลที่ transcript ก็ไม่เขียนให้ broadcast
 *
 * ⑤ ล้างทุกคนที่เล็งไว้ ไม่ใช่แค่คนที่ยิงถึง
 *    เปลี่ยนตัวเรียกให้ส่ง targeted list แทน `reachedByHook` — **ไม่แนะนำ**
 *    chunk ที่ยิงไม่ผ่านคือคนที่ยังไม่รู้ว่าแบงค์ปกติ ล้างป้ายเขาคือทำเครื่องหมายว่า
 *    บอกแล้วทั้งที่ยังไม่ได้บอก และไม่มีทางรู้ทีหลังว่าใครโดน
 *    · เทส `'กรองด้วย line_user_id ที่ส่งมาเท่านั้น'` จะแดง — นั่นคือมันทำงาน
 *
 * revert: ดูข้อ ① ข้างบน
 */
import type { Model } from 'mongoose';

/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   That file is the only place a key may be declared, it carries the checklist
   for adding one, the measured index/query rules, and a CONSUMERS list naming
   every file that touches the bag — this one included. `member-config.spec.ts`
   and `member-config-consumers.spec.ts` grep the code and fail if that list
   stops matching reality, so the two cannot drift apart silently.
   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit. แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   CLEARS `follow_up.line.notice_deposit_at` and
   `follow_up.line.notice_withdraw_at` — WHOSE?
     · WRITTEN BY `webhook/notice-runtime/notice-guard.helper.ts` after a bank
       notice card is sent (cases A-D: deposit/withdraw off-time or disabled).
     · READ BY that same file for the cooldown window, and by
       `chat/chat.service.ts` (listContacts `?follow=`, an `$exists` filter);
       the dashboard shows the raw values in `ContactHeaderInfo.tsx`.
   ON WHICH ROUTE: the CAMPAIGN one — a multicast that LINE accepted, in the
   post-run block of `broadcast-run/new-send.service.ts`.
   ⚠️ THERE ARE **TWO** CLEARERS OF THESE KEYS, AND THIS FILE IS ONLY ONE OF THEM.
   [FIX-20260901-CLEARROUTESTALE] This block used to read "THIS IS THE ONLY ROUTE
   THAT CLEARS THEM. Nothing else does, and nothing else should" — true when it
   was written (24/08) and FALSE since 27/08, when the close-case dialog gained
   its own per-member clear. The central registry has listed both ever since
   (`chat/config/member-config.registry.ts`, the `notice_*` CONSUMERS entry);
   this sentence simply never caught up, and it is the reason a reader can walk
   away believing a campaign is the only way a stamp can disappear.
     · THIS FILE — a multicast LINE accepted. Clears BOTH keys, always, for
       EVERY member reached. Automatic: no operator decides per person.
     · `tickets/patch-after-close.helper.ts` — the admin closes a case and ticks
       "ไม่ติดตาม" in the "การติดตามฝากถอน" section. Clears ONE key, for ONE
       member, and only the topic that was ticked. Deliberate, per person.
   Both are legitimate ends of the same fact: the stamp means "we told this
   member the bank is broken", and either the campaign told them otherwise or an
   admin decided this person no longer needs following. Neither knows about the
   other, and neither has to. สองทาง คนละเจตนา ไม่ต้องรู้จักกัน.
   ⚠️ IF A THIRD CLEARER IS EVER ADDED, update the registry's CONSUMERS entry in
   the SAME commit — `member-config.spec.ts` greps the code against that list and
   goes red when they drift. This comment is prose and has no such guard, which
   is exactly how it stayed wrong for five days.
   ⚠️ `follow_up.line.notice_payment_at` is deliberately NOT cleared here — the
   campaign does not speak about payments, so clearing it would claim we told
   them something we did not. ล้างเฉพาะเรื่องที่เราพูดถึงจริง.

   NOT CLEARED FOR EVERYONE TARGETED — only for members LINE actually accepted.
   A failed chunk reached nobody, and those people have not been told.*/

import { clearMemberConfigMany } from '../../chat/config';

/**
 * คีย์ที่แคมเปญนี้ล้าง
 *
 * 🔴 เขียนเป็นสตริง ไม่ import จาก `webhook/notice-runtime/notice.keys.ts`
 *    ด้วยเหตุผลเดียวกับที่ `customer-link` ทำ: `content/` กับ `webhook/` ต้องถอด
 *    ออกจากกันได้ ⇒ import ข้ามคือการมัดสองฟีเจอร์เข้าด้วยกัน
 *    ตัวกลางยังคุมอยู่: `clearMemberConfigMany` assert คีย์ ⇒ พิมพ์ผิดจะ throw
 *    ไม่ใช่ล้างพลาดเงียบ ๆ
 *    ⚠️ เปลี่ยนชื่อคีย์เมื่อไหร่ ต้อง grep **path** ไม่ใช่ชื่อ constant
 *
 * ⚠️ `notice_payment_at` **ไม่อยู่ในนี้** — แคมเปญบอกเรื่องฝาก/ถอน ไม่ได้บอกเรื่อง
 *    การชำระ การล้างป้ายที่แคมเปญไม่ได้พูดถึงคือการโกหกว่าเราบอกเขาไปแล้ว
 *    ล้างเฉพาะเรื่องที่เราพูดถึงจริง.
 */
export const MULTICAST_CLEARS_KEYS = [
  'follow_up.line.notice_deposit_at',
  'follow_up.line.notice_withdraw_at',
] as const;

export interface ClearNoticeInput {
  /** `line_user_id` ที่ LINE ตอบรับแล้วเท่านั้น */
  readonly lineUserIds: readonly string[];
}

export interface ClearNoticeResult {
  /** จำนวนแถวที่ถือคีย์นั้นอยู่จริงและถูกล้าง แยกตามคีย์ */
  readonly clearedByKey: Readonly<Record<string, number>>;
  /** `true` เมื่อมีคีย์ใดคีย์หนึ่งล้างไม่สำเร็จ — ตัวเรียกเอาไปลง log */
  readonly failed: boolean;
}

/**
 * ล้างป้ายแจ้งเตือนของคนที่ได้รับ multicast รอบนี้
 *
 * @returns จำนวนที่ล้างได้ต่อคีย์ · `0` เป็นเรื่องปกติ ไม่ใช่ความล้มเหลว —
 *   แคมเปญส่วนใหญ่ยิงหาคนที่ไม่เคยถูกประทับป้ายอยู่แล้ว
 */
export async function clearNoticeForReached(
  memberModel: Model<Record<string, unknown>>,
  input: ClearNoticeInput,
): Promise<ClearNoticeResult> {
  const ids = input.lineUserIds.filter(
    (id): id is string => typeof id === 'string' && id !== '',
  );
  /* ไม่มีใครได้รับ = ไม่มีอะไรให้ล้าง และต้องไม่ยิงคิวรี่เปล่า */
  if (ids.length === 0) return { clearedByKey: {}, failed: false };

  const clearedByKey: Record<string, number> = {};
  let failed = false;

  for (const key of MULTICAST_CLEARS_KEYS) {
    try {
      /**
       * ⚠️ FILTER เป็น `line_user_id` เพราะนั่นคือสิ่งเดียวที่ท่อส่งรู้จัก —
       *    LINE ตอบรับเป็น line user id ไม่ใช่ member `_id` การไปหา member id
       *    ก่อนคือคิวรี่เพิ่มอีกรอบเพื่อผลลัพธ์เดียวกัน
       * ⚠️ ไม่ใส่ `$exists` ในคิวรี่ — `updateMany` ข้ามแถวที่ไม่มี path นั้นอยู่แล้ว
       *    และ registry วัดไว้ว่า `$exists` ในคิวรี่ทำให้เสีย covered index
       */
      clearedByKey[key] = await clearMemberConfigMany(
        { line_user_id: { $in: ids } },
        key,
        { memberModel },
      );
    } catch {
      /* กลืนไว้ตรงนี้ — ดูเหตุผลที่หัวไฟล์ ตัวเรียกเป็นคน log */
      failed = true;
    }
  }

  return { clearedByKey, failed };
}

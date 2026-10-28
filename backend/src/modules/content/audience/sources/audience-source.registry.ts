/**
 * [FEAT-20260822-BCASTAUDSRC] Every field a broadcast may select members by.
 * ===========================================================================
 * 🔌 ADD A FIELD = ADD ONE ENTRY. Nothing else changes: not the filter builder,
 * not the runner, not the FE — the form reads this table through an endpoint.
 * REMOVE ONE = set `deprecated` (see the warning at the bottom).
 *
 * ⚠️ `indexed` was checked against the LIVE database on 2026-08-22, not against
 *    the schema file. `db.members.indexes()` is the truth; a schema line that
 *    declares an index proves only that someone intended one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 📖 BUILDING A CAMPAIGN? THREE THINGS THIS TABLE ALONE WILL NOT TELL YOU
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. WHAT EACH `follow_up.*` SOURCE ACTUALLY SELECTS — "still stuck" versus
 *      "was ever X". Only ONE of the six means the first. The block below the
 *      divider spells out which, and what picking the wrong one costs.
 *   2. THAT THE QUERY YOU BUILT IS NOT THE QUERY THAT RUNS. Three of these
 *      sources make `force-no-profile.policy.ts` AND `{raw_profile_data: null}`
 *      onto the WHOLE job, silently and by design. Same block.
 *   3. THAT "HAS NO PROFILE" IS NOT "NEVER REGISTERED". An admin can wipe a
 *      profile, and every "no profile" test in this codebase then reads that
 *      customer as unregistered — see the note beside `raw_profile_cleared_at`.
 *
 * 📖 The plain-language overview of the whole follow-up feature — what each
 * stamp means, which of the four screens shows it, and the counts taken from
 * the live database — is `docs/follow-up-status-spec.md`.
 * 📖 The law on the keys themselves (FLAG vs RECORD, who writes, who clears,
 * why a stamp is never a status) is
 * `src/modules/chat/config/member-config.registry.ts` — [DOC-20260825-REGSTATUS].
 *
 * revert: delete this file with the rest of `sources/`.
 */
import type { AudienceSource } from './audience-source.types';

const SOURCES = {
  /* ── follow-up timestamps: the "who is still stuck" questions ───────────
     🔴 [DOC-20260825-REGSTATUS] ONLY ONE OF THESE SIX ANSWERS "STILL".
     Owner, 25/08/2026: *"request_reg_at จะตรงไม่ถูก เคลียร์ ไม่ว่าจุดใด
     ถ้าเช็คว่าลงทะเบียนไปแล้วรึยัง ให้เช็คเพิ่มจาก raw profile data"*

       `follow_up.abandon_at`  — FLAG. Cleared the moment the customer
           registers, by both routes (webhook + customer-link). Selecting on it
           genuinely means "asked, and STILL has not done it". This is the
           source a register-me campaign should target.

       the other five  — RECORDS. They answer "was this customer ever X",
           never "is this customer still X". `request_reg_at` survives even an
           unlink; `customer_helper_at` is overwritten on every fresh offer but
           removed by nobody.
           ⚠️ TWO OF THEM DO HAVE A CLEARER, AND IT CHANGES NOTHING HERE.
           `notice_deposit_at` / `notice_withdraw_at` are cleared for every
           member a MULTICAST reached (a campaign announcing the bank works
           again ends the reason for the stamp — see
           `content/broadcast-follow-up/clear-notice-on-multicast.ts`). The
           trigger is an OUTGOING CAMPAIGN, never the customer doing anything,
           so their absence still means "never notified, OR notified and since
           told otherwise". มีคนล้าง ≠ เป็นธง.

     ── WHICH SOURCE FOR WHICH QUESTION, IN ONE TABLE ──────────────────────
       "who is STILL not registered"        → `follow_up.abandon_at`  (the FLAG)
       "who was EVER asked for details"     → `follow_up.request_reg_at`
       "who was EVER shown the register card" → `follow_up.customer_helper_at`
       "who was EVER told the bank is down" → the three `follow_up.notice_*`
     A RECORD is the right choice when the campaign's own wording is about the
     past ("you asked us about deposits last week…"). It is the wrong choice
     the moment the wording assumes the customer has NOT yet done something.

     ⚠️ THE FAILURE THIS CAUSES IS SILENT AND REACHES REAL PEOPLE. An audience
     built on `follow_up.request_reg_at` to chase non-registered customers will
     include everyone who registered months ago — the count looks plausible, the
     send succeeds, every log line is green, and paying customers are told to go
     and register. Nothing in this codebase can detect that; only the recipient
     notices.

     ⚠️ `raw_profile_data` IS STILL NOT A SELECTABLE SOURCE, AND SINCE 25/08 IT
     NO LONGER NEEDS TO BE FOR THESE THREE. An admin cannot type "and has no
     profile" into a rule — that column is deliberately absent from this table
     (its envelope belongs to the vendor; see the ⛔ RAW PROFILE PATHS block at
     the bottom). Instead `force-no-profile.policy.ts` ANDs
     `{raw_profile_data: null}` onto the WHOLE job whenever its rules mention
     `follow_up.abandon_at`, `follow_up.request_reg_at` or
     `follow_up.customer_helper_at`.
       · IT IS INVISIBLE FROM THE FORM. The admin sees the rules they typed; the
         query that runs carries one more clause. Preview counts and the send
         both go through the same builder, so the number shown is the number
         reached — but it will be SMALLER than a hand-written version of the
         same rules, and this is why.
       · IT IS ANDed AT THE OUTERMOST LEVEL, never merged into the rule object.
         Under `match: 'or'` a merged clause would become just another way to
         MATCH instead of a filter, and customers who DO have a profile would
         qualify rather than be excluded — the quietest failure this filter has.
       · SWITCHING IT OFF IS ONE BOOLEAN (`FORCE_NO_PROFILE_ENABLED`), and the
         moment it flips, those three campaigns start reaching registered
         customers again while the labels below still promise they do not.
         Nothing errors, nothing logs, and the affected group GROWS over time
         because the RECORDS behind it are never cleared. If it is ever turned
         off, the labels must be rewritten in the same commit.
     ⚠️ EVEN WITH THE FORCE ON, "no profile" IS NOT "never registered" — an
     admin can wipe a profile, and the wiped customer passes the forced clause
     exactly like someone who never signed up. The condition that would close
     that (`raw_profile_cleared_at: null`) is NOT wired; the manual close is one
     extra rule, described beside the `raw_profile_cleared_at` entry below.
     ⇒ DO NOT approximate any of this by combining two RECORD dates. Two "was
     ever" answers cannot add up to an "is still" answer.

     Full reasoning and the reference implementation of the pairing:
     `src/modules/chat/config/member-config.registry.ts` — [DOC-20260825-REGSTATUS]
     Human-readable overview: `docs/follow-up-status-spec.md`
     ─────────────────────────────────────────────────────────────────────── */

  'follow_up.abandon_at': {
    key: 'follow_up.abandon_at',
    /* [UI-20260825-REGLABELS] ป้ายเปลี่ยน 25/08 — ให้ตรงกับการ์ด "การติดตาม"
       ฝั่ง panel ขวา (`followStamps.ts` → ABANDON_ROW) คำเดียวกันเป๊ะ
       เหตุผล: แอดมินคนเดียวกันอ่านสองที่ ถ้าคำต่างกันจะนึกว่าเป็นคนละเงื่อนไข */
    label_th: 'เคยถูกชวนให้ลงทะเบียน แต่ยังไม่ลงทะเบียน',
    label_en: 'Was invited to register, still has not',
    path: 'config.follow_up.line.abandon_trigger_at',
    type: 'date',
    ops: ['lte', 'gte'],
    scope_by_hook: false,
    // partial index `config.follow_up.line.abandon_trigger_at_1`
    indexed: true,
  },
  'follow_up.request_reg_at': {
    key: 'follow_up.request_reg_at',
    /* [UI-20260825-REGLABELS] ป้ายเปลี่ยน 25/08
       ⚠️ ป้ายนี้ต้องอ่านแล้วไม่สับสนกับ `follow_up.abandon_at` ด้านบน — สองอันนี้
          ตอบคนละคำถาม และเลือกผิดจะยิงโดนคนละกลุ่ม:
            abandon_at    = FLAG · คนที่**ยังค้างอยู่จริง**ตอนนี้ (สมัครแล้วหลุดออกเอง)
            request_reg_at = RECORD · **เคย**ถูกขอข้อมูล ไม่มีใครลบ ⇒ คนที่สมัคร
                             ไปแล้วก็ยังติดอยู่ในกลุ่มนี้ตลอดไป
          ⇒ แคมเปญชวนสมัครต้องใช้ `abandon_at` · ตัวนี้ใช้ตอนอยากรู้ "เคยขอไปแล้วกี่คน" */
    label_th: 'ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน',
    label_en: 'Customer details were requested',
    path: 'config.follow_up.line.request_reg_at',
    type: 'date',
    ops: ['lte', 'gte'],
    scope_by_hook: false,
    indexed: true,
  },
  /* [FEAT-20260825-HELPERTRIGGER] เวลาที่เสนอ customer-helper (การ์ด/ปุ่มชวนผูก
     ข้อมูล) ครั้งล่าสุด · ROLLING — ทับทุกครั้งที่เสนอ ไม่มีใครลบ

     ── ค่านี้มาจากไหน (ก่อนจะเชื่อผลของตัวกรอง ต้องรู้ข้อนี้ก่อน) ──────────────
     เขียนโดยเส้นทาง reply ของ webhook ผ่าน
     `webhook/follow-up/customer-helper-trigger.helper.ts` (ตัวเขียนตัวเดียวในระบบ)
     และเขียน **ต่อเมื่อ customer-helper ไปถึงลูกค้าจริง** — LINE ตอบรับแล้วเท่านั้น
     ⇒ มี stamp = ลูกค้าเห็นข้อเสนอนั้นจริง · ส่งไม่ผ่าน = ไม่มี stamp
     เงื่อนไขว่า "ตอนไหนถึงประทับ" เป็น predicate เดียวที่แก้ได้อิสระ อยู่ที่
     `webhook/follow-up/customer-helper-trigger.rule.ts` — **เปลี่ยนตรงนั้นเมื่อไหร่
     กลุ่มผู้รับของ source นี้เปลี่ยนตามทันที** โดยที่ไฟล์นี้ไม่รู้เรื่องเลย
     เช่น ถ้าใครเปลี่ยนไปนับตอน "ตั้งใจจะส่ง" แทน "ส่งสำเร็จ" วันที่ LINE ปฏิเสธเป็นชุด
     จะได้คนกลุ่มใหญ่ที่ถูกประทับว่าได้รับการ์ดทั้งที่จอเขาไม่เคยขึ้นอะไร

     🔴 `path` ข้างล่างคือ **สตริงจุด** ที่ไม่มีตัว compiler ตัวไหนตรวจให้
        ฝั่ง `webhook/` ประกาศคีย์นี้เป็นค่าคงที่ แต่ที่นี่พิมพ์เป็นสตริง (ตั้งใจ —
        `content/` กับ `webhook/` ต้องถอดออกจากกันได้) ⇒ เปลี่ยนชื่อคีย์ที่โน่นแล้ว
        ตัวกรองนี้จะ **พังเงียบ**: ไม่มี error ไม่มีผลลัพธ์ว่าง ๆ ให้สงสัย มีแต่
        แคมเปญที่ยิงไม่โดนใคร · ก่อนแตะคีย์ ให้ grep สตริงจุด
        `follow_up.line.customer_helper_trigger_at` **ทั้งสอง repo**
        (`omnidesk-api` และ `omnidesk-console` — ฝั่ง FE ก็อ่านด้วย path เดียวกัน)

     ⚠️ เป็น RECORD ไม่ใช่ FLAG เหมือนอีกสี่ตัวในหมวดนี้ ⇒ ตอบว่า "เคยถูกเสนอ"
        ไม่ใช่ "ยังไม่ผูกข้อมูล" · ลูกค้าที่ผูกไปแล้วก็ยังติดอยู่ในกลุ่มนี้
        ⇒ แคมเปญที่อยากได้เฉพาะคนที่ยังไม่ผูก **ห้ามใช้ตัวนี้เดี่ยว ๆ**
        ให้ใช้ `follow_up.abandon_at` ซึ่งเป็น FLAG และถูกเคลียร์ตอนสมัคร
        (ดูบล็อก [DOC-20260825-REGSTATUS] ที่หัวหมวดนี้)
     ป้ายตรงกับการ์ด "การติดตาม" ฝั่ง FE เป๊ะ — มีเทสกันหลุด */
  /* [FEAT-20260827-FORCENOFOLLOWUP] 🔴 คิวรี่ของ source นี้ **มีอีกสอง clause**
     ที่ไม่ได้มาจากกฎที่แอดมินพิมพ์ · เจ้าของ 27/08: เข้าเงื่อนไขนี้ได้ต้องเป็นคนที่
     **ยังไม่เคยถูกตาม** ⇒ `force-no-follow-up.policy.ts` AND เพิ่มให้อัตโนมัติ
         config.follow_up.line.abandon_trigger_at   ต้องไม่มีค่า
         config.follow_up.line.request_reg_at       ต้องไม่มีค่า
     ⇒ รวมกับ `force-no-profile.policy.ts` ข้างบน = source นี้เป็นตัวเดียวในทะเบียน
       ที่ถูกบังคับจาก **สองนโยบาย** พร้อมกัน · จำนวนผู้รับจะน้อยกว่าที่กฎบนจอบอกเสมอ
     ⭐ มันประกอบเป็นวงจรกับ `broadcast-follow-up/stamp-abandon-on-multicast.ts`:
       multicast ที่ใช้ตัวกรองนี้และไม่ติ๊ก "เปิดเคส" จะปักธง `abandon_trigger_at`
       ให้ทุกคนที่ยิงถึง ⇒ **รอบถัดไปคนกลุ่มนั้นหลุดออกเอง** = ตามครั้งเดียว ไม่ทวงซ้ำ
     ⚠️ ปิดนโยบายนั้นเมื่อไหร่ ป้ายข้างล่างจะเริ่มโกหกทันทีโดยไม่มีอะไรเตือน */
  'follow_up.customer_helper_at': {
    key: 'follow_up.customer_helper_at',
    label_th: 'ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน',
    label_en: 'Was shown the register card, still has not registered',
    path: 'config.follow_up.line.customer_helper_trigger_at',
    type: 'date',
    /* ⚠️ `no_value` จงใจ **ไม่** เปิดที่นี่ ทั้งที่ระบบมี op นั้นแล้ว
       เหตุผล: `indexed` เป็น boolean ตัวเดียวคุมทุก op และฟอร์มเอาไปโชว์คำเตือน
       "ช้า" (`AudienceRuleBuilder.tsx`) · สาม op ที่เปิดไว้ใช้ index ได้จริงทั้งหมด
       (วัดแล้ว: range → IXSCAN · `has_value` = `{$ne:null}` → FETCH ← IXSCAN)
       แต่ `no_value` = `{path:null}` เป็น COLLSCAN เสมอ ⇒ เปิดมันที่นี่แล้วตั้ง
       `indexed: true` = โกหก · ตั้ง `false` ก็โกหกอีกทางกับอีกสาม op
       ⇒ เปิดเฉพาะ op ที่ flag พูดความจริงได้ครบ
       ถ้าวันหนึ่งต้องการ "คนที่ไม่เคยถูกเสนอเลย" จริง ๆ: เติม `'no_value'` ตรงนี้
       **แล้วต้องเปลี่ยน `indexed` เป็น `false` พร้อมกัน** ไม่งั้นแอดมินจะโดนหลอก
       (ตัวอย่างที่ทำแบบนั้นไว้แล้ว: `raw_profile_cleared_at` ด้านบน) */
    /* [UI-20260825-LOCKHASVALUE] 🔒 ล็อคไว้ที่ "มีค่า" อย่างเดียว
       เจ้าของ 25/08: *"ได้รับการ์ด ... ต้องล็อค มีค่า"*

       เหตุผลที่ล็อคเฉพาะกลุ่มนี้: stamp พวกนี้เป็น **ROLLING — ทับค่าใหม่ทุกครั้ง**
       ที่ส่งการ์ด/แจ้งเตือนอีกใบ ⇒ ช่วงเวลาบนค่าที่ขยับได้เปลี่ยนความหมายไปเอง
       คนที่เคยเข้าเกณฑ์ "ก่อน 16:07" จะหลุดออกทันทีที่ถูกส่งซ้ำ
       ⚠️ เกิดขึ้นจริงแล้ว 25/08: งาน "ชวนลงทะเบียน" ตั้ง `lte 16:07` แต่ member
          ถูกประทับ 16:26 ⇒ ผู้รับ 0 คน ⇒ `refused-plan: empty`
       ⚠️ `abandon_at` / `request_reg_at` **ไม่ถูกล็อค** เพราะเขียนครั้งเดียวแล้วนิ่ง
          (`writeMemberConfigOnce`) ⇒ ช่วงเวลามีความหมายคงที่ และ "ค้างมาเกิน N วัน"
          เป็นแคมเปญที่ตั้งใจรองรับมาแต่แรก
       ⚠️ `indexed: true` ยังจริงอยู่ — `has_value` = `{$ne: null}` ซึ่งวัดแล้วใช้
          index ได้ (FETCH ← IXSCAN) · ต่างจาก `no_value` ที่เป็น COLLSCAN
          ⇒ ถ้าวันหนึ่งเติม `'no_value'` ต้องเปลี่ยน `indexed` เป็น false พร้อมกัน
       revert: คืน `'lte', 'gte'` กลับเข้า ops ของ 4 ตัวนี้ */
    ops: ['has_value'],
    scope_by_hook: false,
    indexed: true,
  },
  'follow_up.notice_deposit_at': {
    key: 'follow_up.notice_deposit_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องฝาก',
    label_en: 'Was notified about deposits',
    path: 'config.follow_up.line.notice_deposit_at',
    type: 'date',
    /* [UI-20260825-LOCKHASVALUE] 🔒 ล็อคไว้ที่ "มีค่า" อย่างเดียว
       เจ้าของ 25/08: *"ได้รับการ์ด ... ต้องล็อค มีค่า"*

       เหตุผลที่ล็อคเฉพาะกลุ่มนี้: stamp พวกนี้เป็น **ROLLING — ทับค่าใหม่ทุกครั้ง**
       ที่ส่งการ์ด/แจ้งเตือนอีกใบ ⇒ ช่วงเวลาบนค่าที่ขยับได้เปลี่ยนความหมายไปเอง
       คนที่เคยเข้าเกณฑ์ "ก่อน 16:07" จะหลุดออกทันทีที่ถูกส่งซ้ำ
       ⚠️ เกิดขึ้นจริงแล้ว 25/08: งาน "ชวนลงทะเบียน" ตั้ง `lte 16:07` แต่ member
          ถูกประทับ 16:26 ⇒ ผู้รับ 0 คน ⇒ `refused-plan: empty`
       ⚠️ `abandon_at` / `request_reg_at` **ไม่ถูกล็อค** เพราะเขียนครั้งเดียวแล้วนิ่ง
          (`writeMemberConfigOnce`) ⇒ ช่วงเวลามีความหมายคงที่ และ "ค้างมาเกิน N วัน"
          เป็นแคมเปญที่ตั้งใจรองรับมาแต่แรก
       ⚠️ `indexed: true` ยังจริงอยู่ — `has_value` = `{$ne: null}` ซึ่งวัดแล้วใช้
          index ได้ (FETCH ← IXSCAN) · ต่างจาก `no_value` ที่เป็น COLLSCAN
          ⇒ ถ้าวันหนึ่งเติม `'no_value'` ต้องเปลี่ยน `indexed` เป็น false พร้อมกัน
       revert: คืน `'lte', 'gte'` กลับเข้า ops ของ 4 ตัวนี้ */
    ops: ['has_value'],
    scope_by_hook: false,
    indexed: true,
  },
  'follow_up.notice_withdraw_at': {
    key: 'follow_up.notice_withdraw_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องถอน',
    label_en: 'Was notified about withdrawals',
    path: 'config.follow_up.line.notice_withdraw_at',
    type: 'date',
    /* [UI-20260825-LOCKHASVALUE] 🔒 ล็อคไว้ที่ "มีค่า" อย่างเดียว
       เจ้าของ 25/08: *"ได้รับการ์ด ... ต้องล็อค มีค่า"*

       เหตุผลที่ล็อคเฉพาะกลุ่มนี้: stamp พวกนี้เป็น **ROLLING — ทับค่าใหม่ทุกครั้ง**
       ที่ส่งการ์ด/แจ้งเตือนอีกใบ ⇒ ช่วงเวลาบนค่าที่ขยับได้เปลี่ยนความหมายไปเอง
       คนที่เคยเข้าเกณฑ์ "ก่อน 16:07" จะหลุดออกทันทีที่ถูกส่งซ้ำ
       ⚠️ เกิดขึ้นจริงแล้ว 25/08: งาน "ชวนลงทะเบียน" ตั้ง `lte 16:07` แต่ member
          ถูกประทับ 16:26 ⇒ ผู้รับ 0 คน ⇒ `refused-plan: empty`
       ⚠️ `abandon_at` / `request_reg_at` **ไม่ถูกล็อค** เพราะเขียนครั้งเดียวแล้วนิ่ง
          (`writeMemberConfigOnce`) ⇒ ช่วงเวลามีความหมายคงที่ และ "ค้างมาเกิน N วัน"
          เป็นแคมเปญที่ตั้งใจรองรับมาแต่แรก
       ⚠️ `indexed: true` ยังจริงอยู่ — `has_value` = `{$ne: null}` ซึ่งวัดแล้วใช้
          index ได้ (FETCH ← IXSCAN) · ต่างจาก `no_value` ที่เป็น COLLSCAN
          ⇒ ถ้าวันหนึ่งเติม `'no_value'` ต้องเปลี่ยน `indexed` เป็น false พร้อมกัน
       revert: คืน `'lte', 'gte'` กลับเข้า ops ของ 4 ตัวนี้ */
    ops: ['has_value'],
    scope_by_hook: false,
    indexed: true,
  },
  'follow_up.notice_payment_at': {
    key: 'follow_up.notice_payment_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องการชำระ',
    label_en: 'Was notified about payments',
    path: 'config.follow_up.line.notice_payment_at',
    type: 'date',
    /* [UI-20260825-LOCKHASVALUE] 🔒 ล็อคไว้ที่ "มีค่า" อย่างเดียว
       เจ้าของ 25/08: *"ได้รับการ์ด ... ต้องล็อค มีค่า"*

       เหตุผลที่ล็อคเฉพาะกลุ่มนี้: stamp พวกนี้เป็น **ROLLING — ทับค่าใหม่ทุกครั้ง**
       ที่ส่งการ์ด/แจ้งเตือนอีกใบ ⇒ ช่วงเวลาบนค่าที่ขยับได้เปลี่ยนความหมายไปเอง
       คนที่เคยเข้าเกณฑ์ "ก่อน 16:07" จะหลุดออกทันทีที่ถูกส่งซ้ำ
       ⚠️ เกิดขึ้นจริงแล้ว 25/08: งาน "ชวนลงทะเบียน" ตั้ง `lte 16:07` แต่ member
          ถูกประทับ 16:26 ⇒ ผู้รับ 0 คน ⇒ `refused-plan: empty`
       ⚠️ `abandon_at` / `request_reg_at` **ไม่ถูกล็อค** เพราะเขียนครั้งเดียวแล้วนิ่ง
          (`writeMemberConfigOnce`) ⇒ ช่วงเวลามีความหมายคงที่ และ "ค้างมาเกิน N วัน"
          เป็นแคมเปญที่ตั้งใจรองรับมาแต่แรก
       ⚠️ `indexed: true` ยังจริงอยู่ — `has_value` = `{$ne: null}` ซึ่งวัดแล้วใช้
          index ได้ (FETCH ← IXSCAN) · ต่างจาก `no_value` ที่เป็น COLLSCAN
          ⇒ ถ้าวันหนึ่งเติม `'no_value'` ต้องเปลี่ยน `indexed` เป็น false พร้อมกัน
       revert: คืน `'lte', 'gte'` กลับเข้า ops ของ 4 ตัวนี้ */
    ops: ['has_value'],
    scope_by_hook: false,
    indexed: true,
  },

  /* ── presence questions: "มีค่านี้ไหม" ───────────────────────────────────
     [FEAT-20260825-HASVALUE] สอง operator ที่ถามว่า "มีค่าไหม" ไม่ใช่ "ค่าเท่าไหร่"
     สร้าง clause ที่ `audience-filter.ts` → `clauseFor`:

         has_value  →  { <path>: { $ne: null } }
         no_value   →  { <path>: null }

     ⭐ **ตอบคำถามเรื่องการมีอยู่โดยไม่ใช้ `$exists` เลย** ซึ่งจำเป็น เพราะระบบ
        audience **ห้าม `$exists` ในคิวรี่** (คำสัญญาอยู่หัวไฟล์ `audience-filter.ts`
        และมีเทส assert ไว้ · เหตุผลที่วัดมาแล้วอยู่ใน STEP 6 ของ
        `chat/config/member-config.registry.ts` — `$exists` ทำให้ covered read
        กลายเป็น FETCH แล้วอ่านทุก document)
        ใน MongoDB การ match กับ `null` เปล่า ๆ จับได้ทั้ง **ไม่มี field** และ
        **null จริง** อยู่แล้ว ⇒ ครอบคำถามครบโดยไม่ต้องถามซ้ำ
     ⚠️ `rule.value` ถูก **ละทิ้ง** ในสอง op นี้ (คำถามไม่มีค่ามาด้วย) ⇒ กฎที่ถือค่า
        ค้างจาก operator เดิมก็ยัง build ผ่าน ไม่ต้องล้างค่าก่อน

     ── ราคาที่วัดจริงบนฐานจริง 25/08/2026 · สองทิศไม่เท่ากันเลย ──────────────
         has_value  `{$ne: null}`  →  FETCH ← IXSCAN · keysExamined 1
         no_value   `{path: null}` →  COLLSCAN ทั้งคอลเลกชัน
     **ไม่มี index ตัวไหนช่วยทิศที่สองได้** และนั่นเป็นคุณสมบัติของ *คำถาม* ไม่ใช่
     ของ index: การพิสูจน์ว่า field ไม่มีอยู่ ต้องเปิดอ่านทุก document
     ⇒ อย่าไปเพิ่ม index หวังแก้ · อย่าใส่ `default` ให้คอลัมน์หวังช่วย (จะยิ่งทำให้
       partial index กินทั้งคอลเลกชันแทนที่จะกินไม่กี่แถว)

     ── 🔴 `indexed` เป็น boolean **ตัวเดียว** คุมทุก op ของ source นั้น ────────
     ฟอร์ม (`AudienceRuleBuilder.tsx`) เอาค่านี้ไปโชว์คำเตือน "ช้า" ⇒ ถ้า source
     เปิดทั้งทิศที่เร็วและทิศที่ช้า จะไม่มีค่าไหนพูดความจริงได้ครบ · ของจริงในไฟล์นี้
     ตัดสินไปคนละทางอย่างตั้งใจ ทั้งคู่ถูกทั้งคู่:
       · `raw_profile_cleared_at` เปิด `no_value` ซึ่งเป็นทิศที่คนจะใช้จริง ⇒
         ประกาศ `indexed: false` ทั้งที่ **มี** partial index อยู่จริง (ดูคอมเมนต์
         ของ entry นั้น) — พูดความจริงเรื่องคิวรี่ที่แอดมินกำลังจะยิง
       · `follow_up.customer_helper_at` **ไม่เปิด** `no_value` เลย ⇒ ทุก op ที่เปิด
         ใช้ index ได้จริงหมด `indexed: true` จึงไม่โกหก
         ⚠️ วันไหนเติม `'no_value'` ให้ source นั้น **ต้องพลิก `indexed` เป็น false
            ในการแก้ครั้งเดียวกัน** ไม่งั้นฟอร์มจะบอกแอดมินว่าเร็วทั้งที่เป็น COLLSCAN

     ⚠️ กับดักตอนเพิ่ม op ใหม่: `clauseFor` มี `default: return null` ⇒ เติม op ลงใน
        `ops` ของ entry แล้วลืมเขียน `case` ให้มัน **จะไม่ compile error**
        งานจะเซฟผ่านตามปกติ แล้วไปโดนปฏิเสธเอาตอนส่ง ("cannot be used with")
        ซึ่งเป็น fail-closed ที่ถูกต้อง แต่ไกลจากจุดที่พิมพ์ผิดมาก — แก้ทั้งสองที่เสมอ
     ─────────────────────────────────────────────────────────────────────── */

  /* [FEAT-20260825-HASVALUE] Written only when an admin wipes a customer's
     profile through the developer-only remove button (`chat/members.service.ts`
     → `clearRawProfile`), in the same atomic write as the wipe itself.

     ⚠️ `indexed: false` AND THAT IS THE HONEST ANSWER, not an oversight.
     A partial index on this column DOES exist (`member.schema.ts`), and the
     "has a value" direction really does use it — measured 25/08/2026,
     `FETCH ← IXSCAN` with keysExamined 1. But the direction this source was
     ASKED FOR is the other one: find the customers with no value. That plans
     COLLSCAN over the whole collection and no index can change it, because
     proving a field is absent means reading every document. `indexed` is a
     single boolean covering both operators, and `AudienceRuleBuilder.tsx` shows
     the form's "slow" warning from it — so `true` would tell an admin that the
     query they are actually about to run is fast when it is not.

     ⚠️ NOT a registration-status filter. A customer can be cleared and register
     again; this only says a wipe happened at some point. "Has this customer
     registered?" is `raw_profile_data`, which is NOT exposed here — see
     [DOC-20260825-REGSTATUS] in `chat/config/member-config.registry.ts`.

     ⭐ WHAT IT IS GOOD FOR, THOUGH: IT IS THE ONLY WAY TO CLOSE THE WIPE HOLE
     TODAY, AND IT IS A MANUAL ONE. Every "has no profile" test in this codebase
     — including the clause `force-no-profile.policy.ts` forces onto the three
     register-chasing sources — reads a WIPED customer exactly like somebody who
     never signed up. So a campaign saying "you were shown the register card and
     still have not registered" reaches people who DID register and then had
     their profile removed by an admin.
       ⇒ ADD A SECOND RULE TO THAT CAMPAIGN: this source with `no_value`,
         alongside the follow-up rule. It builds `{raw_profile_cleared_at: null}`,
         which matches BOTH a missing field and an explicit null — i.e. exactly
         "was never wiped" — and needs no `$exists`.
       ⇒ MEANING WITH BOTH RULES: "no profile BECAUSE THEY NEVER REGISTERED, not
         because somebody wiped it."
       ⚠️ It is a COLLSCAN (see the presence-operator block above) and it must be
         remembered every single time. Wiring it into the forced clause instead
         is one key in `NO_PROFILE_CLAUSE`; the trade-off is written out in that
         policy file's header and has NOT been taken.
       ⚠️ It is also not free of meaning: a customer wiped and then registered
         again keeps this stamp for ever, so the strict pair would exclude them
         if they later unlink and genuinely become unregistered. There is no
         single column that answers both.

     revert: delete this entry (live jobs referencing it would then be refused
     at send time, which is the intended failure — set `deprecated: true`
     instead if any job still names it). */
  raw_profile_cleared_at: {
    key: 'raw_profile_cleared_at',
    label_th: 'เคยถูกล้างข้อมูลโปรไฟล์',
    label_en: 'Profile data was wiped',
    path: 'raw_profile_cleared_at',
    type: 'date',
    ops: ['has_value', 'no_value'],
    scope_by_hook: false,
    indexed: false,
  },

  /* ── plain columns: the "who are they" questions ──────────────────────── */

  first_ticket_at: {
    key: 'first_ticket_at',
    label_th: 'เปิดเคสครั้งแรกเมื่อ',
    label_en: 'First ticket opened at',
    path: 'first_ticket_at',
    type: 'date',
    ops: ['lte', 'gte'],
    scope_by_hook: false,
    indexed: true,
  },
  /* ⛔ THE VEHICLE-REGISTRATION COLUMN IS DELIBERATELY ABSENT. อย่าเพิ่งใส่กลับ.
   *
   * `members` already carries it, with a partial multikey index, so it LOOKS
   * ready. It is not: a spec in `z-test/unit/` guards a promise that **no code
   * outside `member.schema.ts` names that column yet**, because the owner asked
   * for it ahead of the feature that fills it. Registering it here turned that
   * spec red — correctly.
   *
   * ⚠️ This block avoids writing the column's name at all, even in prose: that
   * guard greps every .ts file under `src/` for the bare word, so even a
   * COMMENT that mentions it is
   * a hit exactly like real code. คอมเมนต์ก็โดนนับ — เลยเลี่ยงไม่พิมพ์ชื่อคอลัมน์.
   *
   * The real cost is worse than a red test. With no writer, no row carries a
   * value, so an admin who picks "ทะเบียนรถ" builds a filter matching NOBODY —
   * a campaign that reports success and reaches zero people, with no error
   * anywhere. ตัวกรองที่ชี้ไปคอลัมน์ที่ยังไม่มีใครเขียน = ส่งไม่ถึงใครแบบเงียบ ๆ.
   *
   * TO ADD IT LATER — this is exactly what the registry is for: ONE entry here,
   * no other file changes:
   *   1. confirm a writer exists and real rows carry values — open a row, do
   *      not trust the schema (dev-local §4);
   *   2. add the entry with `type: 'string[]'`, `ops: ['in', 'contains']`,
   *      `scope_by_hook: false`, `indexed: true`;
   *   3. grow that guarding spec to cover the writer, as its own comment asks —
   *      it belongs to another lane, so ask its owner first.
   */
  display_name: {
    key: 'display_name',
    label_th: 'ชื่อที่ตั้งใน LINE',
    label_en: 'LINE display name',
    path: 'display_name',
    type: 'string',
    ops: ['eq', 'in'],
    scope_by_hook: false,
    indexed: true,
  },
  full_name: {
    key: 'full_name',
    label_th: 'ชื่อจริง (จากการผูกบัญชี)',
    label_en: 'Real name',
    path: 'full_name',
    type: 'string',
    ops: ['eq', 'in'],
    scope_by_hook: false,
    indexed: true,
  },
  phone_number: {
    key: 'phone_number',
    label_th: 'เบอร์โทร',
    label_en: 'Phone number',
    path: 'phone_number',
    type: 'string',
    ops: ['eq', 'in'],
    scope_by_hook: false,
    indexed: true,
  },

  /* ── membership tier: the "which grade of customer" questions ─────────── */
  /**
   * [FEAT-20260824-BCASTAUDTIER] เจ้าของ 24/08: "อนาคตจะมี tier + อื่น ๆ อีก".
   *
   * 🔑 WHY `tier.*` AND NOT THE SAME VALUE INSIDE THE RAW BLOB. The identical
   * numbers sit at `raw_profile_data.data.profile.tier.code` on a real row, and
   * pointing here would be one character shorter. It would also be wrong:
   * `member.schema.ts:61-71` says `tier` was normalised OUT of the blob
   * precisely "so it can be queried … the raw blob has a different shape per
   * vendor and cannot be filtered on". `tier` is OUR shape; the blob is the
   * customer's API's shape. ค่าเดียวกัน แต่ `tier` เป็นรูปของเรา — คิวรี่ได้จริง.
   *
   * 🔴 PROVEN ON A REAL ROW, not on the schema. `members._id
   * a0d000000000000000000006` (dev, 2026-08-24) carries
   *   tier: { code: 'normal', name: 'Normal', level: 0, raw: {…}, updated_at }
   * and the writer is `custom-tool.service.ts:1418` — `extractTier()` builds
   * exactly that object and the very next line `$set`s it. `code` and `name`
   * both come back through `asText()`, so both are always STRINGS.
   *
   * ⚠️ 23 of 25 rows hold `tier: null` — a member is only tiered once a profile
   *    fetch has succeeded for them. A tier rule therefore selects "linked
   *    customers of this grade", never "everyone". That is the right meaning,
   *    but an admin expecting the whole OA will see a small number and should.
   *    ยังไม่เคยดึงโปรไฟล์ = ไม่มี tier — ตัวเลขจะน้อยกว่าที่คิด และนั่นถูกแล้ว.
   */
  'tier.code': {
    key: 'tier.code',
    /* [UI-20260828-TIERLABEL] ป้ายอย่างเดียว — ตัวคีย์ ตัวกรอง และค่าที่เก็บ
       ไม่ถูกแตะสักตัว · เจ้าของ 28/08: คำว่า "รหัส" บนจอทำให้เข้าใจว่าต้องกรอก
       รหัสอะไรสักอย่าง ทั้งที่สิ่งที่เลือกคือระดับสมาชิก ⇒ ใช้คำที่ตรงกับสิ่งที่เห็น
       ⚠️ `key` ยังเป็น `tier.code` เหมือนเดิม — แคมเปญที่เซฟไว้แล้วอ่านได้ปกติ */
    label_th: 'ระดับสมาชิก (ระดับ)',
    label_en: 'Membership tier (level)',
    /* [FEAT-2708-TIERWHERE] เจ้าของ 27/08 (งาน 5.5): WHERE ใช้ code จาก **raw
       profile** — "เพื่อไปหา response.data.profile.tier.x ...ห้ามเดา" · เทียบ
       ข้อมูลจริงแล้ว: blob จับ 3/18 = ตรงกับป้าย tier บนจอ (memberTier.ts อ่าน
       raw-first) · normalized `tier.code` จับ 2/18 (เฉพาะคน profile fetch สำเร็จ)
       ⚠️ คำเตือนเดิมของ entry นี้ (envelope ของ blob ต่างตามเจ้า — raw-blob.reader
          ลองสี่รูป) ยังจริง: สมาชิกจากเจ้าที่ห่อ envelope อื่นจะไม่ติด WHERE นี้
          — แลกกับการตรงจอ ซึ่งเจ้าของเลือกแล้ว
       · ถอยกลับ normalized = คืน path เป็น 'tier.code' บรรทัดเดียว + flip spec
       · สลับไป match ด้วย LEVEL (เจ้าของสั่ง note ไว้): เพิ่ม entry ใหม่
         `tier.level` → path 'raw_profile_data.data.profile.tier.level',
         type 'number', ops eq/in (เปิด lte/gte ได้เพราะเป็นตัวเลข) แล้วให้
         TierValuePicker ฝั่ง FE ส่ง `level` จาก tierOptions แทน `code` */
    path: 'raw_profile_data.data.profile.tier.code',
    /**
     * A scalar string, so `eq`/`in` and nothing else.
     *
     * 🔴 `lte`/`gte` ARE DELIBERATELY ABSENT even though "tier at least X" is an
     * obvious wish. `audience-filter.ts` routes BOTH of them through
     * `parseAdminTime`, i.e. every range in this system is a DATE range. Offered
     * here it would build `{ 'tier.code': { $gte: <a Date> } }` against a string
     * column — no error, no match, a campaign that reaches nobody.
     * ช่วง = ช่วงเวลาเท่านั้นในไฟล์นี้ ใส่กับ string แล้วจะเงียบ ๆ ไม่โดนใคร.
     *
     * `contains` is also absent: it is the array-field operator, and this is one
     * value per member.
     */
    type: 'string',
    ops: ['eq', 'in'],
    // members carries no hook_id — narrowing still happens through chat_rooms.
    scope_by_hook: false,
    /**
     * 🔴 NO INDEX EXISTS. `db.members.getIndexes()` on 2026-08-24 returns 14
     * entries and not one of them names `tier`. Declaring `true` here would hide
     * a collection scan behind a green dropdown; `false` makes the UI say "this
     * will be slow", which is the truth. ไม่มี index จริง ๆ — ต้องบอกให้เห็น.
     */
    indexed: false,
  },
  'tier.name': {
    key: 'tier.name',
    label_th: 'ระดับสมาชิก (ชื่อที่แสดง)',
    label_en: 'Membership tier (display name)',
    path: 'tier.name',
    type: 'string',
    /* Same reasoning as `tier.code` above: a scalar string, so `eq`/`in` only. */
    ops: ['eq', 'in'],
    scope_by_hook: false,
    /* No `tier` index of any kind — verified against the live db, see above. */
    indexed: false,
  },
  /* ── customer tags: the "which admin label do they carry" question ────── */
  /**
   * [FEAT-20260824-BCASTTAGPRE] เจ้าของ 24/08: *"เพิ่ม ท่อ สามารถเลือกเป้าหมาย จาก
   * customer tag ได้ด้วย ว่า member คนไหนใช้ tag นี้"* · *"customer_tags เดิมมันจะ
   * ลิงก์กันใช่ไหม + crud ต้องมาลิงก์หมด"*.
   *
   * 🔑 `path: '_id'` AND THAT IS NOT A TYPO. Every other entry names a column on
   * `members`; a tag is not on `members` at all (checked on all 25 dev rows) and
   * never will be — see the ⛔ block below for why stamping it there was
   * rejected. Instead the rule is PRE-RESOLVED: `audience/prefilter/` reads
   * `customer_tags` and replaces this rule's VALUE — tag ids in, member ids out
   * — before `buildAudienceFilter` ever sees it. By the time this entry is read,
   * the value really is a list of member ids, so `_id` is the honest path.
   * ตัวช่วยแปลงค่าให้ก่อน ⇒ พอถึงตรงนี้ค่าที่อยู่ในกฎคือ member id จริง ๆ.
   *
   * 🔴 THE VALUE IS A `tags._id`, NOT A LABEL — that is the link to the existing
   * tag CRUD the owner asked about. `tag.schema.ts:11-15` records that the label
   * used to be copied onto every join row and that it was wrong: two groups'
   * "VIP" collapsed into one, and renaming meant rewriting every row. Targeting
   * by id means a rename leaves every saved campaign pointing at the same tag.
   *
   * ⚠️ WITHOUT THE PRE-STEP THIS ENTRY MATCHES NOBODY. A caller that builds a
   * filter from a raw `customer_tag` rule gets `{_id: {$in: [<tag ids>]}}` —
   * valid, silent, and empty. `new-send.service.ts` runs the pre-step for both
   * of its filter builds; anything new that builds one must too.
   * ลืมเรียก pre-step = ยิงไม่โดนใครแบบเงียบ ๆ.
   *
   * ⚠️ `scope_by_hook: false` even though `customer_tags` DOES carry `hook_id`.
   * That column is provenance and defaults to `null`
   * (`customer-tag.schema.ts:15-19`: "never a visibility filter"), so narrowing
   * on it would silently drop rows. The OA narrowing happens where it always
   * does — `chat_rooms`, in the recipient pager. hook_id เป็นที่มา ไม่ใช่ตัวกรอง.
   */
  customer_tag: {
    key: 'customer_tag',
    label_th: 'ป้ายกำกับลูกค้า (customer tag)',
    label_en: 'Customer tag',
    /* Set by the pre-step; see the block above before changing it. */
    path: '_id',
    type: 'string',
    /* One tag or several. No `contains`: the value is a scalar tag id, and no
       range — `lte`/`gte` in this builder are DATE ranges only. */
    ops: ['eq', 'in'],
    scope_by_hook: false,
    /**
     * Both halves are indexed, verified on the live database 2026-08-24 with
     * explain executionStats:
     *   `customer_tags.find({tag_id})` → IXSCAN `tag_id_1`, keys 3, docs 3, 0ms
     *   `members.find({_id: {$in: […]}})` → IXSCAN `_id_`
     * No index was added for this feature. ไม่ได้เพิ่ม index ใหม่.
     */
    indexed: true,
  },
} satisfies Record<string, AudienceSource>;

/**
 * [FEAT-20260824-BCASTAUDTIER] ⛔ WHAT THE OWNER ASKED FOR THAT IS NOT ABOVE.
 * ===========================================================================
 * เจ้าของ 24/08 asked for four more ways to pick an audience. Three of them are
 * now an entry above; the rest are NOT, and inventing a key for those would
 * produce a filter that quietly matches nobody. คีย์ที่ยิงไม่โดนใคร แย่กว่าคีย์ที่ยังไม่มี.
 *
 * ⚠️ ONE WRITING RULE FOR THIS WHOLE FILE. A spec elsewhere greps every .ts file
 *    under `src/` for the bare name of the deliberately-absent column named in
 *    the ⛔ block further up, and counts a COMMENT as a hit exactly like code —
 *    so neither that column nor the file guarding it is ever spelled out here.
 *    Written down because typing either one turned that spec red once, and the
 *    next person will reach for it too. คอมเมนต์ก็โดนนับ.
 *
 * ✅ CUSTOMER TAG — "member คนไหนใช้ tag นี้" — SHIPPED 24/08, read this first.
 *    This block used to say it was not expressible, and the reason it gave was
 *    right: `members` carries NO tag field, a tag is two collections away
 *        tags           _id, label, key, colour…      the tag's identity
 *        customer_tags  member_id, tag_id, hook_id…   the link
 *    and every `path` in this table is a path on `members`.
 *    ⇒ What changed is not the shape of the data but WHEN the join happens. The
 *      third step this block asked for exists: `audience/prefilter/` runs
 *      `customer_tags.find({tag_id}) → member_id[]` BEFORE the filter is built
 *      and substitutes the ids into the rule, so the builder still builds one
 *      plain `members` filter and learns nothing new. The entry is `customer_tag`
 *      above; the whole feature is one folder and is deletable as one.
 *    ⚠️ It is still NOT a `scope_by_hook: true` source. That flag was reserved
 *      here for exactly this collection, and it is still wrong for it — see the
 *      `hook_id` warning on the entry itself.
 *
 * ⛔ STAMPING TAGS ONTO `members` — REJECTED 24/08, do not revive it.
 *    The tempting version is a `tags: [...]` array on the member row, which
 *    would make this one ordinary entry. 14 files under `chat/` and `tickets/`
 *    write `customer_tags`; each would have to keep the copy in sync forever,
 *    and the first stale copy (tag removed, stamp left behind) sends a campaign
 *    to somebody who should not receive it — WIDER than asked, the failure this
 *    whole file is shaped around. It also writes to real customer data for a
 *    broadcast's convenience. ก๊อป tag ไปแปะบน member = ค่าค้างแล้วยิงผิดคน.
 *
 * ⛔ TICKET TYPE / TICKET STATUS — เจ้าของ 24/08: "ติดไว้ก่อน ทำท่อเผื่อไว้"
 *    THE PIPE IS BUILT, THE FEATURE IS NOT — and that is deliberate. Adding an
 *    entry here today would put a key in the admin's dropdown that resolves to
 *    nobody, which is worse than a missing key. The seam, the verified `tickets`
 *    columns and the two decisions to make before writing the resolver are all
 *    in the ENGLISH note at the top of `audience/prefilter/index.ts`; add the
 *    entry on the day the resolver exists, not before.
 *    Same wall as the tag had, one collection over. On a real row `tickets`
 *    holds `category` ('Other' | 'Payment' — the "type"), `chat_status`
 *    ('admin' | 'bot') and `job_status` (0 | 1 | 2), and it points at the member
 *    through `chat_user_id`, which really is the member `_id` (verified by
 *    looking the row up). It is a join, and a `members` filter cannot express
 *    one — so it goes through the pre-step, exactly as the tag does.
 *    ⇒ NOT by copying the answer onto `members`, which is what an earlier
 *      version of this block suggested. `first_ticket_at` can be stamped
 *      (`tickets/schemas/first-ticket-stamp.ts`) because it never changes;
 *      `category` / `chat_status` / `job_status` all change over a case's life,
 *      so a stamp would go stale and a stale stamp sends a campaign to people
 *      who no longer qualify. ค่าที่เปลี่ยนได้ ห้ามก๊อปไปแปะ — ค้างแล้วยิงผิดคน.
 *
 * ⛔ RAW PROFILE PATHS — "ใน member raw profile ก็สามารถเลือกได้"
 *    The pipe the owner asked to have ready IS this table; what is missing is
 *    not a slot but a stable path to put in one. `raw_profile_data` is stored
 *    verbatim as the customer's own API answered (`external-api.service.ts:1250`
 *    writes `profileResult.data` untouched), so its ENVELOPE belongs to the
 *    vendor, not to us. Our own reader proves the shape has already varied —
 *    `broadcast-var/read/raw-blob.reader.ts` tries `data.profile`, then
 *    `data.data.profile`, then `profile`, then the bare blob. A Mongo dotted path
 *    can only ever be ONE of those four; on rows written under any other
 *    envelope it matches nobody, silently, per-OA.
 *    ⇒ the fix is the one `tier` already demonstrates: normalise the wanted field
 *      out of the blob into a real member column with a writer, then add it here.
 *      Two candidates are worth it and are on real rows today —
 *      `…profile.status` ('enable') and `…profile.line_of_work` ('master').
 *      รูปห่อของ blob เป็นของ vendor ไม่ใช่ของเรา — path ตายตัวจะเงียบ ๆ ไม่โดนใคร
 *
 * ⛔ `tier.level` — a number, and this table has never carried one.
 *    `extractTier()` does write it (`level: 0` on both tiered rows), so the data
 *    is real. It is left out because the only useful question about a level is a
 *    RANGE ("tier 3 ขึ้นไป"), and `audience-filter.ts` has no numeric range: both
 *    `lte` and `gte` go through `parseAdminTime`. `eq`/`in` alone would also be
 *    the first `number` entry ever offered to the form, and a dropdown that sends
 *    `"0"` instead of `0` matches nothing in Mongo without a single error.
 *    `tier.code` answers the same question as a string and is proven.
 *    ⇒ add it when the builder grows a real numeric range, not before.
 */

export const AUDIENCE_SOURCES = SOURCES;

/** Unknown key ⇒ null. The caller decides; this file never throws. */
export function getAudienceSource(key: unknown): AudienceSource | null {
  if (typeof key !== 'string') return null;
  const table = SOURCES as Record<string, AudienceSource | undefined>;
  return table[key] ?? null;
}

/** What the UI may offer. Deprecated entries stay usable but unlisted. */
export function listAudienceSources(): AudienceSource[] {
  return (Object.values(SOURCES) as AudienceSource[]).filter(
    (s) => !s.deprecated,
  );
}

/**
 * ⚠️ REMOVING A SOURCE IS NOT DELETING A LINE.
 *
 * A job stores its rule keys, so a key that vanishes leaves a saved job holding
 * a condition nothing can build. Skipping it would WIDEN the audience —
 * silently — which is how a campaign meant for 200 people reaches 20,000. Mark
 * it `deprecated` while any job may still reference it, and let the filter
 * builder refuse an unknown key outright. ถอดคีย์ = ต้อง deprecated ก่อนเสมอ.
 */
export const REMOVAL_RULE =
  'deprecate before deleting; an unknown key must fail closed';

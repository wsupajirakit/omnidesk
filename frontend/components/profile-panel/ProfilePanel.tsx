/**
 * ==== [FEAT-20260801-CONTACTTABS] START — new file
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * แผงข้อมูลลูกค้า (แท็บ "ข้อมูลส่วนตัว") + helper ที่แผงนี้ใช้
 *
 * โค้ดพวกนี้เคยอยู่ใน `pages/TicketChat.tsx` และไม่ได้ export
 * หน้า Contacts ต้องแสดงชุดเดียวกันเป๊ะ ทางเลือกมีสองทาง
 *   (ก) ก็อปไปไว้อีกที่  → สองชุด แก้ทีต้องแก้สองที่ ลืมที่ใดที่หนึ่ง = สองหน้าไม่ตรงกัน
 *   (ข) ย้ายออกมาเป็นไฟล์กลาง แล้วให้ทั้งสองหน้า import  ← เลือกทางนี้
 * (ทางเดียวกับที่ทำไว้แล้วกับ CustomerCards.tsx — ดู FEAT-20260731-CONTACTS)
 * ผลคือ TicketChat.tsx **สั้นลง** ไม่ใช่ยาวขึ้น และมีโค้ดชุดเดียวในระบบ
 *
 * MOVED VERBATIM — ยกมาทั้งก้อนไม่แก้ตรรกะแม้แต่บรรทัดเดียว
 * ที่ต่างจากเดิมมีแค่:
 *   (1) เติม `export` ให้ PersonalPanelNarrow / LineLogoIcon / getCustomerPhone
 *       (3 ตัวนี้ TicketChat ยังใช้อยู่ที่อื่นด้วย จึง import กลับไป ไม่ใช่ก็อป)
 *   (2) แก้ path ของ import ให้ชี้ถูกจากโฟลเดอร์ใหม่
 * ตัวอื่นอีก 13 ตัวในไฟล์นี้ไม่ถูกใช้นอกก้อนเลย (ตรวจแล้ว) จึงไม่ต้อง export
 *
 * [FIX-20261014-LEGACYPANELGONE] แผงเก่าโหมด acme_category ถูกลบแล้ว (14/10/2026)
 *    → ทุกคนเห็น panel ตัวนี้ตัวเดียว
 *
 * revert: ย้ายเนื้อไฟล์นี้กลับเข้า TicketChat.tsx ตำแหน่งเดิม (git show ของ commit
 *         ที่มี marker นี้) แล้วลบ import + ไฟล์นี้ทิ้ง
 * ==== [FEAT-20260801-CONTACTTABS] END
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Loader2, User as UserIcon, UserCheck, Bot, CircleCheck, MessageSquare, Copy, StickyNote,
  Tags, Pencil, Trash2, X, ChevronDown, History, ArrowDown, ArrowUp, Eye, EyeOff,
  Globe, RefreshCw, Maximize2, Minimize2, // [FEAT-20260802-SITERULESPANEL] การ์ด "ข้อมูลเว็บ"
  Info, // [FEAT-20260810-PENDINGRAW] ปุ่มดูข้อมูลดิบของรายการรอฝาก
} from 'lucide-react';
import { QuotaModal } from '../hook/quota'; // [FEAT-20260815-LINEQUOTA]
// [FEAT-20260825-CHATOPENFRESH] กฎ "คลิกการ์ด = ดึงสด" อยู่ที่เดียว ไม่กระจาย
import { profileRefreshPlan } from '../../pages/chat/chatOpenedRefresh';
import { ticketService, TicketEntry } from '../../services/chat';
import { bankService } from '../../services/finance';
// [FIX-20260816-COPYHTTP] clipboard helper with the http fallback — see the util header
import { copyText } from '../../utils/copyText';
// [FEAT-20260816-WALLETPAYCARD] standalone card, one import — see components/member/walletpay/
import { WalletpayResultCard } from '../member/walletpay';
import { ChatRoom } from '../../services/chat';
import { translateNow, useI18n } from '../../i18n';
/* [TEST-20260820-DEVREMOVE] reads the signed session to decide whether the
   profile-wipe button is even drawn. Cosmetic only — the BE decides for real. */
import { getStoredAuth } from '../../services/authStorage';
import { ConfirmModal } from '../modals';
import { AlertModal } from '../modals';
// [FEAT-20260803-TRANSDICT] พจนานุกรมคำแปลกลาง (แทน SR_LABELS ที่ hard-code)
import { dictLookup, loadTranslationDict, subscribeDict } from '../../services/chat';
/* [FIX-20260905-LINELOGO] + [REFACTOR-20260905-CUSTPROV] the LINE mark and the
   two contact helpers moved to components/common — they were used outside this
   panel, and the icon had already drifted from its twin in ChatRoomView. */
import { getCustomerPhone, LineLogoIcon, parseCustomerDetail } from '../common';
import { CurrentAdminCard } from '../member/CustomerCards';
import { pointRoundSpendAmount, pointRounds, pointRoundsText } from '../member/activity/pointRounds';
/* [REFACTOR-20260905-CUSTPROV] panel building blocks + formatters used by 2+
   card files in `./cards/` — see each shared file's header for why it moved
   and which cards need it. revert: see each shared file's own revert note. */
import { PanelCard } from './shared/PanelCard';
import { PanelRow } from './shared/PanelRow';
import { PanelTabs } from './shared/PanelTabs';
import { uiIsThai, xpAmt, xpDT, xpStatusTH } from './shared/formatters';
/* [REFACTOR-20260905-CUSTPROV] 3 of the 6 cards extracted to ./cards/ — see
   each file's header for props + revert steps. "ข้อมูลลูกค้า" / "การเงิน" /
   "กิจกรรม" stayed here on purpose (test-file source-text anchors block
   them — see the comment at each of their call sites below). */
import { PromotionCard } from './cards/PromotionCard';
import { RecentProductsCard } from './cards/RecentProductsCard';
/* [FEAT-20260905-CUSTPROV] the generic renderers — they draw the sections this
   panel has no hand-built card for. See `renderers/panelOwned.ts` for the split
   and why the id list is this panel's own cards, never a vendor list. */
import { ProfilePanelView } from './renderers';
import { unownedSections } from './renderers/panelOwned';
/* [FEAT-20260905-CUSTPROV] the ONE reader the eight hand-built cards get their
   values from — by KEY, out of `view.sections`, never out of the raw vendor
   blob. See its header for why there is no fallback to the old inline chains. */
import { cell, readPanelValues } from './renderers/sectionValues';
import { BonusCard } from './cards/BonusCard';
/* [FEAT-20261015-MEMBERDETAIL] the hand-typed customer card — its own module, ruled by the provider */
import { MemberDetailCard, showMemberDetailCard, useProviderMemberDetail } from './member-detail';

// ==== [FEAT-20260801-CONTACTTABS] "แหล่งข้อมูล" ของแผงนี้
//
// แผงนี้เคยรับ `ticket: TicketEntry` ทั้งก้อน แต่ **ใช้จริงแค่ 5 ฟิลด์** (ตรวจแล้ว)
// หน้า Contacts ไม่มี ticket เลย มีแต่ห้องแชท + ข้อมูลสมาชิก จึงเปลี่ยนมารับ
// เฉพาะรูปทรงที่ใช้จริง → ทั้งสองหน้าส่งเข้ามาได้โดยไม่ต้องปั้น ticket ปลอม
//
// TicketEntry เข้ากับรูปทรงนี้อยู่แล้วโดยโครงสร้าง → **จุดเรียกใน TicketChat
// ไม่ต้องแก้อะไรเลย** ส่ง ticket เดิมเข้ามาได้ตรงๆ
//
// ⚠️ 3 ฟิลด์ล่างเป็นเรื่องของ "เคส" ล้วนๆ — Contacts ไม่ส่งมา และ CurrentAdminCard
//    รองรับอยู่แล้ว (ไม่มีแอดมิน = ขึ้น "ยังไม่มีผู้ดูแล" ไม่ใช่การ์ดหาย)
export type MemberPanelSource = {
  line_user_data?: any;        // ข้อมูลสมาชิก — ตัวหลักที่แผงนี้ใช้เกือบทั้งหมด
  line_oa_hook_id?: string | null;  // OA ที่คุยอยู่ — ใช้กับปุ่มผูก/แก้บัญชีลูกค้า
  job_status?: number | string | null;   // ↓ 3 ตัวนี้ส่งต่อให้ CurrentAdminCard เท่านั้น
  chat_status?: string | null;
  admin_user_data?: any;
};

// ── the customer panel (the only one since 14/10/2026 — the acme_category=true
//    LegacyPanel was removed, [FIX-20261014-LEGACYPANELGONE]) ─────────────────
// [FEAT-20260728-DYNPROFILE] 🔒 สาย AUTO — to_dev_auto เท่านั้น ห้าม merge เข้า to_dev
// เดิม: ทุก section เป็น mock hardcode ("waiting for real data") — ตอนนี้ต่อข้อมูลจริงแล้ว:
// ดึง raw profile Shop-API (Member.raw_profile_data ที่ webhook เก็บ) ผ่าน
// ticketService.getRawProfile(memberId) แล้วจับคู่ตาม contract:
//   รอทำรายการ ← รายการฝาก/ถอนที่ยังไม่จบ · ข้อมูลลูกค้า ← profile (tier/โดเมน/
//   สายงาน/ธนาคาร/ทรูวอเล็ต/สถานะ) · กิจกรรม ← เหรียญ+รอบสะสมแต้ม · โบนัส ← เงินคืน+
//   แนะนำเพื่อน · การเงิน ← auto flags/เครดิต/กระเป๋า/ยอดรวม/ประวัติ ·
//   สินค้าที่ซื้อล่าสุด + โปรโมชั่น ← promotion
// ⚠️ "ชื่อฟิลด์" ของแต่ละเจ้าไม่เหมือนกัน — ตารางเทียบชื่อ mock ↔ Shop-API ตัวจริง
//    อยู่ที่บล็อก [FEAT-20260801-SHOPAPIV1FIELDS] (จุดเดียวที่แปลงชื่อ)
// (LegacyPanel ของ acme_category = true ถูกลบแล้ว 14/10/2026)
// revert: git show <commit ก่อน marker นี้>:pages/TicketChat.tsx (mock เดิมทั้งก้อน)

// ── [FEAT-20260728-DYNPROFILE] formatting helpers ────────────────────────────
// [REFACTOR-20260905-CUSTPROV] `xpAmt` / `xpDT` moved to `./shared/formatters`
// — 2+ card files need them; see that file's header. Imported below.
// [FIX-20260801-REGDATE] ผู้ใช้สั่งให้ "สมัครเมื่อ" ใช้รูปแบบเดียวกับวันที่บน bubble แชท
// ลอกออปชันมาจาก formatTime ใน ChatRoomView.tsx เป๊ะ (วัน เดือนเต็ม ปี พ.ศ. + เวลา)
// เช่น "17 กรกฎาคม 2569 13:49:24" — ต่างจาก xpDT ที่ตั้งใจให้สั้นสำหรับแถวประวัติ
// ⚠️ ไม่แตะ xpDT — แถวประวัติฝาก/ถอน/โบนัสยังใช้รูปย่อเหมือนเดิมทุกจุด
// revert: เปลี่ยนแถว "สมัครเมื่อ" กลับไปใช้ xpDT
const xpDTFull = (v: any) => {
  if (!v) return '-';
  let x: any = v;
  if (typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))) {
    const n = Number(x);
    x = n < 1e12 ? n * 1000 : n;   // แยกวินาที/มิลลิวินาที เหมือน xpDT
  }
  const d = new Date(x);
  if (isNaN(+d)) return String(v);
  return d.toLocaleString(translateNow('ticketui.panel.date_locale', 'th-TH'), {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
};
const xpChannel = (c: any) => c === 'bank_transfer' ? translateNow('ticketui.panel.ch_bank', 'โอนธนาคาร') : c === 'promptpay' ? translateNow('ticketui.panel.ch_promptpay', 'พร้อมเพย์') : (c || '-');
/* [FEAT-20260905-CUSTPROV] `xpTs` DELETED — it read `h?.at ?? h?.date ??
   h?.created_at`, three vendor field names, to sort the merged เหรียญ history.
   That merge and that sort now happen in `derive-fields.ts` on the back end, and
   the panel receives `activity.coins` already ordered. Its only caller is gone.
   revert: restore it from `git show ce8fcaa:…/ProfilePanel.tsx` together with
   the `acCoinHistory` block it sorted. */
// [REFACTOR-20260905-CUSTPROV] `xpStatusTH` moved to `./shared/formatters`
// — used by 2 card files (การเงิน, โบนัส). Imported below.
// [FEAT-20260801-SHOPAPIV1FIELDS] คีย์ประเภทสินค้าจากปลายทาง → ป้ายที่คนอ่านออก
// ทำแบบทั่วไป (ขีดล่าง→ช่องว่าง + ขึ้นต้นตัวใหญ่) ไม่ใช่ตารางชื่อตายตัว
// เจ้าไหนเพิ่มประเภทใหม่ (เช่น "table_product") ก็ได้ป้ายอัตโนมัติ ไม่ต้องแก้โค้ด
// [REFACTOR-20260905-CUSTPROV] exported — only PromotionCard ("โปรโมชั่น")
// needs this, so per dev-local §6 it stays here rather than moving to
// shared/ (2+ card files only).
export const xpProductLabel = (k: any) => String(k ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ==== [FEAT-20260801-TURNTONE] สีของยอด "ทำไปแล้ว" ในตาราง Activity volume
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// กติกาตามที่ผู้ใช้กำหนด:
//   ทำครบ/เกินเป้า → เขียวเข้ม   · ยังไม่ครบแต่มากกว่า 0 → ส้ม   · เป็น 0 → ไม่มีสี
//
// ⚠️ เช็ค "เป็น 0" ก่อนเสมอ — ถ้าเป้าเป็น 0 ด้วย (0/0) จะเข้าเงื่อนไข done>=required
//    แล้วกลายเป็นเขียว ทั้งที่ผู้ใช้สั่งว่า 0 ต้องไม่มีสี
// ⚠️ ค่าที่อ่านไม่ออก (undefined / ตัวอักษร) = ไม่มีสี ไม่ใช่ส้ม — กันจอหลอกตา
// ⚠️ ใช้คลาสที่มี dark override อยู่แล้วใน index.css เท่านั้น:
//      .tc .text-green-700 → dark = #86efac (เขียวสว่าง ไม่หม่น ตามที่ผู้ใช้กำชับ)
//      .tc .text-warning   → dark = #fb923c (ส้มสว่าง)
//    ถ้าไปใช้เขียวเฉดอื่นจะโดนกฎกลางของธีม dark กดให้มืดจนอ่านไม่ออก
// revert: ลบฟังก์ชันนี้ + คืน className เดิมเป็น "font-bold text-gray-800"
// [REFACTOR-20260905-CUSTPROV] exported — only PromotionCard ("โปรโมชั่น")
// needs this, so per dev-local §6 it stays here rather than moving to
// shared/ (2+ card files only).
export const xpActivityTone = (done: any, required: any): string => {
  const d = Number(done);
  if (!Number.isFinite(d) || d === 0) return 'text-gray-800';
  const r = Number(required);
  if (Number.isFinite(r) && d >= r) return 'text-green-700';
  return 'text-warning';
};
// [REFACTOR-20260905-CUSTPROV] exported — only RecentProductsCard
// ("สินค้าที่ซื้อล่าสุด") needs this, so per dev-local §6 it stays here rather
// than moving to shared/ (2+ card files only).
export const XP_PRODUCT_COLORS = [['#f59e0b', '#ea580c'], ['#10b981', '#1e3a8a'], ['#ec4899', '#dc2626'], ['#8b5cf6', '#059669'], ['#0ea5e9', '#0369a1']];

// [REFACTOR-20260905-CUSTPROV] `PanelCard` / `PanelTabs` moved to
// `./shared/PanelCard` and `./shared/PanelTabs` — both used by 2+ card files
// (in fact every moved card, plus the ones that stayed: "ข้อมูล LINE",
// "รอทำรายการ", `SiteRulesCard`). See each file's header. Imported below.
/* ==== [FEAT-20260810-PENDINGRAW] mask ข้อมูลดิบของแถว statement ====
 * เจ้าของสั่ง 2026-08-10: "กด info ดูข้อมูลดิบได้ mask sensitive ยกเว้นยอดเงินกับวันเวลา"
 * แล้วตามด้วย: "ref_id provider_code statement_id ไม่ต้องเบลอ"
 *
 * ⚠️ ทำไมไม่ใช้ `srMaskDeep` ที่มีอยู่: ตรวจกับก้อนจริงแล้วมันทำ **ตรงข้ามกับที่ต้องการ**
 *   ปล่อยผ่าน : `member_account_name` ("okkkkk"), `member_account_no` ("2016030000")
 *               ← ชื่อกับเลขบัญชีลูกค้า = ของอ่อนไหวที่สุดในก้อนนี้
 *   ไปเบลอ    : `ref_id`, `statement_id` ← ตัวที่เจ้าของบอกว่าไม่ต้องเบลอ
 *   เพราะกฎของมันดูจาก "หน้าตาเป็นรหัส" (uuid/ulid) ไม่ได้ดูว่าเป็นข้อมูลส่วนบุคคล
 *
 * กฎที่นี่จึงเป็น allow-list ตามความหมาย ไม่ใช่ตามหน้าตาของค่า:
 *   เบลอ      : ชื่อ/เลขบัญชี/ตัวระบุตัวตน (account_name / account_no / user_id / trade_no /
 *               m_order_no / id)
 *   ไม่เบลอ   : ยอดเงินทุกตัว (amount / real_amount) · เวลาทุกตัว (date / created_at) ·
 *               ref_id · provider_code · statement_id · m_order_no · status · type ·
 *               bank code · remark
 * ⇒ แอดมินไล่เคสกับปลายทางได้ (มี ref/statement/order id ครบ) แต่ไม่เห็นบัญชีลูกค้าเต็ม ๆ
 *
 * ⚠️ **นอกจาก never-list = เบลอหมด** (เจ้าของสั่ง "นอกนั้นเบลอหมด") ⇒ ปลายทางเพิ่ม
 *    field ใหม่วันไหน มันถูกเบลอโดยปริยาย ไม่หลุดข้อมูลลูกค้าโดยไม่มีใครรู้
 *    ถ้าจะให้ field ใหม่โชว์ ต้องมาเติมใน `PD_NEVER_MASK` เอง = ตัดสินใจอย่างรู้ตัว */
const PD_NEVER_MASK = /^(amount|real_amount|date|created_at|updated_at|ref_id|provider_code|statement_id|m_order_no|status|process_status|type|process_remark|member_account_bank_id)$/i;
const pdMask = (s: string) => {
  const keep = Math.max(2, Math.ceil(s.length * 0.2)); // โชว์ 20% พอให้เทียบกับปลายทางได้
  return s.length <= 4 ? '****' : s.slice(0, keep) + '*'.repeat(Math.min(24, s.length - keep));
};
const pdMaskDeep = (o: any, key = ''): any => {
  if (Array.isArray(o)) return o.map((x) => pdMaskDeep(x, key));
  if (o && typeof o === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = pdMaskDeep(v, k);
    return out;
  }
  // ตัวเลข/boolean/null ไม่เบลอ — ยอดเงินกับเวลาเป็นตัวเลข และเจ้าของสั่งให้เห็น
  if (typeof o !== 'string' || !o) return o;
  return PD_NEVER_MASK.test(key) ? o : pdMask(o); // นอก never-list = เบลอหมด
};

/* [FEAT-20260810-PENDINGRAW] ลูกตาใน modal raw — สลับ epoch ↔ วันที่อ่านออก
 * เจ้าของสั่ง 2026-08-10: "มี icon ตาใน raw กดวันที่เปิดดู แปลงได้"
 * ค่าเวลาในก้อนนี้เป็น epoch ดิบ (`date` = 1784729880599, `created_at` = 1784718544068)
 * ซึ่งอ่านด้วยตาไม่ได้ · กดลูกตาแล้วแปลงเป็นข้อความ โดย **แปลงเฉพาะ key ที่เป็นเวลาจริง**
 * ไม่แปลงตัวเลขทุกตัว ไม่งั้น `amount: 100` จะกลายเป็นวันที่ปี 1970
 * ใช้ `xpDT` ตัวเดิมของแผงนี้ ซึ่งแยก epoch วินาที/มิลลิวินาทีเองอยู่แล้ว — ไม่เขียนใหม่ */
const PD_DATE_KEY = /^(date|created_at|updated_at|at)$/i;
/** เจ้าของสั่ง "แสดงทุกหน่วย dd mm yy hh mm ss" ⇒ ตัวเลขล้วน ไม่ใช่ชื่อเดือน
 *  ไม่ใช้ `xpDTFull` เพราะตัวนั้นเป็น "10 สิงหาคม 2569" (เดือนเต็ม + พ.ศ.)
 *  ใช้ ค.ศ. 2 หลักท้ายตามที่สั่ง (`yy`) และ 24 ชม. เพื่อไม่ต้องเดา AM/PM */
const pdDateStr = (v: any) => {
  const n = Number(v);
  const d = new Date(n < 1e12 ? n * 1000 : n); // แยกวินาที/มิลลิวินาที เหมือน xpDT
  if (isNaN(+d)) return String(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const pdHumanizeDates = (o: any, key = ''): any => {
  if (Array.isArray(o)) return o.map((x) => pdHumanizeDates(x, key));
  if (o && typeof o === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = pdHumanizeDates(v, k);
    return out;
  }
  if (!PD_DATE_KEY.test(key)) return o;
  if (typeof o !== 'number' && !(typeof o === 'string' && /^\d+$/.test(o))) return o;
  return pdDateStr(o);
};

/* ==== [FEAT-20260810-PENDINGDEP] แถวของการ์ด "รอทำรายการ" ====
 * ยกมาจาก JSX เดิมใน PersonalPanel **ทั้งดุ้น ไม่แก้คลาสแม้แต่ตัวเดียว** เพราะต้องใช้
 * ซ้ำสองแท็บ (ฝาก/ถอน) · สีลูกศร/ตัวเลข +− ยังตัดสินด้วย `kind` เหมือนเดิมเป๊ะ
 * ⚠️ คลาส `tc-pending-*` ผูกกับกฎใน index.css ที่บังคับสีพาสเทลให้เท่ากันทั้ง
 *    light/dark — เปลี่ยนชื่อคลาสที่นี่ = สีเพี้ยนในธีม dark (ดูคอมเมนต์เดิม
 *    [FIX-20260731-PENDINGARROW])
 * สาขา `dep` ที่เคยเขียนคาไว้เผื่อ revert ([FIX-20260801-PENDINGWDONLY]) ตอนนี้
 * "ถูกใช้งานจริง" แล้วจาก statement[] — ไม่ใช่โค้ดตายอีกต่อไป */
const PendingList: React.FC<{
  rows: { kind: 'dep' | 'wd'; at: any; amount: any; note?: string; raw?: any }[];
  /** [FEAT-20260810-PENDINGRAW] เปิด modal ดูข้อมูลดิบของแถวนั้น (ฝากเท่านั้น) */
  onInfo?: (raw: any) => void;
}> = ({ rows, onInfo }) => (
  /* [FEAT-20260810-PENDINGDEP] จำกัดความสูงแล้วเลื่อนในกล่องตัวเอง — แพทเทิร์นเดียวกับ
     การ์ด "สินค้าที่ซื้อล่าสุด" ([FIX-20260802-GAMEWRAP]) เพราะปัญหาเดียวกัน: statement[]
     ของจริงมีได้หลายสิบแถว การ์ดจะสูงจนดันการ์ดใบล่างตกจอ
     ⚠️ `max-h` ไม่ใช่ `h` — 1-2 แถวกล่องยังหดตามปกติ ไม่มีที่ว่างค้าง (ซึ่งเป็นเคสวันนี้)
     ใส่ที่นี่ที่เดียวจบทั้งแท็บฝากและถอน ไม่ต้องเขียนซ้ำสองที่ */
  <div className="max-h-72 overflow-y-auto custom-scrollbar pr-1">
  <div className="space-y-2">
    {rows.map((p, i) => (
      <div key={i} className="tc-pending-row flex items-center justify-between bg-white border border-gray-200 p-2.5 rounded-xl">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${p.kind === 'dep' ? 'tc-pending-arrow-dep bg-green-100 text-green-600' : 'tc-pending-arrow-wd bg-red-100 text-red-500'}`}>
            {p.kind === 'dep' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
          </div>
          <div>
            <p className="text-xs font-bold text-gray-800">
              {p.kind === 'dep' ? translateNow('ticketui.panel.pending_dep', 'รอฝาก') : translateNow('ticketui.panel.pending_wd', 'รอถอน')}
              {/* หมายเหตุต่อท้ายชื่อรายการ เช่น "รอถอน (อนุมัติ)" — โชว์เมื่อมีเท่านั้น */}
              {p.note ? ` (${p.note})` : ''}
            </p>
            <p className="text-[10px] text-gray-500">{xpDT(p.at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${p.kind === 'dep' ? 'text-green-600' : 'text-red-500'}`}>{p.kind === 'dep' ? '+' : '-'}{xpAmt(p.amount)}</span>
          {/* [FEAT-20260810-PENDINGRAW] ปุ่ม info มีเฉพาะแถว "ฝาก" ที่มี raw จาก
              statement[] · ฝั่งถอนไม่มี raw (มาจาก finance ท่อเดิม) ⇒ ไม่ขึ้นปุ่ม
              ไม่ใช่ปุ่มตายที่กดแล้วเงียบ */}
          {p.kind === 'dep' && p.raw && onInfo && (
            <button
              type="button"
              onClick={() => onInfo(p.raw)}
              title={translateNow('ticketui.panel.view_raw_row', 'ดู raw ของรายการนี้')}
              className="shrink-0 text-gray-400 hover:text-primary transition-colors"
            >
              <Info size={14} />
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
  </div>
);

// ==== [FEAT-20260802-SITERULESPANEL] การ์ด "ข้อมูลเว็บ" — แสดง site rules ครบทุก field
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ⭐ ออกแบบเป็น "ตัวเดินต้นไม้ JSON" ไม่ใช่การไล่เขียนทีละแถว
//    เหตุผล: ปลายทางเพิ่ม field เมื่อไหร่การ์ดต้องโชว์เองทันที (ไม่ต้องแก้โค้ด = ไม่เป็นหนี้)
//    ป้ายไทยมาจาก SR_LABELS (รู้จักก็แปล ไม่รู้จักก็โชว์ชื่อ field ตามจริง)
//
// ปุ่ม 3 ตัวในการ์ด:
//   👁 ลูกตา   — สลับป้ายไทย ↔ path จริงใน json (ไล่ปัญหา/เขียน dynamic tag ต่อได้เลย)
//   🔄 refresh — ล้าง cache ฝั่ง BE แล้วดึงใหม่ (โชว์เวลาที่ดึงล่าสุด)
//   ดูทั้งหมด  — modal raw json (mask ค่าที่อ่อนไหว 80%)
//
// revert: ลบบล็อกนี้ + <SiteRulesCard/> ท้าย panel + 2 เมธอดใน ticketService
const SR_LABELS: Record<string, string> = {
  // [FEAT-20260803-TRANSDICT] 2 ตัวนี้ถูกเบลอในการ์ดอยู่แล้ว แต่ต้องมีป้าย
  //   ไม่งั้น fallback ไปโชว์ชื่อ field ดิบ (agent_id / id)
  agent_id: 'รหัสเอเจนต์', id: 'รหัสอ้างอิง',
  /* [REFACTOR-20260803-DICTIDENTITY] labels for the shop.promotions block.
   * ⚠️ ตารางนี้เป็น **สำเนาออฟไลน์** ของ site_rules_label ฝั่ง BE ไม่ใช่ต้นฉบับ
   *    ต้นฉบับ = src/config/translationDictSeed.js (SR_LABEL_SEED)
   *    ใช้ตอน DB/เครือข่ายล่มเท่านั้น — ปกติ dictLookup() ชนะเสมอ
   * ⚠️ เพิ่ม field ใหม่ที่ BE ต้องเพิ่มที่นี่ด้วย · scratch_test_siterulescard.cjs
   *    เป็นยามคอยจับว่าสองที่หลุดกันหรือยัง (เพิ่งจับได้ 38 คำที่ลืม) */
  category: 'หมวดโปร', from: 'เริ่มจากรายการที่', size: 'จำนวนต่อหน้า', total: 'จำนวนทั้งหมด',
  asset_code: 'สกุลที่จ่าย', coupon_code: 'โค้ดคูปอง', deposit_amount: 'ยอดฝากที่ต้องใช้',
  desc: 'รายละเอียด', start_date: 'วันเริ่ม', end_date: 'วันสิ้นสุด', status: 'สถานะ',
  is_cal_cashback: 'คิดแคชแบ็กด้วยหรือไม่', is_view: 'แสดงหน้าเว็บหรือไม่',
  max_per_user: 'รับได้กี่ครั้งต่อคน', max_user: 'จำกัดจำนวนคน', mtk_code: 'รหัสการตลาด',
  promotion_clear: 'ค่าทำยอดกิจกรรมครบ', promotion_mode: 'โหมดโปร', promotion_type: 'ประเภทโปร',
  promotion_type_clear: 'วิธีทำยอดกิจกรรมครบ', withdraw_max_amount: 'ถอนสูงสุด',
  withdraw_min_amount: 'ถอนต่ำสุด', withdraw_min_balance: 'ยอดคงเหลือขั้นต่ำตอนถอน',
  amount_bonus: 'โบนัสที่ได้', balance_amount: 'ยอดคงเหลือที่กำหนด',
  deposit_per_day: 'ฝากได้กี่ครั้งต่อวัน', max_bonus: 'โบนัสสูงสุด', percent_bonus: 'เปอร์เซ็นต์โบนัส',
  use_true_money: 'ใช้ทรูวอลเล็ตได้หรือไม่', withdraw_all_open: 'ถอนได้ทั้งหมดหรือไม่',
  withdraw_mode: 'โหมดถอน',
  act_home_living_open: 'เปิดยอดกิจกรรมหมวดบ้านและที่อยู่อาศัยหรือไม่', act_online_activity_open: 'เปิดยอดกิจกรรมออนไลน์หรือไม่',
  act_electronics_open: 'เปิดยอดกิจกรรมหมวดอิเล็กทรอนิกส์หรือไม่', act_gift_card_open: 'เปิดยอดกิจกรรมหมวดบัตรของขวัญหรือไม่',
  act_collectibles_open: 'เปิดยอดกิจกรรมหมวดของสะสมหรือไม่', act_fashion_open: 'เปิดยอดกิจกรรมหมวดแฟชั่นหรือไม่',
  act_outdoor_activity_open: 'เปิดยอดกิจกรรมกลางแจ้งหรือไม่',
  // กลุ่มหลัก
  cashback: 'เงินคืน (แคชแบ็ก)', referral: 'แนะนำเพื่อน', wallet: 'ฝาก / ถอน',
  products: 'กิจกรรม / สินค้า', tier: 'ระดับสมาชิก', wallet_setting: 'ตั้งค่ากระเป๋าเงิน',
  default_config: 'ค่าตั้งต้น', theme_config: 'ธีม / รูปภาพ', rate_config: 'ตั้งค่าของสมนาคุณ',
  // ฝาก
  deposit_amount_min: 'ฝากขั้นต่ำ', deposit_amount_approve: 'ฝากเกินยอดนี้ต้องอนุมัติ',
  deposit_amount_mode: 'โหมดการฝาก', deposit_coin_rate: 'ฝากกี่บาทได้ 1 เหรียญ',
  deposit_min_delay: 'เว้นระยะระหว่างฝาก (นาที)', deposit_sort: 'ลำดับช่องทางฝาก',
  deposit_text: 'ข้อความหน้าฝาก', deposit_activity_volume: 'ยอดกิจกรรมที่ผูกกับการฝาก',
  is_open_deposit: 'เปิดให้ฝาก', is_qr_open: 'เปิดฝากด้วย QR',
  is_open_credit_add: 'เปิดเติมเครดิต', is_open_register_truemoney: 'สมัครทรูมันนี่ได้',
  show_bank_member_deposit_mode: 'โหมดแสดงบัญชีฝาก',
  // ถอน
  withdraw_amount_min: 'ถอนขั้นต่ำ', withdraw_amount_approve: 'ถอนเกินยอดนี้ต้องอนุมัติ',
  withdraw_max_per_bill: 'ถอนสูงสุดต่อครั้ง', withdraw_limit_per_day: 'ถอนได้กี่ครั้งต่อวัน',
  withdraw_transfer_group_amount: 'ยอดโอนแบบกลุ่ม', withdraw_transfer_group_open: 'เปิดโอนแบบกลุ่ม',
  withdraw_truemoney_mode: 'โหมดถอนเข้าทรูมันนี่', is_withdraw_open: 'เปิดให้ถอน',
  is_withdraw_all: 'ถอนได้ทั้งหมด', is_withdraw_bank_verify: 'ถอนต้องยืนยันบัญชี',
  is_withdraw_new_user: 'สมาชิกใหม่ถอนได้', clear_act: 'ทำยอดกิจกรรมครบออกจากโปร',
  // เงินคืน / แนะนำเพื่อน
  is_cashback_open: 'เปิดเงินคืน', cashback_type: 'คิดเงินคืนจาก',
  is_previous_process: 'ใช้รอบก่อนหน้า', interval: 'รอบการคืน (วัน)', start_at: 'เริ่มเมื่อ',
  is_referral_open: 'เปิดแนะนำเพื่อน', percent: 'เปอร์เซ็นต์ (รวม)',
  percent_home_living: 'เปอร์เซ็นต์ — บ้านและที่อยู่อาศัย', percent_online_activity: 'เปอร์เซ็นต์ — กิจกรรมออนไลน์',
  percent_electronics: 'เปอร์เซ็นต์ — อิเล็กทรอนิกส์', percent_gift_card: 'เปอร์เซ็นต์ — บัตรของขวัญ',
  percent_collectibles: 'เปอร์เซ็นต์ — ของสะสม', percent_fashion: 'เปอร์เซ็นต์ — แฟชั่น',
  percent_outdoor_activity: 'เปอร์เซ็นต์ — กิจกรรมกลางแจ้ง',
  activity_volume: 'ยอดกิจกรรม (รวม)', act_home_living: 'ยอดกิจกรรม — บ้านและที่อยู่อาศัย', act_online_activity: 'ยอดกิจกรรม — กิจกรรมออนไลน์',
  act_electronics: 'ยอดกิจกรรม — อิเล็กทรอนิกส์', act_gift_card: 'ยอดกิจกรรม — บัตรของขวัญ', act_collectibles: 'ยอดกิจกรรม — ของสะสม',
  act_fashion: 'ยอดกิจกรรม — แฟชั่น', act_outdoor_activity: 'ยอดกิจกรรม — กิจกรรมกลางแจ้ง',
  // สินค้า
  name: 'ชื่อ', is_active: 'เปิดใช้งาน', img_path: 'รูป', spend_amount: 'แต้มที่ใช้ต่อครั้ง',
  spend_asset: 'ใช้สกุล', layout_slot: 'จำนวนช่อง', limit_per_day: 'ใช้สิทธิ์ได้ต่อวัน',
  amount: 'จำนวน', rate: 'อัตรา', reward_type: 'ประเภทของสมนาคุณ', index_channel: 'ช่องที่',
  length_channel: 'ความยาวช่อง', color_theme: 'สีธีม', rate_text_color: 'สีตัวอักษรอัตรา',
  image_path: 'รูป', img_bg: 'รูปพื้นหลัง', img_bg_reward: 'รูปพื้นหลังของสมนาคุณ',
  img_button: 'รูปปุ่ม', img_button_auto: 'รูปปุ่มออโต้', img_icon_point_round: 'ไอคอนรอบสะสมแต้ม',
  img_point: 'รูปแต้ม', img_quota: 'รูปโควตา', img_point_round: 'รูปรอบสะสมแต้ม',
  mark_bg_1: 'สีมาร์ก 1', mark_bg_2: 'สีมาร์ก 2', point_color: 'สีแต้ม', quota_color: 'สีโควตา',
  reward_color: 'สีของสมนาคุณ', round_color: 'สีปุ่มหมุน', text_color: 'สีตัวอักษร',
  point_round_border_1: 'ขอบรอบสะสมแต้ม 1', point_round_border_2: 'ขอบรอบสะสมแต้ม 2', point_round_border_3: 'ขอบรอบสะสมแต้ม 3',
  // เวลา
  created_at: 'สร้างเมื่อ', updated_at: 'แก้ไขล่าสุด',
};
/* ==== [FEAT-20260803-TRANSDICT] อ่านคำแปลจากพจนานุกรมกลางก่อน
 * เดิม panel แปลเองด้วย SR_LABELS ที่ hard-code ไว้ในไฟล์นี้ ส่วน BE ก็มีชุดของตัวเอง
 * ใน siteRulesVarSpec — แปล json ก้อนเดียวกันแต่คนละชุด ตรวจแล้วเพี้ยนกันจริง 34/39
 * ตอนนี้อ่านจาก /api/translation-dict (dict = sr_label) ที่ webhook ใช้ชุดเดียวกัน
 *
 * ⚠️ SR_LABELS ด้านบน **ไม่ได้ลบ** — เก็บเป็นตัวสำรอง ใช้เมื่อ API ยังไม่ตอบ/ล่ม
 *    จึงไม่มีจังหวะที่ป้ายกลายเป็นชื่อ field ดิบให้แอดมินเห็น
 * revert: เปลี่ยนกลับเป็น  SR_LABELS[k] || k  แล้วลบ import + useDictReady
 */
/* [FEAT-20261022-I18NTICKETEN] Thai UI → the editable Thai dictionary, as before. Any other
   UI language → the field name itself, humanised (`withdraw_max_amount` → "Withdraw max amount");
   the dictionary is Thai-only, so this is the honest English. */
const srHumanize = (k: string) => { const s = String(k).replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const srLabel = (k: string) => (uiIsThai() ? dictLookup('site_rules_label', k) || SR_LABELS[k] || k : srHumanize(k));
/** ค่ากันผ่าน — ปลายทางใส่ 99999 เพื่อ "ปิดไม่ให้ผ่าน" ไม่ใช่ยอดกิจกรรมจริง */
const SR_BLOCK_VALUE = 99999;
const srIsImageUrl = (v: any) => typeof v === 'string' && /^https?:\/\//i.test(v);
/** [FIX-20260802-SRIMG] รวบรวมลิงก์รูป "ทุกจุด" ใน json (ต่อให้ซ่อนลึกกี่ชั้นก็เจอ)
 *  เดิมรูปอยู่ใต้ products[0].default_config.theme_config = พับอยู่ 4 ชั้น เลยเหมือนไม่มีรูป */
/** รูปแทนเมื่อโหลดไม่ได้ — inline svg (ไม่ยิง network ซ้ำ) */
const SR_IMG_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#f1f5f9"/><text x="14" y="18" font-size="12" text-anchor="middle" fill="#94a3b8">?</text></svg>');
const srCollectImages = (o: any, p = '', out: { path: string; url: string }[] = []) => {
  if (Array.isArray(o)) { o.forEach((v, i) => srCollectImages(v, `${p}[${i}]`, out)); return out; }
  if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) srCollectImages(v, p ? `${p}.${k}` : k, out); return out; }
  if (typeof o === 'string' && /^https?:\/\//i.test(o)) out.push({ path: p, url: o });
  return out;
};
const srIsColor = (v: any) => typeof v === 'string' && /^#([0-9a-f]{3,8})$/i.test(v);
/** วันเวลา — รูปแบบเดียวกับในช่องแชท (ไทย + พ.ศ. + วินาที) */
const srDateTime = (v: any) => {
  if (v === null || v === undefined || v === '') return '-';
  let d: Date;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(translateNow('ticketui.panel.date_locale', 'th-TH'), {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
};
const srIsTimeKey = (k: string) => /(_at|_date)$/.test(k);
/** เวลาแบบสั้น (HH:MM:SS) — ใช้ที่ badge ให้อยู่บรรทัดเดียว · hover เห็นวันที่เต็ม */
const srTimeShort = (v: any) => {
  if (!v) return '';
  const d = new Date(typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString(translateNow('ticketui.panel.date_locale', 'th-TH'), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};
/** mask 80% ของค่าที่อ่อนไหว (key/secret/token/ip/url/endpoint/id) — ใช้ใน modal raw json */
const SR_SENSITIVE_RE = /(key|secret|token|password|ip|endpoint|agent_id|_id|^id$)/i;
/** ค่าที่ "เป็นรหัสจริง" เท่านั้นถึงเบลอ — uuid / ulid / hex ยาว
 *  ⭐ id ที่เป็นชื่อเชิงความหมาย (POINT_ROUND, RAND_BOX ใน products) ไม่เบลอ ตามที่ผู้ใช้สั่ง */
const SR_IDLIKE_RE = /^[0-9a-f]{8}-[0-9a-f-]{8,}$|^[0-9A-Z]{20,}$|^[0-9a-f]{24,}$/i;
const srShouldMask = (key: string, v: any) => {
  if (typeof v !== 'string' || !v) return false;
  if (!SR_SENSITIVE_RE.test(key)) return false;
  if (/^(agent_id|.*_secret|.*key|.*token|password)$/i.test(key)) return true; // รหัสลับ = เบลอเสมอ
  return SR_IDLIKE_RE.test(v); // id ทั่วไป: เบลอเฉพาะที่หน้าตาเป็นรหัสจริง
};
const srMask = (s: string) => {
  const keep = Math.max(2, Math.ceil(s.length * 0.2)); // โชว์ 20% พอให้รู้ว่าคือค่าอะไร
  return s.length <= 4 ? '****' : s.slice(0, keep) + '*'.repeat(Math.min(24, s.length - keep));
};
const srMaskDeep = (o: any, key = ''): any => {
  if (Array.isArray(o)) return o.map((x) => srMaskDeep(x, key));
  if (o && typeof o === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = srMaskDeep(v, k);
    return out;
  }
  if (srShouldMask(key, o)) return srMask(o);
  return o;
};

/** ค่า primitive → ข้อความอ่านง่าย (เปิด/ปิด · ตัวเลขมีคอมมา · วันเวลาไทย · ค่ากันผ่าน) */
const srCell = (k: string, v: any): React.ReactNode => {
  if (v === null || v === undefined || v === '') return <span className="text-gray-300">-</span>;
  // [FIX-20260802-SRMASKCARD] เบลอในการ์ดด้วย (เงื่อนไขเดียวกับ modal) — id เชิงชื่อไม่โดน
  if (srShouldMask(k, v)) return <span className="font-mono text-[11px] text-gray-400" title={translateNow('ticketui.panel.masked', 'ค่าถูกปิดบัง')}>{srMask(String(v))}</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-emerald-600' : 'text-gray-400'}>{v ? translateNow('ticketui.panel.on', 'เปิด') : translateNow('ticketui.panel.off', 'ปิด')}</span>;
  if (srIsTimeKey(k)) return srDateTime(v);
  if (typeof v === 'number') {
    if (v === SR_BLOCK_VALUE) return <span className="text-gray-400" title={translateNow('ticketui.panel.block_value_tip', 'ค่ากันผ่าน ไม่ใช่ยอดกิจกรรมจริง')}>{translateNow('ticketui.panel.block_value', 'ปิด (99999)')}</span>;
    if (/^percent/.test(k)) return `${v}%`;
    return v.toLocaleString('en-US');
  }
  if (srIsColor(v)) return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded border border-gray-200 shrink-0" style={{ backgroundColor: v }} />
      <span className="font-mono text-[11px]">{v}</span>
    </span>
  );
  return String(v);
};

/** เดินต้นไม้ JSON → แถว/กล่องพับได้ · โชว์ครบทุก field ที่ปลายทางส่งมา */
const SRNode: React.FC<{
  data: any; path: string; showRaw: boolean; depth?: number;
  onPreview: (url: string) => void;
}> = ({ data, path, showRaw, depth = 0, onPreview }) => {
  const [open, setOpen] = useState(depth < 1);
  if (data === null || data === undefined) return null;

  // ── ค่าเดี่ยว ──
  if (typeof data !== 'object') {
    const k = path.split('.').pop() || path;
    if (srIsImageUrl(data)) {
      return (
        <PanelRow label={showRaw ? path : srLabel(k)}>
          <button type="button" onClick={() => onPreview(data)} title={translateNow('ticketui.panel.view_full_image', 'กดเพื่อดูรูปเต็ม')}
            className="inline-flex items-center gap-1.5 hover:opacity-80">
            <img src={data} alt="" className="w-7 h-7 rounded border border-gray-200 object-cover bg-gray-50"
              onError={(e) => { const el = e.currentTarget as HTMLImageElement; el.src = SR_IMG_FALLBACK; el.title = translateNow('ticketui.panel.image_failed', 'โหลดรูปไม่ได้'); }} />
            <span className="text-[11px] text-primary underline truncate max-w-[120px]">{translateNow('ticketui.panel.view_image', 'ดูรูป')}</span>
          </button>
        </PanelRow>
      );
    }
    return <PanelRow label={showRaw ? path : srLabel(k)}>{srCell(k, data)}</PanelRow>;
  }

  // ── array ──
  if (Array.isArray(data)) {
    if (data.length === 0) return <PanelRow label={showRaw ? path : srLabel(path.split('.').pop() || path)}><span className="text-gray-300">{translateNow('ticketui.panel.empty', 'ว่าง')}</span></PanelRow>;
    // array ของค่าเดี่ยว → รวมบรรทัดเดียว
    if (data.every((x) => typeof x !== 'object')) {
      const k = path.split('.').pop() || path;
      return <PanelRow label={showRaw ? path : srLabel(k)}>{data.join(', ')}</PanelRow>;
    }
    return (
      <div className="mt-1">
        {data.map((item, i) => (
          <SRNode key={i} data={item} path={`${path}[${i}]`} showRaw={showRaw} depth={depth + 1} onPreview={onPreview} />
        ))}
      </div>
    );
  }

  // ── object → กล่องพับได้ ──
  const k = path.split('.').pop() || path;
  const headText = showRaw ? path : srLabel(k);
  const entries = Object.entries(data);
  return (
    <div className={`rounded-lg border border-gray-100 ${depth === 0 ? 'mb-2' : 'mt-1.5 ml-1'}`}>
      <div onClick={() => setOpen((o) => !o)}
        className="px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer select-none bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors">
        <span className={`text-[11px] font-bold ${depth === 0 ? 'text-gray-600' : 'text-gray-500'} truncate`}>
          {headText} <span className="text-gray-300 font-normal">({entries.length})</span>
        </span>
        <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="px-2.5 py-1.5">
          {entries.map(([ck, cv]) => (
            <SRNode key={ck} data={cv} path={path ? `${path}.${ck}` : ck} showRaw={showRaw} depth={depth + 1} onPreview={onPreview} />
          ))}
        </div>
      )}
    </div>
  );
};

/* [FEAT-20260825-POINTROUNDS] `onShopLoaded` — ส่งก้อน site rules ที่การ์ดนี้
   **โหลดไว้อยู่แล้ว** ขึ้นไปให้แผงแม่ใช้ต่อ
   🔴 เจ้าของสั่งตรง ๆ ว่า *"site rule มีดึง panel ขวาอยู่แล้ว ไม่ต้องดึงใหม่
      เปลือง"* ⇒ ห้ามเพิ่มเส้นดึงที่สอง · การ์ดกิจกรรมต้องการแค่ตัวเลขเดียว
      (`spend_amount` ของรอบสะสมแต้ม) ซึ่งอยู่ในก้อนนี้อยู่แล้ว
   ⚠️ optional และไม่ทำอะไรเลยเมื่อไม่ส่งมา ⇒ การ์ดนี้ทำงานเหมือนเดิมเป๊ะ
      ทั้งตอนโหลดครั้งแรกและตอนกดรีเฟรช (ยิงผ่าน `res` ตัวเดียวกัน) */
const SiteRulesCard: React.FC<{ hookId: string; onShopLoaded?: (shop: unknown) => void }> = ({ hookId, onShopLoaded }) => {
  const [res, setRes] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);      // 👁 ป้ายไทย ↔ path จริง
  const [jsonOpen, setJsonOpen] = useState(false);    // modal raw json
  const [preview, setPreview] = useState<string | null>(null); // รูปเต็ม
  const [srBrokenImg, setSrBrokenImg] = useState<Set<string>>(new Set()); // [FIX-20260802-SRIMG2] รูปที่โหลดไม่ได้
  const [jsonFull, setJsonFull] = useState(false);   // [FIX-20260802-SRMODAL] เต็มจอ
  // [UI-20260814-DOMAINCLAMP] modal ที่โชว์ URL เว็บแบบเต็ม (หัวการ์ดโชว์แบบย่อ)
  const [domainOpen, setDomainOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  /* [FEAT-20260825-POINTROUNDS] ส่งก้อนที่โหลดแล้วขึ้นไป — ไม่มีการดึงใหม่
     ⚠️ ผูกกับ `res` ตัวเดียว ⇒ ครอบทั้งโหลดครั้งแรกและกดรีเฟรช โดยไม่ต้องไปแตะ
        สองเส้นนั้นแยกกัน · และประกาศไว้**ก่อน** early-return ของการ์ด
        (`if (!shop) return null`) ไม่งั้น hook จะถูกข้ามในบางรอบ render */
  useEffect(() => {
    onShopLoaded?.(res);
  }, [res, onShopLoaded]);

  // [FEAT-20260803-TRANSDICT] โหลดพจนานุกรมคำแปลกลาง (ครั้งเดียวต่อการเปิดหน้า)
  //   ⚠️ srLabel ถูกเรียก "ระหว่าง render" จึงอ่านจาก module store ไม่ใช่ state
  //      ที่นี่แค่บังคับ re-render หนึ่งครั้งตอนพจนานุกรมมาถึง
  //   ⚠️ ยังไม่มา = ใช้ SR_LABELS สำรอง → ไม่มีจังหวะที่ป้ายเป็นชื่อ field ดิบ
  const [, bumpDict] = useState(0);
  useEffect(() => {
    const off = subscribeDict(() => bumpDict((n) => n + 1));
    loadTranslationDict('site_rules_label');
    return off;
  }, []);

  useEffect(() => {
    let alive = true;
    if (!hookId) { setLoading(false); return; }
    setLoading(true);
    ticketService.getHookSiteRules(hookId).then((r) => { if (alive) { setRes(r); setLoading(false); } });
    return () => { alive = false; };
  }, [hookId]);

  const doRefresh = async () => {
    if (refreshing || !hookId) return;
    setRefreshing(true);
    const r = await ticketService.refreshHookSiteRules(hookId);
    if (r) setRes(r);
    setRefreshing(false);
  };

  // Do not call doRefresh() on chat_opened. The member refresh already fetches
  // SITE_RULES alongside CUSTOMER_PROFILE using the actual LINE user id. Calling
  // this OA-level refresh too would refetch SITE_RULES and issue CUSTOMER_PROFILE
  // with an empty line_user_id. This function remains the explicit button action.

  if (loading) return null;

  /* [FIX-20260803-SRUNWRAP] คลี่ซองให้ถึงเนื้อจริงก่อนแสดง
   *
   * WHY  the card opened onto a node literally named "data" that had exactly one child,
   *   "shop", which the reader then had to expand twice before seeing anything. That came
   *   from `res?.data?.shop || res?.data` — when the payload arrives double-wrapped
   *   (res.data.data.shop, which is what the endpoint returns when the upstream body is
   *   passed through as-is) the first branch misses and the whole envelope is rendered.
   *   → คลี่ทั้ง data และ shop ทิ้งไป ให้การ์ดเปิดมาเจอหัวข้อจริงเลย
   *     (เงินคืน / แนะนำเพื่อน / กระเป๋า …) ไม่ต้องกดผ่านซองอีก 2 ชั้น
   *
   * ⚠️ fallback กัน error ตามที่ผู้ใช้สั่ง: ปลายทางเปลี่ยนรูปเมื่อไหร่ก็ยังต้องไม่พัง
   *    - ไม่ใช่ object (สตริง/ตัวเลข/null) → คืน null แล้วการ์ดไม่โชว์ ดีกว่า throw
   *    - array → ไม่คลี่ต่อ เพราะ Object.entries ของ array ให้ index เป็นชื่อหัวข้อ
   *    - จำกัดความลึกไว้ กัน payload ที่อ้างถึงตัวเองแล้ววนไม่รู้จบ
   */
  const unwrapShop = (raw: any): any => {
    let cur = raw;
    for (let i = 0; i < 6; i++) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
      if (cur.shop && typeof cur.shop === 'object' && !Array.isArray(cur.shop)) return cur.shop;
      // ซองที่มีลูกตัวเดียวชื่อ data = ยังไม่ถึงเนื้อ ให้ลงไปอีกชั้น
      if (cur.data && typeof cur.data === 'object' && !Array.isArray(cur.data)) { cur = cur.data; continue; }
      // ⚠️ เหลือลูกตัวเดียวชื่อ data ที่คลี่ต่อไม่ได้ (เป็น array/ว่าง) = ยังเป็นซองอยู่
      //    ถ้าคืนก้อนนี้ การ์ดจะโชว์หัวข้อ "data" อีก ซึ่งคือบั๊กเดิมที่กำลังแก้
      const keys = Object.keys(cur);
      if (keys.length === 1 && keys[0] === 'data') return null;
      return keys.length ? cur : null;
    }
    return null;
  };
  const shop = unwrapShop(res?.data);
  if (!shop) return null; // ไม่มีเส้น site_rules / ดึงไม่ได้ = ไม่โชว์การ์ด (panel เดิมไม่กระทบ)

  // [FEAT-20260803-PROFILEAT] เวลาที่ "ดึงสำเร็จจริง" ครั้งล่าสุด — BE เก่ายังไม่มี field นี้
  //   จึง fallback ไป cached_at เพื่อให้ deploy คนละรอบแล้วการ์ดไม่พัง (seamless)
  const srStamp = res?.site_rules_updated_at || res?.cached_at || null;
  /* [UI-20260814-DOMAINCLAMP] Owner order 2026-08-14: a long `domain_name` (a full
     URL such as `https://demo.demo.example.com/dashboard...`) ran past the panel and
     pushed the card wider than its half of the screen.

     The card title is a plain string rendered inside a flex row, so it cannot wrap
     without shoving the refresh/eye buttons out of view. Keep the title SHORT and
     put the full value behind an ℹ️ button that opens a modal — same pattern the
     chat divider uses for long check results.

     ⚠️ Only the DISPLAY is shortened. `res.domain_name` itself is untouched, so
        anything else reading it (and the raw-json modal below) still sees the full
        value. ย่อแค่ที่แสดง ค่าจริงไม่ถูกตัด
     revert: restore the one-line title and delete `domainFull` + the ℹ️ button
             + the `domainOpen` modal. */
  const domainFull = String(res?.domain_name || '').trim();
  /* [UI-20260814-DOMAINHIDE] Owner order 2026-08-14 (รอบสาม): the URL is not
     shown in the header at all any more. Clamping it to 18 chars still left a
     truncated string competing with three buttons for a row that gets far less
     than half the panel, and a cut-off URL is not information — it cannot be
     read or copied. The title is now just "ข้อมูลเว็บ"; the whole value lives
     behind the ℹ️ button, which moved to the LEFT of the title so it reads as
     "about this card" rather than sitting in the action cluster on the right.
     ไม่โชว์ URL แล้ว อยากดูกด info เอา
     revert: put `${domainShort}` back in the title and move the button into the
             `badge` group. */
  /* [UI-20260814-DOMAINTITLECLICK] ว่างไว้ — ข้อความวาดใน titleBadge เพื่อให้กดได้ */
  const title = '';
  const sections = Object.entries(shop).filter(([, v]) => v !== null && v !== undefined);

  return (
    /* [FIX-20260815-DOMAINMODALFOLD] fragment so the URL modal can be a SIBLING
       of the card rather than a child of it — see the modal at the bottom. */
    <>
    <PanelCard
      title={title}
      icon={<Globe size={14} />}
      /* [UI-20260814-DOMAINTITLECLICK] เจ้าของสั่ง 14/08: ปุ่ม ℹ️ เล็กเกินกดยาก
         — ให้กดที่คำว่า "ข้อมูลเว็บ" เปิด modal ได้ด้วย

         ⚠️ ทำไมย้ายทั้งข้อความมาไว้ใน `titleBadge` แทนที่จะแก้ `PanelCard`:
            `title` เป็น prop แบบ string ที่ PanelCard render เอง ถ้าทำให้กดได้
            ที่นั่นจะ**กระทบการ์ดทุกใบ**ในพาเนล · ส่ง title="" แล้ววาดเองตรงนี้
            = กระทบเฉพาะการ์ดนี้ใบเดียว ไม่แตะ component ที่ใช้ร่วมกัน
         ⚠️ ห้ามตีกับ toggle พับการ์ด: ทั้งแถบหัวเป็น onClick ของ PanelCard อยู่แล้ว
            ⇒ ตัวที่กดได้ทุกตัวต้อง stopPropagation ไม่งั้นกดดู URL แล้วการ์ดพับตาม
         revert: คืน title='ข้อมูลเว็บ' แล้วเอาปุ่มกลับเป็น ℹ️ เดี่ยว ๆ */
      /* [FIX-20260815-DOMAINTITLEHIT] Owner, 15/08: "ปุ่มข้อมูลเว็บกดยากมาก และ
         เอาสีแถบออก มันมีเทา ๆ".
         ⚠️ TWO WRONG DIAGNOSES BEFORE THE RIGHT ONE — recorded so nobody
            repeats them:
            (a) "the grey band is TEXT SELECTION" → added `select-none`. Wrong;
                the band stayed.
            (b) "the hit area is too small" → added padding + a hover surface.
                That is what PUT the grey box there (`hover:bg-white/70` +
                `rounded-md` on a tinted header reads as a permanent chip).
            The band was my own styling, and "กดยาก" was structural: the dialog
            lived inside the folded card and was never mounted — see
            [FIX-20260815-DOMAINMODALFOLD] at the bottom of this component.

         Owner, 15/08: "ขอแบบไม่ต้องมีกรอบรอบ ๆ เป็นคำเฉย ๆ กดได้" ⇒ no
         background, no border, no padding — a plain bold word that changes
         colour on hover. `select-none` stays so a click-drag does not
         highlight the label instead of pressing it.
         2. HARD TO HIT — the label was a bare text button with no padding, so
            only the glyphs themselves were clickable. It now carries real
            padding and a hover surface, giving it a touch target instead of a
            hairline. The ⓘ next to it grew from p-1 to p-1.5 for the same
            reason.
         Behaviour is unchanged: same handler, same modal, same disabled state
         when the OA has no domain. เพิ่มพื้นที่กด + กันไฮไลต์ ไม่แตะ logic.
         revert: drop `select-none` and the padding/hover classes. */
      titleBadge={
        <span className="inline-flex items-center gap-1 select-none">
          {/* Owner, 15/08: "เอา button ออกจากข้อมูลเว็บ แต่ยังให้กดได้" — a <span>,
              not a <button>. The grey box was the browser's own control chrome:
              a <button> element carries a UA background/appearance that beats
              `bg-transparent` in this header, so the word looked like a chip no
              matter which utility classes were removed. A span has no chrome and
              renders as plain text.
              Still a real control: role/tabIndex/keyboard keep it reachable and
              operable exactly like the button was, and `stopPropagation` still
              stops the click from toggling the card behind it. */}
          <span
            role={domainFull ? 'button' : undefined}
            tabIndex={domainFull ? 0 : undefined}
            onClick={(e) => { e.stopPropagation(); if (domainFull) setDomainOpen(true); }}
            onKeyDown={(e) => {
              if (!domainFull) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDomainOpen(true); }
            }}
            title={domainFull ? translateNow('ticketui.panel.site_url_full_tip', 'ดู URL เว็บแบบเต็ม') : undefined}
            className={`text-sm font-bold tracking-wide select-none transition-colors ${domainFull ? 'cursor-pointer hover:text-primary active:text-primary' : 'cursor-default'}`}>
            {translateNow('ticketui.panel.site_info', 'ข้อมูลเว็บ')}
          </span>
          {domainFull ? (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setDomainOpen(true); }}
              title={translateNow('ticketui.panel.site_url_full_tip', 'ดู URL เว็บแบบเต็ม')}
              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-primary hover:border-primary/40 active:bg-gray-50 transition-colors select-none">
              <Info size={13} />
            </button>
          ) : null}
        </span>
      }
      defaultOpen={false}
      badge={
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* 👁 สลับป้ายไทย ↔ ชื่อ field ดิบ (path) */}
          <button type="button" onClick={() => setShowRaw((v) => !v)}
            title={showRaw ? translateNow('ticketui.panel.show_thai_names', 'แสดงชื่อภาษาไทย') : translateNow('ticketui.panel.show_raw_names', 'แสดงชื่อ field ดิบจาก json')}
            className={`p-1.5 rounded-md border transition-colors select-none ${
              showRaw ? 'text-primary border-primary/40 bg-primary-light' : 'text-gray-500 border-gray-200 bg-white hover:text-primary hover:border-primary/40'}`}>
            {showRaw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {/* 🔄 ปุ่มใหญ่ขึ้น + เวลาแบบช่องแชท */}
          {/* [FIX-20260802-SRTIME] โชว์แค่เวลา (บรรทัดเดียว) · hover = วันที่+เวลาเต็ม */}
          {/* [FEAT-20260803-PROFILEAT] ใช้ site_rules_updated_at เป็นหลัก
              WHY  `cached_at` was reconstructed server-side with `new Date()` whenever the
              response was not a Redis hit, so the label read "just now" for data that had
              not actually been re-fetched. The new stamp is written only when a fetch
              really succeeded and is stored in the DB, so it survives restarts.
              fallback เป็น cached_at ไว้เพื่อ BE เก่า (deploy คนละรอบ) — ไม่พัง */}
          <button type="button" onClick={doRefresh} disabled={refreshing}
            title={srStamp ? translateNow('ticketui.panel.site_fetched_tip', 'ดึงล่าสุด {at} — กดเพื่อดึงใหม่ (ระบบดึงเองทุก 30 นาที)').replace('{at}', String(srDateTime(srStamp))) : translateNow('ticketui.panel.site_refetch', 'ดึงกติกาเว็บใหม่')}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-[11px] font-bold text-gray-600 hover:text-primary hover:border-primary/40 disabled:opacity-50 select-none transition-colors whitespace-nowrap">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {srStamp ? srTimeShort(srStamp) : 'refresh'}
          </button>
        </span>
      }
    >
      <div className="space-y-1">
        {sections.map(([k, v]) => (
          <SRNode key={k} data={v} path={k} showRaw={showRaw} depth={0} onPreview={(u) => setPreview(u)} />
        ))}

        {/* [FIX-20260802-SRIMG2] รูปทุกจุดใน json — เรียงตามลำดับที่ปรากฏจริง ห้ามตัด
            หัวข้อ = path เต็มจาก json (ไม่ย่อ) · URL ที่ไม่ใช่รูปจริง (ปลายทางส่ง prefix เปล่ามา)
            แสดงเป็น "ยังไม่ได้ตั้งรูป" ไม่ใช่ ? ปริศนา */}
        {(() => {
          const imgs = srCollectImages(shop);
          if (imgs.length === 0) return null;
          return (
            <div className="rounded-lg border border-gray-100">
              <div className="px-2.5 py-1.5 bg-gray-50 rounded-t-lg">
                <span className="text-[11px] font-bold text-gray-600">🖼 {translateNow('ticketui.panel.images_in_data', 'รูปภาพในข้อมูลนี้')} <span className="text-gray-300 font-normal">({translateNow('ticketui.panel.images_count', '{n} จุด · เรียงตาม json').replace('{n}', String(imgs.length))})</span></span>
              </div>
              <div className="p-2 space-y-1.5">
                {imgs.map((im, i) => {
                  const broken = srBrokenImg.has(im.url);
                  const noFile = /\/$/.test(im.url); // ลงท้าย / = ยังไม่ได้ใส่ชื่อไฟล์
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <button type="button" disabled={broken || noFile} onClick={() => setPreview(im.url)}
                        title={broken || noFile ? translateNow('ticketui.panel.no_image_yet', 'ยังไม่มีรูปให้ดู') : translateNow('ticketui.panel.view_full_image', 'กดเพื่อดูรูปเต็ม')}
                        className="shrink-0 w-10 h-10 rounded border border-gray-200 overflow-hidden bg-gray-50 hover:border-primary transition-colors disabled:cursor-not-allowed">
                        {broken || noFile ? (
                          <span className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">{translateNow('ticketui.panel.empty', 'ว่าง')}</span>
                        ) : (
                          <img src={im.url} alt="" className="w-full h-full object-cover"
                            onError={() => setSrBrokenImg((prev) => new Set(prev).add(im.url))} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        {/* หัวข้อจริงจาก json — path เต็ม ไม่ย่อ */}
                        <div className="text-[10px] font-mono text-gray-600 truncate" title={im.path}>{im.path}</div>
                        <div className="text-[9px] text-gray-400 truncate" title={im.url}>
                          {noFile ? translateNow('ticketui.panel.image_not_set', 'ยังไม่ได้ตั้งรูป (ปลายทางส่งมาเป็นลิงก์เปล่า)') : broken ? translateNow('ticketui.panel.image_failed', 'โหลดรูปไม่ได้') : im.url}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <button type="button" onClick={() => setJsonOpen(true)}
          className="w-full mt-2 py-2 rounded-lg border border-dashed border-gray-300 text-xs font-bold text-gray-500 hover:text-primary hover:border-primary/40 hover:bg-primary-light/40 transition-colors select-none">
          {translateNow('ticketui.panel.view_all_raw', 'ดูทั้งหมด (raw json)')}
        </button>
      </div>

      {/* modal raw json — ค่าที่อ่อนไหว (key/secret/ip/url/id) ถูก mask 80% */}
      {/* [FIX-20260815-DOMAINMODALFOLD] the URL modal used to sit HERE, inside
          the card body. `PanelCard` renders `children` only while open (:219),
          and this card is `defaultOpen={false}` — so while folded the modal did
          not exist at all and the ⓘ / title click fired into nothing. That is
          the real "กดยาก / modal ขึ้นยาก": not a small hit area, a control whose
          dialog was not mounted. It now lives OUTSIDE `PanelCard`, below.
          ตอนพับก็ต้องกดติด. */}

      {jsonOpen && (
        /* [FIX-20260802-SRMODAL] ไม่ปิดเมื่อคลิกนอก (กันปิดพลาดตอนลากเลือกข้อความ)
           · กากบาทใหญ่ขึ้น · ปุ่มคัดลอก + ขยายเต็มจอ */
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 bg-black/60">
          <div className={`bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col ${jsonFull ? 'w-full h-full' : 'w-full max-w-4xl max-h-[85vh]'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-2">
              <span className="text-sm font-bold text-gray-700 flex items-center gap-2 min-w-0">
                <Globe size={14} className="shrink-0" /> <span className="truncate">{title} — raw json</span>
                <span className="text-[10px] font-normal text-amber-600 shrink-0">{translateNow('ticketui.panel.sensitive_masked', '(ค่าที่อ่อนไหวถูกปิดบัง)')}</span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button"
                  // [FIX-20260816-COPYHTTP] same http fix as the panel copy buttons
                  onClick={() => { void copyText(JSON.stringify(srMaskDeep(res?.data ?? {}), null, 2)).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }); }}
                  title={translateNow('ticketui.panel.copy_json', 'คัดลอก json')} className="px-2 py-1.5 rounded-md border border-gray-200 text-xs font-bold text-gray-600 hover:text-primary hover:border-primary/40 transition-colors">
                  {copied ? '✓ ' + translateNow('ticketui.panel.copied', 'คัดลอกแล้ว') : translateNow('ticketui.panel.copy', 'คัดลอก')}
                </button>
                <button type="button" onClick={() => setJsonFull((v) => !v)} title={jsonFull ? translateNow('ticketui.panel.shrink', 'ย่อลง') : translateNow('ticketui.panel.fullscreen', 'ขยายเต็มจอ')}
                  className="p-2 rounded-md border border-gray-200 text-gray-600 hover:text-primary hover:border-primary/40 transition-colors">
                  {jsonFull ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button type="button" onClick={() => setJsonOpen(false)} title={translateNow('ticketui.panel.close', 'ปิด')}
                  className="p-2 rounded-md text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"><X size={22} /></button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[11px] leading-relaxed font-mono text-gray-700 bg-gray-50 whitespace-pre">
{JSON.stringify(srMaskDeep(res?.data ?? {}), null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* [FIX-20260802-SRMODAL] พรีวิวรูป — ไม่ปิดเมื่อคลิกนอก · X ใหญ่ · คัดลอกลิงก์ · เปิดเต็มจอ */}
      {preview && (
        <div className="fixed inset-0 z-[85] flex flex-col bg-black/80">
          <div className="flex items-center justify-between px-4 py-3 gap-2">
            <span className="text-[11px] font-mono text-white/70 truncate">{preview}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button"
                // [FIX-20260816-COPYHTTP] same http fix as the panel copy buttons
                onClick={() => { void copyText(preview).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }); }}
                title={translateNow('ticketui.panel.copy_image_link_tip', 'คัดลอกลิงก์รูป')} className="px-2 py-1.5 rounded-md bg-white/10 text-xs font-bold text-white hover:bg-white/20 transition-colors">
                {copied ? '✓ ' + translateNow('ticketui.panel.copied', 'คัดลอกแล้ว') : translateNow('ticketui.panel.copy_link', 'คัดลอกลิงก์')}
              </button>
              <a href={preview} target="_blank" rel="noreferrer" title={translateNow('ticketui.panel.open_new_tab', 'เปิดในแท็บใหม่ (เต็มจอ)')}
                className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors"><Maximize2 size={16} /></a>
              <button type="button" onClick={() => setPreview(null)} title={translateNow('ticketui.panel.close', 'ปิด')}
                className="p-2 rounded-md bg-white/10 text-white hover:bg-red-500/80 transition-colors"><X size={24} /></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img src={preview} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = SR_IMG_FALLBACK; }} />
          </div>
        </div>
      )}
    </PanelCard>

    {/* [FIX-20260815-DOMAINMODALFOLD] URL เต็ม — OUTSIDE the card on purpose.
        Owner, 15/08: "กดตอนพับต้องติด".

        THE BUG. This modal used to sit inside `<PanelCard>`, and PanelCard
        renders `children` only while it is open (:219). This card is
        `defaultOpen={false}`, so while folded the dialog was never mounted:
        clicking the ⓘ or the title set the state and NOTHING appeared. It read
        as "the button is hard to press" when in fact the press landed every
        time and had nowhere to go. เป็นบั๊กของตำแหน่ง ไม่ใช่ขนาดปุ่ม.

        Its trigger lives in the card HEADER, which is visible in both states —
        so the dialog has to be too. The other two dialogs here (`jsonOpen`,
        `preview`) are triggered from inside the card body, so they can only be
        reached while it is open and are correctly left where they are.

        Markup below is byte-identical to the block that was inside; only its
        parent changed.
        revert: move this block back above `</PanelCard>` and drop the fragment. */}
    {domainOpen && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 bg-black/60"
        onClick={() => setDomainOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Globe size={14} className="shrink-0 text-primary" />
            <span className="text-sm font-bold text-primary">{translateNow('ticketui.panel.site_url_full', 'ข้อมูลเว็บ — URL เต็ม')}</span>
            <button type="button" onClick={() => setDomainOpen(false)} title={translateNow('ticketui.panel.close', 'ปิด')}
              className="ml-auto px-2 py-1 rounded-md border border-gray-200 text-xs font-bold text-gray-500 hover:text-primary hover:border-primary/40 transition-colors">
              {translateNow('ticketui.panel.close', 'ปิด')}
            </button>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-700 break-all select-all leading-relaxed">
              {domainFull}
            </p>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
// ==== [FEAT-20260802-SITERULESPANEL] END

// [REFACTOR-20260905-CUSTPROV] `PanelRow` moved to `./shared/PanelRow` —
// used by 2 card files ("ข้อมูลลูกค้า", "โปรโมชั่น"). Imported below.

// ==== [FEAT-20260729-COPYALL] START — copyable value + optional reveal
// 🔒 AUTO track — to_dev_auto branch only
//
// Every value in the customer panel has to be copyable, and every copy has to
// confirm — a silent copy button is indistinguishable from a broken one.
//
// `masked` covers the bank account number, which upstream returns partly
// hidden (xxx-x-x3003-x). The eye reveals the full value when one is available;
// copying always copies the full value, never the masked form, because a masked
// string is useless once pasted.
//
// revert: delete this component and inline the plain values back into PanelRow.
const CopyValue: React.FC<{
  value?: string | null;
  masked?: string | null;      // what to show until revealed (bank account)
  mono?: boolean;
  /** [FIX-20260816-COPYHTTP] `ok=false` ⇒ the copy genuinely failed — show the red toast */
  onCopied: (label: string, ok?: boolean) => void;
  copyLabel: string;
  revealTitle?: string;
  /** [FEAT-20260729-IDSHORT] shorten long values to "head…" (LINE User ID) */
  shorten?: number;
}> = ({ value, masked, mono, onCopied, copyLabel, revealTitle, shorten }) => {
  const [revealed, setRevealed] = useState(false);
  const raw = masked && !revealed ? masked : value;
  // [FEAT-20260729-IDSHORT] A LINE User ID is 33 chars and wrapped the label onto
  // two lines. Cut it to a recognisable head plus an ellipsis — copy still takes
  // the full value, and the full value stays on the tooltip.
  // revert: drop the `shorten` prop and use `raw` directly below.
  const shown = shorten && raw && raw.length > shorten ? `${raw.slice(0, shorten)}…` : raw;
  if (!value) return <span className="text-gray-400">-</span>;
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className={mono ? 'font-mono text-xs truncate' : 'truncate'} title={raw || undefined}>{shown}</span>
      {masked && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="text-gray-400 hover:text-gray-600 shrink-0"
          title={revealTitle}
        >
          {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      )}
      <button
        type="button"
        // [FIX-20260816-COPYHTTP] was `navigator.clipboard?.writeText(...)` — a silent
        // no-op on http (the API only exists in secure contexts). copyText falls back
        // to execCommand and reports success/failure so the toast can tell the truth.
        onClick={() => {
          void copyText(value).then((ok) => onCopied(copyLabel, ok));
        }}
        // [FIX-20260816-COPYHTTP] p-0.5 + icon 12→14: ~20% bigger glyph and a larger
        // real hit target — the owner reported the button too small to press.
        className="text-gray-400 hover:text-primary shrink-0 p-1"
        title={copyLabel}
      >
        <Copy size={17} />
      </button>
    </span>
  );
};
// ==== [FEAT-20260729-COPYALL] END

// ==== [FEAT-20260802-BANKNICE] แถวธนาคาร: map code → ชื่อ + โลโก้ จากทะเบียนกลาง (/api/banks)
//   เดิมโชว์ code ดิบ "BBL" + ป้ายตัวอักษร · ตอนนี้เรียก map กลาง (cache) → โลโก้จริง + ชื่อไทย
//   ⚠️ ไม่รู้จัก code / โหลดไม่ได้ → fallback ป้ายตัวอักษร + ชื่อเดิม (ไม่พัง)
//   revert: ลบ component นี้ + คืนแถวธนาคารเป็น badge+CopyValue เดิม
const BankValue: React.FC<{
  code?: string | null;
  fallbackName?: string | null;
  /** [FIX-20260816-COPYHTTP] same contract as CopyValue — `ok=false` = failed */
  onCopied: (label: string, ok?: boolean) => void;
  copyLabel: string;
}> = ({ code, fallbackName, onCopied, copyLabel }) => {
  const [dir, setDir] = useState<Record<string, any>>({});
  useEffect(() => {
    let alive = true;
    bankService.getDirectory().then((d) => { if (alive) setDir(d); });
    return () => { alive = false; };
  }, []);
  if (!code && !fallbackName) return <span className="text-gray-400">-</span>;
  const info = bankService.lookup(dir, code);
  const name = info?.thai_name || info?.nice_name || fallbackName || code || '-';
  const logo = bankService.logoUrl(info?.logo);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {logo ? (
        <img src={logo} alt="" className="w-4 h-4 rounded-[2px] object-contain shrink-0 bg-white" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-[2px] bg-green-600 text-white text-[9px] font-bold shrink-0">{String(code || '?').charAt(0).toUpperCase()}</span>
      )}
      <span className="truncate" title={name}>{name}</span>
      <button
        type="button"
        // [FIX-20260816-COPYHTTP] same fix + same 20% sizing as CopyValue above.
        onClick={() => { void copyText(name).then((ok) => onCopied(copyLabel, ok)); }}
        className="text-gray-400 hover:text-primary shrink-0 p-1"
        title={copyLabel}
      >
        <Copy size={17} />
      </button>
    </span>
  );
};

// [FEAT-20260729-OANAME] oaLabel is passed in rather than resolved here: the
// hooks list lives in the parent, and this panel is rendered per ticket, so
// looking it up inside would mean threading the whole list down for one string.
/* [FIX-20260814-CONTACTREGISTER] The `hideRegisterButton` opt-out that existed
 * here earlier today is gone: the owner asked for the button back on the Contact
 * page, working exactly as it does on support. Both pages already feed this panel
 * the two values the action needs (`line_oa_hook_id` + `line_user_data`), so the
 * one shared render path serves both and there is no page-specific branch left
 * to drift. ปุ่มเดียว เส้นเดียว ทั้งสองหน้า. */
/* [FIX-20261014-LEGACYPANELGONE] ONE panel. The acme-era twin (`PersonalPanelLegacy`,
 * shown only when the `acme_category` config row was true) was removed 14/10/2026 —
 * no environment carried that row. This component serves TWO screens: the ticket page and
 * the Contact page (pages/chat/Contact.tsx) — a change here lands on both, which is why it
 * was extracted and why it must stay screen-agnostic. */
export const PersonalPanelNarrow: React.FC<{
  source: MemberPanelSource; room: ChatRoom | null; oaLabel?: string;
  /* [FEAT-20260907-PROVCONDS] provider switches delivered via the LIST
     envelope by the page that mounted this panel (TicketChat / Contact) —
     the profile answer is null for unlinked members, which is exactly when
     the register box renders, so the profile-envelope stamp alone cannot
     reach it. Optional, default ON = today's screen. */
  showRegisterAction?: boolean; showWalletpayCard?: boolean;
}> = ({ source, room, oaLabel, showRegisterAction = true, showWalletpayCard = true }) => {
  // [FEAT-20260801-CONTACTTABS] ชื่อเดิมที่โค้ดข้างล่างใช้ — ตั้ง alias บรรทัดเดียว
  // แทนการไล่แก้ ~10 จุดในตัว component เพื่อให้เนื้อในเป็นของเดิมเป๊ะ ตรวจ diff ง่าย
  const ticket = source;
  // [FEAT-20260729-COPYALL] one toast for every copy button in this panel.
  // Declared before any early return — see [FIX-20260729-HOOKORDER] for why
  // hook placement matters here.
  const { t } = useI18n();
  /* [FEAT-20261022-I18NTICKETEN] the alert's title/message stay Thai in state — the error
     tint below reads `includes('ไม่สำเร็จ')` — and are translated only when drawn. */
  const ADMIN_MSG_KEYS: Readonly<Record<string, string>> = {
    'แก้ไขข้อมูลลูกค้า': 'ticketui.panel.admin_edit_customer',
    'ขอลิงก์ไม่สำเร็จ': 'ticketui.panel.admin_link_failed',
    'ลบข้อมูลโปรไฟล์แล้ว': 'ticketui.panel.admin_cleared',
    'ลบข้อมูลโปรไฟล์ที่ระบบเก็บไว้เรียบร้อย (ไม่ได้ถอนการผูกที่ปลายทาง)': 'ticketui.panel.admin_cleared_msg',
    'ลบข้อมูลไม่สำเร็จ': 'ticketui.panel.admin_clear_failed',
    'ลองใหม่อีกครั้ง': 'ticketui.panel.admin_try_again',
    'ลงทะเบียนให้ลูกค้า': 'ticketui.panel.register_customer',
  };
  const trAdminMsg = (s: string): string => (ADMIN_MSG_KEYS[s] ? t(ADMIN_MSG_KEYS[s], s) : s);
  /* the history tables' "done" fallback — the literal stays in the call (test T22 pins it) */
  const okText = (s: string): string => (s === 'สำเร็จ' ? t('status.success', 'สำเร็จ') : s);
  const ud = ticket.line_user_data;
  // [FIX-20260816-COPYHTTP] carries ok so a genuinely failed copy shows RED, not green
  const [copyToast, setCopyToast] = useState<{ label: string; ok: boolean } | null>(null);
  /* [FEAT-20260810-PENDINGRAW] แถว statement ที่กด info ไว้ (null = ปิด modal)
     ประกาศไว้ก่อน early return ทุกอัน — เหตุผลเดียวกับ [FIX-20260729-HOOKORDER] */
  const [rawPending, setRawPending] = useState<any>(null);
  /** [FEAT-20260810-PENDINGRAW] ลูกตาใน modal: true = แปลงวันเวลาให้อ่านออก */
  const [rawDates, setRawDates] = useState(false);
  const fireCopyToast = useCallback((label: string, ok: boolean = true) => {
    // [FIX-20260816-COPYHTTP] ok defaults true so every existing caller is unchanged.
    setCopyToast({ label, ok });
    setTimeout(() => setCopyToast(null), 1500);
  }, []);

  // ==== [FEAT-20260728-DYNPROFILE] START — ดึง raw profile จริง (เดิม: hardcode ทั้ง panel)
  const memberId = ticket.line_user_data?._id || null;
  const [rawProfile, setRawProfile] = useState<any | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  /* [FEAT-20261015-MEMBERDETAIL] the site's rule for the hand-typed card (shop-api: null = today's) */
  const memberDetailRule = useProviderMemberDetail();
  // [FEAT-20260729-CLINKEDIT] แยกเป็น reloadRawProfile เพื่อให้ปุ่มถอนการผูก
  // สั่งโหลดซ้ำได้หลัง BE ล้างข้อมูล (เดิม logic เดียวกันแต่ฝังใน useEffect)
  const reloadRawProfile = useCallback((cancelledRef?: { v: boolean }) => {
    if (!memberId) { setRawProfile(null); return; }
    setRawLoading(true);
    ticketService.getRawProfile(memberId)
      .then(d => { if (!cancelledRef?.v) setRawProfile(d); })
      .catch(() => { if (!cancelledRef?.v) setRawProfile(null); })
      .finally(() => { if (!cancelledRef?.v) setRawLoading(false); });
  }, [memberId]);
  useEffect(() => {
    const c = { v: false };
    reloadRawProfile(c);
    return () => { c.v = true; };
  }, [reloadRawProfile]);


  // ==== [FEAT-20260729-CLINKEDIT] START — แอดมินจัดการการผูกบัญชีจาก panel นี้
  // 🔒 branch to_dev_custom_adapter
  //
  // 3 การกระทำ (ทุกตัวลง webhook log ฝั่ง BE ว่าแอดมินคนไหนทำ):
  //   แก้ไข (ดินสอ)   → ขอ token mode=edit → เปิด landing ของ hook แท็บใหม่
  //                     แอดมินกรอก/ยืนยันข้อมูลบน landing เหมือนลูกค้าทำเอง
  //   ถอน (ถังขยะ)    → confirm → BE ยิง unlink ปลายทาง + ล้าง raw profile ฝั่งเรา
  //   ลงทะเบียนให้ลูกค้า → ขอ token mode=register → เปิด landing (turnaround
  //                     เดียวกับลูกค้าลงทะเบียนเองทุกขั้น)
  // ปุ่มโชว์เมื่อมี raw profile (แก้ไข/ถอน) หรือยังไม่มี (ลงทะเบียนให้) — สิทธิ์
  // ตรวจจริงที่ BE (JWT + ticket.manage) → ไม่มีสิทธิ์ = ได้ข้อความ error ชัดเจน
  // revert: ลบ block นี้ + ปุ่มใน PanelCard "ข้อมูลลูกค้า" + ปุ่มใน empty state
  const [adminActing, setAdminActing] = useState<null | 'edit' | 'unlink' | 'register'>(null);
  const [adminMsg, setAdminMsg] = useState<{ title: string; message: string } | null>(null);
  /**
   * ⚠️⚠️ [TEST-20260820-DEVREMOVE] TESTING TOOL — NOT A PRODUCT FEATURE ⚠️⚠️
   *
   * Draws the profile-wipe (trash) button beside the tier badge, for the `dev`
   * account and nobody else. Owner, 2026-08-20: "fe รอบนี้ให้เห็นแค่ username = dev
   * คนเดียว".
   *
   * ⚠️ THIS IS NOT A PERMISSION CHECK. Anyone can open devtools, flip this to
   * true and click. The lock that matters is server-side —
   * `omnidesk-api/src/modules/chat/dev-remove.guard.ts` reads the username out of
   * the signed HttpOnly session and answers 403 to everyone else, so an unhidden
   * button just produces a refused request. This line only keeps the control out
   * of an operator's way. ซ่อนเฉย ๆ · ด่านจริงอยู่ BE.
   *
   * TURNING IT OFF FOR PRODUCTION — do BOTH, in this order:
   *   1. BE: set `DEV_REMOVE_USERNAMES=` (empty) ⇒ the capability is gone for
   *      everyone, `dev` included. This is the one that actually closes it.
   *   2. FE: replace this line with `const canDevRemove = false;`, or restore
   *      the original `{false && (` wrapper at the button below.
   * Doing only (2) leaves the route callable by hand. ทำแค่ FE = ยังยิงมือได้.
   *
   * REMOVING IT ENTIRELY: put `{false && (` back around the button below (the
   * marker there says how), drop this constant and the `getStoredAuth` import.
   * Everything else on the card — handler, both confirm steps, `clearRawProfile`
   * — was already here before this and stays.
   */
  const canDevRemove =
    (getStoredAuth()?.user?.username ?? '').trim().toLowerCase() === 'dev';

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  /* [FEAT-20260803-CLEAR2STEP] ยืนยันชั้นที่สอง — ต้องติ๊กก่อนถึงกดยืนยันได้
     WHY  the first dialog is one click away from a destructive action, and the button
     that opens it sits in a header next to an edit pencil. A misclick there wipes the
     stored profile with a single confirm. The second step cannot be dismissed by
     reflex: the confirm button stays disabled until the box is ticked.
     ⚠️ ทุกครั้งที่เปิด/ปิด ต้องรีเซ็ต checkbox ไม่งั้นรอบถัดไปมันติ๊กค้างมาให้เลย
        = ชั้นที่สองไม่ได้กันอะไร
     revert: ลบ 2 state นี้ + modal ชั้นสอง แล้วให้ ConfirmModal ชั้นแรกเรียก doUnlink ตรง ๆ */
  const [confirmUnlink2, setConfirmUnlink2] = useState(false);
  const [clearAck, setClearAck] = useState(false);
  const hookId = ticket.line_oa_hook_id || '';
  /* [FEAT-20260825-POINTROUNDS] ก้อน site rules ที่การ์ดขวาโหลดไว้ — ใช้ร่วมกัน
     ไม่ได้ดึงเพิ่ม (เจ้าของ: *"ไม่ต้องดึงใหม่ เปลือง"*) */
  const [srShop, setSrShop] = useState<unknown>(null);
  const channelUserId = ud?.line_user_id || '';
  // [FEAT-20260815-LINEQUOTA] ⓘ on the LINE OA row — see the button below
  const [quotaOpen, setQuotaOpen] = useState(false);

  // ==== [FEAT-20260801-LINKCAPS] START — ซ่อนปุ่มที่ OA นี้ทำไม่ได้จริง
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  //
  // ผู้ใช้สั่ง: "ถ้า custom tool ของ OA เราไม่มี ให้ซ่อนปุ่ม แก้ไข/ถอนการผูก"
  //
  // เหตุผล: Shop-API ตัวจริง **ไม่มีเส้นแก้ไขและถอนการผูก** (ยิงทดสอบทุก method
  // แล้วได้ 404 หมด) ปุ่มที่กดแล้วพังเสมอไม่ควรโชว์ตั้งแต่แรก
  //
  // ⚠️ ค่าเริ่มต้นเป็น null = **โชว์ปุ่มไว้ก่อน** (ดูเงื่อนไขตอนเรนเดอร์)
  //    เพื่อไม่ให้ปุ่มที่เคยใช้ได้หายไปตอนเส้นนี้ล่ม / BE ยังไม่ได้ deploy /
  //    ยังโหลดไม่เสร็จ — ซ่อนเฉพาะตอน "รู้แน่ว่าไม่มี" เท่านั้น
  // revert: ลบ block นี้ + เงื่อนไข canEdit/canUnlink ที่ปุ่มทั้งสอง
  const [linkCaps, setLinkCaps] = useState<{ edit: boolean; unlink: boolean } | null>(null);
  useEffect(() => {
    if (!hookId) { setLinkCaps(null); return; }
    let cancelled = false;
    ticketService.getLinkCapabilities(hookId).then((c) => {
      if (cancelled) return;
      setLinkCaps(c ? { edit: !!c.edit, unlink: !!c.unlink } : null);
    });
    return () => { cancelled = true; };
  }, [hookId]);
  // null (ยังไม่รู้/ถามไม่ได้) → โชว์ไว้ก่อน · รู้แล้วว่าไม่มี → ซ่อน
  const canEdit = linkCaps === null || linkCaps.edit;
  const canUnlink = linkCaps === null || linkCaps.unlink;
  // ==== [FEAT-20260801-LINKCAPS] END

  // ==== [FEAT-20260730-PROFILEPUSH] START — รับสัญญาณจาก WS แล้วอัปเดตการ์ดสด
  // 🔒 branch to_dev_custom_adapter
  //
  // TicketChat แปลง WS event เป็น CustomEvent 'tc:customer-profile-updated'
  // (ดู marker เดียวกันใน handleWsEvent) — ที่นี่คือปลายทาง
  //
  // ── กติกาสำคัญ 2 ข้อ ──────────────────────────────────────────────────
  // 1. **เช็คว่าเป็นลูกค้าคนเดียวกับที่เปิดอยู่** ก่อนทำอะไรทั้งสิ้น
  //    ไม่งั้นลูกค้าคนอื่นผูกบัญชี → การ์ดของคนที่เราเปิดอยู่โดนรีโหลดมั่ว
  // 2. cleared = ล้างทิ้งเลย ไม่ต้องยิง API (รู้อยู่แล้วว่าจะได้ค่าว่างกลับมา)
  //    ส่วน linked/updated = ไปดึงของใหม่ผ่าน API เดิมที่ผ่านสิทธิ์ตามปกติ
  //
  // ⚠️ ต้องประกาศ **หลัง** channelUserId (บรรทัดบน) — ถ้าย้ายขึ้นไปข้างบนจะอ่าน
  // ค่าก่อนถูก define (temporal dead zone) แล้ว component พังทั้งตัว
  // ไม่แตะ useEffect ที่โหลดตอนเปิดห้อง — ของเดิมทำงานเหมือนเดิมทุกประการ
  // revert: ลบ useEffect นี้ทั้งก้อน
  useEffect(() => {
    const onProfilePush = (evt: Event) => {
      const d = (evt as CustomEvent).detail as
        | { channel_user_id?: string; cleared?: boolean; action?: string }
        | undefined;
      if (!d?.channel_user_id) return;
      // ต้องเป็นลูกค้าคนเดียวกับที่เปิดอยู่เท่านั้น
      if (!channelUserId || d.channel_user_id !== channelUserId) return;

      if (d.cleared) {
        // ข้อมูลถูกล้างที่ BE แล้ว → ยุบการ์ดทันที (กลับไปสถานะ "ยังไม่ผูก")
        setRawProfile(null);
        return;
      }
      // ==== [FEAT-20260801-MANUALREFRESH] START
      // แยก 2 ที่มาของ event นี้ออกจากกัน:
      //   push จาก BE (ลูกค้าเพิ่งผูก/แก้ข้อมูล) → ของใน DB สดอยู่แล้ว โหลดพอ
      //   แอดมินกดปุ่ม refresh เอง            → สั่ง BE ยิงไปถามปลายทางใหม่ก่อน
      // ⚠️ ยิงไม่สำเร็จ (คืน null) ก็ยัง reload ต่อเสมอ — จอต้องมีข้อมูลเดิมให้ดู
      //    และผู้ใช้ต้องไม่เห็นความต่างตามที่สั่งไว้ตอนทำ throttle
      // revert: ลบ if นี้ เหลือ reloadRawProfile() บรรทัดเดียวแบบเดิม
      // ==== [FEAT-20260824-CLAIMPROFILE] ที่มาที่ 3 ของ event เดียวกันนี้
      // WHAT: 'case_taken' = เคสเพิ่งกลายเป็นของแอดมินคนนี้ (กดรับ/รับต่อ/เปิดเคส)
      // WHY : เจ้าของสั่งว่าทั้งสามปุ่มต้องได้ข้อมูลสด "ตอนนั้น" — ห้ามติด cooldown
      //       10 วิของ BE · `trigger: 'case_taken'` คือเหตุผลเดียวที่ BE ยอมให้ข้าม
      // ⚠️ ปุ่ม refresh มือ (manual_refresh) **ห้าม** ส่ง trigger — ต้องติด cooldown
      //    เหมือนเดิมเป๊ะตามที่สั่งไว้ตอนทำ throttle จึงแยกเป็นอาร์กิวเมนต์ ไม่ใช่ค่าคงที่
      // revert: เอา 'case_taken' ออกจาก 2 จุดในบล็อกนี้ (เงื่อนไข + อาร์กิวเมนต์)
      /* ==== [FEAT-20260825-CHATOPENFRESH] ที่มาที่ 4 ของ event เดียวกันนี้
         'chat_opened' = แอดมิน **แค่คลิกการ์ด** (ยังไม่รับเคส ยังไม่เปิดเคส)
         เจ้าของ 25/08 สั่งว่าแค่คลิกก็ต้องได้ของสดและต้องบันทึกลง record ด้วย
         ⚠️ manual_refresh ยัง**ต้อง**ส่ง undefined เหมือนเดิมเป๊ะ — ปุ่ม refresh มือ
            ต้องติด cooldown 10 วิของ BE ต่อไป (กติกาเดิมตอนทำ throttle ห้ามหลุด)
            trigger จึงคำนวณจาก action ไม่ใช่ค่าคงที่ตัวเดียว
         revert: เอา 'chat_opened' ออกจาก wantsUpstream และจาก trigger */
      const plan = profileRefreshPlan(d.action);
      if (plan.upstream && memberId && hookId) {
        ticketService.refreshRawProfile(memberId, hookId, plan.trigger)
          .finally(() => reloadRawProfile());
        return;
      }
      // ==== [FEAT-20260801-MANUALREFRESH] END
      reloadRawProfile();
    };
    window.addEventListener('tc:customer-profile-updated', onProfilePush);
    return () => window.removeEventListener('tc:customer-profile-updated', onProfilePush);
  }, [channelUserId, reloadRawProfile, memberId, hookId]);
  // ==== [FEAT-20260730-PROFILEPUSH] END

  const openAdminLanding = async (mode: 'edit' | 'register') => {
    if (!hookId || !channelUserId || adminActing) return;
    setAdminActing(mode);
    const r = await ticketService.getAdminLinkUrl(hookId, channelUserId, mode);
    setAdminActing(null);
    if (r.ok && r.url) {
      window.open(r.url, '_blank', 'noopener');
    } else {
      // BE บอกเหตุผลเป็นภาษาคนแล้ว (เช่น OA ยังไม่ตั้ง landing URL / ไม่มีสิทธิ์)
      setAdminMsg({ title: mode === 'edit' ? 'แก้ไขข้อมูลลูกค้า' : 'ลงทะเบียนให้ลูกค้า', message: r.error || 'ขอลิงก์ไม่สำเร็จ' });
    }
  };

  // [FEAT-20260730-CLEARCOPY] ชื่อ/เบอร์ที่โชว์ใน modal ยืนยัน
  // ใช้ "แหล่งเดียวกับที่ส่งไป BE" (ตัวแปร phone ใน doUnlink) เพื่อไม่ให้เกิดกรณี
  // จอโชว์เบอร์หนึ่ง แต่ระบบไปถอนอีกเบอร์หนึ่ง — ต้องเป็นค่าเดียวกันเสมอ
  // ไล่ลำดับเหมือนกัน: โปรไฟล์จาก API ก่อน → ข้อมูลที่เราเก็บไว้ → "-"
  // ⚠️ "-" คือ fallback ตามที่สั่ง (กันไว้หากพลาด) ไม่ใช่ปล่อยว่าง
  const unlinkProfile = rawProfile?.data?.profile || rawProfile?.profile || {};
  /* [FEAT-20260803-CLEAR2STEP] บังคับให้เป็นสตริงเสมอก่อนเอาไปแสดง
     WHY  these come straight from a third-party payload whose shape we do not control.
     A provider returning full_name as an object or an array crashes the render outright
     ("Objects are not valid as a React child") — and it crashes the panel that is
     supposed to be warning about a destructive action, which is the worst place for it.
     ⚠️ ตัวเลข 0 / false ต้องไม่กลายเป็น "-" จึงเช็ค null/undefined ตรง ๆ ไม่ใช้ ||
     ⚠️ object/array = ถือว่าใช้ไม่ได้ ตกไป fallback ตัวถัดไป ไม่ใช่เอามา stringify
        (แอดมินอ่าน "[object Object]" แล้วยิ่งงงกว่าเห็น "-") */
  const safeText = (...vals: any[]): string => {
    for (const v of vals) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;
      const s = String(v).trim();
      if (s !== '') return s;
    }
    return '-';
  };
  const clearTargetPhone = safeText(unlinkProfile.phone, ud?.phone_number);
  const clearTargetName = safeText(
    unlinkProfile.full_name, unlinkProfile.name, ud?.full_name, ud?.display_name);

  const doUnlink = async () => {
    setConfirmUnlink(false);
    if (!memberId || adminActing) return;
    setAdminActing('unlink');

    // ==== [FEAT-20260802-CLEARRAWPROFILE] ผู้ใช้สั่ง: ปุ่มนี้ "ลบข้อมูลโปรไฟล์ฝั่งเรา" เท่านั้น
    // ❌ ไม่ยิงเส้น unlink ของปลายทางอีกแล้ว (คอมเมนต์ไว้ด้านล่าง ไม่ได้ลบทิ้ง)
    //    เหตุผล: Shop-API ตัวจริงไม่มีเส้นถอนการผูก + ผู้ใช้ต้องการแค่ล้างข้อมูลที่เราเก็บ
    //    ถ้าวันหน้าปลายทางมีเส้น unlink จริง ให้ปลดคอมเมนต์ 3 บรรทัดนี้กลับมาใช้
    //    (ตัวแปร clearTargetPhone / channelUserId / hookId ยังอยู่ครบ)
    //
    //    const phone = clearTargetPhone === '-' ? '' : clearTargetPhone;
    //    const r = await ticketService.adminUnlinkCustomer(hookId, channelUserId, phone);
    //    if (!r.ok) { setAdminMsg({ title: 'เคลียร์ข้อมูลไม่สำเร็จ', message: r.error || 'ลองใหม่อีกครั้ง' }); }
    //
    // ทำแค่: ลบ raw_profile_data ของ member → toast แจ้งผล → รีโหลด panel
    const ok = await ticketService.clearRawProfile(memberId);
    setAdminActing(null);
    if (ok) {
      setAdminMsg({ title: 'ลบข้อมูลโปรไฟล์แล้ว', message: 'ลบข้อมูลโปรไฟล์ที่ระบบเก็บไว้เรียบร้อย (ไม่ได้ถอนการผูกที่ปลายทาง)' });
      reloadRawProfile(); // โหลดซ้ำให้ panel กลับสถานะ "ยังไม่มีข้อมูลโปรไฟล์"
    } else {
      setAdminMsg({ title: 'ลบข้อมูลไม่สำเร็จ', message: 'ลองใหม่อีกครั้ง' });
    }
  };
  // ==== [FEAT-20260729-CLINKEDIT] END

  // body ดิบ = {success, source, data:{profile,...}} — เผื่อเคสเก่าที่เก็บแบบไม่มี wrapper ด้วย
  const xp = rawProfile?.data?.profile ? rawProfile.data : (rawProfile?.profile ? rawProfile : null);
  const profile = xp?.profile;
  // ==== [FEAT-20260801-SHOPAPIV1SHAPE] START — รองรับโครง response ของ Shop-API ตัวจริง
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  //
  // ── ปัญหา (ยืนยันด้วยการยิง API จริง 2026-07-31) ────────────────────────
  // mock วาง promotion/finance/bonus/activity ไว้ **ระดับเดียวกับ** profile
  //   { data: { profile:{...}, promotion:{...}, finance:{...} } }
  // แต่ของจริงซ้อนทุกอย่างไว้ **ข้างใน profile**
  //   { data: { profile: { ..., promotion:{...}, finance:{...} } } }
  // → ถ้าอ่านแบบเดิมอย่างเดียว การ์ดการเงิน/โปรโมชั่น/โบนัส/กิจกรรม
  //   จะหายทั้งหมดเมื่อต่อกับปลายทางจริง (เพราะเรนเดอร์ใต้เงื่อนไข {finance && (…)})
  //
  // ⚠️ BE จงใจเก็บ raw ไม่ดัดรูป (ดู FIX-20260729-RAWPROFILE — "ดัดรูปตรงนี้จะ
  //    กลายเป็นหนี้ทันที" และแท็กไดนามิกอ่าน path จริงของปลายทาง)
  //    การรองรับรูปทรงจึงต้องทำ **ที่จุดอ่านฝั่งจอ** แบบนี้เท่านั้น
  //
  // อ่านของเดิมก่อนเสมอ (?? ) → mock และ tool เดิมทุกตัวได้ค่าเท่าเดิมเป๊ะ
  // revert: เอา `?? profile?.xxx` ออกจาก 4 บรรทัดนี้
  /* [FEAT-20260905-CUSTPROV] ⚠️ THESE FOUR ARE NOW *WHETHER*, NOT *WHAT*.
     Every VALUE inside these cards comes from `view.sections` below; what is
     left here is the one question the view cannot answer — does this payload
     contain a customer at all. `buildView` emits all eight sections
     unconditionally (verified against the builder on 05/09: `{ data: {} }`
     still yields a full eight-section view with every value `undefined`), so a
     guard keyed on "did the provider send the section" would draw four cards
     full of dashes for someone whose profile never loaded. The blob's own
     section objects are the honest signal, and `personalPanelCards.dom.test.tsx`
     pins it ("no profile at all ⇒ the cards stay away").
     มี view ไม่ได้แปลว่ามีลูกค้า · การ์ดจะโผล่หรือไม่ ยังถามจากก้อนดิบ */
  const promotion = xp?.promotion ?? profile?.promotion;
  const finance = xp?.finance ?? profile?.finance;
  const bonus = xp?.bonus ?? profile?.bonus;
  const activity = xp?.activity ?? profile?.activity;

  /* [FEAT-20260905-CUSTPROV] 🔴 THE ONE DOOR TO THIS PROVIDER'S ANSWER.
     Every value the eight hand-built cards draw is read out of `view.sections`
     BY KEY from here down — see `renderers/sectionValues.ts` for why by key and
     never by label or position, and for why there is deliberately no fallback to
     the old inline `??` chains. No `view` ⇒ every lookup answers empty and the
     cards draw their empty states, which is already how this panel behaves in
     the seconds before the profile request lands. */
  const pv = readPanelValues(rawProfile?.view);

  /* [FEAT-20260905-CUSTPROV] ประวัติฝาก/ถอน — the provider's `amount_rows`.
     WAS: `finance?.recent_deposits ?? finance?.transactions?.deposit ?? []`,
     i.e. four vendor field names for one list, and every row then re-read
     `at ?? date` at draw time. The rows arrive normalised now
     (`{ at, amount, sign, status }`, `row-paths.ts` → `money`), so both the list
     and its rows are vendor-neutral. */
  const depRows = pv.amountRows('finance.deposits');
  const wdRows = pv.amountRows('finance.withdrawals');
  // ⚠️ ตั้งใจใช้ "ไม่ใช่ success/cancel = ยังค้าง" แทนการเทียบ === 'pending' ตรงๆ
  // เพราะชุดข้อมูลจริงที่ตรวจได้มีแต่ success (transactions) — ยังไม่เคยเห็นค่าที่
  // ปลายทางใช้เรียกสถานะค้างจริงๆ ว่าสะกดอย่างไร (pending? waiting? processing?)
  // เขียนแบบนี้จึงไม่พลาดถ้าเขาใช้คำอื่น และไม่ไปนับตัวที่จบแล้วเข้ามาด้วย
  const isPendingRow = (r: any) => {
    const s = String(r?.status || '').toLowerCase();
    return s !== '' && s !== 'success' && s !== 'cancel' && s !== 'canceled' && s !== 'cancelled' && s !== 'failed' && s !== 'reject' && s !== 'rejected';
  };
  // ==== [FEAT-20260801-SHOPAPIV1SHAPE] END

  /* ==== [FEAT-20260905-CUSTPROV] THE CARD VALUES — read from `view.sections`
   * =========================================================================
   * ⚠️ WHAT WAS HERE, AND WHY IT IS GONE. This block used to be
   * `[FEAT-20260801-SHOPAPIV1FIELDS]`: ~30 `??` chains that mapped the demo mock's
   * field names to the real Shop-API's, plus `xpBal()` to dig a currency out of
   * `balances[asset_code=…]`. It was correct, it was proven by
   * `personalPanelCards.dom.test.tsx` on both shapes, and every line of it was
   * A VENDOR'S FIELD NAME COMPILED INTO THE DASHBOARD. A third vendor that
   * differed only in spelling — `wallet.main.amount` instead of
   * `finance.credit_balance` — still needed a front-end release, which is the
   * exact cost PART 7 exists to remove.
   *
   * The same mapping now lives on the back end as DATA (`field-paths.ts`,
   * `row-paths.ts`) plus nine genuine algorithms (`derive-fields.ts`), and the
   * answers arrive here already resolved, in `view.sections`. Adding a provider
   * is a back-end-only change. ชื่อฟิลด์ของเจ้าไหนไม่เหลือบนจอแล้ว
   *
   * 🔴 THE NAMES BELOW ARE UNCHANGED ON PURPOSE. Only each value's SOURCE
   * moved. `test/pointRounds.test.ts` reads this file as SOURCE TEXT and pins
   * `pointRounds(acCoinBal, pointRoundSpendAmount(srShop))` character for character, so
   * a rename here is a red suite; more importantly, a rename would make this
   * diff impossible to read as "same screen, different plumbing".
   *
   * 🔴 LOOKED UP BY KEY, NEVER BY LABEL OR POSITION — see
   * `renderers/sectionValues.ts` for the argument, and for why a fallback to
   * the old chains was rejected rather than forgotten.
   *
   * revert: `git show ce8fcaa:components/profile-panel/ProfilePanel.tsx` holds
   *         the `[FEAT-20260801-SHOPAPIV1FIELDS]` block verbatim; restore it,
   *         restore `xpTs` / `xpProductTs` above, drop the `pv` reader, and undo
   *         the row reads in `cards/` (each card's header lists its own).
   */

  // ── การเงิน ────────────────────────────────────────────────────────────────
  const finCredit = pv.value('finance.deposits', 'finCredit');
  const finWallet = pv.value('finance.deposits', 'finWallet');
  const finDepTotal = pv.value('finance.deposits', 'finDepTotal');
  /* ⚠️ The WITHDRAWALS section, not the deposits one. Two sections share the
     "การเงิน" card as tabs and each carries its own total; reading both off one
     section would work today only because a missing key answers `undefined`,
     and would print a dash where a number belongs. */
  const finWdTotal = pv.value('finance.withdrawals', 'finWdTotal');
  /* The badge pair is a SWITCH, so the tone is the answer: `ok` = on, `off` =
     off. The string-'enabled'-vs-boolean reconciliation the old code did here
     happened in `derive-fields.ts` before the chip was built — redoing it would
     be a second copy of that rule. */
  const finAutoDep = pv.switchOn('finance.deposits', 'finAutoDep');
  const finAutoWd = pv.switchOn('finance.deposits', 'finAutoWd');

  // ── โบนัส ──────────────────────────────────────────────────────────────────
  const cbPending = pv.value('bonus.cashback', 'cbPending');
  const cbClaimed = pv.value('bonus.cashback', 'cbClaimed');
  const cbHistory = pv.amountRows('bonus.cashback');
  const rfPending = pv.value('bonus.referral', 'rfPending');
  const rfClaimed = pv.value('bonus.referral', 'rfClaimed');
  const rfHistory = pv.amountRows('bonus.referral');
  /* Already `?? 0`-ed by the producer, and its "no friends_count ⇒ use the row
     COUNT" rule lives in `derive-fields.ts`. The card keeps its own `?? 0` so a
     provider that omits the row still prints a number rather than a blank. */
  const rfFriends = pv.value('bonus.referral', 'rfFriends');

  // ── กิจกรรม ────────────────────────────────────────────────────────────────
  const acCoinBal = pv.value('activity.coins', 'acCoinBal');
  /* Already merged (received + spent), tagged with a `sign`, and sorted
     newest-first by `derive-fields.ts` — the two-array merge and the `xpTs`
     sort that used to be here are gone with it. */
  const acCoinHistory = pv.items('activity.coins');
  /* [FEAT-20260825-POINTROUNDS] สิทธิ์ร่วมกิจกรรม = เหรียญ ÷ spend_amount ของรอบสะสมแต้ม
     เจ้าของ 25/08 · ตัวเลขที่ปลายทางส่งมาไม่ได้ผูกกับเหรียญที่โชว์อยู่ในการ์ด
     เดียวกัน ⇒ เคยขัดกันเอง · ตรรกะทั้งหมดอยู่ใน `activity/pointRounds.ts`
     ⚠️ ก้อน site rules มาจากการ์ดขวาที่โหลดไว้แล้ว (`onShopLoaded`) ไม่ได้ยิงใหม่
     ⚠️ ยังไม่มาถึง / ไม่มี config / spend_amount = 0 ⇒ `pointRounds` คืนเหรียญจริง
        พร้อมธง N/A ⇒ จอไม่เคยว่างและไม่เคยขึ้น NaN ระหว่างรอ
     ⚠️⚠️ [FEAT-20260905-CUSTPROV] THIS LINE DOES NOT MOVE TO THE PROVIDER, and
     it never will: the round COUNT needs the site-rules `spend_amount`, a
     different payload on a different route, which `buildView` cannot see. Only
     `acCoinBal`'s source changed. Behaviour is identical either way — an absent
     coin balance used to arrive as `undefined` and now arrives as `0`, and
     `pointRounds` maps both to `{ value: 0 }` (its own T13/T11 cases). */
  const acPointRound = pointRounds(acCoinBal, pointRoundSpendAmount(srShop));
  const acRounds = acPointRound.value;
  const acPointRoundHistory = pv.items('activity.point_round');

  // ── โปรโมชั่น ──────────────────────────────────────────────────────────────
  /* The "is it a bare string or an object with `.name`" test lives in
     `derive-fields.ts`; what arrives is the NAME. */
  const promoName = pv.value('promotion', 'promoName');
  const promoToDone = pv.value('promotion', 'promoActivityVolume');
  const promoToReq = pv.target('promotion', 'promoActivityVolume');
  /* The summary row's own label — `Activity volume (<unit>)` — and its trailing
     `(<percent>%)`. Both were read straight off `promotion.activity_volume` inside the
     card's JSX, which is why `PromotionCard` needed the raw blob at all. */
  const promoToLabel = pv.label('promotion', 'promoActivityVolume');
  const promoToSuffix = pv.suffix('promotion', 'promoActivityVolume');
  const promoOutstanding = pv.value('promotion', 'promoOutstanding');
  /* Already sorted newest-first by `derive-fields.ts`, and each row normalised
     by `row-paths.ts` → `product` (name / provider / type / image / at / amount),
     so the five vendor spellings the card used to try are gone from both ends. */
  const promoProducts = pv.items('products');
  /* ⚠️ PREFIXED KEYS, not two sections. Activity volume and outstanding are two tables
     in ONE card and a vendor may send the same product key to both, so the
     producer namespaces them (`activity_volume:fashion`, `outstanding:fashion`) and the
     prefix is what selects a table. The product names are never hardcoded on
     either side — a vendor that adds a category gets a row for free.
     Empty list ⇒ the card falls back to its single summary row, exactly as
     before, because the producer emits one OR the other, never both. */
  const promoToBreakdown: { key: string; done: any; required: any }[] =
    pv.keyed('promotion', 'activity_volume:').map((r) => ({ key: r.key, done: r.value, required: r.target }));
  const promoOsBreakdown: { key: string; amount: any }[] =
    pv.keyed('promotion', 'outstanding:').map((r) => ({ key: r.key, amount: r.value }));

  // ── เลขบัญชี: หา "เลขเต็ม" จากทุกแหล่งที่เรามี ─────────────────────────────
  // Shop-API ตัวจริง mask มาจากต้นทางแล้ว (account_no = "xxxxxx4725") และ **ไม่ส่ง
  // เลขเต็มมาเลย** → ลูกตาจะโผล่ก็ต่อเมื่อมีเลขเต็มจริงเท่านั้น ไม่สร้างปุ่มหลอก
  // ที่กดแล้วได้เลข mask เหมือนเดิม · ปุ่ม copy ใช้ `value` เสมอ (= เลขเต็มถ้ามี)
  // จึงไม่ติด mask ไม่ว่าลูกตาจะเปิดหรือปิด
  // ถือเป็น "เลขเต็ม" ก็ต่อเมื่อไม่มีอักขระปิดบัง (x / * / • / ·) ปนอยู่
  const xpUnmasked = (v: any) => (typeof v === 'string' && v && !/[x*•·]/i.test(v)) ? v : null;
  const acctMasked = profile?.bank?.account_no;
  const acctFull = profile?.bank?.account_no_full ?? xpUnmasked(ud?.bank_account) ?? xpUnmasked(acctMasked);
  // [FIX-20260801-ACCTCOPY] ผู้ใช้สั่ง "copy ต้องก็อปแบบไม่ mask + เพิ่ม icon ตากดดู"
  // ⚠️⚠️ ข้อเท็จจริงที่ต้องรู้ก่อน: Shop-API **ไม่ได้ส่งเลขบัญชีเต็มมาเลย** ค่าที่ได้คือ
  //     "xxxxxx4725" ที่ต้นทาง mask มาแล้ว · flow ผูกบัญชีของเราก็รับจากลูกค้าแค่
  //     4 ตัวท้าย (ปลายทางบังคับ account_number = 4 หลัก) → **ไม่มีใครในระบบถือ
  //     เลขเต็มอยู่** จึงไม่มีทางเสกเลขเต็มขึ้นมาได้
  // สิ่งที่ทำได้จริงและทำแล้ว: เวลา copy ให้ได้ "เฉพาะตัวเลขที่รู้จริง" ไม่ติดตัว x
  //     xxxxxx4725 → copy ได้ 4725 · ถ้าวันหนึ่งปลายทางส่งเลขเต็มมา จะ copy เต็มเอง
  // ลูกตาจึงมีความหมายจริง: ปิด = xxxxxx4725 · เปิด = 4725 (เลขที่เรารู้จริง)
  // revert: ลบ acctDigits + acctCopy แล้วให้ CopyValue กลับไปใช้ acctFull || acctMasked
  const acctDigits = typeof acctMasked === 'string' ? (acctMasked.replace(/[^0-9]/g, '') || null) : null;
  const acctCopy = acctFull || acctDigits || acctMasked;
  // ==== [FEAT-20260801-SHOPAPIV1FIELDS] END

  // รอทำรายการ = รายการที่ยังไม่จบ จากข้อมูลจริงของปลายทาง
  // [FIX-20260801-PENDINGWDONLY] ผู้ใช้สั่ง "การ์ดนี้มีแค่รายการถอน ไม่มีฝาก"
  //   → นับเฉพาะ wdRows (ถอน) · depRows (ฝาก) ไม่นำมาแสดงในการ์ดนี้
  //   (depRows ยังใช้ในการ์ด "การเงิน" ด้านล่างตามเดิม · โครง kind:'dep'|'wd'
  //    + สาขา render ของ dep ยังคงไว้ เผื่อ revert ง่าย)
  // revert: ใส่ ...depRows.filter(isPendingRow).map(... kind:'dep' ...) กลับเข้า array
  /* [FEAT-20260905-CUSTPROV] `r.at ?? r.date` → `r.at`. Same two upstream
     spellings, resolved once on the back end (`row-paths.ts` → `money.at:
     ['at','date']`) instead of again in every row that reads this list. The
     WITHDRAW pipe is the one that feeds this card; the deposit side is
     `statement` and is frozen by the owner (11/08) — see the block below. */
  const pendingItems: { kind: 'dep' | 'wd'; at: any; amount: any; note?: string }[] = [
    ...(wdRows.filter(isPendingRow).map((r: any) => ({ kind: 'wd' as const, at: r.at, amount: r.amount }))),
  ];

  /* ==== [FEAT-20260810-PENDINGDEP] รายการ "รอฝาก" จาก statement[] ของ raw profile ====
   * เจ้าของสั่ง 2026-08-10: "ถ้ามียอดใน statement[] ของ raw profile ให้แสดงออกมาด้วย
   * ในช่องเดียวกัน แต่ header ในช่องแบ่งแท็บ ฝาก / ถอน"
   *
   * ⚠️ คนละแหล่งกับ "รอถอน" โดยเจตนา — ห้ามรวมท่อกัน:
   *   รอถอน  ← `finance.transactions.withdraw` (ของเดิม เจ้าของสั่งว่า "ห้ามเปลี่ยน")
   *   รอฝาก  ← `profile.transaction.statement[]` ซึ่งเป็น **ตัวเดียวกับที่ BE ใช้ match
   *            สลิป** (`statement_tx_path: data.profile.transaction` +
   *            filter provider/status ใน custom tool) ⇒ ยอดที่โชว์ที่นี่คือยอดเดียวกับ
   *            ที่ขึ้นบน divider ของ ticket เป๊ะ ๆ ไม่ใช่ตัวเลขคนละชุด
   *
   * ทำไมไม่ใช้ `depRows` (finance.transactions.deposit): นั่นคือ "ประวัติฝากที่จบแล้ว"
   * ใช้ในการ์ดการเงินด้านล่าง · รายการที่ยัง **รอ** อยู่คือ statement ที่ status
   * `waiting-deposit` ซึ่งอยู่คนละที่ · ยืนยันจากข้อมูลจริง (member a0d00000000000000000002b):
   *   statement 2 แถว amount 400 / 100 status `waiting-deposit` type `deposit`
   *   date = epoch **ms** (1784730217660) ⇒ `xpDT` แยกหน่วยเองได้อยู่แล้ว
   *
   * กรองด้วย `isPendingRow` ตัวเดียวกับฝั่งถอน (ไม่ใช่เทียบ `=== 'waiting-deposit'`)
   * เพราะปลายทางอาจสะกดสถานะค้างด้วยคำอื่น — เกณฑ์ "ไม่ใช่ success/cancel" ครอบได้กว่า
   * และ `type` ต้องเป็น deposit เท่านั้น กัน statement ฝั่งถอนหลุดมาซ้ำกับท่อเดิม
   * fallback: ไม่มี statement / เป็น array ว่าง / ไม่ใช่ array ⇒ `[]` การ์ดไม่พัง
   * (เจอจริงแล้วทั้งสองแบบ: member หนึ่งได้ 2 แถว อีกคน array ว่าง) */
  /* ⚠️⚠️ DEPOSIT SIDE = `statement`. DO NOT REWIRE IT.
   * Owner, 2026-08-11: **"ฝากมาจาก statement อย่าไปยุ่ง"** — the deposit tab reads
   * `profile.transaction.statement`, and that is deliberate, not a leftover.
   *
   * WHY IT MATTERS: `statement` is the SAME list the backend matches a slip against
   * (`statement_tx_path` + the provider/status filter on the payment tool), so the
   * amounts shown here are the ones an admin already sees on a case divider. Point
   * this at `finance.transactions.deposit` instead and the panel starts showing
   * FINISHED deposits — a different set of numbers that will not line up with the
   * ticket, and nothing will error to tell you.
   *
   * The withdraw side is a separate pipe (`finance.transactions.withdraw` /
   * `recent_withdrawals`) and is equally off-limits — owner said the withdraw data
   * must not change. ฝาก = statement · ถอน = finance · คนละท่อ ห้ามรวม */
  const stmtRows: any[] = Array.isArray(profile?.transaction?.statement)
    ? profile.transaction.statement
    : [];
  const pendingDeps: { kind: 'dep'; at: any; amount: any; note?: string; raw?: any }[] = stmtRows
    .filter((r: any) => String(r?.type || '').toLowerCase() === 'deposit' && isPendingRow(r))
    // [FEAT-20260810-PENDINGRAW] แนบแถวดิบทั้งก้อน (รวม info{} ที่ซ้อนอยู่) ไว้ให้ปุ่ม info
    // ไม่ตัด field ใด ๆ ที่นี่ — การ mask ทำตอนแสดงผล เพื่อให้จุดตัดสินใจอยู่ที่เดียว
    .map((r: any) => ({ kind: 'dep' as const, at: r.date ?? r.at, amount: r.amount, raw: r }));

  // ==== [FIX-20260801-PENDINGBACK] START — เอาการ์ด "รอทำรายการ" กลับมา
  // ประวัติของบล็อกนี้ (เขียนไว้กันงงรอบหน้า):
  //   [FIX-20260731-PENDINGSAMPLE] ใส่ค่าตัวอย่าง 2 แถวไว้ดูหน้าตา เพราะ API
  //                                ยังไม่เคยส่งรายการ pending จริงมาเลยสักตัว
  //   [FIX-20260801-PENDINGREAL]   ผู้ใช้สั่ง "ซ่อน tab นี้ไปเลย" → ตัดค่าตัวอย่างทิ้ง
  //   [FIX-20260801-PENDINGBACK]   ผู้ใช้สั่ง "เอารอทำรายการกลับมา" (ภาพอ้างอิงที่
  //                                ส่งมาโชว์การ์ดนี้พร้อม 2 แถวนั้น) → เอากลับ
  //
  // ⚠️⚠️ 2 แถวนี้เป็น **ค่าตัวอย่างสำหรับดูหน้าตา ไม่ใช่เงินของลูกค้าจริง**
  //     ข้อมูลจริงของบัญชีที่ตรวจแล้วยังไม่มีรายการค้างสักตัว (transactions ว่าง)
  // ⚠️ ของจริงชนะเสมอ: มีรายการค้างจริงแม้แต่ตัวเดียว จะใช้ของจริงทั้งหมด
  //    ค่าตัวอย่างจะไม่ถูกแตะเลย — ไม่ปนกับข้อมูลลูกค้า
  // ⚠️ เป็นค่าหน้าจอล้วน ไม่ได้ต่อ API เพิ่ม ไม่แตะเงื่อนไข/กฎ/สิทธิ์ใดๆ
  // TODO: เมื่อฝั่ง API ส่ง pending มาจริงแล้ว ให้ลบ SAMPLE_PENDING ทิ้ง
  //       แล้วเปลี่ยน pendingShown กลับเป็น pendingItems ตรงๆ
  // revert: ลบบล็อกนี้ แล้วใช้ `const pendingShown = pendingItems;`
  // [FIX-20260801-PENDINGWDONLY] ค่าตัวอย่างเหลือเฉพาะ "ถอน" ให้ตรงกฎ "มีแค่ถอน"
  // revert: ใส่ { kind: 'dep', ... } กลับเข้า array
  const SAMPLE_PENDING: typeof pendingItems = [
    { kind: 'wd', at: '2026-07-21T14:10:00', amount: 500, note: t('ticketui.panel.sample_approved', 'อนุมัติ') },
  ];
  const pendingShown = pendingItems.length > 0 ? pendingItems : SAMPLE_PENDING;
  // ==== [FIX-20260801-PENDINGBACK] END

  /* [FEAT-20260810-PENDINGDEP] แท็บไหน active + การ์ดจะโชว์เมื่อไหร่
   * เจ้าของสั่ง: "ถ้าอันไหนมีข้อมูลให้ active tab นั้น แต่ถ้ามีทั้งคู่เอาฝากขึ้นก่อน"
   * ⇒ ลำดับแท็บ (ซ้าย→ขวา) และ badge เรียง **ตาม active** ⇒ ฝากมาก่อนเมื่อฝากมีข้อมูล
   * `depFirst` เป็นตัวตัดสินเดียวของทั้งลำดับแท็บและลำดับ badge จึงไม่มีทางขัดกันเอง
   *
   * [FIX-20260811-PENDINGTABALWAYS] เจ้าของสั่งเพิ่ม: "ไม่ว่าจะฝากหรือถอนต้องแสดงแท็บ
   * ตลอด ถ้าไม่มีก็ '- รายการ' ยกเว้น badge แสดงเฉพาะเวลามีตัวเลข"
   * ⇒ เลิกซ่อนแท็บเวลามีฝั่งเดียว (ของเดิมซ่อนแล้วโชว์ลิสต์ตรง ๆ) เพราะแอดมินมองไม่ออกว่า
   *   "ไม่มีรายการ" กับ "ไม่มีแท็บนี้" ต่างกันยังไง · badge ยังซ่อนตอนเป็น 0 อยู่
   *   จึงไม่มีวงกลมเลข 0 มากวน
   * ⚠️ ไม่แตะ `pendingShown` (ฝั่งถอน) เลย — เจ้าของสั่งว่าข้อมูลถอนห้ามเปลี่ยน
   *    ซึ่งรวมถึง SAMPLE_PENDING ที่อาจโชว์แทนของจริง (ดูคำเตือนข้างบน)
   * fallback: ไม่มีทั้งคู่ ⇒ การ์ดไม่ขึ้นเลย (เงื่อนไขเดิม `pendingShown.length > 0`
   *    ยังอยู่ครบ) ⇒ กรณีไม่มีรายการไม่พัง */
  const depFirst = pendingDeps.length > 0;
  const pendingTotal = pendingDeps.length + pendingShown.length;

  return (
    <div className="relative flex-1 overflow-y-auto custom-scrollbar bg-gray-50 p-3 space-y-3">
      {/* [FEAT-20260729-COPYALL] shared toast for every copy button below */}
      {copyToast && (
        <div className={`sticky top-0 z-30 -mt-1 mb-1 mx-auto w-fit px-3 py-1 rounded-lg text-white text-[11px] font-bold shadow-lg animate-in fade-in slide-in-from-top-1 duration-150 ${copyToast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          {/* [FIX-20260816-COPYHTTP] red + honest wording when the copy failed */}
          {copyToast.ok ? t('ticket.copied') : t('ticketui.panel.copy_failed', 'คัดลอกไม่สำเร็จ')} · {copyToast.label}
        </div>
      )}

      {/* ==== [FEAT-20260810-PENDINGRAW] modal ข้อมูลดิบของรายการรอฝาก ====
          เจ้าของสั่งให้ "ดูได้ทั้งก้อน" รวม `info{}` ที่ซ้อนอยู่ · mask ตาม `pdMaskDeep`
          (ยอดเงิน/เวลา/ref_id/provider_code/statement_id/m_order_no เห็นครบ · นอกนั้นเบลอ)
          คลิกฉากหลังหรือปุ่ม ✕ เพื่อปิด — ไม่มี state อื่นถูกแตะ */}
      {rawPending && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setRawPending(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50">
              <span className="text-xs font-bold text-gray-700">raw · statement</span>
              <div className="flex items-center gap-2">
                {/* [FEAT-20260810-PENDINGRAW] ลูกตา = สลับ epoch ↔ dd/mm/yy hh:mm:ss
                    แปลงเฉพาะ key ที่เป็นเวลา (date/created_at/…) ไม่แตะ amount */}
                <button
                  type="button"
                  onClick={() => setRawDates((v) => !v)}
                  title={rawDates ? t('ticketui.panel.show_raw_epoch', 'กลับไปดู epoch ดิบ') : t('ticketui.panel.humanize_dates', 'แปลงวันเวลาให้อ่านออก')}
                  className={`transition-colors ${rawDates ? 'text-primary' : 'text-gray-400 hover:text-gray-700'}`}
                >
                  {rawDates ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => setRawPending(null)}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <pre className="p-3 text-[11px] font-mono text-gray-700 overflow-auto custom-scrollbar whitespace-pre">
{JSON.stringify(rawDates ? pdHumanizeDates(pdMaskDeep(rawPending)) : pdMaskDeep(rawPending), null, 2)}
            </pre>
          </div>
        </div>
      )}
      {/* ==== [FIX-20260801-CARDCOLLAPSE] แท็บ "ข้อมูลส่วนตัว": การ์ดย่อทุกใบเป็น
           ค่าเริ่มต้น เหลือ "รอทำรายการ" (PanelCard defaultOpen={true}) กางใบเดียว
           ตามที่ผู้ใช้สั่ง — ที่เหลือ (ข้อมูล LINE / ข้อมูลลูกค้า / โปรโมชั่น / สินค้า /
           การเงิน / โบนัส / กิจกรรม + MemberDetailCard) เริ่มแบบย่อ
           ⚠️ "ผู้ดูแลปัจจุบัน" (CurrentAdminCard) เป็นแถบสถานะ ไม่ใช่การ์ดพับได้ จึงไม่แตะ
           ⚠️ แตะแค่ "สถานะเริ่มต้นของการแสดงผล" — ไม่แตะเงื่อนไข/ข้อมูล/สิทธิ์/การเรียก API
           ⚠️ แท็บ "ดำเนินการ" (โน้ต + ป้าย ใน CustomerCards.tsx) ไม่แตะ = ยังกางหมดเหมือนเดิม
           revert: การ์ดที่ระบุ defaultOpen={false} กลับเป็น {true} + MemberDetailCard
                   useState(false) กลับเป็น useState(true) */}
      {/* [FEAT-20260731-CONTACTS] การ์ดย้ายไปไฟล์กลาง รับ 3 ค่าแทน ticket ทั้งก้อน */}
      <CurrentAdminCard jobStatus={ticket.job_status} chatStatus={ticket.chat_status} adminUser={ticket.admin_user_data} />

      {/* [FIX-20260731-PENDINGTOP] ย้ายขึ้นมาไว้เหนือการ์ด "ข้อมูล LINE"
           ผู้ใช้สั่ง "เพิ่มกรอบใหม่ด้วยไว้บนสุด เหนือข้อมูล LINE" — เดิมอยู่ล่างสุด
           ต้องเลื่อนหาทั้งที่เป็นรายการที่ต้องรีบดูที่สุด
           ⚠️ ย้ายตำแหน่งอย่างเดียว **เงื่อนไขการแสดงไม่แตะ** ยังเป็น
           pendingItems.length > 0 (เฉพาะรายการ status = pending จาก API จริง)
           แปลว่าโชว์เฉพาะลูกค้าที่มี raw profile + ลงทะเบียนแล้วเหมือนเดิม
           revert: ย้ายบล็อกนี้กลับไปไว้ใต้การ์ด "โปรโมชั่น" ตามเดิม */}
      {/* ── รอทำรายการ (ของจริง: เฉพาะ status = pending · ถ้ายังไม่มี = ค่าตัวอย่าง) ── */}
      {/* [FIX-20260731-PENDINGSAMPLE] หน้าตาการ์ดตามภาพที่ผู้ใช้ส่งมา:
          หัวมีไอคอนนาฬิกา + ป้ายนับกลม · แต่ละแถวเป็นการ์ดซ้อน
          มีวงกลมลูกศรลง/ขึ้น ซ้ายมือ และจำนวนเงิน +/- ขวามือ

          ผู้ใช้สั่ง: "แสดงก็ต่อเมื่อมี profile เงื่อนไขเดียวกับพวกกิจกรรม/โบนัส
                      + อย่าลืม expand/collapse ได้ default ย่อ"
          → ใช้ `{profile && (` แบบเดียวกับการ์ด กิจกรรม (activity) / โบนัส (bonus)
            และห่อด้วย <PanelCard defaultOpen={true}> เพื่อให้ย่อ/ขยายได้
            [FIX-20260801-CARDCOLLAPSE] การ์ดนี้คือ "ข้อยกเว้นใบเดียว" ที่ยังกางเป็น
            ค่าเริ่มต้น (defaultOpen={true}) — การ์ดอื่นในแท็บนี้ย่อหมด */}
      {/* [FIX-20260731-PENDINGHEAD] ผู้ใช้สั่ง "รอทำรายการ ฟ้อนสีส้มทั้ง dark + light
          + badge count ย้ายไปติดกับ label เลย" → ใช้ titleClassName + titleBadge
          (คลาส .tc .text-warning ประกาศไว้แล้วใน index.css · ธีม dark ใช้ส้มสว่างขึ้น)
          ⚠️ คอมเมนต์ต้องอยู่ "นอก" {profile && ( … ) เสมอ — วางคั่นระหว่าง `(`
             กับ element จะทำให้ JSX พังทันที (เคยพลาดมาแล้ว) */}
      {/* [FIX-20260801-PENDINGBACK] เงื่อนไขเดิม: แสดงเมื่อมี profile เหมือนการ์ด
          กิจกรรม/โบนัส · เงื่อนไข `pendingShown.length > 0` ยังคาไว้ด้วยเพื่อกัน
          "การ์ดเปล่าขึ้นเลข 0" ถ้าวันหนึ่งค่าตัวอย่างถูกถอดออกตามที่จดไว้ด้านบน */}
      {/* [FEAT-20260810-PENDINGDEP] badge 2 ใบ เขียว=ฝาก ส้ม=ถอน เรียงตาม active tab
          โชว์ใบที่ "มีของ" เท่านั้น ⇒ ไม่มีฝากก็เห็นแค่ส้มใบเดียวเหมือนเดิมเป๊ะ */}
      {/* [FIX-20260811-PENDINGFOLD] เจ้าของสั่ง 2026-08-11: "ถ้าถอน 0 ฝาก 0 …
          เปลี่ยนให้พับ แทน แล้วค่าข้างใน - กับ 0 ตามสูตร"
          เดิมเงื่อนไขเป็น `pendingTotal > 0` ⇒ ว่างทั้งคู่ **การ์ดหายไปเลย** ซึ่งอ่านไม่ออกว่า
          "ตรวจแล้วไม่มี" หรือ "ไม่มีฟีเจอร์นี้" — เหตุผลเดียวกับที่เคยแก้เรื่องแท็บให้โชว์ตลอด
          ⇒ ตอนนี้ **โชว์การ์ดเสมอเมื่อมี profile** แต่ **พับไว้** เมื่อว่างทั้งสองฝั่ง
          ข้างในยังใช้สูตรเดิมทุกอย่าง: แท็บโชว์ `(0)` · เนื้อในโชว์ `- รายการ` · badge ซ่อนตอน 0
          ⇒ กางดูได้ว่าตรวจแล้วจริง ไม่ใช่หายไปเงียบ ๆ */}
      {profile && (
      <PanelCard
        title={t('ticketui.panel.pending_items', 'รอทำรายการ')}
        icon={<History size={14} />}
        defaultOpen={pendingTotal > 0}
        titleClassName="text-warning"
        titleBadge={
          <span className="ml-1 inline-flex items-center gap-1">
            {(depFirst
              ? [
                  { n: pendingDeps.length, cls: 'bg-green-500' },
                  { n: pendingShown.length, cls: 'bg-warning' },
                ]
              : [
                  { n: pendingShown.length, cls: 'bg-warning' },
                  { n: pendingDeps.length, cls: 'bg-green-500' },
                ]
            )
              .filter((b) => b.n > 0)
              .map((b, i) => (
                <span
                  key={i}
                  className={`w-5 h-5 grid place-items-center text-[10px] font-bold ${b.cls} text-white rounded-full`}
                >
                  {b.n}
                </span>
              ))}
          </span>
        }
      >
        {/* [FIX-20260811-PENDINGTABALWAYS] แท็บ 2 ใบตลอด ไม่ว่าฝั่งไหนจะว่าง
            ฝั่งที่ไม่มีรายการโชว์ "- รายการ" ⇒ แอดมินอ่านออกว่า "ตรวจแล้วไม่มี"
            ต่างจากของเดิมที่ซ่อนแท็บทิ้ง ซึ่งดูเหมือนไม่มีฟีเจอร์นั้น */}
        <PanelTabs
          initialKey={depFirst ? 'dep' : 'wd'}
          tabs={(depFirst ? ['dep', 'wd'] : ['wd', 'dep']).map((k) => {
            const rows = k === 'dep' ? pendingDeps : pendingShown;
            return {
              key: k,
              // จำนวนอยู่ในวงเล็บบนแท็บเสมอ (รวม 0) — คนละเรื่องกับ badge บนหัวการ์ด
              // ที่เจ้าของสั่งให้ซ่อนตอนเป็น 0
              label: `${k === 'dep' ? t('ticketui.panel.deposit', 'ฝาก') : t('ticketui.panel.withdraw', 'ถอน')} (${rows.length})`,
              content:
                rows.length > 0 ? (
                  <PendingList rows={rows} onInfo={setRawPending} />
                ) : (
                  <div className="text-xs text-gray-400 italic py-4 text-center">- {t('ticketui.panel.items', 'รายการ')}</div>
                ),
            };
          })}
        />
      </PanelCard>
      )}

      {/* [FEAT-20260816-WALLETPAYCARD] "ผลตรวจ WalletPay" — its own card, directly under
          "รอทำรายการ" as the owner asked. Self-contained (own folder, own service,
          lazy, fail-soft): it can only ever render an empty card, never break this
          panel. revert: delete this line + `components/member/walletpay/`.
          [FEAT-20260907-PROVCONDS] gated by the provider condition stamp:
          WalletPay is shop-api's payment world; loan_v1 stamps `show_walletpay_card:false`.
          `!== false` = absent (shop-api stamps nothing) keeps today's screen. */}
      {showWalletpayCard && rawProfile?.show_walletpay_card !== false && (
        <WalletpayResultCard lineUserId={ud?.line_user_id} />
      )}

      {/* ==== [FEAT-20260729-LINEINFO] START — LINE identity, always available
          🔒 AUTO track — to_dev_auto branch only

          Sits above the customer card and shows regardless of whether the
          customer ever linked an account: the LINE display name and user id are
          the only two things guaranteed to exist for every conversation, and
          agents need the user id to look someone up upstream.

          Collapsed by default when API data exists — that card is the one people
          want open — and expanded when it does not, so the panel is never empty.

          revert: delete this block. */}
      <PanelCard
        title={t('ticket.line_info')}
        icon={<LineLogoIcon className="w-3.5 h-3.5" />}
        // [FIX-20260731-PANELCOLLAPSE] เดิม `!xp` = เปิดเมื่อยังไม่มีข้อมูล API
        // [FIX-20260801-CARDCOLLAPSE] ย่อทุกใบในแท็บ "ข้อมูลส่วนตัว" เหลือ "รอทำรายการ"
        //   กางใบเดียว — การ์ดนี้จึงย่อเก็บเป็นค่าเริ่มต้น
        // revert: กลับเป็น defaultOpen={!xp} (หรือ {true})
        defaultOpen={false}
      >
        <div className="space-y-2.5">
          <PanelRow label={t('ticket.line_display_name')}>
            <CopyValue value={ud?.display_name} onCopied={fireCopyToast} copyLabel={t('ticket.copy_line_display_name')} />
          </PanelRow>
          <PanelRow label={t('ticket.line_user_id')}>
            {/* [FEAT-20260729-IDSHORT] shortened so the label stays on one line */}
            <CopyValue value={ud?.line_user_id} mono shorten={14} onCopied={fireCopyToast} copyLabel={t('ticket.copy_line_user_id')} />
          </PanelRow>
          {/* [FEAT-20260729-OANAME] which OA this conversation belongs to.
              An agent covering several OAs could not tell them apart from this
              panel — the customer's identity was here, but not which account
              they were talking to. Hidden when the hook cannot be resolved
              rather than printing an empty row. */}
          <PanelRow label={t('ticket.line_oa')} last>
            {/* [FEAT-20260815-LINEQUOTA] ⓘ → this OA's remaining push quota.
                Owner, 15/08: "กดตรง info icon line oa … ส่ง hook id ไป get ข้อมูล".
                Reuses the `hookId` this component already resolved for the
                link/unlink buttons — no new prop, no new lookup. Hidden when
                the hook is unknown rather than opening a dialog that can only
                fail. Sits BEFORE the copy control so copying stays the last,
                most-used action on the row. */}
            {hookId && (
              <button
                type="button"
                onClick={() => setQuotaOpen(true)}
                className="shrink-0 p-1 rounded text-gray-300 hover:text-primary hover:bg-gray-100 transition-colors"
                title={t('ticketui.panel.oa_quota_tip', 'โควตาข้อความของ LINE OA นี้')}
              >
                <Info size={13} />
              </button>
            )}
            <CopyValue value={oaLabel} onCopied={fireCopyToast} copyLabel={t('ticket.copy_line_oa')} />
          </PanelRow>
        </div>
      </PanelCard>
      {/* ==== [FEAT-20260729-LINEINFO] END */}

      {/* ยังไม่มีข้อมูล Shop-API (ยังไม่ผูกบัญชี / webhook ยังไม่เคยดึงสำเร็จ)
          [FEAT-20260907-PROVCONDS] `xp` reads shop-api's shape (`data.profile`) —
          CORRECT for shop-api, meaningless for other providers. When the active
          provider declares its own linked-marker the BE stamps
          `has_member_data` and it wins; absent (shop-api) ⇒ `xp` decides exactly
          as today. loan_v1 linked ⇒ true (box hidden); its unlinked members
          return a null rawProfile ⇒ box shows, which is right. */}
      {!xp && rawProfile?.has_member_data !== true && (
        <div className="bg-white border border-border rounded-lg shadow-sm p-4 text-center text-xs text-gray-400">
          {/* [FEAT-20260729-MEMBERDETAIL] ฝั่ง API = "ข้อมูลสมาชิก" (คู่กับกล่อง "ข้อมูลทั่วไป" ที่กรอกเอง) */}
          {rawLoading ? t('ticketui.panel.loading_customer', 'กำลังโหลดข้อมูลลูกค้า…') : t('ticketui.panel.no_member_api', 'ยังไม่มีข้อมูลสมาชิกจาก API')}
          {/* [FEAT-20260729-CLINKEDIT] แอดมินลงทะเบียนแทนลูกค้า — turnaround เดียวกับ
              ลูกค้าลงทะเบียนเองทุกขั้น (เปิด landing ของ hook · โหมด register) */}
          {/* Gated only by the data the action needs: a LINE user to register,
              and a finished profile load. Both pages reach this identically. */}
          {/* [FEAT-20260907-PROVCONDS] the register ACTION is shop-api's
              customer-link flow — providers may switch it off
              (`show_register_action !== false`; absent = today). The label
              above stays for everyone. */}
          {!rawLoading && channelUserId && showRegisterAction && rawProfile?.show_register_action !== false && (
            <div className="mt-2">
              <button type="button" disabled={adminActing !== null}
                onClick={() => openAdminLanding('register')}
                // [FIX-20260731-LIGHTBTN] เดิมใช้ `bg-primary` ซึ่ง **ไม่มีอยู่จริง**
                // (`--color-primary` ไม่เคยถูกประกาศใน @theme — มีแต่ primary-400/500/600/700)
                // Tailwind จึงไม่ compile คลาสนี้ออกมาเลย ปุ่มเลยไม่มีสีพื้น
                // กลายเป็นเทากลืนพื้นหลังในธีม light
                // ใช้ blue-600 = สีฟ้าที่ระบบใช้อยู่แล้ว (แท็บ active, การ์ดที่เลือก)
                // revert: กลับเป็น bg-primary hover:opacity-90
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40">
                {adminActing === 'register' ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                {t('ticketui.panel.register_customer', 'ลงทะเบียนให้ลูกค้า')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* [FEAT-20260729-CLINKEDIT] confirm ถอนการผูก + ผลการทำรายการ */}
      {/* ==== [FEAT-20260730-CLEARCOPY] START — ข้อความยืนยันตามที่ผู้ใช้กำหนด
          เดิม: "ถอนการผูกบัญชี / ยืนยันถอนการผูกบัญชีของลูกค้าคนนี้?" + อธิบายกลไก
          ใหม่: พูดจากมุมผลลัพธ์ ("เคลียร์ข้อมูล") + **ระบุตัวลูกค้าให้เห็นชัด**
          ก่อนกดยืนยัน เพราะเป็นการลบข้อมูลที่กู้คืนไม่ได้ — เห็นชื่อ/เบอร์แล้ว
          จะรู้ทันทีว่ากำลังจะเคลียร์ถูกคนไหม
          ⚠️ fallback เป็น "-" เมื่อไม่มีค่า (ตามที่ผู้ใช้สั่ง "กันไว้หากพลาด")
          จะได้ไม่เห็นข้อความขาดหายจนอ่านแล้วสับสนว่าระบบดึงข้อมูลไม่ได้
          revert: คืนข้อความเดิม 2 modal (grep FEAT-20260730-CLEARCOPY) */}
      <ConfirmModal
        isOpen={confirmUnlink}
        title={t('ticketui.panel.confirm_clear_title', 'ยืนยันการลบข้อมูลโปรไฟล์')}
        /* [FEAT-20260802-CLEARRAWPROFILE] บอกให้ชัดว่าลบเฉพาะข้อมูลที่ระบบเก็บไว้
           ไม่ได้ถอนการผูกที่ปลายทาง (ปุ่มนี้ไม่ยิง unlink แล้ว) */
        message={t('ticketui.panel.confirm_clear_msg', 'ลบข้อมูลโปรไฟล์ที่ระบบเก็บไว้ ใช่หรือไม่\n\nชื่อ {name}\nเบอร์ {phone}\n\n(ไม่ได้ถอนการผูกบัญชีที่ปลายทาง)').replace('{name}', String(clearTargetName)).replace('{phone}', String(clearTargetPhone))}
        confirmLabel={t('common.confirm', 'ยืนยัน')}
        type="danger"
        /* [FEAT-20260803-CLEAR2STEP] ชั้นแรกไม่ลบทันทีแล้ว — ส่งต่อไปชั้นสอง */
        onConfirm={() => { setConfirmUnlink(false); setClearAck(false); setConfirmUnlink2(true); }}
        onClose={() => setConfirmUnlink(false)}
      />
      {/* ==== [FEAT-20260803-CLEAR2STEP] ยืนยันชั้นที่สอง — ต้องติ๊กก่อนถึงกดได้
          ผู้ใช้สั่ง 2026-08-03: double confirm · ชั้นสองมี checkbox · โชว์ชื่อ+เบอร์ · กัน error

          ⚠️ ชื่อ/เบอร์ใช้ตัวแปรชุดเดียวกับชั้นแรก (clearTargetName / clearTargetPhone)
             ซึ่งไล่ลำดับเดียวกับที่ doUnlink ใช้จริง — จอกับของที่ลบต้องเป็นคนเดียวกัน
             ไม่มีค่า = "-" ไม่ปล่อยว่างจนอ่านแล้วนึกว่าระบบพัง
          ⚠️ ไม่ทำ modal เองจาก div — ใช้ทรงเดียวกับ modal อื่นในไฟล์นี้ (z-[80], backdrop,
             stopPropagation) จะได้ไม่มีพฤติกรรมปิด/ซ้อนที่ต่างจากตัวอื่น
          revert: ลบ block นี้ + คืน onConfirm ของ ConfirmModal ชั้นแรกเป็น doUnlink */}
      {confirmUnlink2 && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in"
          onClick={() => { setConfirmUnlink2(false); setClearAck(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/60 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-100 text-rose-600 shrink-0">
                <Trash2 size={18} />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-rose-700 leading-tight">{t('ticketui.panel.confirm_again', 'ยืนยันอีกครั้ง — ลบแล้วกู้คืนไม่ได้')}</p>
                <p className="text-xs text-rose-500/80">{t('ticketui.panel.profile_will_delete', 'ข้อมูลโปรไฟล์ที่ระบบเก็บไว้จะถูกลบทิ้ง')}</p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* ชื่อ + เบอร์ ของคนที่กำลังจะโดนลบ — ให้เห็นชัดว่าเล็งถูกคน */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-xs font-medium text-slate-500 shrink-0">{t('ticketui.panel.full_name', 'ชื่อ-นามสกุล')}</span>
                  <span className="text-sm font-bold text-slate-800 truncate" title={clearTargetName}>{clearTargetName}</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-xs font-medium text-slate-500 shrink-0">{t('ticket.phone', 'เบอร์โทร')}</span>
                  <span className="text-sm font-bold text-slate-800 truncate" title={clearTargetPhone}>{clearTargetPhone}</span>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                {t('ticketui.panel.clear_scope_lead', 'ลบเฉพาะข้อมูลที่ระบบเก็บไว้ ·')} <span className="font-bold">{t('ticketui.panel.clear_scope_bold', 'ไม่ได้ถอนการผูกบัญชีที่ปลายทาง')}</span>
              </p>

              {/* 🔴 ปุ่มยืนยันยังกดไม่ได้จนกว่าจะติ๊ก */}
              <label className="inline-flex w-fit items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={clearAck}
                  onChange={(e) => setClearAck(e.target.checked)}
                  className="accent-rose-500 rounded w-5 h-5 mt-0 shrink-0"
                />
                <span className="text-sm font-medium text-slate-600 group-hover:text-slate-800">
                  {t('ticketui.panel.ack_lead', 'เข้าใจแล้วว่าลบข้อมูลของ')} <span className="font-bold text-slate-800">{clearTargetName}</span> {t('ticketui.panel.ack_tail', 'และกู้คืนไม่ได้')}
                </span>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirmUnlink2(false); setClearAck(false); }}
                className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all"
              >
                {t('common.cancel', 'ยกเลิก')}
              </button>
              <button
                type="button"
                disabled={!clearAck || adminActing !== null}
                onClick={() => { setConfirmUnlink2(false); setClearAck(false); doUnlink(); }}
                className="px-5 py-2 rounded-lg text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all inline-flex items-center gap-2"
              >
                {adminActing === 'unlink' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {t('ticketui.panel.delete_data', 'ลบข้อมูล')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ==== [FEAT-20260803-CLEAR2STEP] END */}

      {/* ==== [FEAT-20260730-CLEARCOPY] END */}
      <AlertModal
        isOpen={!!adminMsg}
        type={adminMsg?.title.includes('ไม่สำเร็จ') ? 'error' : 'info'}
        title={trAdminMsg(adminMsg?.title || '')}
        message={trAdminMsg(adminMsg?.message || '')}
        onClose={() => setAdminMsg(null)}
      />

      {/* ==== [FEAT-20260729-MEMBERDETAIL] START — กล่อง "ข้อมูลทั่วไป" แก้เองได้
          🔒 สาย AUTO — to_dev_auto เท่านั้น

          ที่มา: OA ที่ยังไม่ผูกบัญชี/ปลายทางยังดึงไม่ได้ panel จะว่างเปล่า
          แอดมินไม่มีที่จดข้อมูลลูกค้าเลย → ลอกไอเดียจากเส้น acme ที่เก็บ
          `Member.detail` เป็นสตริงคั่นด้วย "|" 3 ช่อง (ชื่อ|เบอร์|เลขสัญญา)
          — field นี้มีอยู่แล้วใน schema และ FE มี parseCustomerDetail() อยู่แล้ว
          จึงไม่ต้องเพิ่ม schema/endpoint ใหม่เลย (BE: PATCH /line-users/:id/detail)

          กติกาที่ผู้ใช้กำหนด (2026-07-29):
            - มี profile จาก API → ซ่อนกล่องนี้ (ของจริงชนะเสมอ ไม่ให้สับสน)
            - ไม่มี profile      → โชว์ + แก้ไขได้ แยกเป็น 3 ช่อง
          revert: ลบบล็อก START→END นี้ทั้งก้อน */}
      {/* [FEAT-20261015-MEMBERDETAIL] shop-api (rule null): exactly `!xp && !rawLoading` as above ·
          a provider rule (loan): the provider's own `has_member_data` decides "registered" */}
      {showMemberDetailCard(memberDetailRule, { xp, rawLoading, registered: rawProfile?.has_member_data === true }) && (
        <MemberDetailCard source={ticket} rule={memberDetailRule} registered={rawProfile?.has_member_data === true} />
      )}
      {/* ==== [FEAT-20260729-MEMBERDETAIL] END */}

      {/* ── ข้อมูลลูกค้า (จริง ← profile) ── */}
      {/* [REFACTOR-20260905-CUSTPROV] NOT MOVED — left behind on purpose.
          `test/devRemoveButton.value.test.ts` reads this file's RAW SOURCE
          TEXT — three exact call-site substrings from the dev-remove button
          below, not rendered output — to prove the profile-wipe button sits
          in this exact header. Moving this card's JSX out makes those
          substrings vanish from this file and that suite goes red with no
          fix available under this task's rules (that test file may not be
          edited). Left here verbatim — see the task report for the other two
          cards this also blocks (การเงิน / กิจกรรม, both anchored the same
          way by `test/pointRounds.test.ts`).
          ⚠️ do not quote the button's own onClick/condition text inside THIS
          comment — an earlier draft did, and the duplicate match shifted
          every `indexOf()` in that test file and failed it a different way. */}
      {profile && (
      <PanelCard title={t('ticketui.panel.customer_info', 'ข้อมูลลูกค้า')} icon={<UserIcon size={14} />}
        // [FIX-20260801-CARDCOLLAPSE] ย่อเป็นค่าเริ่มต้น (เหลือ "รอทำรายการ" กางใบเดียว)
        defaultOpen={false}
        badge={
          /* [FEAT-20260729-CLINKEDIT] ปุ่มแก้ไข/ถอน อยู่กลางระหว่าง label กับ tier
             (ตำแหน่งตามที่สั่ง) — stopPropagation กันไปโดน toggle เปิด/ปิดการ์ด */
          <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {/* [FEAT-20260801-LINKCAPS] โชว์เฉพาะตอน tool ของ OA นี้มีเส้นนั้นจริง
                (ยังไม่รู้/ถามไม่ได้ = โชว์ไว้ก่อน ดูเหตุผลที่ประกาศตัวแปร) */}
            {canEdit && (
            <button type="button" disabled={adminActing !== null}
              onClick={() => openAdminLanding('edit')}
              className="p-1 rounded text-sky-600 hover:bg-sky-100 disabled:opacity-40"
              title={t('ticketui.panel.edit_link_tip', 'แก้ไขการผูกบัญชี — เปิดหน้าลงทะเบียนของ OA นี้ในโหมดแก้ไข (บันทึกว่าแอดมินคนไหนทำ)')}>
              {adminActing === 'edit' ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
            </button>
            )}
            {/* [UI-20260814-HIDECLEARPROFILE] Owner order 2026-08-14: hide the delete
                (trash) button on the "ข้อมูลลูกค้า" card header.

                Hidden with `false &&`, the same way this repo hides other controls —
                markup, handler, confirm modals and `clearRawProfile` all stay in place:
                  · nothing else on the card changes position; the tier badge and the
                    edit (pencil) button keep their exact places
                  · `setConfirmUnlink` / `confirmUnlink2` / `clearAck` state is untouched,
                    so no unused-var warning and no dead-code removal to review
                  · the BE route is untouched — this hides the entry point, it does not
                    remove the capability
                ⇒ re-show = delete `{false && (` and its closing `)}`, nothing else.
                ซ่อนปุ่มอย่างเดียว ของหลังบ้านยังอยู่ครบ เปิดกลับได้บรรทัดเดียว

                [TEST-20260820-DEVREMOVE] 2026-08-20: `false` became `canDevRemove`
                — the button is back, but ONLY for the `dev` account and ONLY as a
                testing tool. Everything the note above says still holds; the
                condition is the only thing that changed. To hide it from everyone
                again put `false &&` back in place of `canDevRemove &&`.
                ⚠️ And that alone does NOT close the capability — see the constant's
                doc: the server-side lock is what does. ซ่อน FE ไม่พอ ต้องปิดที่ BE ด้วย.

                [FEAT-20260802-CLEARRAWPROFILE] เดิม: ปุ่มนี้แสดงเสมอ (ก่อนหน้านั้นซ่อนด้วย
                canUnlink เพราะ Shop-API ไม่มีเส้น unlink) — ไม่ยิงปลายทาง ทำแค่ลบ
                raw_profile_data ฝั่งเรา */}
            {canDevRemove && (
            <button type="button" disabled={adminActing !== null}
              onClick={() => setConfirmUnlink(true)}
              className="p-1 rounded text-rose-500 hover:bg-rose-100 disabled:opacity-40"
              title={t('ticketui.panel.clear_tip', 'ลบข้อมูลโปรไฟล์ที่ระบบเก็บไว้ (ไม่ได้ถอนการผูกที่ปลายทาง)')}>
              {adminActing === 'unlink' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
            )}
            {/* [FEAT-20260803-PROFILEAT] ป้ายเวลาบนหัวการ์ด "ข้อมูลลูกค้า" ถูกถอดออก
                ผู้ใช้สั่ง 2026-08-03: หัวการ์ดแน่นไปแล้ว (ชื่อ + ปุ่มลบ + tier) เอาเวลาออก

                ⚠️ ถอดแค่ "ป้ายบนจอ" เท่านั้น — ฝั่งหลังบ้านยังทำงานครบเหมือนเดิม:
                   BE ยังเขียน Member.profile_data_updated_at ทุกครั้งที่ดึงสำเร็จ
                   และ ticketService ยังแนบ _profile_data_updated_at มากับก้อนข้อมูล
                   → อยากเอากลับมาโชว์เมื่อไหร่ ใส่ <span> กลับจุดนี้ได้เลย ไม่ต้องแก้ BE
                   (การ์ด "ข้อมูลเว็บ" ยังโชว์เวลาบนปุ่ม refresh ตามเดิม ไม่ได้ถูกแตะ) */}
            {profile.tier ?<span className="panel-badge panel-badge-purple inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">💎 {profile.tier.name || profile.tier.code} Tier {profile.tier.level ?? '-'}</span> : null}
          </span>
        }>
        {/* [FEAT-20260729-COPYALL] every value is copyable and every copy confirms.
            Phone goes first, above the member id, because it is what agents look
            up and paste most often. */}
        <div className="space-y-2.5">
          <PanelRow label={t('ticket.phone')}>
            <CopyValue value={profile.phone || getCustomerPhone(ud)} onCopied={fireCopyToast} copyLabel={t('ticket.copy_phone')} />
          </PanelRow>
          {/* [FEAT-20260729-FULLNAME] real name, directly under the phone.
              The raw Shop-API payload is provider-shaped, so the common field names
              are tried in turn; ud.full_name is the value our own customer-link
              flow writes and is the reliable fallback. The row hides itself when
              nothing is known rather than printing an empty line.
              revert: delete this PanelRow. */}
          {(profile.full_name || profile.name || ud?.full_name) && (
            <PanelRow label={t('ticket.full_name')}>
              <CopyValue
                value={profile.full_name || profile.name || ud?.full_name}
                onCopied={fireCopyToast}
                copyLabel={t('ticket.copy_full_name')}
              />
            </PanelRow>
          )}
          {/* [FIX-20260801-HIDEMEMBERID] ผู้ใช้สั่ง "ซ่อนรหัสสมาชิก"
              Shop-API ตัวจริง**ไม่มีฟิลด์นี้เลย** แถวนี้จึงขึ้น "-" ตลอดกาลกับทุกลูกค้า
              ⚠️ ซ่อนแบบมีเงื่อนไข ไม่ได้ลบทิ้ง — tool เจ้าอื่น (หรือ demo v4) ที่ส่ง
                 member_id มาจริง แถวนี้จะโผล่เองเหมือนเดิมทุกประการ
              revert: เอา `{profile.member_id && (` … `)}` ที่ครอบออก */}
          {profile.member_id && (
          <PanelRow label={t('ticket.member_id')}>
            <CopyValue value={profile.member_id} mono onCopied={fireCopyToast} copyLabel={t('ticket.copy_member_id')} />
          </PanelRow>
          )}
          {/* [FIX-20260801-WEBCODELABEL] label เดิมคือ "โดเมน" ซึ่งชวนเข้าใจผิดว่าเป็น URL
              — ค่าที่โชว์คือ web_code ของร้าน จึงเปลี่ยนคำใน i18n เป็น "เว็บ (web code)"
              และเอาไอคอน (i) ท้ายปุ่ม copy ออกตามที่ผู้ใช้สั่ง (มันไม่ได้ทำอะไรอยู่แล้ว
              — ไม่มี tooltip ไม่มี onClick เป็นแค่จุดสีฟ้าเฉยๆ)
              revert: ใส่ <Info size={11} className="text-blue-500 shrink-0" /> กลับ */}
          <PanelRow label={t('ticket.domain')}>
            <CopyValue value={profile.domain ?? profile.web_code} onCopied={fireCopyToast} copyLabel={t('ticket.copy_domain')} />
          </PanelRow>
          <PanelRow label={t('ticket.line_of_work')}>
            <CopyValue value={profile.line_of_work} onCopied={fireCopyToast} copyLabel={t('ticket.copy_line_of_work')} />
          </PanelRow>
          <PanelRow label={t('ticket.user_status')}>
            {/* [FEAT-20260801-SHOPAPIV1FIELDS] ผู้ใช้กำหนด: "ปกติ = enable · ไม่ใช่
                enable = แดง ระงับ" · เดิมเช็คแค่ === 'suspended' → ค่าอะไรก็ตาม
                ที่ไม่ใช่คำนั้นเป๊ะๆ (เช่น 'disable' ของจริง) จะขึ้นเขียวหมด = อันตราย
                → พลิกเป็น **allowlist**: เขียวเฉพาะค่าที่แปลว่าใช้งานได้ นอกนั้นแดง
                ⚠️ ต้องมี 'active' ด้วย เพราะ demo mock ส่งคำนี้ (ห้ามให้ demo เพี้ยน)
                ⚠️ ไม่มีค่ามาเลย = ไม่รู้ → คงพฤติกรรมเดิม (เขียว) ไม่กล่าวหาว่าถูกระงับ */}
            {String(profile.status ?? '') !== '' && !['enable', 'enabled', 'active', 'normal', 'ok'].includes(String(profile.status).toLowerCase())
              ? <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">{t('ticket.status_suspended')}</span>
              : <span className="text-[10px] font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">{t('ticket.status_active')}</span>}
          </PanelRow>
          {/* [FIX-20260801-REGDATE] รูปแบบเดียวกับวันที่บน bubble แชท */}
          <PanelRow label={t('ticket.registered_at')}><span className="font-medium text-xs">{xpDTFull(profile.registered_at)}</span></PanelRow>
          <PanelRow label={t('ticket.bank')}>
            {/* [FEAT-20260802-BANKNICE] เดิมโชว์ code ดิบ + ป้ายตัวอักษร → map ชื่อ+โลโก้จากทะเบียนกลาง */}
            <BankValue code={profile.bank?.code} fallbackName={profile.bank?.name} onCopied={fireCopyToast} copyLabel={t('ticket.copy_bank')} />
          </PanelRow>
          <PanelRow label={t('ticket.account_no')}>
            {/* Upstream masks this (xxx-x-x3003-x). Show the full number when one
                exists; the eye toggles, and copy always takes the full value. */}
            {/* [FEAT-20260801-SHOPAPIV1FIELDS] ไล่หาเลขเต็มจากทุกแหล่ง (ดู acctFull)
                ลูกตาโผล่เฉพาะตอนที่ "เลขเต็ม ≠ เลขที่ mask" จริงๆ · copy ใช้ value
                (= เลขเต็ม) เสมอ จึงไม่ติด mask ไม่ว่าลูกตาจะเปิดหรือปิด */}
            <CopyValue
              value={acctCopy}
              masked={acctCopy && acctMasked && acctCopy !== acctMasked ? acctMasked : null}
              onCopied={fireCopyToast}
              copyLabel={t('ticket.copy_account_no')}
              revealTitle={t('ticket.reveal_account_no')}
            />
          </PanelRow>
          <PanelRow label={t('ticket.account_name')}>
            <CopyValue value={profile.bank?.account_name} onCopied={fireCopyToast} copyLabel={t('ticket.copy_account_name')} />
          </PanelRow>
          <PanelRow label={t('ticket.truewallet')} last>
            <CopyValue value={profile.truewallet} onCopied={fireCopyToast} copyLabel={t('ticket.copy_truewallet')} />
          </PanelRow>
        </div>
      </PanelCard>
      )}

      {/* ==== [FIX-20260801-CARDORDER] ลำดับการ์ดตามภาพอ้างอิงที่ผู้ใช้ส่งมา
           ข้อมูลลูกค้า → โปรโมชั่น → สินค้าที่ซื้อล่าสุด → การเงิน → โบนัส → กิจกรรม
           เดิมเรียง กิจกรรม → โบนัส → การเงิน → สินค้า → โปรโมชั่น (สลับหัวท้ายกัน)
           ⚠️ ย้ายบล็อกทั้งก้อนล้วนๆ ไม่ได้แก้เงื่อนไข/ข้อมูล/props ในการ์ดใบไหนเลย
           ⚠️ การ์ด "ข้อมูล LINE" ไม่มีในภาพอ้างอิง จึงคงตำแหน่งเดิมไว้ (ห้ามตัด UI)
           revert: สลับลำดับ 5 บล็อกกลับเป็น activity → bonus → finance → products → promo */}
      {/* ── โปรโมชั่น (จริง ← promotion.current / ยอดกิจกรรม / outstanding) ── */}
      {/* [REFACTOR-20260905-CUSTPROV] moved to ./cards/PromotionCard.tsx —
          this guard stayed here (dev-local §6.3 moves markup, not the
          "when to render" decision). See that file's header for the props. */}
      {/* [FEAT-20260905-CUSTPROV] the raw `promotion` PROP is gone — it existed
          only so the card could read the activity-volume block's `unit` and `percent`,
          two vendor field names, and both now arrive inside the `promoActivityVolume`
          row as its `label` and `suffix`. The guard still asks the blob whether
          there is a promotion section at all; that is a "whether", not a
          "what". */}
      {promotion && (
        <PromotionCard
          promoName={promoName}
          promoToBreakdown={promoToBreakdown}
          promoToDone={promoToDone}
          promoToReq={promoToReq}
          promoToLabel={promoToLabel}
          promoToSuffix={promoToSuffix}
          promoOsBreakdown={promoOsBreakdown}
          promoOutstanding={promoOutstanding}
        />
      )}
      {/* ── สินค้าที่ซื้อล่าสุด (mock = promotion.top_products · จริง = recent_products) ── */}
      {/* [FIX-20260801-GAMESEMPTY] เดิมเงื่อนไขเป็น `promoProducts.length > 0` การ์ดจึง
          **หายไปทั้งใบ** เมื่อปลายทางส่ง `recent_products: []` มา (ซึ่งเป็นเคสปกติของ
          บัญชีที่ยังไม่เคยเล่น) ทำให้ลำดับการ์ดขยับไปมาแล้วแต่ข้อมูลลูกค้าแต่ละคน
          การ์ดใบอื่นทุกใบเวลาไม่มีข้อมูลยังขึ้นพร้อมข้อความ "ยังไม่มีประวัติ…" อยู่แล้ว
          → ใบนี้ทำให้เหมือนกัน (ผู้ใช้สั่ง "ห้ามตัด UI ออก" · ลำดับการ์ดคงที่)
          ⚠️ ไม่ได้แตะที่มาของข้อมูล — ยังอ่าน promoProducts ตัวเดิม
          revert: กลับเป็น `{promotion && promoProducts.length > 0 && (` แล้วลบ empty state */}
      {/* [REFACTOR-20260905-CUSTPROV] moved to ./cards/RecentProductsCard.tsx —
          this guard stayed here (dev-local §6.3 moves markup, not the
          "when to render" decision). See that file's header for the props. */}
      {promotion && <RecentProductsCard promoProducts={promoProducts} />}

      {/* ── การเงิน (จริง ← finance) ── */}
      {/* [REFACTOR-20260905-CUSTPROV] NOT MOVED — left behind on purpose.
          `test/pointRounds.test.ts` (its "source pins" section, T22) counts
          exactly 2 occurrences of one exact deposit/withdraw status
          expression inside this card's two history tables — a raw-source
          scan, not a rendered-output check. Moving this card's JSX out of
          this file drops that count to 0 and the suite goes red with no fix
          available under this task's rules (that test file may not be
          edited). Left here verbatim — see the task report; the same file
          also blocks "กิจกรรม" below (T21) and `devRemoveButton.value.test.ts`
          blocks "ข้อมูลลูกค้า" above. */}
      {finance && (
      <PanelCard title={t('ticketui.panel.finance', 'การเงิน')} icon={<StickyNote size={14} />} defaultOpen={false}
        badge={<span className="flex items-center gap-1">
          {finAutoDep
            ? <span className="panel-badge panel-badge-green text-[10px] font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">{t('ticketui.panel.dep_on', 'ฝาก: เปิด')}</span>
            : <span className="panel-badge panel-badge-red text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">{t('ticketui.panel.dep_off', 'ฝาก: ปิด')}</span>}
          {finAutoWd
            ? <span className="panel-badge panel-badge-green text-[10px] font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">{t('ticketui.panel.wd_on', 'ถอน: เปิด')}</span>
            : <span className="panel-badge panel-badge-red text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">{t('ticketui.panel.wd_off', 'ถอน: ปิด')}</span>}
        </span>}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200"><span className="text-sm text-gray-500 block mb-1">{t('ticketui.panel.credit_balance', 'เครดิตคงเหลือ')}</span><span className="text-xl font-bold text-gray-800">{xpAmt(finCredit)}</span></div>
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200"><span className="text-sm text-gray-500 block mb-1">{t('ticketui.panel.wallet_balance', 'เงินค้างในกระเป๋า')}</span><span className="text-xl font-bold text-gray-800">{xpAmt(finWallet)}</span></div>
        </div>
        <PanelTabs tabs={[
          { key: 'deposit', label: t('ticketui.panel.dep_history', 'ประวัติฝาก'), content: (
            <div className="space-y-1">
              <div className="flex justify-between items-center bg-green-50 p-2 rounded-lg border border-green-100 mb-3"><span className="text-sm font-bold text-green-800">{t('ticketui.panel.dep_total', 'ยอดฝากรวม')}</span><span className="font-bold text-green-700 text-base">{xpAmt(finDepTotal)}</span></div>
              {/* [FEAT-20260801-SHOPAPIV1FIELDS] ใช้ depRows ที่แปลงชื่อไว้แล้ว
                  (mock = recent_deposits · ของจริง = transactions.deposit)
                  เดิมตรงนี้อ่าน finance.recent_deposits ตรงๆ ประวัติจึงไม่เคยขึ้น */}
              {depRows.length > 0 ? (<>
                <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1"><span className="w-20">{t('common.date', 'วันที่')}</span><span className="flex-1 text-center">{t('ticketui.panel.amount', 'ยอดเงิน')}</span><span className="w-20 text-right">{t('ticketui.panel.status', 'สถานะ')}</span></div>
                {depRows.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}><span className="text-gray-600 w-20">{xpDT(h.at)}</span><span className="flex-1 text-center font-bold text-green-600">+{xpAmt(h.amount)}</span>{/* [FIX-20260825-DEPSTATUS] เจ้าของ 25/08: *"ประวัติฝาก ช่องทาง ให้เปลี่ยน
                        ไปอ่านสถานะ และแปล เหมือน ประวัติถอน"*
                        เดิมหัวคอลัมน์เขียนว่า "ช่องทาง" แต่ค่าที่โชว์เป็นสถานะเมื่อมี
                        และตกไปเป็นช่องทางเมื่อไม่มี ⇒ คอลัมน์เดียวโชว์ของสองชนิด
                        ตอนนี้อ่านสถานะอย่างเดียว และ fallback เป็น "สำเร็จ" ตัวเดียว
                        กับประวัติถอน (`xpStatusTH` คืนค่าว่างเมื่อสำเร็จ) */}
                    <span className="w-20 text-right text-gray-600 text-xs">{okText(xpStatusTH(h.status) || 'สำเร็จ')}</span></div>
                ))}
              </>) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_dep_history', 'ยังไม่มีประวัติฝาก')}</div>}
            </div>
          ) },
          { key: 'withdraw', label: t('ticketui.panel.wd_history', 'ประวัติถอน'), content: (
            <div className="space-y-1">
              <div className="flex justify-between items-center bg-red-50 p-2 rounded-lg border border-red-100 mb-3"><span className="text-sm font-bold text-red-800">{t('ticketui.panel.wd_total', 'ยอดถอนรวม')}</span><span className="font-bold text-red-700 text-base">{xpAmt(finWdTotal)}</span></div>
              {wdRows.length > 0 ? (<>
                <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1"><span className="w-20">{t('common.date', 'วันที่')}</span><span className="flex-1 text-center">{t('ticketui.panel.amount', 'ยอดเงิน')}</span><span className="w-20 text-right">{t('ticketui.panel.status', 'สถานะ')}</span></div>
                {wdRows.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}><span className="text-gray-600 w-20">{xpDT(h.at)}</span><span className="flex-1 text-center font-bold text-red-500">-{xpAmt(h.amount)}</span><span className="w-20 text-right text-gray-600 text-xs">{okText(xpStatusTH(h.status) || 'สำเร็จ')}</span></div>
                ))}
              </>) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_wd_history', 'ยังไม่มีประวัติถอน')}</div>}
            </div>
          ) },
        ]} />
      </PanelCard>
      )}

      {/* ── โบนัส: เงินคืน / แนะนำเพื่อน (จริง ← bonus) ── */}
      {/* [REFACTOR-20260905-CUSTPROV] moved to ./cards/BonusCard.tsx — this
          guard stayed here (dev-local §6.3 moves markup, not the "when to
          render" decision). See that file's header for the props. */}
      {bonus && (
        <BonusCard
          cbPending={cbPending}
          cbClaimed={cbClaimed}
          cbHistory={cbHistory}
          rfPending={rfPending}
          rfClaimed={rfClaimed}
          rfHistory={rfHistory}
          rfFriends={rfFriends}
        />
      )}

      {/* ── กิจกรรม: เหรียญ / รอบสะสมแต้ม (จริง ← activity) ── */}
      {/* [REFACTOR-20260905-CUSTPROV] NOT MOVED — left behind on purpose.
          `test/pointRounds.test.ts` (its "source pins" section, T21) does a
          raw-source scan for the exact call that prints the point-round count
          inside this card's รอบสะสมแต้ม tab — proof that the screen reads the
          computed value and not a raw upstream field. Moving this card's
          JSX out of this file makes that substring vanish and the suite goes
          red with no fix available under this task's rules (that test file
          may not be edited). Left here verbatim — see the task report; the
          same file also blocks "การเงิน" above (T22), and
          `devRemoveButton.value.test.ts` blocks "ข้อมูลลูกค้า" further up. */}
      {activity && (
      <PanelCard title={t('ticketui.panel.activity', 'กิจกรรม')} icon={<MessageSquare size={14} />} defaultOpen={false}>
        <PanelTabs tabs={[
          { key: 'coins', label: t('ticketui.panel.coins', 'เหรียญ'), content: (
            <div className="space-y-3">
              <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                <span className="text-sm text-yellow-700 font-bold">{t('ticketui.panel.coins_latest', 'เหรียญล่าสุดที่มี')}</span>
                {/* [FEAT-20260905-CUSTPROV] `cell()` only because the value now
                    arrives as `unknown` off the wire — React cannot render
                    `unknown`, and `String()` would print the word "undefined" on
                    a customer's card. Same characters on screen either way. */}
                <span className="text-lg font-bold text-yellow-600">🪙 {cell(acCoinBal ?? 0)}</span>
              </div>
              {acCoinHistory.length > 0 ? (
              <div>
                <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1"><span className="w-20">{t('common.date', 'วันที่')}</span><span className="flex-1 text-center">{t('ticketui.panel.coins_in_out', 'รับ/ใช้')}</span><span className="w-16 text-right">{t('ticketui.panel.quantity', 'จำนวน')}</span></div>
                {acCoinHistory.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}>
                    <span className="text-gray-600 w-20">{xpDT(h.at)}</span>
                    {/* [FIX-20260801-COINNOTE] แถวเหรียญของจริงใช้ `note` (+ `action`)
                        ไม่ใช่ `reason` แบบ mock — ยืนยันจาก payload จริง 2026-08-01:
                        { action:"ACTION_COIN_DEPOSIT", amount:5, date:…, note:"ฝากเงิน 50.00 บาท…" }
                        เดิมอ่านไม่เจอเลยตกไปโชว์คำกลางๆ "ได้รับ" ทั้งที่มีรายละเอียดอยู่
                        ข้อความยาวกว่าช่อง → truncate + ใส่ title ให้ hover อ่านเต็มได้
                        [FEAT-20260905-CUSTPROV] the five-name truthy chain and its
                        type-driven "ได้รับ"/"ใช้ไป" default now run ONCE, in
                        `build-view.ts`, and arrive as `label`. The direction
                        arrives as `sign` for the same reason — deriving it here
                        from a vendor's `type` is the coupling being removed. */}
                    <span className={`flex-1 text-center font-medium truncate px-1 ${h.sign==='+'?'text-green-600':'text-red-500'}`}
                          title={h.label || undefined}>
                      {h.label}
                    </span>
                    <span className={`w-16 text-right font-bold ${h.sign==='+'?'text-green-600':'text-red-500'}`}>{h.sign}{cell(h.value)}</span>
                  </div>
                ))}
              </div>
              ) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_coin_history', 'ยังไม่มีประวัติเหรียญ')}</div>}
            </div>
          ) },
          { key: 'point_round', label: t('ticketui.panel.point_round', 'รอบสะสมแต้ม'), content: (
            <div className="space-y-3">
              <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg border border-blue-100">
                <span className="text-sm text-blue-700 font-bold">{t('ticketui.panel.point_rounds_left', 'สิทธิ์ร่วมกิจกรรมคงเหลือ')}</span>
                {/* [FEAT-20260825-POINTROUNDS] "(N/A)" = ยังไม่ได้ตั้ง spend_amount
                    ⇒ ตัวเลขที่เห็นคือ **เหรียญจริง** ไม่ใช่จำนวนครั้ง (ตามที่สั่ง)
                    ต่างจากคนที่เหรียญไม่พอหนึ่งครั้ง ซึ่งขึ้น 0 เฉย ๆ เพราะนั่นคือ
                    คำตอบจริง ไม่ใช่ข้อมูลขาด */}
                <span
                  className="text-lg font-bold text-blue-600"
                  data-testid="point_round-rounds"
                  title={acPointRound.na ? t('ticketui.panel.point_round_na_tip', 'ยังไม่ได้ตั้งค่า spend_amount ของรอบสะสมแต้ม — ตัวเลขนี้คือจำนวนเหรียญ') : undefined}
                >
                  🎡 {pointRoundsText(acPointRound)}
                </span>
              </div>
              {acPointRoundHistory.length > 0 ? (
                acPointRoundHistory.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}>
                    {/* [FEAT-20260905-CUSTPROV] `prize/reward/name` and
                        `coins_spent/coin_spent/cost` were six vendor spellings
                        for two values; `row-paths.ts` → `point_round` resolves both,
                        and the producer's `?? 0` on the cost is the one this
                        row used to apply itself. */}
                    <span className="text-gray-600">{xpDT(h.at)}</span>
                    <span className="font-bold text-gray-700">{h.label}</span>
                    <span className="text-xs text-gray-400">-{cell(h.value)} {t('ticketui.panel.coins_unit', 'เหรียญ')}</span>
                  </div>
                ))
              ) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_point_round_history', 'ยังไม่มีประวัติรอบสะสมแต้ม')}</div>}
            </div>
          ) },
        ]} />
      </PanelCard>
      )}

      {/* ==== [FEAT-20260728-DYNPROFILE] END — จบส่วนที่ต่อข้อมูลจริง */}

      {/* [FEAT-20260905-CUSTPROV] Sections THIS PANEL HAS NO CARD FOR.
          The provider describes what to draw (`view.sections`, a closed set of
          four types); the eight cards above are hand-built renderers registered
          for the eight ids they were built for, and everything else is drawn by
          the generic ones. That is what makes a new provider a back-end-only
          change: a vendor that invents a "กระเป๋าเงิน" card ships the section and
          it appears here, plainly but correctly, with no front-end release.
          🔴 WITH TODAY'S PROVIDER THIS RENDERS NOTHING — every section it sends
          has a card above. The screen is unchanged, deliberately and provably
          (`test/personalPanelCards.dom.test.tsx`). The path is exercised by
          `test/profilePanelUnknownSections.dom.test.tsx`, which feeds the panel
          a DIFFERENT provider's view and asserts the cards appear without one
          front-end file being added — the acceptance test PART 7 §39 defines.
          revert: delete this block and `renderers/panelOwned.ts`. */}
      <ProfilePanelView view={{ sections: unownedSections(rawProfile?.view?.sections) }} />

      {/* [FEAT-20260802-SITERULESPANEL] การ์ด "ข้อมูลเว็บ" — วางท้ายสุดเสมอ
          • ลูกค้าที่มี profile → ต่อท้ายการ์ดกิจกรรม
          • ลูกค้าที่ยังไม่มี profile → ต่อท้ายข้อมูลชั่วคราว (ตำแหน่งเดียวกันเพราะอยู่นอก !xp)
          ไม่มีเส้น site_rules / ดึงไม่ได้ = การ์ดไม่ขึ้น (คืน null) — ไม่กระทบ panel เดิม */}
      {hookId && <SiteRulesCard hookId={hookId} onShopLoaded={setSrShop} />}

      {/* [FIX-20260731-NOTESTAB] ผู้ใช้สั่ง "โน้ตภายในกับป้าย ย้ายไปแท็บดำเนินการ
          อย่างเดียว" — เดิมการ์ด <CustomerTags> + <CustomerNotes> โผล่ทั้งสองแท็บ
          (แท็บ "ข้อมูล" = panel นี้ และแท็บ "ดำเนินการ" = OperationsPanel)
          จึงเอาออกจากแท็บ "ข้อมูล" เหลือไว้ที่ OperationsPanel ที่เดียว
          ⚠️ ตัวคอมโพเนนต์ไม่ถูกแก้เลย — ทั้ง realtime, สิทธิ์, การบันทึกเหมือนเดิม
             (หน้า Contacts ก็ยังใช้ตัวเดียวกันนี้อยู่ ไม่กระทบ)
          revert: ใส่ <CustomerTags room={room} /> + <CustomerNotes room={room} /> กลับ */}
      {/* [FEAT-20260815-LINEQUOTA] renders null while closed and only calls
          LINE once opened — see components/hook/quota/useHookQuota. */}
      <QuotaModal
        isOpen={quotaOpen}
        onClose={() => setQuotaOpen(false)}
        hookId={hookId}
        oaName={oaLabel}
      />
    </div>
  );
};

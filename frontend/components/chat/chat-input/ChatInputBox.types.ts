/**
 * ChatInputBox.types.ts — the composer's public prop shape, and the shape of
 * the send-error it shows.
 *
 * WHAT: `ChatInputBoxProps` is the object literal that used to be written
 * inline as `React.FC<{ ... }>` at the top of `ChatInputBox` in
 * `pages/chat/TicketChat.tsx`. Every member, and every comment explaining it,
 * is verbatim — only the `React.FC<{` / `}> = ({...}) => {` wrapper changed
 * into a named type.
 *
 * WHY: the page's own JSX has to satisfy this contract, and a 44-line inline
 * type at the head of a component is the hardest place to read it. Naming it
 * also lets each extracted child state which slice of it it needs.
 *
 * ⚠️ `SendErrorState` is written here AND left inline at the `useState` in
 * `ChatInputBox.tsx`. That duplication is deliberate: the `useState<{...}>`
 * line is pinned as source text by the composer specs, so it was not rewritten
 * to reference this name. TypeScript is structural, so the two are one type as
 * far as the compiler is concerned. ตั้งใจซ้ำ เพื่อไม่ให้บรรทัดที่เทสปักไว้ขยับ.
 *
 * revert: paste the members back inside `React.FC<{ ... }>` in the page's
 *   `ChatInputBox`, delete this file and its line in `./index.ts`.
 */
import type React from 'react';
import type { ChatRoom } from '../../../services/chat';
import type { ReplyTarget } from '../replyTarget';

export type ChatInputBoxProps = {
  /* [FEAT-20260819-REPLYUI] hands the page a way to start a reply from a bubble,
     which lives in a sibling component. Same shape as ChatRoomView's onReadyRef.
     Omitted = the composer simply never receives a reply target. */
  onReplyReadyRef?: (api: { requestReply: (t: ReplyTarget) => boolean }) => void;
  accepted: boolean;
  accepting: boolean;
  // [FIX-20260731-CLOSEDBOX] เคสที่ปิดแล้วไม่มีปุ่มให้กด จึงไม่ต้องส่ง onAccept
  // (เดิมบังคับส่ง) — เป็น optional เพื่อรองรับโหมด "ปิดแล้ว" เท่านั้น
  onAccept?: () => void;
  // [FIX-20260731-CLOSEDBOX] ข้อความบนป้ายแคปซูล เมื่อเคสปิดแล้ว
  // มีค่า = แสดง overlay เบลอ + ป้าย (ไม่มีปุ่มรับเคส) แทนปุ่ม "กดรับเคสเพื่อสนทนา"
  closedNotice?: string;
  // [FEAT-20260817-REOPENBYADMIN] เปิดเคสอีกครั้ง — ปุ่มใต้ป้ายแคปซูล แสดงเฉพาะ
  // เมื่อหน้าแม่ส่ง handler มา (= ตั๋วเข้าเงื่อนไขแท็บบอทดูแลเท่านั้น)
  onReopen?: () => void;
  reopening?: boolean;
  room: ChatRoom | null;
  hookId?: string;
  // [FIX-20260728-NOBLINK] เดิมคือ: onSent?: () => void;
  // เพิ่ม parameter ตัวข้อความที่ API ตอบกลับมา เพื่อให้หน้าแม่ append ได้เลย
  // ไม่ต้อง remount/refetch · เป็น optional param → จุดเรียกที่ไม่ส่งมาก็ยังทำงาน
  // revert: เปลี่ยนกลับเป็น onSent?: () => void;
  onSent?: (sentMessage?: any) => void;
  isOtherAdminCase?: boolean;
  otherAdminName?: string;
  onClaim?: () => void;
  // [FIX-20260731-CLAIMBOX] เวลาที่แอดมินคนปัจจุบันกดรับเคส — ใช้ค่าจริงจาก
  // ticket.assigned_at (BE เซ็ตตอน job_status = 1 · ticketController.js:499)
  // ไม่ได้สร้างข้อมูลปลอมขึ้นมาเอง
  claimedAt?: string | null;
  claiming?: boolean;
  channelType?: string | null;   // channel of this room's hook — drives composer capabilities
  /* [FEAT-20260830-TRAYFULL] โหมดแผงเครื่องมือ + ตัวเปิด modal ตั้งค่า.
     ส่งเข้ามาเป็น prop เพราะ state อยู่ที่หน้า ไม่ใช่ที่นี่ และ ChatInputBox
     ไม่มี useI18n ของตัวเอง (ทุกข้อความในไฟล์นี้เป็นไทยฝังตาย) — ป้ายของปุ่ม
     จึงถูกแปลที่ฝั่งหน้าแล้วส่งมาเป็นข้อความสำเร็จรูป
     ⚠️ ทั้งคู่ optional ⇒ ไม่ส่ง = ไม่มีปุ่ม และแผงทำงานแบบเดิมทุกอย่าง */
  trayMode?: string;
  onOpenTraySettings?: () => void;
  traySettingsLabel?: string;
  /** [FEAT-20260830-TRAYCLOSEBAR] label of the single toolbar close button */
  trayCloseLabel?: string;
};

/** the parsed send failure `ChatInputBox` holds and `ComposerSendErrorModal`
 *  renders — see `showSendError` for how a raw error becomes one of these */
export type SendErrorState = {
  title: string; status?: string; reason?: string; reqId?: string; raw: string;
};

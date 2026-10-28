/**
 * ChatInputBox.tsx — the message composer of the ticket page: mode (ตอบ /
 * โน้ตในแชท), the draft and its 5,000-character cap, staged images and
 * stickers, the reply quote, the send calls, and the grip that resizes the
 * whole box.
 *
 * WHAT: moved out of `pages/chat/TicketChat.tsx`, where it was declared at
 * module scope below the page component and shared the file with it — but
 * never shared a line of its state. Every prop, hook, handler and class string
 * is verbatim.
 *
 * WHY split further: the component is 641 code lines, and `dev-local` §6.1 caps
 * a file at 400 (the repo's eslint ratchet counts the same way — blank and
 * comment lines skipped). The eslint waiver list may only SHRINK, so a new file
 * over the cap was not an option. Five regions of the returned tree moved into
 * siblings; the state, the effects and the hook ORDER all stayed here:
 *
 *   ./ComposerCaseOverlay     the three "you cannot type yet" overlays
 *   ./ComposerToolbar         the button row above the input
 *   ./ComposerTrays           emoji / sticker / ตอบด่วน + the staged trays
 *   ./ComposerInputRow        quote bar, textarea + send, preview, counter
 *   ./ComposerSendErrorModal  the [FIX-20260728-SENDERR] dialog
 *
 * ⚠️ NOT ONE `useState` OR `useEffect` MOVED. Each child receives values and
 * setters as props under their original names, so every moved line is
 * byte-identical and re-render / effect timing is unchanged. The tidier-looking
 * cuts — letting the toolbar own the three tray flags, or lifting the grip-drag
 * plumbing into a hook — were REJECTED for exactly that reason (`dev-local`
 * §6.4). ย้ายโครงสร้าง ไม่ย้าย state.
 *
 * ⚠️ The children are presentational only. They add no DOM of their own (each
 * returns a fragment), so the rendered tree is the same tree.
 *
 * revert: inline the five children back into the returned tree at the
 *   `<Composer…/>` call sites, delete this folder, paste the component back
 *   into `pages/chat/TicketChat.tsx`, and drop the page's import of
 *   `../../components/chat/chat-input`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
/* the only icon left in this file: the drag grip. Every other icon travelled
   with the region that draws it. */
import { GripHorizontal } from 'lucide-react';
import { chatService, ChatRoom } from '../../../services/chat';
import { useReplyDraft } from '../useReplyDraft';
import { imageFilesFromPaste } from '../../../utils/imageTransfer';
import { useImageDropzone } from '../../../services/chat/useImageDropzone';
import ComposerDropOverlay from '../ComposerDropOverlay';
import { capabilitiesOf } from '../../../config/channelRegistry';
import { usePreference } from '../../../hooks/usePreferences';
import { COMPOSER_HEIGHT_PATH, normalizeComposerHeight } from '../../../hooks/composerHeightPref';
import { heightFor, shouldRemember, DEFAULT_COMPOSER_H } from '../../../pages/chat/composerHeightMemory';
import {
  isChatTrayFull,
  chatComposerBoxClass,
  chatComposerAlwaysCappedClass,
} from '../../../hooks/chatTrayMode';
import type { ChatInputBoxProps } from './ChatInputBox.types';
import { ComposerCaseOverlay } from './ComposerCaseOverlay';
import { ComposerToolbar } from './ComposerToolbar';
import { ComposerTrays } from './ComposerTrays';
import { ComposerInputRow } from './ComposerInputRow';
import { ComposerSendButton } from './ComposerSendButton';
import { ComposerSendErrorModal } from './ComposerSendErrorModal';
// [FEAT-20260908-AITRANSLATE] the preview strip, and the two things it needs.
// ⚠️ `LanguagePicker` is Agent C's finished component and is IMPORTED, never
//    edited — it already fetches the registry on mount, renders nothing when the
//    registry is empty, and treats picking a language AS the confirm. A second
//    picker for the composer would be a second place for the language list to
//    drift. Direct path rather than the `components/chat` barrel because that
//    barrel pulls in `ChatRoomView` (1.7k lines) and this is a leaf.
import { LanguagePicker } from '../LanguagePicker';
import { ComposerAutoSendToggle } from './ComposerAutoSendToggle';
import { AutoSendConfirm } from './AutoSendConfirm';
/* [FEAT-20260918-AUTOSENDCONFIRM] the outbound language rule, shared and pure
   so the full cross can be tested without rendering a composer. */
import { outboundTargetLang } from '../../../services/chat/outboundTranslateTarget';
/* [FEAT-20260918-AUTOSENDREMEMBER] "จำค่านี้ไว้" — a per-account preference, not
   per room and not per browser. Reuses the existing preferences service. */
import { rememberAutoSendConfirm, skipAutoSendConfirm } from '../../../services/chat/autoSendConfirmPref';
import { useI18n } from '../../../i18n';
import { ComposerTranslateTray, type ComposerTranslatePreview } from './ComposerTranslateTray';
import {
  aiTranslateService,
  isRateLimited,
  translateErrorText,
} from '../../../services/chat/aiTranslateService';

// ── Message composer (reference mockup). Send is UI-only for now — the real
// send API is wired later. Until the case is accepted, the accept overlay
// covers the box and the input stays disabled. The textarea is user-resizable
// (drag the corner) exactly like the reference. ──────────────────────────────
export const ChatInputBox: React.FC<ChatInputBoxProps> = ({ onReplyReadyRef, accepted, accepting, onAccept, closedNotice, room, hookId, onSent, isOtherAdminCase, otherAdminName, onClaim, claiming, claimedAt, channelType, onReopen, reopening, trayMode, onOpenTraySettings, traySettingsLabel, trayCloseLabel = 'ปิดแผง' }) => {
  const [draft, setDraft] = useState('');
  // What this channel can send (LINE = everything; a future channel may lack
  // stickers/flex). Never hardcode `channel === 'line'` — read capabilities.
  const caps = capabilitiesOf(channelType);
  // Two modes on the same box: 'reply' (blue) sends to the customer (LINE push);
  // 'note' (amber) posts an internal inline_note (admins only, never sent out).
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [sending, setSending] = useState(false);
  /* [FEAT-20260918-AUTOSENDCONFIRM] the pending "แปลแล้วส่งเลย?" question, or null.
     The ref is what lets the confirmed send re-enter `send()` without asking
     again — state would not be readable by the call that follows `setState` in
     the same tick. */
  const [autoSendConfirm, setAutoSendConfirm] = useState<{ text: string; targetLang: string | null } | null>(null);
  const autoSendConfirmedRef = useRef(false);

  // ==== [FEAT-20260908-AITRANSLATE] START — แปลก่อนส่ง (พรีวิว ไม่ส่ง) ========
  //
  // Owner, 09/09: *"แปลใน input box chat ต้องไม่ส่งทันที แอดมินจะกดส่งเอง
  // (ปุ่มเดิม) แปลเสร็จแล้วแค่พรีวิวคำแปลคู่กับคำต้นฉบับ"*
  //
  // 🔴 FIVE PIECES OF LOCAL STATE AND NOT ONE OF THEM IS A COUNTER. §4C is
  //    explicit: the FE must NOT keep its own count of presses. Two browser tabs
  //    would each believe they had six, and the pair would spend twelve. The
  //    server's 429 is the only truth about how many are left, so the only thing
  //    stored here is "the server has refused" — a latch set by a response, never
  //    a number this side maintains. ห้ามนับเอง เซิร์ฟเวอร์เป็นคนตัดสิน.
  //
  // `preview` is what will be SENT when the admin presses the existing send
  // button. Its `source` is the draft captured AT PRESS TIME, not the live
  // textarea — so the two halves on screen always belong together.
  const [translatePreview, setTranslatePreview] = useState<ComposerTranslatePreview | null>(null);
  const { t } = useI18n();
  const [translatePickerOpen, setTranslatePickerOpen] = useState(false);
  const [needTextWarning, setNeedTextWarning] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateRefused, setTranslateRefused] = useState(false);   // the 429 latch

  useEffect(() => {
    const handleCloseModal = () => setTranslatePickerOpen(false);
    const handleOpenModal = () => setTranslatePickerOpen(true);
    window.addEventListener('tc:close-composer-translate-modal', handleCloseModal);
    window.addEventListener('tc:open-composer-translate-modal', handleOpenModal);

    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        roomId?: string;
        hook_translate_lang?: string | null;
        effective_translate_lang?: string | null;
        translate_lang?: string | null;
        auto_send_translated?: boolean;
      }>;
      const rId = room ? String(room._id || (room as any).id || '') : '';
      if (!customEvent.detail?.roomId || customEvent.detail.roomId === rId) {
        if (room && customEvent.detail) {
          Object.assign(room, customEvent.detail);
        }
      }
    };
    window.addEventListener('tc:room-translate-settings-updated', handleSettingsUpdated);

    return () => {
      window.removeEventListener('tc:close-composer-translate-modal', handleCloseModal);
      window.removeEventListener('tc:open-composer-translate-modal', handleOpenModal);
      window.removeEventListener('tc:room-translate-settings-updated', handleSettingsUpdated);
    };
  }, [room]);

  /* 🔴 WHY THE 429 LATCH HAS NO COUNTDOWN AND NO TIMER.
     §4C says "disable the translate button until the window passes". This side
     does not KNOW when the window passes: the length is a BE env value, the 429
     envelope is a human sentence this code is forbidden to parse (it must print
     it verbatim), and no `Retry-After` is in the pinned contract. Hardcoding 60s
     would put a copy of a BE rule in the browser — the "no debt" line of FE note
     §6 — and it would be wrong the day the env changes.
     ⇒ The latch clears on a deliberate human act: the admin edits the draft (a
       new sentence is a new intent) or presses รับทราบ. Never on a timer, so it
       can never fire a request by itself; never permanent, so the button cannot
       get stuck. The next press asks the server, which refuses again if the
       window really has not passed — and shows its CURRENT message.
     🔴 THIS IS NOT A RETRY. Nothing in this block re-issues a request. */
  /* [FIX-20260909-KEEPPREVIEW] 🔴 EDITING THE DRAFT NO LONGER DELETES THE
     PREVIEW — it only stops it from being SENT.
     Owner, 09/09: *"เวลากดแก้ข้อความแล้ว กล่องแปลหายหมดเลย เปลืองโควต้าฟรี"*.
     This effect used to `setTranslatePreview(null)` on every keystroke, so one
     stray character in the textarea destroyed a translation that had already
     been paid for — and getting it back cost a second call out of the six the
     minute allows. Undoing the keystroke could not bring it back either,
     because the state was gone, not stale.
     🔴 THE SAFETY RULE IS UNCHANGED AND IS NOT ENFORCED HERE. What must never
        happen is sending a translation of text that is no longer in the box —
        and `stagedTranslation` below already refuses exactly that, by comparing
        the two strings on every render. Deleting the state was a SECOND, weaker
        guard for the same rule: weaker because a response landing after a
        keystroke restores it anyway (which is why the derived check had to
        exist), and destructive because it is the only copy of the translation.
     ⇒ the preview stays on screen as STALE — readable, re-editable, and
       restored the instant the draft matches it again. The send sends the
       original until the admin presses แปล.
     ⚠️ Still fires NO request: nothing in this effect translates. M19 pins that
        typing costs zero calls, and it costs zero here too. */
  useEffect(() => {
    setTranslateRefused(false);
    setTranslateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /**
   * The ONE place a preview request is made. Called from the picker's `onPick`
   * and from nowhere else — that is what `chatComposerTranslate` pins (M19).
   *
   * 🔴 NO DEBOUNCE, NO KEYSTROKE, NO BLUR, NO TIMER. §4C: a debounce spends the
   * whole minute's allowance of six on one sentence being typed. The admin
   * pressed แปล and chose a language; that is the entire trigger.
   * 🔴 NO RETRY. A 429 is recorded and shown; it is never re-issued. One press,
   * one request, always — including when the request fails.
   */
  const runTranslatePreview = useCallback(async (to: string) => {
    if (!room) return;
    /* the draft is read ONCE, here, and carried through — so a keystroke that
       lands while the ~2s call is in flight cannot change what was translated */
    const source = draft.trim();
    setTranslatePickerOpen(false);
    if (!source) return;                       // nothing to translate, nothing to spend
    setTranslating(true);
    setTranslateError(null);
    try {
      const roomKey = room._id || room.line_user_id;
      const r = await aiTranslateService.previewTranslate(roomKey, source, to);
      setTranslatePreview({
        source,
        text: r?.data?.text ?? '',
        to,
        /* the source the MODEL detected, only if the BE echoed one. Never
           guessed from the UI locale — that is the admin's panel language, not
           the language of the sentence they typed. */
        from: r?.data?.from ?? null,
      });
      setTranslateRefused(false);
    } catch (err) {
      /* 🔴 THE DRAFT IS NOT TOUCHED HERE, AND THAT IS THE POINT (M21).
         §4C: "a refused press must leave the composer text exactly as the admin
         typed it. Never clear the box, never lose the draft." There is no
         setDraft in this catch and there must never be one — losing a long Thai
         reply to a rate limit is a far worse failure than the refusal itself. */
      setTranslateError(translateErrorText(err));
      setTranslateRefused(isRateLimited(err));
    } finally {
      setTranslating(false);
    }
  }, [room, draft]);

  /** throw the staged translation away — the send button then sends the original */
  const discardTranslatePreview = useCallback(() => {
    setTranslatePreview(null);
    setTranslateError(null);
  }, []);

  /**
   * 🔴 THE ONE RULE, DERIVED ONCE AND USED BY BOTH THE SCREEN AND THE SEND.
   *
   * A preview counts only while it is still a translation OF THE TEXT IN THE
   * BOX. The effect above already clears it on a draft change, but a response
   * can land AFTER a keystroke (the call takes ~2s) and would otherwise restore
   * a stale strip through a closure the effect never sees. Deriving the rule
   * instead of trusting the state means the screen and the send can never
   * disagree about which text is about to go out — and "what you reviewed is
   * what is sent" stays true by construction rather than by care.
   * ที่เห็นบนจอ = ที่จะถูกส่ง เสมอ.
   */
  const stagedTranslation =
    translatePreview && translatePreview.source === draft.trim() && translatePreview.text.trim()
      ? translatePreview
      : null;

  /* [FIX-20260909-KEEPPREVIEW] the same object when it is NOT staged: still on
     screen, explicitly not going anywhere.
     🔴 Two states, one object, and the difference is stated on the strip. Stale
     means "the box has moved on from this translation" — the send ignores it
     (that is `stagedTranslation` above, untouched), and the admin either
     presses แปล again or edits the draft back to what was translated, at which
     point the two strings match and it is staged again with no second call.
     ⚠️ An EMPTY translation is never staged either, but it is not stale — there
        is nothing to keep. `text.trim()` decides that, so a preview the admin
        blanked disappears instead of nagging about a change that did not
        happen. */
  const staleTranslation =
    translatePreview && !stagedTranslation && translatePreview.text.trim()
      ? translatePreview
      : null;
  // ==== [FEAT-20260908-AITRANSLATE] END
  // [FEAT-20260816-MULTIIMG] Staged images (up to 5): picking/pasting appends —
  // they preview in the tray so the admin can review, expand, remove each, add a
  // caption, and send images+text together with the send button. The BE batches
  // the LINE push itself (≤5 objects/call). Object URLs are revoked on remove/
  // clear to avoid a leak. เดิมเป็นรูปเดียว (replace) — ตอนนี้ append จนเต็ม 5.
  const MAX_PENDING_IMAGES = 5;
  const [pendingImages, setPendingImages] = useState<{ file: File; url: string }[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);  // expanded (zoom) preview
  const clearPendingImages = useCallback(() => {
    setPendingImages(prev => { prev.forEach(p => URL.revokeObjectURL(p.url)); return []; });
    setPreviewUrl(null);
  }, []);
  const removePendingImage = useCallback((index: number) => {
    setPendingImages(prev => {
      const gone = prev[index];
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);
  // Staged sticker (like the image): clicking one previews it in the box so the
  // admin can review/replace/remove, then send with the ➤ button (no caption —
  // a LINE sticker is its own message).
  const [pendingSticker, setPendingSticker] = useState<{ packageId: string; stickerId: string } | null>(null);
  /* [FEAT-20260819-REPLYUI] the reply draft lives HERE, with the attachments it
     has to reason about — a reply and an image/sticker can never be composed
     together. The bubbles are in a SIBLING component (ChatRoomView), so the page
     reaches this through the same `onReadyRef` handle idiom the chat view already
     uses, rather than lifting attachment state up or adding a global store.
     UI only: `send()` is untouched and nothing about the draft is transmitted. */
  const reply = useReplyDraft({
    hasImages: pendingImages.length > 0,
    hasSticker: !!pendingSticker,
  });
  useEffect(() => {
    onReplyReadyRef?.({ requestReply: reply.requestReply });
  }, [onReplyReadyRef, reply.requestReply]);
  // A quote from another conversation would be nonsense — drop it on room change.
  useEffect(() => { reply.reset(); }, [room?._id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clearPendingSticker = useCallback(() => setPendingSticker(null), []);

  // LINE's text message limit is 5000 characters, counted in UTF-16 CODE UNITS
  // (per https://developers.line.biz/en/docs/messaging-api/text-character-count/).
  // JS strings are UTF-16, so `str.length` matches LINE EXACTLY: a Thai char and
  // each Thai combining mark (่ ้ ิ ี …) = 1, an emoji (surrogate pair) = 2, and
  // spaces/newlines all count. Do NOT switch to [...str].length (that counts code
  // points and would undercount emoji). Same 5000 cap applied to internal notes
  // for consistency, though notes aren't pushed to LINE.
  const MAX_LEN = 5000;
  const overLimit = draft.length > MAX_LEN;

  // ==== [FIX-20260728-SENDERR] START — บล็อกนี้เพิ่มใหม่ทั้งหมด
  //
  // ปุ่มส่งนี้เรียก chatService.sendReply() → POST /api/chat/:id/reply
  // *** ชื่อ endpoint ว่า "reply" แต่เบื้องหลังคือ LINE PUSH API ไม่ใช่ Reply API ***
  // เส้นทางเต็ม: FE ปุ่มส่ง → POST /api/chat/:id/reply
  //   → BE chatRoomController.sendChatReply
  //   → channels/lineSendAdapter.send()
  //   → POST https://api.line.me/v2/bot/message/push   ← ตรงนี้คือ push จริง
  // ที่ไม่ใช่ Reply API เพราะ Reply ต้องใช้ replyToken ซึ่งมีอายุสั้นและใช้ได้
  // ครั้งเดียวต่อ 1 ข้อความที่ลูกค้าส่งเข้ามา — แอดมินตอบตอนไหนก็ได้จึงต้องใช้ push
  // (คอมเมนต์ใน BE เขียนไว้ว่า "Reuses the same LINE push mechanics as
  //  hookController.pushMessage") · เรียกว่า reply เพราะมองจากมุมแอดมิน = ตอบลูกค้า
  //
  // เดิมตอนส่งไม่สำเร็จใช้ browser alert() ดิบ ๆ ขึ้นเป็น "<โดเมน> says ..."
  // อ่านยากและไม่บอกว่าอะไรพัง ตอนนี้เปลี่ยนเป็น AlertModal ของระบบ
  // แล้วแยกส่วนของ error ออกมาให้อ่านรู้เรื่อง
  //
  // BE ตอบกลับหน้าตานี้ (ยืนยันจาก Network tab จริง):
  //   { success:false, error:"Failed to send reply: HTTP 500 - Internal Server
  //     Error [reqId: 8010fab6-...]" }
  // reqId คือ x-line-request-id ของ LINE เอง = ใช้แจ้ง LINE ได้เลยเวลาฝั่งเขาล่ม
  //
  // revert: ลบบล็อกนี้ + <AlertModal> ท้าย component + เปลี่ยน 3 จุดที่เรียก
  //         showSendError(...) กลับเป็น alert(...) ตามเดิม
  const [sendError, setSendError] = useState<{
    title: string; status?: string; reason?: string; reqId?: string; raw: string;
  } | null>(null);

  const showSendError = useCallback((err: any, fallbackTitle: string) => {
    const raw = String(err?.message || err || fallbackTitle);
    // ดึง HTTP status / reqId ออกมาแยกช่อง ที่เหลือคือสาเหตุ
    const status = raw.match(/HTTP (\d{3})/)?.[1];
    const reqId = raw.match(/reqId:\s*([\w-]+)/)?.[1];
    let reason = raw
      .replace(/^Failed to [^:]+:\s*/i, '')
      .replace(/\[reqId:[^\]]*\]/i, '')
      .replace(/HTTP \d{3}\s*-?\s*/i, '')
      .trim();
    // 500 จาก LINE = ฝั่ง LINE ล่ม ไม่ใช่ข้อความเราผิด — บอกให้ชัดว่าให้ลองใหม่
    if (status === '500') {
      reason = `${reason || 'Internal Server Error'} — ${t('ticketui.composer.err_line_500', 'ฝั่ง LINE ตอบ 500 (ระบบ LINE ขัดข้องชั่วคราว) ข้อความยังไม่ถูกส่ง กรุณาลองส่งใหม่อีกครั้ง')}`;
    } else if (status === '401' || status === '403') {
      reason = `${reason || 'Unauthorized'} — ${t('ticketui.composer.err_token', 'access token ของ OA นี้อาจหมดอายุหรือถูกเปลี่ยน ตรวจสอบที่หน้าตั้งค่า OA')}`;
    } else if (status === '429') {
      reason = `${reason || 'Too Many Requests'} — ${t('ticketui.composer.err_429', 'ส่งถี่เกินโควตาของ LINE รอสักครู่แล้วลองใหม่')}`;
    }
    setSendError({ title: fallbackTitle, status, reason: reason || undefined, reqId, raw });
  }, [t]);
  // ==== [FIX-20260728-SENDERR] END

  const send = async () => {
    if (!room || sending) return;
    const text = draft.trim();
    const roomKey = room._id || room.line_user_id;

    /* [FEAT-20260918-AUTOSENDCONFIRM] 🔴 the gate, before anything is spent or sent.
       With `auto_send_translated` on, this press would translate the draft and
       deliver the TRANSLATION to a customer — text the operator never sees, in a
       language they may not read, with no preview to fall back on (owner:
       "ไม่ต้องพรีวิว แล้วส่งเลย"). So the first press asks; the confirm's OK calls
       `send` again with the flag set and this branch falls through.
       ⚠️ Placed before the sticker/image branches on purpose — it must only ever
          gate a TEXT reply, which is why it also requires `text` and `mode`.
       ⚠️ A staged manual translation skips it: that text was already previewed
          and confirmed on its own screen; asking twice would be noise.
       revert: delete this block, `autoSendConfirm` state and the overlay below. */
    if (
      mode === 'reply' &&
      text &&
      !pendingSticker &&
      pendingImages.length === 0 &&
      !stagedTranslation &&
      room?.auto_send_translated &&
      !autoSendConfirmedRef.current &&
      /* [FEAT-20260918-AUTOSENDREMEMBER] an operator who ticked "จำค่านี้ไว้"
         is not asked again, in any room. Read LAST so it can only ever skip a
         confirm that every other condition already agreed to show — and it
         answers false for a legacy account, an unset preference or unreadable
         storage, so the default stays "ask". */
      !skipAutoSendConfirm()
    ) {
      setAutoSendConfirm({ text, targetLang: outboundTargetLang(room) });
      return;
    }
    // Staged sticker (reply mode): send it as its own message (no caption).
    if (pendingSticker && mode === 'reply') {
      try {
        setSending(true);
        // [FIX-20260728-NOBLINK] เดิมทิ้ง response ทิ้ง (ไม่รับค่ากลับ)
        // ตอนนี้เก็บไว้ส่งให้ onSent เพื่อ append ตรง ๆ ไม่ต้อง refetch
        // revert: เอา `const r = ` ออก แล้วเรียก onSent?.() เปล่า ๆ
        const r = await chatService.sendSticker(roomKey, pendingSticker.packageId, pendingSticker.stickerId, room.hook_id || hookId);
        clearPendingSticker();
        onSent?.(r?.data);
        // [FEAT-2708-HEADERQUOTA] a push landed — the header gauge refreshes
        window.dispatchEvent(new CustomEvent('tc:quota-refresh'));
      } catch (err: any) {
        console.error('send sticker failed', err);
        // [FIX-20260728-SENDERR] เดิม: alert(err?.message || 'ส่งสติกเกอร์ไม่สำเร็จ');
        showSendError(err, t('ticketui.composer.err_sticker', 'ส่งสติกเกอร์ไม่สำเร็จ'));
      } finally {
        setSending(false);
      }
      return;
    }
    // With staged images (reply mode): send image(s) + caption in one request.
    if (pendingImages.length > 0 && mode === 'reply') {
      if (overLimit) return;
      try {
        setSending(true);
        const count = pendingImages.length;
        // [FIX-20260728-NOBLINK] เก็บ response ไว้ append (ดูหมายเหตุที่ sticker)
        // [FEAT-20260816-MULTIIMG] single image → append the returned bubble
        // exactly as before (seamless); multi → onSent(undefined) which the
        // handler already answers with a full refetch (bubbles + caption all
        // land at once — no half-rendered send).
        const r = await chatService.sendImages(roomKey, pendingImages.map(p => p.file), text || undefined, room.hook_id || hookId);
        setDraft('');
        clearPendingImages();
        onSent?.(count === 1 ? r?.data : undefined);
        // [FEAT-2708-HEADERQUOTA] a push landed — the header gauge refreshes
        window.dispatchEvent(new CustomEvent('tc:quota-refresh'));
      } catch (err: any) {
        console.error('send image failed', err);
        // [FIX-20260728-SENDERR] เดิม: alert(err?.message || 'ส่งรูปภาพไม่สำเร็จ');
        showSendError(err, t('ticketui.composer.err_image', 'ส่งรูปภาพไม่สำเร็จ'));
      } finally {
        setSending(false);
      }
      return;
    }
    // Text-only (or note).
    if (!text || overLimit) return;
    try {
      setSending(true);
      // [FIX-20260728-NOBLINK] เก็บ response ไว้ append (ดูหมายเหตุที่ sticker)
      // ทั้ง reply และ note คืน { success, data } รูปแบบเดียวกัน
      // [FEAT-20260821-QUOTEREPLY] the reply draft's target rides along as
      // `quote_of`; useReplyDraft already guarantees it cannot coexist with an
      // image or sticker, so this is the only send that can carry one. Cleared
      // only after the BE accepted it — a failed send keeps the quote on screen.
      // [FEAT-20260908-AITRANSLATE] a staged translation changes WHAT is sent,
      // not HOW. Same function, same call site, same code path — owner's rule 2:
      // "The send button is the SAME button and the SAME code path. No second
      // send function, no 'send translated' variant."
      //
      // 🔴 `outText` is what LINE delivers and what lands in `content`; the Thai
      //    the admin typed rides along in `original_*` so the BE stores both in
      //    the SAME single insert. With nothing staged both are undefined, the
      //    body is byte-identical to the one that always went out, and
      //    `chatSendQuoteOf.value.test.ts` still passes unchanged.
      // ⚠️ NOTE MODE NEVER TRANSLATES: an inline note is internal and is never
      //    pushed to the customer, so `stagedTranslation` is ignored on that
      //    branch by construction — it is only read in the reply expression.
      let outText = mode === 'reply' && stagedTranslation ? stagedTranslation.text.trim() : text;
      let originalPayload:
        | { original_text: string; original_lang?: string; translated_lang?: string }
        | undefined = stagedTranslation
        ? {
            original_text: stagedTranslation.source,
            original_lang: stagedTranslation.from ?? undefined,
            translated_lang: stagedTranslation.to,
          }
        : undefined;

      /* [FEAT-20260918-ROOMTRANS] Auto-translate and send outbound reply when auto_send_translated is enabled */
      if (mode === 'reply' && !stagedTranslation && room?.auto_send_translated) {
        const targetLang = outboundTargetLang(room);
        if (!targetLang) {
          /* 🔴 NOBODY KNOWS THE CUSTOMER'S LANGUAGE, SO NOTHING IS TRANSLATED.
             The old code ended this chain with a literal `'en'` — a guess about a
             stranger. Being wrong means a customer receives a reply in a language
             they do not read, which is worse than the Thai the operator actually
             typed and cannot be recalled once sent. The draft goes out as typed,
             and the confirm the operator just pressed said so.
             ไม่รู้ภาษาลูกค้า = ส่งตามที่พิมพ์ ห้ามเดา */
          console.warn(
            '[COMPOSER] auto-send is on but this room has no customer language — sending the draft as typed',
          );
        } else {
          try {
            const rPreview = await aiTranslateService.previewTranslate(roomKey, text, targetLang);
            if (rPreview?.data?.text) {
              outText = rPreview.data.text.trim();
              originalPayload = {
                original_text: text,
                original_lang: rPreview.data.from ?? undefined,
                translated_lang: targetLang,
              };
            }
          } catch (transErr) {
            /* The fallback the owner asked for, for EVERY failure reason — vendor
               down, cap reached, rate limited, no key: the message still goes,
               carrying exactly what was typed. The banner explains why it was not
               translated; it never blocks the send.
               แปลไม่สำเร็จด้วยเหตุผลใดก็ตาม = ส่งของเดิมออกไป ไม่ค้าง ไม่หาย */
            console.warn('[COMPOSER] auto-send translation failed, sending original draft:', transErr);
            setTranslateError(translateErrorText(transErr));
          }
        }
      }

      const r = mode === 'reply'
        ? await chatService.sendReply(
            roomKey,
            outText,
            room.hook_id || hookId,
            reply.target?.id,
            originalPayload,
          )
        : await chatService.createInlineNote(roomKey, text, room.hook_id || hookId);
      setDraft('');
      /* the staged translation is consumed by the send that used it. Clearing it
         only AFTER the BE accepted means a failed send keeps the preview on
         screen — the same rule the quote bar below follows, and the reason a
         retry does not cost a second AI call. */
      setTranslatePreview(null);
      setTranslateError(null);
      if (reply.target) reply.cancel();
      onSent?.(r?.data);
      // [FEAT-2708-HEADERQUOTA] reply = a real push; an inline note never
      // touches LINE and must not pretend the number moved
      if (mode === 'reply') window.dispatchEvent(new CustomEvent('tc:quota-refresh'));
    } catch (e: any) {
      console.error('send failed', e);
      // [FIX-20260728-SENDERR] เดิม: alert(e?.message || 'ส่งข้อความไม่สำเร็จ');
      // mode==='note' ไม่ได้ยิง LINE (เป็นโน้ตภายใน) จึงแยกหัวข้อให้ตรงกับที่ทำจริง
      showSendError(e, mode === 'reply' ? t('ticketui.composer.err_message', 'ส่งข้อความไม่สำเร็จ') : t('ticketui.composer.err_note', 'บันทึกโน้ตไม่สำเร็จ'));
    } finally {
      setSending(false);
    }
  };

  // Pick image(s) → STAGE them for preview (append, up to 5). The actual send
  // happens via send() so images+text go together.
  // Reply mode only — an internal note can't carry an image out to the customer.
  const fileRef = useRef<HTMLInputElement | null>(null);
  // [FEAT-20260816-MULTIIMG] one staging seam for BOTH entrances (file picker +
  // paste) so the gate and the append-cap can never drift apart. Files beyond
  // the 5th are silently ignored — the tray shows n/5 so the cap is visible.
  const stageImages = (files: File[]) => {
    if (!room || sending || mode !== 'reply') return;
    setPendingImages(prev => {
      const free = MAX_PENDING_IMAGES - prev.length;
      if (free <= 0) return prev;
      const added = files.slice(0, free).map(file => ({ file, url: URL.createObjectURL(file) }));
      return [...prev, ...added];
    });
  };
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (files.length > 0) stageImages(files);
  };
  // [FEAT-20260816-MULTIIMG] Ctrl+V image(s) → staged exactly like the picker,
  // capped at the free slots. A TEXT paste returns [] from the helper and falls
  // through untouched — preventDefault only fires when an image was taken.
  const onComposerPaste = (e: React.ClipboardEvent) => {
    const files = imageFilesFromPaste(e, MAX_PENDING_IMAGES - pendingImages.length);
    if (files.length === 0) return;
    e.preventDefault();
    stageImages(files);
  };
  // [FEAT-20260818-DROPIMAGE] third entrance — drag files onto the box. Same
  // `stageImages` seam as the picker and Ctrl+V, so the 5-image cap and the
  // image/* gate are shared; the depth counter lives in the hook.
  const freeImageSlots = MAX_PENDING_IMAGES - pendingImages.length;
  const { isDragging, dropHandlers } = useImageDropzone(
    freeImageSlots,
    !!room && !sending && mode === 'reply',
    stageImages,
  );

  // Emoji + sticker pickers (popovers above the toolbar).
  // (Quick-reply / ตอบด่วน is intentionally not wired yet — pending its design.)
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showQuickReply, setShowQuickReply] = useState(false);   // ตอบด่วน popover (composer)
  /* [FEAT-20260830-TRAYCLOSEBAR] the single toolbar close button needs to know
     whether ANY tray is open, and be able to close whichever one is — the three
     flags are mutually exclusive in practice (each opener clears the others) but
     closing all three is the honest expression of "close the open tray". */
  /** The three panels that slide up — what the toolbar's close button closes. */
  const trayPanelOpen = showEmoji || showStickers || showQuickReply;
  /**
   * [FIX-20260909-TRAYHEIGHT] The preview strip, as the layout sees it.
   * Anything the strip renders — staged, stale, running, or failed — is a row
   * inside the composer box, so all four states count the same.
   */
  const translateStripOpen =
    !!stagedTranslation || !!staleTranslation || translating || !!translateError;
  /**
   * [FIX-20260909-TRAYHEIGHT] Anything that STEALS HEIGHT from the input row.
   *
   * 🔴 THE FIRST BUG: the translate preview opened and the textarea collapsed to
   *    a sliver with only its edge showing. This name listed the three trays
   *    that existed before the feature, so the composer kept its "nothing is
   *    open" layout — a fixed height box whose input row is `flex-1` — and the
   *    new strip simply ate the row's share of it.
   *
   * 🔴 THE SECOND BUG, CAUSED BY THE FIRST FIX (owner, 09/09: *"บัคกดแปลแล้ว
   *    ขยายเต็มจอ"*): this value ALSO reaches `chatComposerAlwaysCappedClass`
   *    and `chatComposerBoxClass`, where "a tray is open" means something else
   *    entirely — the composer takes half the column (`flex-1`), or all of it in
   *    full mode (`flex-[999_1_0%]`). A sliding tray needs that, because
   *    `flex-1` inside it has nothing to divide otherwise. A one-paragraph strip
   *    does not, and pressing แปล grew the composer over the conversation.
   *
   * ⇒ TWO QUESTIONS, TWO VALUES, and the split is the fix:
   *      `anyTrayOpen`   — does the input row have to share the box?  (heights)
   *      `trayPanelOpen` — does the composer become a flex panel?     (classes)
   *    The strip answers yes to the first and no to the second: the box drops to
   *    content height (exactly the branch a locked room already uses), the
   *    textarea keeps its dragged `areaH`, and the strip's own height is simply
   *    added to the box instead of taken out of the input row.
   *
   * ⚠️ THE NAME STAYS `anyTrayOpen` DELIBERATELY. Four spec files pin the height
   *    decisions by reading this source, and what they assert is the RULE — the
   *    dragged pixel height belongs to the box only while nothing is open. That
   *    rule is unchanged; only the set of "anything" grew. Renaming it would
   *    have made eight guards go red for a reason that has nothing to do with
   *    what they protect.
   *
   * ⚠️ The toolbar gets `trayPanelOpen` too: its close button closes those three
   *    panels, and the translate strip is not one of them — it has its own
   *    labelled button and no tray mode.
   */
  const anyTrayOpen = trayPanelOpen || translateStripOpen;
  const closeAllTrays = () => { setShowEmoji(false); setShowStickers(false); setShowQuickReply(false); };
  /* [FIX-20260830-ONETRAYONLY] exactly one tray may be open at a time.
     🔴 The bug: each button only closed the trays it happened to remember.
        The emoji and sticker buttons cleared each other but NOT quick replies,
        so leaving "ตอบด่วน" open and pressing the sticker button stacked two
        panels on top of each other.
     Every opener now goes through this one helper, so a new tray added later
     cannot be forgotten by three separate call sites — it just has to be listed
     here once. `which` is the tray being toggled; passing the one already open
     closes it. */
  const toggleTray = (which: 'emoji' | 'sticker' | 'quick') => {
    const wasOpen =
      (which === 'emoji' && showEmoji) ||
      (which === 'sticker' && showStickers) ||
      (which === 'quick' && showQuickReply);
    /* [FEAT-20260830-STICKERNOINPUT] a staged sticker dies on switching to the
       emoji or quick-reply tray (owner 30/08). Those two are TEXT tools — the
       admin has moved on to composing a message, and a sticker left staged
       would ride along with the next send unnoticed. Re-opening the sticker
       tray itself keeps the stage: that is reviewing/replacing, not switching. */
    if (which !== 'sticker') setPendingSticker(null);
    setShowEmoji(!wasOpen && which === 'emoji');
    setShowStickers(!wasOpen && which === 'sticker');
    setShowQuickReply(!wasOpen && which === 'quick');
  };
  /* [FEAT-20260830-EMOJISTAY] picking an emoji KEEPS the tray open (owner:
     เลือกต่อเนื่อง) — each pick lands in the draft and the admin keeps going.
     The tray closes via its toolbar button / the centre close button only. */
  const insertEmoji = (em: string) => { setDraft(d => d + em); };
  // Pick a sticker → STAGE it (preview in the box); the actual send happens via
  // send() so the admin can review/replace/remove first.
  const pickSticker = (packageId: string, stickerId: string) => {
    if (!room) return;
    setShowStickers(false);
    setPendingSticker({ packageId, stickerId });
  };

  // Composer height is user-adjustable by dragging the grip bar on top of the
  // box: drag up → taller, drag down → shorter (clamped). Same feel as the reference.
  /* [FIX-20260824-DRAGDEEPER] the FLOOR dropped 30%, 56 → 39.
   *
   * Owner, 24/08: the composer should drag DOWN further so a long chat can be
   * read without it eating the screen — and explicitly without re-laying-out
   * anything inside it.
   *
   * That is exactly one number because `areaH` drives ONE element: the
   * textarea's `style={{ height }}`, and nothing else. Nothing reflows, no
   * toolbar moves, the grip behaves identically — the clamp simply lets go
   * lower. 56 × 0.7 = 39.2, floored to 39 so the full 30% is actually reachable.
   *
   * 39 is still one readable line: text-sm is 14px at ~1.5 line-height inside
   * `p-2` (8+8), so ~37px is the point below which the first line would clip.
   * `composerDragRange.test.ts` pins that floor-of-the-floor, and pins that
   * MAX_H and the opening height did NOT move — the ask was about dragging
   * smaller, not about opening smaller.
   * ลากลงได้ลึกขึ้น 30% · เพดานกับความสูงตอนเปิดเท่าเดิม · ข้างในไม่ขยับเลย
   * revert: MIN_H back to 56. */
  const MIN_H = 39, MAX_H = 416; // +30% taller than before
  /* [FIX-20260910-COMPACTSOURCE] how tall the ORIGINAL may be while a preview is
     staged — about three lines. Not `MIN_H` (one line is not enough to review a
     sentence in) and not the dragged height (see the call site). */
  const PREVIEW_SOURCE_H = 96;

  /* [UI-20260826-LOCKEDCOMPACT] กล่องพิมพ์ที่ "ถูก overlay ทับ" ต้องยุบของที่กดไม่ได้ทิ้ง
     ─────────────────────────────────────────────────────────────────────────
     🔴 ทำไมลด `IDLE_COMPOSER_H` (28→20) แล้วเจ้าของยังเห็นว่า "กล่องยังสูงอยู่":
        `areaH` คุมแค่ `<textarea>` แต่แถวนั้นมี **ปุ่มส่ง `w-10 h-10` = 40px**
        ยืนคุมความสูงอยู่ ⇒ ลด areaH ต่ำกว่า 40 ไม่ขยับอะไรบนจอเลยสักพิกเซล
        ที่กินที่จริง ๆ คือ กริ๊ปลาก (16px) + แถบเครื่องมือ (~40px) รวม ~56px
     ⇒ ทั้งสองอันนี้ **กดไม่ได้อยู่แล้ว** ตอนมี overlay ทับ (บรรทัดล่างใส่
        `opacity-50 pointer-events-none` ให้อยู่ก่อนแล้ว) การซ่อนจึงไม่ได้เอา
        ความสามารถอะไรไป แค่เลิกจองที่ให้ของที่ใช้ไม่ได้
     ⚠️ เงื่อนไขเดียวกับที่ใช้หรี่กล่องอยู่เดิมเป๊ะ ๆ — ห้องที่คุยจริง
        (`accepted && !isOtherAdminCase`) ไม่เข้าเงื่อนไขนี้เลย ⇒ **ไม่กระทบกล่องคุยจริง**
        ตามที่เจ้าของกำชับ · กริ๊ปลาก/แถบเครื่องมือ/ปุ่มส่ง ของห้องที่คุยอยู่เท่าเดิมทุกอย่าง
     revert: ลบตัวแปรนี้ + `${composerLocked ? 'hidden' : ''}` ทั้งสองจุด */
  const composerLocked = !accepted || isOtherAdminCase;

  /* [UI-20260826-LOCKEDSAMEH] เจ้าของแจ้ง (ภาพเทียบสองจอ): "ไม่เท่ากันจ้า"
     ─────────────────────────────────────────────────────────────────────────
     🔴 ต้นเหตุ: ห้องที่ **แอดมินคนอื่นถือ** มี `accepted === true` (มันเป็นเคสที่
        กำลังดำเนินอยู่จริง) ⇒ `heightFor(accepted, …)` คืน `DEFAULT_COMPOSER_H`
        = 120 ทั้งที่ห้องนั้น **พิมพ์ไม่ได้** เพราะมี overlay "รับเคสต่อ" ทับอยู่
        ⇒ กล่องเลยสูงกว่าห้อง "บอทกำลังดูแล" ที่ได้ `IDLE_COMPOSER_H` = 20
     ⇒ ตัวที่ควรตัดสินคือ "พิมพ์ได้จริงไหม" ไม่ใช่ "เป็นเคสที่เปิดอยู่ไหม"
        `canType` = ตรงข้ามกับ `composerLocked` พอดี ⇒ ใช้ค่าเดียวกันทั้งสองที่
     ⚠️ `shouldRemember` ต้องใช้ตัวเดียวกันด้วย — ไม่งั้นลากในห้องที่แอดมินคนอื่นถือ
        แล้วค่าจะติดไปห้องที่คุยจริง ซึ่งขัดกับกฎ "จำเฉพาะเวลาแชท"
     ⚠️ ห้องที่คุยจริงยังได้ 120 / ค่าที่ลากไว้ เหมือนเดิมทุกประการ
     revert: เปลี่ยน `canType` กลับเป็น `accepted` ทั้งสามจุด */
  const canType = !composerLocked;
  /* [FIX-20260824-DRAGMEMCHATONLY] เจ้าของแจ้ง: เปิดห้อง "บอทกำลังดูแล / เปิดเคส"
     แล้วกล่องยังสูงค้างจากห้องก่อนหน้า ("ทำไม box ยังไม่ลงไป")
     คำสั่ง: "ให้จำค่าเฉพาะเวลาแชท เวลาอื่นไม่จำ" + "ค่าเดียวร่วมกันทุกห้องที่คุย"
     ⇒ `accepted` (เคสของเราและกำลังคุย) เป็นตัวตัดสินเพียงตัวเดียว
     กฎอยู่ใน composerHeightMemory.ts — ที่นี่แค่ต่อสาย ไม่เขียนเงื่อนไขซ้ำ
     revert: กลับเป็น useState(120) + ลบ rememberedH/useEffect + import */
  const rememberedH = useRef<number | null>(null);
  /* [FEAT-20260830-COMPOSERHPREF] the dragged height now survives reloads:
     read (immediate, like ui.favGroups above), NORMALIZED on every read because
     usePreference returns whatever was stored verbatim. An admin with no value
     — or a broken one — resolves to DEFAULT_COMPOSER_H, so nothing breaks.
     `heightFor` is untouched: locked rooms still ignore all of this (IDLE). */
  const [composerHeightPref, setComposerHeightPref] = usePreference<number>(
    COMPOSER_HEIGHT_PATH,
    DEFAULT_COMPOSER_H,
    { immediate: true },
  );
  rememberedH.current = normalizeComposerHeight(composerHeightPref);
  const [areaH, setAreaH] = useState(() => heightFor(canType, rememberedH.current));
  useEffect(() => {
    // สลับห้อง/สลับสถานะ → ห้องที่ไม่ได้คุยกลับค่าเริ่มต้นเสมอ
    setAreaH(heightFor(canType, rememberedH.current));
  }, [canType, room?._id]);
  /* [FIX-20260830-TRAYDRAG] the dragged height of the WHOLE composer while a
     default-mode tray is open. null = untouched → the half-column flex-1 rules.
     Owner 30/08: "เวลาลากในโหมดปกติ tray มันต้องไหลตามด้วย ไม่ใช่ lock" — half is
     the OPENING size, the grip adjusts from there and the tray flows with it. */
  const [trayBoxPx, setTrayBoxPx] = useState<number | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // closing every tray (or switching rooms) returns to the clean half rule
    /* [FIX-20260909-TRAYHEIGHT] `trayPanelOpen`, not `anyTrayOpen`: this pixel
       height only ever overrides the half-column flex state, and the translate
       strip never enters it. */
    if (!trayPanelOpen) setTrayBoxPx(null);
  }, [trayPanelOpen, room?._id]);
  const dragRef = useRef<{ startY: number; startH: number; startArea: number; target: 'area' | 'tray' } | null>(null);

  const onGripDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    /* [FIX-20260830-TRAYDRAG] tray open in default mode → the drag moves the
       WHOLE composer. The start height is the real on-screen height (the
       half-column flex size on the first drag), so the box continues from
       exactly where it stands — no jump. */
    /* [FIX-20260909-TRAYHEIGHT] a TRAY PANEL, not the strip — with only the
       strip open the box is content-sized and the grip drags the textarea, the
       same as when nothing is open. */
    if (trayPanelOpen && !isChatTrayFull(trayMode)) {
      const startH =
        trayBoxPx ?? composerRootRef.current?.offsetHeight ?? 0;
      dragRef.current = { startY: e.clientY, startH, startArea: areaH, target: 'tray' };
      return;
    }
    dragRef.current = { startY: e.clientY, startH: areaH, startArea: areaH, target: 'area' };
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    // dragging up (smaller clientY) grows the box
    const next = dragRef.current.startH + (dragRef.current.startY - e.clientY);
    if (dragRef.current.target === 'tray') {
      /* [FIX-20260830-DRAGTOGETHER] the INPUT flows with the drag too (owner:
         "เวลาลาก input ต้องไปด้วย") — proportionally: the box grew k times, so
         the input grows k times, and the tray takes what remains. One gesture,
         one feel, no separate knobs. */
      const k = dragRef.current.startH > 0 ? next / dragRef.current.startH : 1;
      const scaledArea = Math.max(
        MIN_H,
        Math.min(MAX_H, Math.round(dragRef.current.startArea * k)),
      );
      setAreaH(scaledArea);
      /* [FIX-20260830-SENDFLOOR] floor is COMPUTED from the LIVE input height:
         chrome + input (unless the sticker tray hides the input rows) + room.
         220 was lower than chrome+input and let the send button slide off. */
      const minBox =
        COMPOSER_CHROME_H + (showStickers ? 24 : scaledArea + 24);
      const max = Math.round(window.innerHeight * 0.85);
      setTrayBoxPx(Math.max(minBox, Math.min(max, Math.round(next))));
      return;
    }
    setAreaH(Math.max(MIN_H, Math.min(MAX_H, next)));
  };
  const onGripUp = (e: React.PointerEvent) => {
    // จำค่าไว้ให้ห้องที่คุยห้องอื่นด้วย — แต่เฉพาะตอนคุยจริงเท่านั้น
    if (shouldRemember(canType)) {
      rememberedH.current = areaH;
      /* [FEAT-20260830-COMPOSERHPREF] persist through the SAME gate — remember
         only while actually chatting (owner rule 24/08). Normalized before the
         write so a mid-drag float or an out-of-range value can never be stored. */
      setComposerHeightPref(normalizeComposerHeight(areaH));
    }
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  /* ==== [FIX-20260830-GRIPWHOLE] the grip resized only the textarea ====
   *
   * Owner, 30/08: *"เวลาลากสามขีดมันได้ลากไปแค่กล่อง input"* — and when asked
   * which behaviour was wanted, chose: the grip should grow the WHOLE composer,
   * the open tray included.
   *
   * ── the cause ─────────────────────────────────────────────────────────────
   * `areaH` was applied as `style={{ height: areaH }}` on the `<textarea>` and
   * on nothing else (this file, the textarea row below). The tray, the toolbar
   * and the counter sit OUTSIDE that element, so dragging the grip up bought
   * exactly one thing more room — the typing area — and an open sticker tray
   * stayed at its own `max-h-48` no matter how far the grip travelled.
   *
   * ── the choice made here ──────────────────────────────────────────────────
   * `areaH` now drives the COMPOSER BOX's height (the inner `flex flex-col` that
   * holds toolbar + tray + textarea + counter), and the textarea becomes
   * `flex-1` inside it instead of carrying a pixel height of its own.
   *
   * Why that way round rather than "textarea height + tray height":
   *   · one number stays one number. `composerHeightMemory.ts` (`heightFor`,
   *     `shouldRemember`, `DEFAULT_COMPOSER_H`, `IDLE_COMPOSER_H`) and its tests
   *     are all written around a single remembered scalar; a second dimension
   *     would break the owner's 24/08 decisions (remember only while chatting,
   *     one shared value across chat rooms, non-chat rooms reset to default).
   *     Those rules are untouched — `areaH` is still exactly that scalar, and
   *     `heightFor`/`shouldRemember` are still its only gatekeepers.
   *   · the tray is already `flex-1 min-h-0` in full mode and capped in default
   *     mode, so growing the box hands it the surplus for free.
   *   · the toolbar and the counter are `shrink-0`, so they keep their natural
   *     height and never absorb the drag.
   *
   * ⚠️ MIN_H / MAX_H CHANGE MEANING, deliberately and explicitly. They used to
   * bound the TEXTAREA's height; they now bound the WHOLE composer box. The old
   * floor of 39 was "one readable line of text-sm inside p-2" — as a whole-box
   * floor that would leave no room for the toolbar and the counter and would
   * clip the textarea to nothing. `COMPOSER_CHROME_H` below is the height those
   * fixed rows occupy, so the same intent ("the floor still shows one readable
   * line") is expressed as chrome + one line. The ceiling is raised by the same
   * amount so the drag range the owner tuned on 24/08 is preserved in length.
   *
   * revert: put `style={{ height: areaH }}` back on the textarea, drop
   *         `composerBoxH` and restore `MIN_H = 39, MAX_H = 416`. */
  /** Height of the composer rows that are NOT the textarea: the 16px grip, the
   *  ~40px toolbar and the ~22px counter row. Approximate on purpose — it is
   *  only used to re-express the drag bounds, never to lay anything out. */
  const COMPOSER_CHROME_H = 78;
  /* [FEAT-20260830-STICKERBOOST] +30% while a sticker is STAGED (owner 30/08):
     the staged-sticker preview renders inside this fixed-height box and eats
     the typing area, so the box grows to give it back. Applies in both tray
     modes — with no tray open they share this one path. Ceiling still holds. */
  const stickerBoost = pendingSticker && mode === 'reply' ? 1.3 : 1;
  /** the box height the grip now drives, clamped the same way `areaH` was */
  const composerBoxH = Math.max(
    MIN_H + COMPOSER_CHROME_H,
    Math.min(
      MAX_H + COMPOSER_CHROME_H,
      Math.round(areaH * stickerBoost) + COMPOSER_CHROME_H,
    ),
  );

  /* ==== [FIX-20260830-COMPOSERIDLEH] the composer ate the screen with NO tray ====
   *
   * Owner, 30/08, with a screenshot: no tray open, the message stream squeezed
   * into the top third, and a large EMPTY area under the textarea.
   *
   * ── the cause ─────────────────────────────────────────────────────────────
   * [FIX-20260830-GRIPWHOLE] moved the dragged number off the textarea and onto
   * the whole composer box as `style={{ height: composerBoxH }}`, where
   * `composerBoxH = areaH + COMPOSER_CHROME_H` (78). That made the box a FIXED
   * height in every non-full state — including the one where nothing is open.
   * At the default `areaH` of 120 the box was forced to 198px whether or not it
   * had 198px of content, and the textarea (`h-full` inside a `flex-1` row)
   * simply stretched into the surplus, so the excess showed up as dead space
   * under the caret and came straight out of `.tc-chat-history`.
   *
   * ── why a fixed height is the wrong mechanism when no tray is open ────────
   * With no tray the box holds exactly grip + toolbar + textarea row + counter.
   * Those are all natural-height rows apart from the textarea, so "the box is
   * as tall as the dragged textarea plus its chrome" is what CONTENT SIZING
   * already produces, exactly, with no constant to guess. `COMPOSER_CHROME_H`
   * is an approximation (78 ≈ 16 + 40 + 22); as an addend on a fixed height any
   * error in it becomes visible empty space or a clipped row. Letting the box
   * size to content makes the constant unnecessary in that state and the box
   * pixel-identical to its pre-GRIPWHOLE self.
   *
   * ── what still needs the fixed height ─────────────────────────────────────
   * An OPEN tray. That is the 30/08 requirement the grip fix was for: dragging
   * must grow the whole composer, tray included. A tray is `flex-1 min-h-0`
   * (`chatTrayPanelClass`) or a capped panel, and `flex-1` needs a resolved
   * ancestor height to divide — content sizing gives it none. So the fixed box
   * height is applied exactly when there is a tray to share it with.
   *
   * ⇒ three states, one rule each:
   *    · full mode          → the root's flex-1 + max-h-full own the sizing (undefined)
   *    · tray open, default → fixed `composerBoxH`, so the drag grows the tray
   *    · no tray, default   → no box height; the textarea carries `areaH` itself
   *
   * revert: return to `isChatTrayFull(trayMode) ? undefined : { height: composerBoxH }`
   *         and drop `composerBoxStyle` / `textareaStyle`. */
  /* [FIX-20260830-REALFULL] the height rules, re-cut after the owner's four
     screenshots. One rule per state, all keyed on whether a tray is OPEN —
     never on the mode alone:
       · no tray (any mode)  → the box takes the dragged height and sits at the
         bottom like it always did; full mode with nothing open behaves exactly
         like default (owner: "กล่องแชทต้องลากได้ปกติ และอยู่ชิดล่างเสมอ").
       · tray open, default  → the box sizes to content under the root's 55vh
         ceiling; the TEXTAREA keeps the dragged height and the tray gets the
         rest, shrinking + scrolling first (min-h-0) so the send row never falls
         off the edge again.
       · tray open, full     → root flex-[999] + box flex-1 own the sizing; the
         tray's flex-1 fills the screen.
     The old `trayDrivesBoxHeight` fixed the BOX height while a tray was open
     INSIDE it — the tray then overflowed the fixed box and pushed the send
     button past the viewport (owner: "ตกขอบ ปุ่มส่งหาย"). */
  /* [FIX-20260830-REALFULL] locked rooms are exempt from the box height too:
     their chrome (grip + toolbar) is hidden, so `areaH + COMPOSER_CHROME_H`
     would hold 78px of empty space and the blurred composer of a bot-care /
     unclaimed card would stay tall instead of resetting to its own small size
     (owner: switching to a non-chat card must reset the box). With the box on
     auto, the textarea alone carries `areaH` — which `heightFor()` already
     resets to `IDLE_COMPOSER_H` for every non-chat room. */
  /* the ONLY two states where the box gives up its pixel height:
       · locked room        → box auto, textarea at areaH (= IDLE, per room)
       · fullscreen + tray  → box flex-1 fills the root; a pixel height would
         cap "เต็มจอ" at whatever was last dragged
     everywhere else the box carries the dragged height, so the grip grows the
     WHOLE composer — tray included — exactly as [FIX-20260830-GRIPWHOLE] asked. */
  /* [FIX-20260830-HALFTRAY] any open tray puts the composer in its flex state
     (half the column in default, all of it in fullscreen) — the box then fills
     the root and the dragged pixel height applies only while nothing is open. */
  /* [FIX-20260918-TRAYHALFAREA] เมื่อเปิดแผงตอบด่วน / emoji / sticker ในโหมดปกติ (ไม่ใช่ fullscreen/mode ขยาย)
     ให้ลดความสูงของ textarea ลงครึ่งเดียว เพื่อไม่ให้ textarea กินพื้นที่จนแผงโดนย่อจนมองไม่เห็น
     (ห้ามกระทบ mode ขยาย) */
  const isFullTray = isChatTrayFull(trayMode);
  const effectiveAreaH =
    trayPanelOpen && !isFullTray
      ? Math.max(44, Math.round(areaH / 2))
      : areaH;

  const composerBoxStyle =
    !composerLocked && !anyTrayOpen ? { height: composerBoxH } : undefined;
  /** box auto/flex ⇒ the textarea holds its own height instead of h-full */
  const textareaStyle =
    composerLocked || anyTrayOpen ? { height: effectiveAreaH } : undefined;

  return (
    /* [FIX-20260830-TRAYBOTTOM] this root was `shrink-0` with height:auto, so a
       fullscreen tray grew it without limit and pushed the textarea off screen.
       In full mode it becomes a bounded flex column (`cap`), which is the
       ancestor height the tray's `flex-1` was missing.
       [FIX-20260830-SCALELOCK] that cap only applied in `full` mode, so at a
       large `--tc-chat-scale` the DEFAULT-mode composer still grew unbounded and
       starved `.tc-chat-history` (TicketChat.tsx:4015) of every pixel — the
       stream vanished and the tray ran off the bottom instead of scrolling.
       The ceiling is now unconditional, so the stream always keeps a remainder. */
    /* [FIX-20260830-FULLNOSHRINK] `shrink-0` left the BASE string.
       It used to be typed here, so it reached the element in EVERY mode —
       `chatComposerRootClass` strips it for the capped `full` path, but a helper
       can only remove what it can see, and the `full` branch then emitted
       `flex-1` alongside a `shrink-0` that had already been removed from the
       string yet was still the author's intent everywhere else. Making the base
       shrink-free and letting the helper ADD `shrink-0` for the non-full modes
       means exactly one of the two classes is ever produced, decided in code
       rather than by Tailwind's emission order. */
    <div
      ref={composerRootRef}
      /* [FIX-20260909-TRAYHEIGHT] `trayPanelOpen` — this argument decides
         whether the composer becomes a flex panel that takes half the column
         (or all of it in full mode). Passing the widened `anyTrayOpen` here is
         what made pressing แปล expand the composer over the conversation. */
      className={chatComposerAlwaysCappedClass(trayMode, 'bg-white border-t border-gray-200 p-3 relative', trayPanelOpen, trayBoxPx !== null)}
      /* [FIX-20260830-TRAYDRAG] a dragged tray-mode height rides as a real pixel
         height (flex-basis 0% would ignore `height`, so the class drops flex-1
         when this is set). Fullscreen keeps ignoring it entirely. */
      style={trayBoxPx !== null && trayPanelOpen && !isChatTrayFull(trayMode) ? { height: trayBoxPx } : undefined}
    >
      {/* [REFACTOR-20260905-CHATINPUT] the three pre-claim overlays — moved to
          ./ComposerCaseOverlay.tsx, props only, markup byte-identical. */}
      <ComposerCaseOverlay
        isOtherAdminCase={isOtherAdminCase}
        otherAdminName={otherAdminName}
        claimedAt={claimedAt}
        claiming={claiming}
        onClaim={onClaim}
        accepted={accepted}
        accepting={accepting}
        onAccept={onAccept}
        closedNotice={closedNotice}
        onReopen={onReopen}
        reopening={reopening}
      />

      {/* input box (disabled/dimmed until accepted) — turns yellow in note mode (mirrors mock)
          [FEAT-20260818-DROPIMAGE] also the drop target: `relative` anchors the hint
          overlay, and the handlers come from useImageDropzone. `pointer-events-none`
          above already blocks drops before the case is accepted. */}
      <div
        {...dropHandlers}
        /* [FIX-20260830-TRAYBOTTOM] already a flex column, but with the default
           `min-height:auto` it refused to shrink inside the newly-capped root, so
           the ceiling above never reached the tray. `min-h-0` (full mode only)
           passes the bound down. No `cap` here — the root owns the ceiling. */
        /* [FIX-20260909-TRAYHEIGHT] `trayPanelOpen` for the same reason as the
           root above: `flex-1` here makes the box FILL that panel. With only the
           strip open the box must size to its content, which is what keeps the
           dragged textarea height and simply grows by the strip. */
        className={chatComposerBoxClass(trayMode, trayPanelOpen, `relative border rounded-lg shadow-sm flex flex-col transition-opacity duration-300 ${mode === 'note' ? 'tc-note-mode border-[#e7bd6c]' : 'border-gray-300 bg-gray-50 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary'} ${accepted && !isOtherAdminCase ? '' : 'opacity-50 pointer-events-none'}`)}
        /* [FIX-20260830-GRIPWHOLE] the grip's number lands HERE now, not on the
           textarea, so dragging up grows the toolbar+tray+textarea box as one.
           `height`, not `minHeight`: the owner drags DOWN to shrink too, and a
           min-height would let the content refuse. In `full` mode the root's
           `flex-1` + `max-h-full` already own the sizing, so the drag height is
           dropped there — otherwise a fixed pixel height would fight the
           fullscreen contract and cap "เต็มจอ" at whatever was last dragged. */
        /* [FIX-20260830-COMPOSERIDLEH] the height is now conditional on a tray
           being open too, not on the mode alone — see the note at the
           `composerBoxStyle` declaration. With no tray the box sizes to its
           content and the drag number rides on the textarea instead, which is
           what makes the tray-less composer as compact as it was before. */
        style={composerBoxStyle}
      >
        <ComposerDropOverlay active={isDragging} free={freeImageSlots} max={MAX_PENDING_IMAGES} />
        {/* drag-to-resize grip */}
        <div
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          className={`group ${composerLocked ? 'hidden' : 'flex'} items-center justify-center h-4 cursor-ns-resize select-none touch-none rounded-t-lg hover:bg-gray-100`}
          title={t('ticketui.composer.grip_title', 'ลากขึ้น-ลงเพื่อขยาย/ย่อกล่องพิมพ์')}
        >
          <GripHorizontal size={14} className="text-gray-300 group-hover:text-gray-500" />
        </div>
        {/* [REFACTOR-20260905-CHATINPUT] the toolbar row — moved to
            ./ComposerToolbar.tsx. It OPENS the trays, so the three flags and
            their togglers travel down as props; the state stays here. */}
        <ComposerToolbar
          trayMode={trayMode}
          composerLocked={composerLocked}
          showEmoji={showEmoji}
          showStickers={showStickers}
          showQuickReply={showQuickReply}
          /* the toolbar closes the three PANELS; the translate strip has its own button */
          anyTrayOpen={trayPanelOpen}
          mode={mode}
          setMode={setMode}
          room={room}
          caps={caps}
          fileRef={fileRef}
          onPickImage={onPickImage}
          toggleTray={toggleTray}
          closeAllTrays={closeAllTrays}
          trayCloseLabel={trayCloseLabel}
          onOpenTraySettings={onOpenTraySettings}
          traySettingsLabel={traySettingsLabel}
          /* [FEAT-20260918-ROOMTRANS] Pressing the translate button opens the unified room translate modal directly */
          onTranslate={() => {
            window.dispatchEvent(new CustomEvent('tc:open-room-translate-modal'));
          }}
          translateOpen={translatePickerOpen}
          translateDisabled={translating || translateRefused}
          translateMuted={false}
        />

        {/* [REFACTOR-20260905-CHATINPUT] emoji / sticker / ตอบด่วน panels and the
            staged-attachment trays — moved to ./ComposerTrays.tsx. */}
        <ComposerTrays
          trayMode={trayMode}
          mode={mode}
          showEmoji={showEmoji}
          showStickers={showStickers}
          showQuickReply={showQuickReply}
          insertEmoji={insertEmoji}
          pickSticker={pickSticker}
          toggleTray={toggleTray}
          setDraft={setDraft}
          setShowQuickReply={setShowQuickReply}
          pendingImages={pendingImages}
          MAX_PENDING_IMAGES={MAX_PENDING_IMAGES}
          removePendingImage={removePendingImage}
          setPreviewUrl={setPreviewUrl}
          pendingSticker={pendingSticker}
          clearPendingSticker={clearPendingSticker}
        />
        {/* ==== [FEAT-20260908-AITRANSLATE] แปลก่อนส่ง ==========================
            🔴 THE LIST MOUNTS ONLY AFTER A PRESS, which is what keeps a room at
            ZERO translate and ZERO registry requests until the admin asks for
            one. `LanguagePicker` fetches on mount; rendering it unconditionally
            would fire the registry call for every operator who opens a case and
            never translates anything.
            🔴 Picking the language does NOT send. It fills the strip below and
            stops there — the admin presses the existing ➤ afterwards, or does
            not. Reply mode only, for the same reason the button is. */}
        {/* [FIX-20260909-EMPTYDRAFT] the empty-box answer. It is a real modal
            rather than a toast because the press it answers was deliberate, and
            because the picker it replaces is one too — the admin should not have
            to notice a corner. */}
        {needTextWarning && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
            role="presentation"
            data-testid="translate-need-text"
          >
            <div className="w-[22rem] rounded-2xl bg-white p-5 shadow-2xl">
              <p className="px-1 text-[14px] leading-relaxed text-slate-700">
                {t('chat.translate_need_text')}
              </p>
              <button
                type="button"
                onClick={() => setNeedTextWarning(false)}
                className="mt-4 w-full rounded-lg bg-sky-600 px-4 py-2.5 text-[14px] font-bold text-white hover:bg-sky-700 transition-colors"
              >
                {t('common.ok') || 'ตกลง'}
              </button>
            </div>
          </div>
        )}
        {/* [PRESERVED-LANGPICKER] Preserved original LanguagePicker modal for future use if needed
        {translatePickerOpen && mode === 'reply' && (
          <LanguagePicker
            confirm
            filter={(c) => c !== 'th'}
            onPick={async (lang) => {
              await runTranslatePreview(lang);
              setTranslatePickerOpen(false);
            }}
            onClose={() => setTranslatePickerOpen(false)}
          />
        )}
        */}
        {translatePickerOpen && mode === 'reply' && (
          <ComposerAutoSendToggle
            isOpen={translatePickerOpen}
            onClose={() => setTranslatePickerOpen(false)}
            room={room}
            hookId={hookId || room?.hook_id}
            onOpenRoomSettings={() => {
              setTranslatePickerOpen(false);
              window.dispatchEvent(new CustomEvent('tc:open-room-translate-modal'));
            }}
            onUpdateSettings={async (settings) => {
              if (!room) return;
              const roomId = String(room._id || (room as any).id);
              try {
                const res = await chatService.updateRoomTranslateSettings(roomId, settings);
                Object.assign(room, settings);
                if (res?.data) {
                  Object.assign(room, res.data);
                  window.dispatchEvent(
                    new CustomEvent('tc:room-translate-settings-updated', {
                      detail: { roomId, ...res.data },
                    }),
                  );
                }
              } catch (err) {
                console.error('[COMPOSER] update auto_send_translated failed:', err);
              }
            }}
          />
        )}
        {/* [FEAT-20260918-AUTOSENDCONFIRM] the last look before a translated
            reply reaches a customer. Rendered inside the composer so it covers
            the box it is about to send from, and dismissed on either answer. */}
        {autoSendConfirm && (
          <AutoSendConfirm
            text={autoSendConfirm.text}
            targetLang={autoSendConfirm.targetLang}
            onCancel={() => setAutoSendConfirm(null)}
            onConfirm={(remember) => {
              setAutoSendConfirm(null);
              /* Saved BEFORE the send so the local cache is already updated when
                 the next press reads it — `saveLocalPreference` is synchronous
                 and the server PUT rides along behind it. Only ever saved from
                 the OK path: ticking and cancelling remembers nothing. */
              if (remember) rememberAutoSendConfirm(true);
              /* The flag is consumed by the very next `send()` and cleared
                 immediately after, so a later press asks again. One confirm buys
                 one send — never a session-wide permission.
                 ยืนยันหนึ่งครั้ง = ส่งหนึ่งครั้ง */
              autoSendConfirmedRef.current = true;
              void send().finally(() => {
                autoSendConfirmedRef.current = false;
              });
            }}
          />
        )}
        <ComposerTranslateTray
          /* the DERIVED values, never the raw state — see `stagedTranslation`.
             Staged is what the send sends; stale is the same translation kept
             visible after the draft moved on, and the strip says which it is. */
          preview={stagedTranslation ?? staleTranslation}
          stale={!stagedTranslation && !!staleTranslation}
          /* [FIX-20260910-TRANSLATEONEBOX] while a preview is staged the typing
             row below is hidden, so the strip carries the draft and the send
             button. Both are the composer's own — the same `draft` state and the
             same `ComposerSendButton` the row renders when it is back. */
          draft={draft}
          onEditDraft={setDraft}
          /* [FIX-20260910-COMPACTSOURCE] the source field is CAPPED while a
             preview is on screen, not given the dragged height.
             🔴 Owner, 10/09, with two screenshots: *"เวลากดพรีวิวแล้ว ช่อง
                ต้นฉบับย่อลง ให้เท่าภาพสอง"*. A remembered drag of ~200px made
                the Thai the tallest thing in the composer, and the translation —
                the half that is about to reach the customer — sat under it.
             🔴 IT ALSO REMOVES A BUG RATHER THAN GUARDING IT. The strip carries
                four more rows under this field (translation · badge · two hint
                lines), so an uncapped drag pushed them past the composer's own
                ceiling and off the bottom edge. A measured ceiling was written
                for that yesterday and is DELETED in this commit: with a hard cap
                the overflow it defended against cannot occur, and a guard that
                can never fire is debt, not safety.
             ⚠️ `Math.min`, so dragging SMALLER still works and nothing is
                remembered or restored — `areaH` itself is never touched, which
                is what keeps "ปิดแปล = เหมือนเดิม" true by construction. */
          sourceStyle={{ height: Math.min(areaH, PREVIEW_SOURCE_H) }}
          sendSlot={
            <ComposerSendButton
              send={send}
              sending={sending}
              room={room}
              draft={draft}
              overLimit={overLimit}
              MAX_LEN={MAX_LEN}
              mode={mode}
              hasPendingImages={pendingImages.length > 0}
              hasPendingSticker={!!pendingSticker}
            />
          }
          pending={translating}
          error={translateError}
          rateLimited={translateRefused}
          onEditText={(next) => setTranslatePreview(p => (p ? { ...p, text: next } : p))}
          onDiscard={discardTranslatePreview}
          onDismissError={() => { setTranslateError(null); setTranslateRefused(false); }}
        />
        {/* [REFACTOR-20260905-CHATINPUT] quote bar, textarea + send, zoom preview
            and the counter — moved to ./ComposerInputRow.tsx. The height
            decisions are still made above and arrive already decided. */}
        <ComposerInputRow
          reply={reply}
          trayMode={trayMode}
          composerLocked={composerLocked}
          anyTrayOpen={anyTrayOpen}
          showStickers={showStickers}
          /* [FIX-20260910-TRANSLATEONEBOX] one Thai box at a time — see the prop */
          previewOpen={!!stagedTranslation || !!staleTranslation}
          draft={draft}
          setDraft={setDraft}
          send={send}
          onComposerPaste={onComposerPaste}
          textareaStyle={textareaStyle}
          overLimit={overLimit}
          MAX_LEN={MAX_LEN}
          sending={sending}
          room={room}
          mode={mode}
          pendingImages={pendingImages}
          pendingSticker={pendingSticker}
          previewUrl={previewUrl}
          setPreviewUrl={setPreviewUrl}
        />
      </div>

      {/* [REFACTOR-20260905-CHATINPUT] the [FIX-20260728-SENDERR] dialog — moved
          to ./ComposerSendErrorModal.tsx with both of its own markers. */}
      <ComposerSendErrorModal sendError={sendError} setSendError={setSendError} />

    </div>
  );
};

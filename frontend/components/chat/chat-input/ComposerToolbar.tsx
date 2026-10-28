/**
 * ComposerToolbar.tsx — the row above the typing area: emoji / image / sticker
 * / ตอบด่วน on the left, the centred "close the open tray" button, and the
 * settings button + ตอบ|โน้ตในแชท pill on the right.
 *
 * WHAT: moved verbatim from `ChatInputBox` in `pages/chat/TicketChat.tsx`.
 *
 * WHY this is a real seam: it is the one row the code already names and specs
 * as a unit ("toolbar — media buttons + quick-reply on the left, mode switch
 * pill on the right"), and three separate suites are written about it
 * (`chatTrayCloseBar`, `chatTrayCloseCentered`, `chatComposerFontAndTray`).
 *
 * ⚠️ NO STATE MOVED — and that is why the prop list is long. The toolbar is
 * what OPENS the trays, so it needs `showEmoji` / `showStickers` /
 * `showQuickReply` and the togglers. The tidier-looking alternative — letting
 * the toolbar own those three `useState`s — was REJECTED: the tray panels and
 * several height rules in `ChatInputBox` read the same three flags, so moving
 * them down would have forced them back up through callbacks and changed when
 * each side re-renders. That is a behaviour change, and this task is
 * organisation (`dev-local` §6.4). ย้าย state = พฤติกรรมเปลี่ยน จึงส่งเป็น prop แทน.
 *
 * ⚠️ `tc-fixed-scale-1` on the close button is load-bearing: it pins
 * `--tc-chat-scale: 1` so neither the font preference nor a tray's own override
 * can inflate it. Do not "tidy" it away.
 *
 * revert: paste the JSX back where `<ComposerToolbar …/>` is rendered in
 *   `./ChatInputBox.tsx`, drop this file and its line in `./index.ts`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { Image as ImageIcon, Languages, Maximize2, Smile, X, Zap } from 'lucide-react';
import type { ChatRoom } from '../../../services/chat';
import type { ChannelCapabilities } from '../../../config/channelRegistry';
import { chatComposerFixedRowClass } from '../../../hooks/chatTrayMode';

export const ComposerToolbar: React.FC<{
  trayMode?: string;
  composerLocked: boolean;
  showEmoji: boolean;
  showStickers: boolean;
  showQuickReply: boolean;
  anyTrayOpen: boolean;
  mode: 'reply' | 'note';
  setMode: React.Dispatch<React.SetStateAction<'reply' | 'note'>>;
  room: ChatRoom | null;
  caps: ChannelCapabilities;
  fileRef: React.MutableRefObject<HTMLInputElement | null>;
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toggleTray: (which: 'emoji' | 'sticker' | 'quick') => void;
  closeAllTrays: () => void;
  trayCloseLabel: string;
  onOpenTraySettings?: () => void;
  traySettingsLabel?: string;
  /* [FEAT-20260908-AITRANSLATE] press → open the language list. OPTIONAL and
     gated with `&&` below, exactly like `onOpenTraySettings` above: a caller
     that omits it renders the toolbar it always rendered, byte for byte.
     🔴 It is a PRESS handler and nothing else. There is no `onChange`, no
     `onBlur` and no debounce anywhere on this row — §4C: a debounce would spend
     the whole minute's allowance of six on one sentence being typed. */
  onTranslate?: () => void;
  /** the language list is open — the button reads as pressed */
  translateOpen?: boolean;
  /** a press is in flight, or a 429 latched it. Disabled beats "pressable and
      always fails" (§4C). Never a client-side counter — see ChatInputBox. */
  translateDisabled?: boolean;
  /** Looks discouraged, still pressable — so the press can be answered. */
  translateMuted?: boolean;
}> = ({ trayMode, composerLocked, showEmoji, showStickers, showQuickReply, anyTrayOpen, mode, setMode, room, caps, fileRef, onPickImage, toggleTray, closeAllTrays, trayCloseLabel, onOpenTraySettings, traySettingsLabel, onTranslate, translateOpen, translateDisabled, translateMuted }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  return (
  <>
        {/* toolbar — media buttons + quick-reply on the left, mode switch pill on the right (matches ai-chat_interface_final mock) */}
        {/* [FIX-20260830-TRAYBOTTOM] the toolbar is what OPENS and closes the tray,
            so it must survive the tray taking the rest of the height. */}
        {/* [FIX-20260830-CLOSECENTER] `relative` makes this row the positioning
            context the centred close button resolves against — see the button. */}
        <div className={chatComposerFixedRowClass(trayMode, `${composerLocked ? 'hidden' : 'flex'} items-center gap-2 px-3 py-2 border-b border-gray-100 bg-white relative`)}>
          <button
            type="button"
            onClick={() => toggleTray('emoji')}
            className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${showEmoji ? 'text-primary' : 'text-gray-400 hover:text-gray-700'}`} title={t('ticketui.composer.emoji', 'อิโมจิ')}
          ><Smile size={16} /></button>
          {/* (paperclip removed — LINE has no generic file message; only image/
              sticker are supported, which have their own buttons below) */}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImage} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={mode !== 'reply' || !room}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={mode === 'reply' ? t('ticketui.composer.send_image', 'ส่งรูปภาพ') : t('ticketui.composer.send_image_reply_only', 'ส่งรูปได้เฉพาะโหมดตอบ')}
          ><ImageIcon size={16} /></button>
          {/* sticker button shown only if the channel supports stickers (LINE yes;
              e.g. FB no). Capability-driven — not a channel name check. */}
          {caps.sticker && (
            <button
              type="button"
              onClick={() => toggleTray('sticker')}
              disabled={mode !== 'reply' || !room}
              className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showStickers ? 'text-primary' : 'text-gray-400 hover:text-primary'}`}
              title={mode === 'reply' ? t('ticketui.composer.send_sticker', 'ส่งสติกเกอร์') : t('ticketui.composer.send_sticker_reply_only', 'ส่งสติกเกอร์ได้เฉพาะโหมดตอบ')}
            ><Smile size={16} className="scale-110" strokeWidth={2.5} /></button>
          )}
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button
            type="button"
            onClick={() => toggleTray('quick')}
            disabled={mode !== 'reply' || !room}
            /* [FIX-20260910-TOOLBARBIGGER] +10% — owner, 10/09. These two are the
               only WORDED buttons in a row of icons, and they were the smallest
               thing in it. Height, text and icon all move together, or the label
               grows inside a box that did not. */
            className={`h-[26px] inline-flex items-center gap-1.5 text-[11px] font-bold transition-colors px-2.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${showQuickReply ? 'text-primary bg-blue-50' : 'text-gray-400 hover:text-primary bg-gray-100 hover:bg-blue-50'}`}
            title={mode === 'reply' ? t('ticketui.composer.quick_reply_title', 'ข้อความตอบกลับด่วน') : t('ticketui.composer.quick_reply_reply_only', 'ตอบด่วนได้เฉพาะโหมดตอบ')}
          >
            <Zap size={13} className="text-yellow-500" /> {t('ticketui.composer.quick_reply', 'ตอบด่วน')}
          </button>
          {/* [FEAT-20260908-AITRANSLATE] แปลก่อนส่ง — press-triggered, ALWAYS.
              Reply mode only: an internal note never goes to the customer, so
              translating one would spend a billed AI call on text nobody but us
              will ever read. Same `mode !== 'reply'` gate the image and sticker
              buttons above already use, for the same reason.
              🔴 `onClick` and nothing else. No `onMouseEnter`, no `onFocus`, no
                 timer. Every translation in this app is a press. */}
          {onTranslate && (
            <button
              type="button"
              onClick={onTranslate}
              /* [FIX-20260909-EMPTYDRAFT] `translateMuted` LOOKS disabled and is
                 still PRESSABLE — owner, 09/09: "ปุ่มยังห้ามอยู่ ถ้าฝืนกด ให้เตือน
                 modal … คือเราไม่ห้ามกดแล้ว กดได้ แต่จะเตือนแทน".
                 🔴 A truly `disabled` button cannot fire `onClick`, so it can
                    never explain itself: the admin is left guessing which of the
                    several reasons greyed it out. Muted keeps the discouraging
                    look and buys back the ability to answer.
                 ⚠️ `translateDisabled` is unchanged and still a real `disabled`
                    — it means a translation is RUNNING or the limiter refused,
                    and both of those already have a message on screen. */
              disabled={mode !== 'reply' || !room || !!translateDisabled}
              data-testid="composer-translate-btn"
              /* [FIX-20260910-TOOLBARBIGGER] +10%, and the word is `แปลภาษา` —
                 `แปล` alone reads as a verb with no object next to `ตอบด่วน`.
                 [FIX-20260910-TRANSLATEGLOW] `tc-translate-glow` = an animated
                 blue ring, BORDER ONLY. Owner: *"ไม่ต้อง bg นะสีเดิม"* — the
                 background stays exactly what it was in all three states
                 (idle / open / hover), so the button that was already there is
                 still the button, only now it says "there is something here".
                 ⚠️ IT GLOWS IN EVERY STATE, muted and disabled included —
                    owner's call, 10/09, overruling my first cut. The fade and
                    the cursor already say "not now"; the glow says "the button
                    is here", and that is true whether or not it can be pressed. */
              className={`tc-translate-glow h-[26px] inline-flex items-center gap-1.5 text-[11px] font-bold transition-colors px-2.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${translateMuted ? 'opacity-40' : ''} ${translateOpen ? 'text-primary bg-blue-50' : 'text-gray-400 hover:text-primary bg-gray-100 hover:bg-blue-50'}`}
              title={mode === 'reply' ? t('ticketui.composer.translate_title', 'แปลข้อความก่อนส่ง (ยังไม่ส่ง)') : t('ticketui.composer.translate_reply_only', 'แปลได้เฉพาะโหมดตอบ')}
            >
              <Languages size={13} /> {t('ticketui.composer.translate', 'แปลภาษา')}
            </button>
          )}
          {/* ==== [FEAT-20260830-TRAYCLOSEBAR] one close button, in the toolbar ====
              Owner, 30/08: *"ปุ่มปิดย้ายไปอยู่ตรงกลาง ระหว่างตอบด่วนกับปุ่มขยาย ·
              สเกล font ปกติ ไม่สนใจ 6 scale"*.

              🔴 the cause of what the owner saw: each tray rendered its OWN
              `PanelCloseButton` in a `sticky top-0` strip INSIDE the panel — and
              the emoji/sticker panels carry a fixed `--tc-chat-scale` override
              ([FEAT-20260830-TRAYFIXEDSCALE]) that the index.css rules multiply
              through, so the sticker tray's close button was inflated to the
              largest step and looked huge.

              ⇒ one button, here in the toolbar, outside every panel and outside
              every scale override. `.tc-fixed-scale-1` (index.css) pins
              `--tc-chat-scale: 1` on this subtree, so neither the user's font
              preference nor a tray's own override can resize it.

              It closes whichever tray is open, and renders only when one is. */}
          {/* ==== [FIX-20260830-CLOSECENTER] the close button is CENTRED ====
              Owner, 30/08, twice: *"ปุ่ม ปิดแผง ย้ายไปตรงกลางจอ"* — the button
              must sit at the horizontal centre of the toolbar row, not merely to
              the right of "ตอบด่วน" where it read as part of the left cluster.

              🔴 why it was not centred: it was just the next flex child after
              ตอบด่วน, and `ml-auto` on the settings button pushes only the RIGHT
              cluster away — everything before it stays packed left.

              ── absolute centring, not three-zone flex ────────────────────────
              `absolute left-1/2 -translate-x-1/2` centres against the ROW, so the
              button lands at the true middle of the chat column regardless of how
              wide the left icon cluster or the right pill happen to be. The
              three-zone alternative (`flex-1` spacers either side) centres against
              the LEFTOVER space instead, so the button drifts off-centre whenever
              the two clusters differ in width — and they do, the right one holds a
              two-option pill. Taking the button out of flow also means it cannot
              push the clusters around at narrow widths; `pointer-events-none` on
              the wrapper with `pointer-events-auto` on the button itself keeps the
              gap either side of it clickable-through rather than a dead strip
              overlaying the toolbar.
              Everything else is unchanged: `tc-fixed-scale-1` still pins its size
              against every font scale and tray override, and it still renders only
              while a tray is open and still closes whichever one that is. */}
          {anyTrayOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <button
                type="button"
                onClick={closeAllTrays}
                className="tc-fixed-scale-1 pointer-events-auto h-7 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-500 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800"
                title={trayCloseLabel}
                aria-label={trayCloseLabel}
              >
                <X size={12} className="shrink-0" /> {trayCloseLabel}
              </button>
            </div>
          )}
          {/* mode switch pill (right) */}
          {/* [FEAT-20260830-TRAYFULL] ปุ่มตั้งค่าการแสดงแผงเครื่องมือ — วางข้าง
              ปุ่ม ตอบ|โน้ตในแชท ตามที่เจ้าของสั่ง
              ⚠️ `ml-auto` ย้ายมาที่ปุ่มนี้แทน เพราะเดิมอยู่ที่ pill ซึ่งเป็นตัว
              ดันทุกอย่างไปขวา — ถ้าไม่ย้าย ปุ่มใหม่จะไปติดกลุ่มปุ่มซ้ายแทน */}
          {onOpenTraySettings && (
            <button
              type="button"
              onClick={onOpenTraySettings}
              className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title={traySettingsLabel}
              aria-label={traySettingsLabel}
            >
              <Maximize2 size={15} />
            </button>
          )}
          <div className={`tc-mode-switch ${onOpenTraySettings ? '' : 'ml-auto'} inline-flex items-center gap-0.5 p-1 rounded-full`}>
            <button
              onClick={() => setMode('reply')}
              className={`tc-mode-opt px-3 py-[5px] rounded-full text-[12px] font-extrabold leading-none whitespace-nowrap transition-colors ${mode === 'reply' ? 'tc-mode-active' : ''}`}
            >{t('ticketui.composer.mode_reply', 'ตอบ')}</button>
            <button
              onClick={() => setMode('note')}
              className={`tc-mode-opt px-3 py-[5px] rounded-full text-[12px] font-extrabold leading-none whitespace-nowrap transition-colors ${mode === 'note' ? 'tc-mode-active' : ''}`}
            >{t('ticketui.composer.mode_note', 'โน้ตในแชท')}</button>
          </div>
        </div>
  </>
  );
};

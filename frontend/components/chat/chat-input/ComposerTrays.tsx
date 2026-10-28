/**
 * ComposerTrays.tsx — everything that opens BETWEEN the toolbar and the typing
 * area: the emoji grid, the sticker grid, the ตอบด่วน panel, and the trays that
 * show what is already staged (images, and the staged sticker preview).
 *
 * WHAT: moved verbatim from `ChatInputBox` in `pages/chat/TicketChat.tsx`, in
 * source order and with every comment.
 *
 * WHY this is a real seam: the repo already split this trio out once — the
 * DATA behind two of these panels lives in `pages/chat/composer-trays/`
 * (`[FEAT-20260830-TRAYDATA]`, "tray data in its own tidy folder"). This is the
 * rendering half of that same unit. The staged trays join them because they
 * occupy the same slot in the stack and obey the same "reply mode only" rule.
 *
 * ⚠️ NO STATE MOVED. `showEmoji` / `showStickers` / `showQuickReply`,
 * `pendingImages`, `pendingSticker` and `previewUrl` all stay declared in
 * `ChatInputBox`; this file receives their values and the setters it needs
 * (`setDraft`, `setShowQuickReply`, `setPreviewUrl`) under their original
 * names, so every moved line is byte-identical (`dev-local` §6.4).
 *
 * ⚠️ Both fixed-scale overrides are load-bearing: the emoji tray is pinned at
 * step 3 and the sticker tray at the largest step, and index.css does the
 * sizing from those variables. Changing either changes what the operator sees.
 *
 * revert: paste the five blocks back where `<ComposerTrays …/>` is rendered in
 *   `./ChatInputBox.tsx`, drop this file and its line in `./index.ts`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { RefreshCw, X, Zap } from 'lucide-react';
import PendingImagesTray from '../PendingImagesTray';
import { QuickReplyManager } from '../QuickReplyManager';
import { EMOJI_SET, STICKER_PACKS } from '../../../pages/chat/composer-trays';
import { EMOJI_TRAY_FIXED_SCALE, STICKER_TRAY_FIXED_SCALE } from '../../../hooks/chatFontScale';
import { chatTrayPanelClass, isChatTrayFull } from '../../../hooks/chatTrayMode';

export const ComposerTrays: React.FC<{
  trayMode?: string;
  mode: 'reply' | 'note';
  showEmoji: boolean;
  showStickers: boolean;
  showQuickReply: boolean;
  insertEmoji: (em: string) => void;
  pickSticker: (packageId: string, stickerId: string) => void;
  toggleTray: (which: 'emoji' | 'sticker' | 'quick') => void;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setShowQuickReply: React.Dispatch<React.SetStateAction<boolean>>;
  pendingImages: { file: File; url: string }[];
  MAX_PENDING_IMAGES: number;
  removePendingImage: (index: number) => void;
  setPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  pendingSticker: { packageId: string; stickerId: string } | null;
  clearPendingSticker: () => void;
}> = ({ trayMode, mode, showEmoji, showStickers, showQuickReply, insertEmoji, pickSticker, toggleTray, setDraft, setShowQuickReply, pendingImages, MAX_PENDING_IMAGES, removePendingImage, setPreviewUrl, pendingSticker, clearPendingSticker }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  return (
  <>
        {/* Emoji picker — native Unicode emoji grid (renders on every OS/browser) */}
        {showEmoji && (
          <div
            className={chatTrayPanelClass(trayMode, 'border-b border-gray-100 bg-white p-2 max-h-40 overflow-y-auto custom-scrollbar')}
            /* [FEAT-20260830-TRAYFIXEDSCALE] the emoji tray is PINNED at step 3 and
               must ignore the font-scale preference entirely (owner, 30/08/2026).
               Re-declaring the variable here overrides the one painted on
               .tc-col-center for this subtree only, so every existing rule in
               index.css keeps doing the sizing — no second set of pixel values.
               It never reads the stored value, so "never set" / null / garbage all
               land on the same step by construction. */
            style={{ ['--tc-chat-scale' as never]: String(EMOJI_TRAY_FIXED_SCALE) }}
          >
            {/* [FEAT-20260830-TRAYCLOSEBAR] the in-panel close strip lived here.
                It is gone: the one close button now sits in the toolbar, where the
                tray's fixed `--tc-chat-scale` override cannot inflate it. */}
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_SET.map(em => (
                <button key={em} type="button" onClick={() => insertEmoji(em)} className="text-xl hover:bg-gray-100 rounded p-0.5 leading-none">{em}</button>
              ))}
            </div>
          </div>
        )}
        {/* Sticker picker — official send-only LINE stickers, rendered via the CDN */}
        {showStickers && (
          <div
            className={chatTrayPanelClass(trayMode, 'border-b border-gray-100 bg-white p-2 max-h-48 overflow-y-auto custom-scrollbar')}
            /* [FEAT-20260830-TRAYFIXEDSCALE] the sticker tray is PINNED at the LARGEST
               step and must ignore the font-scale preference entirely (owner,
               30/08/2026). Same mechanism as the emoji tray above: one local
               re-declaration of the multiplier, so `.tc-col-center .w-12/.h-12`
               in index.css keeps being the only place the sticker size is written. */
            style={{ ['--tc-chat-scale' as never]: String(STICKER_TRAY_FIXED_SCALE) }}
          >
            {/* [FEAT-20260830-TRAYCLOSEBAR] close strip removed — see the toolbar
                button. This panel's scale-6 override is exactly what made the old
                button look huge in the owner's screenshot. */}
            {STICKER_PACKS.map(pack => (
              <div key={pack.packageId} className="mb-2">
                {/* [FEAT-20260830-TRAYFIXEDSCALE] the per-pack "แพ็ค <id>" heading is
                    gone by owner request (30/08/2026). The packs still render in the
                    same order — only the label was dropped. */}
                <div className="grid grid-cols-5 gap-1">
                  {pack.stickerIds.map(sid => (
                    <button key={sid} type="button" onClick={() => pickSticker(pack.packageId, sid)} className="hover:bg-gray-100 rounded p-1" title={`sticker ${sid}`}>
                      <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${sid}/android/sticker.png`} alt="" className="w-12 h-12 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Quick-reply panel — full-width block INSIDE the composer (like the
            sticker/emoji pickers). Pick a message → inserts into the draft (NOT
            sent). CRUD inline. */}
        {showQuickReply && (
          <div className={chatTrayPanelClass(trayMode, 'border-b border-gray-100 bg-white p-3 max-h-[46vh] overflow-y-auto custom-scrollbar')}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold flex items-center gap-1.5"><Zap size={13} className="text-yellow-500" /> {t('ticketui.composer.quick_reply_tray', 'ข้อความตอบด่วน')}</span>
              {/* [FEAT-20260830-TRAYCLOSEBAR] close button removed — one lives in the
                  toolbar now, between ตอบด่วน and the expand button. */}
            </div>
            <QuickReplyManager
              variant="panel"
              /* [FIX-20260830-TRAYFULLINNER] cap ความสูงตัวจริงอยู่ข้างใน component นี้
                 การลบ max-h ที่ div ชั้นนอกอย่างเดียวจึงไม่ทำให้เต็มจอ */
              full={isChatTrayFull(trayMode)}
              onPick={(text) => { setDraft(d => (d ? d + '\n' : '') + text); setShowQuickReply(false); }}
            />
          </div>
        )}
        {/* [FEAT-20260816-MULTIIMG] staged images tray — appears above the
            textarea after picking/pasting (reply mode). Click a thumb to
            expand; ✕ on each to remove; the image button appends more (up to
            5). Sent together with the caption via send(). */}
        {pendingImages.length > 0 && mode === 'reply' && (
          <div className="bg-white">
            <PendingImagesTray
              items={pendingImages}
              max={MAX_PENDING_IMAGES}
              onRemove={removePendingImage}
              onPreview={(url) => setPreviewUrl(url)}
            />
          </div>
        )}
        {/* staged sticker preview — ✕ to remove, sticker button to re-pick. Sent
            on ➤ (its own message, no caption). */}
        {pendingSticker && mode === 'reply' && (
          <div className="px-2 pt-2 bg-white">
            <div className="relative inline-block">
              <img
                src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${pendingSticker.stickerId}/android/sticker.png`}
                alt={t('ticketui.composer.sticker', 'สติกเกอร์')}
                className="h-20 w-20 object-contain rounded-lg border border-gray-200 shadow-sm bg-gray-50"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
              />
              <button
                type="button"
                onClick={clearPendingSticker}
                title={t('ticketui.composer.remove_sticker', 'เอาสติกเกอร์ออก')}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center shadow hover:bg-red-600 transition-colors"
              >
                <X size={12} />
              </button>
              <button
                type="button"
                onClick={() => { if (!showStickers) toggleTray('sticker'); }}
                title={t('ticketui.composer.change_sticker', 'เปลี่ยนสติกเกอร์')}
                className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shadow hover:bg-blue-700 transition-colors"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            <span className="ml-2 text-[10px] text-gray-400 align-bottom">{t('ticketui.composer.press_send_sticker', 'กด ➤ เพื่อส่งสติกเกอร์')}</span>
          </div>
        )}
  </>
  );
};

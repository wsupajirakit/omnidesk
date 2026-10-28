import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
// 🔴 THE CHAT ROOM'S RENDERER, IMPORTED — NOT COPIED, NOT MODIFIED.
// `FlexBubble` calls itself the single source of truth and is already shared by
// the chat room and the template preview. Importing it means this panel follows
// every future fix to it for free; a copy would have to be chased by hand and
// would drift the first time somebody fixed a layout bug in one of them.
// ⚠️ ห้ามแก้ไฟล์นั้นเด็ดขาด — sync มาใช้เฉย ๆ.
import { FlexBubble, canRenderFlex } from '../../chat/FlexBubble';
import { useI18n } from '../../../i18n';
import type { BroadcastPreview } from '../../../types';

/**
 * [FEAT-20260823-BCASTPREVIEW] What the campaign will actually send.
 * ===========================================================================
 * The backend renders; this only draws. That split is the whole design:
 * `FlexPreviewModal` already has a `replacements` prop, and using it would
 * have been quicker — but its substitution rule is its own (it replaces a tag
 * even without braces, `FlexPreviewModal.tsx:56-62`), so the picture would
 * differ from what LINE receives. Asking the backend for the finished card
 * means the preview shows the same bytes the sender builds.
 * ให้ BE แทนค่ามาให้เสร็จ FE แค่วาด ⇒ ตรงกับของจริงเสมอ.
 *
 * ⚠️ ONE CARD PER OA. `hook_*` and `site_rules.*` differ per OA, so a single
 *    card cannot represent a job that sends to two of them.
 *
 * revert: delete this folder and the button in `BroadcastFormModal`.
 */
interface Props {
  loading: boolean;
  error?: string;
  preview?: BroadcastPreview;
}

export const BroadcastPreviewPanel: React.FC<Props> = ({ loading, error, preview }) => {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-700" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('broadcast.preview_loading')}
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-sm text-red-500" role="alert" data-testid="preview-error">
        {error}
      </p>
    );
  }

  if (!preview) return null;

  return (
    <div className="space-y-4" data-testid="broadcast-preview">
      {/* 🔴 ALWAYS RENDERED WHEN legacy. The cards below will contain literal
          {{braces}} in that mode, which reads as a broken renderer unless the
          reason is on screen next to them. ต้องบอกเหตุผลข้าง ๆ การ์ดเสมอ. */}
      {preview.mirrors === 'legacy' && (
        <div
          className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300"
          data-testid="preview-legacy-notice"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('broadcast.preview_legacy_notice')}</span>
        </div>
      )}

      {/* 🔴 A CAP THAT IS NOT SHOWN IS A LIE. The send refuses a job that names
          more OAs than one run may reach, so a short list here without a note
          would look like the whole job and then fail at send for a reason the
          preview never hinted at. ตัดแล้วต้องบอก. */}
      {preview.truncatedToHooks !== undefined && (
        <div
          className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300"
          data-testid="preview-truncated"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('broadcast.preview_truncated', { n: preview.truncatedToHooks })}</span>
        </div>
      )}

      {preview.cards.length === 0 && (
        <p className="py-4 text-sm text-slate-700">{t('broadcast.preview_empty')}</p>
      )}

      {preview.cards.map(card => (
        <div key={card.hook_id} className="rounded-xl border border-dark-700 p-3">
          <p className="mb-2 text-xs font-medium text-slate-700">{card.hook_name}</p>

          {canRenderFlex(card.message?.contents ?? card.message) ? (
            <FlexBubble json={card.message?.contents ?? card.message} />
          ) : (
            /* text and image messages have no flex body to render — showing the
               words themselves is the honest fallback, not an error. */
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-dark-800 p-3 text-sm text-slate-200">
              {card.message?.text ?? card.message?.originalContentUrl ?? ''}
            </pre>
          )}

          {card.unknownTags.length > 0 && (
            /* The ONLY place an admin ever hears which tags could not be
               filled — the send collects them and displays them nowhere. */
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-300" data-testid="preview-unknown-tags">
              {t('broadcast.preview_unknown_tags')}
              <code className="ml-1 break-all">{card.unknownTags.join(', ')}</code>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

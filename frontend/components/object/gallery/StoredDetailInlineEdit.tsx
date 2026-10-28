/**
 * [FEAT-20260907-INLINEDETAIL] Editing a stored file's detail from its own tile.
 * ===========================================================================
 * The album grid shows each file's detail next to its rank ("#1 promo banner").
 * Changing that text used to mean opening the full detail dialog, which also
 * carries the link field and a save/cancel footer — a lot of screen for one
 * line. This is the shortcut: a pencil on the strip turns it into an input with
 * its own save.
 *
 * 🔴 IT DOES NOT SAVE. It hands the text up, and the page calls the SAME
 *    `saveDetail` the dialog calls (`form/useGalleryActions.ts`). Everything
 *    after the request — refetching the album, the success and failure alerts —
 *    is shared, because a second copy is exactly where "the dialog refreshes the
 *    grid but the inline one does not" comes from.
 *
 * 🔴 ITS OWN FILE. `form/ObjectFormMediaStep.tsx` is 469 lines, already past the
 *    400-line cap, and the tile markup inside it is dense enough as it is.
 *
 * ⚠️ THE DRAFT LIVES HERE. The parent only remembers WHICH tile is open; the
 *    text being typed never leaves this component until save. That keeps one
 *    keystroke from re-rendering the whole grid, which at five across with videos
 *    mounted is a visible cost.
 *
 * ⚠️ Enter saves and Escape cancels. The strip is narrow and its buttons are
 *    small; somebody who has just typed a line expects Enter to mean something.
 *    ⚠️ The form this sits inside submits on Enter, so the handler stops the
 *       event — without that, editing a caption would try to save the ALBUM.
 *
 * revert: delete this file and drop `<StoredDetailInlineEdit>` plus the pencil
 * from the rank strip in `ObjectFormMediaStep.tsx`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import { useI18n } from '../../../i18n';

export interface StoredDetailInlineEditProps {
  /** The text as stored; the draft starts from it each time the editor opens. */
  readonly initialText: string;
  readonly saving: boolean;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}

export const StoredDetailInlineEdit: React.FC<StoredDetailInlineEditProps> = ({
  initialText,
  saving,
  onSave,
  onCancel,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Open on the value as it stands, and put the cursor in the field — the pencil
     is a small target and asking for a second click to type is a wasted one. */
  useEffect(() => {
    setDraft(initialText);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [initialText]);

  const commit = (): void => onSave(draft.trim());

  return (
    <div
      className="flex w-full items-center gap-1"
      data-testid="inline-detail-edit"
      /* The strip sits on top of a draggable tile and inside a form. Clicks and
         key presses that reach either would start a drag or submit the album. */
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      draggable={false}
    >
      <input
        ref={inputRef}
        type="text"
        data-testid="inline-detail-input"
        value={draft}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={t('object_image.form_detail_text_placeholder')}
        className="min-w-0 flex-1 rounded bg-white/95 px-1.5 py-0.5 text-[11px] font-bold normal-case tracking-normal text-slate-900 outline-none focus:ring-1 focus:ring-white disabled:opacity-60"
      />
      <button
        type="button"
        data-testid="inline-detail-save"
        onClick={commit}
        disabled={saving}
        title={t('common.save')}
        aria-label={t('common.save')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/20 text-white transition-colors hover:bg-white/35 disabled:opacity-50"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button
        type="button"
        data-testid="inline-detail-cancel"
        onClick={onCancel}
        disabled={saving}
        title={t('common.cancel')}
        aria-label={t('common.cancel')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/25 hover:text-white disabled:opacity-50"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export default StoredDetailInlineEdit;

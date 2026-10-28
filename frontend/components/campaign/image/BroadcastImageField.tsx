/**
 * [FEAT-20260907-IMAGEONLYPICKER] The image message's URL field — with a way to
 * pick the image instead of typing its address.
 * ===========================================================================
 * on the IMAGE message type, offer an "Attach IMG" button that
 * opens the media gallery the flex editor already uses, restricted to images
 * (no video), pasting the link straight into the field; show a preview of the
 * attached image beside the input; let it be cleared; and let a second attach
 * REPLACE the first without clearing first.
 *
 * 🔴 THE GALLERY IS REUSED, NOT REBUILT — and the flex one is untouched. The
 *    dive that established this, rather than assuming it:
 *      · `services/media/mediaPickerService.ts:6` already types
 *        `MediaPickerKindFilter = 'all' | 'image' | 'video'` and `:99` sends the
 *        `media_kind` param only when it is not `'all'`.
 *      · `media-picker/MediaItemListView.tsx` owned `kindFilter` as private
 *        state defaulting to `'all'`, with All/IMG/VDO pills.
 *      · `MediaPickerModal` knew nothing about kind at all.
 *    So one OPTIONAL `lockKind` prop was threaded button → modal → item view.
 *    Absent, everything renders exactly as before, which is what leaves
 *    `components/flex/FlexMessageFormModal.tsx` — the only other caller —
 *    byte-identical. ห้ามกระทบ picker ของ flex: ทำได้ด้วย prop ที่ไม่ส่ง = ของเดิม.
 *
 * 🔴 THE FIELD REMAINS THE SOURCE OF TRUTH. Attaching writes the URL into
 *    `value` through `onChange` — the same string a person could have typed. No
 *    second piece of state holds "the attached image", so the preview cannot
 *    disagree with what will be sent, and clearing is just `onChange('')`.
 *    Re-attaching therefore REPLACES by construction: it writes over the value.
 *
 * ⚠️ ITS OWN FILE. `BroadcastFormModal.tsx` is far past the 400-line cap and its
 *    header forbids adding UI to it. `campaign/image/` is a new role folder — it
 *    holds this field and is expected to hold the rest of the image branch if it
 *    grows; a second file would otherwise land back in the modal.
 *
 * ⚠️ The preview is a plain <img> with `onError`. A URL can be typed by hand, can
 *    404, or can point at something that is not an image; a broken-image icon
 *    with no explanation looks like the feature failed, so a failed load says so
 *    and the field still holds whatever was entered.
 *
 * revert: delete this folder and restore the plain <input> + hint that
 * `BroadcastFormModal.tsx` rendered for `message.type === 'image'`.
 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { AttachMediaButton } from '../../media-picker/AttachMediaButton';
import type { MediaPickerMediaItem } from '../../media-picker/types';
import { useI18n } from '../../../i18n';

export interface BroadcastImageFieldProps {
  readonly value: string;
  readonly onChange: (url: string) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly inputClassName?: string;
}

export const BroadcastImageField: React.FC<BroadcastImageFieldProps> = ({
  value,
  onChange,
  disabled = false,
  invalid = false,
  inputClassName = '',
}) => {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);

  /* A new URL deserves a fresh verdict — without this, one bad address would
     leave the "cannot load" state stuck for every image chosen afterwards. */
  useEffect(() => {
    setBroken(false);
  }, [value]);

  return (
    <div data-testid="broadcast-image-field">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            type="url"
            name="message_image_url"
            data-testid="broadcast-image-url"
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className={inputClassName}
            placeholder={t('broadcast.form_message_image_placeholder')}
          />
          <p className="mt-1 text-xs text-slate-700">
            {t('broadcast.form_message_image_hint')}
          </p>
        </div>

        {/* [FEAT-20260907-IMAGEONLYPICKER] `lockKind="image"` is the whole ask:
            images only, no video. Uncontrolled — the button owns the modal, so
            this field never learns how the picker works.
            ⚠️ Pressing it again with an image already attached simply writes the
               new URL over the old one. There is no "already attached" branch to
               get wrong. */}
        <div className="flex shrink-0 items-center gap-2">
          <AttachMediaButton
            lockKind="image"
            /* [FEAT-20260907-USETHISIMAGE] the tile button says "ใช้ภาพนี้" and puts the
               url straight into the field — no copy-then-paste round trip. */
            selectAction="use"
            /* [FIX-20260907-PICKERHEADERRIGHT] owner asked for the upload button to
               hug the right — scoped to this caller, see the prop's note. */
            headerActionsRight
            disabled={disabled}
            label={t('broadcast.attach_image')}
            tooltip={t('broadcast.attach_image')}
            onSelectMedia={(m: MediaPickerMediaItem) => onChange(m.image_url)}
          />

          {/* [FIX-20260907-IMAGECLEARVISIBLE] A REAL BUTTON, beside Attach IMG.
              It was a faint ✕ floated inside the input at `right-2` — but the
              shared `inputClass` only carries `px-4`, so it sat ON TOP of the URL
              instead of in reserved space, and read as "there is no clear
              button". Rather than widening a padding every other field in the
              broadcast form shares, the control moved out to where it is
              unmistakably a control.
              ⚠️ Still just `onChange('')`: the field IS the state, so there is
                 nothing else to reset. Shown only when there is something to
                 clear, and hidden while read-only. */}
          {value !== '' && !disabled && (
            <button
              type="button"
              data-testid="broadcast-image-clear"
              onClick={() => onChange('')}
              title={t('common.clear')}
              aria-label={t('common.clear')}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={14} />
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      {value !== '' && (
        <div className="mt-2 flex items-start gap-3" data-testid="broadcast-image-preview">
          {broken ? (
            <p className="text-xs text-amber-600" data-testid="broadcast-image-preview-error">
              {t('broadcast.image_preview_failed')}
            </p>
          ) : (
            /* [UI-20260907-BIGGERIMGPREVIEW] bigger. It was a 96px
               square, which is a thumbnail, not a preview of what a follower is
               about to receive.
               ⚠️ `object-contain`, NOT `object-cover`. Cover CROPS to fill the
                  box, so a tall or wide image would be shown with its edges
                  missing — a preview that lies about what gets sent. Contain
                  fits the whole thing and letterboxes instead, which is why the
                  box carries a background of its own.
               ⚠️ `max-w-full` so a wide image cannot push the form sideways. */
            <img
              src={value}
              alt=""
              data-testid="broadcast-image-preview-img"
              onError={() => setBroken(true)}
              className={`h-56 max-w-full rounded-lg bg-slate-50 object-contain ring-1 ${
                invalid ? 'ring-red-400' : 'ring-slate-200'
              }`}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default BroadcastImageField;

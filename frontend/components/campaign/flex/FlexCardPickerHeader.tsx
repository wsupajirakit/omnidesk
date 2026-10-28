/**
 * [FEAT-20260907-FLEXPICKREFRESH] The label above the flex picker, and the
 * button that reloads its list.
 * ===========================================================================
 * Owner, 07/09: step 2 of the broadcast form called this field "message", which
 * is what the TEXT and IMAGE branches are. On the flex branch it is not a
 * message at all — it is which saved card gets sent. And the list beside it must
 * be reloadable on demand, not only whenever the component happens to remount.
 *
 * 🔴 ITS OWN FILE, NOT A BLOCK INSIDE THE FORM. `BroadcastFormModal.tsx` is far
 *    past the 400-line cap and its own header says new UI is not to be added to
 *    it; `campaign/flex/` is the role folder `FlexCardPicker` already
 *    established. ฟอร์มแม่เกินเพดานแล้ว ของใหม่แยกไฟล์ตั้งแต่แรก.
 *
 * 🔴 WHY THIS SITS WITH THE PICKER AND NOT WITH THE FORM'S OTHER LABELS. The
 *    refresh button needs the picker's `reload` and its `loading`. Rendering the
 *    button in the form would mean lifting both out of the picker — moving state
 *    into a parent that has no other use for it — so the label comes DOWN to the
 *    picker instead. The form keeps its generic label for text and image, which
 *    are unchanged. ปุ่มต้องอยู่กับคนที่ถือ state ไม่ใช่ยก state ขึ้นไปหาปุ่ม.
 *
 * ⚠️ The markup mirrors the form's own field label (`block text-sm font-medium
 *    text-slate-700 mb-1` + a red asterisk) so the flex branch does not look
 *    like a different form. Change one, look at the other.
 *
 * revert: delete this file, drop `<FlexCardPickerHeader>` from
 * `FlexCardPicker.tsx`, and remove the `type !== 'flex'` condition the form puts
 * around its generic label.
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';

import { useI18n } from '../../../i18n';
/* [FEAT-20260907-FLEXTOOLROW] the shared theme/size for every tool on this row */
import { FlexToolButton } from './FlexToolButton';

export interface FlexCardPickerHeaderProps {
  /** Ask the library again. Always fetches — see `COALESCE_MS`. */
  readonly onRefresh: () => void;
  /** A fetch is running; the button says so and cannot be pressed again. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /**
   * [FEAT-20260907-FLEXTOOLROW] More tools for this row — "จัดการ flex message"
   * and "ดูตัวอย่าง / refresh การ์ด". Owner, 07/09: all three belong together
   * beside the label, at one size.
   *
   * ⚠️ A SLOT, not three props. This header knows nothing about the card
   *    library or the preview modal, and giving it their handlers would drag the
   *    picker into deciding what a permission is. The form owns those and hands
   *    down finished nodes. Order is the caller's: refresh is rendered first,
   *    whatever it passes follows.
   */
  readonly actions?: React.ReactNode;
}

export const FlexCardPickerHeader: React.FC<FlexCardPickerHeaderProps> = ({
  onRefresh,
  busy = false,
  disabled = false,
  actions,
}) => {
  const { t } = useI18n();
  /* [FIX-20260907-REFRESHBESIDELABEL] The button sits BESIDE the label, not at
     the far right. `justify-between` pushed it to the edge of a very wide modal,
     where it read as a control for the whole step rather than as something
     belonging to this one field. Owner asked for it beside the label — keep the
     default `justify-start` if this row is ever touched again. */
  return (
    <div className="mb-1 flex items-center gap-2">
      <label className="block text-sm font-medium text-slate-700">
        {t('broadcast.flex_pick_label')} <span className="text-red-500">*</span>
      </label>
      {/* [FEAT-20260907-FLEXTOOLROW] the shared button — `type="button"`, the
          geometry and the theme all live in `FlexToolButton`, so this row and
          the two buttons the form passes in cannot drift apart. */}
      <FlexToolButton
        testId="flex-card-refresh"
        onClick={onRefresh}
        disabled={disabled || busy}
        label={t('broadcast.flex_pick_refresh')}
        icon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />}
      />
      {actions}
    </div>
  );
};

export default FlexCardPickerHeader;

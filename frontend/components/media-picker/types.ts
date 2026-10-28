// [FEAT-20260905-MEDIAPICKER] TypeScript definitions for central media picker.
import type {
  MediaPickerAlbumItem,
  MediaPickerKindFilter,
  MediaPickerMediaItem,
  MediaPickerPagination,
  MediaPickerSortOrder,
} from '../../services/media/mediaPickerService';

export type {
  MediaPickerAlbumItem,
  MediaPickerKindFilter,
  MediaPickerMediaItem,
  MediaPickerPagination,
  MediaPickerSortOrder,
};

export type MediaPickerView = 'albums' | 'items';

export type MediaPickerGridDensity = '2x2' | '4x2' | '6x2';

/* [FIX-20260905-MPDUPPROPS] `AlbumListViewProps` and `MediaItemListViewProps`
   were declared HERE and again in their own component files, and the barrel
   re-exported both — `tsc` reported the ambiguity (TS2308) on the merged tree,
   so the lane's "0 errors" was measured somewhere this pair does not meet.

   The copies here were the STALE ones: both were missing `onToast?`, which the
   components have and use. Nothing imported them (grepped both repos), and each
   component already owns and exports the version it renders with — so the dead
   pair is removed rather than resynced. One definition per props type.
   revert: paste the two interfaces back and the ambiguity returns. */

export interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Optional callback when user picks/copies an item or selects an item directly.
   * Enables other future consumers to insert media into inputs or forms automatically.
   */
  onSelectMedia?: (media: MediaPickerMediaItem) => void;
  /**
   * Custom title override for the modal header.
   */
  title?: string;
  /**
   * Optional callback when user clicks the Minimize / Dock button to minimize into a side panel.
   */
  onDock?: () => void;
  /**
   * [FEAT-20260907-IMAGEONLYPICKER] Show ONE media kind and hide the kind pills.
   *
   * The broadcast form's image message takes an image URL and nothing else, so a
   * picker that can return a video hands back a value the field cannot use.
   *
   * 🔴 Optional. Absent = the picker behaves exactly as it does today, which is
   *    what keeps `components/flex/FlexMessageFormModal.tsx` — the only existing
   *    caller — untouched. ไม่ส่ง = ของเดิมไม่ขยับ.
   */
  lockKind?: 'image' | 'video';
  /**
   * [FEAT-20260907-USETHISIMAGE] `'use'` turns each tile's primary button into
   * "ใช้ภาพนี้", handing the item straight to `onSelectMedia` instead of copying
   * its link. Absent = `'copy'` = unchanged.
   */
  selectAction?: 'copy' | 'use';
  /**
   * [FIX-20260907-PICKERHEADERRIGHT] Push the header's action buttons hard right,
   * next to the close button.
   *
   * 🔴 THE HEADER IS `flex items-center justify-between` WITH THREE CHILDREN —
   *    title, `actions`, close (`components/common/Modal.tsx:92,228`). Three
   *    children under `justify-between` are spread evenly, so "อัปโหลดเพิ่มเติม"
   *    ends up marooned in the MIDDLE of the bar rather than beside the ✕.
   *
   * ⚠️ This is a layout bug for EVERY caller, including
   *    `components/flex/FlexMessageFormModal.tsx:1755`, which renders this same
   *    modal. The fix is scoped to the broadcast form, so it is opt-in rather
   *    than applied to both — passing this from the flex editor is a one-word
   *    change if that is ever wanted.
   *
   * ⚠️ Absent = unchanged.
   */
  headerActionsRight?: boolean;
}

export interface DockedMediaPickerProps {
  /**
   * Called when user clicks Maximize button to return to full modal view.
   */
  onMaximize: () => void;
  /**
   * Called when user confirms closing the docked panel to restore the Var Guide.
   */
  onClose: () => void;
  /**
   * Optional callback when user selects media.
   */
  onSelectMedia?: (media: MediaPickerMediaItem) => void;
  /**
   * Custom title override for the docked panel header.
   */
  title?: string;
  className?: string;
}

export interface AttachMediaButtonProps {
  /**
   * Optional callback when an item is selected or copied in the opened picker.
   */
  onSelectMedia?: (media: MediaPickerMediaItem) => void;
  /**
   * Custom button label. Default: "Attach VDO / IMG"
   */
  label?: string;
  /**
   * Custom className override.
   */
  className?: string;
  /**
   * Tooltip title.
   */
  tooltip?: string;
  /**
   * [FEAT-20260907-IMAGEONLYPICKER] Forwarded to the modal this button opens.
   * Absent = unchanged.
   */
  lockKind?: 'image' | 'video';
  /**
   * [FEAT-20260907-USETHISIMAGE] Forwarded too. With `'use'`, picking also CLOSES
   * the picker — the value is already in the field, so leaving the modal open
   * would be asking for a second dismissal that achieves nothing.
   */
  selectAction?: 'copy' | 'use';
  /**
   * [FIX-20260907-PICKERHEADERRIGHT] Forwarded to the modal this button opens.
   * Absent = unchanged.
   */
  headerActionsRight?: boolean;
}

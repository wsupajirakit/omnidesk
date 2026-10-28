import React from 'react';

import { AlertModal, ConfirmModal } from '../../modals';
import { StoredImageDetailModal } from '../gallery/StoredImageDetailModal';
import { StoredImageZoom, type ZoomedMedia } from '../gallery/StoredImageZoom';
import type { useGalleryActions } from './useGalleryActions';

/**
 * [REFACTOR-20260904-FORMHOOKS] Every dialog the album form can raise: confirm
 * save, confirm delete, confirm Drive sync, the alert, the caption editor and
 * the full-screen image.
 * ===========================================================================
 * Lifted VERBATIM (§6.3 step 3). They sit together at the end of the form for a
 * reason — each is a leaf that renders only when its own state says so — and
 * moving them as one keeps that reading.
 *
 * 🔴 THE GALLERY HOOK IS PASSED WHOLE. Four of these dialogs are driven by it
 * (the delete confirmation, the caption editor and their state); spreading them
 * into eight separate props would say less, not more.
 *
 * ⚠️ ORDER IS NOT COSMETIC. The zoom overlay is last so it stacks above the
 * caption editor, which is itself above the confirms — they use fixed z-index
 * values that assume this order.
 *
 * revert: paste the body back at the end of `ObjectImageFormModal.tsx` and
 *   delete this file.
 */
export interface ObjectFormDialogsProps {
  showConfirm: boolean;
  setShowConfirm: (open: boolean) => void;
  onConfirmSave: () => void;
  loading: boolean;
  showConfirmSync: boolean;
  setShowConfirmSync: (open: boolean) => void;
  onConfirmSync: () => void;
  alertConfig: {
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  };
  closeAlert: () => void;
  /* [FIX-20260904-ZOOMVIDEO] url + kind together, so the overlay can play a
     stored video instead of drawing it as a broken image. */
  zoomedImage: ZoomedMedia | null;
  setZoomedImage: (media: ZoomedMedia | null) => void;
  gallery: ReturnType<typeof useGalleryActions>;
  resolvedMode: 'create' | 'update' | 'view';
  /** Drive tiles — the sync confirmation names how many will be imported. */
  gDriveImages: { id: string; name: string; url: string | null }[];
  setAlertConfig: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>>;
  inputClass: (hasError?: boolean) => string;
  /* [FEAT-20261022-I18NPAGESEN] widened so a label can carry its Thai fallback — the parent passes useI18n().t */
  t: (key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string;
}

export const ObjectFormDialogs: React.FC<ObjectFormDialogsProps> = ({
  showConfirm,
  setShowConfirm,
  onConfirmSave,
  loading,
  showConfirmSync,
  setShowConfirmSync,
  onConfirmSync,
  alertConfig,
  closeAlert,
  zoomedImage,
  setZoomedImage,
  gallery,
  resolvedMode,
  gDriveImages,
  setAlertConfig,
  inputClass,
  t,
}) => (
  <>
    <ConfirmModal
      isOpen={showConfirm}
      onClose={() => setShowConfirm(false)}
      onConfirm={onConfirmSave}
      title={t('common.confirm')}
      message={resolvedMode === 'create' ? t('common.confirm_create_message') : t('common.confirm_update_message')}
      type="info"
      confirmLabel={t('common.confirm')}
      cancelLabel={t('common.cancel')}
    />

    <ConfirmModal
      isOpen={showConfirmSync}
      onClose={() => setShowConfirmSync(false)}
      onConfirm={onConfirmSync}
      title="Confirm Batch Sync"
      message={t('pageui.object.sync_all_confirm', 'คุณต้องการอัปโหลดรูปทั้งหมดจาก Drive ({n} รูป) ขึ้น Server หรือไม่?', { n: gDriveImages.length })}
      type="warning"
      confirmLabel="YES, SYNC ALL"
      cancelLabel="CANCEL"
    />

    <ConfirmModal
      isOpen={!!gallery.deleteStorageId}
      onClose={() => gallery.setDeleteStorageId(null)}
      onConfirm={gallery.handleDeleteStorageConfirmed}
      title="Confirm Deletion"
      message={t('pageui.object.delete_confirm_msg', 'คุณแน่ใจหรือไม่ว่าต้องการลบรูปภาพนี้จาก Server?\\nการกระทำนี้ไม่สามารถย้อนกลับได้')}
      type="danger"
      confirmLabel="DELETE PERMANENTLY"
    />

    <AlertModal
      isOpen={alertConfig.isOpen}
      onClose={() => setAlertConfig(prev => ({ ...prev, isOpen: false }))}
      title={alertConfig.title}
      message={alertConfig.message}
      type={alertConfig.type}
    />

    {/* Per-image Detail Edit Modal */}
    {gallery.editingImage && (
      <StoredImageDetailModal
        storage={gallery.editingImage}
        form={gallery.editDetailForm}
        onFormChange={gallery.setEditDetailForm}
        saving={gallery.savingDetail}
        onSave={gallery.handleSaveImageDetail}
        onClose={() => gallery.setEditingImage(null)}
        inputClass={inputClass}
        t={t}
      />
    )}

    {zoomedImage && (
      <StoredImageZoom
        url={zoomedImage.url}
        mediaKind={zoomedImage.mediaKind}
        onClose={() => setZoomedImage(null)}
      />
    )}
  </>
);

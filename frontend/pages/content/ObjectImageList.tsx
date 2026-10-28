import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { objectImageService } from '../../services/media';
// [FEAT-20260804-COPYIMGLINK] กฎตรวจลิงก์รูป — เจ้าของเดียว ใช้ร่วมกับโมดัลอัลบั้ม
import { isSafeImageLink } from '../../services/media';
import { imageStorageService } from '../../services/media';
import { ObjectImage, ObjectImageFormData, ObjectCategory, ImageStorage } from '../../types';
import { Plus, Camera, RefreshCw, Search, Trash2, Edit2, ChevronLeft, ChevronRight, Image as ImageIcon, Tag, Info, X, Filter, Eye, Copy, Loader2, Database, Globe, ExternalLink, FolderTree, Maximize2, Pencil, Save, Link2 as LinkIcon } from 'lucide-react';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { ObjectImageFormModal } from '../../components/object';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';
// [FEAT-20260901-OBJSCOPECELL] Access column + row switch, shared with the category list.
import {
  ObjectRowStatusToggle,
  ObjectScopeCell,
  useScopeNames,
} from '../../components/object/scope';
// [REFACTOR-20260904-OBJLISTSPLIT] the row's pieces, lifted verbatim; state stays here
import { ObjectImageFilters } from './object-image-list/ObjectImageFilters';
import { ObjectImageDetailModal } from './object-image-list/ObjectImageDetailModal';
import { ObjectImagePreviewModal } from './object-image-list/ObjectImagePreviewModal';
/* [FEAT-20260907-OBJUPLOADSTEP] the media step's index, named once */
import { OBJ_MEDIA_STEP } from './object-image-list/objectImageList.constants';
import { ObjectImageTable } from './object-image-list/ObjectImageTable';
import { useGDrivePreview } from './object-image-list/useGDrivePreview';
import { useObjectImageAlerts } from './object-image-list/useObjectImageAlerts';
import { useObjectImageList } from './object-image-list/useObjectImageList';
import { ObjectImageZoomOverlay } from './object-image-list/ObjectImageZoomOverlay';
import { ObjectImageThumb } from './object-image-list/ObjectImageThumb';

export const ObjectImageList: React.FC = () => {
  const { t } = useI18n();
  /* [REFACTOR-20260904-OBJLISTSPLIT] The list's data — what is asked of the
     server, what came back and what is shown of it — lives in
     `object-image-list/useObjectImageList.ts`. It is consumed BELOW `showAlert`,
     because the fetch reports a failure through it. */
  // [FEAT-20260901-OBJSCOPECELL] One catalogue load per page, not per row.
  const { groupNames, hookNames } = useScopeNames();
  // [FEAT-20260901-OBJROWSTATUS] Which row's switch is mid-flight.
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ObjectImage | undefined>(undefined);
  const [formMode, setFormMode] = useState<'create' | 'update' | 'view'>('create');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<ObjectImage | null>(null);
  /* [FEAT-20260907-OBJUPLOADSTEP] which step the form opens on. Every other
     entry point sets it back to 0 explicitly, so a previous "upload" click
     cannot leave the next plain Edit opening on the media step. */
  const [formStep, setFormStep] = useState(0);
  
  /* [REFACTOR-20260904-OBJLISTSPLIT] The Drive gallery and our own stored files
     moved OUT as one unit — nine states, two refs and three handlers — into
     `object-image-list/useGDrivePreview.ts`. `gDrivePreviewTotal` did not come
     with them: it was declared, never read, never set. */
  /* [FEAT-20260904-OBJVIDEO] The zoom overlay has to know WHAT it is showing, so
     the state carries the kind beside the url. It was a bare string while only
     images could be stored. */
  const [zoomedPreview, setZoomedPreview] = useState<{
    url: string;
    mediaKind?: 'image' | 'video';
  } | null>(null);

  /* [REFACTOR-20260904-OBJLISTSPLIT] The alert dialog and the two clipboard
     actions that speak through it moved together into
     `object-image-list/useObjectImageAlerts.ts` — every copy outcome is a
     sentence in that dialog, so splitting them would split one conversation. */
  const { alertState, showAlert, closeAlert, copyImageLink, copyTags } =
    useObjectImageAlerts(t);

  const [editingImageStorage, setEditingImageStorage] = useState<ImageStorage | null>(null);
  const [editDetailForm, setEditDetailForm] = useState({ detail_link: '', detail_text: '' });
  const [savingDetail, setSavingDetail] = useState(false);

  const {
    loading,
    setLoading,
    images,
    search,
    setSearch,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    categories,
    selectedCategory,
    setSelectedCategory,
    selectedTag,
    setSelectedTag,
    filteredImages,
    availableTags,
    fetchImages,
  } = useObjectImageList(showAlert, t);

  const {
    serverPreviewImages,
    serverPreviewLoading,
    gDrivePreviewImages,
    gDrivePreviewLoading,
    gDrivePreviewLoadingMore,
    gDrivePreviewLoadingAll,
    gDrivePreviewNextToken,
    fetchGDrivePreview,
    handleLoadMoreGDrivePreview,
    handleLoadAllGDrivePreview,
    cancelLoadAll,
    resetGDrivePreview,
    refreshServerImages,
  } = useGDrivePreview(categories);


  /* [FEAT-20260804-COPYIMGLINK] คัดลอกลิงก์รูปที่เก็บในเครื่อง
   *
   * ⚠️ ตรวจก่อนคัดลอกว่าเป็น "ลิงก์รูปจริง" — ไม่ใช่ path อื่นที่หลุดมา
   *    ต้องอยู่ใต้ /uploads/images/ และนามสกุลเป็นรูปเท่านั้น
   *    (ฝั่ง BE ก็กันไว้อีกชั้นแล้วที่ route เสิร์ฟรูป แต่ตรงนี้กันไม่ให้แอดมิน
   *     คัดลอกลิงก์ที่เปิดไม่ได้ไปแปะที่อื่น แล้วมางงทีหลังว่าทำไมรูปไม่ขึ้น)
   * ⚠️ clipboard พังได้จริง (ไม่ใช่ https / บาง browser) → ต้องบอก ไม่เงียบ */
  const toggleStatus = async (row: ObjectImage, next: boolean) => {
    setStatusPendingId(row.id);
    try {
      await objectImageService.updateImage(row.id, { status: next });
      await fetchImages();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || t('common.save_error'), 'error');
    } finally {
      setStatusPendingId(null);
    }
  };

  const openCreate = () => {
    setEditing(undefined);
    setFormMode('create');
    setFormStep(0);
    setIsFormOpen(true);
  };

  /**
   * [FEAT-20260907-OBJUPLOADSTEP] EVERY way into an album that already exists
   * opens on the MEDIA step.
   *
   * Edit, update and preview all open step 2. The album's
   * files are what people come to this list for; its name and its permissions
   * are a step away, not the landing page. The step chips still work, so nothing
   * is out of reach — only the starting point moved.
   *
   * ⚠️ CREATE is the exception and keeps step 1 (`openCreate` below): a brand new
   *    album has no name yet, and opening the uploader for something that cannot
   *    be saved without a detail is a dead end.
   */
  const openEdit = (image: ObjectImage) => {
    setEditing(image);
    setFormMode('update');
    setFormStep(OBJ_MEDIA_STEP);
    setIsFormOpen(true);
  };

  /**
   * [FEAT-20260907-OBJUPLOADSTEP] The new "upload" action, and what clicking the
   * album's picture now does.
   *
   * both land on the edit form's MEDIA step (index 1 of
   * BASIC / MEDIA / ACCESS) — the album's files are what both are about.
   *
   * ⚠️ It is `openEdit` with a starting step, NOT a second dialog. One place adds
   *    files to an album; two would drift.
   */
  const openUpload = (image: ObjectImage) => {
    setEditing(image);
    setFormMode('update');
    setFormStep(OBJ_MEDIA_STEP);
    setIsFormOpen(true);
  };

  const openView = (image: ObjectImage) => {
    setEditing(image);
    setFormMode('view');
    setFormStep(OBJ_MEDIA_STEP);
    setIsFormOpen(true);
  };

  /* A clone is a NEW album — it lands on step 1 with `openCreate`'s reasoning. */
  const openClone = (image: ObjectImage) => {
    setEditing(image);
    setFormMode('create');
    setFormStep(0);
    setIsFormOpen(true);
  };

  const submitForm = async (data: ObjectImageFormData, silent?: boolean) => {
    try {
      let result: any;
      if (editing && formMode === 'update') {
        result = await objectImageService.updateImage(editing.id, data);
        if (!silent) showAlert(t('status.success'), t('object_image.alert_updated'), 'success');
      } else {
        result = await objectImageService.createImage(data);
        if (!silent) showAlert(t('status.success'), t('object_image.alert_created'), 'success');
        // Update local state to the new object so subsequent calls in the same modal session have an ID
        setEditing(result);
        setFormMode('update'); // Transition to update mode after create
      }
      fetchImages();
      return result?.id || result?._id;
    } catch (e: any) {
      console.error(e);
      if (!silent) showAlert(t('common.error_title'), e.message || t('common.save_error'), 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setLoading(true);
    try {
      await objectImageService.deleteImage(deleteId);
      showAlert(t('status.success'), t('object_image.alert_deleted'), 'success');
      fetchImages();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || t('common.error_message'), 'error');
    } finally {
      setLoading(false);
      setDeleteId(null);
    }
  };


  const [showCopied, setShowCopied] = useState(false);
  const handleCopyTags = async (tags: any) => {
    const tagList = Array.isArray(tags) ? tags : (tags ? [tags] : []);
    const tagStr = tagList.map(t => `[[[${t}]]]`).join(' ');
    // [FIX-20260830-COPYHTTP2] the banner follows the real result
    if (!(await copyText(tagStr))) return;
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleSaveImageDetail = async () => {
    if (!editingImageStorage) return;
    setSavingDetail(true);
    try {
      await imageStorageService.update(editingImageStorage.id, editDetailForm);
      if (previewImage?.id) {
        // Refresh server images in preview — the hook owns that list now.
        await refreshServerImages(previewImage.id);
      }
      showAlert(t('common.success'), t('common.save_success') || 'บันทึกรายละเอียดรูปภาพแล้ว', 'success');
      setEditingImageStorage(null);
    } catch (error) {
      console.error('Failed to save image detail', error);
      showAlert(t('common.error_title'), t('common.save_error') || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSavingDetail(false);
    }
  };

  const inputClass = (hasError: boolean = false) =>
    `w-full bg-slate-50 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none transition-all ${hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-slate-200 focus:ring-primary-500'
    }`;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Actions - Webhook Style */}
      <div className="flex flex-col gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div className="w-full flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('object_image.title')}</h2>
            {/* [UI-20260904-OBJALBUM] Subtitle cut on the owner's call, 04/09. The
                screen is reached from a menu that already says what it is, so the
                line only pushed the search box down. The `object_image.subtitle`
                key stays in every locale file — putting the <p> back is one line,
                and deleting translations to hide a paragraph is not reversible.
                revert: restore <p className="text-sm text-slate-500">{t('object_image.subtitle')}</p> */}
          </div>

          {/* [UI-20260901-OBJXLINK] Jump to the categories screen.
              An album must belong to a category, so "there is no category yet"
              is a dead end reached from here — this is the way out of it.
              NEW TAB on purpose: a half-filled album form on this page would be
              lost to a same-tab navigation. `rel="noopener"` because
              `target="_blank"` otherwise hands the opened page a live
              `window.opener` handle back into this one. */}
          <a
            href="#/object-categories"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="object-images-to-categories"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <FolderTree size={14} aria-hidden />
            {t('object_image.go_to_categories')}
            <ExternalLink size={12} aria-hidden />
          </a>
        </div>
        
        <ObjectImageFilters
          search={search}
          onSearchChange={setSearch}
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectedTag={selectedTag}
          onTagChange={setSelectedTag}
          loading={loading}
          onRefresh={fetchImages}
          onCreate={openCreate}
          t={t}
        />
      </div>

      <ObjectImageTable
        images={filteredImages}
        loading={loading}
        groupNames={groupNames}
        hookNames={hookNames}
        statusPendingId={statusPendingId}
        /* [FEAT-20260907-OBJUPLOADSTEP] clicking the album's picture
           opens the edit form on the media step, the same as the upload action —
           it used to open the read-only album preview dialog.
           🔴 THAT LEAVES `ObjectImagePreviewModal` WITH NO WAY IN. It is still
              mounted below and still correct, but nothing reaches it any more,
              and `fetchGDrivePreview` is now called by nobody. Flagged rather
              than deleted: removing a 319-line dialog and the Drive-preview
              fetch is a call for the owner, not a side effect of a click
              handler. See the note by the modal itself. */
        onPreview={openUpload}
        onCopyTags={copyTags}
        onToggleStatus={toggleStatus}
        onUpload={openUpload}
        onView={openView}
        onEdit={openEdit}
        onDelete={setDeleteId}
        totalItems={totalItems}
        currentPage={currentPage}
        totalPages={totalPages}
        onPrevPage={() => setCurrentPage(p => Math.max(1, p - 1))}
        onNextPage={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        t={t}
      />

      <ObjectImageFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={submitForm}
        initialData={editing}
        mode={formMode}
        initialStep={formStep}
        availableTags={availableTags}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t('object_image.delete_title')}
        message={t('object_image.delete_message')}
        type="danger"
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {previewImage && (
        <ObjectImagePreviewModal
          album={previewImage}
          serverFiles={serverPreviewImages}
          loadingServerFiles={serverPreviewLoading}
          driveFiles={gDrivePreviewImages}
          loadingDrive={gDrivePreviewLoading}
          loadingMore={gDrivePreviewLoadingMore}
          loadingAll={gDrivePreviewLoadingAll}
          hasMoreDrive={gDrivePreviewNextToken}
          onLoadMore={handleLoadMoreGDrivePreview}
          onLoadAll={handleLoadAllGDrivePreview}
          onCancelLoadAll={cancelLoadAll}
          copied={showCopied}
          onCopyTags={handleCopyTags}
          onZoom={(url, mediaKind) => setZoomedPreview({ url, mediaKind })}
          onEditStorage={(storage) => {
            setEditingImageStorage(storage);
            setEditDetailForm({
              detail_link: storage.detail_link || '',
              detail_text: storage.detail_text || '',
            });
          }}
          onClose={() => {
            setPreviewImage(null);
            resetGDrivePreview();
          }}
          t={t}
        />
      )}

      {editingImageStorage && (
        <ObjectImageDetailModal
          storage={editingImageStorage}
          form={editDetailForm}
          onFormChange={setEditDetailForm}
          saving={savingDetail}
          onSave={handleSaveImageDetail}
          onClose={() => setEditingImageStorage(null)}
          inputClass={inputClass}
          t={t}
        />
      )}

      {zoomedPreview && (
        <ObjectImageZoomOverlay
          url={zoomedPreview.url}
          mediaKind={zoomedPreview.mediaKind}
          onClose={() => setZoomedPreview(null)}
        />
      )}
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, AlertCircle, ChevronDown, Check, Copy, Maximize2, Pencil, Tag, Link2 as LinkIcon } from 'lucide-react';
import { useI18n } from '../../i18n';
import { objectCategoryService } from '../../services/media';
import { groupService } from '../../services/admin';
import { imageStorageService } from '../../services/media';
import { isUploadAbort } from '../../services/uploadWithProgress';
// [FEAT-20260804-COPYIMGLINK] กฎตรวจลิงก์รูป — เจ้าของเดียว ใช้ร่วมกับหน้ารายการ
import { isSafeImageLink } from '../../services/media';
import { ConfirmModal } from '../modals';
import { AlertModal } from '../modals';
import { Upload, Trash2, Globe, Database, ExternalLink, ImageIcon } from 'lucide-react';
import { ObjectImage, ObjectImageFormData, ObjectCategory, GroupEntry, ImageStorage } from '../../types';
import { ScrollIndicator } from '../common';
/* [REFACTOR-20260904-OBJFORMSPLIT] see the note where these used to be declared */
import {
  SHOW_RESPONSE_TYPE,
  SHOW_LIMIT_LABELS,
  STEP_BASIC,
  STEP_MEDIA,
  STEP_ACCESS,
  stepDefsFor,
  DEFAULT_FORM,
} from './form/objectImageForm.constants';
import { storageOptionsFor } from './form/storageOptions';
/* [FIX-20260904-GDRIVEINLINECOMP] was declared inside this component's body —
   see the file's header for why that remounted every thumbnail. */
import { GDriveImage } from './gdrive/GDriveImage';
import { ObjectFormAccessStep } from './form/ObjectFormAccessStep';
import { ObjectFormBasicStep } from './form/ObjectFormBasicStep';
import { ObjectFormMediaSource } from './form/ObjectFormMediaSource';
import { GalleryHeader } from './gallery/GalleryHeader';
import { StoredMediaThumb } from './gallery/StoredMediaThumb';
import type { ZoomedMedia } from './gallery/StoredImageZoom';
import {
  UploadProgressPanel,
  type UploadPhase,
} from './gallery/UploadProgressPanel';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT,
  pickUploadKind,
} from './gallery/uploadKind';
import { MediaKindBadge } from './gallery/MediaKindBadge';
import { UploaderCaption } from './gallery/UploaderCaption';
import { buildDriveListUrl, driveThumbnailAt800 } from '../../utils/driveListUrl';
import { useDrivePicker } from './form/useDrivePicker';
import { useDropdownDismiss } from './form/useDropdownDismiss';
import { ObjectFormDialogs } from './form/ObjectFormDialogs';
import { ObjectFormMediaStep } from './form/ObjectFormMediaStep';
import { useFormWizard } from './form/useFormWizard';
import { useGalleryActions } from './form/useGalleryActions';
import { StoredImageDetailModal } from './gallery/StoredImageDetailModal';
import { StoredImageZoom } from './gallery/StoredImageZoom';
import { useServerGallery } from './gallery/useServerGallery';
import { copyText } from '../../utils/copyText';
// [FEAT-20260901-OBJSCOPE] Shared with ObjectCategoryFormModal — one implementation.
import {
  ObjectFormTabs,
  ObjectStepNav,
  ObjectScopePicker,
  ObjectStatusToggle,
  firstInvalidStep,
  focusFirstError,
  toIds,
  useObjectScopeOptions,
} from './scope';

/**
 * [UI-20260901-OBJWIZARD] Which field belongs to which step.
 *
 * The wizard hides the steps you are not on, so an error on step 1 is invisible
 * from step 3. This table is what puts the red badge on the right chip and what
 * sends a failed save back to the first bad step.
 *
 * Every key `validate()` can set must be claimed by exactly one step: adding a
 * validation without adding its key here means an error nobody can find.
 */
/* [REFACTOR-20260904-OBJFORMSPLIT] The display switches, the step table, the
   storage picker and DEFAULT_FORM moved to `./form/` — this file was 1,702
   lines, 4.2x the 400 cap and on the eslint waiver list (which may only
   shrink, §6.1). Values and comments went across verbatim; nothing here
   changed behaviour. revert: paste them back and drop the two imports. */
interface ObjectImageFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ObjectImageFormData, silent?: boolean) => Promise<string | void>;
  initialData?: ObjectImage;
  mode?: 'create' | 'update' | 'view';
  availableTags?: string[];
  /**
   * [FEAT-20260907-OBJUPLOADSTEP] Which step to OPEN on, 0-based
   * (0 = basic, 1 = media, 2 = access).
   *
   * The album list's "upload" action and its thumbnail both land on the media
   * step, because both are about the album's files. Absent = 0, so every
   * existing caller opens exactly where it always did.
   */
  initialStep?: number;
}

/**
 * [REFACTOR-20260904-FORMHOOKS] WHERE THIS FILE STANDS — read before splitting.
 * ===========================================================================
 * 1,712 → 539 lines over 04/09. What left, and why:
 *
 *   form/useDrivePicker.ts       the Drive gallery, its paging, its two imports
 *   form/useGalleryActions.ts    the gallery's write side and its shared state
 *   form/useFormWizard.ts        step, errors, validation, save
 *   form/useDropdownDismiss.ts   the outside-click listener
 *   form/ObjectFormBasicStep     · MediaSource · MediaStep · AccessStep · Dialogs
 *
 * 🔴 WHAT IS LEFT IS NOT A LEFTOVER — IT IS THE WIRING, AND IT MEASURED WRONG
 * TO MOVE. Two candidates were evaluated and REJECTED on numbers, not on taste:
 *
 *   · the hydrate effect (63 lines) calls setters belonging to FIVE different
 *     hooks; extracting it means passing thirteen setters back in
 *   · the form shell + step array (129 lines) reads THIRTY-THREE names declared
 *     here; as a component that is a 33-argument call nobody can make correctly
 *
 * In both cases the extraction relocates the coupling instead of removing it.
 * The file stays on the eslint waiver list at 539 for that reason, and that is
 * a decision with a number behind it — not an unfinished job.
 *
 * ⚠️ If it must come off the list, the honest route is the one thing that has
 * NOT been tried: making the wizard shell generic enough that the step array is
 * data rather than JSX. That is a redesign with its own tests, not a lift.
 */
export const ObjectImageFormModal: React.FC<ObjectImageFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  mode,
  availableTags,
  initialStep,
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<ObjectImageFormData>(DEFAULT_FORM);
  // [UI-20260901-OBJWIZARD] Which step is showing, and the review-all escape.
  const [categories, setCategories] = useState<ObjectCategory[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [fetchingOptions, setFetchingOptions] = useState(false);

  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const categoryRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  /* [REFACTOR-20260904-FORMHOOKS] The Drive picker — its nine states, its ref
     and its five members — lives in `form/useDrivePicker.ts`. It is wired below
     `showAlert`, because the picker reports failures through it. */
  const [showConfirm, setShowConfirm] = useState(false);
  const [isHovered, setIsHovered] = useState<string | null>(null);

  // Server-side Image Storage (Local Gallery)
  /* [REFACTOR-20260904-OBJFORMSPLIT] The stored-file list and its loader live in
     `gallery/useServerGallery.ts`. They moved because SIX handlers outside the
     gallery block reload that list; the three gallery handlers stayed, because
     each of them reaches the FORM's state, not the gallery's. */
  const { serverImages, serverImagesLoading, fetchServerImages, clearServerImages } =
    useServerGallery();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Custom Modal States
  /* [FIX-20260904-ZOOMVIDEO] Carries the KIND alongside the url. It was a bare
     `string | null`, so the overlay had no way to know a stored .mp4 was a video
     and drew it as a broken <img>. */
  const [zoomedImage, setZoomedImage] = useState<ZoomedMedia | null>(null);
  const [alertConfig, setAlertConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setAlertConfig({ isOpen: true, title, message, type });
  };

  /* ⚠️ These two are computed from props and MUST stay above the hooks: the
     wizard hook takes `STEP_DEFS` as an argument, and tsc enforces the order
     rather than a comment doing it. */
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');

  const STEP_DEFS = stepDefsFor(resolvedMode);

  /* [REFACTOR-20260904-FORMHOOKS] The wizard: which step is open, what is wrong
     with it, and what Save does. `errors` is written by `validate` and read by
     four other members, which is why they moved as one. */
  const {
    activeStep,
    setActiveStep,
    showAllSteps,
    setShowAllSteps,
    errors,
    setErrors,
    loading,
    setLoading,
    goNext,
    validate,
    scopeError,
    handleChange,
    toggleSelection,
    handleSubmit,
    handleConfirmSave,
  } = useFormWizard({
    formData,
    setFormData,
    categories,
    STEP_DEFS,
    scrollRef,
    setShowConfirm,
    showAlert,
    t,
    onSubmit,
    onClose,
    initialStep,
  });

  /* [REFACTOR-20260904-FORMHOOKS] The gallery's write side — six handlers and
     the ten pieces of state they share. Declared BEFORE the Drive picker
     because that one reports its own progress through `setIsUploadingLocal`,
     which this hook owns. */
  const gallery = useGalleryActions({
    formData,
    categories,
    serverImages,
    fetchServerImages,
    showAlert,
    t,
    initialData,
    onSubmit,
  });
  const {
    isUploadingLocal,
    setIsUploadingLocal,
    uploadState,
    draggedItemIndex,
    setDraggedItemIndex,
    isDragging,
    setIsDragging,
    deleteStorageId,
    setDeleteStorageId,
    editingImage,
    setEditingImage,
    editDetailForm,
    setEditDetailForm,
    savingDetail,
    handleLocalFileUpload,
    handleImportUrlToServer,
    handleReorderStoredFile,
    handleDeleteStorage,
    handleDeleteStorageConfirmed,
    handleSaveImageDetail,
  } = gallery;

  const drive = useDrivePicker({
    formData,
    categories,
    fetchServerImages,
    setIsUploadingLocal,
    showAlert,
    t,
    initialData,
    onSubmit,
  });
  const {
    gDriveImages,
    setGDriveImages,
    gDriveLoading,
    gDriveLoadingMore,
    gDriveLoadingAll,
    gDriveNextToken,
    gDriveCancelRef,
    uploadingId,
    syncCount,
    showConfirmSync,
    setShowConfirmSync,
    handleUploadGDriveToServer,
    handleLoadMoreGDrive,
    handleLoadAllGDrive,
    handleSyncDriveConfirmed,
  } = drive;

  /* [FEAT-20260804-COPYIMGLINK] คัดลอกลิงก์ "รายภาพ" ในอัลบั้ม
   * 📌 ย้ายมาจากหน้ารายการ เพราะ 1 อัลบั้มมีหลายภาพ
   *    ปุ่มที่หน้ารายการคัดลอกได้แค่ภาพแรก ภาพที่เหลือไม่มีทางคัดลอกได้เลย
   * ⚠️ ใช้กฎตรวจตัวเดียวกับหน้ารายการ (imageLinkUtils) — ห้ามเขียนกฎซ้ำ
   * ⚠️ clipboard พังได้จริง (บาง browser / ไม่ใช่ https) → ต้องบอก ไม่เงียบ */
  const copyImageLink = async (url: string) => {
    if (!isSafeImageLink(url)) {
      showAlert(t('common.error_title'), t('object_image.copy_link_invalid'), 'error');
      return;
    }
    // [FIX-20260830-COPYHTTP2] see utils/copyText — the raw API throws on http,
    // so this always took the error branch and the link could never be copied
    if (await copyText(url)) {
      showAlert(t('status.success'), t('object_image.copy_link_ok') + '\n' + url, 'success');
    } else {
      showAlert(t('common.error_title'), t('common.copy_failed_message'), 'error');
    }
  };

  const getPreviewUrl = (url: string) => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
      // More robust ID extraction
      const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) {
        const previewUrl = `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
        console.log('Generated Drive Preview URL:', previewUrl);
        return previewUrl;
      }
    }
    return url;
  };

  // [UI-20260901-OBJWIZARD] Creating has no gallery, so it has no media step.

  /* [FEAT-20260901-OBJSCOPE] Named `scope*` to stay clear of the `groups` state
     above, which feeds the older category/group dropdowns in this same form. */
  const {
    groups: scopeGroups,
    groupsLoading: scopeGroupsLoading,
    hooks: scopeHooks,
    hooksLoading: scopeHooksLoading,
  } = useObjectScopeOptions(isOpen, formData.group_providers || []);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    /* [UI-20260901-OBJWIZARD] Reopening lands on a step the CALLER chooses, and
       never on wherever the last visit happened to end — keeping the last step
       would open the form on "Access" for someone who came to change a picture.
       🔴 [FEAT-20260907-OBJUPLOADSTEP] THIS LINE IS WHY `initialStep` LOOKED
          IGNORED. It was a flat `setActiveStep(0)`, and it runs on every open,
          so seeding the `useState` in `useFormWizard` could never survive: the
          modal stays mounted for the life of the page, so that initialiser runs
          once and this effect overwrote it on every open after the first.
          The step now comes from the prop, clamped, in the one place that
          actually decides it. ค่าเริ่มต้นต้องมาตรงนี้ ไม่ใช่ที่ useState. */
    setActiveStep(Math.min(Math.max(0, initialStep ?? 0), STEP_DEFS.length - 1));
    setShowAllSteps(false);
    setIsCategoryDropdownOpen(false);
    setIsGroupDropdownOpen(false);

    if (initialData) {
      setFormData({
        detail: initialData.detail || '',
        matching_tag: Array.isArray(initialData.matching_tag) ? initialData.matching_tag : (initialData.matching_tag ? [initialData.matching_tag] : []),
        response_type: initialData.response_type || 'media',
        img_path: initialData.img_path,
        storage: (initialData.storage as any) || 'external',
        categories: (initialData.categories || []).map((c: any) => c.id || c._id || c),
        group_providers: toIds(initialData.group_providers),
        // [FEAT-20260901-OBJSCOPE] absent status counts as ON, like the backend.
        hook_ids: toIds(initialData.hook_ids),
        status: initialData.status !== false
      });
      fetchServerImages(initialData.id);
    } else {
      setFormData(DEFAULT_FORM);
      clearServerImages();
      setGDriveImages([]);
    }
    const fetchOptions = async () => {
      setFetchingOptions(true);
      try {
        const [catRes, groupRes] = await Promise.all([
          objectCategoryService.listCategories({ limit: 100 }),
          groupService.listGroups({ status: true, limit: 100 })
        ]);
        setCategories(Array.isArray(catRes) ? catRes : (catRes as any).data || []);
        const groupData = groupRes.data || (Array.isArray(groupRes) ? groupRes : []);
        setGroups(groupData);

        /* [FEAT-20260901-OBJSCOPE] The auto-select-all block that stood here is
           gone, and removing it is the point of this change rather than a tidy-up.
           It ran AFTER the hydrate above and overwrote whatever the album had
           stored, so opening an album scoped to one group and pressing save
           silently rewrote it to every group. With the field hidden, nobody could
           see it happen. An empty scope now means unrestricted, which is the same
           behaviour that ticking every group produced — without destroying the
           narrower scopes that already exist.
           revert: re-add the setFormData that maps groupData to group_providers. */
      } catch (error) {
        console.error('Failed to fetch options', error);
      } finally {
        setFetchingOptions(false);
      }
    };

    fetchOptions();
  }, [isOpen, initialData, initialStep]);

  /* [REFACTOR-20260904-FORMHOOKS] Dismissing the two dropdowns is its own leaf. */
  useDropdownDismiss(categoryRef, groupRef, setIsCategoryDropdownOpen, setIsGroupDropdownOpen);

  const inputClass = (hasError: boolean = false) =>
    `w-full bg-slate-50 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none transition-all ${hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-slate-200 focus:ring-primary-500'
    }`;

  const selectedCategories = useMemo(() => {
    return formData.categories
      .map(id => categories.find(c => c.id === id || (c as any)._id === id))
      .filter((c): c is ObjectCategory => !!c);
  }, [formData.categories, categories]);

  const selectedGroups = useMemo(() => {
    return formData.group_providers
      .map(id => groups.find(g => g.id === id || (g as any)._id === id))
      .filter((g): g is GroupEntry => !!g);
  }, [formData.group_providers, groups]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 w-screen h-screen bg-white/45 backdrop-blur overflow-y-auto !m-0">
        {/* [UI-20260901-OBJWIZARD] One height for every mode: 90vh.
            Create was pinned to 58vh, which left the form scrolling inside a
            box that occupied barely half the screen while the rest of the page
            sat empty. That was tolerable for a short form and is not once the
            body carries a step rail plus a ~130-row scope grid.
            revert: restore the create/update ternary on h-/max-h-. */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-6xl my-auto mx-auto flex flex-col overflow-hidden transition-all duration-300 h-[90vh] max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 relative">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 rounded-t-xl shrink-0 bg-white">
              <h3 className="text-xl font-semibold text-slate-900">
                {resolvedMode === 'create'
                  ? t('object_image.form_create_title')
                  : resolvedMode === 'view'
                    ? t('object_image.form_view_title')
                    : t('object_image.form_update_title')}
              </h3>

              <div className="flex items-center gap-2">
                {/* [UI-20260901-OBJWIZARD] Walk buttons before save, both
                    type="button": they sit inside the <form> and an untyped
                    button submits it. */}
                {resolvedMode !== 'view' && (
                  <ObjectStepNav
                    activeIndex={activeStep}
                    stepCount={STEP_DEFS.length}
                    showAll={showAllSteps}
                    onBack={() => setActiveStep((i) => Math.max(0, i - 1))}
                    onNext={goNext}
                  />
                )}
                {resolvedMode !== 'view' && (
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={18} />}
                    {t('common.save')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
            <ObjectFormTabs
              activeIndex={activeStep}
              showAll={showAllSteps}
              errors={errors}
              onPick={setActiveStep}
              onToggleShowAll={() => setShowAllSteps((v) => !v)}
              /* [UI-20260901-OBJWIZARD] Filtered through the per-mode list, so
                 the media step disappears entirely while creating rather than
                 rendering as a blank page 2. */
              steps={[
                {
                  id: STEP_BASIC.id,
                  fields: STEP_BASIC.fields,
                  label: t('object_form.tab_basic'),
                  content: (
              <ObjectFormBasicStep
                formData={formData}
                onFormChange={setFormData}
                errors={errors}
                resolvedMode={resolvedMode}
                categories={categories}
                selectedCategories={selectedCategories}
                fetchingOptions={fetchingOptions}
                isCategoryDropdownOpen={isCategoryDropdownOpen}
                onCategoryDropdownToggle={setIsCategoryDropdownOpen}
                categoryRef={categoryRef}
                serverImages={serverImages}
                handleChange={handleChange}
                inputClass={inputClass}
                showAlert={showAlert}
                t={t}
              />
              ),
            },
            {
              id: STEP_MEDIA.id,
              fields: STEP_MEDIA.fields,
              label: t('object_form.tab_media'),
              content: (
                <ObjectFormMediaStep
                  formData={formData}
                  resolvedMode={resolvedMode}
                  initialData={initialData}
                  serverImages={serverImages}
                  serverImagesLoading={serverImagesLoading}
                  errors={errors}
                  handleChange={handleChange}
                  loading={loading}
                  gallery={gallery}
                  drive={drive}
                  inputClass={inputClass}
                  getPreviewUrl={getPreviewUrl}
                  copyImageLink={copyImageLink}
                  setZoomedImage={setZoomedImage}
                  t={t}
                />
              ),
            },
            {
              /* [FEAT-20260901-OBJSCOPE] Who may use this album, and whether the
                 bot may serve it. Its own step: the scope is the reason this
                 form outgrew one screen, and burying it under the gallery is
                 how the old hidden input went unnoticed for so long. */
              id: STEP_ACCESS.id,
              fields: STEP_ACCESS.fields,
              label: t('object_form.tab_access'),
              content: (
                <ObjectFormAccessStep
                  formData={formData}
                  onFormChange={setFormData}
                  errors={errors}
                  resolvedMode={resolvedMode}
                  scopeGroups={scopeGroups}
                  scopeHooks={scopeHooks}
                  scopeGroupsLoading={scopeGroupsLoading}
                  scopeHooksLoading={scopeHooksLoading}
                  t={t}
                />
              ),
            },
              ].filter((step) => STEP_DEFS.some((d) => d.id === step.id))}
            />
            </div>
            <ScrollIndicator containerRef={scrollRef} />
          </form>
        </div>
      </div>

      <ObjectFormDialogs
        showConfirm={showConfirm}
        setShowConfirm={setShowConfirm}
        onConfirmSave={handleConfirmSave}
        loading={loading}
        showConfirmSync={showConfirmSync}
        setShowConfirmSync={setShowConfirmSync}
        onConfirmSync={handleSyncDriveConfirmed}
        alertConfig={alertConfig}
        /* The original closed the alert with this exact inline setter; there
           was never a named `closeAlert` in this modal — I invented one while
           writing the props and tsc caught it. */
        closeAlert={() => setAlertConfig(prev => ({ ...prev, isOpen: false }))}
        zoomedImage={zoomedImage}
        setZoomedImage={setZoomedImage}
        gallery={gallery}
        resolvedMode={resolvedMode}
        gDriveImages={gDriveImages}
        setAlertConfig={setAlertConfig}
        inputClass={inputClass}
        t={t}
      />
    </>
  );
};

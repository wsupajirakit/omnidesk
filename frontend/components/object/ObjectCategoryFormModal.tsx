import React, { useEffect, useState } from 'react';
import { Save, Loader2, AlertCircle, Info, ExternalLink, X, Maximize2, Play } from 'lucide-react';
import { ObjectCategory, ObjectCategoryFormData } from '../../types';
import { useI18n } from '../../i18n';
import { ConfirmModal } from '../modals';
import { ScrollIndicator } from '../common';
import { ObjectCategoryHelpModal } from './ObjectCategoryHelpModal';
// [FEAT-20260901-OBJSCOPE] Scope + switch live in their own files, not inline here.
import {
  ObjectAccessStep,
  ObjectFormTabs,
  ObjectStepNav,
  firstInvalidStep,
  focusFirstError,
  toIds,
  useObjectScopeOptions,
  type ObjectFormStep,
} from './scope';

interface ObjectCategoryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ObjectCategoryFormData) => Promise<void>;
  initialData?: ObjectCategory;
  mode?: 'create' | 'update' | 'view';
}

/**
 * [UI-20260901-OBJWIZARD] Which field belongs to which step.
 *
 * Written here, not derived from the JSX, for the reason broadcast's own step
 * table records: the wizard hides the steps you are not on, so an error on
 * step 1 is invisible from step 2. This table is what makes the red badge land
 * on the right chip and what sends a failed save back to the first bad step.
 *
 * Every key `validate()` can set must be claimed by exactly one step. Adding a
 * validation without adding its key here means an error nobody can find.
 */
/**
 * [UI-20260901-HIDEGDRIVE] Show the Google Drive API key field?
 *
 * `false` hides its label, its input and the "how to create one" button — the
 * whole block, so nothing is left pointing at a control that is not there.
 *
 * ONLY THE UI IS GONE. `api_key` is still in the form state, still sent, still
 * validated by the DTO, still stored, and still what an external caller uses to
 * select a category (`object-category.schema.ts` documents it as exactly that).
 * Categories that already hold a key keep it: this modal sends what its form
 * loaded, and the form still loads the stored value.
 *
 * Flip to `true` to bring it back. Nothing else needs changing.
 */
const SHOW_GDRIVE_API_KEY = false;

const STEP_DEFS: ReadonlyArray<{ id: string; fields: readonly string[] }> = [
  { id: 'basic', fields: ['name', 'api_key'] },
  // [FIX-20260901-SCOPEREQUIRED] `scope` is this step's error key.
  { id: 'access', fields: ['scope'] },
];

const DEFAULT_FORM: ObjectCategoryFormData = {
  name: '',
  api_key: '',
  /* [FEAT-20260901-OBJSCOPE] A new category starts unrestricted and ON. Empty
     arrays are not "nobody" — the backend reads absent/[] as every group and
     every OA, which is what keeps a category usable the moment it is made. */
  group_providers: [],
  hook_ids: [],
  status: true
};

export const ObjectCategoryFormModal: React.FC<ObjectCategoryFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  mode
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<ObjectCategoryFormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [helpSource, setHelpSource] = useState<'icon' | 'input'>('icon');
  const [isZoomed, setIsZoomed] = useState(false);
  // [UI-20260901-OBJWIZARD] Which step is showing, and the review-all escape.
  const [activeStep, setActiveStep] = useState(0);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const helpScrollRef = React.useRef<HTMLDivElement>(null);
  // [FIX-20260901-STEPFOCUS] The scrolling body — what an error is scrolled into.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');

  /* [FEAT-20260901-OBJSCOPE] Options only; the picks stay in `formData` here,
     so this modal remains the single owner of its form state (rule F2). */
  const { groups, groupsLoading, hooks, hooksLoading } = useObjectScopeOptions(
    isOpen,
    formData.group_providers || []
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    /* [UI-20260901-OBJWIZARD] Reopening always lands on step 1. Keeping the
       last one would open the form on "Access" for someone who came to rename
       a category. */
    setActiveStep(0);
    setShowAllSteps(false);
    if (initialData) {
      setFormData({
        name: initialData.name,
        api_key: initialData.api_key || '',
        /* [FEAT-20260901-OBJSCOPE] BE may send either bare ids or populated
           objects depending on the endpoint, so normalise to ids here — the
           picker ticks by id and would silently match nothing otherwise. */
        group_providers: toIds(initialData.group_providers),
        hook_ids: toIds(initialData.hook_ids),
        // Absent counts as ON, matching the backend's `$ne: false`.
        status: initialData.status !== false
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
  }, [isOpen, initialData]);

  /**
   * [UI-20260901-OBJWIZARD] The gate. Owner, 01/09: you must clear a step
   * before the next one opens.
   *
   * Only the CURRENT step's fields are checked, never the whole form: blocking
   * step 1 because step 2 is incomplete would make the wizard impossible to
   * walk. Failing paints the field and turns its chip red rather than silently
   * refusing, so the reason is on screen.
   *
   * The rail stays freely clickable — see `ObjectStepRail`. The gate is on this
   * button, which is the path someone filling the form in order actually takes.
   */
  const goNext = () => {
    const step = STEP_DEFS[activeStep];
    const nextErrors: Record<string, string> = {};
    if (step?.fields.includes('name') && !formData.name.trim()) {
      nextErrors.name = t('object_category.form_name_required');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(bodyRef.current);
      return;
    }
    setActiveStep((i) => Math.min(STEP_DEFS.length - 1, i + 1));
  };

  /**
   * [FIX-20260901-SCOPEREQUIRED] Owner, 01/09: both pickers must be filled.
   *
   * One message for the pair rather than one each: they are ticked together and
   * two reds under two grids reads as two separate problems when it is one.
   */
  const scopeError = (): string | undefined =>
    (formData.group_providers?.length ?? 0) === 0 ||
    (formData.hook_ids?.length ?? 0) === 0
      ? t('object_scope.required')
      : undefined;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      nextErrors.name = t('object_category.form_name_required');
    }
    const scope = scopeError();
    if (scope) nextErrors.scope = scope;
    setErrors(nextErrors);
    /* [UI-20260901-OBJWIZARD] Jump to the FIRST step that failed. Every field
       lives on a step now, so an error raised while another step is showing
       would otherwise be invisible and the save would look like it did
       nothing at all. */
    const bad = firstInvalidStep(STEP_DEFS, nextErrors);
    if (bad >= 0) {
      setActiveStep(bad);
      setShowAllSteps(false);
      // Switching step is not enough — the field can be below the fold too.
      focusFirstError(bodyRef.current);
    }
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    setLoading(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Failed to submit category', error);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    }`;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 w-screen h-screen bg-white/45 backdrop-blur overflow-y-auto !m-0">
        {/* [UI-20260901-OBJWIZARD] One width for every mode.
            Create used to be pinned at 459px, which was fine for two inputs but
            not once the header carries back/next/save and the body carries a
            step rail with chips: the title wrapped to three lines and the
            buttons stacked their own labels. Both modes now share the wider box
            and the step grids get a row that fits.
            revert: restore the create/update ternary on max-w. */}
        {/* [UI-20260901-OBJWIZARD] Bounded height + a scrolling body.
            Without the cap, "show all steps" stacks every step's height and the
            modal grows past the viewport — the grid's own scroll box never
            engages because nothing above it constrains the column. `min-h-0` is
            the load-bearing half: a flex child refuses to shrink below its
            content without it, so the overflow lands on the page instead. */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-[860px] max-h-[90vh] my-8 flex flex-col overflow-hidden transition-all duration-300">
          {/* [UI-20260901-CATARROWS] `relative` is load-bearing: ScrollIndicator
              positions its arrows `absolute`, so without a positioned ancestor
              they anchor to the viewport instead of the modal. The album modal
              already carried it, which is why only this form lacked arrows. */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col min-h-0 flex-1 relative"
          >
            <div className="flex justify-between items-center p-5 border-b border-slate-100 rounded-t-xl shrink-0 bg-white">
              <h3 className="text-xl font-semibold text-slate-900">
                {resolvedMode === 'create' 
                  ? t('object_category.form_create_title') 
                  : resolvedMode === 'view' 
                    ? t('object_category.form_view_title') 
                    : t('object_category.form_update_title')}
              </h3>
              
              <div className="flex items-center gap-2">
              {/* [UI-20260901-OBJWIZARD] Back/next sit BEFORE save, so the eye
                  reaches them first while walking the form and lands on save
                  only at the end. Both are type="button": they live inside the
                  <form>, and an untyped button submits it. */}
              {resolvedMode !== 'view' && (
                <ObjectStepNav
                  activeIndex={activeStep}
                  stepCount={STEP_DEFS.length}
                  showAll={showAllSteps}
                  canGoNext={!!formData.name.trim()}
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

            {/* [UI-20260901-OBJWIZARD] This is the element that scrolls. The
                header stays put; only the steps move. */}
            <div
              ref={bodyRef}
              className="p-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar"
            >
             <ObjectFormTabs
               activeIndex={activeStep}
               showAll={showAllSteps}
               errors={errors}
               onPick={setActiveStep}
               onToggleShowAll={() => setShowAllSteps((v) => !v)}
               steps={[
                {
                  id: STEP_DEFS[0].id,
                  fields: STEP_DEFS[0].fields,
                  label: t('object_form.tab_basic'),
                  content: (
                   <>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  {t('object_category.form_name_label')} <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={inputClass(!!errors.name)}
                  placeholder={t('object_category.form_name_placeholder')}
                  autoFocus={resolvedMode !== 'view'}
                  disabled={resolvedMode === 'view'}
                />
                {errors.name && (
                  <div className="flex items-center gap-1 mt-1 text-red-500 text-xs">
                    <AlertCircle size={12} />
                    <span>{errors.name}</span>
                  </div>
                )}
              </div>

              {/* [UI-20260901-HIDEGDRIVE] Label, input and help button together —
                  hiding the field but leaving its button would point at nothing. */}
              {SHOW_GDRIVE_API_KEY && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-500">
                    {t('object_category.form_api_key_label')}
                  </label>
                  <button 
                    type="button"
                    onClick={() => {
                      setHelpSource('icon');
                      setIsHelpOpen(true);
                    }}
                    className="text-primary-500 hover:text-primary-600 transition-all hover:scale-125"
                  >
                    <Info size={24} strokeWidth={2.5} />
                  </button>
                </div>
                <input
                  name="api_key"
                  value={formData.api_key}
                  onChange={handleChange}
                  className={inputClass(false)}
                  placeholder={t('object_category.form_api_key_placeholder')}
                  disabled={resolvedMode === 'view'}
                />
                
                {resolvedMode !== 'view' && (
                  <button
                    type="button"
                    onClick={() => {
                      setHelpSource('icon');
                      setIsHelpOpen(true);
                    }}
                    className="mt-4 w-full py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-xl border border-primary-200 text-xs font-black shadow-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 group/ht"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse"></div>
                    {t('pageui.object.how_drive_key', 'วิธีสร้าง Google Drive API Key?')}
                    <Play size={12} fill="currentColor" className="ml-1 opacity-0 group-hover/ht:opacity-100 transition-opacity" />
                  </button>
                )}
              </div>
              )}

                   </>
                  ),
                },
                {
                  /* [FEAT-20260901-OBJSCOPE] Who may use this category, and
                     whether it is live. Both controls are their own files —
                     this modal gains fields, not logic. */
                  id: STEP_DEFS[1].id,
                  fields: STEP_DEFS[1].fields,
                  label: t('object_form.tab_access'),
                  content: (
              <ObjectAccessStep
                groupIds={formData.group_providers || []}
                hookIds={formData.hook_ids || []}
                status={formData.status}
                onScopeChange={(next) =>
                  setFormData((prev) => ({ ...prev, ...next }))
                }
                onStatusChange={(next) =>
                  setFormData((prev) => ({ ...prev, status: next }))
                }
                groups={groups}
                hooks={hooks}
                groupsLoading={groupsLoading}
                hooksLoading={hooksLoading}
                disabled={resolvedMode === 'view'}
                testId="object-category-status"
                error={errors.scope}
              />
                  ),
                },
               ]}
             />
            </div>
            {/* [UI-20260901-CATARROWS] Tells the admin there is more below.
                The step rail plus a ~130-row grid pushes the pickers past the
                fold, and this form was importing the indicator without ever
                rendering it — so the cue existed on albums and not here. */}
            <ScrollIndicator containerRef={bodyRef} />
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmSave}
        title={t('common.confirm')}
        message={resolvedMode === 'create' ? t('common.confirm_create_message') : t('common.confirm_update_message')}
        type="info"
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
      />

      {/* [UI-20260901-OBJSPLIT] Overlay markup lives in its own file — this
          modal crossed the 400-line warn threshold and the ratchet only shrinks. */}
      <ObjectCategoryHelpModal
        isHelpOpen={isHelpOpen}
        setIsHelpOpen={setIsHelpOpen}
        isZoomed={isZoomed}
        setIsZoomed={setIsZoomed}
        helpSource={helpSource}
        helpScrollRef={helpScrollRef}
      />

    </>
  );
};

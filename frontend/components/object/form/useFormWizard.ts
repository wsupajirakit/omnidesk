import { useState } from 'react';

import type { ObjectCategory, ObjectImageFormData } from '../../../types';
import type { StepDef } from './objectImageForm.constants';
/* ⚠️ These two live in `../scope`, not in the constants file — found by tsc, not
   assumed from where the step table lives. */
import { firstInvalidStep, focusFirstError } from '../scope';

/**
 * [REFACTOR-20260904-FORMHOOKS] The album form's wizard: which step is open,
 * what is wrong with it, and what happens when Save is pressed.
 * ===========================================================================
 *
 * ### Why these move together (§6.4)
 *
 * `validate` writes the errors, `goNext` reads them to decide whether the step
 * may advance, `handleSubmit` runs the same validation before confirming, and
 * `handleChange`/`toggleSelection` clear the error they just fixed. One state
 * (`errors`) is read and written by all five; separating them would leave the
 * writer and its readers on opposite sides of a seam.
 *
 * 🔴 EIGHT REAL DEPENDENCIES, SIX PIECES OF STATE MOVED. The form's data and its
 * setter, the step table, the categories a rule reads, the scroll container an
 * error scrolls into, the confirm dialog Save opens, the alert and `t`.
 *
 * ⚠️ VALIDATION IS NOT A UI DETAIL. `validate` is the only thing standing between
 * an album with no category — or no group and no OA — and a row the bot can
 * never serve. Every branch here corresponds to a rule the server also enforces;
 * dropping one produces a save that succeeds and an album that does nothing.
 *
 * revert: paste these members and their state back into
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface FormWizardDeps {
  formData: ObjectImageFormData;
  setFormData: React.Dispatch<React.SetStateAction<ObjectImageFormData>>;
  categories: ObjectCategory[];
  /** The step table for the current mode — create shows fewer than update. */
  STEP_DEFS: readonly StepDef[];
  /** The scrolling container an invalid field is scrolled into. */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Opens the "are you sure" dialog once validation passes. */
  setShowConfirm: (open: boolean) => void;
  showAlert: (
    title: string,
    message: string,
    type?: 'success' | 'error' | 'info',
  ) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** The modal's own props — Save calls them, so they arrive as dependencies. */
  onSubmit: (data: ObjectImageFormData, silent?: boolean) => Promise<string | void>;
  onClose: () => void;
  /**
   * [FEAT-20260907-OBJUPLOADSTEP] Which step the wizard OPENS on, 0-based.
   *
   * The album list's new "upload" action and its thumbnail both want to land on
   * the media step (index 1 — the steps are BASIC, MEDIA, ACCESS), because both
   * are about the album's files, not its name or its permissions.
   *
   * ⚠️ Optional. Absent = 0, which is what every existing caller gets today.
   * ⚠️ It is a STARTING point, not a lock: the step chips and Next/Back still
   *    work, and a failed save still jumps to the first invalid step.
   */
  initialStep?: number;
}

export function useFormWizard({
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
  initialStep = 0,
}: FormWizardDeps) {
  /* [FEAT-20260907-OBJUPLOADSTEP] clamped, so a caller passing a stale index for
     a mode with fewer steps cannot open the wizard on a step that is not there
     — the chips would render with nothing selected and Next would do nothing. */
  const [activeStep, setActiveStep] = useState(
    Math.min(Math.max(0, initialStep), STEP_DEFS.length - 1),
  );
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const goNext = () => {
    const step = STEP_DEFS[activeStep];
    const owns = (field: string) => step?.fields.includes(field) ?? false;
    const nextErrors: Record<string, string> = {};

    if (owns('categories') && formData.categories.length === 0) {
      nextErrors.categories = t('object_category.form_name_required');
    }
    if (owns('detail') && !formData.detail.trim()) {
      nextErrors.detail =
        t('object_image.form_detail_required') || 'Please enter detail';
    }
    if (owns('response_type') && !formData.response_type) {
      nextErrors.response_type =
        t('object_image.form_response_type_label') + ' is required';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(scrollRef.current);
      return;
    }
    setActiveStep((i) => Math.min(STEP_DEFS.length - 1, i + 1));
  };

  const scopeError = (): string | undefined =>
    (formData.group_providers?.length ?? 0) === 0 ||
    (formData.hook_ids?.length ?? 0) === 0
      ? t('object_scope.required')
      : undefined;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (formData.categories.length === 0) {
      nextErrors.categories = t('object_category.form_name_required');
    }

    if (!formData.detail.trim()) {
      nextErrors.detail = t('object_image.form_detail_required') || 'Please enter detail';
    }

    if (!formData.response_type) {
      nextErrors.response_type = t('object_image.form_response_type_label') + ' is required';
    }

    const scope = scopeError();
    if (scope) nextErrors.scope = scope;

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      /* [UI-20260901-OBJWIZARD] Land on the first failing step. The alert below
         names the problem; without this the field it names is on a step the
         user cannot see. */
      const bad = firstInvalidStep(STEP_DEFS, nextErrors);
      if (bad >= 0) {
        setActiveStep(bad);
        setShowAllSteps(false);
        // Switching step is not enough — the field can be below the fold too.
        focusFirstError(scrollRef.current);
      }
      const errorMsg = nextErrors.categories
        ? t('object_category.validation_category_required') || 'กรุณาเลือกหมวดหมู่'
        : nextErrors.detail
          ? t('object_image.validation_detail_required') || 'กรุณาใส่รายละเอียด'
          : t('common.validation_error');

      showAlert(t('common.error_title'), errorMsg, 'error');
      return false;
    }

    return true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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

  const toggleSelection = (field: 'categories' | 'group_providers', id: string) => {
    setFormData(prev => {
      const current = prev[field];
      if (field === 'categories') {
        // Enforce single-select for categories
        return { ...prev, categories: current.includes(id) ? [] : [id] };
      }
      const next = current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id];
      return { ...prev, [field]: next };
    });
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
      console.error('Failed to submit image', error);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return {
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
  };
}

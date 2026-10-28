/**
 * [FEAT-20260811-HOOKFORMSPLIT] Form-context prop passed to extracted HookFormModal
 * tabs. The parent owns all state; a tab receives exactly what it reads/writes as
 * ONE typed object. Typed (not `any`) on purpose — tsc then flags a tab referencing
 * a field the parent forgot to pass, catching the classic "undefined at runtime"
 * extraction bug before it ships. เพิ่ม field ที่ tab ต้องใช้ที่นี่ + ตอนประกอบ formCtx ในแม่.
 */
import type React from 'react';

// Loose where the parent's own types are loose (formData/errors are `any`-ish there),
// strict on the function/flag shapes so a missing one is a compile error.
export interface HookFormTabCtx {
  /** [FEAT-20260817-SECRETLOCK] lock state for stored credentials (custom_ai_key here) */
  secretLock: import('../secretLock').SecretLockApi;
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  errors: Record<string, string>;
  isViewMode: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
  inputClass: (hasError: boolean, extra?: string) => string;
  /** [FEAT-20260822-NOTICEMODE] the saved hook's id, or undefined while creating.
   *  The notice tab writes on its OWN route (`PUT /hook/notice/:id`), so it needs
   *  the id — and its absence is what tells it to say "save the OA first". */
  hookId?: string;
  // data the ai tab reads
  flexTemplates: any[];
  groups: any[];
  // ai sub-tab + training-doc state
  aiSubTab: string;
  setAiSubTab: React.Dispatch<React.SetStateAction<any>>;
  docStep: string;
  setDocStep: React.Dispatch<React.SetStateAction<any>>;
  showCustomAiKey: boolean;
  setShowCustomAiKey: React.Dispatch<React.SetStateAction<boolean>>;
  trainingDocGeneral: string;
  setTrainingDocGeneral: React.Dispatch<React.SetStateAction<string>>;
  trainingDocCompany: string;
  setTrainingDocCompany: React.Dispatch<React.SetStateAction<string>>;
  trainingDocNoProfile: string;
  setTrainingDocNoProfile: React.Dispatch<React.SetStateAction<string>>;
  setHelpModal: (v: any) => void;
  setDocTestOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setToast: (v: any) => void;
  /**
   * [FEAT-20260829-NOTICEUNSAVED] the notification tab's "what the server holds"
   * snapshot, kept HERE rather than in the tab.
   *
   * 🔴 The tab unmounts on every tab switch, so a snapshot living inside it was
   *    re-seeded from the current form on the way back and the unsaved marker
   *    silently reset. Holding it on the form makes the answer survive, and lets
   *    the main save ask the question while the tab is not even mounted — which
   *    is the only way that guard can fire from any other tab.
   * ⚠️ A ref, not state: writing it must never re-render the form mid-save.
   * `null` = the tab has never been opened ⇒ treated as NOT dirty.
   */
  noticeSavedRef: React.MutableRefObject<string | null>;
  /** Bumped by the main save to flash the tab's own save button. */
  noticeFlash: number;
  openRawJsonExample: () => void;
  openSiteRulesExample: () => void;
}

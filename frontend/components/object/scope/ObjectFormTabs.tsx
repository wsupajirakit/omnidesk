/**
 * [UI-20260901-OBJWIZARD] Wizard shell for the two Object form modals — step
 * rail, step panes, and the back/next pair.
 *
 * Owner, 01/09: make both Object modals work like the broadcast form. This is
 * that shell, and it deliberately reproduces `BroadcastStepper.tsx` rule for
 * rule so the two wizards behave identically for the same user.
 *
 * WHY NOT REUSE `BroadcastStepper` DIRECTLY: it imports `BROADCAST_STEPS` at
 * module scope and indexes into it (`BROADCAST_STEPS.findIndex`, `LAST_STEP`,
 * `STEP_COUNT`), so it can only ever describe the broadcast form. Making it
 * generic would mean editing a file the broadcast lane owns, widening its
 * contract, and putting its tests at risk for a change they do not need. This
 * file takes its steps as a prop instead; `components/campaign/` is untouched.
 *
 * COLOUR RULES — copied verbatim from `BroadcastStepper.tsx`, which records why:
 *  · only tokens this app maps for BOTH themes: `bg-dark-*`, `border-dark-*`,
 *    `text-slate-*`. Written once, correct in light and dark.
 *  · accent is LINE green, as tint + border + ring, never a solid fill: solid
 *    accent reads as harsh, and pale shades vanish on a light background.
 *  · the ONLY solid button is the form's own save. "Next" must not compete with
 *    it, or the last step shows two solid buttons and nobody can tell which one
 *    actually saves.
 *  · `primary-50` / `primary-100` DO NOT EXIST here — the theme declares only
 *    400/500/600/700, so those classes silently vanish. Never write them.
 *
 * WARNING — back/next are `type="button"`, always. They sit inside a `<form>`,
 * and a `<button>` with no type submits. Forgetting it means pressing "next"
 * saves the record.
 *
 * WARNING — panes are HIDDEN, never unmounted. `{active && <…>}` would unmount
 * the fields of every step you are not on, so any child holding its own state
 * (a picker's search box, a gallery's paging) is wiped each time you walk past
 * it. Hidden is safe; removed is not. Hidden twice on purpose: the `hidden`
 * attribute (jsdom and tests see it) and Tailwind's `hidden` class (the real
 * browser sees it) — this project has had tests pass while the UI was blank
 * because only one of the two was checked.
 *
 * revert: delete this file and render the modal's sections one after another.
 */
import React from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
} from 'lucide-react';

import { useI18n } from '../../../i18n';

export interface ObjectFormStep {
  id: string;
  /** Already-translated title. The caller owns its own i18n keys. */
  label: string;
  /** Keys in the modal's `errors` object that belong to this step. */
  fields?: readonly string[];
  content: React.ReactNode;
}

/**
 * Just the field ownership. Kept separate from `ObjectFormStep` so a modal can
 * declare its step table as a plain constant — outside the component, where no
 * JSX is in scope — and still feed it to these helpers.
 */
export interface ObjectStepFields {
  readonly fields?: readonly string[];
}

/** Count the errors owned by each step, in step order. */
export function stepErrorCounts(
  steps: readonly ObjectStepFields[],
  errors: Record<string, string>,
): number[] {
  return steps.map(
    (step) => (step.fields ?? []).filter((field) => !!errors[field]).length,
  );
}

/**
 * [FIX-20260901-STEPFOCUS] Put the eye on the thing that is wrong.
 *
 * The wizard hides the steps you are not on and the body scrolls, so a field
 * that failed can be both on another step AND below the fold of that step.
 * Switching step is not enough — without this the user sees a step change and
 * no explanation.
 *
 * Runs after paint (`requestAnimationFrame`): the target step is `hidden` until
 * React has re-rendered, and a hidden element has no position to scroll to.
 * Focus is attempted first for inputs; the scroll is what covers a picker or a
 * grid, which are not focusable.
 */
export function focusFirstError(
  container: HTMLElement | null,
  selector = '[data-testid$="-error"], [aria-invalid="true"]',
): void {
  if (!container || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const focusable = target.matches('input, textarea, select')
      ? target
      : target
          .closest('[data-testid$="-panel-basic"], div')
          ?.querySelector<HTMLElement>('input, textarea, select');
    focusable?.focus({ preventScroll: true });
  });
}

/** Index of the first step carrying an error, or `-1`. */
export function firstInvalidStep(
  steps: readonly ObjectStepFields[],
  errors: Record<string, string>,
): number {
  return stepErrorCounts(steps, errors).findIndex((n) => n > 0);
}

const CHIP_BASE =
  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors';
const CHIP_ACTIVE =
  'border-primary-600 bg-primary-500/10 text-primary-700 dark:text-primary-400 font-semibold ring-2 ring-primary-500/25';
const CHIP_DONE = 'border-dark-700 bg-dark-900/40 text-slate-700';
const CHIP_TODO = 'border-dark-700 text-slate-600 hover:border-primary-500/40';
/** An error is always red, over every other state: "already visited" must not
 *  bury "still wrong". */
const CHIP_ERROR =
  'border-red-500/70 bg-red-500/10 text-red-600 dark:text-red-300 font-semibold';

export const OBJECT_WIZARD_NEXT_CLASS =
  'inline-flex items-center gap-2 rounded-xl border-2 border-primary-600 bg-primary-500/10 ' +
  'px-6 py-2.5 text-sm font-semibold text-primary-700 dark:text-primary-400 ' +
  'ring-2 ring-primary-500/25 transition-colors hover:bg-primary-500/20 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const OBJECT_WIZARD_BACK_CLASS =
  'inline-flex items-center gap-2 rounded-xl border-2 border-dark-700 ' +
  'px-6 py-2.5 text-sm font-semibold text-slate-700 transition-colors ' +
  'hover:bg-dark-700 disabled:opacity-40 disabled:cursor-not-allowed';

export interface ObjectStepRailProps {
  steps: readonly ObjectFormStep[];
  activeIndex: number;
  errorCounts: readonly number[];
  showAll: boolean;
  onPick: (index: number) => void;
  onToggleShowAll: () => void;
}

/**
 * "Which step am I on, how many are left" — and jump to any of them.
 *
 * Jumping is unrestricted ON THE RAIL by design, exactly as broadcast decided:
 * view mode and records opened for reading must be walkable end to end. The
 * gate lives on the "next" button instead, so a user who is filling the form in
 * order is stopped, while a user inspecting one is not trapped on step 1.
 */
export const ObjectStepRail: React.FC<ObjectStepRailProps> = ({
  steps,
  activeIndex,
  errorCounts,
  showAll,
  onPick,
  onToggleShowAll,
}) => {
  const { t } = useI18n();
  const last = steps.length - 1;
  const current = Math.min(activeIndex, last);
  const remaining = last - current;

  return (
    <div
      className="rounded-xl border border-dark-700 bg-dark-900/40 px-4 py-3"
      data-testid="object-wizard-rail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm font-semibold text-slate-900"
          data-testid="object-wizard-position"
        >
          {t('broadcast.wizard_step_of', {
            current: current + 1,
            total: steps.length,
          })}
          <span className="ml-2 font-normal text-slate-700">
            {steps[current]?.label ?? ''}
          </span>
        </p>
        <div className="flex items-center gap-3">
          <span
            className="text-xs text-slate-600"
            data-testid="object-wizard-remaining"
          >
            {remaining > 0
              ? t('broadcast.wizard_remaining', { count: remaining })
              : t('broadcast.wizard_last_step')}
          </span>
          {/* Not decoration: the wizard hides other steps with display:none, so
              without this there is no way to review the whole record before
              saving, and read-only inspection costs one click per step.
              `aria-expanded` + a `-toggle` testid are load-bearing — the shared
              test helper opens every collapsed section through exactly those. */}
          <button
            type="button"
            name="object_wizard_view_all"
            data-testid="object-wizard-viewall-toggle"
            aria-expanded={showAll}
            onClick={onToggleShowAll}
            className="flex items-center gap-1.5 rounded-lg border border-dark-700 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-dark-700"
          >
            <List size={14} aria-hidden />
            {showAll
              ? t('broadcast.wizard_show_steps')
              : t('broadcast.wizard_show_all')}
          </button>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dark-700">
        <div
          className="h-full rounded-full bg-primary-500/70 transition-all"
          style={{ width: `${((current + 1) / steps.length) * 100}%` }}
          data-testid="object-wizard-progress"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {steps.map((step, i) => {
          const bad = errorCounts[i] ?? 0;
          const tone =
            bad > 0
              ? CHIP_ERROR
              : i === current
                ? CHIP_ACTIVE
                : i < current
                  ? CHIP_DONE
                  : CHIP_TODO;
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`object-wizard-step-${step.id}`}
              aria-current={i === current ? 'step' : undefined}
              onClick={() => onPick(i)}
              className={`${CHIP_BASE} ${tone}`}
            >
              <span className="tabular-nums">{i + 1}.</span>
              <span>{step.label}</span>
              {bad > 0 && (
                <span
                  className="flex items-center gap-0.5"
                  data-testid={`object-wizard-badge-${step.id}`}
                >
                  <AlertCircle size={12} aria-hidden />
                  {bad}
                </span>
              )}
              {bad === 0 && i < current && <Check size={12} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export interface ObjectStepNavProps {
  activeIndex: number;
  stepCount: number;
  /** Hidden while "show all steps" is on — there are no steps left to walk. */
  showAll: boolean;
  onBack: () => void;
  onNext: () => void;
  /** `false` disables "next", gating the step. */
  canGoNext?: boolean;
}

/**
 * Back / next.
 *
 * The last step has NO "next": that place belongs to the form's own save
 * button, and adding a second one would leave the user guessing which commits.
 */
export const ObjectStepNav: React.FC<ObjectStepNavProps> = ({
  activeIndex,
  stepCount,
  showAll,
  onBack,
  onNext,
  canGoNext = true,
}) => {
  const { t } = useI18n();
  if (showAll) return null;
  return (
    <>
      <button
        type="button"
        name="object_wizard_back"
        data-testid="object-wizard-back"
        onClick={onBack}
        disabled={activeIndex <= 0}
        className={OBJECT_WIZARD_BACK_CLASS}
      >
        <ChevronLeft size={18} aria-hidden />
        {t('broadcast.wizard_back')}
      </button>
      {activeIndex < stepCount - 1 && (
        <button
          type="button"
          name="object_wizard_next"
          data-testid="object-wizard-next"
          onClick={onNext}
          /* Not `disabled`: a dead button explains nothing. Pressing it runs
             validation, which paints the offending field and its step chip red.
             `aria-disabled` still tells assistive tech the state. */
          aria-disabled={!canGoNext}
          className={OBJECT_WIZARD_NEXT_CLASS}
        >
          {t('broadcast.wizard_next')}
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
    </>
  );
};

export interface ObjectFormTabsProps {
  steps: readonly ObjectFormStep[];
  activeIndex: number;
  showAll: boolean;
  errors: Record<string, string>;
  onPick: (index: number) => void;
  onToggleShowAll: () => void;
}

/** Rail plus the panes. The nav buttons render in the modal header, beside save. */
export const ObjectFormTabs: React.FC<ObjectFormTabsProps> = ({
  steps,
  activeIndex,
  showAll,
  errors,
  onPick,
  onToggleShowAll,
}) => {
  const counts = stepErrorCounts(steps, errors);
  const current = Math.min(activeIndex, steps.length - 1);

  return (
    <div className="flex flex-col gap-5" data-testid="object-wizard">
      <ObjectStepRail
        steps={steps}
        activeIndex={current}
        errorCounts={counts}
        showAll={showAll}
        onPick={onPick}
        onToggleShowAll={onToggleShowAll}
      />

      {steps.map((step, i) => {
        const visible = showAll || i === current;
        return (
          <div
            key={step.id}
            data-testid={`object-wizard-pane-${step.id}`}
            data-step-visible={visible ? 'yes' : 'no'}
            hidden={!visible}
            className={visible ? 'flex flex-col gap-5' : 'hidden'}
          >
            {step.content}
          </div>
        );
      })}
    </div>
  );
};

export default ObjectFormTabs;

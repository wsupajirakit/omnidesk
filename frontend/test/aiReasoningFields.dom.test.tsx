/**
 * [FEAT-20260909-DSREASONING] The reasoning controls — and the state the old
 * control does not have.
 * ============================================================================
 * 🔴 THE ONE THING THIS FILE IS REALLY FOR: **not set is not off.**
 *
 * The existing Gemini budget control in `HookAiTab.tsx` has three states and
 * treats a missing value as "off", which is correct there — on that lane the BE
 * reads `budget ?? 0`, so null and 0 genuinely are the same request.
 *
 * On these five columns they are NOT the same. Absent sends no thinking
 * instruction at all, which is what these lanes have always sent; `0` or
 * `disabled` is a deliberate instruction. Copying the old control's shape would
 * make every OA that never opened this box start sending a field nobody chose —
 * exactly the backfill the owner ruled out, three times, the last time with
 * "at code level too, this must not slip".
 *
 * So every case below that looks pedantic about `null` vs `''` vs `0` is the
 * point of the file, not decoration.
 *
 * ⚠️ WRITTEN AFTER LEARNING THAT THIS AREA'S EXISTING SPECS COVER NONE OF IT.
 *    144 pre-existing tests stayed green when the DeepSeek box's hide rule was
 *    restored, and would say nothing here either. Every assertion in this file
 *    was mutation-checked.
 *
 * revert: delete this file with `AiReasoningFields.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import {
  DeepSeekReasoningFields,
  GeminiTranslateBudgetField,
} from '../components/hook/form/tabs/AiReasoningFields';

function ctxFor(formData: Record<string, unknown> = {}) {
  const setFormData = vi.fn();
  return {
    setFormData,
    ctx: {
      formData,
      setFormData,
      isViewMode: false,
      /* Marked, so a MISSING i18n key shows up as a visibly wrong string rather
         than passing as "the key is the label". */
      t: (k: string) => `«${k}»`,
      inputClass: () => 'input',
      errors: {},
      handleChange: vi.fn(),
      secretLock: {
        isLocked: () => false,
        isUnlocked: () => false,
        displayValue: (_f: string, v: string) => v,
      },
    } as never,
  };
}

const sel = (name: string) =>
  document.querySelector(`select[name="${name}"]`) as HTMLSelectElement;

/** Run the last `setFormData` updater against a starting object. */
const wrote = (spy: ReturnType<typeof vi.fn>, prev: Record<string, unknown> = {}) =>
  (spy.mock.calls.at(-1)![0] as (p: Record<string, unknown>) => Record<string, unknown>)(prev);

describe('🔴 [DSREASONING] not set is a real state, and it writes null', () => {
  it('⭐ R1 · every control starts at "not set" for a row that has nothing', () => {
    const { ctx } = ctxFor();
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    expect(sel('deepseek_thinking').value).toBe('');
    expect(sel('deepseek_reasoning_effort').value).toBe('');
    /* And "not set" is the FIRST option, so an operator opening the box does
       not have to know which of the others means "leave it alone". */
    expect(sel('deepseek_thinking').options[0]!.value).toBe('');
    cleanup();
  });

  it('⭐ R2 · choosing "not set" writes NULL, never an empty string', () => {
    /* `''` is not a vendor value; the BE refuses it. One character between
       "this OA is unchanged" and "every save fails". */
    const { ctx, setFormData } = ctxFor({ deepseek_thinking: 'enabled' });
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    fireEvent.change(sel('deepseek_thinking'), { target: { value: '' } });
    expect(wrote(setFormData)).toEqual({ deepseek_thinking: null });
    cleanup();
  });

  it('⭐ R3 · "disabled" is NOT the same choice as "not set"', () => {
    /* The distinction the whole file exists for: one leaves the vendor default
       in force, the other turns thinking off. */
    const { ctx, setFormData } = ctxFor();
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    fireEvent.change(sel('deepseek_thinking'), { target: { value: 'disabled' } });
    expect(wrote(setFormData)).toEqual({ deepseek_thinking: 'disabled' });
    cleanup();
  });
});

describe('🔴 [DSREASONING] the two lanes write different columns', () => {
  it('⭐ L1 · lane="main" writes the unsuffixed columns', () => {
    const { ctx } = ctxFor();
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    expect(sel('deepseek_thinking')).toBeTruthy();
    expect(sel('deepseek_thinking_translate')).toBeNull();
    cleanup();
  });

  it('⭐ L2 · lane="translate" writes the _translate twins, and only those', () => {
    const { ctx, setFormData } = ctxFor();
    render(<DeepSeekReasoningFields ctx={ctx} lane="translate" />);
    expect(sel('deepseek_thinking')).toBeNull();
    fireEvent.change(sel('deepseek_thinking_translate'), {
      target: { value: 'enabled' },
    });
    const out = wrote(setFormData, { deepseek_thinking: 'disabled' });
    /* The main lane's stored value must survive untouched — a lane that writes
       the other's column is the failure with no symptom. */
    expect(out).toEqual({
      deepseek_thinking: 'disabled',
      deepseek_thinking_translate: 'enabled',
    });
    cleanup();
  });
});

describe('[DSREASONING] the effort list is what the probe left', () => {
  it('⭐ E1 · FOUR values are offered, including the undocumented one', () => {
    /* `medium` is here because a live call proved it works, not because the
       docs say so — they list only three. */
    const { ctx } = ctxFor();
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    const values = [...sel('deepseek_reasoning_effort').options].map(
      (o) => o.value,
    );
    expect(values).toEqual(['', 'low', 'medium', 'high', 'max']);
    cleanup();
  });

  it('E2 · an effort can be chosen while thinking is off — it is inert, not invalid', () => {
    /* Measured: the vendor accepts the pair and ignores the effort. The control
       therefore does not disable itself and hide the operator's choice; the
       hint says what happens instead. */
    const { ctx, setFormData } = ctxFor({ deepseek_thinking: 'disabled' });
    render(<DeepSeekReasoningFields ctx={ctx} lane="main" />);
    expect(sel('deepseek_reasoning_effort').disabled).toBe(false);
    fireEvent.change(sel('deepseek_reasoning_effort'), {
      target: { value: 'high' },
    });
    expect(wrote(setFormData, { deepseek_thinking: 'disabled' })).toEqual({
      deepseek_thinking: 'disabled',
      deepseek_reasoning_effort: 'high',
    });
    cleanup();
  });
});

describe('🔴 [DSREASONING] Gemini’s translate budget has FOUR states, not three', () => {
  const F = 'gemini_thinking_budget_translate';

  it('⭐ G1 · nothing stored ⇒ "not set", and it is not "off"', () => {
    const { ctx } = ctxFor();
    render(<GeminiTranslateBudgetField ctx={ctx} />);
    expect(sel(F).value).toBe('');
    /* The old control would show "off" here. That is right on its lane and
       wrong on this one. */
    expect(sel(F).value).not.toBe('off');
    cleanup();
  });

  it('⭐ G2 · "not set" writes null; "off" writes the number 0', () => {
    const { ctx, setFormData } = ctxFor({ [F]: 2048 });
    render(<GeminiTranslateBudgetField ctx={ctx} />);
    fireEvent.change(sel(F), { target: { value: '' } });
    expect(wrote(setFormData)).toEqual({ [F]: null });
    fireEvent.change(sel(F), { target: { value: 'off' } });
    expect(wrote(setFormData)).toEqual({ [F]: 0 });
    cleanup();
  });

  it('G3 · dynamic is -1, and custom keeps a previously chosen number', () => {
    const { ctx, setFormData } = ctxFor({ [F]: 512 });
    render(<GeminiTranslateBudgetField ctx={ctx} />);
    fireEvent.change(sel(F), { target: { value: 'dynamic' } });
    expect(wrote(setFormData)).toEqual({ [F]: -1 });
    fireEvent.change(sel(F), { target: { value: 'custom' } });
    /* Not reset to a default — the operator's own number survives the toggle. */
    expect(wrote(setFormData)).toEqual({ [F]: 512 });
    cleanup();
  });

  it('G4 · the number input appears only for custom, and clamps to the API range', () => {
    const { ctx, setFormData } = ctxFor({ [F]: 512 });
    render(<GeminiTranslateBudgetField ctx={ctx} />);
    const input = document.querySelector(
      `input[name="${F}_value"]`,
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '99999' } });
    /* Clamped in the form as well as at the API, so an operator learns the
       limit before submitting rather than from a rejection. */
    expect(wrote(setFormData)).toEqual({ [F]: 24576 });
    cleanup();
  });

  it('G5 · with nothing stored there is no number input at all', () => {
    const { ctx } = ctxFor();
    render(<GeminiTranslateBudgetField ctx={ctx} />);
    expect(document.querySelector(`input[name="${F}_value"]`)).toBeNull();
    cleanup();
  });
});

/**
 * 🔴 THE FIELDS MUST SURVIVE THE PAYLOAD BUILDER, AND NULL MUST STAY NULL.
 *
 * `buildHookPayload` spreads `...formData`, and its own comment says a new plain
 * field therefore needs no line — which is true and is why nothing was added
 * there. But two lines below that spread, `gemini_thinking_budget` is coerced
 * so that a missing value becomes the NUMBER 0.
 *
 * That coercion is correct for the main lane, where null and 0 mean the same
 * request. If anyone ever copies it for the `_translate` twin "for symmetry",
 * every OA that never opened the box starts sending an explicit "stop thinking"
 * instruction it never chose — the backfill the owner forbade, arriving through
 * a helper rather than through a schema.
 *
 * These cases exist so that copy turns something red.
 */
import { buildHookPayload } from '../utils/hookFormPayload';

const BOXES = { general: 'g', company: 'c', noProfile: 'n' } as never;
const EDIT = { isCreate: false };

describe('🔴 [DSREASONING] the payload builder must not invent values', () => {
  it('⭐ P1 · an unset translate budget stays NULL — it must not become 0', () => {
    const out = buildHookPayload(
      { gemini_thinking_budget_translate: null } as never,
      BOXES,
      EDIT,
    ) as unknown as Record<string, unknown>;
    expect(out['gemini_thinking_budget_translate']).toBeNull();
    expect(out['gemini_thinking_budget_translate']).not.toBe(0);
  });

  it('⭐ P2 · unset DeepSeek knobs stay null, and a set one travels as chosen', () => {
    const out = buildHookPayload(
      {
        deepseek_thinking: null,
        deepseek_reasoning_effort: null,
        deepseek_thinking_translate: 'enabled',
        deepseek_reasoning_effort_translate: 'medium',
      } as never,
      BOXES,
      EDIT,
    ) as unknown as Record<string, unknown>;
    expect(out['deepseek_thinking']).toBeNull();
    expect(out['deepseek_reasoning_effort']).toBeNull();
    expect(out['deepseek_thinking_translate']).toBe('enabled');
    expect(out['deepseek_reasoning_effort_translate']).toBe('medium');
  });

  it('P3 · the MAIN Gemini budget keeps its own coercion — untouched', () => {
    /* Pinned so the fix for one lane cannot be "fixed" onto the other. Absent
       there really does mean 0, and that is the behaviour every live OA has. */
    const out = buildHookPayload({} as never, BOXES, EDIT) as unknown as Record<
      string,
      unknown
    >;
    expect(out['gemini_thinking_budget']).toBe(0);
  });
});

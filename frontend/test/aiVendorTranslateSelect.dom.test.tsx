/**
 * [FEAT-20260909-VENDORTRANSLATE] The translate lane gets its own vendor box.
 * ============================================================================
 * Owner, 09/09: *"selector ใหม่สำหรับเลือก ai vendor ที่ใช้ translate"* and
 * *"ai vendor selector ตัวเดิมขึ้นบนสุด = ปรับ label เป็น AI Vendor (AI สำหรับระบบหลัก)"*.
 *
 * 🔴 WHY THIS FILE EXISTS RATHER THAN LEANING ON THE SIX EXISTING SPECS. When
 *    the DeepSeek box was un-hidden in the previous change, all 144 pre-existing
 *    tests stayed green with the hide rule put back — none of them looks at this
 *    part of the DOM at all. A green suite said nothing about that change and
 *    would say nothing about this one. Everything asserted here is asserted
 *    because a mutation proved it can go red.
 *
 * ⚠️ THE EMPTY OPTION IS THE WHOLE FEATURE'S COMPATIBILITY STORY. It must reach
 *    the API as `null` — not `''`. Empty means "follow the main vendor", which
 *    is what every OA that predates the column does today; `''` is an unknown
 *    vendor name and the BE refuses it. One character between "nothing changed"
 *    and "every save fails".
 *
 * revert: delete this file with the select it covers.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AiVendorSelect } from '../components/hook/form/tabs/AiVendorSelect';
import { AI_VENDORS } from '../config/aiVendors';

/** A context stub shaped like the real `HookFormTabCtx`, with a spy setter. */
function ctxFor(formData: Record<string, unknown> = {}) {
  const setFormData = vi.fn();
  const secretLock = {
    isLocked: () => false,
    isUnlocked: () => false,
    displayValue: (_f: string, v: string) => v,
  };
  return {
    setFormData,
    ctx: {
      formData,
      setFormData,
      isViewMode: false,
      /* The real `t` returns the key when a translation is missing, which would
         make a missing-key bug look like a passing test. Returning a marked
         string instead means an absent key is visible in the DOM. */
      t: (k: string) => `«${k}»`,
      inputClass: () => 'input',
      errors: {},
      handleChange: vi.fn(),
      secretLock,
    } as never,
  };
}

const renderSelect = (formData: Record<string, unknown> = {}) => {
  const { ctx, setFormData } = ctxFor(formData);
  render(<AiVendorSelect ctx={ctx} />);
  return { setFormData };
};

const selectNamed = (name: string) =>
  document.querySelector(`select[name="${name}"]`) as HTMLSelectElement | null;

describe('[VENDORTRANSLATE] the translate vendor select exists and is its own', () => {
  it('⭐ T1 · both selects render, and they are two different fields', () => {
    renderSelect();
    expect(selectNamed('ai_vendor')).not.toBeNull();
    expect(selectNamed('ai_vendor_translate')).not.toBeNull();
    expect(selectNamed('ai_vendor')).not.toBe(selectNamed('ai_vendor_translate'));
  });

  it('⭐ T2 · the main one comes FIRST in the DOM — owner asked for it on top', () => {
    renderSelect();
    const main = selectNamed('ai_vendor')!;
    const translate = selectNamed('ai_vendor_translate')!;
    /* `compareDocumentPosition` rather than reading indexes off a list: it
       answers about document order directly, which is what "on top" means. */
    expect(
      main.compareDocumentPosition(translate) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('⭐ T3 · and both sit ABOVE the two vendor boxes', () => {
    renderSelect();
    const translate = selectNamed('ai_vendor_translate')!;
    const gemini = screen.getByTestId('ai-vendor-box-gemini');
    expect(
      translate.compareDocumentPosition(gemini) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('T4 · the main label is the owner’s wording, not the old one', () => {
    renderSelect();
    /* The key must be `ai_vendor`, and the WORDING lives in the i18n files —
       asserting the key here and the text in the json is what keeps a relabel
       from needing a code change. */
    expect(screen.getByText('«hook_form.ai_vendor»')).toBeTruthy();
    expect(screen.getByText('«hook_form.ai_vendor_translate»')).toBeTruthy();
  });
});

describe('[VENDORTRANSLATE] what the select writes', () => {
  it('⭐ T5 · the empty option writes NULL, never an empty string', () => {
    /* The one-character difference between "this OA is unchanged" and "the BE
       rejects every save with an unknown-vendor error". */
    const { setFormData } = renderSelect({ ai_vendor_translate: 'deepseek' });
    fireEvent.change(selectNamed('ai_vendor_translate')!, {
      target: { value: '' },
    });
    const updater = setFormData.mock.calls.at(-1)![0] as (
      p: Record<string, unknown>,
    ) => Record<string, unknown>;
    expect(updater({})).toEqual({ ai_vendor_translate: null });
  });

  it('⭐ T6 · choosing a vendor writes THAT field and nothing else', () => {
    /* The point of a second column: taking the translate choice must not drag
       the main vendor with it. */
    const { setFormData } = renderSelect();
    fireEvent.change(selectNamed('ai_vendor_translate')!, {
      target: { value: 'deepseek' },
    });
    const updater = setFormData.mock.calls.at(-1)![0] as (
      p: Record<string, unknown>,
    ) => Record<string, unknown>;
    const out = updater({ ai_vendor: 'gemini' });
    expect(out).toEqual({ ai_vendor: 'gemini', ai_vendor_translate: 'deepseek' });
  });

  it('T7 · the main select still writes its own field, unchanged', () => {
    const { setFormData } = renderSelect();
    fireEvent.change(selectNamed('ai_vendor')!, {
      target: { value: 'deepseek' },
    });
    const updater = setFormData.mock.calls.at(-1)![0] as (
      p: Record<string, unknown>,
    ) => Record<string, unknown>;
    expect(updater({})).toEqual({ ai_vendor: 'deepseek' });
  });
});

describe('[VENDORTRANSLATE] one vendor list, not two', () => {
  it('⭐ T8 · both selects offer exactly the same vendors, from the shared source', () => {
    /* `config/aiVendors.ts` is the single truth and says so in its own header.
       Two hand-written lists would drift the day a third vendor arrives, and
       nothing would fail — one menu would simply be short. */
    renderSelect();
    const options = (name: string) =>
      [...selectNamed(name)!.options].slice(1).map((o) => o.value);
    const expected = AI_VENDORS.map((v) => v.value);
    expect(options('ai_vendor')).toEqual(expected);
    expect(options('ai_vendor_translate')).toEqual(expected);
  });

  it('T9 · each has its own empty option, with its own wording', () => {
    renderSelect();
    /* Different sentences on purpose: the main one means "the system default",
       the translate one means "follow the main one". Sharing a label would
       teach an operator the wrong thing about what empty does. */
    expect(selectNamed('ai_vendor')!.options[0]!.textContent).toBe(
      '«hook_form.ai_vendor_default»',
    );
    expect(selectNamed('ai_vendor_translate')!.options[0]!.textContent).toBe(
      '«hook_form.ai_vendor_translate_default»',
    );
  });
});

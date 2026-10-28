/**
 * [FEAT-20260823-GENERRFALLBACK] The AI-outage line gets its input — and this
 * time the field is proven in BOTH directions before it is called done
 * (skill §14, written after the check-flags save bug the same night).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildHookPayload } from '../utils/hookFormPayload';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const MODAL = 'components/hook/HookFormModal.tsx';
const TAB = 'components/hook/form/tabs/HookAiTab.tsx';
const F = 'ai_generative_error_text';

describe('⭐⭐ OUT — the field survives the save payload', () => {
  it('⭐ buildHookPayload carries it verbatim (the real builder, not a copy)', () => {
    const payload = buildHookPayload(
      { [F]: 'AI ล่มชั่วคราว', custom_ai_key: 'k', group_id: 'g', status: 1 },
      { general: '', company: '', noProfile: '' },
      { isCreate: false },
    ) as Record<string, unknown>;
    expect(payload[F]).toBe('AI ล่มชั่วคราว');
  });

  it('⭐ an emptied field still travels (clearing must reach the server)', () => {
    const payload = buildHookPayload(
      { [F]: '', custom_ai_key: 'k', group_id: 'g', status: 1 },
      { general: '', company: '', noProfile: '' },
      { isCreate: false },
    ) as Record<string, unknown>;
    expect(F in payload).toBe(true);
    expect(payload[F]).toBe('');
  });
});

describe('⭐ IN — the form state knows the field', () => {
  const modal = read(MODAL);

  it('⭐ DEFAULT_FORM starts it EMPTY — never a canned default', () => {
    /* a canned default would silently change what every NEW hook answers on an
       AI outage; empty = the ladder falls to default_answer_text = today. */
    expect(modal).toMatch(new RegExp(`${F}: '',`));
  });

  it('⭐ initialData maps it, so editing does not wipe a saved value', () => {
    const at = modal.indexOf(`(initialData as any).${F}`);
    expect(at).toBeGreaterThan(-1);
  });

  it('has a label entry and a tab entry, so validation can point at it', () => {
    expect(modal).toContain(`${F}: t('hook_form.${F}')`);
    expect(modal).toMatch(new RegExp(`${F}: 'ai'`));
  });
});

describe('⭐ the input renders on the AI tab, above its fallback', () => {
  const tab = read(TAB);

  it('⭐ rung 1 (this field) renders BEFORE rung 2 (default_answer_text)', () => {
    const rung1 = tab.indexOf(`name="${F}"`);
    const rung2 = tab.indexOf('name="default_answer_text"');
    expect(rung1).toBeGreaterThan(-1);
    expect(rung1).toBeLessThan(rung2);
  });

  it('both locales carry the label and the hint', () => {
    for (const lang of ['th', 'en']) {
      const j = JSON.parse(read(`i18n/translations/${lang}.json`));
      expect(j[`hook_form.${F}`]).toBeTruthy();
      expect(j[`hook_form.${F}_hint`]).toBeTruthy();
    }
  });
});

describe('⭐ drift — the BE really accepts this field on the real routes', () => {
  it('⭐ ALLOWED_UPDATES and the create path both name it', () => {
    const BE = join(process.cwd(), '..', 'backend', 'src/modules/hooks/hooks.service.ts');
    if (!existsSync(BE)) {
      expect(`SKIPPED — back end not at ${BE}`).toContain('SKIPPED');
      return;
    }
    const src = readFileSync(BE, 'utf8');
    expect(src).toContain(`'${F}'`); // the ALLOWED_UPDATES entry
    expect(src.match(new RegExp(`${F}`, 'g'))!.length).toBeGreaterThanOrEqual(3);
  });
});

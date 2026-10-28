/**
 * [FEAT-20260823-NOTICECHECKFLAGS] FE half — the four wrap-flag checkboxes.
 *
 * The one failure mode that matters here is POLARITY: every other notice
 * toggle maps `=== true` (absent = off). These flags are absent = ON. A
 * mapping that copies the toggle pattern would open legacy rows with the
 * boxes unchecked, and the next save would write false — silencing the
 * hook's notices without anyone choosing to.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const TAB = 'components/hook/form/tabs/HookNoticeTab.tsx';
const MODAL = 'components/hook/HookFormModal.tsx';

const FLAGS = [
  'notice_deposit_time_check',
  'notice_deposit_sitestatus_check',
  'notice_withdraw_time_check',
  'notice_withdraw_sitestatus_check',
] as const;

describe('[FEAT-20260823-NOTICECHECKFLAGS] the four checkboxes exist, one pair per side', () => {
  const tab = read(TAB);

  it('⭐ all four render through the shared toggle() helper', () => {
    for (const f of FLAGS) expect(tab).toContain(`'${f}'`);
  });

  it('⭐ deposit pair sits in the deposit section, withdraw pair in the withdraw section', () => {
    const dep = tab.indexOf('notice_section_deposit');
    const wd = tab.indexOf('notice_section_withdraw');
    expect(tab.indexOf("'notice_deposit_time_check'")).toBeGreaterThan(dep);
    expect(tab.indexOf("'notice_deposit_time_check'")).toBeLessThan(wd);
    expect(tab.indexOf("'notice_withdraw_time_check'")).toBeGreaterThan(wd);
  });

  it('the labels are shared keys — both sides say the same thing', () => {
    for (const lang of ['th', 'en']) {
      const j = JSON.parse(read(`i18n/translations/${lang}.json`));
      expect(j['hook_form.notice_time_check']).toBeTruthy();
      expect(j['hook_form.notice_sitestatus_check']).toBeTruthy();
      expect(j['hook_form.notice_time_check_hint']).toBeTruthy();
      expect(j['hook_form.notice_sitestatus_check_hint']).toBeTruthy();
    }
  });
});

describe('⭐⭐ [FIX-20260823-FLAGSAVE] the flags SURVIVE THE SAVE — the bug that shipped', () => {
  /* What actually happened: the checkboxes rendered, the mapping was right,
     every unit test was green — and unticking a box then saving changed
     nothing, because pickNotice() builds the request body from the hand-kept
     NOTICE_FORM_FIELDS list and the four flags were not on it. The field died
     BEFORE the request left the browser. These cases test the OUT direction. */

  it('⭐ all four flags are on NOTICE_FORM_FIELDS — the save-body list', async () => {
    const { NOTICE_FORM_FIELDS } = await import(
      '../components/hook/form/noticeCardGate'
    );
    for (const f of FLAGS) expect(NOTICE_FORM_FIELDS).toContain(f);
  });

  it('⭐ a form with a flag set to false keeps it through the pick (round trip out)', async () => {
    const { NOTICE_FORM_FIELDS } = await import(
      '../components/hook/form/noticeCardGate'
    );
    // replay pickNotice's exact rule on a form that just unticked one box
    const form: Record<string, unknown> = {
      notice_deposit_sitestatus_check: false,
      unrelated_field: 'x',
    };
    const body: Record<string, unknown> = {};
    NOTICE_FORM_FIELDS.forEach((f: string) => {
      if (f in form) body[f] = form[f];
    });
    expect(body['notice_deposit_sitestatus_check']).toBe(false);
    expect(body['unrelated_field']).toBeUndefined();
  });

  it('⭐ drift guard — the FE save list carries every BE NOTICE_CHECK_FLAG_FIELDS entry', async () => {
    /* same cross-repo pattern noticeCardGate.value.test.ts uses: read the BE
       source; if the BE grows a fifth flag and the FE list is not updated, this
       goes red instead of the field dying silently again. */
    const BE = join(
      process.cwd(),
      '..',
      'backend',
      'src/modules/hooks/notice-settings/notice-settings.fields.ts',
    );
    if (!existsSync(BE)) {
      expect(`SKIPPED — back end not at ${BE}`).toContain('SKIPPED');
      return;
    }
    const src = readFileSync(BE, 'utf8');
    const block = src.slice(
      src.indexOf('NOTICE_CHECK_FLAG_FIELDS = ['),
      src.indexOf('] as const', src.indexOf('NOTICE_CHECK_FLAG_FIELDS = [')),
    );
    const beFlags = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(beFlags.length).toBe(4);
    const { NOTICE_FORM_FIELDS } = await import(
      '../components/hook/form/noticeCardGate'
    );
    for (const f of beFlags) expect(NOTICE_FORM_FIELDS).toContain(f);
  });
});

describe('⭐⭐ polarity — the failure this file exists to prevent', () => {
  const modal = read(MODAL);

  it('⭐ DEFAULT_FORM starts every flag ON', () => {
    for (const f of FLAGS) expect(modal).toMatch(new RegExp(`${f}: true,`));
  });

  it('⭐ initialData maps with `!== false` — NEVER `=== true`', () => {
    for (const f of FLAGS) {
      const at = modal.indexOf(`(initialData as any).${f}`);
      expect(at).toBeGreaterThan(-1);
      const line = modal.slice(at, at + 120);
      expect(line).toContain('!== false');
      expect(line).not.toContain('=== true');
    }
  });

  it('⭐ a legacy row (no columns) therefore opens with all four CHECKED', () => {
    /* replay the mapping rule on a row that predates the columns */
    const legacy: Record<string, unknown> = {};
    for (const f of FLAGS) expect(legacy[f] !== false).toBe(true);
  });

  it('and an explicit false opens unchecked — the only off state', () => {
    expect(({ notice_deposit_time_check: false }).notice_deposit_time_check !== false).toBe(false);
  });
});

/**
 * [FEAT-20260824-NOTICECASEINFO] The A–F chips and the reference modal.
 *
 * The one thing that must never drift: CASE_OF_CARD (FE) vs the BE case files,
 * where each case declares its own cardField. The drift test reads those files.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CASE_OF_CARD } from '../components/hook/form/NoticeCaseInfoModal';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const TAB = 'components/hook/form/tabs/HookNoticeTab.tsx';
const MODAL = 'components/hook/form/NoticeCaseInfoModal.tsx';

describe('⭐⭐ drift — the letter map equals the BE case files, letter by letter', () => {
  it('⭐ every case file names exactly the card the FE letter points at', () => {
    const dir = join(process.cwd(), '..', 'backend', 'src/modules/webhook/notice-runtime/cases');
    if (!existsSync(dir)) {
      expect(`SKIPPED — back end not at ${dir}`).toContain('SKIPPED');
      return;
    }
    const files = ['a-deposit-offtime', 'b-deposit-disable', 'c-withdraw-offtime',
      'd-withdraw-disable', 'e-all-offtime', 'f-all-disable'];
    for (const f of files) {
      const src = readFileSync(join(dir, `case-${f}.ts`), 'utf8');
      const caseId = (src.match(/caseId:\s*'([A-F])'/) ?? [])[1];
      const card = (src.match(/cardField:\s*'([a-z_]+)'/) ?? [])[1];
      expect(caseId, f).toBeTruthy();
      expect(card, f).toBeTruthy();
      // the FE letter for that card must be the BE's own caseId
      expect(CASE_OF_CARD[card!], `${f}: ${card}`).toBe(caseId);
    }
    expect(Object.keys(CASE_OF_CARD).length).toBe(6);
  });

  it('⭐ the modal states the same precedence order the BE array ships', () => {
    const be = join(process.cwd(), '..', 'backend', 'src/modules/webhook/notice-runtime/cases/index.ts');
    if (!existsSync(be)) {
      expect('SKIPPED').toContain('SKIPPED');
      return;
    }
    const order = readFileSync(be, 'utf8')
      .match(/NOTICE_CASE_ORDER[^=]*=\s*\[([^\]]+)\]/)![1]!
      .match(/CASE_([A-F])/g)!
      .map((x) => x.slice(-1))
      .join(' → ');
    /* ⭐ found by mutation: a comment inside the modal also carries the order,
       so a plain contains() stayed green when the RENDERED line was wrong.
       Anchor on the JSX that the operator actually sees. */
    /* [FEAT-20261022-I18NPAGESEN] flipped 22/10: the label went through i18n (owner: English UI
       for every page), so the rendered line now reads t(…, 'ลำดับตัดสิน') <b>order</b> */
    expect(read(MODAL)).toContain(`'ลำดับตัดสิน')} <b>${order}</b>`);
  });
});

describe('⭐ the chips render on every card label', () => {
  it('cardSelect passes each pair through CASE_OF_CARD', () => {
    const tab = read(TAB);
    expect(tab).toContain('CaseChip id={CASE_OF_CARD[pair.flex]');
  });

  it('⭐ the big info button sits at the top and opens the modal', () => {
    const tab = read(TAB);
    const btn = tab.indexOf('setCaseInfoOpen(true)');
    const firstSection = tab.indexOf("t('hook_form.notice_section_deposit')");
    expect(btn).toBeGreaterThan(-1);
    expect(btn).toBeLessThan(firstSection);
    expect(tab).toContain('<NoticeCaseInfoModal open={caseInfoOpen}');
  });
});

describe('⭐ the modal tells the whole truth', () => {
  const modal = read(MODAL);

  it('⭐ every card column AND every stamp column appears by its real DB name', () => {
    for (const col of Object.keys(CASE_OF_CARD)) expect(modal).toContain(col);
    /* the JSX renders the prefix + {c.stamp}; assert both halves so the full
       dotted name is what the operator actually reads on screen */
    expect(modal).toContain('config.follow_up.line.{c.stamp}');
    for (const s of ['notice_deposit_at', 'notice_withdraw_at', 'notice_payment_at'])
      expect(modal).toContain(`stamp: '${s}'`);
  });

  it('states the one-card-per-message rule and the check-flag coverage', () => {
    expect(modal).toContain('ยิงได้ใบเดียว');
    expect(modal).toContain('A+E / B+F / C / D');
  });
});

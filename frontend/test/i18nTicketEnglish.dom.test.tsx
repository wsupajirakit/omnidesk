/**
 * [FEAT-20261022-I18NTICKETEN] The Ticket page follows the UI language.
 *
 * Owner 22/10: "fe ตั้ง eng แล้วแต่หน้าจอยังเป็นภาษาไทยอยู่ แปลให้ครบ" (screenshot: ticket list,
 * room, composer overlay, loan panel). Two halves, both on the REAL provider + dictionaries:
 *   - en → English: category chip, case overlay, loan panel section/row/value, a stored
 *     Thai divider row, the "earlier cases" stack line
 *   - th → byte-identical to before (every new th entry equals the code's Thai fallback)
 * plus the dictionary rule that makes the second half hold: no new key exists in one
 * language only, and no English value still carries Thai.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import en from '../i18n/translations/en.json';
import th from '../i18n/translations/th.json';
import { I18nProvider, useI18n } from '../i18n';
import { TicketCategoryBadge } from '../components/ticket-category/TicketCategoryBadge';
import { KvRows } from '../components/profile-panel/renderers/KvSection';
import { translateDividerLabel } from '../components/chat/dividerLabelI18n';
import { StackToggle } from '../pages/chat/ticket-stack';

const LOAN = ['Collection', 'IT', 'Payment', 'Other'];
/* the loan_v1 rows exactly as the BE build-view.ts sends them (Thai label + stable key) */
const LOAN_ROWS = [
  { key: 'loanCurrentTerm', label: 'งวดที่', value: 8 },
  { key: 'loanLocked', label: 'ล็อกเครื่อง', value: 'ไม่ล็อก' },
  { key: 'loanContractBalance', label: 'คงเหลือทั้งสัญญา', value: '21,505' },
] as any[];

const Divider: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useI18n();
  return <span data-testid="divider">{translateDividerLabel(text, t)}</span>;
};

const mount = (locale: 'en' | 'th', ui: React.ReactNode) => {
  window.localStorage.setItem('locale', locale);
  return render(<I18nProvider>{ui}</I18nProvider>);
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('[I18NTICKETEN] English UI', () => {
  it('⭐ the category chip reads the catalog English', () => {
    mount('en', <TicketCategoryBadge category="Other" categories={LOAN} />);
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.queryByText('อื่นๆ')).toBeNull();
  });

  it('⭐ loan panel rows translate by their key — label and the fixed lock word; data untouched', () => {
    mount('en', <KvRows rows={LOAN_ROWS} />);
    expect(screen.queryByText('งวดที่')).toBeNull();
    expect(screen.queryByText('ล็อกเครื่อง')).toBeNull();
    expect(screen.queryByText('ไม่ล็อก')).toBeNull();
    expect(screen.getByText(en['panel.row.loanLocked' as keyof typeof en])).toBeTruthy();
    expect(screen.getByText(en['panel.value.unlocked' as keyof typeof en])).toBeTruthy();
    expect(screen.getByText('21,505')).toBeTruthy();
  });

  it('⭐ a stored Thai divider row is drawn in English, its number kept', () => {
    mount('en', <Divider text="เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist 5 นาที" />);
    const text = screen.getByTestId('divider').textContent ?? '';
    expect(text).not.toMatch(/[฀-๿]/);
    expect(text).toContain('5');
  });

  it('an unknown divider wording is shown as stored', () => {
    mount('en', <Divider text="ข้อความที่ระบบไม่รู้จัก" />);
    expect(screen.getByTestId('divider').textContent).toBe('ข้อความที่ระบบไม่รู้จัก');
  });
});

/* [FEAT-20261020-TICKETSTACK] ported into demo 24/10 — the stack toggle follows the UI language too */
describe('[I18NTICKETEN] ticket stack toggle', () => {
  const toggle = () => <StackToggle groupKey="g1" size={3} expanded={false} onToggle={() => {}} />;
  it('⭐ en — "2 earlier case(s)", no Thai', () => {
    const { container } = mount('en', toggle());
    expect(container.textContent).toContain((en as Record<string, string>)['ticketui.stack.more'].replace('{n}', '2'));
    expect(container.textContent).not.toMatch(/[฀-๿]/);
  });
  it('🔴 PIN th — the Thai it had in the loan lane', () => {
    const { container } = mount('th', toggle());
    expect(container.textContent).toContain('เคสก่อนหน้าอีก 2 เคส');
  });
});

describe('[I18NTICKETEN] 🔴 PIN Thai UI looks as before', () => {
  it('chip, loan rows and divider are the original Thai', () => {
    mount('th', (
      <>
        <TicketCategoryBadge category="Other" categories={LOAN} />
        <KvRows rows={LOAN_ROWS} />
        <Divider text="เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist 5 นาที" />
      </>
    ));
    for (const s of ['อื่นๆ', 'งวดที่', 'ล็อกเครื่อง', 'ไม่ล็อก', 'คงเหลือทั้งสัญญา']) expect(screen.getByText(s)).toBeTruthy();
    expect(screen.getByTestId('divider').textContent).toBe('เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist 5 นาที');
  });
});

describe('[I18NTICKETEN] no provider (isolated renders)', () => {
  it('the fallback text keeps Thai and fills its placeholders; isEnglish is false', () => {
    const Probe = () => {
      const { t, isEnglish } = useI18n();
      return <span data-testid="probe">{t('ticketui.stack.more', 'เคสก่อนหน้าอีก {n} เคส', { n: 4 })}|{String(isEnglish)}</span>;
    };
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('เคสก่อนหน้าอีก 4 เคส|false');
  });
});

describe('[I18NTICKETEN] dictionaries', () => {
  const ours = (d: Record<string, string>) =>
    Object.keys(d).filter((k) => /^(ticketui|chatpage|ticketcat|panel\.(section|row|value))\./.test(k));

  it('every new key exists in both en and th', () => {
    expect(ours(en).sort()).toEqual(ours(th).sort());
    expect(ours(en).length).toBeGreaterThan(500);
  });

  it('no English value still carries Thai', () => {
    const left = ours(en).filter((k) => /[฀-๿]/.test((en as Record<string, string>)[k]));
    expect(left).toEqual([]);
  });

  /* i18nKeyCoverage only sees t('literal') calls; the divider rules and label maps hold their keys
     as plain strings, and 13 of them were missing on the first pass (English showed Thai). */
  it('every literal key the source names (maps, rule tables) exists in en.json', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const re = /['"`]((?:ticketui|chatpage|ticketcat|panel\.(?:section|row|value))\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"`]/g;
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || ['node_modules', 'dist', 'test', 'public'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) {
            if (!(m[1] in en)) missing.push(`${m[1]} (${path.relative(root, p)})`);
          }
        }
      }
    };
    walk(root);
    expect(missing).toEqual([]);
  });

  /* demo words differ from loan (เงินคืน, รอบสะสมแต้ม, ยอดกิจกรรม…): th.json wins over the code
     fallback, so a loan value left in th.json would silently change the Thai screen. */
  it('th.json equals the Thai fallback written next to every t() call', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const call = /\b(?:t|tr|translateNow)\(\s*(['"])((?:ticketui|chatpage|ticketcat|panel)\.[\w.]+)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3/gs;
    const off: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || ['node_modules', 'dist', 'test', 'public'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(call)) {
            const fallback = m[4].replace(/\\n/g, '\n').replace(/\\(['"])/g, '$1');
            if ((th as Record<string, string>)[m[2]] !== fallback) off.push(`${m[2]} (${path.relative(root, p)})`);
          }
        }
      }
    };
    walk(root);
    expect(off).toEqual([]);
  });

  it('placeholders match between en and th', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const off = ours(en).filter((k) => vars((en as any)[k]) !== vars((th as any)[k]));
    expect(off).toEqual([]);
  });
});

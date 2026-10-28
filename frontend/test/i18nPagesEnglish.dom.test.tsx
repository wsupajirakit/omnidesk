/**
 * [FEAT-20261022-I18NPAGESEN] demo — every other page follows the UI language, LABELS only.
 *
 * Owner 22/10: "แปลให้ครบหน้าอื่นๆ (เฉพาะ label fe ห้ามกระทบ value dynamic ใดๆ) proof + dive จริง
 * ทำแยกสองครั้ง loan / demo ห้ามยุ่งกัน". This lane's own pass (1,414 `pageui.*` keys), worked
 * from demo's code only; its words stay demo's (points CRM, walletpay — the lane's word
 * guard test covers every dictionary value and key).
 *   - en → English; th → byte-identical (th.json = the Thai fallback written in the code)
 *   - values stay: option values, saved presets, customer texts, the AI rules sample
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import en from '../i18n/translations/en.json';
import th from '../i18n/translations/th.json';
import { I18nProvider } from '../i18n';
import { TablePager } from '../components/common/TablePager';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sources = (): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'test', 'public'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(ROOT);
  return out;
};
const E = en as Record<string, string>;
const T = th as Record<string, string>;
const ours = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith('pageui.'));
/* the one English value that keeps Thai on purpose: the example for the THAI-translation input */
const THAI_ON_PURPOSE = new Set(['pageui.messaging.dict_th_ph']);

const pager = (locale: 'en' | 'th') => {
  window.localStorage.setItem('locale', locale);
  return render(
    <I18nProvider>
      <TablePager page={1} totalPages={3} perPage={25} onPageChange={() => {}} onPerPageChange={() => {}} />
    </I18nProvider>,
  );
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('[I18NPAGESEN] a shared label renders per locale', () => {
  it('⭐ en — the pager reads English, the numbers are untouched', () => {
    const { container } = pager('en');
    expect(container.textContent).toContain(E['pageui.common.pager_show']);
    expect(container.textContent).not.toMatch(/[฀-๿]/);
    expect(screen.getByDisplayValue('25')).toBeTruthy();
  });

  it('🔴 PIN th — exactly the Thai it showed before', () => {
    const { container } = pager('th');
    expect(container.textContent).toContain('แสดง');
    expect(container.textContent).toContain('/ หน้า');
    expect(screen.getByTitle('หน้าถัดไป')).toBeTruthy();
  });
});

describe('[I18NPAGESEN] 🔴 PIN values are not labels — still Thai in the code, never t()-wrapped', () => {
  it('support filters keep their Thai option values (the filter compares them)', () => {
    const src = read('pages/chat/TicketSupport.tsx');
    expect(src).toContain('<option value="ทั้งหมด">');
    expect(src).toContain("useState('รอรับงาน')");
  });

  it('custom-tool presets keep the endpoint labels they save; roles keep their values', () => {
    const src = read('pages/hook/CustomTools.tsx');
    expect(src).toContain("key: 'LOGIN', label: 'เข้าสู่ระบบ'");
    expect(src).toContain("{ value: 'login', label: 'login — เข้าสู่ระบบ' }");
    expect(src).toContain('<option key={o.value} value={o.value}>');
  });

  it('the AI rules sample the admin copies into a field is untouched content', () => {
    // (its header says it must never go through i18n — so: no import, no call)
    expect(read('config/rawJsonRulesSample.ts')).not.toMatch(/from ['"][^'"]*i18n['"]|translateNow\(|useI18n\(/);
  });
});

describe('[I18NPAGESEN] dictionaries', () => {
  it('every pageui key exists in both en and th', () => {
    expect(ours(E).sort()).toEqual(ours(T).sort());
    expect(ours(E).length).toBeGreaterThan(1300);
  });

  it('no English value still carries Thai (one deliberate example aside), none is empty', () => {
    expect(ours(E).filter((k) => !THAI_ON_PURPOSE.has(k) && /[฀-๿]/.test(E[k]))).toEqual([]);
    expect(ours(E).filter((k) => !E[k].trim())).toEqual([]);
  });

  it('placeholders match between en and th', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    expect(ours(E).filter((k) => vars(E[k]) !== vars(T[k]))).toEqual([]);
  });

  /* th.json beats the code fallback, so a drift would silently change the Thai screen */
  it('th.json equals the Thai fallback written next to every t() call (ticketui + pageui)', () => {
    // the fallback may be one literal or several joined with + ('…' +\n '…')
    const call = /\b(?:t|tr|tx|translateNow)\(\s*(['"])((?:pageui|ticketui|chatpage|ticketcat|panel)\.[\w.]+)\1\s*,\s*((?:(['"])(?:\\.|(?!\4).)*\4\s*\+?\s*)+)/gs;
    const piece = /(['"])((?:\\.|(?!\1).)*)\1/gs;
    const decode = (s: string) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
    const off: string[] = [];
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(call)) {
        const fallback = [...m[3].matchAll(piece)].map((p) => decode(p[2])).join('');
        if (T[m[2]] !== fallback) off.push(`${m[2]} (${file})`);
      }
    }
    expect(off).toEqual([]);
  });

  it('every literal pageui key the source names exists in en.json', () => {
    const re = /['"`](pageui\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"`]/g;
    const missing: string[] = [];
    for (const [file, src] of sources()) for (const m of src.matchAll(re)) if (!(m[1] in E)) missing.push(`${m[1]} (${file})`);
    expect(missing).toEqual([]);
  });
});

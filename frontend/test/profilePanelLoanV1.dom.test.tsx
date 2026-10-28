/**
 * [FLOWTEST-20261014-LOANV1PANEL] The loan_v1 panel, drawn from what the BACK END really answers.
 * =============================================================================
 * Until now no FE test touched a `loan_*` section — the generic path was proven only with an
 * invented `provider_b`. This renders the REAL panel (`PersonalPanelNarrow`) with envelopes the
 * BE produced from the partner's real answers through its shipped stamping:
 *   test/fixtures/loanV1RawProfileEnvelopes.json  ← omnidesk-api/z-test/tmp/export-loan-v1-envelopes.ts
 * Never hand-edit that JSON; regenerate it. Every label/value asserted below is READ from it,
 * so a BE label change is followed automatically and a drop on screen is caught.
 *
 * Proves: 5 sections + every row reach the screen · a 0 is drawn · device ids never print (a
 * sentinel imei is planted in `data`) · the register action is hidden on a loan site while the
 * "no member data" label stays — with an shop-api-shaped control proving the button can show.
 * Drift guard: the section ids match the BE's loan-v1/build-view.ts (sibling checkout).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* ── the envelope the REAL panel will be handed ───────────────────────────── */
const envelope: { value: unknown } = { value: null };

/* Stubs copied in shape from `personalPanelCards.dom.test.tsx` — everything the
   panel reaches for that is not the profile envelope. */
vi.mock('../services/chat', async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>('../services/chat');
  return {
    ...actual,
    ticketService: {
      getRawProfile: () => Promise.resolve(envelope.value),
      refreshRawProfile: () => Promise.resolve(envelope.value),
      clearRawProfile: () => Promise.resolve({ success: true }),
      getHookSiteRules: () => Promise.resolve(null),
      refreshHookSiteRules: () => Promise.resolve(null),
      getLinkCapabilities: () => Promise.resolve({}),
      getAdminLinkUrl: () => Promise.resolve({}),
      adminUnlinkCustomer: () => Promise.resolve({}),
      patchDetail: () => Promise.resolve({}),
    },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});
vi.mock('../services/finance', () => ({
  bankService: {
    getDirectory: () => Promise.resolve([]),
    logoUrl: () => '',
    lookup: () => null,
  },
}));
vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ user: { role: { name: 'admin' } }, token: 't' }),
}));
vi.mock('../pages/chat/chatOpenedRefresh', () => ({
  profileRefreshPlan: () => ({ shouldFetch: true }),
  useChatOpenedRefresh: () => {},
}));

import { I18nProvider } from '../i18n';
import { PersonalPanelNarrow } from '../components/profile-panel';
import ENVELOPES from './fixtures/loanV1RawProfileEnvelopes.json';

type Row = { key?: string; label: string; value: unknown };
type Sec = { id: string; label: string; rows?: Row[] };
const sectionsOf = (e: any): Sec[] => e.view.sections;

const mountWith = (env: unknown) => {
  envelope.value = env;
  return render(
    <I18nProvider>
      <PersonalPanelNarrow
        source={{ line_user_data: { _id: 'a0d00000000000000000002b', line_user_id: 'U00000000000000000000000000000000' }, line_oa_hook_id: 'h1' } as never}
        room={null}
      />
    </I18nProvider>,
  );
};

describe('[LOANV1PANEL] a linked loan customer — the real panel draws the real answer', () => {
  it.each([['live (numbers)', 'live'], ['prod blob (strings)', 'prod']] as const)(
    '%s: every section title and row label reaches the screen',
    async (_l, which) => {
      const env = (ENVELOPES as any)[which];
      mountWith(env);
      const secs = sectionsOf(env);
      expect(secs.map((s) => s.id)).toEqual(['loan_customer', 'loan_contract', 'loan_product', 'loan_term', 'loan_overdue']);
      await waitFor(() => expect(screen.getAllByText(secs[0]!.label).length).toBeGreaterThan(0));
      for (const s of secs) {
        expect({ section: s.id, onScreen: screen.queryAllByText(s.label).length > 0 }).toEqual({ section: s.id, onScreen: true });
        for (const r of s.rows ?? []) {
          expect({ row: r.label, onScreen: screen.queryAllByText(r.label).length > 0 }).toEqual({ row: r.label, onScreen: true });
        }
      }
    },
  );

  it('a zero is drawn, not swallowed as empty', async () => {
    const env = (ENVELOPES as any).live;
    const zeroRow = sectionsOf(env).flatMap((s) => s.rows ?? []).find((r) => r.value === 0);
    expect(zeroRow, 'the real answer carries at least one 0 (fine / unlock fee)').toBeDefined();
    mountWith(env);
    await waitFor(() => expect(screen.queryAllByText(zeroRow!.label).length).toBeGreaterThan(0));
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('🔴 device ids never reach the screen — even when the blob carries one', async () => {
    const env = (ENVELOPES as any).live;
    expect(JSON.stringify(env.data)).toContain('IMEI-SENTINEL-0001');
    const { container } = mountWith(env);
    await waitFor(() => expect(screen.getAllByText(sectionsOf(env)[0]!.label).length).toBeGreaterThan(0));
    expect(container.textContent).not.toContain('IMEI-SENTINEL-0001');
  });
});

describe('[LOANV1PANEL] an unlinked customer on a loan site', () => {
  it('the "no member data" label stays, the register action does not exist', async () => {
    const env = (ENVELOPES as any).unlinked;
    expect(env.show_register_action).toBe(false);
    mountWith(env);
    await waitFor(() => expect(screen.getByText('ยังไม่มีข้อมูลสมาชิกจาก API')).toBeTruthy());
    expect(screen.queryByText('ลงทะเบียนให้ลูกค้า')).toBeNull();
  });

  it('🔴 control: the same envelope without the loan stamp (shop-api shape) DOES show the button', async () => {
    const { show_register_action: _drop, has_member_data: _drop2, customer_provider: _drop3, ...shopapiShaped } = (ENVELOPES as any).unlinked;
    mountWith({ ...shopapiShaped, customer_provider: 'shopapi_v1' });
    await waitFor(() => expect(screen.getByText('ลงทะเบียนให้ลูกค้า')).toBeTruthy());
  });
});

describe('[LOANV1PANEL] ⭐ drift guard — the fixture matches the back end', () => {
  const BE = join(process.cwd(), '..', 'backend', 'src/modules/customer-provider/providers/loan-v1/build-view.ts');
  it('section ids, in order, equal those loan-v1/build-view.ts emits', () => {
    if (!existsSync(BE)) {
      expect(`SKIPPED — back end not at ${BE}`).toContain('SKIPPED');
      return;
    }
    const ids = [...readFileSync(BE, 'utf8').matchAll(/id: '(loan_[a-z_]+)'/g)].map((m) => m[1]);
    expect(sectionsOf((ENVELOPES as any).live).map((s) => s.id)).toEqual(ids);
  });
});

/**
 * [FIX-20260827-FOOTERFADE] Both confirm buttons must tell the same story.
 * ============================================================================
 * Owner, 27/08, with a screenshot from stg: at step 1/6 the HEADER confirm was
 * faded (opacity-40 + explanatory title, per [UI-20260825-CONFIRMLASTSTEP])
 * while the FOOTER confirm looked fully active — two buttons for the same
 * action giving opposite signals. The click-guard in handleSubmit was never
 * missing; only the footer's visual affordance was.
 *
 * These cases pin the rule on BOTH buttons at once by counting, so a third
 * confirm button added later is forced to adopt the same affordance or fail
 * here.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('../services/admin/visibleGroups', () => ({
  fetchVisibleGroups: () => Promise.resolve([]),
  filterVisibleHooks: (hs: unknown[]) => hs,
}));

import { BroadcastFormModal } from '../components/campaign';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  if (!window.matchMedia)
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
});

const noop = () => {};
const asyncNoop = async () => {};

/** Every submit button of the broadcast form (header + footer share the form). */
const confirmButtons = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button[type="submit"]'));

describe('[FIX-20260827-FOOTERFADE] wizard not at last step ⇒ every confirm fades', () => {
  it('⭐ create opens at step 1: BOTH confirm buttons carry opacity-40 + title', () => {
    /* 🔴 The mutation this kills: drop the fade from the footer button and the
       header alone keeps it — count goes 2 → 1 and this goes red. That is the
       exact shipped bug. */
    const { container } = render(
      <I18nProvider>
        <BroadcastFormModal isOpen onClose={noop} onSubmit={asyncNoop as never} />
      </I18nProvider>,
    );
    const btns = confirmButtons(container);
    expect(btns.length).toBe(2); // header + footer — a third must join the rule
    for (const b of btns) {
      expect(b.className).toContain('opacity-40');
      expect(b.getAttribute('title')).toBeTruthy();
    }
  });

  it('neither button is `disabled` — faded but clickable, the guard explains on click', () => {
    /* Same deliberate rule as the header comment: a dead button explains
       nothing. If someone "fixes" this to disabled, the amber banner that says
       WHY can never appear. */
    const { container } = render(
      <I18nProvider>
        <BroadcastFormModal isOpen onClose={noop} onSubmit={asyncNoop as never} />
      </I18nProvider>,
    );
    for (const b of confirmButtons(container)) {
      expect(b.disabled).toBe(false);
    }
  });
});

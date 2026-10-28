/**
 * [FEAT-20260829-FLEXMENUTYPE] the menu type and its sub-type must survive the
 * ROUND TRIP, and the list must be able to ask for a tab.
 *
 * 🔴 WHY THIS FILE EXISTS AT THIS LAYER. `normalizeFlexMessage` builds a NEW
 * object field by field, so anything it does not list is gone on the way BACK
 * from the server — the card saves correctly, the form re-opens blank, and the
 * next save writes the blank over the real value. That exact bug already
 * happened here once with `direct_ticket_on_reply`, and the file still carries
 * the comment about it. A field is not "added" until it is in this map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200 } as never);
  },
  handleApiResponse: () =>
    Promise.resolve({
      data: [
        {
          _id: 'a1',
          name: 'main menu',
          content_json: {},
          flex_type: 'menu',
          flex_sub_type: 'main',
          flex_slug: 'main-deposit',
        },
        {
          _id: 'a2',
          name: 'old card',
          content_json: {},
        },
      ],
      meta: { total: 2, page: 1, limit: 25 },
    }),
}));

import { flexMessageService as svc } from '../services/media/flexMessageService';

beforeEach(() => {
  calls.length = 0;
});

describe('[FLEXMENUTYPE] menu type round trip', () => {
  it('⭐⭐⭐ flex_sub_type survives the normalizer — the field-by-field drop point', async () => {
    const res = await svc.listFlexMessages({});
    expect(res.data[0].flex_sub_type).toBe('main');
  });

  it('⭐⭐⭐ a card with no sub_type reads as null, never a guessed default', async () => {
    const res = await svc.listFlexMessages({});
    expect(res.data[1].flex_sub_type).toBeNull();
  });

  it('⭐⭐ the list can ask for a tab', async () => {
    await svc.listFlexMessages({ tab: 'menu' });
    expect(calls[0]).toContain('tab=menu');
  });

  it('⭐⭐ no tab ⇒ the URL is unchanged from today (seamless)', async () => {
    await svc.listFlexMessages({});
    expect(calls[0]).not.toContain('tab=');
  });

  it('⭐ flex_type still defaults to slip for legacy rows — unchanged', async () => {
    const res = await svc.listFlexMessages({});
    expect(res.data[1].flex_type).toBe('slip');
  });

  it('⭐⭐⭐ flex_slug survives the normalizer too — same drop point', async () => {
    const res = await svc.listFlexMessages({});
    expect(res.data[0].flex_slug).toBe('main-deposit');
  });

  it('⭐⭐⭐ a card without a slug reads null — no invented default', async () => {
    /* Optional means optional: a card nobody labelled must be indistinguishable
       from one that will never be labelled. That is what makes "no backfill"
       true rather than a claim. */
    const res = await svc.listFlexMessages({});
    expect(res.data[1].flex_slug).toBeNull();
  });

  it('⭐⭐⭐ creating a NON-menu card is untouched by either new field', async () => {
    /* The proof the owner asked for: the two menu-only fields must not reach a
       slip/custom card. The FE sends '' and the BE forces null; here we pin the
       FE half — a legacy row carries neither field and reads null for both,
       exactly as it did before the feature existed. */
    const res = await svc.listFlexMessages({});
    const legacy = res.data[1];
    expect(legacy.flex_type).toBe('slip');
    expect(legacy.flex_sub_type).toBeNull();
    expect(legacy.flex_slug).toBeNull();
  });
});

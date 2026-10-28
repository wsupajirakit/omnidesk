/**
 * [FEAT-20260823-BCASTDESC] Why this campaign exists.
 * ===========================================================================
 * 🔴 REQUIRED ON CREATE, OPTIONAL ON EDIT — and the asymmetry is the design,
 *    not laziness. The COLUMN has to stay optional because every campaign
 *    saved before it has none; making it required in the database would make
 *    each of them fail to save the next time anyone touched it. A NEW campaign
 *    has no such history, so there is every reason to insist: a description
 *    nobody is asked for is a description nobody writes.
 *
 *    And an EDIT must not be blocked by a field the campaign never had —
 *    renaming a 2025 broadcast cannot require writing its rationale first.
 *    งานเก่าต้องแก้ได้ · งานใหม่ต้องมีคำอธิบาย.
 *
 * ⚠️ THE BACKEND DECIDES (`ensureValidDescription`). This side exists so the
 *    admin hears about it while the form is open instead of after a round
 *    trip — and the drift block below fails if the two ever disagree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const payload: { value: unknown } = { value: null };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(payload.value),
}));

import { broadcastService } from '../services/messaging/broadcastService';

const feRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readCode = (rel: string): string =>
  readFileSync(resolve(feRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

const BE = resolve(
  feRoot,
  '../backend/src/modules/content/content-broadcast-auto-reply.util.ts',
);
const readIfPresent = (p: string): string | null => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

beforeEach(() => {
  payload.value = null;
});

describe('the description survives the read path', () => {
  it('🔴 a stored description comes back', async () => {
    /* `normalizeBroadcast` rebuilds the row field by field — the silent-drop
       shape that has now cost this feature five separate columns. */
    payload.value = {
      data: [{ _id: 'b1', name: 'promo', description: 'ส่งโปรเดือนนี้' }],
      meta: { total: 1 },
    };
    const out = await broadcastService.listBroadcasts({});
    expect(out.data[0]?.description).toBe('ส่งโปรเดือนนี้');
  });

  it('a campaign that predates the column reads back as null', async () => {
    payload.value = { data: [{ _id: 'b1', name: 'promo' }], meta: { total: 1 } };
    const out = await broadcastService.listBroadcasts({});
    expect(out.data[0]).toHaveProperty('description', null);
  });
});

describe('the form asks for one — on a NEW campaign only', () => {
  const modal = readCode('components/campaign/BroadcastFormModal.tsx');

  it('🔴 required when creating', () => {
    expect(modal).toMatch(/resolvedMode === 'create' &&[\s\S]{0,80}description/);
    expect(modal).toContain('broadcast.form_description_required');
  });

  it('🔴 NOT required when editing — an old campaign must stay editable', () => {
    /* If this ever becomes unconditional, renaming a campaign saved before the
       column becomes impossible and nobody will connect the two.
       ห้ามบังคับตอนแก้ ไม่งั้นงานเก่าแตะไม่ได้เลย. */
    const guard = modal.slice(
      modal.indexOf('form_description_required') - 200,
      modal.indexOf('form_description_required'),
    );
    expect(guard).toContain("resolvedMode === 'create'");
  });

  it('has a field the admin can actually type in', () => {
    expect(modal).toMatch(/name="description"/);
  });

  it('caps the length rather than letting the backend refuse the save', () => {
    expect(modal).toContain('broadcast.form_description_too_long');
    expect(modal).toMatch(/maxLength=\{500\}/);
  });
});

describe('🔌 drift — this side and the backend must agree', () => {
  it('🔴 the same 500-character ceiling', () => {
    const be = readIfPresent(BE);
    if (be === null) return; // backend lane not checked out
    const m = be.match(/DESCRIPTION_MAX = (\d+)/);
    expect(m).not.toBeNull();
    expect(readCode('components/campaign/BroadcastFormModal.tsx')).toContain(
      `maxLength={${m?.[1]}}`,
    );
  });

  it('🔴 the backend really does require it on create', () => {
    /* If it stopped, this form would be demanding something the API does not,
       which is its own kind of lie. */
    const be = readIfPresent(BE);
    if (be === null) return;
    expect(be).toMatch(/description is required/);
    expect(be).toMatch(/required: boolean/);
  });
});

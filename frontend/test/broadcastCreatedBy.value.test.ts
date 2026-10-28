/**
 * [FEAT-20260823-BCASTACTOR] Who set this campaign up.
 * ===========================================================================
 * The backend stored `created_by` as an id and every read handed it out raw.
 * An id answers "is this mine?" and nothing else; the question an admin asks
 * in a shared console is *who set this up*.
 *
 * 🔴 THREE STATES, NOT TWO. `null` means the row HELD an id that could not be
 *    resolved — a removed account, or the lookup being unavailable — which is
 *    a different fact from a row with no actor at all. Collapsing them makes a
 *    deleted admin indistinguishable from a system-created job.
 *    แปลไม่ออก ≠ ไม่มีคนสร้าง.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  payload.value = null;
});

const listOf = (row: Record<string, unknown>) => {
  payload.value = { data: [{ _id: 'b1', name: 'promo', ...row }], meta: { total: 1 } };
  return broadcastService.listBroadcasts({});
};

describe('the name survives the read path', () => {
  it('🔴 a resolved name comes through', async () => {
    /* `normalizeBroadcast` rebuilds the row field by field — the same trap
       that has now cost this feature three separate columns. */
    const out = await listOf({ created_by: 'u1', created_by_name: 'Admin One' });
    expect(out.data[0]?.created_by_name).toBe('Admin One');
  });

  it('🔴 the raw id comes through TOO — the name never replaces it', async () => {
    /* The id is what a support ticket traces, and two admins can share a
       display name. ชื่อไว้ให้คนอ่าน · id ไว้ให้ตามเรื่อง. */
    const out = await listOf({ created_by: 'u1', created_by_name: 'Admin One' });
    expect(out.data[0]?.created_by).toBe('u1');
  });

  it('an unresolved actor reads back as null, not undefined', async () => {
    const out = await listOf({ created_by: 'gone' });
    expect(out.data[0]).toHaveProperty('created_by_name', null);
    expect(out.data[0]?.created_by).toBe('gone');
  });

  it('updated_by is carried on the same terms', async () => {
    const out = await listOf({ updated_by: 'u2', updated_by_name: 'Admin Two' });
    expect(out.data[0]?.updated_by_name).toBe('Admin Two');
  });
});

describe('the list column tells the three states apart', () => {
  const page = readFileSync(resolve(root, 'pages/messaging/Broadcasts.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  it('🔴 shows the name when there is one', () => {
    expect(page).toContain('item.created_by_name');
  });

  it('🔴 an id that would not resolve says so — it does not go blank', () => {
    /* A blank cell reads as "nobody made this", which is a different and wrong
       fact about a campaign whose author account was deleted. */
    expect(page).toContain('broadcast.created_by_unknown');
    expect(page).toMatch(/item\.created_by\s*\?/);
  });

  it('🔴 the NAME is what the cell reaches for first', () => {
    /* An ObjectId rendered in a "Created by" column reads like a person called
       `65f1…`. ห้ามเอา id มาโชว์เป็นชื่อ.
       ⚠️ REWRITTEN: the first version grepped for the id being printed alone,
       which `{item.created_by ?? item.created_by_name}` sails straight past —
       the mutation survived. What matters is PRECEDENCE, so the cell is sliced
       out and its first field reference checked. จับลำดับ ไม่ใช่จับรูปแบบเดียว. */
    const from = page.indexOf('data-testid={`created-by-');
    expect(from).toBeGreaterThan(-1);
    const cell = page.slice(from, page.indexOf('</td>', from));
    const first = cell.match(/item\.(created_by_name|created_by)\b/);
    expect(first?.[1]).toBe('created_by_name');
  });
});

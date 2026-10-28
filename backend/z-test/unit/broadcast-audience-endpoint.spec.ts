/**
 * [FEAT-20260823-BCASTSOURCES] The registry, as the form sees it.
 * ===========================================================================
 * Read-only, and the point is that there is exactly ONE table: a condition the
 * screen offers must exist in the filter builder, and one the filter accepts
 * must be offerable. A second hardcoded list on the dashboard is a list that
 * drifts, silently, until an admin picks something the backend refuses.
 */
import { AUDIENCE_SOURCES, BroadcastsReadService } from '@/modules/content';

const service = new BroadcastsReadService({} as never, {} as never);

describe('GET /api/broadcasts/audience-sources', () => {
  it('offers exactly what the filter builder knows — no more, no fewer', () => {
    const keys = service.listAudienceSources().data.map((s) => s.key);
    expect(keys.sort()).toEqual(Object.keys(AUDIENCE_SOURCES).sort());
  });

  it('carries what a dropdown needs to render itself', () => {
    const first = service.listAudienceSources().data[0];
    expect(first).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        label_th: expect.any(String),
        label_en: expect.any(String),
        type: expect.any(String),
        requires_hook_scope: expect.any(Boolean),
        indexed: expect.any(Boolean),
      }),
    );
    expect(Array.isArray(first?.ops)).toBe(true);
  });

  it('🔴 never exposes the Mongo column behind a condition', () => {
    /* `path` is the column. A form that knows it invites a caller to SEND one,
       which is the arbitrary-path query the registry exists to prevent (§0c.3).
       The `key` is the contract; the path stays on this side.
       ห้ามส่ง path ออกไป ไม่งั้นทะเบียนก็ไร้ความหมาย. */
    for (const s of service.listAudienceSources().data) {
      expect(s).not.toHaveProperty('path');
      expect(JSON.stringify(s)).not.toContain('config.follow_up');
    }
  });

  it('🔴 every op it advertises is one the filter will actually accept', () => {
    // A dropdown offering an op the builder refuses is a form that produces a
    // request the backend rejects — and the admin gets blamed for it.
    for (const s of service.listAudienceSources().data) {
      const known = AUDIENCE_SOURCES[s.key as keyof typeof AUDIENCE_SOURCES];
      expect([...s.ops].sort()).toEqual([...known.ops].sort());
    }
  });

  it('🔴 never advertises `exists` — it destroys a covered read', () => {
    // §6 measured it. Absent from the type on purpose, so this is a canary for
    // somebody widening `AudienceOp` without re-reading why it is narrow.
    for (const s of service.listAudienceSources().data) {
      expect(s.ops).not.toContain('exists');
    }
  });

  it('is a pure read — it touches no model', () => {
    // The service was constructed with empty objects for every model; any
    // query at all would have thrown by now.
    expect(() => service.listAudienceSources()).not.toThrow();
  });
});

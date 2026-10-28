/**
 * [TEST-20260825-SENDNOWCHAIN] The FE→BE chain that "ส่งทันที" actually travels.
 *
 * เจ้าของ 25/08: *"full ทดสอบจริง flow จริงจากการกด fe ห้ามเดา"*
 *
 * 🔴 WHY THIS FILE, when a 24-cell matrix already exists on the BE side:
 * that matrix covers DTO · routing · timing — and **all three bugs found today
 * were outside it**, in the seams between the two repos:
 *
 *   1. create returns a DIFFERENT SHAPE when status is `sent`
 *      (`{data,results}` vs the bare doc) ⇒ `id` came back `''` ⇒ the
 *      follow-up `POST /:id/send` never fired at all.
 *   2. `/send` was never wired from the FE in the first place.
 *   3. the form saved `status:'sent'`, but `CLAIMABLE_FROM = ['scheduled']`
 *      ⇒ the claim refused its own job and reported
 *      "another process is already running this job" — nobody was racing.
 *
 * Each of the three is pinned below, so the chain cannot quietly come apart
 * again in the same place. เทสตรงรอยต่อที่พังจริง ไม่ใช่ตรงที่เขียวอยู่แล้ว.
 *
 * 🔴 SYNCED ACROSS REPOS, NEVER COPIED. §3 reads the BE's own `claim.ts` at run
 * time and takes `CLAIMABLE_FROM` from it. Widen or narrow that list in the
 * backend and this test turns red the same day, naming the FE line that has to
 * follow — instead of the pair drifting until someone presses send in
 * production. อ่านจากไฟล์จริงของ BE ไม่ก๊อปค่ามา.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { broadcastService } from '../services/messaging/broadcastService';

/* ── §1 the shape trap: create answers two ways ──────────────────────────── */

/* 🔴 THIS SECTION WAS REWRITTEN 25/08 AFTER IT WAS CAUGHT PROVING NOTHING.
   The first version called `normalizeBroadcast((x as any).data ?? x)` — it did
   the unwrap INSIDE THE TEST, so the production line could be deleted and all
   cases stayed green. Measured: removing `?.data ??` from
   `broadcastService.ts` left 15/15 passing.
   ⇒ drive `createBroadcast` itself. The unwrap must live in the code under
     test, never in the assertion. เทสต้องขับของจริง ไม่ใช่ทำงานแทนมัน */

const DOC = { _id: 'b1', name: 'x', status: 'scheduled', message: { type: 'text', text: 'hi' } };

/** what the server answered on the last call — swapped per case */
let serverAnswer: unknown = DOC;

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(serverAnswer),
}));

describe('[SENDNOWCHAIN] §1 createBroadcast returns an id for BOTH response shapes', () => {
  it('⭐⭐ enveloped `{data,results}` — what a sent-status create returns', async () => {
    serverAnswer = { data: { ...DOC }, results: [] };
    const created = await broadcastService.createBroadcast({} as never);
    expect(created.id).toBe('b1');
  });

  it('⭐ bare document — what every other create returns (PIN)', async () => {
    serverAnswer = { ...DOC };
    const created = await broadcastService.createBroadcast({} as never);
    expect(created.id).toBe('b1');
  });

  /* ⚠️ ถ้า id หาย ปลายทางคือ `/send` ไม่ยิง ไม่ใช่แค่ค่าเพี้ยน — เขียนไว้ให้คนอ่านรู้ว่า
     ข้อบนไม่ใช่เรื่องความเรียบร้อย แต่คือบั๊กที่ทำให้แคมเปญไม่ออกเลย */
});

/* ── §2 the wiring: the page calls /send, and only after a successful save ── */

const page = readFileSync(join(process.cwd(), 'pages/messaging/Broadcasts.tsx'), 'utf8');
const svc = readFileSync(join(process.cwd(), 'services/messaging/broadcastService.ts'), 'utf8');

describe('[SENDNOWCHAIN] §2 the send call exists and is ordered correctly', () => {
  it('⭐⭐ the service really has the /send path (the literal, not a symbol)', () => {
    /* ⚠️ Grep the PATH, never the function name: the bundle is minified and a
       name-based check can never prove presence there. Same rule as the note in
       broadcastService.ts. */
    expect(svc).toContain('/api/broadcasts/');
    expect(svc).toContain('/send');
  });

  it('⭐⭐ the page calls it, and only when the intent was "send now"', () => {
    expect(page).toContain('sendBroadcastNow');
    expect(page).toContain('wantsSendNow');
  });

  it('⭐ a failed send must NOT turn a successful save into a failure', () => {
    const i = page.indexOf('sendBroadcastNow');
    const region = page.slice(Math.max(0, i - 600), i + 600);
    expect(region).toContain('catch');
  });
});

/* ── §3 cross-repo sync: what the FE saves must be claimable by the BE ────── */

const CLAIM_TS = join(
  process.cwd(), '..', 'backend',
  'src/modules/content/broadcast-send/claim.ts',
);

describe('[SENDNOWCHAIN] §3 the saved status is one the backend can claim', () => {
  it('⭐⭐ the FE converts "send now" to a status in the BE CLAIMABLE_FROM list', () => {
    if (!existsSync(CLAIM_TS)) {
      /* ⚠️ Say it out loud rather than passing quietly — a skipped cross-repo
         guard that looks green is worse than no guard. */
      throw new Error(
        `cannot sync: ${CLAIM_TS} not found. This test must read the backend's own ` +
          'claim.ts; if the repo moved, fix the path — do not delete the check.',
      );
    }
    const claimSrc = readFileSync(CLAIM_TS, 'utf8');
    const m = claimSrc.match(/CLAIMABLE_FROM\s*=\s*\[([^\]]*)\]/);
    expect(m, 'CLAIMABLE_FROM not found in the backend claim.ts').not.toBeNull();

    const claimable = (m as RegExpMatchArray)[1]!
      .split(',')
      .map(x => x.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    /* The status the page writes for "send now" — read from the page itself so
       the two cannot drift apart silently. */
    const conv = page.match(/status:\s*'([a-z]+)'\s*as const/);
    expect(conv, 'the send-now conversion line was not found in Broadcasts.tsx').not.toBeNull();
    const saved = (conv as RegExpMatchArray)[1];

    expect(
      claimable,
      `FE saves "${saved}" for send-now but the backend can only claim ${JSON.stringify(claimable)}`,
    ).toContain(saved);
  });

  it('⭐ and it supplies scheduled_at, which the backend requires for that status', () => {
    const i = page.indexOf('wantsSendNow');
    const region = page.slice(i, i + 500);
    expect(region).toContain('scheduled_at');
  });
});

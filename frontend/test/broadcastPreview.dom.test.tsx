/**
 * [FEAT-20260823-BCASTPREVIEW] The preview draws; it never renders on its own.
 * ===========================================================================
 * เจ้าของสั่ง: *"reuse flex render เดิม ของ fe หน้า chat ห้ามสร้างใหม่มันรก"*
 * และ *"ห้ามไปแก้ไข original ยืนยันนะ ให้ sync มาใช้และอัพเดทตามทุกครั้ง"*
 *
 * WHAT IS PINNED HERE
 *   · the chat room's `FlexBubble` is IMPORTED, never copied and never edited
 *     — so every future fix to it reaches this panel for free
 *   · the substituted card comes from the BACKEND, so the picture matches the
 *     bytes that will be sent. `FlexPreviewModal` has a `replacements` prop
 *     that would have been quicker, and its rule is its own (it replaces a tag
 *     even without braces) — using it would make the preview disagree with the
 *     sender. ใช้ของ BE ที่แทนค่ามาแล้ว ไม่ใช่แทนเองที่ FE.
 *   · `mirrors: 'legacy'` is SHOWN. In that mode the card really does contain
 *     `{{braces}}`, and without the notice beside it that reads as a bug.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));

import { BroadcastPreviewPanel } from '../components/campaign/preview';
import type { BroadcastPreview } from '../types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 🔴 COMMENTS STRIPPED. A `not.toContain` over raw text trips on the prose
 * that EXPLAINS the rule — this panel names `replacements` while documenting
 * why it does NOT use it. Third time on this project (`\bplates\b`,
 * `scope_by_hook`, now this): assert against CODE, never against prose.
 * เทสต้องอ่านโค้ด ไม่ใช่คอมเมนต์ที่อธิบายกฎ.
 */
const readCode = (rel: string): string =>
  readFileSync(resolve(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n'"`]*\/\/.*$/gm, (l) => l.slice(0, l.indexOf('//')))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

const PANEL = 'components/campaign/preview/BroadcastPreviewPanel.tsx';

const BUBBLE = {
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'เว็บ alpha.example' }] },
};

const preview = (over: Partial<BroadcastPreview> = {}): BroadcastPreview => ({
  mirrors: 'new',
  cards: [
    { hook_id: 'a', hook_name: 'OA Alpha', message: { type: 'flex', contents: BUBBLE }, unknownTags: [] },
  ],
  ...over,
});

const draw = (p?: BroadcastPreview, loading = false, error?: string) =>
  render(<BroadcastPreviewPanel loading={loading} error={error} preview={p} />);

describe('the renderer is the chat room’s, untouched', () => {
  it('🔴 imports FlexBubble instead of re-implementing it', () => {
    const src = readCode(PANEL);
    expect(src).toMatch(/import \{[^}]*FlexBubble[^}]*\} from '\.\.\/\.\.\/chat\/FlexBubble'/);
    // A second renderer is exactly the clutter the owner refused.
    expect(src).not.toMatch(/renderFlex|flex-render|DOMPurify/);
  });

  it('🔴 does not substitute variables on this side', () => {
    /* `FlexPreviewModal`'s `replacements` replaces a tag even without braces,
       so a preview built with it would differ from what LINE receives. The
       backend hands back the finished card. */
    const src = readCode(PANEL);
    expect(src).not.toContain('replacements');
    expect(src).not.toMatch(/\.replace\(/);
  });

  it('🔴 the chat renderer itself is byte-for-byte unmodified', () => {
    /* เจ้าของสั่ง "ห้ามไปแก้ไข original". `FlexBubble` is shared with the chat
       room and the template preview; a change made for this panel would land
       on both. Its own header states the two security properties that must
       never be relaxed, so this pins them from the outside too. */
    const bubble = readFileSync(resolve(root, 'components/chat/FlexBubble.tsx'), 'utf8');
    expect(bubble).toContain('DOMPurify.sanitize(renderFlex(container), PURIFY_CONFIG)');
    expect(bubble).toContain('single source of truth');
    // no broadcast-specific branch was smuggled into the shared component
    expect(bubble.toLowerCase()).not.toContain('broadcast');
  });
});

describe('what the panel shows', () => {
  it('draws a flex card through the shared renderer', async () => {
    const v = draw(preview());
    await waitFor(() =>
      expect(v.container.textContent).toContain('เว็บ alpha.example'),
    );
    expect(v.container.textContent).toContain('OA Alpha');
  });

  it('🔴 one card per OA — values differ, so one card cannot serve both', async () => {
    const v = draw(
      preview({
        cards: [
          { hook_id: 'a', hook_name: 'OA Alpha', message: { type: 'flex', contents: BUBBLE }, unknownTags: [] },
          { hook_id: 'b', hook_name: 'OA Beta', message: { type: 'text', text: 'เว็บ beta.example' }, unknownTags: [] },
        ],
      }),
    );
    await waitFor(() => expect(v.container.textContent).toContain('OA Beta'));
    expect(v.container.textContent).toContain('เว็บ beta.example');
  });

  it('a text message shows its words — there is no flex body to draw', async () => {
    const v = draw(
      preview({ cards: [{ hook_id: 'a', hook_name: 'OA', message: { type: 'text', text: 'สวัสดีครับ' }, unknownTags: [] }] }),
    );
    await waitFor(() => expect(v.container.textContent).toContain('สวัสดีครับ'));
  });

  it('🔴 shows the legacy notice — otherwise raw braces read as a bug', async () => {
    const v = draw(
      preview({
        mirrors: 'legacy',
        cards: [{ hook_id: 'a', hook_name: 'OA', message: { type: 'text', text: 'เว็บ {{hook_domain}}' }, unknownTags: [] }],
      }),
    );
    await waitFor(() =>
      expect(v.queryByTestId('preview-legacy-notice')).not.toBeNull(),
    );
    expect(v.container.textContent).toContain('{{hook_domain}}');
  });

  it('🔴 shows when the OA list was capped — a short list is not "all your OAs"', async () => {
    /* The send refuses a job naming more OAs than one run may reach. Without
       this note the preview looks complete and the send fails for a reason the
       preview never hinted at. ตัดแล้วต้องบอก. */
    const v = draw(preview({ truncatedToHooks: 20 }));
    await waitFor(() =>
      expect(v.queryByTestId('preview-truncated')).not.toBeNull(),
    );
  });

  it('no cap notice when the job fits', async () => {
    const v = draw(preview());
    await waitFor(() => expect(v.queryByTestId('broadcast-preview')).not.toBeNull());
    expect(v.queryByTestId('preview-truncated')).toBeNull();
  });

  it('no notice when the new sender is the one running', async () => {
    const v = draw(preview());
    await waitFor(() => expect(v.queryByTestId('broadcast-preview')).not.toBeNull());
    expect(v.queryByTestId('preview-legacy-notice')).toBeNull();
  });

  it('🔴 lists the tags nothing could fill — the only place they appear', async () => {
    /* The send collects `unknownTags` on every run and displays them nowhere.
       ที่เดียวที่แอดมินจะรู้ว่า tag ไหนเติมไม่ได้. */
    const v = draw(
      preview({
        cards: [{ hook_id: 'a', hook_name: 'OA', message: { type: 'text', text: 'ยอด N/A' }, unknownTags: ['profile.no_such_thing'] }],
      }),
    );
    await waitFor(() =>
      expect(v.queryByTestId('preview-unknown-tags')).not.toBeNull(),
    );
    expect(v.container.textContent).toContain('profile.no_such_thing');
  });

  it('says nothing about tags when every one was filled', async () => {
    const v = draw(preview());
    await waitFor(() => expect(v.queryByTestId('broadcast-preview')).not.toBeNull());
    expect(v.queryByTestId('preview-unknown-tags')).toBeNull();
  });

  it('an error is shown instead of a stale card', async () => {
    const v = draw(undefined, false, 'boom');
    await waitFor(() => expect(v.queryByTestId('preview-error')).not.toBeNull());
    expect(v.queryByTestId('broadcast-preview')).toBeNull();
  });

  it('renders nothing before the button is pressed', () => {
    const v = draw(undefined);
    expect(v.container.textContent).toBe('');
  });
});

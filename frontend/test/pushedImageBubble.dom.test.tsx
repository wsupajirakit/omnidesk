/**
 * [FIX-20260828-PUSHIMAGE] An image we PUSHED must render as an image on the
 * console, not as a raw link.
 * ===========================================================================
 * Owner, 28/08, with a screenshot of a broadcast that had just gone out: the
 * customer sees the picture in LINE, the console showed the URL as text.
 *
 * Why the BE is not at fault, and was not touched: an image ARRIVING from LINE
 * must be fetched with the channel token and re-hosted by us, which is what
 * `internal_content_id` records. An image we SEND was never LINE's — the
 * campaign already holds a public URL — so the row is stored, correctly, as
 * `message_type: 'image'` with that URL in `content` and no
 * `internal_content_id`. The console's image branch keyed on
 * `internal_content_id` alone, so the row fell through to the text bubble.
 *
 * The three things pinned here, which are also the three things the owner asked
 * for: it renders as an image, clicking it opens the existing zoom preview, and
 * nothing else on the transcript changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const IMG = 'https://images.rawpixel.com/image_png_800/demo-broadcast.png';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

const mountWith = async (messages: unknown[]) => {
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        /* the component loads through `listMessages`, which returns
           `{ data, pagination }` — mirror that shape exactly */
        listMessages: vi.fn().mockResolvedValue({
          data: [...messages].reverse(), // the view reverses what it receives
          pagination: { page: 1, pages: 1, total: messages.length },
        }),
      },
      useTicketWS: () => undefined,
    };
  });
  const { render, waitFor } = await import('@testing-library/react');
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'bbbb' },
  } as never;
  const view = render(
    <ChatRoomView room={room} hookId="hook1" oaName="omnidesk-dev-oa-three" showDetailBox={false} memberId="m1" memberData={{ _id: 'm1' }} />,
  );
  await waitFor(() => expect(view.container.querySelector('[data-testid], img, p')).toBeTruthy());
  return view;
};

/** The row exactly as the BE stores a pushed broadcast image. */
const pushedImage = {
  _id: 'msg-img',
  message_type: 'image',
  sender_type: 'bot',
  is_push: true,
  content: IMG,
  internal_content_id: null,
  created_at: '2026-08-27T17:26:52.000Z',
};

describe('[PUSHIMAGE] a pushed image renders as an image', () => {
  it('⭐⭐ renders an <img> pointing at the campaign URL, not the URL as text', async () => {
    const { container, findByAltText } = await mountWith([pushedImage]);
    const img = (await findByAltText('chat message')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(IMG);
    /* the whole point: the raw link must no longer be sitting in the transcript
       as readable text */
    expect(container.textContent).not.toContain(IMG);
  });

  it('⭐⭐ clicking it opens the SAME zoom preview the other images use', async () => {
    const { findByAltText, findByAltText: byAlt, container } = await mountWith([pushedImage]);
    const { fireEvent } = await import('@testing-library/react');
    const img = (await findByAltText('chat message')) as HTMLImageElement;
    /* reused, not rebuilt: the existing overlay renders an <img alt="preview">
       — if this ever needs its own modal, this expectation is what will fail */
    expect(container.querySelector('img[alt="preview"]')).toBeNull();
    fireEvent.click(img);
    const preview = (await byAlt('preview')) as HTMLImageElement;
    expect(preview.getAttribute('src')).toBe(IMG);
  });
});

describe('[PUSHIMAGE] nothing else on the transcript changes', () => {
  it('⭐⭐ a TEXT message that merely contains a link stays text', async () => {
    /* the failure this guards: widening the branch to "content looks like a URL"
       would turn ordinary messages into broken images */
    const { container } = await mountWith([
      {
        _id: 'msg-text',
        message_type: 'text',
        sender_type: 'customer',
        content: `ดูรูปนี้ ${IMG}`,
        internal_content_id: null,
        created_at: '2026-08-27T17:26:52.000Z',
      },
    ]);
    expect(container.querySelector('img[alt="chat message"]')).toBeNull();
    expect(container.textContent).toContain(IMG);
  });

  it('⭐ an image RECEIVED from LINE still uses internal_content_id, which wins', async () => {
    const { findByAltText } = await mountWith([
      {
        _id: 'msg-line-img',
        message_type: 'image',
        sender_type: 'customer',
        content: IMG, // present but must be ignored — the hosted copy wins
        internal_content_id: { image_url: '/uploads/line/abc.jpg' },
        created_at: '2026-08-27T17:26:52.000Z',
      },
    ]);
    const img = (await findByAltText('chat message')) as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/uploads/line/abc.jpg');
    expect(img.getAttribute('src')).not.toBe(IMG);
  });

  it('⭐⭐⭐ a TEXT message whose whole content IS a link stays text', async () => {
    /* The sharpest version of the guard: the content passes the URL shape, so
       ONLY `message_type` keeps it out of the image branch. Dropping that check
       turns every customer who pastes a link into a broken image bubble.
       (The looser case above does not catch it — its content starts with Thai
       text, so the URL shape alone already rejects it.) */
    const { container } = await mountWith([
      {
        _id: 'msg-bare-link',
        message_type: 'text',
        sender_type: 'customer',
        content: IMG,
        internal_content_id: null,
        created_at: '2026-08-27T17:26:52.000Z',
      },
    ]);
    expect(container.querySelector('img[alt="chat message"]')).toBeNull();
    expect(container.textContent).toContain(IMG);
  });

  it('⭐ an image row with a non-http content is NOT turned into an image', async () => {
    const { container } = await mountWith([
      {
        _id: 'msg-weird',
        message_type: 'image',
        sender_type: 'bot',
        content: 'javascript:alert(1)',
        internal_content_id: null,
        created_at: '2026-08-27T17:26:52.000Z',
      },
    ]);
    expect(container.querySelector('img[alt="chat message"]')).toBeNull();
  });
});

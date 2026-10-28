import {
  HELPER_HISTORY_URI,
  stripHelperUriForHistory,
} from '@/modules/webhook/hook-reply/customer-helper-flex';

/**
 * ==== [FIX-20260810-HELPERHISTORYURI] ====
 *
 * The button on a customer-helper card carries a mint token bound to ONE member.
 * An admin clicking it from the chat page would link data as that customer and
 * burn the single-use token, leaving the real customer's button dead.
 *
 * So the history copy points at google.com — while the card ALREADY SENT to the
 * customer must stay byte-for-byte untouched. เจ้าของกำชับ: "ห้ามให้โดนการ์ดจริง
 * เพราะลูกค้าใช้จริง" ⇒ the no-mutation test below is the important one here.
 */

const MINT = 'https://cus.example.com/?t=SECRET-MEMBER-TOKEN';

function realCard(): Record<string, unknown> {
  return {
    type: 'bubble',
    footer: {
      type: 'box',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'เชื่อมต่อ', uri: MINT },
        },
        {
          type: 'button',
          action: { type: 'message', label: 'แอดมิน', text: 'ติดต่อแอดมิน' },
        },
      ],
    },
  };
}

function firstAction(card: Record<string, unknown>): Record<string, unknown> {
  const footer = card['footer'] as Record<string, unknown>;
  const contents = footer['contents'] as Array<Record<string, unknown>>;
  return contents[0]!['action'] as Record<string, unknown>;
}

describe('[FIX-20260810-HELPERHISTORYURI] the history copy must not be clickable', () => {
  it('NEVER mutates the card that was sent to the customer', () => {
    // The single most important guarantee in this file. The object handed in is
    // the very one already delivered to LINE; editing it in place would swap the
    // customer's working button for google.com.
    const sent = realCard();
    const before = JSON.stringify(sent);

    stripHelperUriForHistory(sent);

    expect(JSON.stringify(sent)).toBe(before);
    expect(firstAction(sent)['uri']).toBe(MINT);
  });

  it('returns a different object, not the same reference', () => {
    const sent = realCard();
    expect(stripHelperUriForHistory(sent)).not.toBe(sent);
  });

  it('replaces the minted uri with google.com on the stored copy', () => {
    const stored = stripHelperUriForHistory(realCard());
    expect(firstAction(stored)['uri']).toBe(HELPER_HISTORY_URI);
    expect(HELPER_HISTORY_URI).toBe('https://google.com');
  });

  it('leaves no trace of the mint token anywhere in the stored copy', () => {
    // The token must not survive in altText, a text body, or a nested action.
    const stored = stripHelperUriForHistory(realCard());
    expect(JSON.stringify(stored)).not.toContain('SECRET-MEMBER-TOKEN');
  });

  it('keeps message actions working — only uri actions are blanked', () => {
    const stored = stripHelperUriForHistory(realCard());
    const footer = stored['footer'] as Record<string, unknown>;
    const contents = footer['contents'] as Array<Record<string, unknown>>;
    expect(contents[1]!['action']).toEqual({
      type: 'message',
      label: 'แอดมิน',
      text: 'ติดต่อแอดมิน',
    });
  });

  it('blanks uri actions nested deeper than the footer', () => {
    const card = {
      type: 'bubble',
      hero: { type: 'image', action: { type: 'uri', uri: MINT } },
      body: {
        contents: [{ type: 'text', action: { type: 'uri', uri: MINT } }],
      },
    };
    const stored = stripHelperUriForHistory(card);
    const hero = stored['hero'] as Record<string, unknown>;
    const body = stored['body'] as Record<string, unknown>;
    const inner = (body['contents'] as Array<Record<string, unknown>>)[0]!;
    expect((hero['action'] as Record<string, unknown>)['uri']).toBe(
      HELPER_HISTORY_URI,
    );
    expect((inner['action'] as Record<string, unknown>)['uri']).toBe(
      HELPER_HISTORY_URI,
    );
  });

  it('blanks a uri even when it is already a valid https link', () => {
    // Unlike fillUriActions (which preserves good links), history must never be
    // clickable at all — a promo link is fine to lose, a live token is not.
    const stored = stripHelperUriForHistory({
      type: 'bubble',
      footer: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', uri: 'https://promo.example.com' },
          },
        ],
      },
    });
    expect(firstAction(stored)['uri']).toBe(HELPER_HISTORY_URI);
  });
});

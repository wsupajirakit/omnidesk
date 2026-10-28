import type { Model, Types } from 'mongoose';

import type { ChatMessageDocument } from '../schemas/chat-message.schema';

/**
 * [FEAT-20260821-QUOTEREPLY] The two reads the admin send path needs, as pure
 * functions over the message model — kept out of `chat.service.ts` (1,978 lines)
 * and shared with `chat-media.service.ts` so the image path cannot drift.
 * Pinned by z-test/unit/quote-reply-lookup.spec.ts.
 *
 * revert: delete this file; the two services stop calling it.
 */

/** LINE: "A reply token is valid for 60 seconds after delivery." */
export const REPLY_TOKEN_TTL_MS = 60_000;

export interface ResolvedQuote {
  quoteToken: string;
  /** The quoted row's provider id, written onto OUR row as `quoted_provider_msg_id`. */
  providerMsgId: string | null;
}

type QuoteRow = {
  quote_token?: string | null;
  provider_msg_id?: string | null;
  raw_content?: {
    events?: Array<{ message?: { id?: string; quoteToken?: string } }>;
  } | null;
} | null;

/**
 * `quote_of` (a chat_messages `_id` the operator clicked Reply on) → the token LINE
 * needs. Column first. The rows that predate the column still hold the token inside
 * the raw webhook body (`raw_content.events[0].message.quoteToken`, 211 rows on
 * 21/08) — read from there, NO backfill (owner's standing rule: "ไม่ back fill
 * ห่วงแค่รายการต่อไป"). Scoped to the room so an id from elsewhere is nothing.
 * Returns null rather than throwing: the caller decides how loud to be.
 */
export async function resolveQuoteToken(
  messages: Model<ChatMessageDocument>,
  roomId: Types.ObjectId | string,
  quoteOf: string,
): Promise<ResolvedQuote | null> {
  const row = (await messages
    .findOne({ _id: quoteOf, room_id: roomId })
    .select('quote_token provider_msg_id raw_content')
    .lean()) as QuoteRow;
  if (!row) return null;
  const inbound = row.raw_content?.events?.[0]?.message;
  const quoteToken = row.quote_token || inbound?.quoteToken || null;
  if (!quoteToken) return null;
  return {
    quoteToken,
    providerMsgId: row.provider_msg_id || inbound?.id || null,
  };
}

/**
 * [FEAT-20260831-QUOTESRC] What a quote block shows when the quoted message is
 * NOT in the page the console loaded.
 * ===========================================================================
 * WHY IT EXISTS. `QuotedReference.tsx` resolves a quote against the messages
 * already on screen — and a room opens with TEN. Quote anything older and the
 * block fell back to a neutral stand-in, which is what the owner saw: a reply
 * whose source could not be read. This answers the same question server-side,
 * for the page being returned, so the answer no longer depends on how far the
 * operator has scrolled.
 *
 * ⚠️ COST IS THE DESIGN, not a detail:
 *   · a page where nothing quotes anything issues **no query at all** — the
 *     early return below is the whole guarantee, and a spec asserts it
 *   · a page with quotes issues **exactly one**, ids de-duplicated, scoped to
 *     the room, on `provider_msg_id` — indexed (`provider_msg_id_1`, read off
 *     the live collection, not off the schema source)
 *   Never make this per-message. หน้าไหนไม่มี quote = ไม่ยิงคิวรีเลย.
 *
 * ⚠️ SCOPED TO THE ROOM on purpose. LINE ids are global; a stray id from
 * another room must resolve to NOTHING rather than paint a stranger's message
 * into this transcript.
 *
 * The text is trimmed here, not in the UI: the block is a single truncated
 * line, and an untrimmed body would ride along on every page of every room.
 *
 * revert: delete this function, its export in `../index.ts`, and the two calls
 *         in `chat.service.ts`. The block goes back to the stand-in.
 */
export interface QuotedPreview {
  /** OUR row id — the console jumps by it when the message is loaded */
  id: string;
  sender_type: string;
  message_type?: string;
  /** trimmed plain text; media rows carry their stored placeholder */
  text: string;
  /** operator name on an admin-sent row, so the UI can label it "แอดมิน" */
  sender_name?: string;
}

/** One line in a quote block. Longer than this is never displayed. */
const PREVIEW_CHARS = 120;

type PreviewRow = {
  _id: unknown;
  provider_msg_id?: string | null;
  sender_type?: string | null;
  message_type?: string | null;
  content?: unknown;
  metadata?: { sender_name?: unknown } | null;
};

export async function resolveQuotedPreviews(
  messages: Model<ChatMessageDocument>,
  roomId: Types.ObjectId | string,
  rows: Array<{ quoted_provider_msg_id?: string | null }>,
): Promise<Map<string, QuotedPreview>> {
  const out = new Map<string, QuotedPreview>();
  const ids = [
    ...new Set(
      rows
        .map((r) => r.quoted_provider_msg_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  if (ids.length === 0) return out;

  const found = (await messages
    .find({ room_id: roomId, provider_msg_id: { $in: ids } })
    .select(
      'provider_msg_id sender_type message_type content metadata.sender_name',
    )
    .lean()) as PreviewRow[];

  for (const row of found) {
    if (!row.provider_msg_id) continue;
    const name =
      typeof row.metadata?.sender_name === 'string'
        ? row.metadata.sender_name.trim()
        : '';
    out.set(String(row.provider_msg_id), {
      id: String(row._id),
      sender_type: String(row.sender_type ?? ''),
      ...(row.message_type ? { message_type: String(row.message_type) } : {}),
      text:
        typeof row.content === 'string'
          ? row.content.slice(0, PREVIEW_CHARS)
          : '',
      ...(name ? { sender_name: name } : {}),
    });
  }
  return out;
}

/**
 * [FEAT-20260831-QUOTESRC] The one line each read path calls: hand it the page,
 * get the page back with `quoted_preview` on the bubbles that quote something.
 *
 * ⚠️ A row that quotes NOTHING is returned as the very same object — no copy, no
 * new key. That is what keeps every existing bubble byte-identical on the wire,
 * and it is asserted rather than assumed. A quoted message the room no longer
 * holds also gets no key, so the console keeps the stand-in it already draws.
 * แถวที่ไม่ได้ quote ต้องกลับไปเหมือนเดิมเป๊ะ.
 */
export async function withQuotedPreviews<
  T extends { quoted_provider_msg_id?: string | null },
>(
  messages: Model<ChatMessageDocument>,
  roomId: Types.ObjectId | string,
  rows: T[],
): Promise<Array<T | (T & { quoted_preview: QuotedPreview })>> {
  const previews = await resolveQuotedPreviews(messages, roomId, rows);
  if (previews.size === 0) return rows;
  return rows.map((row) => {
    const quoted = row.quoted_provider_msg_id
      ? previews.get(row.quoted_provider_msg_id)
      : undefined;
    return quoted ? { ...row, quoted_preview: quoted } : row;
  });
}

/**
 * The newest inbound row in the room whose reply token can still possibly work:
 * present, younger than 60 s, and not already spent by us. Every rule is IN the
 * query (an index-friendly single read), none is a JS filter after a broad fetch.
 * `now` is a parameter so the spec can pin the boundary without a clock.
 */
export async function findReplyCandidate(
  messages: Model<ChatMessageDocument>,
  roomId: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<{ replyToken: string; rowId: string } | null> {
  const row = (await messages
    .findOne({
      room_id: roomId,
      sender_type: 'customer',
      reply_token: { $nin: [null, ''] },
      reply_token_used_at: { $exists: false },
      created_at: { $gte: new Date(now.getTime() - REPLY_TOKEN_TTL_MS) },
    })
    .sort({ created_at: -1 })
    .select('reply_token')
    .lean()) as { _id: unknown; reply_token?: string } | null;
  if (!row?.reply_token) return null;
  return { replyToken: row.reply_token, rowId: String(row._id) };
}

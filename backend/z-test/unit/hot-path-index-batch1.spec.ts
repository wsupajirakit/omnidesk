/**
 * [PERF-20260824-IDXBATCH1] Six additive indexes for the hot ticket + webhook
 * lanes, pinned by SHAPE.
 *
 * WHY THIS SPEC EXISTS: an index defect is invisible to every other test in the
 * repo, because the RESULT of the query is always correct — only its cost is
 * wrong. `ticket-image-index.spec.ts` was written for exactly that reason and
 * this file follows it: assert the declared key ORDER, not merely that the field
 * names appear somewhere. For a compound index the order IS the behaviour — an
 * equality field after a range/sort field cannot be seeked, so a "present"
 * index with the keys transposed buys nothing.
 *
 * Each block also PINS the pre-existing index it sits beside. These six are
 * additive by design; if a later edit reshapes an old one to "tidy up", the
 * plan of a query nobody was thinking about changes silently.
 *
 * DB-EFFECT of what this guards: additive only — no field, no value, no
 * migration. See each schema's own note for the matching dropIndex() line.
 */
import { AssignHistorySchema, ChatMessageSchema } from '@/modules/chat';
import { WebhookLogSchema } from '@/modules/system';
import { TicketSchema } from '@/modules/tickets';

type IndexDecl = [Record<string, number | string>, Record<string, unknown>?];

const declared = (schema: { indexes: () => unknown }): IndexDecl[] =>
  schema.indexes() as IndexDecl[];

/** The index whose keys are EXACTLY these, in this order. */
const withKeys = (rows: IndexDecl[], keys: string[]): IndexDecl | undefined =>
  rows.find((i) => {
    const k = Object.keys(i[0]);
    return k.length === keys.length && k.every((name, n) => name === keys[n]);
  });

/** Any index that merely STARTS with these keys — used for the PIN cases. */
const startsWith = (rows: IndexDecl[], keys: string[]): IndexDecl | undefined =>
  rows.find((i) => {
    const k = Object.keys(i[0]);
    return keys.every((name, n) => k[n] === name);
  });

describe('[IDXBATCH1] chat_messages — the report scan and the last-sender lookup', () => {
  const rows = () => declared(ChatMessageSchema);

  it('(T1) { hook_id, created_at } exists — equality first, range second', () => {
    const idx = withKeys(rows(), ['hook_id', 'created_at']);
    expect(idx).toBeDefined();
    // Reversed, this index cannot serve the daily report: a range key in front
    // of an equality key means the equality can only be a residual filter.
    expect(Object.keys(idx![0])[0]).toBe('hook_id');
    expect(idx![0]['created_at']).toBe(-1);
  });

  it('(T2) { room_id, sender_type, created_at } exists in that order', () => {
    const idx = withKeys(rows(), ['room_id', 'sender_type', 'created_at']);
    expect(idx).toBeDefined();
    expect(idx![0]['created_at']).toBe(-1);
  });

  it('(T3) both are background:true — a boot-time build must not block writes', () => {
    expect(
      withKeys(rows(), ['hook_id', 'created_at'])?.[1]?.['background'],
    ).toBe(true);
    expect(
      withKeys(rows(), ['room_id', 'sender_type', 'created_at'])?.[1]?.[
        'background'
      ],
    ).toBe(true);
  });

  it('(P1 PIN) the thread view and the ticket-image indexes are untouched', () => {
    expect(withKeys(rows(), ['room_id', 'created_at'])).toBeDefined();
    expect(
      withKeys(rows(), ['room_id', 'message_type', 'created_at']),
    ).toBeDefined();
  });
});

describe('[IDXBATCH1] tickets — "this member’s latest ticket on this hook"', () => {
  const rows = () => declared(TicketSchema);

  it('(T4) { chat_user_id, hook_id, created_at } exists in that order', () => {
    const idx = withKeys(rows(), ['chat_user_id', 'hook_id', 'created_at']);
    expect(idx).toBeDefined();
    expect(idx![0]['created_at']).toBe(-1);
    expect(idx![1]?.['background']).toBe(true);
  });

  it('(P2 PIN) the list and cursor compounds still lead hook_id, job_status', () => {
    // The new index exists because this one canNOT serve a query that omits
    // job_status. Reshaping it would move that boundary without warning.
    expect(
      startsWith(rows(), ['hook_id', 'job_status', 'created_at']),
    ).toBeDefined();
    expect(
      withKeys(rows(), ['hook_id', 'job_status', 'created_at', '_id']),
    ).toBeDefined();
  });
});

describe('[IDXBATCH1] assign_histories — the ticket-list history batch', () => {
  const rows = () => declared(AssignHistorySchema);

  it('(T5) { ticket_id, created_at } exists — seek and sort from one index', () => {
    const idx = withKeys(rows(), ['ticket_id', 'created_at']);
    expect(idx).toBeDefined();
    expect(idx![0]['created_at']).toBe(-1);
    expect(idx![1]?.['background']).toBe(true);
  });

  it('(P3 PIN) the standalone created_at index is still declared', () => {
    expect(withKeys(rows(), ['created_at'])).toBeDefined();
  });
});

describe('[IDXBATCH1] webhook_logs — the two scope filters, each paired with the sort', () => {
  const rows = () => declared(WebhookLogSchema);

  it('(T6) { group_id, created_at } exists — the scope EVERY non-superuser sends', () => {
    const idx = withKeys(rows(), ['group_id', 'created_at']);
    expect(idx).toBeDefined();
    expect(idx![0]['created_at']).toBe(-1);
    expect(idx![1]?.['background']).toBe(true);
  });

  it('(T7) { hook_id, created_at } exists', () => {
    const idx = withKeys(rows(), ['hook_id', 'created_at']);
    expect(idx).toBeDefined();
    expect(idx![0]['created_at']).toBe(-1);
    expect(idx![1]?.['background']).toBe(true);
  });

  it('(P4 PIN) the TTL index is still declared with its expiry — retention is not collateral', () => {
    const ttl = rows().find((i) => i[1]?.['expireAfterSeconds'] !== undefined);
    expect(ttl).toBeDefined();
    expect(Object.keys(ttl![0])[0]).toBe('created_at');
  });

  it('(P5 PIN) the three filter compounds that already existed are unchanged', () => {
    expect(withKeys(rows(), ['status', 'created_at'])).toBeDefined();
    expect(withKeys(rows(), ['log_source', 'created_at'])).toBeDefined();
    expect(withKeys(rows(), ['action_type', 'created_at'])).toBeDefined();
  });
});

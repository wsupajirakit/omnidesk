import { readFileSync } from 'fs';
import { join } from 'path';

import { buildIncomingDeliveryRow } from '../../src/modules/webhook/logging/incoming-delivery-row';
import { errText } from '../../src/modules/webhook/logging/coerce-mask.util';
import { tsFilesUnder } from '../lib/source-census';

const ROOT = join(__dirname, '../..');

/**
 * [PROG-20260905-INROW] The `incoming_line_webhook` row, after it moved into `logging/`.
 *
 * WHAT IS AT STAKE. This is the first row written on every LINE delivery and the one an
 * incident opens first. [RULER-20260815-WLOGGOLDEN] freezes its field set and its values
 * byte-for-byte, so the move had to be a move: same keys, same order, same coercions. The
 * golden effect transcripts already prove that end-to-end; these cases prove it at the
 * unit, where a failure names the field instead of printing a diff of a whole turn.
 */
describe('[PROG-20260905-INROW] the inbound delivery row', () => {
  const meta = { method: 'POST', originalUrl: '/webhook/acme' };
  const body = { events: [{ type: 'message' }, { type: 'follow' }] };

  it('carries the nine keys, in the order the stored document has them', () => {
    // Order is asserted as a LIST, not a set: WLOGDOOR chose this order so the document
    // stayed byte-identical when the typed door landed, and a "tidy" reorder would undo
    // that silently. คีย์ต้องเรียงเหมือนเดิม
    const row = buildIncomingDeliveryRow({
      hook: { _id: 'h1', group: 'g1' },
      alias: 'acme',
      meta,
      body,
    });
    expect(Object.keys(row)).toEqual([
      'hook_id',
      'hook_alias',
      'group_id',
      'channel',
      'action_type',
      'method',
      'endpoint',
      'status',
      'raw_request',
    ]);
    expect(row).toMatchObject({
      hook_id: 'h1',
      hook_alias: 'acme',
      group_id: 'g1',
      channel: 'webhook',
      action_type: 'incoming_line_webhook',
      method: 'POST',
      endpoint: '/webhook/acme',
      status: 'success',
    });
  });

  it('stores the WHOLE delivery body by reference, not a copy and not one event', () => {
    /* Reference equality on purpose. The row is the only record of what LINE actually
       sent; a builder that rebuilt or trimmed the body would make the stored payload a
       summary of the delivery instead of the delivery. It is also what makes the
       one-row-per-delivery accounting true once the multi-event loop suppresses the row
       for every event after the first. */
    const row = buildIncomingDeliveryRow({ meta, body });
    expect(row['raw_request']).toBe(body);
    expect((row['raw_request'] as typeof body).events).toHaveLength(2);
  });

  it('survives an unresolved alias — no hook, no group, and still a row', () => {
    // The 404-unknown-alias path writes this row BEFORE it gives up, and that row is the
    // only evidence the delivery arrived at all. A builder that threw on a missing hook
    // would erase the one trace of a misrouted webhook.
    const row = buildIncomingDeliveryRow({ alias: 'ghost', meta, body });
    expect(row['hook_id']).toBeUndefined();
    expect(row['group_id']).toBeUndefined();
    expect(row['hook_alias']).toBe('ghost');
    expect(row['action_type']).toBe('incoming_line_webhook');
  });

  it('coerces the ids the way the spine did — ObjectId-like values become strings', () => {
    // `asString` is the same helper the literal used; the row must never carry a raw
    // ObjectId, because the dashboard filters these fields as strings.
    const row = buildIncomingDeliveryRow({
      hook: {
        _id: { toString: () => 'oid-1' },
        group: { toString: () => 'oid-2' },
      },
      meta,
      body,
    });
    expect(row['hook_id']).toBe('oid-1');
    expect(row['group_id']).toBe('oid-2');
  });
});

/**
 * [PROG-20260905-ROOMFILTER] One `buildRoomFilter`, module-wide.
 *
 * WHY THIS CENSUS EXISTS AND WHY IT IS NOT PARANOIA. There were FOUR copies of that
 * function, and three of them were created by this reduction program: a role file cannot
 * call a module-private function in the service, and importing back from the service is a
 * cycle, so every extraction that needed the filter copied it. The consolidation is only
 * worth anything if the next extraction imports it instead of copying it again — and the
 * next extraction will be written by someone who cannot see this decision. So the rule is
 * a test, not a comment. ถ้าไม่มีด่าน เดี๋ยวก็กลับมาสี่ก๊อปปี้เหมือนเดิม
 *
 * The `$or` is the reason it matters: `chat_rooms` carries the customer id under
 * `channel_user_id` on newer rows and `line_user_id` on older ones. A copy "tidied" to one
 * field finds half the rooms and answers "no room" for the rest — a legal answer
 * everywhere this is used, which is what makes the bug silent.
 */
describe('[PROG-20260905-ROOMFILTER] the room filter has exactly one home', () => {
  const OWNER = 'src/modules/webhook/room-bootstrap/room-filter.ts';

  const moduleFiles = tsFilesUnder(ROOT, 'src/modules/webhook');
  const readRel = (rel: string): string =>
    readFileSync(join(ROOT, rel), 'utf8');

  it('is declared once in the whole webhook module', () => {
    const declarers = moduleFiles.filter((rel) =>
      /(?:function|const)\s+buildRoomFilter\b/.test(readRel(rel)),
    );
    // The failure message IS the finding: jest prints the paths, so a new copy names
    // itself instead of leaving the next person to grep for it.
    expect(declarers).toEqual([OWNER]);
  });

  it('every file that queries chat_rooms by user id goes through it', () => {
    /* The other half of the rule. A file could stop declaring its own copy and instead
       inline the `$or` at the call site — same duplication, different spelling. Nobody
       outside the owner may spell the filter at all. */
    const inliners = moduleFiles.filter(
      (rel) =>
        rel !== OWNER && readRel(rel).includes('{ channel_user_id: userId }'),
    );
    expect(inliners).toEqual([]);
  });

  it('the one copy still matches BOTH id spellings', () => {
    // The census above only proves there is one. This proves the one is right — otherwise
    // consolidating four correct copies into one wrong one would pass every case here.
    const src = readRel(OWNER);
    expect(src).toContain('channel_user_id');
    expect(src).toContain('line_user_id');
    expect(src).toContain('$or');
  });
});

/**
 * [PROG-20260905-ERRTEXT] One `errText`, module-wide — the same census as the room filter,
 * for the same reason and at four times the scale.
 *
 * It had TWELVE copies: the service plus eleven role files, ten of them created by this
 * reduction program. A role file cannot call a module-private helper and importing back
 * from the service is a cycle, so every extraction carried the two lines along. All twelve
 * were byte-identical in behaviour — verified before any was removed — which is precisely
 * why nobody noticed. Duplication that never diverges is invisible until the day it does.
 *
 * The rule is a test rather than a comment because the NEXT extraction will be written by
 * someone who cannot see this decision, and the cheapest thing for them to do is copy the
 * two lines again. ถ้าไม่มีด่าน เดี๋ยวก็กลับมาสิบสองก๊อปปี้
 */
describe('[PROG-20260905-ERRTEXT] the error-message coercion has exactly one home', () => {
  const OWNER = 'src/modules/webhook/logging/coerce-mask.util.ts';

  it('is declared once in the whole webhook module', () => {
    const declarers = tsFilesUnder(ROOT, 'src/modules/webhook').filter((rel) =>
      /(?:function|const)\s+errText\b/.test(
        readFileSync(join(ROOT, rel), 'utf8'),
      ),
    );
    // The failure message IS the finding: jest prints the paths, so a new copy names itself.
    expect(declarers).toEqual([OWNER]);
  });

  it('the one copy still answers for a non-Error throw', () => {
    /* Totality is the property worth keeping. Every caller is a catch block reporting a
       failure; a coercion that threw on a string or on `undefined` would fail inside the
       handler that was supposed to explain what went wrong. */
    expect(errText(new Error('boom'))).toBe('boom');
    expect(errText('plain string')).toBe('plain string');
    expect(errText(undefined)).toBe('undefined');
    expect(errText({ code: 500 })).toBe('[object Object]');
  });
});

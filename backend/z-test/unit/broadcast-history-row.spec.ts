/**
 * [FEAT-20260822-BCASTHISTROW] The row that gets read back months later.
 * ===========================================================================
 * Every number here is one somebody will trust without being able to re-run
 * the campaign. The cases that matter are the ones where a wrong number would
 * still LOOK reasonable.
 */
import {
  buildHistoryRow,
  buildHistoryRows,
  countersForOa,
  SEND_MATRIX,
  RECIPIENT_CAPTURE,
  type OaOutcome,
} from '@/modules/content';

const START = new Date('2026-08-22T10:00:00.000Z');
const END = new Date('2026-08-22T10:04:00.000Z');

const input = {
  broadcastId: 'b1',
  runId: 'run1',
  broadcastName: 'โปรเดือนสิงหา',
  cell: SEND_MATRIX['multicast:plain'],
  triggeredBy: 'manual' as const,
  triggeredByName: 'แอดมิน',
  startedAt: START,
  finishedAt: END,
  recipientsCaptured: RECIPIENT_CAPTURE,
};

const oa = (over: Partial<OaOutcome> = {}): OaOutcome => ({
  index: 0,
  hookId: 'h1',
  counters: {
    ...countersForOa(500, 1),
    sent: 500,
    unsent: 0,
    requestsMade: 1,
    chunksDone: 1,
  },
  resume: { hookId: 'h1', afterId: 'm500', nextChunkIndex: 1 },
  unknownTags: [],
  imagesMeasured: true,
  ...over,
});

describe('buildHistoryRow — the counts', () => {
  it('carries every count under its stored name', () => {
    const row = buildHistoryRow(input, oa());
    expect(row).toMatchObject({
      broadcast_id: 'b1',
      run_id: 'run1',
      hook_id: 'h1',
      send_kind: 'multicast',
      card_type: 'plain',
      targeted: 500,
      sent: 500,
      failed: 0,
      requests_made: 1,
      status: 'success',
    });
  });

  it('🔴 keeps the resume point, so a restart does not start over', () => {
    const row = buildHistoryRow(input, oa());
    expect(row.resume_after_id).toBe('m500');
    expect(row.next_chunk_index).toBe(1);
  });

  it('omits resume_after_id on an OA that never advanced', () => {
    const row = buildHistoryRow(
      input,
      oa({ resume: { hookId: 'h1', afterId: null, nextChunkIndex: 0 } }),
    );
    expect(row).not.toHaveProperty('resume_after_id');
    expect(row.next_chunk_index).toBe(0);
  });

  it('records the stop reason when one stopped it', () => {
    const row = buildHistoryRow(input, oa({ stoppedBy: 'rate-limited' }));
    expect(row.stop_reason).toBe('rate-limited');
    expect(row.status).toBe('stopped');
  });

  it('says partial when some landed and some did not', () => {
    const row = buildHistoryRow(
      input,
      oa({
        counters: {
          ...countersForOa(500, 1),
          sent: 300,
          failed: 200,
          unsent: 0,
        },
      }),
    );
    expect(row.status).toBe('partial');
  });

  it('🔴 tells "refused" apart from "matched nobody" — both are all zeroes', () => {
    /* A run stopped by a ceiling and a run whose audience was empty are
       identical in every count, and mean opposite things to whoever reads the
       row later. `refused` is therefore passed in, never inferred.
       ศูนย์เพราะโดนปฏิเสธ กับ ศูนย์เพราะไม่มีใครเข้าเงื่อนไข ต้องแยกออก.

       ⚠️ "matched nobody" reports `success` — settled in `run-counters.ts`
       (nothing to do is not a failure) and pinned by the contracts spec. The
       row stays readable because `targeted: 0` is right there next to it. */
    const empty = oa({ counters: countersForOa(0, 0) });
    const nobody = buildHistoryRow(input, empty);
    const refused = buildHistoryRow(input, empty, { refused: true });

    expect(nobody.status).toBe('success');
    expect(nobody.targeted).toBe(0);
    expect(refused.status).toBe('refused');
    expect(nobody.status).not.toBe(refused.status);
  });
});

describe('buildHistoryRow — what is deliberately NOT in it', () => {
  it('🔴 stores no recipient ids anywhere in the row', () => {
    const row = buildHistoryRow(input, oa());
    const text = JSON.stringify(row);
    expect(text).not.toContain('U1');
    expect(Object.keys(row)).not.toContain('recipients');
    expect(Object.keys(row)).not.toContain('recipient_ids');
  });

  it('🔴 leaves images_replaced OUT when nothing looked at the pictures', () => {
    /* `0` reads as "every picture was fine". A preview renders nothing, so it
       measured nothing — and the row must say that by not carrying the field
       at all. ไม่มี field = ไม่ได้วัด · มี field เป็น 0 = วัดแล้วไม่มีปัญหา. */
    const measured = buildHistoryRow(input, oa());
    const notMeasured = buildHistoryRow(input, oa({ imagesMeasured: false }));

    expect(measured.images_replaced).toBe(0);
    expect(notMeasured).not.toHaveProperty('images_replaced');
  });

  it('records WHICH capture switches were on, so future rows are tellable apart', () => {
    const row = buildHistoryRow(input, oa());
    expect(row.recipients_captured).toEqual(RECIPIENT_CAPTURE);
    expect(Object.values(row.recipients_captured as object)).not.toContain(
      true,
    );
  });

  it('does not alias the capture object it was handed', () => {
    const captured = { ...RECIPIENT_CAPTURE };
    const row = buildHistoryRow(
      { ...input, recipientsCaptured: captured },
      oa(),
    );
    (row.recipients_captured as Record<string, boolean>).matched = true;
    expect(captured).toEqual(RECIPIENT_CAPTURE);
  });

  it('leaves optional fields out rather than storing empty strings', () => {
    const row = buildHistoryRow(
      { ...input, broadcastName: undefined, triggeredByName: undefined },
      oa(),
    );
    expect(row).not.toHaveProperty('broadcast_name');
    expect(row).not.toHaveProperty('triggered_by_name');
    expect(row).not.toHaveProperty('stop_reason');
  });
});

describe('a human reading the log must not be pointed at the wrong OA', () => {
  it('🔴 each row carries ITS OWN OA name, not the first one', () => {
    /* This was a single run-level `hookAlias` copied onto every row, so a
       three-OA run wrote three rows all naming the first OA. Reading that back,
       somebody blames the wrong channel for a stop that happened elsewhere —
       the exact opposite of what a log is for.
       ชื่อ OA ต้องเป็นราย OA — ค่าเดียวใช้ทุกแถว = log ที่ชี้ผิดตัว. */
    const rows = buildHistoryRows(
      { ...input, hookAliases: { h1: 'OA หลัก', h2: 'OA สำรอง' } },
      [oa(), oa({ index: 1, hookId: 'h2', stoppedBy: 'rate-limited' })],
    );

    expect(rows[0]?.hook_alias).toBe('OA หลัก');
    expect(rows[1]?.hook_alias).toBe('OA สำรอง');
    // และแถวที่หยุด ต้องบอกเหตุผลคู่กับชื่อที่ถูกตัว
    expect(rows[1]?.stop_reason).toBe('rate-limited');
  });

  it('an OA with no known name gets no name — never a neighbour’s', () => {
    const rows = buildHistoryRows(
      { ...input, hookAliases: { h1: 'OA หลัก' } },
      [oa(), oa({ index: 1, hookId: 'h2' })],
    );
    expect(rows[0]?.hook_alias).toBe('OA หลัก');
    expect(rows[1]).not.toHaveProperty('hook_alias');
  });

  it('🔴 the row says WHY it stopped in a word, not just that it failed', () => {
    /* `failed` alone cannot tell a quota apart from a deadline apart from a
       broken pager, and those need three different responses from an operator. */
    for (const reason of ['rate-limited', 'deadline', 'stalled-pager']) {
      const row = buildHistoryRow(input, oa({ stoppedBy: reason as never }));
      expect(row.stop_reason).toBe(reason);
      expect(row.status).toBe('stopped');
    }
  });
});

describe('the story: an operator reads the log and blames the wrong OA', () => {
  /* Written from the failure, not from the function. A three-OA run where the
     SECOND one hits a quota: what does somebody see tomorrow morning? */

  it('🔴 each row carries ITS OWN OA name', () => {
    /* `hookAlias` was one run-level string copied onto every row, so all three
       rows named the first OA. The operator reads "OA หลัก — rate-limited" and
       goes to check a channel that was fine.
       ชื่อ OA ต้องเป็นราย OA — ค่าเดียวใช้ทุกแถว = log ที่ชี้ผิดตัว. */
    const rows = buildHistoryRows(
      { ...input, hookAliases: { h1: 'OA หลัก', h2: 'OA สำรอง' } },
      [oa(), oa({ index: 1, hookId: 'h2', stoppedBy: 'rate-limited' })],
    );

    expect(rows[0]?.hook_alias).toBe('OA หลัก');
    expect(rows[1]?.hook_alias).toBe('OA สำรอง');
    // the name and the reason have to be on the SAME row to be readable
    expect(rows[1]?.stop_reason).toBe('rate-limited');
    expect(rows[0]).not.toHaveProperty('stop_reason');
  });

  it('an OA with no known name gets none — never a neighbour’s', () => {
    const rows = buildHistoryRows(
      { ...input, hookAliases: { h1: 'OA หลัก' } },
      [oa(), oa({ index: 1, hookId: 'h2' })],
    );
    expect(rows[0]?.hook_alias).toBe('OA หลัก');
    expect(rows[1]).not.toHaveProperty('hook_alias');
  });

  it('🔴 the row says WHY in a word — `failed` alone is not an answer', () => {
    /* A quota, a deadline and a broken pager need three different responses
       from whoever is on call. โทษต่างกัน ต้องอ่านออกว่าเป็นอันไหน. */
    for (const reason of ['rate-limited', 'deadline', 'stalled-pager']) {
      const row = buildHistoryRow(input, oa({ stoppedBy: reason as never }));
      expect(row.stop_reason).toBe(reason);
      expect(row.status).toBe('stopped');
    }
  });

  it('one run_id ties the rows together, so the whole picture is readable', () => {
    const rows = buildHistoryRows(
      { ...input, hookAliases: { h1: 'A', h2: 'B', h3: 'C' } },
      [
        oa(),
        oa({ index: 1, hookId: 'h2', stoppedBy: 'rate-limited' }),
        oa({ index: 2, hookId: 'h3' }),
      ],
    );
    // same run, three channels, and only the middle one stopped
    expect(new Set(rows.map((r) => r.run_id)).size).toBe(1);
    expect(rows.filter((r) => r.stop_reason).map((r) => r.hook_alias)).toEqual([
      'B',
    ]);
  });
});

describe('buildHistoryRows — one row per OA', () => {
  it('🔴 writes a row for EVERY OA, each with its own numbers', () => {
    const rows = buildHistoryRows(input, [
      oa(),
      oa({
        index: 1,
        hookId: 'h2',
        counters: { ...countersForOa(200, 1), failed: 200, unsent: 0 },
        stoppedBy: 'rate-limited',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.hook_id)).toEqual(['h1', 'h2']);
    expect(rows[0]?.status).toBe('success');
    expect(rows[1]?.status).toBe('stopped');
    expect(rows[1]?.sent).toBe(0);
    // ทุกแถวใช้ run_id เดียวกัน ⇒ query กลับมารวมเป็นรอบเดียวได้
    expect(new Set(rows.map((r) => r.run_id)).size).toBe(1);
  });

  it('returns nothing when no OA ran', () => {
    expect(buildHistoryRows(input, [])).toEqual([]);
  });
});

describe('[FEAT-20260823-BCASTHISTTAGS] unknown_tags on the written row', () => {
  it('🔴 a run that rendered nothing writes NO unknown_tags', () => {
    /* Same gate as `images_replaced`, same reason: `[]` would claim every tag
       resolved on a run that never looked at one. */
    const row = buildHistoryRow(
      input,
      oa({ imagesMeasured: false, unknownTags: [] }),
    );
    expect(row).not.toHaveProperty('unknown_tags');
  });

  it('🔴 a run that DID render writes them, empty array included', () => {
    const clean = buildHistoryRow(
      input,
      oa({ imagesMeasured: true, unknownTags: [] }),
    );
    expect(clean).toHaveProperty('unknown_tags');
    expect(clean['unknown_tags']).toEqual([]);

    const dirty = buildHistoryRow(
      input,
      oa({ imagesMeasured: true, unknownTags: ['profile.bank_code'] }),
    );
    expect(dirty['unknown_tags']).toEqual(['profile.bank_code']);
  });

  it('🔴 tag NAMES only — no value and no recipient id can ride along', () => {
    /* A tag name is configuration the admin typed; what it resolved to for one
       person is that person\'s data. `recipient-ledger.ts` is the rule that
       keeps such things out of a history row. เก็บชื่อ tag ไม่เก็บค่า. */
    const row = buildHistoryRow(
      input,
      oa({ imagesMeasured: true, unknownTags: ['profile.bank_code'] }),
    );
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/U[0-9a-f]{32}/);
    expect(row['unknown_tags']).toEqual(['profile.bank_code']);
  });
});

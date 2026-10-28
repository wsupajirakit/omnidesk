/**
 * [FEAT-20260824-RUNSNAPSHOT] The history remembers what the job was SET TO.
 *
 * Owner, 24/08: *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail ที่รัน
 * เงื่อนไขทั้งหมด ว่าตอนนั้น job ตั้งอะไรไว้"* · *"1 job มันส่งได้หลายครั้ง"*.
 */
import {
  HISTORY_READ_COLUMNS,
  buildHistoryRow,
  toHistoryReadRow,
} from '@/modules/content/broadcast-history';
import { SEND_MATRIX } from '@/modules/content/broadcast-send';

const SNAPSHOT = {
  target: { mode: 'all', match: 'and', rules: [{ key: 'display_name' }] },
  schedule: { mode: 'repeat', every_minutes: 10 },
  message_flex_id: 'card-1',
  hook_ids: ['h1', 'h2'],
};

const base = {
  broadcastId: 'job-1',
  runId: 'run-1',
  cell: SEND_MATRIX['multicast:plain'],
  triggeredBy: 'scheduler' as const,
  startedAt: new Date('2026-08-24T09:00:00.000Z'),
  finishedAt: new Date('2026-08-24T09:00:05.000Z'),
  recipientsCaptured: {},
};

const oa = {
  index: 0,
  hookId: 'h1',
  counters: {
    matched: 3,
    targeted: 3,
    sent: 3,
    failed: 0,
    unsent: 0,
    requestsPlanned: 1,
    requestsMade: 1,
    chunksPlanned: 1,
    chunksDone: 1,
  },
  unknownTags: [],
  imagesMeasured: false,
  resume: { afterId: null, chunkIndex: 0 },
} as never;

describe('the run row freezes the campaign settings', () => {
  it('🔴 writes what it was handed', () => {
    const row = buildHistoryRow({ ...base, settingsSnapshot: SNAPSHOT }, oa, {
      refused: false,
    });
    expect(row.settings_snapshot).toEqual(SNAPSHOT);
  });

  it('🔴 a run with none carries NO key — absent ≠ ตั้งค่าว่าง', () => {
    /* A round recorded before this feature must read as "not captured", not as
       "this campaign had no conditions" — the second would be a lie about who
       it reached. */
    const row = buildHistoryRow(base, oa, { refused: false });
    expect(row).not.toHaveProperty('settings_snapshot');
  });
});

describe('the read side hands it back', () => {
  it('🔴 it is in the column whitelist — stored but unlisted means invisible', () => {
    /* `broadcast_name` was stored from day one and left out of this list, so no
       history view could name the campaign it belonged to. Same trap. */
    expect(HISTORY_READ_COLUMNS).toHaveProperty('settings_snapshot');
  });

  it('comes back on the row', () => {
    const out = toHistoryReadRow({
      run_id: 'run-1',
      settings_snapshot: SNAPSHOT,
    });
    expect(out.settings_snapshot).toEqual(SNAPSHOT);
  });

  it('🔴 stays absent when the stored row has none', () => {
    expect(toHistoryReadRow({ run_id: 'run-1' })).not.toHaveProperty(
      'settings_snapshot',
    );
  });
});

describe('what it deliberately does NOT duplicate', () => {
  it('🔴 no `send_kind` / `card_type` inside the snapshot', () => {
    /* Both already have their own columns. Two answers to one question is how a
       log starts contradicting itself, and nobody can tell which half is true.
       มีคอลัมน์ของตัวเองแล้ว ห้ามเก็บซ้ำ. */
    expect(SNAPSHOT).not.toHaveProperty('send_kind');
    expect(SNAPSHOT).not.toHaveProperty('card_type');
    expect(HISTORY_READ_COLUMNS).toHaveProperty('send_kind');
    expect(HISTORY_READ_COLUMNS).toHaveProperty('card_type');
  });
});

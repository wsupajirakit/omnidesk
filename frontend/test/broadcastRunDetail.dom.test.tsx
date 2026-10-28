/**
 * [FEAT-20260824-RUNDETAIL] The per-round modal — the three claims it must not break.
 * ===========================================================================
 * Owner 24/08: *"ต้องแสดงทั้ง history + webhook log จะได้ครบ แต่ว่าทำเป็น modal กดดู"*
 * and *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail ที่รัน เงื่อนไขทั้งหมด"*.
 *
 * Every case below defends a SENTENCE, not a layout — each one is a place where
 * a silent blank would be read by an admin as a different, false fact:
 *
 *  1. `logsExpired` → "log หมดอายุแล้ว (เก็บ 45 วัน)". An empty log list with no
 *     words reads as "รอบนี้ไม่ได้ส่ง", which is the opposite of the truth for
 *     every round older than the 45-day TTL. And `logsError` is a DIFFERENT
 *     thing — the read failed — so the two must never share wording.
 *  2. `settings_snapshot` absent → "รอบนี้บันทึกก่อนมีฟีเจอร์นี้". `absent ≠
 *     ไม่ได้ตั้งเงื่อนไข`; a blank panel claims the second.
 *  3. สรุปรอบ and LINE log are SEPARATE sections. A history row is one
 *     (round × OA); a log row is one HTTP request. Merging them invents a
 *     cardinality neither has and hides retries entirely.
 *
 * 🌐 EVERY RENDER GOES THROUGH `I18nProvider`, and the assertions still read the
 *    Thai sentences — because the words now come from `i18n/translations/*.json`
 *    and the failure this guards against is a MISSING key rendering as the raw
 *    `broadcast.run_…` string on the admin's screen. คีย์หายต้องแดง ไม่ใช่โผล่บนจอ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react';

const getBroadcastRunDetail = vi.fn();
const getBroadcastHistory = vi.fn();

vi.mock('../services/messaging', () => ({
  broadcastService: {
    getBroadcastRunDetail: (...a: unknown[]) => getBroadcastRunDetail(...a),
    getBroadcastHistory: (...a: unknown[]) => getBroadcastHistory(...a),
  },
}));
/* I18nProvider reads the locale from preferences at mount — stub the two
   functions it imports or the provider throws on the first render.
   ไม่ stub = provider พังตั้งแต่ render แรก */
vi.mock('../services/admin', () => ({
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import {
  BroadcastRunDetailModal,
  BroadcastRunHistoryPanel,
  RunLogSection,
  RunSettingsSection,
  logsNotice,
  snapshotOf,
  unknownTagsLabel,
  groupRuns,
} from '../components/campaign/history';
import type { TranslateFn } from '../components/campaign/history';
import { I18nProvider, useI18n } from '../i18n';
import th from '../i18n/translations/th.json';
import en from '../i18n/translations/en.json';
import zh from '../i18n/translations/zh.json';
import type { BroadcastEntry, BroadcastRunRow, BroadcastRunDetail } from '../types';

/** Everything on this screen is mounted the way the app mounts it. */
const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

/**
 * The REAL `t` — captured out of the provider rather than reimplemented, so a
 * unit call on a pure formatter resolves and interpolates exactly as the screen
 * does. ใช้ t ตัวจริง ไม่เขียนเลียนแบบ.
 */
const realT = (): TranslateFn => {
  let fn: TranslateFn = k => k;
  const Probe: React.FC = () => {
    fn = useI18n().t;
    return null;
  };
  render(<I18nProvider><Probe /></I18nProvider>);
  return (k, v) => fn(k, v);
};

const row = (over: Partial<BroadcastRunRow> = {}): BroadcastRunRow => ({
  run_id: 'run-1',
  hook_id: 'h1',
  hook_alias: 'omnideskdevoa',
  send_kind: 'broadcast',
  card_type: 'plain',
  matched: 0,
  targeted: 1,
  sent: 1,
  failed: 0,
  unsent: 0,
  requests_planned: 1,
  requests_made: 1,
  chunks_planned: 1,
  chunks_done: 1,
  status: 'success',
  started_at: '2026-08-24T03:00:00.000Z',
  finished_at: '2026-08-24T03:00:02.000Z',
  ...over,
});

const detail = (over: Partial<BroadcastRunDetail> = {}): BroadcastRunDetail => ({
  run_id: 'run-1',
  rows: [row()],
  logs: [],
  logsExpired: false,
  ...over,
});

beforeEach(() => {
  getBroadcastRunDetail.mockReset();
  getBroadcastHistory.mockReset();
  getBroadcastRunDetail.mockResolvedValue(detail());
  getBroadcastHistory.mockResolvedValue({ data: [row()], meta: { total: 1, page: 1, limit: 25 } });
});

/**
 * [UI-20260828-RUNFOLDED] เจ้าของ 28/08 สั่งให้ทุก section ของโมดัลนี้ **พับไว้**
 * ตอนเปิดมาครั้งแรก · body ถูก unmount ตอนพับ (ไม่ใช่ซ่อนด้วย CSS) ⇒ เนื้อในไม่มีอยู่
 * ใน DOM เลยจนกว่าจะกด
 *
 * ⚠️ ตัวช่วยนี้จึงรอ **หัว section** (mount เสมอ) แล้ว **กางทั้งสามอันให้** เคสข้างล่าง
 *    ที่เขียนไว้ก่อนหน้ายังวัดสิ่งเดิมทุกข้อ ไม่ต้องแก้ทีละเคส
 *    ⇒ ห้ามเปลี่ยนกลับไปรอ `run-summary` — นั่นคือเนื้อใน ซึ่งตอนนี้ยังไม่ถูก mount
 *    ⇒ กฎ "พับไว้ default" มีเคสของตัวเองแยกไว้ข้างล่าง (ห้ามพึ่งตัวช่วยนี้พิสูจน์)
 */
const openModal = async () => {
  const v = wrap(
    <BroadcastRunDetailModal isOpen broadcastId="b1" runId="run-1" onClose={() => {}} />
  );
  await waitFor(() => expect(v.queryByTestId('run-section-summary-toggle')).not.toBeNull());
  for (const id of ['summary', 'settings', 'logs']) {
    const toggle = v.queryByTestId(`run-section-${id}-toggle`);
    if (toggle && v.queryByTestId(`run-section-${id}-body`) === null) fireEvent.click(toggle);
  }
  await waitFor(() => expect(v.queryByTestId('run-summary')).not.toBeNull());
  return v;
};

describe('[UI-20260828-RUNFOLDED] โมดัลนี้เปิดมาต้องพับทุกส่วน', () => {
  it('⭐⭐ 🔴 เปิดโมดัลมาครั้งแรก ทั้งสาม section ไม่มี body อยู่ใน DOM', async () => {
    const v = wrap(
      <BroadcastRunDetailModal isOpen broadcastId="b1" runId="run-1" onClose={() => {}} />
    );
    /* รอให้ข้อมูลมาถึงจริงก่อน ไม่งั้นจะ "ว่าง" เพราะยังโหลดไม่เสร็จ ไม่ใช่เพราะพับ */
    await waitFor(() => expect(v.queryByTestId('run-section-logs-toggle')).not.toBeNull());
    for (const id of ['summary', 'settings', 'logs']) {
      expect(v.queryByTestId(`run-section-${id}-toggle`)).not.toBeNull();
      expect(v.queryByTestId(`run-section-${id}-body`)).toBeNull();
    }
  });

  it('⭐ กดหัวข้อแล้วกางได้ตามปกติ — พับไว้ ไม่ใช่ล็อกไว้', async () => {
    const v = wrap(
      <BroadcastRunDetailModal isOpen broadcastId="b1" runId="run-1" onClose={() => {}} />
    );
    await waitFor(() => expect(v.queryByTestId('run-section-logs-toggle')).not.toBeNull());
    fireEvent.click(v.getByTestId('run-section-logs-toggle'));
    expect(v.queryByTestId('run-section-logs-body')).not.toBeNull();
    /* อีกสองอันต้องยังพับอยู่ — พับ/กาง เป็นเอกเทศต่อ section เหมือนเดิม */
    expect(v.queryByTestId('run-section-summary-body')).toBeNull();
  });
});


/** เลือกแคมเปญผ่าน SearchableSelect — เปิดเมนูแล้วกดตัวเลือกที่ label ตรง
 *
 * ⚠️ 26/08 — เคสข้างล่างเคยเลือกด้วย **id** (`b1`) ซึ่งมองเห็นได้เพราะตัวเลือก
 *    เคยโชว์ id ต่อท้ายชื่อผ่าน `hint` · เจ้าของสั่งให้เอา id ออก เหลือแต่ชื่อ
 *    ⇒ เลือกด้วย **ชื่อแคมเปญ** แทน ซึ่งตรงกับสิ่งที่ผู้ใช้เห็นและกดจริงมากกว่าเดิม
 *    ถ้าวันหลังเคสนี้แดงเพราะหาตัวเลือกไม่เจอ ให้ดูก่อนว่าอะไรที่ผู้ใช้เห็นบนจอ
 *    ไม่ใช่เปลี่ยนไปเลือกด้วย id อีก */
const pickBroadcast = (v: any, label: string) => {
  const box = v.getByTestId('run-history-broadcast-select') as HTMLElement;
  fireEvent.click(box.querySelector('button') as HTMLElement);
  /* ⚠️ 26/08 [UI-20260826-PORTALMENU] — เมนูถูก render ผ่าน `createPortal` ไปที่
     `document.body` แล้ว จึง **ไม่ได้เป็นลูกของกล่องนี้อีกต่อไป** · ค้นจาก `box`
     อย่างเดียวจะหาไม่เจอและเคสจะแดงทั้งที่หน้าจอทำงานปกติ
     ⇒ ค้นทั้งเอกสาร แล้วกรองเอาเฉพาะปุ่มตัวเลือกที่อยู่ในเมนูจริง (`[data-drop-up]`)
     ถ้าวันหลังยกเลิก portal ให้กลับไปค้นจาก `box` ได้ตามเดิม */
  const menu = document.querySelector('[data-drop-up="yes"]') ?? box;
  const opt = Array.from(menu.querySelectorAll('li,button,[role="option"]')).find(
    el => (el.textContent || '').trim().includes(label),
  );
  fireEvent.click(opt as HTMLElement);
};

describe('🔴 logsExpired — the 45-day TTL took the logs, NOT the sending', () => {
  it('says the logs expired instead of showing an empty list', () => {
    const v = wrap(<RunLogSection logs={[]} logsExpired />);
    const notice = v.getByTestId('run-notice-expired');
    expect(notice.textContent).toContain('log หมดอายุแล้ว (เก็บ 45 วัน)');
    // 🔴 the disclaimer is the load-bearing half — without it the note still
    //    reads as "there is nothing here"
    expect(notice.textContent).toContain('ไม่ได้แปลว่ารอบนี้ไม่ได้ส่ง');
  });

  it('never leaves the empty list to speak for itself', () => {
    const v = wrap(<RunLogSection logs={[]} logsExpired />);
    /* 🔴 SOMETHING must be said. An empty section with no sentence is the
       failure mode this whole flag exists to prevent — the admin reads the
       blank as "รอบนี้ไม่ได้ส่ง". ห้ามปล่อยว่าง. */
    expect(v.queryByTestId('run-notice-expired')).not.toBeNull();
    expect(v.container.textContent).not.toContain('ไม่มีการส่ง');
    expect((v.container.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('🔴 logsError is a DIFFERENT thing and must not be worded as an expiry', () => {
    const v = wrap(<RunLogSection logs={[]} logsExpired={false} logsError="boom" />);
    const notice = v.getByTestId('run-notice-error');
    expect(notice.textContent).toContain('อ่าน LINE log ไม่สำเร็จ');
    expect(notice.textContent).toContain('boom');
    expect(v.queryByTestId('run-notice-expired')).toBeNull();
  });

  it('🔴 an error wins over an expiry — a failed read is not a healthy old round', () => {
    // the backend cannot send both today; the reader still must not guess wrong
    expect(logsNotice({ logsExpired: true, logsError: 'read failed' }, realT())?.kind).toBe('error');
  });

  it('shows no notice at all when there are real logs to read', () => {
    const v = wrap(
      <RunLogSection
        logs={[{ hook_alias: 'demo-oa-three', action_type: 'send_broadcast', status: 'success', status_code: 200, retries: 0, created_at: '2026-08-24T03:00:01.000Z' }]}
        logsExpired={false}
      />
    );
    expect(v.queryByTestId('run-notice-expired')).toBeNull();
    expect(v.queryByTestId('run-notice-error')).toBeNull();
    expect(v.container.textContent).toContain('demo-oa-three');
  });
});

describe('🔴 settings_snapshot absent — "ก่อนมีฟีเจอร์นี้", never a blank panel', () => {
  it('explains a missing snapshot in words', () => {
    const v = wrap(<RunSettingsSection rows={[row()]} />);
    const notice = v.getByTestId('run-snapshot-missing');
    expect(notice.textContent).toContain('รอบนี้บันทึกก่อนมีฟีเจอร์นี้');
    // 🔴 absent ≠ ไม่ได้ตั้งเงื่อนไข — the sentence must rule the second out
    expect(notice.textContent).toContain('ไม่ได้แปลว่าไม่ได้ตั้งเงื่อนไข');
    expect(v.queryByTestId('run-settings')).toBeNull();
  });

  it('renders the frozen conditions when the round DID capture them', () => {
    const v = wrap(
      <RunSettingsSection
        rows={[
          row({
            settings_snapshot: {
              target: { mode: 'all', group_ids: [], match: 'and', rules: [{ key: 'display_name', op: 'in', value: ['tttdev'] }] },
              schedule: { mode: 'repeat', every_minutes: 10, days_of_week: [0, 1, 2, 3, 4, 5, 6], window_start_min: 0, window_end_min: 1440, tz_offset_min: 420, max_runs: 9 },
              message_flex_id: 'a0d000000000000000000070',
              hook_ids: ['hook-1'],
            },
          }),
        ]}
      />
    );
    expect(v.queryByTestId('run-snapshot-missing')).toBeNull();
    const text = v.getByTestId('run-settings').textContent ?? '';
    expect(text).toContain('display_name in tttdev');
    expect(text).toContain('a0d000000000000000000070');
    expect(text).toContain('UTC+07:00');
    expect(text).toContain('ทุกวัน');
  });

  it('🔴 an empty object is NOT the same as absent — it is a captured snapshot', () => {
    expect(snapshotOf([row()])).toBeUndefined();
    expect(snapshotOf([row({ settings_snapshot: {} })])).toEqual({});
  });

  it('takes the snapshot from whichever OA row carries one', () => {
    const rows = [row({ hook_id: 'a' }), row({ hook_id: 'b', settings_snapshot: { message_flex_id: 'x' } })];
    expect(snapshotOf(rows)?.message_flex_id).toBe('x');
  });
});

describe('🔴 สรุปรอบ and LINE log are two sections — never one table', () => {
  it('renders both as separate, independently foldable sections', async () => {
    getBroadcastRunDetail.mockResolvedValue(
      detail({
        rows: [row({ hook_id: 'h1' }), row({ hook_id: 'h2', hook_alias: 'demo-oa-three' })],
        logs: [
          { hook_alias: 'demo-oa-three', action_type: 'send_broadcast', method: 'POST', endpoint: 'https://api.line.me/v2/bot/message/multicast', status: 'success', status_code: 200, retries: 0, created_at: '2026-08-24T03:00:01.000Z' },
          { hook_alias: 'demo-oa-three', action_type: 'send_broadcast', method: 'POST', endpoint: 'https://api.line.me/v2/bot/message/multicast', status: 'error', status_code: 429, retries: 2, created_at: '2026-08-24T03:00:02.000Z' },
        ],
      })
    );
    const v = await openModal();

    expect(v.queryByTestId('run-section-summary')).not.toBeNull();
    expect(v.queryByTestId('run-section-logs')).not.toBeNull();

    // 🔴 the log rows live OUTSIDE the summary section and vice versa — that is
    //    what "not merged" means in the DOM
    const summary = v.getByTestId('run-section-summary-body');
    expect(summary.querySelector('[data-testid="run-logs"]')).toBeNull();
    const logs = v.getByTestId('run-section-logs-body');
    expect(logs.querySelector('[data-testid="run-summary"]')).toBeNull();

    // 🔴 different cardinality is the reason: 2 OA rows, 2 requests, and the
    //    retry count only exists on the log side
    expect(v.getAllByTestId(/^run-summary-row-/)).toHaveLength(2);
    expect(logs.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(logs.textContent).toContain('429');
  });

  it('folds one section without touching the other', async () => {
    const v = await openModal();
    fireEvent.click(v.getByTestId('run-section-summary-toggle'));
    expect(v.queryByTestId('run-section-summary-body')).toBeNull();
    expect(v.queryByTestId('run-section-logs-body')).not.toBeNull();
  });

  it('puts "board หรือ multi" on the summary, in words', async () => {
    const v = await openModal();
    expect(v.getByTestId('run-send-kind-h1').textContent).toContain('บรอดแคสต์ (board)');
  });

  it('a multicast round says multi', async () => {
    getBroadcastRunDetail.mockResolvedValue(detail({ rows: [row({ send_kind: 'multicast' })] }));
    const v = await openModal();
    expect(v.getByTestId('run-send-kind-h1').textContent).toContain('มัลติแคสต์ (multi)');
  });
});

describe('absent vs empty, at the last layer', () => {
  it('🔴 images_replaced absent shows a dash, never 0', async () => {
    getBroadcastRunDetail.mockResolvedValue(detail({ rows: [row()] }));
    const v = await openModal();
    expect(v.getByTestId('run-images-h1').textContent).toBe('—');
  });

  it('🔴 a measured zero shows 0, not a dash', async () => {
    getBroadcastRunDetail.mockResolvedValue(detail({ rows: [row({ images_replaced: 0 })] }));
    const v = await openModal();
    expect(v.getByTestId('run-images-h1').textContent).toBe('0');
  });

  it('🔴 unknown_tags absent = never rendered · [] = rendered, all resolved', () => {
    const t = realT();
    expect(unknownTagsLabel(undefined, t)).toBe('—');
    expect(unknownTagsLabel([], t)).toBe('เรนเดอร์แล้ว ทุกแท็กมีค่าครบ');
    expect(unknownTagsLabel(['amount'], t)).toBe('amount');
  });
});

describe('groupRuns — one line per round, without inventing a status', () => {
  it('gathers per-OA rows and keeps every distinct status', () => {
    const runs = groupRuns([
      row({ hook_id: 'a', sent: 3, failed: 0, status: 'success' }),
      row({ hook_id: 'b', sent: 1, failed: 2, status: 'error' }),
      row({ run_id: 'run-2', hook_id: 'a', sent: 5, failed: 0, status: 'success' }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].oa_count).toBe(2);
    expect(runs[0].sent).toBe(4);
    expect(runs[0].failed).toBe(2);
    // 🔴 a SET, not a made-up "partial" the backend never wrote
    expect(runs[0].statuses).toEqual(['success', 'error']);
    expect(runs[1].run_id).toBe('run-2');
  });
});

/**
 * The owner's word was *"กดดู"* — a modal you OPEN. A detail component nothing
 * clicks into is the same as no detail component, which is exactly the state
 * `broadcast_histories` sat in for a day: written, correct, and unreachable.
 */
describe('กดดู — the round list opens the modal', () => {
  const campaign = { id: 'b1', name: 'promo' } as BroadcastEntry;

  it('asks for nothing until a campaign is picked', async () => {
    wrap(<BroadcastRunHistoryPanel broadcasts={[campaign]} />);
    expect(getBroadcastHistory).not.toHaveBeenCalled();
  });

  it('lists one line per round and opens that round on click', async () => {
    const v = wrap(<BroadcastRunHistoryPanel broadcasts={[campaign]} />);
    /* [FEAT-20260825-RUNHISTSEARCH] เดิมเป็น <select> ⇒ ใช้ fireEvent.change ได้
       ตอนนี้เป็น SearchableSelect (ตัวเดียวกับหน้าอื่น) ซึ่งเป็นปุ่ม + เมนู
       ⇒ ต้องกดเปิดแล้วกดตัวเลือกจริง — เทสจึงสะท้อนสิ่งที่ผู้ใช้ทำจริงมากกว่าเดิม */
    pickBroadcast(v, 'promo');
    await waitFor(() => expect(v.queryByTestId('run-row-run-1')).not.toBeNull());
    expect(v.queryByTestId('broadcast-run-detail-modal')).toBeNull();

    fireEvent.click(v.getByTestId('run-row-run-1'));
    await waitFor(() => expect(v.queryByTestId('broadcast-run-detail-modal')).not.toBeNull());
    // 🔴 the modal must be asked about THAT campaign and THAT round
    expect(getBroadcastRunDetail).toHaveBeenCalledWith('b1', 'run-1');
  });

  it('"ยังไม่เคยรัน" is said in words, never as a bare empty table', async () => {
    getBroadcastHistory.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 25 } });
    const v = wrap(<BroadcastRunHistoryPanel broadcasts={[campaign]} />);
    /* [FEAT-20260825-RUNHISTSEARCH] เดิมเป็น <select> ⇒ ใช้ fireEvent.change ได้
       ตอนนี้เป็น SearchableSelect (ตัวเดียวกับหน้าอื่น) ซึ่งเป็นปุ่ม + เมนู
       ⇒ ต้องกดเปิดแล้วกดตัวเลือกจริง — เทสจึงสะท้อนสิ่งที่ผู้ใช้ทำจริงมากกว่าเดิม */
    pickBroadcast(v, 'promo');
    await waitFor(() => expect(v.queryByTestId('run-history-empty')).not.toBeNull());
  });
});

/**
 * 🌐 THE WORDS LIVE IN `i18n/translations/*.json` NOW.
 *
 * Moving a sentence out of the JSX buys three new ways to break it, and none of
 * them throws — they all render something plausible-looking and wrong:
 *   · the key is missing  → the admin reads `broadcast.run_logs_expired` on screen
 *   · a locale is missing → that language silently falls back to English
 *   · a `{placeholder}` is dropped in ONE locale → the reason vanishes for those
 *     readers only, and the sentence still looks like a finished sentence
 * `test/i18nKeyCoverage.value.test.ts` only guards en.json; these guard the rest.
 */
describe('🌐 the sentences come from i18n, and every locale keeps them whole', () => {
  const table = (o: unknown) => o as Record<string, string>;
  const RUN_KEYS = Object.keys(table(en)).filter(k => k.startsWith('broadcast.run_'));
  const holes = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort().join(',');

  it('🔴 no raw i18n key ever reaches the screen', async () => {
    getBroadcastRunDetail.mockResolvedValue(
      detail({
        rows: [row({ settings_snapshot: { target: { mode: 'all' }, schedule: { mode: 'repeat', days_of_week: [1, 2] } } })],
        logs: [{ hook_alias: 'demo-oa-three', action_type: 'send_broadcast', status: 'error', status_code: 429, retries: 1, created_at: '2026-08-24T03:00:01.000Z' }],
      })
    );
    const v = await openModal();
    expect(v.container.textContent ?? '').not.toMatch(/broadcast\.run_/);
    expect(v.container.textContent ?? '').not.toMatch(/broadcast\.repeat_day_/);

    const p = wrap(<BroadcastRunHistoryPanel broadcasts={[{ id: 'b1', name: 'promo' } as BroadcastEntry]} />);
    expect(p.container.textContent ?? '').not.toMatch(/broadcast\.run_/);
  });

  it('🔴 th and zh carry every broadcast.run_* key, and none of them is blank', () => {
    expect(RUN_KEYS.length).toBeGreaterThan(50); // guard: the filter really matched
    for (const locale of [table(th), table(zh)]) {
      expect(RUN_KEYS.filter(k => !(k in locale) || locale[k].trim() === '')).toEqual([]);
    }
  });

  it('🔴 every locale keeps the same {placeholders} — a dropped one loses the value silently', () => {
    for (const locale of [table(th), table(zh)]) {
      const drifted = RUN_KEYS.filter(k => holes(locale[k] ?? '') !== holes(table(en)[k] ?? ''));
      expect(drifted).toEqual([]);
    }
  });

  it('🔴 the failed log read puts the backend reason INTO the sentence', () => {
    const text = logsNotice({ logsExpired: false, logsError: 'ECONNRESET' }, realT())?.text ?? '';
    expect(text).toContain('ECONNRESET');
    expect(text).not.toContain('{message}'); // the placeholder must be filled, not printed
  });

  it('🔴 the section hints count what they say they count', async () => {
    getBroadcastRunDetail.mockResolvedValue(
      detail({
        rows: [row({ hook_id: 'h1' }), row({ hook_id: 'h2' })],
        logs: [{ hook_alias: 'demo-oa-three', status: 'success', created_at: '2026-08-24T03:00:01.000Z' }],
      })
    );
    const v = await openModal();
    expect(v.getByTestId('run-section-summary-toggle').textContent).toContain('2 OA');
    expect(v.getByTestId('run-section-logs-toggle').textContent).toContain('1 คำขอ');
  });
});

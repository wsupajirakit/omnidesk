/**
 * [FEAT-20260824-RUNDETAIL] One round: what the campaign decided, and what LINE
 * answered.
 *
 * Owner, 24/08: *"history ต้องจอย webhook log มาใช้ไหม ต้องแสดงทั้ง history +
 * webhook log จะได้ครบ แต่ว่าทำเป็น modal กดดู"*.
 *
 * 🔴 THE CASES THAT MATTER HERE ARE THE AMBIGUOUS ANSWERS. "No logs" can mean
 * the 45-day TTL took them or that the read failed, and "no rows" can mean the
 * run does not exist. Each of those has a different honest reply, and folding
 * any two together is how a modal ends up telling an admin a campaign sent
 * nothing when it sent fine. คำตอบที่กำกวมคือจุดที่ต้องทดสอบ.
 */
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { BroadcastHistoryReadService } from '@/modules/content/broadcast-run/history.service';

const JOB_ID = 'a0d000000000000000000012';
const RUN = 'run-abc';

const chain = (rows: unknown) => ({
  select: () => ({
    sort: () => ({
      limit: () => ({ lean: () => ({ exec: () => Promise.resolve(rows) }) }),
      lean: () => ({ exec: () => Promise.resolve(rows) }),
    }),
  }),
});

const HISTORY_ROW = {
  run_id: RUN,
  broadcast_name: 'ทักลูกค้าเก่า',
  hook_alias: 'demo-oa-three',
  send_kind: 'multicast',
  card_type: 'plain',
  matched: 3,
  targeted: 3,
  sent: 3,
  failed: 0,
  unsent: 0,
  requests_planned: 1,
  requests_made: 1,
  chunks_planned: 1,
  chunks_done: 1,
  status: 'success',
  settings_snapshot: { target: { mode: 'all' }, hook_ids: ['h1'] },
};

const LOG_ROW = {
  hook_alias: 'demo-oa-three',
  action_type: 'send_broadcast',
  endpoint: 'https://api.line.me/v2/bot/message/multicast',
  status: 'success',
  status_code: 200,
};

function service(
  opts: {
    job?: unknown;
    rows?: unknown[];
    logs?: unknown[];
    logsThrow?: boolean;
  } = {},
) {
  const job = 'job' in opts ? opts.job : { _id: JOB_ID, hook_ids: ['h1'] };
  return new BroadcastHistoryReadService(
    {
      findOne: () => ({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve(job) }) }),
      }),
    } as never,
    { find: () => chain(opts.rows ?? [HISTORY_ROW]) } as never,
    {} as never,
    {
      find: () =>
        opts.logsThrow
          ? {
              select: () => ({
                sort: () => ({
                  limit: () => ({
                    lean: () => ({
                      exec: () => Promise.reject(new Error('mongo down')),
                    }),
                  }),
                }),
              }),
            }
          : chain(opts.logs ?? [LOG_ROW]),
    } as never,
  );
}

describe('runDetail — the two sides stay separate', () => {
  it('returns the history rows AND the LINE logs, unmerged', async () => {
    /* Different cardinalities: a history row is one (run × OA); a log row is one
       HTTP request. Merging them would make "the run succeeded but two requests
       retried" impossible to show. คนละหน่วยนับ ห้ามยุบรวม. */
    const out = await service().runDetail(JOB_ID, RUN);
    expect(out.run_id).toBe(RUN);
    expect(out.rows).toHaveLength(1);
    expect(out.logs).toHaveLength(1);
  });

  it('🔴 the row names the campaign AND which pipe it used', async () => {
    /* "board หรือ multi" was the owner's first question about this screen, and
       `broadcast_name` was stored from day one but left out of the read
       whitelist, so no view could name the campaign. */
    const out = await service().runDetail(JOB_ID, RUN);
    expect(out.rows[0]?.broadcast_name).toBe('ทักลูกค้าเก่า');
    expect(out.rows[0]?.send_kind).toBe('multicast');
  });

  it('carries the settings the campaign had at that moment', async () => {
    const out = await service().runDetail(JOB_ID, RUN);
    expect(out.rows[0]?.settings_snapshot).toEqual({
      target: { mode: 'all' },
      hook_ids: ['h1'],
    });
  });
});

describe('runDetail — the ambiguous answers are kept apart', () => {
  it('🔴 no logs ⇒ `logsExpired`, because the TTL is the usual reason', async () => {
    /* `webhook_logs` expires after 45 days; history rows never do. An empty list
       rendered with no explanation reads as "this round sent nothing", which is
       a lie about a campaign that went out fine. log หมดอายุ ≠ ไม่มีการส่ง. */
    const out = await service({ logs: [] }).runDetail(JOB_ID, RUN);
    expect(out.logs).toEqual([]);
    expect(out.logsExpired).toBe(true);
    expect(out).not.toHaveProperty('logsError');
  });

  it('🔴 a FAILED log read is NOT reported as expired', async () => {
    /* Two different facts. Calling a broken read "expired" would send someone
       looking at retention when the database is down. อ่านพัง ≠ หมดอายุ. */
    const out = await service({ logsThrow: true }).runDetail(JOB_ID, RUN);
    expect(out.logsExpired).toBe(false);
    expect(out.logsError).toBeTruthy();
  });

  it('🔴 a log failure never takes the run detail down with it', async () => {
    /* The history rows are what an admin opened the modal for. */
    const out = await service({ logsThrow: true }).runDetail(JOB_ID, RUN);
    expect(out.rows).toHaveLength(1);
  });
});

describe('runDetail — refusals say which thing is missing', () => {
  it('🔴 an unknown RUN is 404, not an empty detail', async () => {
    /* An empty modal claims "this round did nothing"; a 404 says "no such
       round". รอบที่ไม่มีอยู่ ≠ รอบที่ไม่ได้ทำอะไร. */
    await expect(service({ rows: [] }).runDetail(JOB_ID, RUN)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('an unknown JOB is 404 too', async () => {
    await expect(service({ job: null }).runDetail(JOB_ID, RUN)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('a malformed id or a blank run id is refused before any read', async () => {
    await expect(service().runDetail('not-an-id', RUN)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service().runDetail(JOB_ID, '   ')).rejects.toThrow(
      BadRequestException,
    );
  });
});

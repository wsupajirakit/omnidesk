import { ValidationPipe } from '@nestjs/common';

import { TicketsService, UpdateTicketDto } from '@/modules/tickets';

/**
 * ==== [FIX-20260817-NOZEROREOPEN] a closed case cannot be resurrected ========
 *
 * `PUT /api/tickets/:id {job_status:0}` used to walk past BOTH layers of
 * `updateTicket`: the pre-check only named 2, 1 and a claim, and the write
 * filter only added `job_status: {$ne: 2}` for those same three. A closed case
 * came back as a HALF-BUILT one — no divider, no assign-history row,
 * `resolved_at`/`admin_user_id` still those of whoever closed it, and the
 * room's `assist_status` left `false`, so the bot kept answering the customer
 * while the queue showed a case waiting for a human. `ticket:updated` was
 * published, so it appeared on every operator's screen in that state.
 *
 * The correct route already exists — `POST /api/tickets/reopen-by-admin`
 * (atomic room claim → new ticket → divider → history → `ticket:reopened`).
 *
 * WHAT THIS SPEC RUNS — the real `updateTicket` against jest model stubs (no
 * Mongo), plus the real `ValidationPipe` against the real DTO. Both directions
 * are pinned: the hole is closed, AND every transition that must keep working
 * (0→1, 1→2, a plain field edit) still writes with the same filter as before.
 *
 * revert: delete this file together with the `job_status === 0` block and the
 * `refusesClosed` filter in `tickets.service.ts`.
 */

const ID = 'a0d000000000000000000016';
const OTHER_ADMIN = 'a0d00000000000000000005f';

type Before = Record<string, unknown> | null;

/**
 * `before` is what `findById().select().lean()` answers; `result` is what
 * `findOneAndUpdate()` resolves to (null = the filter matched nothing).
 */
function buildService(before: Before, result: Record<string, unknown> | null) {
  const findOneAndUpdate = jest.fn(() => {
    const query: Record<string, unknown> = {
      populate: jest.fn(() => query),
      lean: jest.fn(() => Promise.resolve(result)),
    };
    return query;
  });
  const ticketModel = {
    findById: () => ({
      select: () => ({ lean: () => Promise.resolve(before) }),
    }),
    findOneAndUpdate,
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
    {
      resolve: () => ({
        tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
      }),
    } as never,
  );
  jest
    .spyOn(service as never, 'publishScopedTicketEvent')
    .mockReturnValue(undefined as never);
  jest
    .spyOn(service as never, 'populateAttachedFiles')
    .mockImplementation(((t: unknown) => Promise.resolve(t)) as never);
  return { service, findOneAndUpdate };
}

/** The filter `findOneAndUpdate` was actually called with. */
const filterOf = (fn: jest.Mock): unknown =>
  (fn.mock.calls[0] as unknown[] | undefined)?.[0];

describe('[FIX-20260817-NOZEROREOPEN] a closed ticket refuses job_status:0', () => {
  it('answers 409 and writes NOTHING', async () => {
    const { service, findOneAndUpdate } = buildService({ job_status: 2 }, null);

    await expect(service.updateTicket(ID, { job_status: 0 })).rejects.toThrow(
      'เคสนี้ถูกปิดไปแล้ว เปิดใหม่ต้องใช้ปุ่ม "เปิดเคส"',
    );
    // The refusal is BEFORE the write — not a write that happened to match
    // nothing.
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('keeps the two refusal messages that already existed, word for word', async () => {
    // The golden suite compares these strings against the legacy backend, so a
    // reword here is a parity break, not a copy edit.
    const closed = () => buildService({ job_status: 2 }, null).service;
    await expect(closed().updateTicket(ID, { job_status: 2 })).rejects.toThrow(
      'เคสนี้ถูกปิดไปแล้ว',
    );
    await expect(closed().updateTicket(ID, { job_status: 1 })).rejects.toThrow(
      'เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้',
    );
    await expect(
      closed().updateTicket(ID, { admin_user_id: OTHER_ADMIN }),
    ).rejects.toThrow('เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้');
  });
});

describe('[FIX-20260817-NOZEROREOPEN] the write filter refuses a closed row atomically', () => {
  it('a status write carries job_status:{$ne:2} — including 0', async () => {
    // `before` and the write are two round trips; without the filter a case
    // closed in between would be reopened by whichever request read first.
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 0 },
    );

    await service.updateTicket(ID, { job_status: 0 });

    /* [FIX-20260818-TICKETSCOPE · plan §8 = T3-3] The filter now also carries the
       caller's OA scope, so the two guards compose in ONE atomic write. These
       cases build the service with no caller, which resolves to "no OA at all" —
       fail closed — hence the empty `$in`. The assertion still pins what this
       spec is about: `job_status: { $ne: 2 }` is present. */
    expect(filterOf(findOneAndUpdate)).toMatchObject({
      _id: ID,
      job_status: { $ne: 2 },
    });
  });

  it('losing that race reports the conflict, not "Ticket not found"', async () => {
    // The row was open when read and closed by the time of the write.
    const { service } = buildService({ job_status: 1 }, null);

    await expect(service.updateTicket(ID, { job_status: 0 })).rejects.toThrow(
      'เคสนี้ถูกปิดไปแล้ว เปิดใหม่ต้องใช้ปุ่ม "เปิดเคส"',
    );
  });

  it('a write with NO job_status carries no job_status guard (unchanged)', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(ID, { need_detail: 'ลูกค้าโอนมาแล้ว' });

    const filter = filterOf(findOneAndUpdate) as Record<string, unknown>;
    expect(filter['_id']).toBe(ID);
    // still no closed-case guard on a non-status write — that is this case's point
    expect(filter).not.toHaveProperty('job_status');
    // and the OA scope rides along on every write now (plan §8 = T3-3)
    expect(filter).toHaveProperty('$or');
  });

  it('a missing ticket is still 404, not a conflict', async () => {
    const { service } = buildService(null, null);

    await expect(
      service.updateTicket(ID, { need_detail: 'x' }),
    ).rejects.toThrow('Ticket not found');
  });
});

describe('[FIX-20260817-NOZEROREOPEN] the transitions that must keep working', () => {
  it('0 → 1 (accept) writes and stamps assigned_at', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(ID, { job_status: 1 });

    const update = (findOneAndUpdate.mock.calls[0] as unknown[])[1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set['job_status']).toBe(1);
    expect(update.$set['assigned_at']).toBeInstanceOf(Date);
  });

  it('1 → 2 (close) writes and stamps resolved_at', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID, job_status: 2 },
    );

    await service.updateTicket(ID, { job_status: 2 });

    const update = (findOneAndUpdate.mock.calls[0] as unknown[])[1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set['job_status']).toBe(2);
    expect(update.$set['resolved_at']).toBeInstanceOf(Date);
  });
});

/**
 * [FIX-20260817-JOBSTATUSSET] the edge rejects a status the system has no
 * screen for. Options mirror `main.ts:114-144` (whitelist + implicit
 * conversion); only the two behaviours this fix owns are asserted, so the spec
 * does not become a copy of the pipe's own configuration.
 */
describe('[FIX-20260817-JOBSTATUSSET] job_status is 0, 1 or 2 — nothing else', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (body: unknown): Promise<unknown> =>
    pipe.transform(body, { type: 'body', metatype: UpdateTicketDto });

  /**
   * The rejection REASON, not just the 400. Nest's default exception message is
   * the generic "Bad Request Exception"; the constraint text lives in the
   * response body, which is what `main.ts`'s exceptionFactory joins and the
   * dashboard prints. Asserting the reason is what makes this case fail if the
   * `@IsIn` is dropped while some other validator still rejects.
   */
  const rejectionReason = async (body: unknown): Promise<string> => {
    try {
      await run(body);
    } catch (error) {
      const response = (
        error as { getResponse?: () => unknown }
      ).getResponse?.() as { message?: string[] | string } | undefined;
      return JSON.stringify(response?.message ?? String(error));
    }
    return 'NOT REJECTED';
  };

  it.each([3, 7, -1, 99])('rejects job_status:%s', async (value) => {
    // A ticket stored with 7 is invisible to every filter in the product: the
    // queue asks for '0,1' and the closed list for 2.
    await expect(rejectionReason({ job_status: value })).resolves.toMatch(
      /job_status must be one of the following values/,
    );
  });

  it.each([0, 1, 2])('accepts job_status:%s', async (value) => {
    await expect(run({ job_status: value })).resolves.toMatchObject({
      job_status: value,
    });
  });

  it('still accepts a body without job_status at all', async () => {
    await expect(run({ need_detail: 'x' })).resolves.toMatchObject({
      need_detail: 'x',
    });
  });
});

/**
 * [FIX-20260818-TICKETSCOPE · plan §8 = T3-3, closes audit C2.5]
 *
 * `updateTicket` and `deleteTicket` filtered on `{ _id: id }` alone, so an id was
 * the entire authorisation: any authenticated operator could reassign, close or
 * PERMANENTLY DELETE another OA's ticket. The scope now rides in the same filter,
 * which is what keeps it atomic alongside the closed-case guard above.
 *
 * Both hook columns are matched because the live rows disagree: `line_oa_hook_id`
 * is set on all 141, `hook_id` is null on one.
 */
describe('[TICKETSCOPE] a ticket write cannot reach another OA', () => {
  const OA = 'a0d000000000000000000043';
  const scopedOperator = {
    roleName: 'operator',
    groups: [],
    allowedHooks: [OA],
  } as never;

  it('⭐ the update filter carries the caller’s OA on both hook columns', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(ID, { need_detail: 'x' }, scopedOperator);

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      _id: ID,
      $or: [{ hook_id: { $in: [OA] } }, { line_oa_hook_id: { $in: [OA] } }],
    });
  });

  it('a super user is unscoped — no $or at all', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(ID, { need_detail: 'x' }, {
      roleName: 'superadmin',
    } as never);

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('$or');
  });
});

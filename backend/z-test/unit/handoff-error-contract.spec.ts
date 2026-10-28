/**
 * Pins the ERROR CONTRACT of the handoff write routes against legacy.
 *
 * Every status asserted below was CAPTURED FROM THE RUNNING LEGACY BACKEND
 * (legacy-api on :10500) with an empty `{}` body and a malformed `:id`, not
 * derived by reading the source. The recorded responses were:
 *
 *   PUT    /api/handoff/targets/probe_id            400 "Cast to ObjectId failed…"
 *   DELETE /api/handoff/targets/probe_id            400 "Cast to ObjectId failed…"
 *   POST   /api/handoff/callbacks/probe_id/attach   400 "Cast to ObjectId failed…"
 *   POST   /api/handoff/callbacks/probe_id/dismiss  400 "Cast to ObjectId failed…"
 *   GET    /api/handoff/targets/probe_id            500 "Cast to ObjectId failed…"
 *
 * Note the LAST line. Legacy does not use one status for a malformed id: each
 * handler carries its own `catch`, and the read path deliberately disagrees
 * with the write paths (handoffTargetController.js:174 vs :255 / :270). The
 * port had collapsed all of them onto 500, so the four write routes answered
 * 500 where legacy answers 400. A regression that re-unifies them would go red
 * here — which is the point of asserting the 500 case alongside the 400s.
 *
 * No I/O: the cast failure is injected, so nothing reaches Mongo and no
 * credential is used.
 */
import { HttpStatus } from '@nestjs/common';

import {
  HandoffTargetService,
  TargetError,
} from '@/modules/handoff/handoff-target.service';
import { TargetErrorFilter } from '@/modules/handoff/target-error.filter';

/** The message Mongoose emits for a malformed `_id`, verbatim from legacy. */
const CAST_MESSAGE =
  'Cast to ObjectId failed for value "probe_id" (type string) at path "_id" for model "HandoffTarget"';

type CastRunner = (
  status: number,
  operation: () => Promise<unknown>,
) => Promise<unknown>;

/**
 * The helper under test is private, and it is exercised through the prototype
 * rather than by standing up the whole service: it has no state, and building
 * the service would drag in four Mongoose models purely to reach one function.
 */
const runOrWrapCastError = (
  status: number,
  operation: () => Promise<unknown>,
): Promise<unknown> =>
  (
    HandoffTargetService.prototype as unknown as {
      runOrWrapCastError: CastRunner;
    }
  ).runOrWrapCastError.call(HandoffTargetService.prototype, status, operation);

describe('handoff target: status for a malformed id is per-handler', () => {
  const throwCast = (): Promise<never> =>
    Promise.reject(new Error(CAST_MESSAGE));

  it.each([
    ['update  (legacy PUT    → 400)', 400],
    ['remove  (legacy DELETE → 400)', 400],
  ])('%s', async (_label, expected) => {
    expect.assertions(3);
    try {
      await runOrWrapCastError(expected, throwCast);
    } catch (error) {
      const err = error as TargetError;
      expect(err).toBeInstanceOf(TargetError);
      expect(err.status).toBe(expected);
      // Legacy echoes the driver's own message; it is not replaced.
      expect(err.message).toBe(CAST_MESSAGE);
    }
  });

  it("getById keeps legacy's 500 — the read path really does differ", async () => {
    expect.assertions(2);
    try {
      await runOrWrapCastError(500, throwCast);
    } catch (error) {
      const err = error as TargetError;
      expect(err.status).toBe(500);
      expect(err.message).toBe(CAST_MESSAGE);
    }
  });

  it('passes a success through untouched', async () => {
    await expect(
      runOrWrapCastError(400, () => Promise.resolve({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });
});

/**
 * The filter is the last thing between a thrown error and the client, so it
 * must not be able to throw itself.
 *
 * `response.status()` throws `TypeError: Invalid status code` on a non-integer,
 * and because a throwing filter hands the request to express's default handler,
 * the shaped response is lost AND the original error disappears with it — every
 * handled error becomes an opaque 500. That is not hypothetical: it is exactly
 * what a mid-edit two-argument helper produced, surfacing to the owner as
 * "handoff edit ไม่ได้" with no usable trace.
 */
describe('TargetErrorFilter never emits a non-integer status', () => {
  interface FakeResponse {
    code: number | null;
    body: unknown;
    headersSent: boolean;
    status(code: number): FakeResponse;
    json(body: unknown): FakeResponse;
  }

  const makeResponse = (): FakeResponse => ({
    code: null,
    body: null,
    headersSent: false,
    status(code: number) {
      // Mirrors express's own guard, so a regression fails here as it would
      // fail in production rather than passing on a lenient stub.
      if (!Number.isInteger(code)) {
        throw new TypeError(`Invalid status code: ${String(code)}`);
      }
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  });

  const hostFor = (response: FakeResponse) =>
    ({
      switchToHttp: () => ({ getResponse: () => response }),
    }) as never;

  let filter: TargetErrorFilter;
  beforeEach(() => {
    filter = new TargetErrorFilter();
    // The filter logs on the degraded paths by design; keep the run quiet.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  it('emits a well-formed TargetError as-is', () => {
    const response = makeResponse();
    filter.catch(new TargetError(400, 'target not found'), hostFor(response));
    expect(response.code).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toEqual({ error: 'target not found' });
  });

  it('keeps the `details` array legacy sends with an invalid config', () => {
    const response = makeResponse();
    const details = [{ key: 'no_such_flag', error: 'unknown config key' }];
    filter.catch(
      new TargetError(400, 'invalid config', details),
      hostFor(response),
    );
    expect(response.body).toEqual({ error: 'invalid config', details });
  });

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['a function', (): void => undefined],
    ['out of range', 99],
    ['a numeric string', '400'],
  ])('degrades a status that is %s to 500 instead of throwing', (_l, bad) => {
    const response = makeResponse();
    const broken = Object.assign(new Error('boom'), { status: bad });

    expect(() =>
      filter.catch(broken as never, hostFor(response)),
    ).not.toThrow();
    expect(response.code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body).toEqual({ error: 'boom' });
  });

  it('normalises a malformed JSON body the way legacy does', () => {
    const response = makeResponse();
    filter.catch(new SyntaxError('Unexpected token n'), hostFor(response));
    expect(response.code).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toEqual({ error: 'invalid JSON body' });
  });

  it('writes nothing once the response has been sent', () => {
    const response = makeResponse();
    response.headersSent = true;
    filter.catch(new TargetError(400, 'too late'), hostFor(response));
    expect(response.code).toBeNull();
  });
});

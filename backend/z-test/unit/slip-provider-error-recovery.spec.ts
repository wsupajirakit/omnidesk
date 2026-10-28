/**
 * =============================================================================
 * [FEAT-20260903-CATCHSEAM] a rejection the provider means as an ANSWER
 * =============================================================================
 *
 * THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE. Some vendors report a business
 * verdict as an HTTP error. SlipGuard under `log:true` answers **400** for a wrong
 * receiver (`1014`) and for a duplicate (`1012`) — while still returning the
 * whole slip in `data`. axios throws on 4xx, so that reply used to land in
 * `verifySlip`'s catch and become VARIANT 3: an `ERR_` row meaning "we never got
 * an answer". Three things then break together and none of them errors —
 * `api_status:'failed'` stops payment GATE B, `match_account:false` becomes
 * meaningless because the vendor's "no" is indistinguishable from an outage, and
 * `flex_duplicate` can never be selected.
 *
 * 🔴 AND THE PROPERTY THAT PROTECTS TODAY: for a provider that claims nothing —
 * Swiftcheck — this seam must be a NO-OP. The original rejection has to travel out
 * untouched, because the catch reads `error.response` and `error.message` off it
 * and writes them onto the money path's failure row. That is the first case
 * below, and it asserts OBJECT IDENTITY rather than shape: a wrapper that
 * happened to copy `message` would pass a shape check and still have rewritten
 * the row.
 *
 * ⚠️ The providers here are hand-built fakes ON PURPOSE for the seam's own
 * cases: the point is behaviour that no registered vendor exhibits yet. The last
 * describe does the opposite — it drives the REAL registry, so the invariant is
 * asserted against what actually ships rather than against a fake.
 *
 * revert: delete with `src/modules/slip/providers/send-with-recovery.ts`.
 */
import {
  SLIP_PROVIDERS,
  sendWithRecovery,
  swiftcheckProvider,
  type SlipProvider,
  type SlipVerifyRequest,
  type SlipVerifyResponse,
} from '@/modules/slip';

/** A request object; nothing here reads its contents, only its identity. */
const REQUEST = {
  url: 'https://example.test/verify',
  headers: {},
  body: { base64: 'x' },
  timeoutMs: 1_000,
  endpoint: '/verify',
  imageField: 'base64',
} as SlipVerifyRequest;

/** Builds a provider whose send/recover behaviour is dictated per case. */
const fakeProvider = (over: Partial<SlipProvider>): SlipProvider => ({
  name: 'fake',
  defaultBaseUrl: 'https://example.test',
  logChannel: 'fake_api',
  logAction: 'verify',
  buildRequest: () => REQUEST,
  send: () => Promise.resolve({ status: 200, data: {} }),
  normaliseResponse: (r: SlipVerifyResponse) => r,
  recoverFromError: () => null,
  isSuccess: () => true,
  ...over,
});

describe('[CATCHSEAM] ⭐ an unclaimed rejection must travel out UNCHANGED', () => {
  it('⭐ re-throws the SAME object, not a copy and not a wrapper', async () => {
    /* 🔴 THE WHOLE POINT. `verifySlip`'s catch reads `error.response` and
       `error.message` off this object and writes them into `slipVerifyResult`,
       `slipCondition` and the `ERR_` row's `raw_response`. Identity, not shape:
       a wrapper that copied `message` across would satisfy a shape assertion and
       still have rewritten the failure row of the money path. */
    const original = Object.assign(new Error('socket hang up'), {
      response: { data: { boom: true } },
    });
    const provider = fakeProvider({
      send: () => Promise.reject(original),
      recoverFromError: () => null,
    });

    await expect(sendWithRecovery(provider, REQUEST)).rejects.toBe(original);
  });

  it('keeps `response` and `message` readable on the way out', async () => {
    // The two properties the catch actually consumes, asserted as the catch
    // would read them rather than trusting identity alone to imply it.
    const original = Object.assign(new Error('timeout of 30000ms exceeded'), {
      response: { data: { error: { code: 'X' } } },
    });
    const provider = fakeProvider({ send: () => Promise.reject(original) });

    /* `.then(onOk, onErr)` rather than `.catch`, so the resolved branch is typed
       as `null` and a version of this helper that RESOLVED instead of throwing
       would fail on the first assertion instead of type-erroring. */
    const caught = await sendWithRecovery(provider, REQUEST).then(
      () => null,
      (e: unknown) => e as typeof original,
    );

    expect(caught).not.toBeNull();
    expect(caught?.message).toBe('timeout of 30000ms exceeded');
    expect(caught?.response.data).toEqual({ error: { code: 'X' } });
  });

  it('re-throws non-Error rejections unchanged too', async () => {
    /* axios is not the only thing that can reject. A string or a null must not
       become "cannot read property of null" from inside this helper — that would
       replace the vendor's failure with our own. */
    for (const thrown of ['a string', null, undefined, 42, { plain: true }]) {
      const provider = fakeProvider({
        /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors --
           rejecting with a NON-Error is the entire subject of this case. The rule
           protects production code from doing it; here it reproduces what a
           library or a transport can genuinely reject with, which is the input
           the helper must survive without inventing an error of its own. */
        send: () => Promise.reject(thrown),
      });
      await expect(sendWithRecovery(provider, REQUEST)).rejects.toBe(thrown);
    }
  });
});

describe('[CATCHSEAM] ⭐ a claimed rejection becomes the answer', () => {
  it('⭐ returns what the provider recognised, and does NOT throw', async () => {
    /* The SlipGuard `1014` shape: HTTP 400 carrying the whole slip. The provider
       folds it into the success envelope; the flow then continues down the
       normal path and writes a real row instead of an `ERR_` one. */
    const folded: SlipVerifyResponse = {
      status: 400,
      data: { success: true, data: { matchedAccount: false } },
    };
    const provider = fakeProvider({
      send: () => Promise.reject(new Error('Request failed with status 400')),
      recoverFromError: () => folded,
    });

    await expect(sendWithRecovery(provider, REQUEST)).resolves.toBe(folded);
  });

  it('hands the provider the exact rejection, exactly once', async () => {
    /* Once, because asking twice would let a provider that counts (a nonce, a
       metric, a code it pops off a queue) answer differently the second time.
       The exact object, because nobody but the provider can tell whether a 400
       from that host means "wrong receiver" or "your key is bad". */
    const original = new Error('Request failed with status code 400');
    const seen: unknown[] = [];
    const provider = fakeProvider({
      send: () => Promise.reject(original),
      recoverFromError: (e: unknown) => {
        seen.push(e);
        return { status: 400, data: {} };
      },
    });

    await sendWithRecovery(provider, REQUEST);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(original);
  });

  it('⭐ is NOT a retry — `send` runs once even when recovery happens', async () => {
    /* A second attempt would run with a customer waiting, after a request the
       vendor may already have charged for. If this ever starts retrying, it must
       be an explicit decision with its own budget — not a side effect of a helper
       called "send". */
    let sends = 0;
    const provider = fakeProvider({
      send: () => {
        sends += 1;
        return Promise.reject(new Error('400'));
      },
      recoverFromError: () => ({ status: 400, data: { folded: true } }),
    });

    await sendWithRecovery(provider, REQUEST);

    expect(sends).toBe(1);
  });

  it('a resolved send is passed through untouched, recovery never consulted', async () => {
    // The success path must not change shape or gain a hop.
    const ok: SlipVerifyResponse = { status: 200, data: { success: true } };
    let asked = 0;
    const provider = fakeProvider({
      send: () => Promise.resolve(ok),
      recoverFromError: () => {
        asked += 1;
        return null;
      },
    });

    await expect(sendWithRecovery(provider, REQUEST)).resolves.toBe(ok);
    expect(asked).toBe(0);
  });
});

describe('[CATCHSEAM] every REGISTERED provider, not a fake', () => {
  it('⭐ implements `recoverFromError`, so nobody inherits an absence', () => {
    /* The member is required by the port for this reason: forgetting it is
       SILENT — the fold simply does not happen, slips land on the `ERR_` branch
       and the money leg refuses, with nothing anywhere saying why. Derived from
       the live registry so a provider registered tomorrow is covered without
       editing this case. */
    // Collected rather than asserted one by one, so a failure NAMES the
    // offending providers instead of stopping at the first.
    const missing = Object.entries(SLIP_PROVIDERS)
      .filter(([, p]) => typeof p.recoverFromError !== 'function')
      .map(([name]) => name);

    expect(missing).toEqual([]);
    expect(Object.keys(SLIP_PROVIDERS).length).toBeGreaterThan(0);
  });

  it('⭐ is TOTAL — no registered provider throws on any rejection shape', () => {
    /* It runs on a live conversation. A throw here would replace the vendor's
       real error with this function's, which is precisely what the seam exists
       to prevent — so "it never throws" is a property of the seam, not of one
       implementation. */
    const shapes: unknown[] = [
      new Error('boom'),
      Object.assign(new Error('400'), { response: { status: 400, data: {} } }),
      Object.assign(new Error('no body'), { response: undefined }),
      { response: { data: { code: 1014 } } },
      'a string',
      null,
      undefined,
      0,
      [],
    ];

    const threw: string[] = [];
    for (const [name, provider] of Object.entries(SLIP_PROVIDERS)) {
      for (const shape of shapes) {
        try {
          provider.recoverFromError(shape);
        } catch {
          // collected, not re-thrown: the message must name WHICH provider and
          // WHICH shape, which a bare `.not.toThrow()` per case cannot do.
          threw.push(
            `${name} threw on ${JSON.stringify(shape) ?? String(shape)}`,
          );
        }
      }
    }

    expect(threw).toEqual([]);
  });

  it('Swiftcheck claims NOTHING — its verdicts arrive inside a 200', () => {
    /* Not a stub: Swiftcheck reports a duplicate and a wrong receiver as
       `success:true` with a flag, and its refusals as `success:false`. So every
       rejection it can produce is a real transport failure and belongs on the
       `ERR_` branch — which is where it goes today, unchanged. */
    for (const shape of [
      new Error('socket hang up'),
      Object.assign(new Error('400'), {
        response: { status: 400, data: { code: 1014 } },
      }),
      null,
    ]) {
      expect(swiftcheckProvider.recoverFromError(shape)).toBeNull();
    }
  });
});

/**
 * [FIX-20260821-AIKEYERRVISIBLE] The AI-key rejection must reach the operator.
 *
 * The failure this pins, reported from the dashboard: saving an OA with a bad
 * Gemini key answered a modal reading only `internal error`. The real text —
 * ``Custom AI KEY ! Key verification failed: API key not valid. Please pass a
 * valid API key.`` — was produced, logged, and then destroyed on the way out.
 *
 * WHY it was destroyed: `verifyCustomAiKey` threw a plain `Error`, and
 * `AllExceptionsFilter.resolve` branches on `instanceof HttpException` — not on
 * status — so anything else collapses to `500 internal error` by design (that
 * default is what stops stack traces reaching the client, and must stay).
 *
 * WHY the fix keeps 500 instead of moving to 400: legacy's handler answers 500
 * for this case (customAIKeyService.js carries no `statusCode`), and
 * `mongoose-error.interceptor.ts:69-76` records the house rule for exactly this
 * shape — changing the status to rescue the body trades one divergence for
 * another. `InternalServerErrorException` keeps the status legacy has AND the
 * message the file header calls the observable contract.
 *
 * These drive the REAL service and the REAL filter. `fetch` is stubbed, never
 * called for real: R10 in the service header forbids a test putting a live key
 * on the wire, since the local database is a clone of production.
 */
import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { HookCredentialCheckService } from '@/modules/hooks';

/** The body the dashboard actually receives, via the real filter. */
function shapeOf(exception: unknown): { status: number; body: unknown } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () =>
        ({ headersSent: false, status }) as unknown as Response,
      getRequest: () => ({
        method: 'PUT',
        url: '/hook/a0d00000000000000000005c',
      }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return {
    status: status.mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0],
  };
}

/** Whatever the method threw, handed back untouched. */
async function throwFrom(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('[FIX-20260821-AIKEYERRVISIBLE] a rejected AI key is readable in the modal', () => {
  const svc = new HookCredentialCheckService();
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('forwards the vendor rejection verbatim, still as 500', async () => {
    // Google's real 400 body for a bad key — the string the operator must read.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      url: 'https://generativelanguage.googleapis.com/',
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
            },
          }),
        ),
    });

    const thrown = await throwFrom(() =>
      svc.verifyCustomAiKey('bad-key', 'gemini'),
    );
    const { status, body } = shapeOf(thrown);

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR); // legacy parity
    expect(body).toEqual({
      error:
        'Custom AI KEY ! Key verification failed: API key not valid. Please pass a valid API key.',
    });
  });

  it('forwards the missing-key guard too', async () => {
    const thrown = await throwFrom(() => svc.verifyCustomAiKey('', 'gemini'));
    const { status, body } = shapeOf(thrown);

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ error: 'API key is required' });
  });

  it('never puts the key itself in the message — Gemini carries it in the URL', async () => {
    // A network failure is the one path whose text comes from Node, not the
    // vendor, so it is the one that could conceivably echo the probe URL.
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    const thrown = await throwFrom(() =>
      svc.verifyCustomAiKey('AIzaSy-SECRET-KEY-VALUE', 'gemini'),
    );
    const { body } = shapeOf(thrown);

    expect(JSON.stringify(body)).not.toContain('AIzaSy-SECRET-KEY-VALUE');
    expect(body).toEqual({
      error: 'Custom AI KEY ! Key verification failed: fetch failed',
    });
  });

  it('leaves the "internal error" default alone for a genuinely unexpected throw', () => {
    // The guard on the fix: rescuing this message must not widen the filter.
    const { status, body } = shapeOf(
      new Error('read ECONNRESET at Socket.onData'),
    );

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ error: 'internal error' });
  });
});

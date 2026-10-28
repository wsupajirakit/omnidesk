/**
 * =============================================================================
 * [FEAT-20260902-SLIPPROVIDER] The move is exact — proved against the golden.
 * =============================================================================
 *
 * WHAT THIS IS FOR
 * `providers/swiftcheck.provider.ts` claims to be a MOVE of the inline call in
 * `slip-flow.service.ts`, not a rewrite. This spec makes that claim checkable
 * instead of asserted: it drives the extracted provider with the same input the
 * baseline used and compares against **the golden that was recorded before the
 * provider existed** — `z-test/fixtures/slip-outbound-baseline.json`.
 *
 * WHY IT RUNS BEFORE THE WIRING
 * The provider is not called by anything yet. Proving equality first means the
 * switch-over is a one-line change with the evidence already in hand, rather
 * than a change whose correctness is argued afterwards. If these two disagree,
 * the wiring must not happen.
 *
 * WHAT IT DOES NOT COVER
 * `send()`. It is three lines around `axios.post` and its only requirement is
 * that it does NOT catch — a rejection has to reach `verifySlip`'s catch intact,
 * because that is where `slipVerifyResult` and `slipCondition` come from. The
 * last case here pins exactly that, since a well-meaning try/catch is the most
 * likely thing a future edit adds.
 *
 * revert: delete with `providers/`.
 */
import axios from 'axios';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { swiftcheckProvider } from '@/modules/slip';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const GOLDEN = JSON.parse(
  readFileSync(
    resolve(__dirname, '../fixtures/slip-outbound-baseline.json'),
    'utf8',
  ),
) as {
  url: string;
  timeout: number;
  headers: Record<string, string>;
  body: { base64: { bytes: number; sha256: string }; [k: string]: unknown };
};

/** The same deterministic stand-in the baseline spec writes to disk. */
function syntheticImage(): Buffer {
  return Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 7 + 13) % 256));
}

describe('[SLIPPROVIDER] the extracted Swiftcheck provider equals the recorded call', () => {
  const input = {
    imageBase64: syntheticImage().toString('base64'),
    checkDuplicate: true,
    matchAccount: true,
    // The baseline's CryptoService fake decrypts to this; the provider receives
    // plaintext because decryption stays at the call site.
    apiKey: 'BASELINE-KEY',
    baseUrl: 'https://api.swiftcheck.example.com/v2',
  };

  it('builds the same url and the same timeout', () => {
    const req = swiftcheckProvider.buildRequest(input);
    expect(req.url).toBe(GOLDEN.url);
    expect(req.timeoutMs).toBe(GOLDEN.timeout);
  });

  it('builds the same headers — same names, same values', () => {
    const req = swiftcheckProvider.buildRequest(input);
    expect(req.headers).toEqual(GOLDEN.headers);
    // Order is not part of the HTTP contract, but the SET is.
    expect(Object.keys(req.headers).sort()).toEqual(
      Object.keys(GOLDEN.headers).sort(),
    );
  });

  it('builds the same body — same keys, same values, same image bytes', () => {
    const req = swiftcheckProvider.buildRequest(input);
    // Narrowed, not String()-ed: the body is `unknown` per key, and stringifying
    // a non-string would compare '[object Object]' against the golden and pass
    // for the wrong reason.
    const b64 =
      typeof req.body['base64'] === 'string' ? req.body['base64'] : '';
    const comparable = {
      ...req.body,
      base64: {
        bytes: Buffer.from(b64, 'base64').length,
        sha256: createHash('sha256').update(b64).digest('hex'),
      },
    };
    expect(comparable).toEqual(GOLDEN.body);
  });

  it('is pure — building twice cannot differ, and nothing is sent', () => {
    /* Purity matters because it is what lets the request be compared against the
     * golden with no I/O at all. It is NOT a licence to build twice when wiring:
     * a provider that stamped a nonce would then record a different request than
     * it sent. Build once, reuse the object. */
    const a = swiftcheckProvider.buildRequest(input);
    const b = swiftcheckProvider.buildRequest(input);
    expect(a).toEqual(b);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('declares which body key holds the image, so redaction is not a literal', () => {
    // The caller redacts `raw_request` with the key written out by hand. That is
    // right for Swiftcheck and wrong for a provider that names the field anything
    // else — it would leave the whole image in the logs. The port carries the
    // name so the caller can stop guessing.
    const req = swiftcheckProvider.buildRequest(input);
    expect(req.imageField).toBe('base64');
    expect(Object.keys(req.body)).toContain(req.imageField);
  });

  it('send() lets the original rejection through, unwrapped', async () => {
    // THE ONE THING send() MUST NOT DO. `verifySlip`'s catch reads
    // `error.response.data` and `error.message`; a wrapper would change the row
    // written on failure and the customer-facing condition with it.
    const original = Object.assign(new Error('boom'), {
      response: { data: { success: false } },
    });
    mockedAxios.post.mockRejectedValueOnce(original);

    await expect(
      swiftcheckProvider.send(swiftcheckProvider.buildRequest(input)),
    ).rejects.toBe(original); // toBe, not toThrow — the SAME object, not a copy
  });

  it('send() passes the built request through to axios unchanged', async () => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { ok: 1 },
    });
    const req = swiftcheckProvider.buildRequest(input);

    const out = await swiftcheckProvider.send(req);

    expect(mockedAxios.post).toHaveBeenCalledWith(req.url, req.body, {
      headers: req.headers,
      timeout: req.timeoutMs,
    });
    expect(out).toEqual({ status: 200, data: { ok: 1 } });
  });
});

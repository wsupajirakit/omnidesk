import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  QR_PRESCAN_DEFAULT_MODE,
  resolveQrPrescanMode,
  shouldSkipSlipVerify,
} from '@/modules/webhook/qr-prescan';
import type { QrReadResult, QrReader } from '@/modules/webhook/qr-prescan';
import { defaultQrReader } from '@/modules/webhook/qr-prescan/qr-reader.adapter';

/**
 * [FEAT-20260812-QRPRESCAN] read a QR locally before paying Swiftcheck.
 *
 * THE RULE this pins: a QR was read ⇒ Swiftcheck still decides. No QR at all ⇒ skip the
 * call, because Swiftcheck answers VALIDATION_ERROR for those images every single time
 * (confirmed on live traffic 2026-08-12).
 *
 * ⚠️ THE PROPERTY THAT MATTERS MOST is fail-open: only a confident `no_qr` may skip.
 * Anything we could not read — corrupt file, oversized, timeout, a throwing library —
 * must still go to Swiftcheck. Inverting that would mean a customer transfers money and
 * their slip is never checked, which is far worse than one wasted API call. Several
 * cases below exist solely to keep that direction from being flipped.
 */

/** A reader we control, so the decision logic is tested without touching a file. */
const fakeReader = (reason: QrReadResult['reason'], text = ''): QrReader => ({
  read: () =>
    Promise.resolve({
      text: reason === 'qr_found' ? text || 'QRDATA' : null,
      reason,
      ms: 1,
    }),
});

describe('[FEAT-20260812-QRPRESCAN] mode resolution', () => {
  it('defaults to off when unset or unknown', () => {
    expect(resolveQrPrescanMode(undefined)).toBe('off');
    expect(resolveQrPrescanMode({})).toBe('off');
    expect(QR_PRESCAN_DEFAULT_MODE).toBe('off');
  });

  it('reads the two active modes', () => {
    expect(resolveQrPrescanMode({ qr_prescan_mode: 'log' })).toBe('log');
    expect(resolveQrPrescanMode({ qr_prescan_mode: 'skip' })).toBe('skip');
  });

  /** A typo must never enable a behaviour change on live traffic. */
  it.each(['Skip', 'on', 'true', 1, null, {}])(
    'falls back to off for junk value %s',
    (junk) => {
      expect(resolveQrPrescanMode({ qr_prescan_mode: junk })).toBe('off');
    },
  );
});

describe('[FEAT-20260812-QRPRESCAN] the decision', () => {
  const file = '/tmp/whatever.png';

  it("mode 'off' never runs the reader at all", async () => {
    const reader: QrReader = {
      read: () => {
        throw new Error('the reader must not be called when the mode is off');
      },
    };

    const d = await shouldSkipSlipVerify(
      { filePath: file, hook: {} },
      { reader },
    );

    expect(d).toMatchObject({
      skipSlipVerify: false,
      reason: 'not_run',
      mode: 'off',
    });
  });

  it("mode 'skip' + no QR ⇒ skips Swiftcheck — this is the saving", async () => {
    const d = await shouldSkipSlipVerify(
      { filePath: file, hook: { qr_prescan_mode: 'skip' } },
      { reader: fakeReader('no_qr') },
    );

    expect(d.skipSlipVerify).toBe(true);
    expect(d.reason).toBe('no_qr');
  });

  it("mode 'skip' + a QR found ⇒ still goes to Swiftcheck (Swiftcheck judges, not us)", async () => {
    const d = await shouldSkipSlipVerify(
      { filePath: file, hook: { qr_prescan_mode: 'skip' } },
      { reader: fakeReader('qr_found', '004100…') },
    );

    expect(d.skipSlipVerify).toBe(false);
    expect(d.reason).toBe('qr_found');
  });

  it("mode 'log' reports what it saw but never skips", async () => {
    const d = await shouldSkipSlipVerify(
      { filePath: file, hook: { qr_prescan_mode: 'log' } },
      { reader: fakeReader('no_qr') },
    );

    // Same finding as 'skip' above…
    expect(d.reason).toBe('no_qr');
    // …but the call still happens. That is the whole point of the 'log' step.
    expect(d.skipSlipVerify).toBe(false);
  });

  /**
   * ⭐ Fail-open. Every one of these means "we could not look", not "there is no QR",
   * so the image must still reach Swiftcheck even in 'skip' mode.
   */
  it.each(['undecodable', 'too_large', 'timeout'] as const)(
    "mode 'skip' + %s ⇒ still goes to Swiftcheck (fail-open)",
    async (reason) => {
      const d = await shouldSkipSlipVerify(
        { filePath: file, hook: { qr_prescan_mode: 'skip' } },
        { reader: fakeReader(reason) },
      );

      expect(d.skipSlipVerify).toBe(false);
      expect(d.reason).toBe(reason);
    },
  );

  it('a throwing reader never propagates — the flow proceeds unchanged', async () => {
    const reader: QrReader = {
      read: () => Promise.reject(new Error('boom')),
    };

    await expect(
      shouldSkipSlipVerify(
        { filePath: file, hook: { qr_prescan_mode: 'skip' } },
        { reader },
      ),
    ).resolves.toMatchObject({ skipSlipVerify: false, reason: 'undecodable' });
  });

  it('no file path ⇒ nothing to scan, nothing skipped', async () => {
    for (const filePath of [null, undefined, '']) {
      const d = await shouldSkipSlipVerify(
        { filePath, hook: { qr_prescan_mode: 'skip' } },
        { reader: fakeReader('no_qr') },
      );
      expect(d).toMatchObject({ skipSlipVerify: false, reason: 'not_run' });
    }
  });
});

/**
 * The adapter against real files. These are the images this repo already carries, so
 * the numbers are measured rather than asserted from a fixture someone wrote to pass.
 *
 * Skipped automatically when the folders are absent (a fresh clone has them, but a
 * pruned checkout may not), because a missing sample must not read as a failure.
 */
const SLIP_DIR = join(process.cwd(), 'todo', 'slip');
const SAMPLE_DIR = join(process.cwd(), 'todo', 'sample');
const images = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .map((f) => join(dir, f))
    : [];

const slips = images(SLIP_DIR);
const samples = images(SAMPLE_DIR);

(slips.length ? describe : describe.skip)(
  '[FEAT-20260812-QRPRESCAN] the reader on real images',
  () => {
    jest.setTimeout(60_000);

    it('finds a QR in the real slips, and reports no_qr for the rest', async () => {
      const found: string[] = [];
      const none: string[] = [];

      for (const f of slips) {
        const r = await defaultQrReader.read(f);
        // Whatever happens, the reader must never invent a reason outside its union.
        expect([
          'qr_found',
          'no_qr',
          'undecodable',
          'too_large',
          'timeout',
        ]).toContain(r.reason);
        (r.reason === 'qr_found' ? found : none).push(f);
      }

      /* Measured 2026-08-12: 14 of the 16 files carry a QR; the two that do not were
         opened by eye and are dashboard screenshots, not slips. Asserting a floor
         rather than an exact count keeps the test honest if more samples are added. */
      expect(found.length).toBeGreaterThanOrEqual(14);
      expect(found.length + none.length).toBe(slips.length);
    });

    it('a real slip payload is NOT the EMVCo 000201 prefix — the rejected criterion', async () => {
      /* Kept as an executable note. An early design filtered on payloads starting
         `000201`; every real slip here starts `0041`/`0046`/`0038`/`0039` instead,
         because `000201` belongs to a PromptPay QR for RECEIVING money, not to a
         transferred slip. That filter would have discarded every genuine slip. */
      const payloads: string[] = [];
      for (const f of slips) {
        const r = await defaultQrReader.read(f);
        if (r.text) payloads.push(r.text);
      }

      expect(payloads.length).toBeGreaterThan(0);
      expect(payloads.some((p) => p.startsWith('000201'))).toBe(false);
    });
  },
);

(samples.length ? describe : describe.skip)(
  '[FEAT-20260812-QRPRESCAN] no false positives on non-slip images',
  () => {
    jest.setTimeout(60_000);

    it('reports no_qr for every sample image', async () => {
      for (const f of samples) {
        const r = await defaultQrReader.read(f);
        expect(r.reason).toBe('no_qr');
        expect(r.text).toBeNull();
      }
    });
  },
);

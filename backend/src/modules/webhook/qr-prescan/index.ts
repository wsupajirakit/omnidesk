/*
 * ==== [FEAT-20260812-QRPRESCAN] "pre QR check" — should this image be verified? ====
 *
 * NAME: the owner calls this step the **pre QR check**. It runs before the account
 * check and before the paid slip verification.
 *
 * THE ONE ENTRY POINT of this feature. The webhook imports `shouldSkipSlipVerify`
 * from here and nothing else; the QR library lives behind `qr-reader.adapter.ts` and
 * is never referenced outside this folder.
 *
 * THE RULE — two cases, decided by the owner on 2026-08-12:
 *     a QR was read      → send it to Swiftcheck, let Swiftcheck judge whether it is a slip
 *     no QR at all       → skip Swiftcheck; the flow continues exactly as it does today
 *                          when Swiftcheck answers 400 VALIDATION_ERROR
 *
 * ⚠️ WHY THE RULE IS "ANY QR" AND NOT "A SLIP-SHAPED QR"
 *   An earlier proposal was to accept only payloads starting `000201`. Measured against
 *   the 62 real slips on this machine, **not one** of them starts with that: they begin
 *   `004100`, `004600`, `003800`, `003900`, `004500`. `000201` is the EMVCo prefix of a
 *   PromptPay QR used to RECEIVE money, while a transferred slip carries a different
 *   BOT format whose first four digits are a length. Filtering on `000201` would have
 *   discarded every genuine slip. Reading the payload at all is therefore deliberately
 *   avoided here: Swiftcheck already knows how to tell a slip from a picture, and this
 *   gate exists only to stop paying it for images that plainly contain no code.
 *
 * WHAT IT SAVES: an image with no QR costs one Swiftcheck call today and returns
 * VALIDATION_ERROR every time. Verified on a live message 2026-08-12: Swiftcheck answered
 * `{"code":"VALIDATION_ERROR"}` for an ordinary photo.
 *
 * ⚠️ FAIL-OPEN IS THE WHOLE SAFETY MODEL
 *   Only a confident `no_qr` skips Swiftcheck. A file we could not decode, one too large
 *   to read, a timeout, a thrown error, the library failing to load — every one of
 *   those sends the image to Swiftcheck as before. Getting this backwards would mean a
 *   customer transfers money and the slip is never checked; paying for one extra API
 *   call is the cheaper mistake by a wide margin.
 *
 * revert: delete this folder + the `[FEAT-20260812-QRPRESCAN]` block in
 *         webhook.service.ts + the `qr_prescan_mode` Prop, its allowlist entry and its
 *         tab mapping + `pngjs`/`jpeg-js`/`jsqr` from package.json.
 */
import type { QrReadResult, QrReader } from './qr-reader.adapter';
import { defaultQrReader } from './qr-reader.adapter';

export type { QrReadResult, QrReader } from './qr-reader.adapter';

/**
 * How the pre-scan behaves for one OA.
 *
 *   'off'    (default) — never runs; not even the library is loaded. Byte-identical to
 *                        the behaviour before this feature existed.
 *   'log'    — reads the image and reports what it found, but never skips Swiftcheck.
 *              Use this to watch real traffic before trusting the gate.
 *   'skip'   — reads the image and skips Swiftcheck when there is definitely no QR.
 */
export type QrPrescanMode = 'off' | 'log' | 'skip';

export const QR_PRESCAN_DEFAULT_MODE: QrPrescanMode = 'off';

/**
 * Read the mode off a hook, tolerating whatever an operator stored.
 * ⚠️ Anything unrecognised is 'off' — a typo must not switch on a behaviour change.
 */
export function resolveQrPrescanMode(
  hook: Record<string, unknown> | null | undefined,
): QrPrescanMode {
  const raw = hook?.['qr_prescan_mode'];
  return raw === 'log' || raw === 'skip' ? raw : QR_PRESCAN_DEFAULT_MODE;
}

export interface QrPrescanInput {
  /** Absolute path of the downloaded image. Empty/missing ⇒ nothing to scan. */
  filePath: string | null | undefined;
  hook: Record<string, unknown> | null | undefined;
}

export interface QrPrescanDecision {
  /** Skip the Swiftcheck call? Only ever true in 'skip' mode with a confident `no_qr`. */
  skipSlipVerify: boolean;
  /** What the reader concluded — 'not_run' when the mode is off or there is no file. */
  reason: QrReadResult['reason'] | 'not_run';
  /** Read duration in ms; 0 when the reader never ran. */
  ms: number;
  /** The mode that produced this decision, for logging. */
  mode: QrPrescanMode;
}

/** Injectable for tests; production always uses the adapter next door. */
export interface QrPrescanDeps {
  reader?: QrReader;
}

/**
 * Decide whether the Swiftcheck call can be skipped for this image.
 *
 * ⚠️ NEVER THROWS. It sits directly in front of the slip-verification call on the path
 *    a customer is waiting on, so every failure resolves to "do what we did before".
 */
export async function shouldSkipSlipVerify(
  input: QrPrescanInput,
  deps: QrPrescanDeps = {},
): Promise<QrPrescanDecision> {
  const mode = resolveQrPrescanMode(input.hook);

  // 'off' short-circuits before the adapter is even imported.
  if (mode === 'off' || !input.filePath) {
    return { skipSlipVerify: false, reason: 'not_run', ms: 0, mode };
  }

  let result: QrReadResult;
  try {
    const reader = deps.reader ?? defaultQrReader;
    result = await reader.read(input.filePath);
  } catch {
    /* The adapter already swallows its own errors; this is the belt to its braces. */
    return { skipSlipVerify: false, reason: 'undecodable', ms: 0, mode };
  }

  /* `no_qr` is the ONLY verdict that may skip Swiftcheck, and only in 'skip' mode.
     'log' deliberately reports the same reason while still sending the image on. */
  const skipSlipVerify = mode === 'skip' && result.reason === 'no_qr';

  return { skipSlipVerify, reason: result.reason, ms: result.ms, mode };
}

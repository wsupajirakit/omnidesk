/**
 * legacy:2457-2474 — the LINE signature, re-checked.
 *
 * ⚠️ THIS IS A RE-CHECK, AND THE LOG SAYS SO. The controller guard already validated the
 * same bytes with the same secret before answering 200. Reaching a failure here means the
 * two checks DISAGREED — which is why the warning names the secret's state rather than
 * just saying "invalid": the useful question is whether the secret is empty, still
 * ciphertext, or fine and the bodies differ.
 *
 * ⚠️ `meta.rawBody ?? JSON.stringify(body)` is legacy's own fallback and is kept. A
 * re-serialised body can hash differently from the bytes LINE signed, which is exactly the
 * disagreement this gate exists to report.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const verifySignatureStep: LadderStep = {
  id: 'verify-signature',
  describe: 're-check the LINE signature and stop when the two checks disagree',
  enabled: true,
  mustPrecede: ['reread-event'],
  orderNote:
    'nothing may be read out of a body whose signature has not been confirmed ' +
    '(webhook.service.ts:2052)',
  reads: ['meta', 'body', 'creds', 'hook', 'alias', 'hookSource'],

  run: (ctx, deps): StepVerdict => {
    const signature = ctx.meta.signature;
    const { channelSecret } = ctx.creds;
    if (
      deps.validateSignature(
        ctx.meta.rawBody ?? JSON.stringify(ctx.body),
        signature,
        channelSecret,
      )
    ) {
      return 'continue';
    }
    const rawSecret =
      (ctx.hook?.['channel_secret'] as string) ??
      (ctx.hook?.['line_secret'] as string) ??
      '';
    const secretState = !channelSecret
      ? 'empty/undecryptable'
      : typeof rawSecret === 'string' && rawSecret.startsWith('enc:')
        ? 'ciphertext(undecryptable)'
        : 'present';
    deps.warn(
      `[SIGNATURE] 401 (controller re-check) alias=${ctx.alias} source=${ctx.hookSource} ` +
        `secret=${secretState} hasSignature=${!!signature} usingRawBody=${!!ctx.meta.rawBody} ` +
        `(note: middleware already validated; reaching here implies a secret/body mismatch between the two checks)`,
    );
    return 'done';
  },
};

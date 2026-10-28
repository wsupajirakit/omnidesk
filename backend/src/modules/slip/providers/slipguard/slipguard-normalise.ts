/**
 * ==== [FEAT-20260903-SLIPGUARD] SlipGuard's envelope, translated into the shared one =
 *
 * The flow was written against Swiftcheck, so Swiftcheck's tree IS the shared tree.
 * SlipGuard answers a DIFFERENT SHAPE — flat under `data`, with its own field names
 * and its own idea of a date — and this file is the only place that knows it. The
 * row builder, the card router and the Shop-API hand-off never learn a second
 * vocabulary; that is what the response seam exists for.
 *
 * ⚠️ STRUCTURAL, NOT A RENAME. Swiftcheck nests the slip under `data.rawSlip`;
 * SlipGuard puts it flat under `data`. This re-nests.
 *
 * 🔴 EVERY FIELD IS OPTIONAL, MEASURED. The captured responses differ by outcome —
 * a success carries `qrcodeData` and a `data.success`, the `1012` reply carries
 * neither, and roughly a third of the fields come back `null` on a domestic
 * transfer. Reading anything as required here would throw on a live conversation.
 *
 * 📄 Evidence: `docs/slipguard-proof/*.local.json` (gitignored — they carry slip
 * data). Contract: `docs/slip-spec.md` §6.3.
 *
 * revert: delete this folder and the line that registers it in `../index.ts`.
 */
import { slipGuardVerdictFor } from './slipguard-error-codes';

/** What SlipGuard actually sends, as measured. Every member optional on purpose. */
interface SlipGuardBody {
  success?: boolean;
  code?: number;
  message?: string;
  data?: SlipGuardData;
}

interface SlipGuardParty {
  displayName?: string | null;
  name?: string | null;
  account?: { type?: string | null; value?: string | null } | null;
  proxy?: { type?: string | null; value?: string | null } | null;
}

interface SlipGuardData {
  success?: boolean;
  transRef?: string | null;
  sendingBank?: string | null;
  receivingBank?: string | null;
  transDate?: string | null;
  transTime?: string | null;
  transTimestamp?: string | null;
  sender?: SlipGuardParty | null;
  receiver?: SlipGuardParty | null;
  amount?: number | null;
  ref1?: string | null;
}

/**
 * ══ 🔴 THE DATE, AND IT IS THE MOST DANGEROUS FIELD IN THIS FILE ═════════════
 *
 * `parseBangkokSlipDateMs` (`slip-flex.handler.ts`) matches
 * `YYYY-MM-DD[ T]HH:mm[:ss]` **anchored at the start** and rebuilds the string
 * with a HARDCODED `+07:00`, discarding any trailing offset — including a `Z`.
 *
 * TWO WAYS TO GET THIS WRONG, and both are silent:
 *
 *   1. FORWARD `transTimestamp`. It is UTC (`…Z`, measured: 24 chars). The parser
 *      throws the `Z` away and stamps `+07:00`, so the slip reads **7 hours
 *      older than it is**. With any `slip_check_out_of_time` under seven hours,
 *      EVERY slip from this provider is flagged out-of-time and answered with the
 *      expired-slip card. Nothing errors; the check simply always fires.
 *
 *   2. CONCATENATE `transDate` AND `transTime` NAIVELY. 🔴 `transDate` is
 *      **eight digits with no separators** — `YYYYMMDD`, measured, which the
 *      spec's own mapping table does not say. `"20260812 17:08:36"` does not
 *      match the parser's anchored pattern at all, so it logs and leaves
 *      `violationDetected` false ⇒ **the out-of-time check is silently SKIPPED
 *      for every slip.** No error, no card, one log line.
 *
 * ⇒ SO THIS FUNCTION INSERTS THE SEPARATORS AND STAMPS `+07:00` EXPLICITLY.
 * `transDate`/`transTime` are already Bangkok local, so the offset is a
 * statement of what they already are, not a conversion.
 *
 * WHY `+07:00` AND NOT THE BARE `YYYY-MM-DD HH:mm:ss` the port also allows:
 * there are TWO readers, not one. Besides the parser, `slip-flow.service.ts`
 * does `new Date(rawSlip.date)` for `transaction_date` — and `new Date()` reads
 * a bare form in the SERVER's timezone, which is UTC on a deployed box. The
 * explicit offset is correct for both readers; the bare form is correct for only
 * one. ใส่ +07:00 ให้ชัด เพราะมีคนอ่านสองคน ไม่ใช่คนเดียว
 *
 * @returns the composed instant, or `undefined` when the parts are unusable —
 * never a half-built string, because a string the parser cannot read is worse
 * than an absent one: absent is visible, unparseable is skipped in silence.
 */
export const slipGuardBangkokDate = (
  transDate?: string | null,
  transTime?: string | null,
): string | undefined => {
  const d = String(transDate ?? '').trim();
  const t = String(transTime ?? '').trim();
  // Exactly eight digits, and a real HH:mm:ss — anything else is not the shape
  // this was measured against, and guessing at it is how the silent skip starts.
  if (!/^\d{8}$/.test(d) || !/^\d{2}:\d{2}:\d{2}$/.test(t)) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t}+07:00`;
};

/** Swiftcheck's `name` block is `{th, en}`; SlipGuard sends one string. */
const nameBlock = (party?: SlipGuardParty | null) => {
  const name = party?.name ?? party?.displayName ?? '';
  /* Both slots carry the SAME string on purpose. The row builder reads
     `name.th || name.en`, so filling only one would work today and break the day
     someone reorders that fallback — and SlipGuard does not distinguish the two. */
  return { th: name, en: name };
};

/**
 * Re-nest one SlipGuard party into the tree the row builder reads.
 *
 * ⚠️ ACCOUNT NUMBERS ARRIVE MASKED (`XXX-X-XX123-4`, measured). They are passed
 * through UNCHANGED: the row stores what the vendor said, and any comparison is
 * somebody else's job. Normalising here would silently change what an operator
 * sees next to a slip.
 */
const party = (p: SlipGuardParty | null | undefined, bankCode: string) => ({
  account: {
    /* Swiftcheck puts the bank account at `account.bank.account` and the PromptPay
       proxy at `account.proxy.account`. SlipGuard's `account.value` /
       `proxy.value` are the same two facts under different names. */
    bank: { account: p?.account?.value ?? '' },
    proxy: { account: p?.proxy?.value ?? '' },
    name: nameBlock(p),
  },
  /* 🔴 A 3-DIGIT CODE, NOT A NAME. Swiftcheck sends `bank.short` / `bank.name` as
     words; SlipGuard sends `sendingBank` / `receivingBank` as codes — which is what
     `bank-logo-code.map.ts` already wants, so the code is the more useful of the
     two here. The row's `*_bank` column therefore holds a code for SlipGuard rows
     and a word for Swiftcheck rows: stated plainly because anything reading those
     columns across providers has to know.
     Both slots carry it because the row builder reads `short || name`. */
  bank: { short: bankCode, name: bankCode },
});

/**
 * The shared envelope for a reply SlipGuard considered successful, or for one of the
 * two failures that are really business answers.
 *
 * @param flags what the caller decided about this outcome — see the fold table in
 * `slipguard.provider.ts`. They are SYNTHESISED because a SlipGuard success carries
 * neither flag: `isDuplicate` and `matchedAccount` exist only as absences.
 */
export const slipGuardToSharedEnvelope = (
  body: SlipGuardBody,
  flags: { isDuplicate?: boolean; matchedAccount?: boolean },
): Record<string, unknown> => {
  const d = body.data ?? {};
  const sender = party(d.sender, d.sendingBank ?? '');
  const receiver = party(d.receiver, d.receivingBank ?? '');

  return {
    success: true,
    data: {
      ...flags,
      amountInSlip: d.amount ?? 0,
      rawSlip: {
        transRef: d.transRef ?? '',
        date: slipGuardBangkokDate(d.transDate, d.transTime),
        amount: { amount: d.amount ?? 0 },
        sender,
        receiver,
      },
      /* The vendor's own reply, kept whole under a namespaced key so nothing is
         lost for an operator reading the row — and so a future field can be used
         without another round of re-nesting. It is NOT merged into the tree
         above: a stray `success` or `code` at that level would be read by the
         flow as ours. */
      slipguard: d,
    },
  };
};

/**
 * The shared envelope for a genuine failure.
 *
 * ⚠️ THE CODE IS PASSED THROUGH AS THE VENDOR'S OWN. It is deliberately NOT
 * translated into Swiftcheck's string vocabulary (`SLIP_NOT_FOUND`, …): the flex
 * router branches on those strings and falls through to `hook.flex_error` for
 * anything else, which is exactly the decision recorded for SlipGuard's operational
 * codes (`docs/slip-spec.md` §1/§5 of the 03/09 decisions). Mapping `1011` onto
 * `SLIP_NOT_FOUND` would quietly re-route a vendor we have never shown a customer
 * a card for. ห้ามแปลงโค้ดของเจ้าอื่นเป็นคำของ Swiftcheck
 */
export const slipGuardToSharedError = (
  body: SlipGuardBody,
): Record<string, unknown> => ({
  success: false,
  error: {
    code: body.code,
    message: body.message ?? '',
    // named so a reader of the row can tell which vendor's numbering this is
    provider: 'slipguard',
    verdict: slipGuardVerdictFor(body.code),
  },
});

export type { SlipGuardBody, SlipGuardData };

/** Narrow an unknown body to the shape above. Total — never throws. */
export const asSlipGuardBody = (raw: unknown): SlipGuardBody =>
  raw && typeof raw === 'object' ? raw : {};

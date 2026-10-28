/**
 * [FEAT-20260830-TRAYDATA] the sticker picker's data — moved VERBATIM out of
 * TicketChat.tsx. Pure data + one tiny range helper, nothing else.
 *
 * Official LINE send-only stickers (bots may send ONLY these — no runtime list
 * API exists; seeded from developers.line.biz/en/docs/messaging-api/sticker-list).
 * Rendered via the (unofficial but stable) stickershop CDN.
 *
 * To ADD MORE later, either list ids explicitly or use range(first, count) for
 * the packs whose ids are consecutive (11537/11538/11539 each run 40 in a row):
 *   { packageId: '11537', stickerIds: range(52002734, 40) }
 * Keep it a flat data table — nothing else needs to change to grow the picker.
 * revert: inline back above ChatInputBox and delete composer-trays/.
 */
export interface StickerPack {
  packageId: string;
  stickerIds: string[];
}

const range = (first: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => String(first + i));

/* [FEAT-20260830-MORESTICKERS] 5 → 13/14 per pack (+50, owner 30/08). Every id
   stays within the first 14 of its pack's official range — the doc collapses
   each pack to 5 in the DOM, but no send-only pack is smaller than 24, so these
   offsets cannot step outside developers.line.biz/en/docs/messaging-api/sticker-list.
   Deepest id of every pack answered HTTP 200 on the sticker CDN (checked 30/08). */
export const STICKER_PACKS: StickerPack[] = [
  { packageId: '446', stickerIds: range(1988, 13) },
  { packageId: '789', stickerIds: range(10855, 13) },
  { packageId: '1070', stickerIds: range(17839, 13) },
  { packageId: '11537', stickerIds: range(52002734, 13) },
  { packageId: '11538', stickerIds: range(51626494, 14) },
  { packageId: '11539', stickerIds: range(52114110, 14) },
  /* [FEAT-20260830-PACKS2] owner 30/08: add 6362 + 8522 (asked as "6632", which
     does not exist on the official list — 6362 is the pack it names; first ids
     verified from the doc fetch: 6362 → 11087920, 8522 → 16581266). 11537/11538
     were also asked and are ALREADY above — skipped as duplicates. 6359/6325
     explicitly excluded by the owner. */
  { packageId: '6362', stickerIds: range(11087920, 13) },
  { packageId: '8522', stickerIds: range(16581266, 13) },
];

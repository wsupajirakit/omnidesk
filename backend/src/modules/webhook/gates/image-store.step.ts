/**
 * legacy:2800-2813 — an image arrived: store it, and read back what the rest of the turn
 * needs from the stored row.
 *
 * ⚠️ THE PROBES ARE NOT DECORATION. `[OBS-20260812-IMGPROBE]` is the only place the three
 * hook settings that decide this whole path appear together with the profile verdict, and
 * it is what makes "ทำไมการ์ดไม่ออก" answerable at all. They are gated behind
 * `IMG_FLOW_PROBE`, so an operator pays nothing for them until they ask.
 *
 * ⚠️ THE STORAGE READ IS WRAPPED, and the catch is load-bearing: a failed read must not
 * cost the customer their reply. Without it the image is stored, the row exists, and the
 * turn dies on a lookup — with the picture already paid for.
 */

import { imgProbe, imgProbeSettings } from '../logging/img-flow-probe';
import { maskPersonalForLog } from '../logging/personal-log-mask';

import type { LadderStep, StepVerdict } from './ladder.types';

export const imageStoreStep: LadderStep = {
  id: 'image-store',
  describe: 'download the inbound image and read back its url and file path',
  enabled: true,
  reads: [
    'event',
    'userId',
    'hook',
    'customerName',
    'meta',
    'profileBlock',
    'profileCircuitOpen',
  ],
  writes: ['media', 'slip'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    /* [OBS-20260812-IMGPROBE] the settings are dumped HERE, not earlier, so every probe
       timeline starts with the three that decide the rest of this path. */
    imgProbeSettings(ctx.hook);
    imgProbe('image-in', {
      user: ctx.userId,
      messageId: ctx.event.message?.id,
      customerName: maskPersonalForLog(ctx.customerName), // [FEAT-20261016-LOGMASK80] log copy only
      profileOk: ctx.profileBlock?.['success'],
      profileStatus: ctx.profileBlock?.['status'],
      circuitOpen: ctx.profileCircuitOpen,
      registered: ctx.customerName !== 'N/A',
    });

    const storageId = await deps.downloadImage(String(ctx.event.message?.id));
    if (!storageId) return 'continue';
    /* ⚠️ THE ID IS STORED RAW AND THE URL-SAFE STRING IS DERIVED, not the other way round.
       `internalContentId` has always been `String(storageId)` (legacy:2687) because it
       travels into chat rows; `slip.storageId` has always been the ObjectId itself,
       because `verifySlip` writes it into an ObjectId column. Two consumers, two shapes,
       one source. เก็บของจริงไว้ แล้วค่อยแปลงให้คนที่ต้องการ string */
    ctx.slip.storageId = storageId;
    ctx.media.internalContentId = String(storageId);

    const storage = await deps.readImageStorage(storageId);
    if (storage) {
      ctx.media.mediaUrl = `${ctx.meta.baseUrl}${String(storage['image_url'])}`;
      /* [FIX-20260808-SLIPFLOW] legacy:2827 reads `storage.file_path` off this same row
         for the Swiftcheck call and, later, the flex branch. */
      ctx.slip.storageFilePath =
        (storage['file_path'] as string | undefined) ?? null;
    }
    return 'continue';
  },
};

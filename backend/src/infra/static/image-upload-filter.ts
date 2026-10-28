/**
 * ==== [FIX-20260818-UPLOADFILTER] Only accept what this service can serve =====
 * plan §2.4 B1 = T1-3 of fix_plan_18_aug · closes C6 (leg 2)
 * ===========================================================================
 *
 * THE HOLE. Both upload routes took `extname(file.originalname)` and used it as
 * the stored extension, with no `fileFilter` and without ever reading
 * `file.mimetype`. So `evil.html` was written to the public uploads directory
 * under its own extension. Combined with the missing security headers on that
 * directory — closed separately as A3 — a stored HTML file rendered as a document
 * in the service's own origin.
 *
 * THE RULE IS NOT NEW, it was only enforced on one side. `IMAGE_MIME` in
 * `hardened-image-serve.middleware.ts` already limits what can be SERVED to five
 * extensions. Anything else uploaded today is a file that cannot be fetched back
 * through the normal path — dead weight on disk. Refusing it at the door removes
 * only what was already unusable, which is why this is safe rather than a
 * behaviour change. ขาเข้าตรงกับขาออก แค่นั้น
 *
 * ⚠️ IMPORTED, NEVER COPIED. If the two lists ever drift, one side accepts what
 * the other refuses and the bug returns wearing a different shape.
 *
 * ⚠️ MIME is checked TOO, not instead. `originalname` is attacker-controlled, so
 * an allowed extension alone proves nothing; the browser-supplied `mimetype` is
 * also attacker-controlled, so neither is trusted alone. Requiring BOTH to agree
 * with the same table is what makes a mismatch — `shell.php` renamed `.png`, or a
 * `.png` announced as `text/html` — fail here rather than at serve time.
 *
 * revert: delete this file and the `fileFilter` line in the two controllers.
 */

/**
 * [FIX-20260904-UPLOAD400] The rule itself now lives in `upload-gate.ts`, which
 * this file configures. It used to be written out here and again, identically,
 * in `video-upload-filter.ts` — two copies of one rule, and the next fix would
 * have landed on one of them. One pipe, not two edits.
 *
 * 🔴 THIS FILTER GUARDS THREE ROUTES, NOT ONE: the object album image upload
 * (`image-storage.controller.ts:96`), the object album's sibling video route
 * next to it, and `chat-media.controller.ts:75` — an operator attaching an
 * image to a chat. The 500 → 400 change therefore lands on the chat path too.
 * That is intended (an operator picking a `.bmp` was told the server had
 * broken), but it means an edit here is never local to the album.
 * An edit here moves three routes, not one.
 *
 * ⚠️ WHAT IS ACCEPTED DID NOT CHANGE: the same five extensions, the same
 * `image/jpg` alias, the same both-must-agree rule. Only the ANSWER to a
 * refusal changed — 400 with the allowed list named, instead of 500.
 */

import { IMAGE_MIME } from './hardened-image-serve.middleware';
import { makeUploadFilter } from './upload-gate';

export const imageUploadFilter = makeUploadFilter({
  family: 'image',
  errorName: 'UnsupportedImageTypeError',
  table: IMAGE_MIME,
  /* `image/jpg` is not a registered type, but browsers and older clients send
     it for `.jpg` and legacy accepted whatever arrived. This one alias is the
     whole compatibility surface; everything else must match the table exactly. */
  aliases: { 'image/jpg': 'image/jpeg' },
});

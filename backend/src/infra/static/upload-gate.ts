import { extname } from 'node:path';

import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * [FIX-20260904-UPLOAD400] One gate for every upload: the rule, the refusal and
 * the status code an admin's browser sees.
 * ===========================================================================
 *
 * ### Why it exists
 *
 * Two filters (image, video) had grown the SAME algorithm written twice —
 * read the extension, look it up in a table, require the declared MIME to
 * agree, refuse otherwise — and each threw its own plain `Error`. Two costs
 * came out of that:
 *
 *  1. Nest's multer bridge forwards anything that is not an `HttpException`
 *     untouched, so the catch-all filter answered
 *     `500 {"error":"internal error"}`. An admin who picked the wrong file was
 *     told the SERVER had broken, and the dashboard had nothing better to show.
 *  2. Two copies of one rule drift. The next fix lands on one of them.
 *
 * Owner, 04/09: answer 400, name the extensions we accept, don't create debt,
 * and merge the pipe rather than patch both ends.
 * A wrong file is the sender's mistake, so answer 4xx; and merge the rule
 * rather than maintaining it in two places.
 *
 * ### What it deliberately does NOT do
 *
 * No registry of families, no self-registration, no lookup by name. Each family
 * hands over its own table at the call site and gets a filter back. Machinery
 * for a family that does not exist yet would be the debt this change is
 * avoiding. Nothing is built ahead of need: there are exactly two callers.
 *
 * ### How to change it
 *
 *   status for EVERY refusal      → `UPLOAD_REFUSAL_STATUS`, one line
 *   wording an admin reads        → `unsupportedUploadMessage`, one place
 *   allowed extensions            → the family's own table (`IMAGE_MIME`,
 *                                   `VIDEO_MIME`) — never listed here
 *   a new family (audio, pdf, …)  → one `makeUploadFilter({...})` call beside
 *                                   its table; nothing in this file changes
 *
 * ⚠️ THE DESTINATIONS STAY SEPARATE. Sharing this code does NOT widen anything:
 * each family keeps its own table, its own route, its own multer destination
 * and its own byte cap. An `.mp4` still cannot reach `public/uploads/images`.
 * Videos must never mix with images: the RULE is shared, the storage is not.
 *
 * ⚠️ The dashboard renders its own localized sentence from its own copy of the
 * allowed list (`components/object/gallery/uploadKind.ts`), guarded against
 * these tables by a drift test. This message is the fallback for any client
 * that does not — never the only place the rule is stated.
 *
 * revert: delete this file; give each filter back its own inline copy of the
 *   check and an `Error` subclass. Refusals keep working and go back to 500.
 */

/** The multer callback shape, spelled out so no controller needs `any`. */
export type UploadFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

/** What multer hands the filter. Both fields are attacker-controlled. */
export interface UploadCandidate {
  originalname?: string;
  mimetype?: string;
}

export type UploadFileFilter = (
  req: unknown,
  file: UploadCandidate,
  cb: UploadFileFilterCallback,
) => void;

/**
 * The status every refused upload answers with.
 *
 * 🔴 400, BY THE OWNER'S CALL ON 04/09. The book answer is **415 Unsupported
 * Media Type** — RFC 9110 §15.5.16 describes exactly this case, and that is
 * what a public API should send. It is one line away: change this constant and
 * every refusal follows, with no other edit anywhere.
 * The reason 400 was chosen instead is the client: the dashboard's
 * `handleApiResponse` already treats 4xx as "read the message", the message is
 * what the admin acts on, and one status for one class of mistake was worth
 * more here than the finer code. Documented rather than silently "improved" —
 * a future reader must be able to see this was a decision, not an oversight.
 */
export const UPLOAD_REFUSAL_STATUS = HttpStatus.BAD_REQUEST;

/**
 * Why a file was refused.
 *
 * `extension`     — the extension is not on the family's table at all
 * `mime-mismatch` — the extension IS allowed, but the declared content type
 *                   disagrees with it (a renamed file, or a truly broken one)
 */
export type UploadRefusalReason = 'extension' | 'mime-mismatch';

/**
 * The sentence the client gets.
 *
 * Names the EXTENSION, never the path — the message crosses the network, and a
 * filesystem path in it would hand server layout to whoever posted the file.
 * The allowed list comes from the caller's table, so adding a container updates
 * every message with no edit here.
 */
export function unsupportedUploadMessage(
  family: string,
  originalname: string,
  allowedExtensions: readonly string[],
  reason: UploadRefusalReason = 'extension',
): string {
  const ext = extname(originalname).toLowerCase() || '(none)';
  const allowed = allowedExtensions.join(', ');

  /* 🔴 THE TWO REFUSALS READ DIFFERENTLY BECAUSE THEY ARE DIFFERENT PROBLEMS.
     Both used to say "Unsupported video type: .mp4. Allowed: .mp4", which is
     the sentence a mismatched MIME produced — the extension IS allowed, so the
     admin reads a contradiction and has nothing to act on. Seen live on 04/09
     while proving the 400, and fixed rather than left as a curiosity.
     ประโยคต้องตรงกับเหตุ ไม่งั้นบอกไปก็ไม่ช่วยอะไร */
  if (reason === 'mime-mismatch') {
    return `File content does not match its ${ext} extension. Re-save it as a real ${family} file, or rename it to its true type. Allowed: ${allowed}`;
  }

  return `Unsupported ${family} type: ${ext}. Allowed: ${allowed}`;
}

/**
 * The refusal itself.
 *
 * ⚠️ `name` is set by hand because `HttpException` would otherwise report
 * `HttpException` for every family, and the suites assert on this string to
 * prove WHICH gate refused — a distinction the status code cannot carry.
 */
export class UnsupportedUploadTypeError extends HttpException {
  constructor(
    errorName: string,
    family: string,
    readonly filename: string,
    allowedExtensions: readonly string[],
    readonly reason: UploadRefusalReason = 'extension',
  ) {
    super(
      unsupportedUploadMessage(family, filename, allowedExtensions, reason),
      UPLOAD_REFUSAL_STATUS,
    );
    this.name = errorName;
  }
}

/** Everything one media family needs to describe itself to the gate. */
export interface UploadFamily {
  /** The word that appears in the message: "Unsupported video type: …". */
  family: string;
  /** What the thrown error reports as `name`; suites assert on it. */
  errorName: string;
  /** Allowed extension → the MIME that extension must be declared as. */
  table: Readonly<Record<string, string>>;
  /**
   * Declared MIME values to forgive, mapped to the canonical one.
   *
   * Exists for exactly one real case: browsers and older clients send
   * `image/jpg` for `.jpg`, which is not a registered type, and legacy accepted
   * whatever arrived. Video has no such history and passes nothing here — an
   * exact match is the whole rule there.
   */
  aliases?: Readonly<Record<string, string>>;
}

/**
 * Build the `fileFilter` for one family.
 *
 * The rule, stated once: an allowed extension alone proves nothing, because
 * `originalname` is attacker-controlled — and the declared `mimetype` is too,
 * so neither is trusted alone. BOTH must agree with the same table. That is
 * what makes `shell.php` renamed `.png`, or an `.mp4` announced as `text/html`,
 * fail at the door instead of at serve time.
 */
export function makeUploadFilter(spec: UploadFamily): UploadFileFilter {
  const allowed = Object.keys(spec.table);

  const refuse = (
    originalname: string,
    reason: UploadRefusalReason,
  ): UnsupportedUploadTypeError =>
    new UnsupportedUploadTypeError(
      spec.errorName,
      spec.family,
      originalname,
      allowed,
      reason,
    );

  return (_req, file, cb) => {
    const originalname = file.originalname || '';
    const ext = extname(originalname).toLowerCase();
    const expected = spec.table[ext];

    if (!expected) {
      cb(refuse(originalname, 'extension'), false);
      return;
    }

    const declared = (file.mimetype || '').toLowerCase();
    const canonical = spec.aliases?.[declared] ?? declared;

    if (canonical !== expected) {
      cb(refuse(originalname, 'mime-mismatch'), false);
      return;
    }

    cb(null, true);
  };
}

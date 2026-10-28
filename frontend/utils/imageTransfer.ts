/**
 * [FEAT-20260816-MULTIIMG] Pull image Files out of a browser transfer, up to the
 * caller's free slots (the composer stages at most 5).
 *
 * Two entrances share this file because they share the SAME gate and cap:
 *   · `imageFilesFromPaste` — Ctrl+V (`ClipboardEvent.clipboardData`)
 *   · `imageFilesFromDrop`  — drag & drop (`DragEvent.dataTransfer`)
 * [FEAT-20260818-DROPIMAGE] added the second one and renamed the file from
 * `imagePaste.ts`; keeping them apart would let the image/* filter and the
 * append-cap drift between entrances, which is exactly the bug this file exists
 * to prevent. ทางเข้าเพิ่มได้ แต่ประตูต้องบานเดียว — เพิ่ม entrance ที่นี่เท่านั้น.
 *
 * Supersedes the same-day single-image version ([FEAT-20260816-PASTEIMAGE]):
 * the composer now appends instead of replacing, so the helper returns an
 * ordered array capped at `max` — pass `5 - staged.length`, and a full tray
 * (max 0) naturally yields [] so the default paste proceeds untouched.
 *
 * Lives in its own file, not in TicketChat.tsx: the composer file is 4,400+
 * lines and on the max-lines waiver — the rule there is shrink-only. This is
 * also the piece worth testing without a browser, so it must be importable on
 * its own (`test/imageTransfer.test.ts`).
 *
 * Behaviour contract, matched to the picker flow both feed:
 *   · only image/* FILE items count — a paste/drop of text/HTML/other kinds
 *     returns [] so the caller lets the default action happen untouched
 *   · order preserved, capped at `max`
 *   · screenshots arrive named "image.png" from most OSes; each File is
 *     stamped `paste-<ts>-<n>.<ext>` / `drop-<ts>-<n>.<ext>` so several files
 *     from ONE gesture (and consecutive ones) stay distinguishable in logs and
 *     DB rows — the name is display/trace only, nothing parses it
 *
 * revert: delete this file, its test, and the onPaste + drop wiring in
 * TicketChat.tsx.
 */

/** clipboard shape accepted — a DOM ClipboardEvent or React's wrapper */
export interface PasteLike {
  clipboardData: {
    items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  } | null;
}

/** Rename to `<prefix>-<ts>-<n>.<ext>`; shared so both entrances name alike. */
const stamp = (file: File, prefix: string, ts: number, n: number): File => {
  const ext = (file.type.split('/')[1] || 'png').split('+')[0];
  return new File([file], `${prefix}-${ts}-${n}.${ext}`, { type: file.type });
};

const takeImages = (
  files: ArrayLike<File>,
  max: number,
  prefix: string,
): File[] => {
  const out: File[] = [];
  const ts = Date.now();
  for (let i = 0; i < files.length && out.length < max; i++) {
    const file = files[i];
    if (!file || !file.type.startsWith('image/')) continue;
    out.push(stamp(file, prefix, ts, out.length + 1));
  }
  return out;
};

export const imageFilesFromPaste = (e: PasteLike, max: number): File[] => {
  const items = e.clipboardData?.items;
  if (!items || max <= 0) return [];
  const picked: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) picked.push(file);
  }
  return takeImages(picked, max, 'paste');
};

/**
 * [FEAT-20260818-DROPIMAGE] Drag & drop entrance (requirement, 18/08: images can
 * be dragged onto the composer, not only picked or pasted).
 *
 * `dataTransfer.files` is the reliable side of a drop (`items` may be empty for
 * files dragged from some apps, and its entries are consumed once read), so the
 * FileList is what we read. Folders arrive as a File with an empty `type`, so
 * the image/* filter drops them — dropping a folder does nothing rather than
 * staging a 0-byte "image" that the LINE push would reject later.
 *
 * A drop with no image (a link, selected text, a PDF) returns [] and the caller
 * leaves the drop alone; the browser then does nothing, because the caller only
 * calls preventDefault when at least one image came back.
 */
export interface DropLike {
  dataTransfer: {
    files?: ArrayLike<File> | null;
  } | null;
}

export const imageFilesFromDrop = (e: DropLike, max: number): File[] => {
  const files = e.dataTransfer?.files;
  if (!files || max <= 0) return [];
  return takeImages(files, max, 'drop');
};

/**
 * Does this drag carry FILES (as opposed to text/a link)? Used to light the drop
 * hint only when a drop could actually stage something. `types` is the only part
 * of `dataTransfer` readable during dragover — `files` is empty until the drop
 * itself, so a hint that waited for `files` would never appear.
 */
export const dragHasFiles = (types: unknown): boolean => {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes('Files') || list.includes('application/x-moz-file');
};

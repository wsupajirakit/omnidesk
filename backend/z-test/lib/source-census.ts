import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * [PROG-20260905-CENSUSCONV] Counting a source pattern across MORE THAN ONE file.
 *
 * WHY THIS EXISTS. Several specs in this repo guard a rule by counting occurrences of a
 * literal in `webhook.service.ts` — "four helper doors, one stamp each", "the webhook
 * reader treats only explicit false as the opt-out". Those counts are real protection:
 * they caught a live defect in August and the owner asked for the fence.
 *
 * But they assume the code never leaves that file, and the reduction program moves bodies
 * into role directories by design. Counted against the service alone, a successful
 * extraction reads as a missing door — and the natural response to a spec that reddens on
 * safe changes is to delete the spec, taking the fence with it.
 *
 * So the fence moves up a level: the count is over the service PLUS the files a body can
 * legitimately move to. Four doors are still four doors; where they live stopped being the
 * assertion.
 *
 * ⚠️ THIS IS A CONVERSION, NOT A RELAXATION. If the total drops, it still fails. What it
 * no longer does is fail for a change that moved code without changing behaviour.
 */

/** Read a file relative to the repo root. */
function read(root: string, relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

/**
 * Every `.ts` under a directory, recursively, repo-relative.
 *
 * A directory that does not exist yields `[]` rather than throwing. A census list names
 * the role directories a body MAY move to, and several of those are created by later
 * steps — treating "not yet created" as an error would make the fence fail for the one
 * reason that is never a defect.
 */
export function tsFilesUnder(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  const found: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.ts')) found.push(child);
    }
  };
  walk(dir);
  return found.sort();
}

/** Total matches of `pattern` across `files`. The pattern must carry the /g flag. */
export function countAcross(
  root: string,
  files: readonly string[],
  pattern: RegExp,
): number {
  let total = 0;
  for (const file of files) {
    total += (read(root, file).match(pattern) ?? []).length;
  }
  return total;
}

/** Which of `files` contain the pattern at all — the diagnostic a bare count cannot give. */
export function filesContaining(
  root: string,
  files: readonly string[],
  pattern: RegExp,
): string[] {
  return files.filter((f) => pattern.test(read(root, f)));
}

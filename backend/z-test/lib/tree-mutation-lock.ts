import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * [PROG-20260905-TREELOCK] One suite at a time may edit the working tree.
 *
 * WHY THIS EXISTS — it produced a false red, and a false red is the good outcome.
 *
 * Three suites prove the plug patches by actually running them: `git apply -R <patch>`,
 * check, `git apply <patch>`. That is the only honest way to prove "unplugging is one
 * command and puts the tree back" — a `--check` proves the patch matches, not that the
 * round trip is lossless. But jest runs suites in parallel workers (`--maxWorkers=3` is
 * this repo's house rule), and nothing stopped two of them from reverting and re-applying
 * DIFFERENT patches over the SAME two files at the same time.
 *
 * On 05/09 that is exactly what happened: `menu-plug-patch.spec.ts` failed its
 * byte-identical round-trip assertion during a full sweep and passed on its own, nine
 * cases out of nine, with the file unchanged. Half an hour went into looking for a defect
 * in a cut that did not have one.
 *
 * ⚠️ THE FALSE RED IS NOT THE WORST CASE. The same race can leave the tree UNPLUGGED —
 * one worker reverts, another re-applies its own patch, the first one's `finally` runs
 * against a file it no longer recognises. Tracked files are then modified, still
 * compiling, with no marker of any kind; `plug-patch-contract.spec.ts` would stay green
 * because it compares patches to patches, never patches to the tree. And under different
 * timing the race can just as easily produce a false GREEN.
 *
 * SO: a lock, not a convention. `mkdir` is atomic on every filesystem this repo runs on —
 * it either creates the directory or fails, with no window between the check and the
 * create. A stale lock (a worker killed mid-run) is broken after `STALE_MS`, because a
 * lock that can wedge the suite forever gets deleted by the next person in a hurry.
 * ล็อกจริง ไม่ใช่ข้อตกลง
 */

const LOCK_DIR = 'node_modules/.cache/spine-tree-lock';
/** Long enough for the slowest of the three suites, short enough to self-heal. */
const STALE_MS = 120_000;
const POLL_MS = 50;

function lockPath(repoRoot: string): string {
  return join(repoRoot, LOCK_DIR);
}

function breakIfStale(dir: string): void {
  try {
    const stamp = Number(readFileSync(join(dir, 'stamp'), 'utf8'));
    if (Number.isFinite(stamp) && Date.now() - stamp > STALE_MS) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* No stamp, or it vanished under us — either way the next mkdir decides. */
  }
}

/**
 * Take the tree lock, run `fn`, release it — even if `fn` throws.
 *
 * ⚠️ The release is in a `finally` and the lock is released BEFORE any assertion the
 * caller makes on the result, because a failed assertion must not hold the lock for the
 * rest of the run. That is the same rule the plug suites already follow for re-applying
 * their patch: the restore never sits behind a check.
 */
export async function withTreeLock<T>(
  repoRoot: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const dir = lockPath(repoRoot);
  /* The PARENT must exist before the atomic create can be attempted, and it may not: a
     fresh clone has no `node_modules/.cache`. The first version skipped this, `mkdir`
     failed every time for a reason that had nothing to do with contention, and the case sat
     in the retry loop until jest's 30s timeout killed it — a lock that can never be taken
     looks exactly like a lock somebody else is holding. Created recursively HERE, where it
     is not the atomic step; the lock directory itself is still created non-recursively,
     which is what makes it a lock. */
  mkdirSync(join(repoRoot, 'node_modules/.cache'), { recursive: true });
  const deadline = Date.now() + STALE_MS + STALE_MS;
  for (;;) {
    try {
      mkdirSync(dir, { recursive: false });
      writeFileSync(join(dir, 'stamp'), String(Date.now()), 'utf8');
      break;
    } catch {
      if (existsSync(dir)) breakIfStale(dir);
      if (Date.now() > deadline) {
        throw new Error(
          `[TREELOCK] could not take ${LOCK_DIR} — another suite has held it for over ` +
            `${Math.round((STALE_MS * 2) / 1000)}s. A killed worker may have left the ` +
            `tree half-patched: check \`git status\` before trusting anything.`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

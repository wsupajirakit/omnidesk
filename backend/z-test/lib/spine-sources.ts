import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * [PROG-20260905-SPINESRC] "The spine, wherever it currently lives."
 *
 * WHY THIS EXISTS. A dozen specs in this repo guard real rules by asserting on the SOURCE
 * TEXT of `webhook.service.ts` — the four helper doors, the slip twins, the door ordering,
 * the room-preview chain. Those assertions are worth keeping: several were written after a
 * live defect and the owner asked for the fence.
 *
 * They also assume the code never leaves that file, and the reduction program moves bodies
 * into role directories by design. Read against the service alone, a successful extraction
 * looks like a deleted rule — and the natural response to a spec that reddens on safe
 * changes is to delete the spec, which loses the rule it was protecting.
 *
 * So each of those specs was converted to read the service PLUS the directories a body may
 * legitimately move to. After the fifth hand-rolled copy of that loop, the loop belongs
 * here.
 *
 * ⚠️ WHAT THIS IS NOT. It is not a licence to widen a pin until it always passes. The
 * count and the shape assertions still have to hold over the concatenation, and a rule
 * that no longer holds anywhere still fails. What changed is only the assumption about
 * WHERE the code sits — never what it must do.
 *
 * ⚠️ A directory that does not exist yet contributes nothing rather than throwing: these
 * lists name role directories that later steps create, and "not yet" is the one reason a
 * fence must never fail for.
 */

const WEBHOOK = 'src/modules/webhook';

/** The role directories a spine body may legitimately be extracted into. */
export const SPINE_ROLE_DIRS: readonly string[] = [
  'ai-reply',
  'ai-vendors',
  'assist',
  'event-handlers',
  'flex',
  'follow-up',
  /* [PROG-20260905-LADDER] the gate ladder. It already held `follow-up-flow.ts` from SP23
     and was never added here — a hole in every fence built on the default list, closed
     when the ladder started taking guards out of the spine. */
  'gates',
  'hook-reply',
  'logging',
  'non-text',
  'post-send',
  'room-bootstrap',
  'slip-flex',
  'ticket',
];

function readDirTs(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs)
    .sort()
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(abs, f), 'utf8'));
}

/**
 * The service plus the named role directories, concatenated in a stable order.
 *
 * @param repoRoot absolute path to the repository root.
 * @param dirs     which role directories to include. Narrow it when a rule is about one
 *                 area — a smaller list is a stronger assertion, and this parameter is how
 *                 a spec says which files its rule may live in.
 */
export function spineSource(
  repoRoot: string,
  dirs: readonly string[] = SPINE_ROLE_DIRS,
): string {
  const parts = [
    readFileSync(join(repoRoot, WEBHOOK, 'webhook.service.ts'), 'utf8'),
  ];
  for (const d of dirs) parts.push(...readDirTs(join(repoRoot, WEBHOOK), d));
  return parts.join('\n');
}

/** The same, with comments stripped, for assertions that must match real code only. */
export function spineCodeOnly(
  repoRoot: string,
  dirs: readonly string[] = SPINE_ROLE_DIRS,
): string {
  return spineSource(repoRoot, dirs)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

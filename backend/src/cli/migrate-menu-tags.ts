/**
 * migrate-menu-tags.ts — copy five flex menu tags from one database to another
 * ===========================================================================
 * Owner, 01/09/2026: move `menu_main_00010` plus four `sub-*` menus into
 * production, so the next menu created there becomes `menu_main_00011`.
 *
 * ## How to run — all of it on the server, nothing to copy in
 * ```bash
 * cd /app && node dist/cli/migrate-menu-tags.js check      # read-only report
 * cd /app && node dist/cli/migrate-menu-tags.js rehearse   # clone, insert, drop
 * cd /app && node dist/cli/migrate-menu-tags.js apply --yes
 * cd /app && node dist/cli/migrate-menu-tags.js rollback --yes   # undo
 * ```
 * The five rows are COMPILED IN (`migrate-menu-tags.data.ts`), so there is no
 * export step and no payload file to carry between machines — the two halves
 * cannot drift out of sync because there is only one half.
 *
 * Reads `MONGODB_URI` from env, like every other CLI here, so the container
 * needs no extra setup.
 *
 * ## Why a script and not a one-line `node -e`
 * The one-liners for this were ~1,200 characters each. Nobody can read one to
 * check it before pasting it into a production shell, and a single missed quote
 * changes what it does. This is the same steps with names, and it refuses to
 * write unless `--yes` is present.
 *
 * ## What it copies, and what it does NOT
 * Everything on the row EXCEPT `_id`, `__v`, `hook_ids` and `group_ids`.
 * `_id` is dropped so the target mints its own; the two scope columns are
 * dropped because the target supplies its own — every hook and group that is
 * enabled THERE, which is not the same set as here.
 *
 * 🔴 SELECTS BY `flex_tag`, NEVER BY `flex_slug`. `sub-register` exists twice
 * locally and one copy was soft-deleted on 31/08; a slug query drags the dead
 * one along and would resurrect it in the target. The tags are listed
 * explicitly below for that reason, and the export also filters `deleted_at`.
 *
 * 🔴 THE STATUS COLUMNS DISAGREE BETWEEN COLLECTIONS, measured on live data:
 * `hooks.status` is a NUMBER (1 = enabled) and `groups.status` is a BOOLEAN
 * (true = enabled). `groups` additionally holds one numeric `0`, which a
 * boolean filter correctly ignores. Do not "tidy" these into one shape.
 *
 * ## The tag counter needs nothing set
 * `nextMenuTag` (`flex-messages.service.ts:1121-1138`) keeps no counter
 * document: it reads the MAX existing tag in the family and adds one. So
 * inserting `menu_main_00010` is what makes the next one `00011`. Proven on a
 * clone — deleting the five dropped the max to 9, restoring them raised it to
 * 10, and a duplicate insert was rejected by the unique index with error 11000.
 *
 * revert: delete this file and its `menutag:*` script in package.json. Nothing
 * else imports it.
 */
import mongoose from 'mongoose';

import { MENU_TAG_ROWS } from './migrate-menu-tags.data';

const URI = process.env.MONGODB_URI;

const argv = process.argv.slice(2);
const mode = argv[0] ?? '';
const has = (flag: string): boolean => argv.includes(flag);

const apply = has('--yes');

const COLLECTION = 'flex_messages';
const CLONE_DB = 'clone_menutag_test';

/**
 * The five rows, BY TAG.
 *
 * ⚠️ Not by slug — see the header. Editing this list is the only supported way
 * to change what moves; every mode reads it.
 */
export const MENU_TAGS = [
  'menu_main_00010',
  'menu_sub_00011',
  'menu_sub_00013',
  'menu_sub_00014',
  'menu_sub_00019',
] as const;

interface FlexRow extends Record<string, unknown> {
  flex_tag?: string;
  flex_slug?: string;
}

/** Highest number currently used in a tag family, or 0. */
export function highestTag(tags: readonly string[], prefix: string): number {
  const re = new RegExp(`^${prefix}\\d{5}$`);
  return tags.reduce((max, tag) => {
    if (!re.test(tag)) return max;
    const n = Number(tag.slice(prefix.length));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

/** What `nextMenuTag` would hand out next, given the tags that exist. */
export function nextTagAfter(tags: readonly string[], prefix: string): string {
  return `${prefix}${String(highestTag(tags, prefix) + 1).padStart(5, '0')}`;
}

/**
 * Stop with a message.
 *
 * `throw` rather than `process.exit` inside the helper: an arrow function
 * calling `process.exit` is not narrowed to `never` by the checker, so every
 * caller would still be treated as possibly continuing. The top-level catch
 * turns this back into exit code 1.
 */
class Abort extends Error {}

function die(message: string): never {
  throw new Abort(message);
}

async function connect() {
  if (!URI) die('MONGODB_URI is not set');
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database handle');
  return db;
}

/** Every tag in the collection, for the counter maths. */
async function allTags(
  db: Awaited<ReturnType<typeof connect>>,
  collection = COLLECTION,
): Promise<string[]> {
  const rows = await db
    .collection(collection)
    .find({ flex_tag: { $exists: true } })
    .project({ flex_tag: 1 })
    .toArray();
  return rows.map((r) => String((r as FlexRow).flex_tag ?? ''));
}

/** The enabled hooks and groups OF THIS DATABASE. Shapes differ — see header. */
async function enabledScope(db: Awaited<ReturnType<typeof connect>>) {
  const hooks = await db
    .collection('hooks')
    .find({ status: 1 })
    .project({ _id: 1 })
    .toArray();
  const groups = await db
    .collection('groups')
    .find({ status: true })
    .project({ _id: 1 })
    .toArray();
  return {
    hookIds: hooks.map((h) => h._id),
    groupIds: groups.map((g) => g._id),
  };
}

/* ── check (read-only) ──────────────────────────────────────────────────── */

async function runCheck(): Promise<void> {
  const db = await connect();
  const payload = MENU_TAG_ROWS as FlexRow[];
  const tags = payload.map((r) => String(r.flex_tag));

  const present = (await db
    .collection(COLLECTION)
    .find({ flex_tag: { $in: tags } })
    .project({ flex_tag: 1 })
    .toArray()) as FlexRow[];
  const { hookIds, groupIds } = await enabledScope(db);
  const existing = await allTags(db);

  console.log(`target db      : ${mongoose.connection.name}`);
  console.log(`payload rows   : ${payload.length}`);
  console.log(
    `already there  : ${present.length ? present.map((r) => r.flex_tag).join(', ') : 'none'}`,
  );
  console.log(`enabled hooks  : ${hookIds.length}`);
  console.log(`enabled groups : ${groupIds.length}`);
  console.log(
    `next main tag  : ${nextTagAfter(existing, 'menu_main_')} (before)`,
  );
  console.log(
    `next main tag  : ${nextTagAfter([...existing, ...tags], 'menu_main_')} (after)`,
  );

  if (present.length > 0) {
    console.log(
      '\n⚠️ STOP — those tags already exist here. `apply` will refuse.',
    );
  } else if (hookIds.length === 0 || groupIds.length === 0) {
    console.log(
      '\n⚠️ STOP — no enabled hooks or groups found. Check the status columns.',
    );
  } else {
    console.log('\n✅ safe to rehearse');
  }
  console.log('DRY RUN — nothing was written');
  await mongoose.disconnect();
}

/* ── rehearse (writes to a throwaway clone) ─────────────────────────────── */

async function runRehearse(): Promise<void> {
  const db = await connect();
  const payload = MENU_TAG_ROWS as FlexRow[];
  const clone = mongoose.connection.getClient().db(CLONE_DB);

  console.log(
    `cloning ${mongoose.connection.name}.${COLLECTION} → ${CLONE_DB}`,
  );
  await clone.collection(COLLECTION).deleteMany({});
  const all = await db.collection(COLLECTION).find({}).toArray();
  if (all.length > 0) await clone.collection(COLLECTION).insertMany(all);
  /* The unique index is what rejects a duplicate tag. Recreate it, or the
     rehearsal would pass where production fails. */
  await clone
    .collection(COLLECTION)
    .createIndex({ flex_tag: 1 }, { unique: true });

  const { hookIds, groupIds } = await enabledScope(db);
  const docs = payload.map((row) => ({
    ...row,
    hook_ids: hookIds,
    group_ids: groupIds,
  }));
  const res = await clone.collection(COLLECTION).insertMany(docs);

  const after = await allTags(clone);
  console.log(`inserted  : ${res.insertedCount}`);
  console.log(`hooks     : ${hookIds.length}  groups: ${groupIds.length}`);
  console.log(`next main : ${nextTagAfter(after, 'menu_main_')}`);
  console.log(`next sub  : ${nextTagAfter(after, 'menu_sub_')}`);

  await clone.dropDatabase();
  console.log(`\n✅ rehearsal passed — ${CLONE_DB} dropped`);
  await mongoose.disconnect();
}

/* ── apply (the real write) ─────────────────────────────────────────────── */

async function runApply(): Promise<void> {
  const db = await connect();
  const payload = MENU_TAG_ROWS as FlexRow[];
  const tags = payload.map((r) => String(r.flex_tag));

  /* Pre-check rather than relying on the index to throw: `insertMany` is not a
     transaction, so a mid-list rejection leaves earlier rows written. */
  const clash = await db
    .collection(COLLECTION)
    .countDocuments({ flex_tag: { $in: tags } });
  if (clash > 0) {
    die(`${clash} of these tags already exist here — nothing written`);
  }

  const { hookIds, groupIds } = await enabledScope(db);
  if (hookIds.length === 0 || groupIds.length === 0) {
    die('no enabled hooks or groups found — refusing to insert unusable rows');
  }

  if (!apply) {
    console.log('DRY RUN — would insert:');
    tags.forEach((t) => console.log(`  ${t}`));
    console.log(`  with ${hookIds.length} hooks and ${groupIds.length} groups`);
    console.log('\nadd --yes to write');
    return void (await mongoose.disconnect());
  }

  const now = new Date();
  const docs = payload.map((row) => ({
    ...row,
    hook_ids: hookIds,
    group_ids: groupIds,
    created_at: now,
    updated_at: now,
  }));
  const res = await db.collection(COLLECTION).insertMany(docs);
  const after = await allTags(db);

  console.log(`✅ inserted ${res.insertedCount} rows`);
  console.log(`   hooks: ${hookIds.length}  groups: ${groupIds.length}`);
  console.log(`   next main tag: ${nextTagAfter(after, 'menu_main_')}`);
  console.log(
    `   ids: ${Object.values(res.insertedIds).map(String).join(', ')}`,
  );
  console.log('\n   keep those ids — rollback uses the tag list, not the ids,');
  console.log('   so use them if any of these tags pre-existed.');
  await mongoose.disconnect();
}

/* ── rollback ───────────────────────────────────────────────────────────── */

async function runRollback(): Promise<void> {
  const db = await connect();
  const found = await db
    .collection(COLLECTION)
    .countDocuments({ flex_tag: { $in: [...MENU_TAGS] } });

  console.log(`target db : ${mongoose.connection.name}`);
  console.log(`matching  : ${found} rows`);

  if (!apply) {
    console.log('\nDRY RUN — add --yes to delete');
    return void (await mongoose.disconnect());
  }

  /* ⚠️ Deletes BY TAG. If the target already held a row under one of these
     tags before the migration, this removes that row too — use the ids printed
     by `apply` instead in that case. */
  const res = await db
    .collection(COLLECTION)
    .deleteMany({ flex_tag: { $in: [...MENU_TAGS] } });
  console.log(`✅ deleted ${res.deletedCount} rows`);
  await mongoose.disconnect();
}

/* ── entry ──────────────────────────────────────────────────────────────── */

const MODES: Record<string, () => Promise<void>> = {
  check: runCheck,
  rehearse: runRehearse,
  apply: runApply,
  rollback: runRollback,
};

/**
 * ⚠️ ONLY RUN WHEN INVOKED AS A COMMAND.
 *
 * Without this guard, importing the file to test `highestTag` EXECUTES the CLI:
 * no mode is set, so it prints the usage text and calls `process.exit(1)`
 * before a single assertion runs — which is what the spec hit. `require.main`
 * is this module only when node was pointed at this file.
 */
const isCommand = require.main === module;

const run = MODES[mode];
if (isCommand && !run) {
  console.error(`usage: node dist/cli/migrate-menu-tags.js <mode> [flags]

modes:
  check      read-only report of what would happen here
  rehearse   clone this db, insert into the clone, report, drop the clone
  apply      the real insert (needs --yes)
  rollback   delete the five tags here (needs --yes)`);
  process.exit(1);
}

if (isCommand && run)
  void run().catch(async (error: unknown) => {
    /* An Abort is a refusal this script raised on purpose — report it as the
       message it carries, not as a crash. */
    const message = (error as Error).message;
    console.error(
      error instanceof Abort ? `❌ ${message}` : `❌ failed: ${message}`,
    );
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });

/**
 * audit-hook-markers.ts — which hook fields carry a `[[[marker]]]`, and whether
 * the hook's reply mode will strip it (READ-ONLY)
 * ===========================================================================
 * ## How to run
 * ```bash
 * cd /app && node dist/cli/audit-hook-markers.js          # report only
 * cd /app && node dist/cli/audit-hook-markers.js --fix    # dry run of the fix
 * cd /app && node dist/cli/audit-hook-markers.js --fix --yes
 * ```
 * Reads `MONGODB_URI` from env like every other CLI here.
 *
 * ## What `--fix` sets, and why that value
 * It sets `hook_text_reply_mode: 'flex'` on the hooks that leak.
 *
 * `flex` is the mode already proven on the local database: the same field
 * (`image_answer_text = "[[[menu_main_00010]]]"`) sends the menu CARD there and
 * leaks on production, and the ONLY difference measured between the two rows is
 * this column — local `flex`, production unset.
 *
 * What it does (`hook-text-reply.ts:150-160`): strips the marker, reports
 * `wantedMenuCardTag` so the caller can send the card, and attaches no quick
 * reply because the card carries its own buttons.
 *
 * ⚠️ IT TOUCHES ONLY HOOKS THAT ALREADY HOLD A MARKER in one of the three
 * fields. A hook with plain text is left alone: changing its mode would alter
 * customer-visible output for no reason.
 *
 * ⚠️ `--fix` alone is a DRY RUN. `--yes` is required to write.
 *
 * ## Why this exists
 * The same question was being asked with a ~900-character `node -e` one-liner,
 * and pasting it into the container shell broke it: the terminal wrapped the
 * line and `process.env.MONGODB_URI` arrived as `MON` + `GODB_URI`, so node
 * died on a syntax error. A command nobody can paste is a command nobody can
 * run.
 *
 * ## What it answers
 * An operator may write `[[[menu_main_00010]]]` into a hook text field. Whether
 * that is fine or broken depends on `hook_text_reply_mode`:
 *
 *   · `off`   — the field is returned VERBATIM (`hook-text-reply.ts:125-128`),
 *               so the marker reaches the customer and the chat row. If the
 *               field is ONLY a marker, the message is empty and LINE rejects
 *               it: the customer gets nothing and the admin sees raw brackets.
 *   · other   — the marker is stripped and, for a menu tag, the CARD is sent.
 *
 * ⚠️ `off` IS THE DEFAULT (`HOOK_TEXT_REPLY_DEFAULT_MODE`), and an absent value
 *    resolves to it, so a hook nobody configured is in the leaking mode.
 *
 * ## What writes, and what does not
 * Without `--fix --yes` this only reads: `find`, `aggregate`, `countDocuments`,
 * `project`. The single write is the `updateMany` behind both flags, and it
 * touches ONE column — `hook_text_reply_mode` — on hooks that already hold a
 * marker. No text field is rewritten, so an operator's own copy is never edited.
 *
 * To undo, set the column back on the hooks the run listed:
 *   db.hooks.updateMany({line_oa_name:{$in:[…]}}, {$unset:{hook_text_reply_mode:''}})
 * which returns them to the default (`off`) they were in before.
 *
 * revert: delete this file and its `audit:hook-markers` script entry.
 */
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI;

const argv = process.argv.slice(2);
const wantsFix = argv.includes('--fix');
const apply = argv.includes('--yes');

/** The mode the fix installs — see the header for why this one. */
const TARGET_MODE = 'flex';

/** The three fields the owner reported, by their real column names. */
const TEXT_FIELDS = [
  'default_answer_text',
  'ai_generative_error_text',
  'image_answer_text',
] as const;

/** Any `[[[…]]]`, however it is spelled. */
const MARKER_RE = /\[\[\[[^\]]*\]\]\]/;
/** The whole field is one marker and nothing else — the case that sends empty. */
const MARKER_ONLY_RE = /^\s*\[\[\[[^\]]*\]\]\]\s*$/;

/**
 * Print an untyped database value without risking `[object Object]`.
 *
 * These columns come off documents with no schema applied, so a value that
 * should be a string can be anything. A label reading "[object Object]" would
 * send someone hunting the wrong hook.
 */
function label(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? fallback;
}

/**
 * Modes that strip. Mirrors `resolveHookTextReplyMode`: anything unrecognised —
 * including absent — reads as `off`, which does NOT strip.
 */
const STRIPPING_MODES = new Set(['strip', 'button', 'flex']);

interface Row {
  oa: string;
  mode: string;
  field: string;
  markerOnly: boolean;
  leaks: boolean;
  sample: string;
}

async function main(): Promise<void> {
  if (!URI) {
    console.error('❌ MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database handle');
  const hooks = db.collection('hooks');

  const modes = await hooks
    .aggregate([{ $group: { _id: '$hook_text_reply_mode', n: { $sum: 1 } } }])
    .toArray();

  console.log(`db          : ${mongoose.connection.name}`);
  console.log(`hooks total : ${await hooks.countDocuments({})}`);
  console.log('reply modes :');
  for (const m of modes) {
    const label =
      m._id === null || m._id === undefined ? '(unset)' : String(m._id);
    const strips = STRIPPING_MODES.has(String(m._id));
    console.log(
      `  ${label.padEnd(10)} ${String(m.n).padStart(3)}  ${strips ? 'strips markers' : '⚠️ sends raw'}`,
    );
  }

  const docs = await hooks
    .find({ $or: TEXT_FIELDS.map((f) => ({ [f]: MARKER_RE })) })
    .project({
      line_oa_name: 1,
      hook_text_reply_mode: 1,
      ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, 1])),
    })
    .toArray();

  const rows: Row[] = [];
  for (const doc of docs) {
    const rawMode = (doc as Record<string, unknown>)['hook_text_reply_mode'];
    const mode = label(rawMode, '(unset)');
    const strips = STRIPPING_MODES.has(String(rawMode));
    for (const field of TEXT_FIELDS) {
      const value = (doc as Record<string, unknown>)[field];
      if (typeof value !== 'string' || !MARKER_RE.test(value)) continue;
      rows.push({
        oa: label((doc as Record<string, unknown>)['line_oa_name']),
        mode,
        field,
        markerOnly: MARKER_ONLY_RE.test(value),
        leaks: !strips,
        sample: value.replace(/\s+/g, ' ').slice(0, 38),
      });
    }
  }

  console.log(`\nfields holding a marker: ${rows.length}`);
  for (const r of rows) {
    /* Marker-only AND non-stripping is the pair that sends nothing at all —
       flagged apart from a leak that still carries the operator's own words. */
    const verdict = !r.leaks
      ? 'ok, stripped'
      : r.markerOnly
        ? '🔴 SENDS NOTHING'
        : '⚠️ marker visible';
    console.log(
      `  ${r.oa.padEnd(20)} ${r.mode.padEnd(9)} ${r.field.padEnd(26)} ${verdict.padEnd(18)} ${r.sample}`,
    );
  }

  const broken = rows.filter((r) => r.leaks && r.markerOnly);
  const visible = rows.filter((r) => r.leaks && !r.markerOnly);
  console.log('');
  console.log(`🔴 customer gets NOTHING : ${broken.length}`);
  console.log(`⚠️ marker visible to user: ${visible.length}`);
  console.log(
    `✅ stripped correctly    : ${rows.filter((r) => !r.leaks).length}`,
  );
  if (broken.length > 0) {
    console.log(
      '\nThe 🔴 rows are the reported bug: the field is only a marker, the mode',
    );
    console.log(
      'does not strip, so the send goes out empty and LINE refuses it.',
    );
  }
  if (!wantsFix) {
    console.log('\nREAD-ONLY — nothing was written');
    console.log('   add --fix to see what setting the mode would change');
    await mongoose.disconnect();
    return;
  }

  /* Only the hooks that actually leak. A hook whose fields hold plain text is
     left alone: flipping its mode would change what its customers see for no
     reason, and this command exists to stop a leak, not to standardise config. */
  const leakingOas = [...new Set(rows.filter((r) => r.leaks).map((r) => r.oa))];
  console.log(`\nhooks to set ${TARGET_MODE}: ${leakingOas.length}`);
  leakingOas.forEach((oa) => console.log(`  ${oa}`));

  if (leakingOas.length === 0) {
    console.log('\nnothing to fix');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log('\nDRY RUN — add --yes to write');
    await mongoose.disconnect();
    return;
  }

  const res = await hooks.updateMany(
    {
      line_oa_name: { $in: leakingOas },
      $or: TEXT_FIELDS.map((f) => ({ [f]: MARKER_RE })),
    },
    { $set: { hook_text_reply_mode: TARGET_MODE } },
  );
  console.log(`\n✅ matched ${res.matchedCount}, updated ${res.modifiedCount}`);
  console.log('   re-run without --fix to confirm the leak is gone');

  await mongoose.disconnect();
}

void main().catch(async (error: unknown) => {
  console.error('❌ failed:', (error as Error).message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});

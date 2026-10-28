/**
 * [FEAT-20261014-TOOLSEED] One seed run against three collections — the only part that writes.
 *
 * Takes the collections as narrow interfaces so the spec drives it with fakes (and proves
 * `hooks` is only ever READ). Order: read → plan → refuse or write. Nothing is written until
 * every decision in `seed-plan.ts` has come back clean.
 *
 * revert: see `seed-custom-tool.ts`.
 */
import {
  buildToolDoc,
  planTags,
  type ExistingTag,
  type TagAction,
} from './seed-plan';
import type { SeedBundle } from './seed-bundle.types';

type Doc = Record<string, unknown>;

export interface SeedCollections {
  tools: {
    findOne(filter: Doc): Promise<Doc | null>;
    findOneAndUpdate(filter: Doc, update: Doc, opts: Doc): Promise<unknown>;
  };
  tags: {
    find(filter: Doc): { toArray(): Promise<Doc[]> };
    updateOne(filter: Doc, update: Doc): Promise<unknown>;
    insertOne(doc: Doc): Promise<unknown>;
  };
  /** Read-only by contract: the CLI never switches an OA over (that is a human decision). */
  hooks: { findOne(filter: Doc): Promise<Doc | null> };
}

export interface SeedRunInput {
  bundle: SeedBundle;
  baseUrl: string;
  apply: boolean;
  hookAlias?: string;
  username: string;
  /** Called only when writing — a dry run needs no secret. */
  encryptPassword: () => string;
  now: Date;
}

export interface SeedRunResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
  toolExisted: boolean;
  actions: TagAction[];
  wrote: { tool: boolean; inserted: number; updated: number };
}

export async function runSeed(
  cols: SeedCollections,
  input: SeedRunInput,
): Promise<SeedRunResult> {
  const { bundle } = input;
  const lines: string[] = [];
  const wrote = { tool: false, inserted: 0, updated: 0 };

  let hookId: unknown = null;
  if (input.hookAlias) {
    const hook = await cols.hooks.findOne({ alias: input.hookAlias });
    if (!hook) {
      lines.push(`❌ no hook with alias "${input.hookAlias}"`);
      return { exitCode: 1, lines, toolExisted: false, actions: [], wrote };
    }
    hookId = hook['_id'];
  }

  const toolExisted = !!(await cols.tools.findOne({ name: bundle.tool.name }));
  /* EVERY row holding one of our names — not only the marked ones — or a collision is invisible. */
  const existing = (await cols.tags
    .find({ tag: { $in: bundle.tags.map((t) => t.tag) } })
    .toArray()) as unknown as ExistingTag[];
  const actions = planTags(bundle, existing, hookId, input.now);
  const conflicts = actions.filter((a) => a.kind === 'conflict');

  lines.push(
    `tool "${bundle.tool.name}" ${toolExisted ? 'exists ⇒ update' : 'absent ⇒ create'} · base_url ${input.baseUrl}` +
      ` · tags insert ${actions.filter((a) => a.kind === 'insert').length}` +
      ` / update ${actions.filter((a) => a.kind === 'update').length}` +
      ` / CONFLICT ${conflicts.length}` +
      (input.hookAlias
        ? ` · bind tags to hook "${input.hookAlias}" (added, never replacing)`
        : ' · no hook binding'),
  );
  for (const c of conflicts) {
    if (c.kind === 'conflict') {
      lines.push(
        `   ⚠️ tag "${c.tag}" already exists and is NOT this bundle's (detail: "${c.existingDetail}")`,
      );
    }
  }

  if (conflicts.length > 0) {
    lines.push(
      '❌ refused: resolve the name conflicts first — nothing was written',
    );
    return { exitCode: 2, lines, toolExisted, actions, wrote };
  }
  if (!input.apply) {
    lines.push('🟡 DRY RUN — nothing written · add --yes to write');
    return { exitCode: 0, lines, toolExisted, actions, wrote };
  }

  await cols.tools.findOneAndUpdate(
    { name: bundle.tool.name },
    {
      $set: buildToolDoc(bundle, {
        baseUrl: input.baseUrl,
        username: input.username,
        encryptedPassword: input.encryptPassword(),
        now: input.now,
      }),
      $setOnInsert: { created_at: input.now, deleted_at: null },
    },
    { upsert: true, returnDocument: 'after' },
  );
  wrote.tool = true;

  for (const a of actions) {
    if (a.kind === 'update') {
      await cols.tags.updateOne({ _id: a.id }, a.update);
      wrote.updated++;
    } else if (a.kind === 'insert') {
      await cols.tags.insertOne(a.doc);
      wrote.inserted++;
    }
  }
  lines.push(
    `✅ tool written · tags inserted ${wrote.inserted} · updated ${wrote.updated}` +
      ' · no OA switched over: set custom_tool_id + custom_tool_status on the hook form when ready',
  );
  return { exitCode: 0, lines, toolExisted, actions, wrote };
}

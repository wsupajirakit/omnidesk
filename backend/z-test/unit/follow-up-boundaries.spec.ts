/**
 * [FEAT-20260820-FOLLOWUP] the module must come apart — proved, not intended
 * ===========================================================================
 * Owner: "follow-up function module นี้ทั้งหมด ต้องแยกอิสระ ถอดแต่ละส่วนออกได้แบบไม่กระทบ
 * อาจจะมีคนเรียกใช้แค่บางส่วน ต้องมาแชร์ได้ ... สเกลได้ ไม่เป็นหนี้" — and the same for
 * `webhook/register`.
 *
 * Independence is not something a comment can promise: it is a property of the
 * import graph, and it decays the first time somebody reaches sideways for a
 * constant. It already did once — the shared key was exported from the level-1
 * helper, so the clear step could not be taken without dragging the level-1 rule
 * and its chat-history read along with it. That is why this file reads the real
 * imports instead of trusting the layout.
 *
 * WHAT EACH PIECE IS ALLOWED TO KNOW
 *   keys / rule / copy   — nothing at all. Pure, importable anywhere.
 *   helpers              — the keys, the rule, and the storage door. Not each other.
 *   gate                 — the helpers and the keys. It composes; it decides nothing.
 *   register/            — NOTHING from follow-up, and no database at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FOLLOW_UP = 'src/modules/webhook/follow-up';
const REGISTER = 'src/modules/webhook/register';

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

/** Every module specifier this file imports from, comments stripped. */
const importsOf = (rel: string): string[] => {
  const body = read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
};

/** Every .ts under a folder, subfolders included — `register/` has one now. */
const filesIn = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesIn(`${dir}/${e.name}`)
      : e.name.endsWith('.ts')
        ? [`${dir}/${e.name}`]
        : [],
  );

describe('follow-up — each piece can be taken on its own', () => {
  it.each([
    'follow-up.keys.ts',
    'abandon-trigger.rule.ts',
    'follow-up.copy.ts',
  ])(
    '%s imports NOTHING — usable anywhere, including outside this repo',
    (name) => {
      expect(importsOf(`${FOLLOW_UP}/${name}`)).toEqual([]);
    },
  );

  it('the clear step does NOT depend on level 1', () => {
    /* the regression that already happened once: `ABANDON_TRIGGER_KEY` used to
       live in the level-1 helper, so taking these few lines meant taking the
       rule and the history read too. */
    const imports = importsOf(`${FOLLOW_UP}/clear-follow-up.helper.ts`);
    expect(imports).not.toContain('./abandon-trigger.helper');
    expect(imports).not.toContain('./abandon-trigger.rule');
    expect(imports).toContain('./follow-up.keys');
  });

  it('level 1 does not depend on the clear step or the gate either', () => {
    const imports = importsOf(`${FOLLOW_UP}/abandon-trigger.helper.ts`);
    expect(imports).not.toContain('./clear-follow-up.helper');
    expect(imports).not.toContain('./follow-up.gate');
  });

  it('only the gate composes — nothing else imports a sibling helper', () => {
    for (const f of filesIn(FOLLOW_UP)) {
      if (f.endsWith('follow-up.gate.ts') || f.endsWith('index.ts')) continue;
      const siblingHelpers = importsOf(f).filter(
        (i) => i.startsWith('./') && i.endsWith('.helper'),
      );
      expect({ file: f, siblingHelpers }).toEqual({
        file: f,
        siblingHelpers: [],
      });
    }
  });

  it('storage is reached ONLY through chat/config, never a schema or a service', () => {
    /* `import type { Model } from 'mongoose'` is allowed and is not a dependency:
       it disappears at compile time and only types the model the CALLER hands in.
       Importing a schema or a service would be the real coupling. */
    for (const f of filesIn(FOLLOW_UP)) {
      const bad = importsOf(f).filter(
        (i) => i.includes('schemas/') || i.includes('.service'),
      );
      expect({ file: f, bad }).toEqual({ file: f, bad: [] });
      const valueMongoose = /^import\s+\{[^}]*\}\s+from\s+'mongoose'/m.test(
        read(f),
      );
      expect({ file: f, valueMongoose }).toEqual({
        file: f,
        valueMongoose: false,
      });
    }
  });

  it('nothing here imports the webhook, LINE, or Nest', () => {
    for (const f of filesIn(FOLLOW_UP)) {
      const body = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const forbidden of [
        '@nestjs',
        'webhook.service',
        'line-api',
        'Injectable',
      ]) {
        expect({ file: f, forbidden, found: body.includes(forbidden) }).toEqual(
          {
            file: f,
            forbidden,
            found: false,
          },
        );
      }
    }
  });
});

describe('register — a separate module, shareable on its own', () => {
  it('imports nothing from OUTSIDE itself — no follow-up, no database, no framework', () => {
    /* Files inside this folder may reference each other; what must never happen
       is an import that leaves it. That is what lets the whole folder be copied
       elsewhere or deleted outright. ข้างในอ้างกันได้ · ห้ามออกนอกโฟลเดอร์. */
    for (const f of filesIn(REGISTER)) {
      const outside = importsOf(f).filter((i) => !i.startsWith('.'));
      expect({ file: f, outside }).toEqual({ file: f, outside: [] });
    }
  });

  it('the prompt file imports nothing at all — editable in isolation', () => {
    expect(importsOf(`${REGISTER}/build-member-info.prompt.ts`)).toEqual([]);
  });

  it('the extractor knows no AI vendor — the model is handed in', () => {
    const body = read(`${REGISTER}/build-member-info.ts`)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of [
      'gemini',
      'deepseek',
      'axios',
      'ai-reply',
      'AiReplyProvider',
    ]) {
      expect({ forbidden, found: body.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  it('does not reach into follow-up even by name', () => {
    for (const f of filesIn(REGISTER)) {
      const body = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(body).not.toContain('follow-up');
      expect(body).not.toContain('abandon');
    }
  });

  it('and follow-up does not reach into register — the arrow points one way', () => {
    /* the webhook calls both; neither calls the other. That is what lets either
       one be deleted without touching the other. ลูกศรทางเดียว. */
    for (const f of filesIn(FOLLOW_UP)) {
      expect({
        file: f,
        imports: importsOf(f).filter((i) => i.includes('register')),
      }).toEqual({ file: f, imports: [] });
    }
  });
});

describe('removing it all restores the previous behaviour', () => {
  /* [PROG-20260905-SPINESRC] The follow-up gate's BODY moved to
   follow-up/follow-up-flow.ts at SP23; its binding stayed in the spine. Every rule below
   is about the gate's behaviour and holds wherever the body lives, so the source read here
   is the spine plus that role directory. Narrow list, not the whole module: a smaller list
   is a stronger assertion. */
  const wh =
    read('src/modules/webhook/webhook.service.ts') +
    read('src/modules/webhook/gates/follow-up-flow.ts');

  it('the webhook calls each module exactly ONCE — one block to delete', () => {
    expect(wh.split('runFollowUpGate(').length - 1).toBe(1);
    expect(wh.split('handoffToRegister(').length - 1).toBe(1);
  });

  it('every file says how to revert it', () => {
    for (const f of [...filesIn(FOLLOW_UP), ...filesIn(REGISTER)]) {
      if (f.endsWith('index.ts')) continue;
      expect({ file: f, hasRevert: read(f).includes('revert:') }).toEqual({
        file: f,
        hasRevert: true,
      });
    }
  });
});

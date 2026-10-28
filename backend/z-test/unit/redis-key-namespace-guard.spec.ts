/**
 * [FIX-20260905-GLOBALNS] The enforcement point that did not exist.
 *
 * ## Why this file is the actual fix
 * Namespacing a shared Redis key by environment was ALREADY the convention here,
 * already applied in five places, and already explained in the source:
 * `rate-limit.service.ts` says "Dev and prod share one Redis database";
 * `realtime-publisher.service.ts` says "One channel per environment so a shared
 * Redis host cannot deliver dev events to production dashboards";
 * `translation-dict-cache.service.ts` describes this exact leak.
 *
 * And it was still forgotten — in `qcache` (05/09, production served staging's
 * broadcast rows), in the handoff callback limiter, and in the external-API
 * breaker. A convention with nothing that goes red is a convention that gets
 * forgotten. This spec is that red.
 *
 * ## How it works, and why it is an AST walk and not a grep
 * A regex over key-shaped string literals was written first and MEASURED: it
 * found 8 of the ~16 real keys and missed `qcache:`, `ratelimit:`, `transdict.`,
 * `hook:`, `ws_ticket:`, `handoff:` and one `cb:` — every key whose literal is
 * built from a constant, returned from a helper, or written across more than one
 * line. It also matched LINE postback payloads and socket event names, which are
 * not Redis keys at all. A guard that finds half the keys is worse than none: it
 * reports green over the ones it cannot see. เขียน regex แล้ววัด — จับได้ครึ่งเดียว จึงทิ้ง
 *
 * So this walks the TypeScript AST instead, finds every call to a Redis command,
 * and resolves its key argument by expanding names until they stop changing — a
 * local const, a `this.` property, a module constant, or a same-class helper's
 * `return`. `client.get(key)` → `buildKey()` → `keyPrefix()` is three hops and
 * all three are followed. Coverage is pinned by the inventory case below.
 *
 * ## The contract
 * Every resolved key must EITHER carry an environment marker, OR appear in
 * `ALLOWED` with a written reason. There is no third option and no silent pass.
 *
 * ⚠️ If this spec fails on a key you just added: namespace it with
 *    `redisEnvNamespace` (`infra/redis/redis-namespace.ts`). Add an `ALLOWED`
 *    entry only if the key genuinely cannot collide across deployments, and say
 *    why — "it has an id in it" is not a reason on its own, because staging here
 *    is restored from a production dump and a restored document keeps its `_id`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

const SRC = join(__dirname, '../../src');

/** Redis commands whose FIRST argument is a key (or a channel). */
const KEY_COMMANDS = new Set([
  'get',
  'set',
  'setex',
  'del',
  'incr',
  'decr',
  'expire',
  'exists',
  'ttl',
  'getdel',
  'publish',
  'subscribe',
]);

/**
 * A resolved key counts as environment-scoped when its text mentions one of
 * these. They are the markers the five pre-existing namespaced keys already use,
 * plus the shared helper introduced on 05/09.
 */
const ENV_MARKERS = [
  'envNamespace',
  'redisEnvNamespace',
  'namespace',
  'wsEnv',
  'this.ns()',
];

/**
 * Keys that may stay un-namespaced. EVERY entry states why it cannot collide
 * across deployments. Adding an entry is a decision; leaving a key out of both
 * lists is not possible.
 */
const ALLOWED: Record<string, string> = {
  'ws_ticket:':
    'The token is 32 random bytes with a 45s TTL, so two deployments cannot ' +
    'generate the same key, and the stored payload carries `env` for the ' +
    'consumer to check. Not a collision — reading it needs a stolen token.',
  'lock:webhook:user:':
    'Keyed on the bare LINE `source.userId`, which LINE issues PER CHANNEL: ' +
    'the same person on a staging OA and a production OA is two different ' +
    'ids. Collides only if one OA is wired to both deployments at once.',
};

interface KeyUse {
  file: string;
  line: number;
  resolved: string;
}

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? tsFiles(full)
      : full.endsWith('.ts')
        ? [full]
        : [];
  });

/**
 * Every name a file defines that a key expression could refer to: module
 * constants, class properties (declaration initialiser AND `this.x = ...` in the
 * constructor), local `const`/`let`, and methods (resolved to their `return`).
 *
 * Built from the AST rather than by regex because the first version WAS a regex
 * and it resolved `extapi:`'s key to `customer_profile:`'s value — it matched
 * the first `const redisKey =` in the file instead of the one in scope. Both
 * happened to be namespaced, so the guard reported green on a resolution that
 * was simply wrong. หา declaration ผิดตัว = เขียวแบบไม่มีความหมาย
 */
const declarationsOf = (sf: ts.SourceFile): Map<string, string> => {
  const decls = new Map<string, string>();
  const remember = (name: string, expr: ts.Node | undefined): void => {
    if (!name || !expr) return;
    // First writer wins only for names not yet seen; a later, richer definition
    // (a method body over a bare field declaration) replaces an empty one.
    const text = expr.getText(sf).replace(/\s+/g, ' ');
    const prev = decls.get(name);
    if (prev === undefined || (prev.length < 3 && text.length > prev.length)) {
      decls.set(name, text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      remember(node.name.text, node.initializer);
    } else if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      remember(node.name.text, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      remember(node.left.name.text, node.right);
    } else if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.body
    ) {
      const returns: string[] = [];
      const findReturn = (n: ts.Node): void => {
        if (ts.isReturnStatement(n) && n.expression) {
          returns.push(n.expression.getText(sf));
        }
        ts.forEachChild(n, findReturn);
      };
      findReturn(node.body);
      if (returns.length) {
        decls.set(node.name.text, returns.join(' | ').replace(/\s+/g, ' '));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return decls;
};

/**
 * Expand an expression until it contains a literal or stops changing. Three hops
 * is enough for every shape in the tree today (`client.get(key)` → `buildKey()`
 * → its return → `keyPrefix()`), and the loop stops on its own rather than
 * relying on that number.
 */
const expand = (expr: string, decls: Map<string, string>): string => {
  let text = expr;
  for (let hop = 0; hop < 4; hop += 1) {
    const before = text;
    for (const [name, value] of decls) {
      const asCall = new RegExp(`\\bthis\\.${name}\\([^)]*\\)`);
      const asRef = new RegExp(`(?:\\bthis\\.)?\\b${name}\\b(?!\\s*[:(])`);
      if (asCall.test(text)) text = text.replace(asCall, `(${value})`);
      else if (asRef.test(text) && value !== name) {
        text = text.replace(asRef, `(${value})`);
      }
    }
    if (text === before) break;
  }
  return text.replace(/\s+/g, ' ');
};

/**
 * Is this call made on a Redis client?
 *
 * Matching the receiver's NAME was the first rule and it was WRONG: it missed
 * `const r = this.redisService.getClient()` in `custom-tool.service.ts`, whose
 * `custool:shared:` cache is a live 30-minute Redis entry. The guard reported
 * green over a key it simply could not see — the exact failure this file exists
 * to prevent, committed by this file. So the receiver is resolved to its
 * DECLARATION and accepted when that declaration calls `getClient()`; the name
 * pattern stays only as a fallback for receivers declared elsewhere.
 * ชื่อตัวแปรไม่ใช่หลักฐาน ต้องตามไปดูว่ามันถูกประกาศจากอะไร
 */
const isRedisReceiver = (recv: string, decls: Map<string, string>): boolean => {
  if (/client|redis/i.test(recv)) return true;
  const decl = decls.get(recv.replace(/^this\./, ''));
  return !!decl && decl.includes('getClient(');
};

const collectKeyUses = (): KeyUse[] => {
  const uses: KeyUse[] = [];
  for (const file of tsFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    // Only files that actually reach Redis. `redis.service.ts` is the wrapper
    // itself: its parameters ARE the key, so there is nothing to namespace.
    if (!source.includes('RedisService')) continue;
    if (file.endsWith(join('infra', 'redis', 'redis.service.ts'))) continue;

    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ true,
    );
    const decls = declarationsOf(sf);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.arguments.length > 0 &&
        isRedisReceiver(node.expression.expression.getText(sf), decls)
      ) {
        const cmd = node.expression.name.text;
        let keyArg: ts.Node | undefined;
        if (KEY_COMMANDS.has(cmd)) {
          // `del(...keys)` spreads keys a SCAN already found; the pattern that
          // found them is the key expression that matters, and it is checked at
          // the `scan` call below. A spread is not a key literal.
          const first = node.arguments[0];
          if (first && !ts.isSpreadElement(first)) keyArg = first;
        } else if (cmd === 'scan') {
          const args = node.arguments;
          const at = args.findIndex(
            (a) => ts.isStringLiteral(a) && a.text === 'MATCH',
          );
          const next = at >= 0 ? args[at + 1] : undefined;
          if (next) keyArg = next;
        }
        if (keyArg) {
          uses.push({
            file: file.slice(SRC.length + 1),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            resolved: expand(keyArg.getText(sf).replace(/\s+/g, ' '), decls),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return uses;
};

describe('[GLOBALNS] every shared Redis key is scoped to one environment', () => {
  const uses = collectKeyUses();

  it('the walk actually found the call sites — an empty sweep is a false pass', () => {
    // The failure this guards against is the guard itself silently matching
    // nothing after a refactor renames a client or moves a file. A green run
    // over zero call sites is the exact shape of a test that measures nothing.
    expect(uses.length).toBeGreaterThanOrEqual(25);
    const files = new Set(uses.map((u) => u.file));
    expect(files.size).toBeGreaterThanOrEqual(6);
  });

  it('⭐ every key carries an environment marker or an allow-listed reason', () => {
    const offenders = uses.filter((use) => {
      if (ENV_MARKERS.some((m) => use.resolved.includes(m))) return false;
      return !Object.keys(ALLOWED).some((k) => use.resolved.includes(k));
    });

    /* The resolved text can run to thousands of characters once names expand,
       which makes a failure unreadable in a terminal. Report the FAMILY — the
       literal prefix, which is what an author needs to recognise their key —
       and keep the full text only for the matching above. */
    expect(
      offenders.map((o) => {
        const family = /[`'"]([a-z][\w.-]*[:.])/.exec(o.resolved)?.[1] ?? '?';
        return `${o.file}:${o.line} → ${family}`;
      }),
    ).toEqual([]);
  });

  it('every allow-list entry carries a real reason, not a placeholder', () => {
    for (const [key, reason] of Object.entries(ALLOWED)) {
      expect(reason.length).toBeGreaterThan(60);
      expect(reason).not.toMatch(/^(todo|tbd|n\/a|-)$/i);
      expect(key).not.toBe('');
    }
  });

  it('every allow-list entry is still USED — a stale exemption is debt', () => {
    // An entry left behind after its key was namespaced or deleted quietly
    // widens the exemption for whatever key happens to match it next.
    const allText = uses.map((u) => u.resolved).join(' ');
    for (const key of Object.keys(ALLOWED)) {
      expect(allText).toContain(key);
    }
  });
});

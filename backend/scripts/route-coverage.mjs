#!/usr/bin/env node
/**
 * Route-coverage gate — fails when any HTTP route in src/ has zero tests.
 *
 * Run it before merge: `pnpm route-coverage`. It exits non-zero — and prints
 * exactly which routes are unguarded — when a route defined by a controller
 * decorator has no test under z-test/ exercising it.
 *
 * Why a script and not vigilance: PUT routes keep slipping through review.
 * A new @Put() endpoint ships, no test covers it, and nobody notices until the
 * owner reads the diff by hand. That is a human-memory failure mode, so we hand
 * it to a gate. PUT is listed FIRST in every report because it is the verb that
 * has historically been missed. (นี่คือด่านกันของที่คนลืมทดสอบบ่อยที่สุด)
 *
 * HOW COVERAGE IS DECIDED (heuristic — read this honestly):
 *   Test files build request paths dynamically (template strings, base-url
 *   helpers, :param interpolation), so we cannot match a full literal path.
 *   Instead a route counts as COVERED only when SOME file under z-test/
 *   contains BOTH:
 *     (a) its HTTP method — as `.put(` / `.post(` / … OR `'PUT'` / `"PUT"`; and
 *     (b) the route's last concrete (non-:param) path segment as a literal.
 *   This is APPROXIMATE. The design bias is deliberate: favouring "false
 *   covered" over "false missing" is NOT acceptable here. When the match is
 *   ambiguous we err toward reporting MISSING (louder) so a human looks —
 *   never toward silently passing. A route with no concrete segment at all
 *   (e.g. base only + empty sub) is reported MISSING for the same reason.
 *
 * Flags:
 *   --warn-only   print everything but always exit 0 (adopt incrementally
 *                 while the backlog is still open).
 *
 * No new deps: node builtins + a `grep` child process, same as
 * scripts/preflight-deploy.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WARN_ONLY = process.argv.includes('--warn-only');

// ── ANSI colours (match preflight-deploy.mjs exactly) ──────────────────────
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const RESET = '[0m';

// Verb order: PUT first — historically the missed verb. (PUT มาก่อนเสมอ)
const VERBS = ['PUT', 'POST', 'GET', 'PATCH', 'DELETE'];

// Map a decorator name to its HTTP verb.
const DECORATORS = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
};

/** Join a controller base and a method sub-path into one clean `/a/b` path. */
function joinPath(base, sub) {
  const parts = [];
  for (const p of [base, sub]) {
    if (!p) continue; // empty base or empty sub — skip it (handle '' cleanly)
    parts.push(...p.split('/').filter(Boolean));
  }
  return '/' + parts.join('/');
}

/**
 * Pull every quoted string out of a decorator's argument list.
 * Handles: @Get('sub'), @Get(['a','b']), @Put()  →  ['sub'] / ['a','b'] / [''].
 * A no-arg decorator yields a single '' so it maps to the base path.
 */
function extractSubPaths(argText) {
  const trimmed = argText.trim();
  if (trimmed === '') return ['']; // @Put() — sub is empty
  const literals = [...trimmed.matchAll(/['"`]([^'"`]*)['"`]/g)].map(
    (m) => m[1],
  );
  // If the parens held something but no string literal (e.g. a config object),
  // treat it as base-only so we still emit a route rather than dropping it.
  return literals.length ? literals : [''];
}

/**
 * Parse one controller file into a list of { method, path, file } routes.
 * A file may hold MULTIPLE @Controller classes; each route is attributed to
 * the NEAREST preceding @Controller above it. (ผูก route กับ @Controller ที่ใกล้ที่สุดด้านบน)
 */
function parseController(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const routes = [];
  let currentBase = null; // null = no controller seen yet

  const ctrlRe = /@Controller\(\s*(['"`]([^'"`]*)['"`])?\s*\)/;
  const methodRe = /@(Get|Post|Put|Patch|Delete)\(([\s\S]*?)\)/;

  for (const line of lines) {
    const c = ctrlRe.exec(line);
    if (c) {
      currentBase = c[2] ?? ''; // '' when @Controller() has no arg
      continue;
    }
    const m = methodRe.exec(line);
    if (m) {
      const verb = DECORATORS[m[1]];
      const base = currentBase ?? '';
      for (const sub of extractSubPaths(m[2])) {
        routes.push({ method: verb, path: joinPath(base, sub), file });
      }
    }
  }
  return routes;
}

/** Last concrete (non-:param, non-empty) segment of a path, or '' if none. */
function lastConcreteSegment(path) {
  const segs = path.split('/').filter((s) => s && !s.startsWith(':'));
  return segs.length ? segs[segs.length - 1] : '';
}

// ── Gather routes from all controllers ─────────────────────────────────────
let controllerFiles = [];
try {
  controllerFiles = execFileSync(
    'grep',
    ['-rl', '@Controller', 'src', '--include=*.controller.ts'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  console.error(`${RED}No controller files found under src/.${RESET}`);
  process.exit(1);
}

const routes = controllerFiles.flatMap(parseController);

// ── Load every test file's text once (concatenated haystack) ───────────────
// z-test files build paths dynamically, so we search the raw text, not an AST.
let testCorpus = '';
try {
  const testFiles = execFileSync(
    'grep',
    ['-rl', '', 'z-test', '--include=*.ts', '--include=*.mjs', '--include=*.js'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const f of testFiles) {
    try {
      testCorpus += readFileSync(f, 'utf8') + '\n';
    } catch {
      // unreadable file — skip, its absence only makes us louder (MISSING)
    }
  }
} catch {
  // no test files at all — every route will be reported MISSING, as intended
}

/** Does the test corpus mention this HTTP method in any recognised form? */
function methodMentioned(method) {
  const lower = method.toLowerCase();
  // .put( / .post( … OR 'PUT' / "PUT" (supertest & raw-fetch styles)
  if (testCorpus.includes(`.${lower}(`)) return true;
  if (testCorpus.includes(`'${method}'`)) return true;
  if (testCorpus.includes(`"${method}"`)) return true;
  return false;
}

/**
 * Covered = method mentioned AND the last concrete path segment appears as a
 * literal in some test. Ambiguous (no concrete segment) → NOT covered, so a
 * human looks. (คลุมเครือ = รายงานว่าขาด ไม่ปล่อยผ่านเงียบ ๆ)
 */
function isCovered(route) {
  const seg = lastConcreteSegment(route.path);
  if (!seg) return false; // nothing concrete to anchor on → report MISSING
  if (!methodMentioned(route.method)) return false;
  return testCorpus.includes(seg);
}

const missing = routes.filter((r) => !isCovered(r));

// ── Per-verb summary table ─────────────────────────────────────────────────
console.log('\nRoute coverage — test presence per HTTP verb\n');
console.log('  VERB     TOTAL  COVERED  MISSING');
console.log('  ------   -----  -------  -------');
for (const verb of VERBS) {
  const total = routes.filter((r) => r.method === verb).length;
  const miss = missing.filter((r) => r.method === verb).length;
  const covered = total - miss;
  const colour = miss > 0 ? (verb === 'PUT' ? RED : YELLOW) : GREEN;
  const pad = (n, w) => String(n).padStart(w);
  console.log(
    `  ${colour}${verb.padEnd(6)}${RESET}   ${pad(total, 5)}  ${pad(
      covered,
      7,
    )}  ${pad(miss, 7)}`,
  );
}

// ── List MISSING routes, grouped by verb, PUT first ────────────────────────
if (missing.length) {
  console.log(`\n${RED}MISSING — routes with no test exercising them:${RESET}`);
  for (const verb of VERBS) {
    const group = missing.filter((r) => r.method === verb);
    if (!group.length) continue;
    console.log(`\n  ${verb}:`);
    for (const r of group) {
      console.log(`    ${r.method} ${r.path}   (defined in ${r.file})`);
    }
  }
}

// ── Final line + exit code ─────────────────────────────────────────────────
console.log('');
if (missing.length === 0) {
  console.log(`${GREEN}✓ Every route has at least one test. Coverage clear.${RESET}\n`);
  process.exit(0);
}

if (WARN_ONLY) {
  console.log(
    `${YELLOW}⚠ ${missing.length} route(s) missing tests — --warn-only, exiting 0.${RESET}\n`,
  );
  process.exit(0);
}

console.error(
  `${RED}✗ ${missing.length} route(s) have no test. Add coverage or run with --warn-only.${RESET}\n`,
);
process.exit(1);

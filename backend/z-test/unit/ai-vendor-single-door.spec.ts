/**
 * [FEAT-20260907-AIVENDORCORE] A tripwire: nobody declares a vendor host but the door.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ============================================================================
 * WHAT THIS GUARDS. Before this change, NINE files owned a Gemini or DeepSeek
 * host string and they did not agree: `/v1beta` in the reply lane, `/v1` in the
 * summary lane and in translate, and `rag-engine.service.ts` used BOTH at
 * different call sites in one file. Nobody chose that — each transport was
 * transcribed from a different legacy function and inherited whatever it used.
 *
 * The fix is only as durable as this test. A new transport written next month
 * will naturally paste a URL, it will work, review will pass, and the scatter
 * starts again. So the rule is enforced rather than documented.
 *
 * ⚠️ THIS IS A SOURCE CENSUS, NOT A BEHAVIOUR TEST. It cannot tell you the
 *    requests are correct — `ai-vendor-wire-baseline.spec.ts` does that. It only
 *    says there is one place where the answer lives.
 *
 * ── The allow-list, and why each entry is on it ─────────────────────────────
 * `src/common/ai-endpoints.ts`  the declarations themselves
 * `src/modules/ai-vendor/**`    the door, which reads them
 *
 * 🔴 FOUR FILES ARE KNOWN OFFENDERS AND ARE LISTED, NOT HIDDEN. They are the
 *    Block-2 callers — `rag-engine`, `qr-vision`, `model.service` and the key
 *    probe — and each is named with what makes it awkward. A waiver that is
 *    written down is a plan; a waiver that is silent is a lie. **The list may
 *    only ever shrink**, which the count assertion below enforces.
 *
 * revert: delete this file. The URLs are still unified; only the guard goes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** A literal vendor host. Prose in a comment is not code and is skipped below. */
const VENDOR_HOST =
  /https:\/\/(generativelanguage\.googleapis\.com|api\.deepseek\.com)/;

/** Where a host string is allowed to appear. */
const ALLOWED = ['src/common/ai-endpoints.ts', 'src/modules/ai-vendor/'];

/**
 * Still to be moved, with the reason each one is not simply "next".
 * 🔴 THIS LIST MAY ONLY SHRINK — see the count assertion.
 */
/**
 * 🔴 EMPTY, AND THAT IS THE POINT — the list only ever shrank, and it reached zero.
 *
 * It held four names, then three, and now none:
 *   `ai/rag-engine.service.ts`        migrated with the door itself (4 URL sites,
 *                                     three `/v1` and one `/v1beta` in ONE file)
 *   `slip/qr-vision.service.ts`       byte-identical swap — it already used
 *                                     `/v1beta` + generateContent + a raw key
 *   `system/model.service.ts`         listing endpoint, key ENCODED, `/v1` pinned
 *   `hooks/ai-vendor/ai-key-probe.ts` listing endpoint for BOTH vendors; the
 *                                     import cycle its header described is gone
 *                                     because `@/common/*` imports nothing
 *
 * ⚠️ KEEPING THE MAP RATHER THAN DELETING IT is deliberate. The waiver mechanism
 *    is what makes a future exception have to be written down and justified
 *    instead of quietly slipping past the census. An empty map with a count
 *    assertion is a stronger guard than no map at all.
 */
const KNOWN_OFFENDERS: Record<string, string> = {};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Strip comments so a note explaining the trap stays legal, while keeping code.
 *
 * 🔴 THE NAIVE VERSION MADE THIS ENTIRE FILE VACUOUS, and it was green.
 *    `l.replace(/\/\/.*$/, '')` also eats the `//` inside `https://…`, so EVERY
 *    line holding a URL was truncated to `https:` and no file anywhere looked
 *    like an offender. All six assertions passed, the waiver check reported the
 *    four known offenders as "stale", and the guard could never have caught
 *    anybody. Caught only because the stale-waiver assertion disagreed with a
 *    hand count.
 *    A line comment is therefore only stripped when `//` is NOT preceded by `:`.
 *    That is deliberately crude — it does not understand strings — but it errs
 *    toward keeping text, and for a census that means false ALARMS, never false
 *    silence. A guard that fails loudly can be fixed; one that passes quietly
 *    cannot be noticed.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

describe('[FEAT-20260907-AIVENDORCORE] one door, enforced', () => {
  const files = filesUnder(SRC).map((f) => ({
    rel: f.slice(ROOT.length + 1),
    code: codeOnly(readFileSync(f, 'utf8')),
  }));

  it('finds files to check, so an empty sweep cannot pass silently', () => {
    /* Without this the suite is vacuous the day the walk breaks — which is the
       shape of bug this whole file exists to catch. */
    expect(files.length).toBeGreaterThan(100);
  });

  it('🔴 no file outside the door declares a vendor host', () => {
    const offenders = files
      .filter((f) => VENDOR_HOST.test(f.code))
      .map((f) => f.rel)
      .filter((rel) => !ALLOWED.some((a) => rel.startsWith(a)))
      .filter((rel) => !(rel in KNOWN_OFFENDERS));
    expect(offenders).toEqual([]);
  });

  it('🔴 the waiver list may only shrink — every entry must still be an offender', () => {
    /* A stale waiver is worse than none: it reserves permission nobody needs and
       makes the list look longer than the problem. If one of these has been
       migrated, DELETE its entry in the same commit. */
    const stale = Object.keys(KNOWN_OFFENDERS).filter((rel) => {
      const f = files.find((x) => x.rel === rel);
      return !f || !VENDOR_HOST.test(f.code);
    });
    expect(stale).toEqual([]);
  });

  it('🔴 the waived set is EMPTY — every AI host now lives in one file', () => {
    /* Was four, then three, now zero. The list may only ever shrink, and this
       assertion is what enforces that: adding a name makes it fail, so a new
       exception has to arrive with a deliberate edit to this number and a
       reason beside it. */
    expect(Object.keys(KNOWN_OFFENDERS)).toHaveLength(0);
  });

  it('🔴 the six migrated transports own no host at all', () => {
    /* Named individually rather than counted, so a regression says WHICH one. */
    const migrated = [
      'src/modules/webhook/ai-vendors/gemini/gemini-reply.transport.ts',
      'src/modules/webhook/ai-vendors/gemini/gemini-summary.transport.ts',
      'src/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport.ts',
      'src/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport.ts',
      /* [FEAT-20260908-CHATTRANS] retargeted — the translate funnel is its own
         module now. These two names are the LOUD half of the move: a path that
         stops existing makes `files.find` return undefined and
         `expect(f).toBeDefined()` fail by name. The four webhook entries above
         are untouched. */
      'src/modules/ai-translate/vendors/gemini-translate.transport.ts',
      'src/modules/ai-translate/vendors/deepseek-translate.transport.ts',
    ];
    for (const rel of migrated) {
      const f = files.find((x) => x.rel === rel);
      expect(f).toBeDefined();
      expect({
        rel,
        hasHost: VENDOR_HOST.test((f as { code: string }).code),
      }).toEqual({
        rel,
        hasHost: false,
      });
    }
  });

  it('🔴 NO transport fires its own request — axios lives in the door only', () => {
    /* [FEAT-20260908-AIVENDORSEND] The census guarded WHERE a vendor lives; this
       guards WHO may reach one. Until `send.ts` existed, `axios.post` appeared in
       six transports, so "one place talks to a vendor" was true of everything
       except the talking.

       ⚠️ Scoped to the AI transport folders on purpose. Plenty of files in this
       repo legitimately use axios — LINE push, the content API, custom tools.
       The rule is not "nobody uses axios", it is "no AI transport opens its own
       socket to a vendor". */
    /* 🔴 [FEAT-20260908-CHATTRANS] THIS LIST IS A `startsWith` PREFIX FILTER,
       AND THAT MAKES A STALE ENTRY SILENT. When the translate funnel moved, the
       old prefix stopped matching any file: `offenders` computed to `[]`, this
       case went on PASSING, and it guarded neither translate transport. The two
       stale names in the `migrated` array above failed loudly in the same run —
       this one did not, which is the whole difference. A prefix that matches
       nothing cannot report anything.
       ⇒ Proved repaired by MUTATION, never by the green tick: re-add
       `import axios from 'axios'` to a moved transport and this case must go
       RED. It was run, and it did. เขียวตรงนี้ไม่ใช่หลักฐาน ต้องทำให้แดงให้ดูก่อน.
       The webhook prefix on the line below is unchanged and stays first. */
    const TRANSPORT_DIRS = [
      'src/modules/webhook/ai-vendors/',
      'src/modules/ai-translate/vendors/',
    ];
    const offenders = files
      .filter((f) => TRANSPORT_DIRS.some((d) => f.rel.startsWith(d)))
      .filter((f) => /from 'axios'|require\('axios'\)/.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('🔴 the door is the ONLY place in src that posts to a vendor', () => {
    /* Named rather than counted so a regression says which file. `send.ts` is the
       one legal site; anything else calling axios.post inside ai-vendor would mean
       a second exit was added beside it. */
    const doorPosters = files
      .filter((f) => f.rel.startsWith('src/modules/ai-vendor/'))
      .filter((f) => /axios\.post\(/.test(f.code))
      .map((f) => f.rel);
    expect(doorPosters).toEqual(['src/modules/ai-vendor/send.ts']);
  });

  it('🔴 the door imports no other module — a leaf cannot create a cycle', () => {
    /* `chat → webhook` and `webhook → chat` both exist, so the graph already
       cycles. Any module dependency here would put some consumer on the wrong
       side of an arrow, which is the wall translate and ai-key-probe were stuck
       behind. `@/common/*` is not a module; it imports nothing itself. */
    const doorFiles = files.filter((f) =>
      f.rel.startsWith('src/modules/ai-vendor/'),
    );
    expect(doorFiles.length).toBeGreaterThan(2);
    const badImports = doorFiles.flatMap((f) =>
      (f.code.match(/from '@\/modules\/[^']+'/g) ?? []).map(
        (m) => `${f.rel}: ${m}`,
      ),
    );
    expect(badImports).toEqual([]);
  });
});

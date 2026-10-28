/**
 * Hard block on AI provider traffic from the test process.
 *
 * The owner's rule is absolute and has been restated three times: never call a
 * generative AI endpoint, never send `custom_ai_key` upstream. The key bills a
 * real account per token with no ceiling, and no test result is worth that.
 *
 * A rule repeated in prompts is not enforcement — six agents are working in
 * parallel and one wrong `fetch` costs money before anyone reads the diff. So
 * this replaces `globalThis.fetch` for every test file and throws on a request
 * to a known provider host, before the socket is opened.
 *
 * ── What this DOES cover ────────────────────────────────────────────────────
 * Any outbound request made by the test process itself: a spec that calls a
 * provider directly, a helper that builds a URL from config, an accidental
 * un-stubbed client in a unit test.
 *
 * ── What this CANNOT cover, and this matters ────────────────────────────────
 * The two backends are separate OS processes. When a golden test posts a
 * webhook to :10500 or :3100, the AI call is made by THAT process, not this
 * one, and nothing here can see it. The only protection there is not driving
 * those routes — which is why every agent brief carries the constraint, and why
 * a branch that reaches an AI call is left untested and reported rather than
 * fired.
 *
 * So this is one layer, honestly bounded. It is not a licence to stop thinking
 * about which route a request lands on.
 */

/**
 * Hosts and path fragments that mean a generative model is about to be invoked.
 *
 * Matched against the whole URL, case-insensitively, so a provider reached
 * through a proxy path still trips it. Deliberately broad: a false positive
 * costs one test author a minute, a false negative costs money.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /generativelanguage\.googleapis\.com/i,
  /aiplatform\.googleapis\.com/i,
  /\bgenerateContent\b/i,
  /\bstreamGenerateContent\b/i,
  /api\.openai\.com/i,
  // [P2-20260813] DeepSeek — added BEFORE its transport exists, so a spec that
  // forgets to stub axios trips this instead of billing a real account.
  /api\.deepseek\.com/i,
  /\/v1(beta)?\/models\/[^/]+:/i, // provider-style "models/x:action" endpoints
];

const describeTarget = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
};

export class ForbiddenAiCallError extends Error {
  constructor(url: string, pattern: RegExp) {
    super(
      `BLOCKED: a test tried to call an AI provider.\n` +
        `  url:     ${url}\n` +
        `  matched: ${pattern}\n\n` +
        `This is prohibited outright — the key bills a real account per token ` +
        `with no ceiling.\nIf you need to cover this path, stub the HTTP client ` +
        `and assert the request that WOULD have been sent, as ` +
        `z-test/unit/model-list.spec.ts does.`,
    );
    this.name = 'ForbiddenAiCallError';
  }
}

/**
 * Wraps the global fetch. Idempotent: a spec that installs its own stub after
 * this runs replaces the wrapper, which is correct — a stub makes no real call.
 */
export const installAiOutboundGuard = (): void => {
  const original = globalThis.fetch;
  if (!original) return;

  const guarded: typeof fetch = (input, init) => {
    const url = describeTarget(input);
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(url)) throw new ForbiddenAiCallError(url, pattern);
    }
    return original(input, init);
  };

  globalThis.fetch = guarded;
};

/**
 * [FIX-20260813-UNHANDLED] Surface a leaked rejection without hiding failures.
 *
 * A spec that fires a real request at a dead host leaves an unhandled
 * rejection, and Node's default is to KILL THE PROCESS — with `maxWorkers: 1`
 * that takes the whole suite down mid-run. That cost a checkpoint here
 * (`ckpt-p2t01-guard` still cannot run the full suite).
 *
 * ⚠️ REVIEW FIX (same day): the first version of this handler only logged, which
 *    turned a fatal failure into a SILENT one — an un-awaited assertion error
 *    would have let a broken test report PASS. Two corrections:
 *      1. a `ForbiddenAiCallError` is re-thrown, so the money guard keeps its
 *         teeth even when it fires from an un-awaited promise;
 *      2. every other rejection is RECORDED and exposed via
 *         `drainLeakedRejections()`, so a spec (or a future global teardown) can
 *         assert the list is empty instead of trusting a console line.
 *    เงียบไม่ได้ ตายทั้งชุดก็ไม่ได้ — ต้องเห็นและตรวจสอบได้.
 *
 * ⚠️ The de-dupe flag lives on `process`, NOT `globalThis`: jest gives each test
 *    FILE a fresh module registry and `globalThis`, while `process` is shared —
 *    a `globalThis` flag would re-arm per file and stack one listener per spec
 *    file (MaxListenersExceededWarning at 11+).
 *
 * revert: delete this block; behaviour returns to process-kill.
 */
const leaked: string[] = [];

/** Rejections seen so far; clears the buffer. Empty is the healthy state. */
export const drainLeakedRejections = (): string[] =>
  leaked.splice(0, leaked.length);

type HookedProcess = NodeJS.Process & { __aiGuardRejectionHooked?: boolean };
const proc = process as HookedProcess;
if (!proc.__aiGuardRejectionHooked) {
  proc.__aiGuardRejectionHooked = true;
  process.on('unhandledRejection', (reason) => {
    // The one rejection that must never be downgraded: an un-awaited call that
    // the guard blocked. Re-throwing keeps it fatal, which is the point of it.
    if (reason instanceof ForbiddenAiCallError) throw reason;
    const text = String(reason instanceof Error ? reason.message : reason);
    leaked.push(text);
    // eslint-disable-next-line no-console
    console.error(
      `[TEST-UNHANDLED-REJECTION] a spec left a promise unhandled — stub your ` +
        `HTTP client. Reason: ${text}`,
    );
  });
}

installAiOutboundGuard();

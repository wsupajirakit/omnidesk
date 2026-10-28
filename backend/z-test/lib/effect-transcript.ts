/**
 * [PROG-20260905-P8] The effect transcript — the before/after proof for the spine
 * reduction program.
 *
 * WHAT PROBLEM THIS SOLVES. Every step of the program moves a body out of
 * `processLockedEvent` and leaves a call in its place. The suites assert the things
 * somebody thought to assert; they cannot say "and nothing else changed". This turns one
 * run of the flow into a single deterministic text — every DB write, every outbound LINE
 * call, every webhook_log row, in the order they happened — so a move is proven by the
 * transcript being byte-identical, not by a green tick.
 *
 * WHY A TEXT AND NOT A DEEP-EQUAL. A diff of two texts tells a human WHICH effect moved;
 * a failed deep-equal on a nested object tells them a path. When the reviewer is deciding
 * whether a 137-line move was safe, the diff is the evidence.
 *
 * WHAT IS SCRUBBED, AND WHY THAT IS NOT CHEATING. Ids, tokens, timestamps and durations
 * differ between two runs of identical code; leaving them in makes every transcript
 * differ and the proof worthless. They are replaced by stable placeholders that still
 * record PRESENCE and SHAPE — `<id>` proves an id was written, `<ts>` proves a timestamp
 * was, and a missing field still shows up as missing. The scrub list is deliberately
 * narrow: anything not on it is compared byte for byte.
 *
 * Precedent: `z-test/golden/writes/write-harness.ts` already scrubs volatile values for
 * the golden write lane. This is the same idea applied to the webhook effect stream.
 */

/** One recorded effect. `kind` groups them; `at` is the order they were recorded in. */
export interface EffectEvent {
  kind: string;
  detail?: unknown;
}

/**
 * The shape a replay harness hands over. Kept structural (not a class) so the existing
 * flow harnesses can produce one by naming their trace arrays — no rewrite of the specs
 * that already collect them.
 */
export interface EffectTrace {
  /** Ordered effect stream: sends, writes, log rows, in the order they occurred. */
  effects: EffectEvent[];
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const OBJECT_ID = /\b[0-9a-f]{24}\b/gi;
const LINE_USER_ID = /\bU[0-9a-f]{32}\b/gi;
const EPOCH_MS = /\b1[6-9]\d{11}\b/g; // 2022-2033 in milliseconds
const DURATION_KEY = /"(duration_ms|took_ms|elapsed_ms|latency_ms)":\s*\d+/g;
/* Wall-clock text the flow BUILDS and hands to the model — `timeContextText` and
   `thai_time`. Caught while generating the first goldens: the transcripts carried
   "Today is วันเสาร์ที่ 05 กันยายน 69 13:18:03", so two runs a second apart would have
   differed. A flaky proof is worse than none — it gets ignored, and then a real
   regression is ignored with it. The Thai date is scrubbed as a unit BEFORE the clock,
   so a changed date FORMAT (a real behaviour change) still shows. */
const THAI_LONG_DATE =
  /วัน[\u0E00-\u0E7F]+ที่ \d{1,2} [\u0E00-\u0E7F]+ \d{2,4}/g;
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/**
 * Replace values that legitimately differ between two runs of the SAME code.
 * Order matters: the more specific patterns run first so a LINE user id is not first
 * mangled by the hex-id rule.
 */
export function scrubVolatile(text: string): string {
  /* ORDER IS LOAD-BEARING, and getting it wrong is silent. `CLOCK` ran before `ISO_DATE`
     on the first attempt and ate the time half of every ISO timestamp
     ("2026-09-05T12:<clock>.000Z") — the transcript still looked plausible. The rule:
     longest, most specific pattern first; the generic clock last. */
  return text
    .replace(DURATION_KEY, '"$1":<ms>')
    .replace(ISO_DATE, '<ts>')
    .replace(THAI_LONG_DATE, '<thaiDate>')
    .replace(CLOCK, '<clock>')
    .replace(LINE_USER_ID, '<lineUserId>')
    .replace(OBJECT_ID, '<id>')
    .replace(EPOCH_MS, '<epoch>');
}

/**
 * Stable JSON: keys sorted at every level, so a change in property insertion order — which
 * is not a behaviour change — cannot redden a transcript. A REAL change (a different
 * value, a field that stopped being written) still shows.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Render a trace as the transcript. One line per effect, numbered, in recorded order —
 * ORDER IS BEHAVIOUR in this flow (send before row, row before ticket), so the numbering
 * is part of the proof, not decoration.
 */
export function renderTranscript(trace: EffectTrace): string {
  const lines = trace.effects.map((e, i) => {
    const body = e.detail === undefined ? '' : ` ${stableStringify(e.detail)}`;
    return `${String(i + 1).padStart(3, '0')} ${e.kind}${body}`;
  });
  return `${scrubVolatile(lines.join('\n'))}\n`;
}

/**
 * Convert the trace arrays the existing webhook harnesses already collect into one
 * ordered effect stream.
 *
 * ⚠️ LIMITATION, STATED BECAUSE IT DECIDES WHAT THIS CAN PROVE: the legacy harnesses keep
 * a `steps: string[]` list in true chronological order but store the payloads in separate
 * per-kind arrays. This function interleaves by consuming each kind's array in order as
 * its step name appears, which reconstructs the real order only when `steps` records every
 * effect. A harness that forgets to push a step gets a transcript that is stable but
 * incomplete — so `assertStepsCoverEffects` below is not optional politeness, it is the
 * guard that stops a silent gap from reading as "nothing changed".
 */
export function traceFromSteps(
  steps: string[],
  buckets: Record<string, unknown[]>,
): EffectTrace {
  const cursors: Record<string, number> = {};
  const effects: EffectEvent[] = steps.map((step) => {
    const bucket = buckets[step];
    if (!bucket) return { kind: step };
    const idx = cursors[step] ?? 0;
    cursors[step] = idx + 1;
    // `detail` stays undefined when the bucket ran out — the transcript then shows the
    // step with no payload, which is visibly different from the payload being absent.
    return { kind: step, detail: bucket[idx] };
  });
  return { effects };
}

/**
 * Every payload the harness collected must have been announced as a step. Returns the
 * kinds whose bucket holds more entries than `steps` claims — a non-empty result means the
 * transcript is under-reporting and must not be used as proof.
 */
export function findUnreportedEffects(
  steps: string[],
  buckets: Record<string, unknown[]>,
): string[] {
  const counted: Record<string, number> = {};
  for (const s of steps) counted[s] = (counted[s] ?? 0) + 1;
  return Object.keys(buckets)
    .filter(
      (kind) => (buckets[kind] as unknown[]).length > (counted[kind] ?? 0),
    )
    .sort();
}

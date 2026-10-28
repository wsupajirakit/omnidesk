/**
 * [PROG-20260905-LADDER] Walk the ladder, and refuse an order that contradicts itself.
 *
 * 📖 `docs/flow/webhook-flow-and-gates.md` §4-§5 list what every gate reads and writes and
 * why each ordering rule exists — rendered from the declarations these two fences check.
 *
 * Two functions, and they are deliberately separate: `runLadder` is what the turn calls,
 * `assertLadderOrder` is what the boot and the spec call. Checking the order inside the
 * runner would put a graph walk on every customer message to answer a question that cannot
 * change between deployments.
 */

import type {
  InlineSpineStep,
  LadderStep,
  TurnContext,
  TurnDeps,
} from './ladder.types';

/**
 * Run the steps in order and stop at the first one that ends the turn.
 *
 * @returns true when a step answered `'done'` — the caller returns immediately, which is
 *          byte-for-byte what the `return` inside that guard did.
 *
 * ⚠️ SEQUENTIAL AND AWAITED, ALWAYS. The steps write rows, send messages and consume
 * quota; the order IS the behaviour. There is no version of this that maps in parallel.
 *
 * ⚠️ IT DOES NOT CATCH. A step that throws must escape to the spine's own try/catch, which
 * writes the `handle_webhook` row — the record an incident is opened from. Swallowing here
 * would lose that row and turn a visible failure into a customer who was answered by
 * nothing at all. ไม่ดักไว้เอง ต้องให้ catch ข้างนอกเขียนแถวไว้
 */
export async function runLadder(
  steps: readonly LadderStep[],
  ctx: TurnContext,
  deps: TurnDeps,
): Promise<boolean> {
  for (const step of steps) {
    if (!step.enabled) continue;
    if (step.when && !step.when(ctx)) continue;
    if ((await step.run(ctx, deps)) === 'done') return true;
  }
  return false;
}

/**
 * Prove the shipped order satisfies every declared constraint.
 *
 * Throws — it does not return a verdict — for the same reason `buildEventHandlerRegistry`
 * throws: **failing at boot beats failing on a customer**. An order that contradicts itself
 * is not a degraded service, it is a service whose behaviour nobody can predict.
 *
 * Exported and pure so a spec can drive it with a deliberately broken list; that is how the
 * three refusals below are proven rather than asserted.
 */
export function assertLadderOrder(
  steps: readonly LadderStep[],
  inline: readonly InlineSpineStep[] = [],
): void {
  const position = new Map<string, number>();
  steps.forEach((step, i) => {
    if (position.has(step.id)) {
      throw new Error(
        `[LADDER] two steps claim the id '${step.id}' — the order is ambiguous`,
      );
    }
    position.set(step.id, i);
  });

  const stillInline = new Map<string, InlineSpineStep>();
  for (const entry of inline) {
    if (position.has(entry.id)) {
      throw new Error(
        `[LADDER] '${entry.id}' is declared as still inline in the spine, but a step ` +
          `with that id is in the ladder — one of the two is out of date`,
      );
    }
    stillInline.set(entry.id, entry);
  }

  /**
   * Resolve one end of a constraint.
   *
   * An inline position answers with the only fact that is knowable about it: it is either
   * entirely before this ladder slice (−1) or entirely after it (steps.length). An id that
   * is neither a step nor a declared inline position is a typo, and a typo must fail —
   * otherwise a constraint that protects a real rule could be silently doing nothing.
   */
  const indexOf = (id: string, from: LadderStep): number => {
    const inLadder = position.get(id);
    if (inLadder !== undefined) return inLadder;
    const outside = stillInline.get(id);
    if (outside)
      return outside.relativeToLadder === 'before' ? -1 : steps.length;
    throw new Error(
      `[LADDER] '${from.id}' names '${id}', which is neither a step in this ladder nor ` +
        `a declared inline spine position — a constraint that names nothing enforces nothing`,
    );
  };

  for (const step of steps) {
    const here = position.get(step.id) as number;
    const why = step.orderNote ? ` — ${step.orderNote}` : '';

    for (const other of step.mustFollow ?? []) {
      if (indexOf(other, step) > here) {
        throw new Error(
          `[LADDER] '${step.id}' must follow '${other}' but runs before it${why}`,
        );
      }
    }
    for (const other of step.mustPrecede ?? []) {
      if (indexOf(other, step) < here) {
        throw new Error(
          `[LADDER] '${step.id}' must precede '${other}' but runs after it${why}`,
        );
      }
    }
  }
}

/**
 * Prove every field a step READS has already been written when it runs.
 *
 * ⚠️⚠️ THIS IS THE CHECK NOTHING ELSE PERFORMS. tsc cannot do it: a step reading
 * `ctx.skipBotProcessing` before the step that writes it compiles perfectly and reads
 * `false` — the field exists, the type is right, and the initial value is a legitimate
 * one. The turn just quietly answers as though no operator were holding the room. There is
 * no type error, no exception, and no failing assertion anywhere in the suite.
 *
 * A field is satisfied when the SPINE provides it, or when an EARLIER step declares it in
 * `writes`. A step may also read what it writes itself (`api-error-trigger` re-stamps
 * `bangkokTime`), so its own `writes` count.
 *
 * ⚠️ A step with no `reads` declaration is SKIPPED rather than assumed safe — the fence
 * grows as steps declare, and silence is not evidence. `gate-ladder-order.spec.ts` fails
 * separately on any step that declares neither, so silence cannot become the norm.
 */
export function assertDataChain(
  steps: readonly LadderStep[],
  provided: readonly string[],
): void {
  const ready = new Set<string>(provided);
  for (const step of steps) {
    for (const field of step.reads ?? []) {
      if (ready.has(field) || (step.writes ?? []).includes(field)) continue;
      throw new Error(
        `[LADDER] '${step.id}' reads '${String(field)}' but nothing before it writes ` +
          `that field — it would read the context's initial value, which compiles and ` +
          `is silently wrong`,
      );
    }
    for (const field of step.writes ?? []) ready.add(field);
  }
}

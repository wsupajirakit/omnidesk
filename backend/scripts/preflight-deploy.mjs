#!/usr/bin/env node
/**
 * Refuses to let local-only test harnesses reach staging or production.
 *
 * Run this before any deploy: `pnpm preflight`. It exits non-zero — and says
 * exactly what to do — if a blocker is present.
 *
 * Why a script and not a code comment: the AI test harness fails SILENTLY in
 * production. Once its hardcoded call ceiling fills, the provider throws, the
 * webhook pipeline catches that and treats it as "the model had nothing to
 * say", and the bot simply stops answering customers. No error surfaces, no
 * alert fires, and the logs look like normal quiet traffic. A blocker with that
 * failure mode cannot be left to whoever remembers to read a comment.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Each entry: something that must NOT exist in a deployable build. */
const BLOCKERS = [
  {
    pattern: 'ScriptedAiReplyProvider',
    stubbedBy: 'build/prod-stubs/scripted-ai-reply.provider.ts',
    stubTarget: 'src/modules/webhook/ai-reply/scripted-ai-reply.provider.ts',
    what: 'the scripted (mock) AI provider',
    why:
      'It answers customers from a hardcoded script instead of a model. In ' +
      'production that means fabricated replies. The webhook.module factory ' +
      'already throws at boot if NODE_ENV=production selects it, but the file ' +
      'must not reach a deployable build at all — defence in depth.',
    fix:
      'The scripted provider is a local test harness. It is selected only by ' +
      'AI_PROVIDER=mock, which a prod build must never set. Ensure prod does ' +
      'not depend on it; if a build genuinely must exclude the file, gate it ' +
      'out of the deploy artifact. See test-case/PLAN-webhook-0.5-rev2-mock-ai.md',
  },
  {
    pattern: 'PAYMENT_TEST_LOCAL_ONLY',
    what: 'the local-only payment statement bypass (BYPASS_01 / BYPASS_02)',
    why:
      'It waives the slip-to-statement AMOUNT check in payment-runner, which is ' +
      'the one rule standing between a slip and a pending deposit it did not pay ' +
      'for. Waiving it credits the wrong deposit. The runtime already refuses to ' +
      'honour the flags unless PAYMENT_TEST_LOCAL_ONLY names a loopback host, but ' +
      'money code must not reach a deployable build carrying a bypass at all — ' +
      'defence in depth, exactly as for the scripted AI providers above.',
    fix:
      'The bypass exists so a developer can reach the walletpay leg on a database ' +
      'cloned from staging, where slip and deposit amounts rarely line up. It is ' +
      'enabled by PAYMENT_TEST_LOCAL_ONLY=127.0.0.1 plus one of ' +
      'PAYMENT_TEST_SKIP_AMOUNT_MATCH / PAYMENT_TEST_FORCE_STATEMENT_AMOUNT on ' +
      'that machine only. Before a release, delete the block tagged ' +
      '[TEST-20260810-LOCALBYPASS] in src/modules/payment/payment-runner.service.ts ' +
      '— the filter beneath it is already the original code. See ' +
      'todo/be_full_flow_payment_test.md',
  },
  {
    pattern: 'ScriptedAssistSummaryProvider',
    stubbedBy: 'build/prod-stubs/scripted-assist-summary.provider.ts',
    stubTarget:
      'src/modules/webhook/assist/scripted-assist-summary.provider.ts',
    what: 'the scripted (mock) assist-summary provider',
    why:
      'It summarises real customer hand-offs from a hardcoded script instead of ' +
      'a model, writing the scripted value into ticket.need_detail. In ' +
      'production that means fabricated case summaries. The webhook.module ' +
      'factory already throws at boot if NODE_ENV=production selects it, but the ' +
      'file must not reach a deployable build at all — defence in depth, exactly ' +
      'as for ScriptedAiReplyProvider.',
    fix:
      'The scripted summary provider is a local test harness, selected only by ' +
      'AI_PROVIDER=mock, which a prod build must never set. Ensure prod does not ' +
      'depend on it; if a build genuinely must exclude the file, gate it out of ' +
      'the deploy artifact. See src/modules/webhook/ai-vendors/gemini/assist-summary.provider.ts',
  },
  {
    pattern: 'GEMINI_TEST_KEY',
    what: 'reliance on the shared Gemini TEST key',
    why:
      'The real provider currently reads GEMINI_TEST_KEY, not each OA’s own ' +
      'custom_ai_key, so a prod deploy would bill one shared test account for ' +
      'every OA. The per-hook key path is the unfinished production step (owner ' +
      'authorised two verification calls, dev + stg/prod).',
    fix:
      'Wire hook.custom_ai_key into GeminiReplyProvider before shipping to ' +
      'production; see the header of src/modules/webhook/ai-vendors/gemini/gemini-reply.provider.ts',
  },
  {
    pattern: 'ScriptedTranslateProvider',
    stubbedBy: 'build/prod-stubs/scripted-translate.provider.ts',
    // Without this the destination is never checked: the COPY at Dockerfile:56
    // would create an orphan if the provider ever moves, and the real scripted
    // translate provider would ship while preflight still reported "clear".
    stubTarget: 'src/modules/ai-translate/scripted-translate.provider.ts',
    what: 'the scripted (mock) ticket-translate provider',
    why:
      'It answers translations from a script instead of a model. An admin would ' +
      'paste fabricated text to a customer. Same class of risk as the other two ' +
      'scripted providers, gated the same way.',
    fix:
      'The deploy build must COPY the stub over the scripted provider before ' +
      'pnpm build — same mechanism as the reply and summary stubs.',
  },
];

let failed = 0;

/**
 * [FIX-20260818-STUBATBUILD] Some blockers cannot leave `src/`.
 *
 * The scripted AI providers are DI tokens wired into `webhook.module.ts` and the
 * classes the switch tests construct to prove `AI_PROVIDER=mock` is refused —
 * deleting them from source would break the guard's own tests. For those the
 * question is not "is it in src" but "does the deploy build replace it", so this
 * checks the Dockerfile performs the swap and that the stub actually exists.
 *
 * This is NOT a waiver. A missing COPY line or a missing stub still blocks; the
 * assertion simply moved from the source tree to the build. ไม่ใช่การยกเว้น —
 * ย้ายที่ตรวจจาก source ไปที่ build.
 */
function stubCheck(b) {
  const problems = [];
  if (!existsSync(b.stubbedBy)) {
    problems.push(`stub file missing: ${b.stubbedBy}`);
  }
  let dockerfile = '';
  try {
    dockerfile = readFileSync('Dockerfile', 'utf8');
  } catch {
    problems.push('Dockerfile could not be read');
  }
  if (dockerfile && !dockerfile.includes(b.stubbedBy)) {
    problems.push(`Dockerfile does not COPY ${b.stubbedBy} over the real file`);
  }
  /*
   * MERGE NOTE 18/08 — the destination is checked too, and this is why.
   *
   * The check used to ask only whether the Dockerfile MENTIONED the stub. A COPY
   * whose destination does not exist does not fail — Docker creates it — so a
   * line pointing at a path that had since moved would add an orphan file nobody
   * imports, ship the real scripted provider untouched, and pass this check the
   * whole way. That is exactly what happened when this lane moved both providers
   * into folders. Naming the target here means the guard notices the next move.
   * ถ้าปลายทางผิด COPY ไม่ error แต่ของจริงหลุดขึ้น deploy ⇒ ต้องตรวจปลายทางด้วย.
   */
  if (b.stubTarget) {
    if (!existsSync(b.stubTarget)) {
      problems.push(
        `stub destination does not exist: ${b.stubTarget} (the COPY would create an orphan and the real file would ship)`,
      );
    }
    if (dockerfile && !dockerfile.includes(b.stubTarget)) {
      problems.push(
        `Dockerfile COPY does not target ${b.stubTarget} — it would not replace the real file`,
      );
    }
  }
  return problems;
}

for (const b of BLOCKERS) {
  if (b.stubbedBy) {
    const problems = stubCheck(b);
    if (problems.length) {
      failed += 1;
      console.error(
        `\n\x1b[31m✗ BLOCKED: ${b.what} would ship — the deploy build does not stub it\x1b[0m`,
      );
      problems.forEach((m) => console.error(`    ${m}`));
      console.error(`\n  WHY THIS MATTERS\n    ${b.why}`);
      console.error(
        `\n  HOW TO FIX\n    Restore the stub and the Dockerfile COPY line that puts it in ` +
          `place before \`pnpm build\`. Verify on a built image with:\n` +
          `      grep -rc 'AI-MOCK' dist/modules/webhook/scripted-*.js   → 0`,
      );
    } else {
      console.log(
        `\x1b[32m✓\x1b[0m ${b.what} — stubbed out of the deploy build (${b.stubbedBy})`,
      );
    }
    continue;
  }
  let hits = '';
  try {
    // -l: filenames only. grep exits 1 when nothing matches, which is success.
    hits = execFileSync('grep', ['-rl', b.pattern, 'src'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    // no matches — this blocker is clear
  }

  if (hits) {
    failed += 1;
    console.error(`\n[31m✗ BLOCKED: ${b.what} is still in src/[0m`);
    console.error(`  matched "${b.pattern}" in:`);
    hits.split('\n').forEach((f) => console.error(`    ${f}`));
    console.error(`\n  WHY THIS MATTERS\n    ${b.why}`);
    console.error(`\n  HOW TO FIX\n    ${b.fix}`);
  } else {
    console.log(`[32m✓[0m ${b.what} — not present`);
  }
}

if (failed) {
  console.error(
    `\n[31m${failed} blocker(s). This build must not be deployed.[0m\n`,
  );
  process.exit(1);
}

console.log('\nPreflight clear — safe to deploy.\n');

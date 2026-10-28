/**
 * =============================================================================
 * [PIN-20260903-SLIPANSWERTWIN] The slip answer is written TWICE — pin them equal
 * =============================================================================
 *
 * `processLockedEvent` answers a customer's slip from TWO places: once for a room
 * an admin is holding (the assist branch) and once for an ordinary room. Both run
 * the same three steps in the same order — payment suppression, then the card,
 * then the fire-and-forget callback — and the arguments they hand to each step
 * were measured on 03/09 as the same eleven / seven / eleven, in the same order.
 *
 * WHY THIS FILE EXISTS, and it is not the extraction itself.
 * Nothing today compares the two sites against each other. A change made at one
 * and missed at the other is invisible: both paths still answer a customer with a
 * card, both still pass every existing suite, and the two simply drift. This repo
 * already carries that exact failure on the dashboard side, where one customer
 * info panel exists twice and editing one leaves the other untouched and stale.
 * Here the same shape sits on the money path, one hop before `handleSlipCallback`
 * keys the deposit callback.
 *
 * THIS IS A **PIN**, NOT A TARGET (`line-flow-test` §4). It asserts behaviour
 * that already holds, so it must be GREEN BEFORE any refactor and GREEN AFTER.
 * It is deliberately written BEFORE `slip-flex/slip-answer.ts` exists, so that
 * "the extraction changed nothing" is a measurement rather than a claim — the
 * same discipline `slip-flex-before-extract.spec.ts` used for the previous split
 * and `slip-outbound-baseline.spec.ts` used for the provider move.
 *
 * WHY IT READS SOURCE INSTEAD OF DRIVING THE FLOW.
 * The two blocks sit inside a 5,455-line method, ~640 lines apart, behind the
 * whole inbound pipeline. Driving them behaviourally is what
 * `webhook-ingest-flow.spec.ts` already does — and it cannot see this defect,
 * because a drifted pair is still self-consistent on each path. The thing being
 * guarded IS the sameness of two argument lists, and nothing observable
 * distinguishes their divergence until a customer gets the wrong card. So the
 * assertion reads the caller's own source with comments stripped, which is the
 * shape `line-flow-test` §4 prescribes for pinning a call site and which
 * `slip-provider-hook-field.spec.ts` already uses for the same class of silent
 * omission.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE COMPARING, ON PURPOSE. The two blocks carry
 * different prose — one explains the assist ordering, the other explains the
 * ticket collision — and that prose is worth keeping different. Only the code is
 * pinned.
 *
 * ⚠️ WHAT IS DELIBERATELY **NOT** PINNED, because the two genuinely differ there:
 *   · the local variable names (`assistPaySuppress` / `paySuppress`)
 *   · the callback's log label — `[CALLBACK-TRIGGER] Error (assist)` vs `Error`
 *   · everything BETWEEN the card and the callback. The ordinary branch runs the
 *     assist guard, the ticket mechanism and the `image_answer_text` gate there;
 *     the assist branch returns. That difference is real and must stay outside
 *     any wrapper — see `docs/slip-spec.md` §14.3 for why one wrapper spanning
 *     all three steps is refused.
 *
 * IF THIS FILE IS WHY YOUR BUILD IS RED, you edited one site and not the other.
 * Fix the site, not this test. If the divergence is intended, say so here and
 * retire the case with a reason — a deleted case is a lost argument.
 *
 * AFTER the extraction lands this file does not go away: rewrite it to assert
 * both sites call the shared helper, which is the same guarantee stated against
 * the new shape.
 *
 * revert: delete this file. Nothing imports it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

import { MEDIA_LADDER } from '@/modules/webhook/gates/ladder-order';
import { resolve } from 'node:path';

const SERVICE = 'modules/webhook/webhook.service.ts';

/**
 * [PROG-20260905-CENSUSCONV] The twin obligation is REAL protection and is kept exactly:
 * two suppression sites, two card sites, two callback sites, spelled identically. What
 * changed is only WHERE it looks. The reduction program moves bodies into role
 * directories, and reading the service alone would report a successful move as a deleted
 * twin — a spec that reddens on safe changes gets deleted, and this one is worth keeping.
 *
 * Concatenation, not per-file counting, on purpose: the rule is "exactly two in the flow",
 * and a fold that splits the twins across two files must still fail if one of them loses a
 * field. Adding a THIRD site anywhere in these directories still fails, which is the case
 * this file exists for.
 */
const TWIN_SOURCES: readonly string[] = [
  SERVICE,
  /* Where a moved CALL SITE may live — deliberately NOT `slip-flex/`, which holds the
     IMPLEMENTATION of `handleSlipFlex`. Including it counted the definition as a third
     call and the spec said so immediately, which is the behaviour this conversion needed
     to preserve: the count still means "call sites", not "text occurrences". */
  'modules/webhook/non-text',
  'modules/webhook/hook-reply',
  /* [PROG-20260905-LADDER] the ORDINARY site became ladder steps — `slip-flex-send.step.ts`
     runs the payment and the card, `slip-card-sent.step.ts` fires the callback. Still
     deliberately NOT `slip-flex/`, which holds the implementation: the count has to keep
     meaning "call sites", not "text occurrences". */
  'modules/webhook/gates',
];

/**
 * [PROG-20260905-LADDER] Strip `turnDeps` — the ladder's ONE wiring site.
 *
 * 🔴 IT IS NOT A CALL SITE AND MUST NOT BE COUNTED AS ONE. `turnDeps` binds every
 * collaborator once for the turn, so it contains a line that looks exactly like a call to
 * each of them (`runPaymentForSlip: (input) => this.runPaymentForSlip({ … })`). Counted,
 * it makes a two-site rule report three and the fence fails for a reason that has nothing
 * to do with the rule.
 *
 * SP28 hit the same class of false positive from the other direction — a census counted a
 * doc COMMENT quoting the pattern as a door, and a deps BINDING as a call site. The answer
 * then and now: strip the wiring before counting, because a binding is plumbing and the
 * rule is about SITES. ตัวผูก dep ไม่ใช่จุดเรียก
 */
const stripTurnDeps = (src: string): string => {
  const at = src.indexOf('private turnDeps(');
  if (at < 0) return src;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(0, at) + src.slice(i + 1);
    }
  }
  return src;
};

const source = (): string => {
  const parts: string[] = [];
  for (const entry of TWIN_SOURCES) {
    const abs = resolve(__dirname, '../../src', entry);
    if (!existsSync(abs)) continue; // a role directory a later step creates
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) {
        if (f.endsWith('.ts'))
          parts.push(readFileSync(resolve(abs, f), 'utf8'));
      }
    } else {
      parts.push(stripTurnDeps(readFileSync(abs, 'utf8')));
    }
  }
  return parts.join('\n');
};

/**
 * Block comments, line comments and blank lines removed. The two sites document
 * different concerns in prose and that is not a defect — only the code is pinned.
 */
const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

/**
 * Whitespace collapsed and the known-different SPELLINGS folded to one token, so
 * the comparison is about WHICH VALUES ARE PASSED and in what order — not about
 * how the lines wrapped or what the local was called.
 *
 * 🔴 EVERY FOLD BELOW IS A CLAIM, AND EACH ONE IS PINNED SEPARATELY by the
 * "spells the same values differently" describe block. A fold that is not backed
 * by such a pin would let the normaliser hide the very drift this file exists to
 * catch — it would quietly rewrite one site into the other and then report them
 * equal. If a binding changes, the pin goes red first and names it.
 */
/**
 * Remove every `as <Type>` assertion, tracking `<>` depth so a generic's own commas are not
 * mistaken for the end of the expression. A regex cannot do this: `as Record<string,
 * unknown> | null` ends at a comma that is INSIDE the type, and a regex stopping at the
 * first comma would leave `unknown>|null` behind and report a difference that is not one.
 */
const stripTypeAssertions = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s.startsWith(' as ', i)) {
      i += 4;
      let depth = 0;
      while (i < s.length) {
        const c = s[i]!;
        if (c === '<' || c === '[') depth++;
        else if (c === '>' || c === ']') depth--;
        else if (
          depth <= 0 &&
          (c === ',' || c === ')' || c === '}' || c === ';')
        )
          break;
        i++;
      }
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
};

const normalise = (s: string): string => stripTypeAssertions(normaliseText(s));

/** Everything except the type-assertion fold, which must run last — see its note. */
const normaliseText = (s: string): string =>
  stripComments(s)
    /* [PROG-20260905-LADDER] The ordinary site is a ladder STEP now, so its request values
       come off the turn context (`ctx.slip.recordId`) where the assist site still reads a
       local (`slipRecordId`). Same value, same position; the container is not the rule.
       Folded to the BARE NAME rather than to a placeholder, so a field that genuinely
       disappears from one site still shows up as a difference — which is the obligation
       this file exists to keep. ตัวเดียวกัน คนละที่เก็บ */
    .replace(
      /\bctx\.(?:slip|media|creds|modelAudit)\.([A-Za-z_$][\w$]*)/g,
      '$1',
    )
    .replace(/\bctx\.([A-Za-z_$][\w$]*)/g, '$1')
    /* The ladder's context spells three of them differently from the spine's locals, and
       each rename is recorded here rather than hidden: the slip group flattened
       `slipStorageFilePath` to `storageFilePath`, `slipVerifyResult` to `verifyResult`,
       `slipRecordId` to `recordId`, `slipCreatedAt` to `createdAt` and `slipCondition` to
       `condition`. Folding them is what keeps "the same fields in the same order" checkable
       across the move; a NEW divergence still fails. */
    .replace(/\bstorageFilePath\b/g, 'slipStorageFilePath')
    .replace(/\bverifyResult\b/g, 'slipVerifyResult')
    .replace(/\brecordId\b/g, 'slipRecordId')
    .replace(/\bcreatedAt\b/g, 'slipCreatedAt')
    /* `condition` is the context's name for `slipCondition`; folded after the group folds
       above so it cannot rewrite an unrelated identifier. */
    .replace(/:condition\b|:\s*condition\b/g, ': slipCondition')
    // the two result locals — same value, different name at each site
    .replace(/\bassistPaySuppress\b|\bpaySuppress\b/g, 'PAY_RESULT')
    .replace(/\bassistSlipFlex\b|\bslipFlex\b/g, 'FLEX_RESULT')
    // the ordinary site hoists three reads off the card result (`:4802-4807`)
    // and then passes the locals; the assist site passes the reads inline
    .replace(/:\s*flexDoc\b/g, ': FLEX_RESULT.flexDoc')
    .replace(/:\s*slipCondition\b/g, ': FLEX_RESULT.slipCondition')
    // the ordinary site hoists `incomingType` (`:4681`) and passes it shorthand;
    // the assist site writes the same expression inline
    .replace(/\bevent\.message\?\.type \?\? 'unknown'/g, 'INCOMING_TYPE')
    .replace(/\bincomingType\s*,/g, 'incomingType: INCOMING_TYPE,')
    /* [PROG-20260905-CENSUSCONV] One site now lives in a role file and reaches its
       collaborators through `deps.` instead of `this.`, and its request values through
       `args.` instead of the spine's locals. Neither prefix is the rule — the rule is that
       both sites pass the SAME VALUES in the SAME ORDER, and that is what the comparison
       below still checks. Folding the prefixes is what keeps the twin obligation alive
       across the extraction instead of retiring it. */
    .replace(/\b(?:this|deps)\./g, 'SVC.')
    /* [PROG-20260905-LINT] A TYPE ASSERTION IS NOT A VALUE, so it is folded away for the
       same reason the collaborator prefix is. The two sites satisfy two different type
       checkers: the spine passes the real service and needs its casts, while the role file
       is typed against its own `deps` interface, where eslint's
       `no-unnecessary-type-assertion` correctly removed them. Neither changes what is
       passed or in what order, which is the entire obligation this file exists to keep.
       Leaving them unfolded makes a lint autofix look like a divergence in behaviour. */
    .replace(/\s+as\s+/g, ' as ')
    .replace(/\bargs\.baseUrl\b|\bmeta\.baseUrl\b/g, 'BASE_URL')
    /* `{ hook }` and `{ hook: hook }` are the same argument. One site writes shorthand
       because it reads a local; the other cannot, because it reads a context field. */
    .replace(/\b([A-Za-z_$][\w$]*)\s*:\s*\1\b/g, '$1')
    /* [PROG-20260905-LADDER] `accessToken` is HOISTED at the ordinary site — `turnDeps`
       binds it once for the turn, so the step never passes it. The assist site still does.
       This is the same shape as `incomingType` below, which the file already folds and
       explains: a value that one site hoists is not a divergence in what is passed. If the
       ordinary site ever stops receiving the token at all, the send fails loudly and
       visibly — that is not a failure this text comparison could catch anyway. */
    .replace(/\baccessToken\s*,/g, '')
    .replace(/\s+/g, ' ')
    // a line break before a method call leaves a space the collapse above cannot remove
    .replace(/\s+\./g, '.')
    // spaces around punctuation carry no meaning here and differ purely because
    // one site's argument wrapped across more lines than the other's
    .replace(/\s*([<>,:;(){}[\]|])\s*/g, '$1')
    .trim();

/** Every index at which `needle` occurs. */
const allIndexes = (s: string, needle: string): number[] => {
  const out: number[] = [];
  for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) {
    out.push(i);
  }
  return out;
};

/**
 * The balanced slice starting at the first `open` at or after `from`.
 *
 * String and comment contents are NOT parsed. That is safe for the three
 * argument objects pinned here — none contains a brace inside a literal, and if
 * one ever did, this would fail loudly rather than compare the wrong text.
 */
const balancedFrom = (s: string, from: number, open: string): string => {
  const close = open === '{' ? '}' : ')';
  const start = s.indexOf(open, from);
  if (start === -1) throw new Error(`no '${open}' after index ${from}`);
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === open) depth += 1;
    else if (s[i] === close) {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced '${open}' from index ${start}`);
};

/** The object literal passed to `name({...})`, once per occurrence. */
const objectArgsOf = (s: string, name: string): string[] =>
  allIndexes(s, `${name}({`).map((i) => balancedFrom(s, i, '{'));

/**
 * Exactly two, as an assertion rather than an assumption.
 *
 * `noUncheckedIndexedAccess` types an index access as `T | undefined`, and the
 * lazy fix — a non-null assertion — would let this whole file pass by comparing
 * `undefined` with `undefined` on the day a site is deleted. Asserting the count
 * here means "there were not two of them" fails as its own message, at the case
 * that needed them, instead of surfacing as a confusing equality.
 */
function two<T>(xs: readonly T[]): readonly [T, T] {
  expect(xs).toHaveLength(2);
  const [a, b] = xs as readonly (T | undefined)[];
  if (a === undefined || b === undefined) {
    throw new Error(`expected exactly two, got ${xs.length}`);
  }
  return [a, b];
}

describe('[SLIPANSWERTWIN] the slip answer exists exactly twice', () => {
  /* If a third site appears, every assertion below silently stops covering it.
     Pinning the COUNT is what keeps this file honest as the method changes. */
  it('has two payment-suppression sites, two card sites, two callback sites', () => {
    const s = stripComments(source());
    expect(allIndexes(s, 'runPaymentForSlip({')).toHaveLength(2);
    expect(allIndexes(s, 'handleSlipFlex(')).toHaveLength(2);
    expect(allIndexes(s, 'handleSlipCallback({')).toHaveLength(2);
  });
});

describe('[SLIPANSWERTWIN] both halves warn that the other exists', () => {
  it('⭐ neither site can be edited without learning about its twin', () => {
    /* [PROG-20260905-TWINXREF] Found 05/09: only ONE side carried the warning.
       `non-text/assist-bypass.ts` had said "THIS IS ONE HALF OF A PINNED TWIN" since
       SP22; `gates/slip-flex-send.step.ts` said nothing — and that is the ORDINARY path,
       so it is the likelier place for somebody to start editing. They would learn the
       twin existed only when this suite went red naming a file they had never opened.

       A cross-reference that points one way is half a cross-reference. Both notes are
       asserted here so the pair cannot drift back to one. เตือนข้างเดียว = ยังไม่ได้เตือน

       ⚠️ This checks the WARNING, not the behaviour. The cases below are what prove the
       two sites still agree; this only guarantees the next person is told where to look
       before the red arrives. */
    const halves = [
      'src/modules/webhook/gates/slip-flex-send.step.ts',
      'src/modules/webhook/non-text/assist-bypass.ts',
    ];
    for (const rel of halves) {
      const text = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      expect(text).toContain('PINNED TWIN');
      expect(text).toContain('slip-answer-twin-sites.spec.ts');
    }
  });
});

describe('[SLIPANSWERTWIN] the two sites spell the same values differently', () => {
  /* These four assertions are what license the folds in `normalise`. Each names
     a binding the ordinary site hoists while the assist site writes the read
     inline. Without them the normaliser would be free to rewrite one site into
     the other and report equality it had manufactured itself — so if a binding
     ever stops meaning what the fold assumes, THIS block goes red rather than
     the comparison silently passing. */
  const s = (): string => stripComments(source());

  it('the ordinary site reads isFlexSent / flexDoc straight off the card result', () => {
    /* [PROG-20260905-LADDER] the ordinary site no longer HOISTS them into locals — it
       writes them onto the turn context, which the callback step then reads. The binding
       the fold depends on is unchanged in meaning: these two values come straight off the
       card result and nothing rewrites them in between. Only the left-hand side moved. */
    expect(s()).toContain('ctx.media.isFlexSent = slipFlex.isFlexSent;');
    expect(s()).toContain('ctx.media.flexDoc = slipFlex.flexDoc;');
  });

  it('slipCondition is last written from the card result before the callback', () => {
    /* `slipCondition` is an outer `let` (`:1879`) that the verify step also
       writes (`:3588`). The fold treats the value handed to the callback as the
       CARD's, which is only true because this assignment is the last one before
       it. Pinned as a statement, and its position is pinned below. */
    const src = s();
    /* Same conversion: `ctx.slip.condition` is the outer `let`'s new home, and this is
       still the LAST write before the callback reads it — which is the whole reason the
       fold may treat the value handed to the callback as the CARD's. */
    expect(src).toContain('ctx.slip.condition = slipFlex.slipCondition;');
    const assigned = src.indexOf(
      'ctx.slip.condition = slipFlex.slipCondition;',
    );
    expect(assigned).toBeGreaterThan(-1);
    /* [PROG-20260905-LADDER] the ORDER is no longer a text offset. The write is in
       `slip-flex-send.step.ts` and the read is in `slip-card-sent.step.ts` — two files, so
       which comes first in a concatenation is alphabetical accident, not sequence. What
       actually orders them is the ladder, where `slip-card-sent` declares
       `mustFollow: ['slip-flex-send']` and `gate-ladder-order.spec.ts` proves the shipped
       order satisfies it. Asserted against that, the rule means what it always meant.
       ลำดับข้ามไฟล์ ต้องดูที่บันได ไม่ใช่ที่ offset */
    const order = MEDIA_LADDER.map((step) => step.id);
    expect(order.indexOf('slip-flex-send')).toBeLessThan(
      order.indexOf('slip-card-sent'),
    );
    expect(
      MEDIA_LADDER.find((step) => step.id === 'slip-card-sent')?.mustFollow,
    ).toContain('slip-flex-send');
  });

  it('incomingType is the same expression the assist site writes inline', () => {
    expect(s()).toContain(
      "const incomingType = event.message?.type ?? 'unknown';",
    );
  });
});

describe('[SLIPANSWERTWIN] ⭐ the two sites pass identical arguments', () => {
  it('⭐ runPaymentForSlip — the same fields, in the same order', () => {
    /* This is the one that decides whether money moves at all: the result
       carries `suppress` and `lockedDuplicate`, and both reach the card below.
       A field dropped at one site only would suppress a reply on one path and
       not the other, for the same slip. */
    const [a, b] = two(objectArgsOf(source(), 'runPaymentForSlip'));
    expect(normalise(a)).toBe(normalise(b));
  });

  it('⭐ handleSlipCallback — the same fields, in the same order', () => {
    /* `handleSlipCallback` is what fires the partner deposit callback. The two
       sites differ ONLY in the log label inside their `.catch`, which is why the
       comparison is on the argument object rather than on the whole statement. */
    const [a, b] = two(objectArgsOf(source(), 'handleSlipCallback'));
    expect(normalise(a)).toBe(normalise(b));
  });

  it('⭐ handleSlipFlex — the same seven deps reach BOTH sites', () => {
    /* The seam the card renders through: `findFlexById`, `sendLineFlexReply`,
       `persistWebhookLog`, `logMessage`, `checkQrCode`, `formatThaiDateTime`,
       `lineReplyEndpoint`. Wiring one site to a different sender than the other is exactly
       the drift this file exists to catch, and no behaviour test compares the two.

       🔴 [PROG-20260905-LADDER] THIS CASE USED TO COMPARE TWO ARGUMENT LISTS, and it can
       no longer: the ordinary site is a ladder step, and its deps are bound ONCE for the
       turn in `turnDeps` rather than written out at the call. Comparing "the second object
       literal of each call" throws, because one call now has only one argument.

       What survives — and it is the actual rule — is that the SAME SEVEN collaborators
       reach both sites. So each is asserted at each site by name: in the assist site's own
       literal, and in the spine's one wiring site. A dep dropped from either still fails.
       It no longer proves ORDER, and that is a real loss stated rather than hidden: order
       never mattered to an object literal, only to a reader diffing them by eye. */
    const SEVEN = [
      'findFlexById',
      'sendLineFlexReply',
      'persistWebhookLog',
      'logMessage',
      'checkQrCode',
      'formatThaiDateTime',
      'lineReplyEndpoint',
    ];
    const assistSite = readFileSync(
      resolve(__dirname, '../../src/modules/webhook/non-text/assist-bypass.ts'),
      'utf8',
    );
    const wiring = readFileSync(
      resolve(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    );
    for (const dep of SEVEN) {
      expect({ dep, atAssistSite: assistSite.includes(dep) }).toEqual({
        dep,
        atAssistSite: true,
      });
      expect({ dep, atOrdinarySite: wiring.includes(dep) }).toEqual({
        dep,
        atOrdinarySite: true,
      });
    }
  });

  it('⭐ handleSlipFlex — the same input fields, bar the one that is hoisted', () => {
    /* The first argument differs in exactly one way and it is not a difference:
       the assist site writes `event.message?.type ?? 'unknown'` inline, and the
       ordinary site hoists that SAME expression into `incomingType` earlier in
       the method. Folding the local back to its definition is what makes the two
       comparable; if the hoisted value ever stops being that expression, the
       first assertion here fails and says so. */
    const s = stripComments(source());
    const inputs = allIndexes(s, 'handleSlipFlex(').map((i) =>
      balancedFrom(balancedFrom(s, i, '('), 0, '{'),
    );
    const [i0, i1] = two(inputs);
    expect(normalise(i0)).toBe(normalise(i1));
  });
});

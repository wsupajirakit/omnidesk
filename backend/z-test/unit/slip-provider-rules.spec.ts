/**
 * ==== [RULES-20260903] the two standing rules, as executable assertions ======
 *
 * Both were given by the owner as rules rather than preferences, and both are
 * the kind that a reasonable next commit breaks without anyone noticing. A
 * sentence in a comment cannot go red; this file can.
 *
 *   RULE A — [DECISION-20260903-VERIFYFEEDSPAYMENT]
 *            With the payment custom tool ON, a hook must behave EXACTLY as it
 *            does with Swiftcheck: the verify result flows on into the money legs,
 *            and `payment-runner` forwards it to Shop-API. A correct card proves
 *            nothing, because the card is rendered before that leg runs.
 *
 *   RULE B — [RULE-20260903-STGSTAYSSWIFTCHECK]
 *            Staging keeps using Swiftcheck with NOTHING TO SET, because the values
 *            are already there. An environment that writes no config must keep
 *            verifying byte for byte: no field to fill, no env var, no migration.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS. Each one below is placed at the exact
 * point where the rule could be broken quietly:
 *   · the resolver, because that is where "not configured" becomes a provider
 *   · `normaliseResponse`, because that is the only thing standing between the
 *     provider's body and everything downstream that reads it — including the
 *     envelope forwarded to Shop-API
 *   · the port's member list, because a provider that omits one is a provider
 *     the flow will call and get `undefined` from, at runtime, on a live slip
 *
 * ⚠️ These do NOT replace the parity suite. `slip-flow-parity.spec.ts` compares
 * the whole Swiftcheck path against legacy's own compiled source and is the real
 * proof that behaviour has not moved; this file states the RULES that explain
 * why that comparison must keep passing.
 *
 * revert: delete this file. It asserts only; it changes nothing.
 * กฎสองข้อนี้เขียนเป็นเทส ไม่ใช่คอมเมนต์ เพราะคอมเมนต์แดงไม่ได้
 */
import {
  DEFAULT_SLIP_PROVIDER,
  resolveSlipProvider,
  SLIP_PROVIDERS,
  swiftcheckProvider,
  type SlipProvider,
  type SlipVerifyResponse,
} from '@/modules/slip';

describe('[RULE B] staging stays on Swiftcheck with nothing to set', () => {
  /* Every hook that exists today is in one of these states — the column was
     added with `default: ''` and nobody has typed in it. If any of them resolved
     to something other than the current provider, this feature would be a
     migration wearing an additive field's clothes. */
  it.each<[string, string | null | undefined]>([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('%s resolves to the current provider', (_label, value) => {
    expect(resolveSlipProvider(value)).toBeNull();
    expect(resolveSlipProvider(value) ?? DEFAULT_SLIP_PROVIDER).toBe(
      swiftcheckProvider,
    );
  });

  it('an unregistered name fails toward today, not toward silence', () => {
    /* A typo, or a name left behind by a provider that was removed. Failing to
       "no provider" would stop slips being verified for that OA — an outage
       caused by a config field. Failing to the current provider keeps the OA
       exactly where it was. */
    for (const typo of [
      'slipguard',
      'swiftcheckk',
      'SWIFTCHECK-2',
      'nonsense',
    ]) {
      expect(resolveSlipProvider(typo) ?? DEFAULT_SLIP_PROVIDER).toBe(
        swiftcheckProvider,
      );
    }
  });

  it('the default IS Swiftcheck — not merely "a provider"', () => {
    /* The rule is not "there is a default". It is "the default is the provider
       staging is already using". Repointing DEFAULT_SLIP_PROVIDER at a new
       vendor would satisfy a weaker test and silently move every unconfigured
       OA — which is the whole thing the rule forbids. */
    expect(DEFAULT_SLIP_PROVIDER).toBe(swiftcheckProvider);
    expect(DEFAULT_SLIP_PROVIDER.name).toBe('swiftcheck');
  });
});

describe('[RULE A] the payment leg receives what it received before', () => {
  it('Swiftcheck returns its reply UNCHANGED — same object, not a copy', () => {
    /* `raw_response` is written from this value, `payment-runner._swiftcheckResult`
       reads that row back, and with the default `topup_payload_path` the WHOLE
       envelope is forwarded to Shop-API. So any reshaping here — even a harmless
       looking clone — travels all the way to a third party.
       Identity is asserted by REFERENCE on purpose: a deep-equal copy would pass
       a looser check while still risking key order and prototype changes on the
       object that leaves the building. */
    const reply: SlipVerifyResponse = {
      status: 200,
      data: { success: true, data: { rawSlip: { transRef: 'T1' } } },
    };
    expect(swiftcheckProvider.normaliseResponse(reply)).toBe(reply);
    expect(swiftcheckProvider.normaliseResponse(reply).data).toBe(reply.data);
  });

  it('normalising is pure — calling it twice cannot differ', () => {
    const reply: SlipVerifyResponse = { status: 200, data: { success: false } };
    expect(swiftcheckProvider.normaliseResponse(reply)).toBe(
      swiftcheckProvider.normaliseResponse(reply),
    );
  });
});

describe('[RULES] every registered provider can actually be driven', () => {
  /* The flow calls all four members on whatever the registry returns. A provider
     missing one is not a type error at the call site — it is `undefined is not a
     function` on a live slip, after the customer has already sent it. This is
     the cheapest possible guard and it covers providers that do not exist yet. */
  it.each(Object.entries(SLIP_PROVIDERS))(
    '%s implements the whole port',
    (name, provider: SlipProvider) => {
      expect(typeof provider.name).toBe('string');
      expect(provider.name).toBe(name);
      expect(typeof provider.buildRequest).toBe('function');
      expect(typeof provider.send).toBe('function');
      expect(typeof provider.normaliseResponse).toBe('function');
    },
  );

  it('a provider is reachable by its own declared name', () => {
    /* The registry key and `provider.name` are written by hand in two places.
       If they drift, the slip-row stamp records one thing and the resolver
       answers to another — and the resume comparator that will read the stamp
       would compare a name nothing resolves to. */
    for (const [key, provider] of Object.entries(SLIP_PROVIDERS)) {
      expect(resolveSlipProvider(provider.name)).toBe(provider);
      expect(resolveSlipProvider(key)).toBe(provider);
    }
  });
});

describe('[PIPE] a provider CAN settle an async vendor without the flow changing', () => {
  /* [DECISION-20260903-NOASYNCSTATE] The pending state is deliberately not
     modelled, and the pipe left for it is a CONTRACT TERM, not a field: a
     provider must return a SETTLED result, and a vendor that answers "not yet"
     is that provider's problem to wait out.

     A contract term cannot be asserted directly — no test can prove a future
     provider waits. What CAN be asserted is that the two things it would need
     are really there, because if either were missing the term would be a promise
     the port cannot keep. Nothing here adds a field; that is the point. */

  it('send is asynchronous, so settling has somewhere to happen', () => {
    for (const provider of Object.values(SLIP_PROVIDERS)) {
      /* `send` must return a thenable. A synchronous signature would force a
         polling provider to block the event loop or to lie about being done. */
      expect(provider.send.constructor.name).toBe('AsyncFunction');
    }
  });

  it("the settling budget is the PROVIDER's own number, not a shared one", () => {
    /* `timeoutMs` rides on the request each provider builds, so a vendor that
       needs longer to settle raises its own budget without touching the flow or
       any other vendor. A single shared constant would make one slow vendor
       everyone's problem. */
    for (const provider of Object.values(SLIP_PROVIDERS)) {
      const request = provider.buildRequest({
        imageBase64: 'x',
        checkDuplicate: true,
        matchAccount: false,
        apiKey: 'k',
        baseUrl: 'https://example.invalid',
      });
      expect(typeof request.timeoutMs).toBe('number');
      expect(request.timeoutMs).toBeGreaterThan(0);
    }
  });
});

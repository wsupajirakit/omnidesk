/**
 * =============================================================================
 * [FEAT-20260903-FIELDOPTIONS] the options pipe — and the one rule it enforces
 * =============================================================================
 *
 * THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE. `hooks.slip_provider` shipped as a
 * free-text box on the dashboard. Nothing validated it on either side: the update
 * whitelist takes any string with no normaliser, and `resolveSlipProvider` falls
 * back to the default for a name it does not recognise — correct on its own, a
 * typo must not stop slips being verified, but it means a typo is COMPLETELY
 * SILENT on the value that decides which vendor verifies money.
 *
 * The fix is that the server, not the client, says what the field may be set to.
 * The rule that makes it worth anything:
 *
 *   🔴 NEVER OFFER A VALUE THE SERVER CANNOT ACT ON.
 *
 * A list that drifts from the registry re-creates the original bug in a new
 * place: the operator picks a vendor, it saves, the runtime ignores it, and
 * nothing anywhere reports that the choice had no effect. So the first describe
 * below does not check the shape of the list — it checks that every value in it
 * survives the SAME resolver the money path uses.
 *
 * ⚠️ THE OPTIONS ARE COMPARED AGAINST THE LIVE REGISTRY, NEVER AGAINST A LIST
 * WRITTEN HERE. A spec that hard-codes `['', 'swiftcheck']` passes on the day the
 * second provider is registered and the pipe forgets to report it — which is the
 * exact drift being guarded. `SLIP_PROVIDERS` is the input to both sides.
 *
 * revert: delete with `src/modules/options/`.
 */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  FieldOptionsController,
  FIELD_OPTION_SOURCES,
  fieldOptionsFor,
  realChoiceCount,
} from '@/modules/options';
import {
  DEFAULT_SLIP_PROVIDER,
  resolveSlipProvider,
  SLIP_PROVIDERS,
  SLIP_PROVIDER_LABEL_NS,
} from '@/modules/slip';

describe('[FIELDOPTIONS] ⭐ never offer a value the server cannot act on', () => {
  it('⭐ every offered slip provider resolves through the real resolver', () => {
    /* The money path calls `resolveSlipProvider(hook.slip_provider)`. If an
       offered value does not resolve, an operator can select it, see it saved,
       and get the default provider instead — silently. This is the whole point
       of the pipe, so it is the first assertion in the file. */
    const options = fieldOptionsFor('slip_provider');
    expect(options).not.toBeNull();

    /* Collected rather than asserted one by one, so a failure NAMES the offending
       values instead of stopping at "expected null not to be null" — the message
       is the whole diagnostic here. */
    const unresolvable = (options ?? [])
      .filter((o) => !o.is_default) // '' is the fallback, not a provider name
      .filter((o) => resolveSlipProvider(o.value) === null)
      .map((o) => o.value);

    expect(unresolvable).toEqual([]);
  });

  it('⭐ offers exactly what the registry holds — not a list typed by hand', () => {
    /* Derived from `SLIP_PROVIDERS` on both sides on purpose. Writing the
       expected names here would pass on the day a provider is registered and the
       pipe fails to report it, which is the drift this file exists to catch. */
    const offered = (fieldOptionsFor('slip_provider') ?? [])
      .filter((o) => !o.is_default)
      .map((o) => o.value);

    expect(offered).toEqual([...Object.keys(SLIP_PROVIDERS)].sort());
  });

  it('offers the empty value, and marks it as the default', () => {
    /* '' is a real, supported state: every hook holds it, and it is how an
       operator RETURNS to "use whatever the system uses" after picking a vendor.
       Absent from the list, that return trip becomes impossible from the UI. */
    const options = fieldOptionsFor('slip_provider') ?? [];
    const defaults = options.filter((o) => o.is_default);

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.value).toBe('');
    // and it really is the fallback the flow uses, not just a label
    expect(resolveSlipProvider('') ?? DEFAULT_SLIP_PROVIDER).toBe(
      DEFAULT_SLIP_PROVIDER,
    );
  });

  it('sends label KEYS, never sentences — the client owns wording', () => {
    // Same convention `GET /hook/field-tabs` already uses. A server that ships
    // display text cannot be translated without a back-end release.
    for (const o of fieldOptionsFor('slip_provider') ?? []) {
      expect(o.label_key.startsWith(`${SLIP_PROVIDER_LABEL_NS}.`)).toBe(true);
      expect(o.label_key).not.toContain(' ');
    }
  });

  it('⭐ every vendor carries a fallback name, so a new one is never shown as a raw key', () => {
    /* 🔴 THE HALF-TRUTH THIS CLOSES. Without it the pipe's promise was only
       partly kept: the day a provider is registered the control appears with no
       client release, but its NAME does not — the dashboard's i18n falls back to
       the raw key, so the operator would be offered a choice reading
       `field_options.slip_provider.slipguard`. Derived from `SLIP_PROVIDERS`, so a
       vendor registered tomorrow is covered by this case without editing it. */
    const missing = (fieldOptionsFor('slip_provider') ?? [])
      .filter((o) => !o.is_default)
      .filter((o) => !o.fallback_label)
      .map((o) => o.value);

    expect(missing).toEqual([]);
  });

  it('the fallback is a proper noun, never a sentence the server owns', () => {
    /* A sentence shipped from here could not be re-worded or translated without
       a back-end release — which is the whole reason `label_key` exists. The
       fallback is only ever what the value already IS. */
    for (const o of fieldOptionsFor('slip_provider') ?? []) {
      if (!o.fallback_label) continue;
      expect(o.fallback_label).not.toContain(' ');
      expect(o.fallback_label).not.toBe(o.label_key);
    }
  });

  it('the default entry carries NO fallback — it ships with the client', () => {
    /* A client that renders this list at all was released knowing about the
       default, so it has that translation. Giving it a fallback would be the
       server shipping display text for no gain. */
    const def = (fieldOptionsFor('slip_provider') ?? []).find(
      (o) => o.is_default,
    );

    expect(def?.fallback_label).toBeUndefined();
  });
});

describe('[FIELDOPTIONS] the pipe itself knows nothing about any domain', () => {
  it('an unregistered key answers null rather than throwing', () => {
    /* The controller turns this into a 404. Throwing here would make a client
       typo a 500, and an empty list would read as "this field has no values",
       which is a different and wrong answer a form would render as a dead
       dropdown with no explanation. */
    for (const key of ['nope', '', '   ', null, undefined]) {
      expect(fieldOptionsFor(key)).toBeNull();
    }
  });

  it('a key is looked up, never branched on', () => {
    /* The registry is a map, so adding the next field is one line and no code
       path changes. If this ever becomes an if-chain the count below stops
       matching the routes that actually work. */
    const keys = Object.keys(FIELD_OPTION_SOURCES);
    expect(keys).toContain('slip_provider');
    for (const key of keys) {
      expect(fieldOptionsFor(key)).not.toBeNull();
    }
  });

  it('counts real choices with the default excluded', () => {
    /* The server owns this count because it is the side that knows WHICH entry
       is the fallback. A client counting entries would have to learn that `''`
       means default — the vendor knowledge this pipe keeps on one side. */
    const options = fieldOptionsFor('slip_provider') ?? [];
    expect(realChoiceCount(options)).toBe(options.length - 1);
    expect(realChoiceCount([])).toBe(0);
  });

  it('sources are pure — two calls cannot disagree', () => {
    // They answer on a request that renders a form, so they must be cheap and
    // repeatable. A source that queried anything would break this first.
    expect(fieldOptionsFor('slip_provider')).toEqual(
      fieldOptionsFor('slip_provider'),
    );
  });
});

/* The registry cases above never touch the HTTP handler. This one does, through
   Nest's own testing module — because "the registry returns null" and "a client
   asking for a bad key gets a 404 rather than a 500 or an empty list" are two
   different claims, and only the second is what a dashboard actually meets.

   ⚠️ Guards are NOT mounted here. `JwtAuthGuard` / `PermissionsGuard` are bound
   globally with APP_GUARD in AuthModule, so this exercises the HANDLER only — it
   is deliberately not evidence about authentication. A probe that got a 401 would
   have proved the guard ran and the handler never did. */
describe('[FIELDOPTIONS] the route answers, and answers correctly', () => {
  let controller: FieldOptionsController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FieldOptionsController],
    }).compile();
    controller = moduleRef.get(FieldOptionsController);
  });

  it('answers a registered key with its options and the choice count', () => {
    const body = controller.getFieldOptions('slip_provider');

    expect(body.key).toBe('slip_provider');
    expect(body.options.length).toBeGreaterThan(0);
    expect(body.choice_count).toBe(body.options.length - 1);
    // the same rule as the first case, asserted through the wire shape
    expect(body.options.some((o) => o.is_default === true)).toBe(true);
  });

  it('is mounted at the path the dashboard calls — GET /api/field-options/:key', () => {
    /* 🔴 THE PATH IS A CROSS-REPO CONTRACT. The dashboard builds this URL by hand
       (`services/hook/fieldOptionsService.ts`) because it cannot import anything
       from here — so moving the route silently 404s the form, which fails toward
       "hide the control" and looks exactly like "only one provider registered".
       Pinning it makes that rename go red on this side instead.

       It also makes the route VISIBLE to `scripts/route-coverage.mjs`, which marks
       a route covered only when its last concrete segment appears as a literal in
       some test — a spec that calls the handler through Nest, as the cases above
       do, is otherwise invisible to it. */
    expect(Reflect.getMetadata('path', FieldOptionsController)).toBe(
      'api/field-options',
    );
    expect(
      Reflect.getMetadata(
        'path',
        FieldOptionsController.prototype.getFieldOptions,
      ),
    ).toBe(':key');
  });

  it('answers 404 for a key nobody registered — not 500, not an empty list', () => {
    /* An empty list would render as a dropdown with nothing in it and no reason,
       which reads as "this field has no valid values" — a different and wrong
       answer. A throw from the registry would be a 500 for a client typo. */
    expect(() => controller.getFieldOptions('not-a-field')).toThrow(
      NotFoundException,
    );
  });
});

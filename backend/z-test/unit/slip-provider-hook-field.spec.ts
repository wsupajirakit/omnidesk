/**
 * =============================================================================
 * [FEAT-20260902-SLIPPROVIDER] The hook field is registered everywhere it must be
 * =============================================================================
 *
 * WHY A SOURCE-READING TEST AND NOT A BEHAVIOUR ONE
 * A hook field that is missing a registration does not throw, does not log, and
 * does not fail a behaviour test. It answers 200 and quietly does nothing. This
 * repo's own files record that trap biting repeatedly — `ALLOWED_UPDATES` carries
 * several "omit this and it is dropped silently" warnings, and the field-tab map
 * exists specifically because the map once lived only in the dashboard and a
 * forgotten entry made clone skip a field with no error anywhere.
 *
 * So the assertions below read the source. That is deliberate: the thing being
 * guarded IS the presence of a line, and nothing observable distinguishes its
 * absence. Modelled on `payment-flex-ids-persist.spec.ts`, which guards the same
 * class of omission for `payment_flex_ids`.
 *
 * THE ONE MOST LIKELY TO BE FORGOTTEN is the field-tab entry: it sits in a
 * different file from the schema, has no coupling to it, and its omission is
 * 100% silent — a slip-tab clone reports success and copies nothing.
 *
 * ⚠️ This file deliberately avoids naming the sensitive-field list in prose,
 * because a sibling spec slices this same source by that string and an extra
 * occurrence would move the slice.
 *
 * revert: delete with the field.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIELD_TAB } from '@/modules/hooks';
import {
  DEFAULT_SLIP_PROVIDER,
  resolveSlipProvider,
  SLIP_PROVIDERS,
} from '@/modules/slip';

const src = (rel: string): string =>
  readFileSync(resolve(__dirname, '../../src', rel), 'utf8');

describe('[SLIPPROVIDER] the hook field survives every write path', () => {
  it('is a schema Prop, defaulting to empty — "the current provider"', () => {
    const schema = src('modules/hooks/schemas/hook.schema.ts');
    expect(schema).toContain('slip_provider!: string;');
    /* The default is what makes "no migration" true: an existing row reads as
     * '' and a lean read of an older row reads as undefined; both must mean the
     * same thing, and both do only because nothing treats '' as unset-and-broken.
     *
     * ⚠️ ASSERTED ON THE DECORATOR LINE, NOT ON A SLICE OF THE COMMENT ABOVE IT.
     * The first version of this test sliced from the feature tag to the field
     * declaration and asserted the slice contained `default: ''` — which my own
     * doc comment also contains, so changing the real default to 'swiftcheck'
     * passed. Found by mutation, not by review. */
    const decl = schema.indexOf('slip_provider!: string;');
    const propLine = schema
      .slice(schema.lastIndexOf('@Prop(', decl), decl)
      .trim();
    expect(propLine).toBe("@Prop({ type: String, default: '' })");
  });

  it('is in the update whitelist — without it, PUT is a silent 200 no-op', () => {
    // create and update are NOT the same list: create has no whitelist at all,
    // so a missing entry here produces "new OA saves, existing OA does not".
    const service = src('modules/hooks/hooks.service.ts');
    const list = service.slice(
      service.indexOf('ALLOWED_UPDATES'),
      service.indexOf('qr_prescan_mode'),
    );
    expect(list).toContain("'slip_provider',");
  });

  it('is on the slip tab, so a slip-tab clone carries it', () => {
    // The silent one. Missing here, a clone succeeds and copies nothing, and
    // asking to clone the field by name answers 400 "not cloneable".
    expect(FIELD_TAB['slip_provider']).toBe('slip');
  });

  it('is NOT treated as a credential', () => {
    // It is a vendor name. Adding it to the encrypted-field machinery would
    // mask it in audits and lock it in the dashboard for no reason.
    expect(src('infra/crypto/crypto.service.ts')).not.toContain(
      'slip_provider',
    );
    expect(src('infra/crypto/secret-self-check.service.ts')).not.toContain(
      'slip_provider',
    );
  });

  it('is NOT in the bulk-setting list, which is pinned to three names', () => {
    const helpers = src('modules/hooks/hook-write.helpers.ts');
    const bulk = helpers.slice(
      helpers.indexOf('BULK_SETTING_FIELDS'),
      helpers.indexOf('BULK_SETTING_FIELDS') + 400,
    );
    expect(bulk).not.toContain('slip_provider');
  });
});

describe('[SLIPPROVIDER] resolving a hook to a provider', () => {
  it('empty, absent and whitespace all mean the current provider', () => {
    // Every hook in existence is in one of these states. If any resolved to
    // something else, this would be a migration rather than an additive field.
    for (const v of ['', '   ', undefined, null]) {
      expect(resolveSlipProvider(v) ?? DEFAULT_SLIP_PROVIDER).toBe(
        DEFAULT_SLIP_PROVIDER,
      );
    }
  });

  it('an unregistered name falls back rather than disabling verification', () => {
    // A typo must not stop slips being checked. Failing safe here means failing
    // toward today's behaviour, not toward silence.
    expect(resolveSlipProvider('slipguard') ?? DEFAULT_SLIP_PROVIDER).toBe(
      DEFAULT_SLIP_PROVIDER,
    );
    expect(resolveSlipProvider('nonsense') ?? DEFAULT_SLIP_PROVIDER).toBe(
      DEFAULT_SLIP_PROVIDER,
    );
  });

  it('a registered name resolves to it, however it was typed', () => {
    // The stored value is not normalised on write, so the resolver has to be
    // the tolerant end: an operator typing " Swiftcheck " must not silently get a
    // different provider than one typing "swiftcheck".
    for (const v of ['swiftcheck', 'SWIFTCHECK', ' Swiftcheck ']) {
      expect(resolveSlipProvider(v)).toBe(DEFAULT_SLIP_PROVIDER);
    }
  });
});

describe('[SLIPPROVIDER] ⭐⭐⭐ the tripwire for the second provider', () => {
  /* This is not a test of behaviour. It is a REMINDER THAT CANNOT BE FORGOTTEN,
     placed here because the two bugs it names are impossible today and become
     live the moment somebody adds one line to the registry.

     While exactly one provider is registered, every possible value of
     `hook.slip_provider` — a real name, `''`, a typo — resolves to the same
     implementation. So writing guards for a provider/credential mismatch now
     would be guarding something that cannot happen, and the guard would be
     unfalsifiable: no test could make it fire. The honest alternative is this —
     go red at the exact moment the precondition changes, and say what to do.

     ⚠️ IF THIS TEST IS WHY YOUR BUILD IS RED: you added a provider. Do these two
     things, then change the number below.

     1. THE CLONE PAIR. `slip_provider` is in `FIELD_TAB` so it clones with the
        slip TAB, while `slip_verify_key` is in `SENSITIVE_FIELD` and is opt-in.
        A half-ticked clone therefore hands an OA a provider name beside another
        provider's credential. Copy the shape already in `hooks.service.ts` for
        `ai_vendor_without_key`: either drag the key along, or CLEAR it — never
        leave the previous vendor's key next to a new vendor. `hook-clone/
        ai-pair.ts` documents why leaving it is the worst option (a real request
        goes out with the wrong credential for a 401 nobody can explain).

     2. THE PAYMENT LEG. A hook whose payment custom tool is ON forwards this
        provider's raw envelope to Shop-API — see
        [DECISION-20260903-VERIFYFEEDSPAYMENT]. Nothing fails on our side; it
        breaks remotely, after the slip is verified, locked and answered. The new
        provider may not be switched on for such a hook until Shop-API has confirmed
        it reads that envelope, or the param pipe is set.

     เพิ่ม provider ตัวที่สอง = ปลดล็อกบั๊กสองตัวข้างบนทันที ทำสองข้อนั้นก่อนแล้วค่อยแก้เลขตรงนี้ */
  it('is still a one-provider registry — read the notes above before changing this', () => {
    expect(Object.keys(SLIP_PROVIDERS)).toEqual(['swiftcheck']);
  });
});

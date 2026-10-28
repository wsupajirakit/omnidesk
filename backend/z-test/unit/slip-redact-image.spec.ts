/**
 * =============================================================================
 * [FEAT-20260902-SLIPPROVIDER] The image is redacted by the PROVIDER'S key name.
 * =============================================================================
 *
 * WHY THIS EXISTS
 * `slip-flow.service.ts` persists the outbound request as `raw_request` at three
 * sites, and each spelled the image key out as the literal `base64`. Correct for
 * Swiftcheck, and a data leak for any provider that names the field anything else —
 * SlipGuard calls it `files`, so the literal would add a phantom `base64` key and
 * leave the whole image in `webhook_logs.raw_request` and
 * `slip_verifications.raw_request`.
 *
 * The existing guard in `slip-outbound-baseline.spec.ts` asserts the image never
 * reaches the log, but it can only check Swiftcheck's key name, so it would stay
 * green through exactly that leak. This spec is the part it cannot cover.
 *
 * ⚠️ THE SECOND-PROVIDER CASE IS THE POINT. A test that only exercised
 * `base64` would pass today and prove nothing about tomorrow, which is the whole
 * failure mode being guarded against.
 *
 * revert: delete with `providers/redact-image.ts`.
 */
import {
  BINARY_PLACEHOLDER,
  SLIP_PROVIDERS,
  redactImageField,
  swiftcheckProvider,
} from '@/modules/slip';

describe('[SLIPPROVIDER] redactImageField', () => {
  it("replaces Swiftcheck's image key, leaving every other key alone", () => {
    const body = {
      base64: 'AAAABBBBCCCC',
      checkDuplicate: true,
      matchAccount: false,
    };

    expect(redactImageField(body, 'base64')).toEqual({
      base64: BINARY_PLACEHOLDER,
      checkDuplicate: true,
      matchAccount: false,
    });
  });

  it("replaces a DIFFERENT provider's image key — the case the old literal missed", () => {
    // Shaped like SlipGuard: the image rides in `files`, and there is no `base64`
    // key at all. With the literal, this body reached the log intact.
    const body = { files: 'AAAABBBBCCCC', log: true };

    const out = redactImageField(body, 'files');

    expect(out['files']).toBe(BINARY_PLACEHOLDER);
    expect(out['log']).toBe(true);
    expect(JSON.stringify(out)).not.toContain('AAAABBBBCCCC');
    // And it must not invent Swiftcheck's key on the way past.
    expect(out).not.toHaveProperty('base64');
  });

  it('adds nothing when the named key is not present', () => {
    // A placeholder standing in for an image that was never sent would be a lie
    // in the log. Shaped like SlipGuard's QR-string mode, which carries no image.
    const body = { data: '00410006...', log: true };

    expect(redactImageField(body, 'files')).toEqual(body);
    expect(redactImageField(body, '')).toEqual(body);
  });

  it('never mutates the object that went on the wire', () => {
    // The caller passes the SAME object it sent; mutating it would rewrite
    // history for anything else still holding the reference.
    const body = { base64: 'SECRET', checkDuplicate: true };

    redactImageField(body, 'base64');

    expect(body['base64']).toBe('SECRET');
  });

  it('is driven by the real provider, not by a hand-written key name', () => {
    // The link that matters: whatever `buildRequest` declares is what gets
    // redacted. If a provider renamed its field and forgot `imageField`, this is
    // where it shows up.
    const request = swiftcheckProvider.buildRequest({
      imageBase64: 'IMAGEBYTES',
      checkDuplicate: true,
      matchAccount: true,
      apiKey: 'k',
      baseUrl: 'https://example.test',
    });

    const out = redactImageField(request.body, request.imageField);

    expect(JSON.stringify(out)).not.toContain('IMAGEBYTES');
    expect(out[request.imageField]).toBe(BINARY_PLACEHOLDER);
  });
});

/**
 * The helper is only as good as the name it is handed. Nothing else in the suite
 * fails if a provider forgets to declare `imageField`, or declares one that is
 * not actually in its body — and either mistake means the image is persisted in
 * full, silently, by a redaction that looked like it ran.
 *
 * This runs over the registry rather than over a list written here, so a
 * provider added later is covered the moment it is registered, without anyone
 * remembering to extend a test.
 */
describe('[SLIPPROVIDER] every registered provider can actually be redacted', () => {
  const registered = Object.entries(SLIP_PROVIDERS);

  it('the registry is not empty — otherwise the loop below proves nothing', () => {
    expect(registered.length).toBeGreaterThan(0);
  });

  it.each(registered)(
    "'%s' declares an imageField that exists in its own body, and redacting it removes the image",
    (_name, provider) => {
      const request = provider.buildRequest({
        imageBase64: 'UNIQUEIMAGEMARKER',
        checkDuplicate: true,
        matchAccount: true,
        apiKey: 'k',
        baseUrl: 'https://example.test',
      });

      expect(typeof request.imageField).toBe('string');
      expect(request.imageField).not.toBe('');
      // A name that is not in the body would redact nothing at all.
      expect(Object.keys(request.body)).toContain(request.imageField);

      const stored = redactImageField(request.body, request.imageField);
      expect(JSON.stringify(stored)).not.toContain('UNIQUEIMAGEMARKER');
    },
  );
});

describe('[FIX-20260903-NESTEDIMAGEFIELD] a dotted path reaches a nested image field', () => {
  /* Measured against Slip2Go's real request shape on 03/09: it nests everything
     under `payload` (`payload.qrCode`, `payload.checkCondition`). With the old
     top-level-only lookup, a provider naming its image field `payload.image`
     matched nothing and the whole base64 slip image went into
     `webhook_logs.raw_request` and `slip_verifications.raw_request`.
     ⭐ MUTATION: revert the helper to `if (imageField in out)` and the first two
     cases below go red with the raw image still present. */

  it('⭐ replaces the image one level down', () => {
    const body = {
      payload: { image: 'AAAABBBBCCCC', qrCode: 'q1' },
      other: 1,
    };
    const out = redactImageField(body, 'payload.image');
    expect((out['payload'] as Record<string, unknown>)['image']).toBe(
      BINARY_PLACEHOLDER,
    );
    // everything else at both levels survives untouched
    expect((out['payload'] as Record<string, unknown>)['qrCode']).toBe('q1');
    expect(out['other']).toBe(1);
  });

  it('⭐ never mutates the caller at any depth — raw_request is persisted from it', () => {
    /* The body handed in is the object that actually went on the wire; the
       caller still holds it. Mutating a nested parent in place would edit the
       live request, not a copy of it. */
    const inner = { image: 'AAAABBBBCCCC' };
    const body = { payload: inner };
    const out = redactImageField(body, 'payload.image');
    expect(inner.image).toBe('AAAABBBBCCCC');
    expect(out['payload']).not.toBe(inner);
  });

  it('does not invent a key when the parent is missing or not an object', () => {
    /* A placeholder standing in for an image that was never sent would be a lie
       in the log — the same rule the flat case already followed. */
    expect(redactImageField({ a: 1 }, 'payload.image')).toEqual({ a: 1 });
    expect(redactImageField({ payload: 'str' }, 'payload.image')).toEqual({
      payload: 'str',
    });
    expect(redactImageField({ payload: [1] }, 'payload.image')).toEqual({
      payload: [1],
    });
    expect(redactImageField({ payload: {} }, 'payload.image')).toEqual({
      payload: {},
    });
  });

  it('a name with no dot behaves exactly as before — Swiftcheck is untouched', () => {
    /* `'base64'` takes the single-segment path, so the goldens recorded before
       any of this existed still describe the output byte for byte. */
    expect(redactImageField({ base64: 'IMG', x: 2 }, 'base64')).toEqual({
      base64: BINARY_PLACEHOLDER,
      x: 2,
    });
  });
});

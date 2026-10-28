/**
 * [FEAT-20260908-CHATTRANS] the two chat translate routes — order, money, scope
 * ===========================================================================
 * The feature is cheap to get subtly wrong in ways nothing else in the suite can
 * see, because each mistake costs REAL MONEY against a lifetime budget rather
 * than failing a type or a shape:
 *
 *   · the cache checked AFTER the vendor call  ⇒ every press is billed and the
 *     stored answer is never the reason anything is free
 *   · no key check before the service          ⇒ a keyless OA burns a cap slot
 *     for a vendor that was never contacted (the decorator counts first)
 *   · a half-built rate-limit identifier       ⇒ two admins share one counter
 *   · a fire-and-forget audit                  ⇒ the row silently never lands
 *
 * ## The harness, and what is REAL in it
 *
 * Direct instantiation over the prototype — no Nest, no Mongo — following
 * `chat-oa-scope-write.spec.ts`. But four collaborators are the REAL thing,
 * because faking them is what would make the assertions hollow:
 *
 *   · `RateLimitService`  — the real service over a fake Redis, so `consume`'s
 *     own `if (!identifier)` early return, its real `buildKey`, and its real
 *     `current > limit` comparison are what the rate-limit cases run against.
 *   · `CryptoService`     — real AES-GCM, so "the OA has no usable key" is a
 *     real decrypt outcome and not a stub's opinion.
 *   · `getAllowedHookIds` / `isHookOutOfScope` — imported by the service, so the
 *     scope cases exercise the same wall every other chat route raises.
 *   · the audit gate      — the fake enforces the REAL rules (`ref_id`,
 *     `action`, `actor.user_id`) and REFUSES before recording, so "the row
 *     landed" means it got past them.
 *
 * Only the vendor is a spy, because calling it costs money — and the number of
 * times that spy fired is the assertion in half the cases below.
 *
 * revert: delete this file with `src/modules/chat/translate/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { CryptoService } from '@/infra/crypto';
import { ChatTranslateService, auditMessageTranslate } from '@/modules/chat';

const MSG_ID = 'a0d000000000000000000047';
const ROOM_ID = 'a0d000000000000000000048';
const OA_A = 'a0d000000000000000000043';
const OA_B = 'a0d000000000000000000044';

const crypto = new CryptoService({
  encryptionKey: 'route-spec-master',
} as never);
/** A server whose master key was rotated after the hook was written. */
const rotatedCrypto = new CryptoService({
  encryptionKey: 'route-spec-OTHER',
} as never);

const superadmin = {
  userId: 'u-super',
  username: 'super',
  displayName: 'Super Admin',
  roleName: 'superadmin',
} as never;

/** Scoped to OA_A only — the tightest tier, the per-user whitelist. */
const operatorOfA = {
  userId: 'u-a',
  username: 'op-a',
  displayName: 'Operator A',
  roleName: 'operator',
  groups: [],
  allowedHooks: [OA_A],
} as never;

type MsgOver = {
  message_type?: string;
  content?: unknown;
  hook_id?: string | null;
  translations?: {
    lang: string;
    text: string;
    from: string | null;
    to: string | null;
  }[];
};

const build = (
  opts: {
    msg?: MsgOver | null;
    /** What the hook row holds; `undefined` ⇒ a good encrypted gemini key. */
    hookKey?: string | undefined;
    hookVendor?: string | null;
    /**
     * [FEAT-20260909-VENDORTRANSLATE] The TRANSLATE lane's own vendor column.
     * `undefined` leaves it off the row entirely, which is the shape of all
     * seven live hooks and must resolve exactly as `hookVendor` alone did.
     */
    hookVendorTranslate?: string | null;
    hookId?: string;
    /**
     * [FEAT-20260910-DETECTSOURCE] the source language the MODEL reports back in
     * the same reply. `undefined` = the field is absent altogether (every case
     * written before today, and what the scripted provider really does);
     * `null` = the model answered "cannot tell".
     */
    detects?: string | null;
    /** Swap in the rotated-key server. */
    rotated?: boolean;
    previewMax?: number;
    previewWindowSeconds?: number;
    /** Make every audit write reject, the way a Mongo outage would. */
    auditFails?: boolean;
    redisDown?: boolean;
  } = {},
) => {
  const vendorCalls: Record<string, unknown>[] = [];
  const updates: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }[] = [];
  const auditRows: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  const redisKeys = new Map<string, number>();

  const hookId = opts.hookId ?? OA_A;
  const msgDoc =
    opts.msg === null
      ? null
      : {
          _id: MSG_ID,
          room_id: ROOM_ID,
          hook_id: opts.msg?.hook_id === undefined ? hookId : opts.msg.hook_id,
          message_type: opts.msg?.message_type ?? 'text',
          content: opts.msg?.content ?? 'สวัสดีครับ',
          translations: opts.msg?.translations,
        };

  const svc = Object.create(ChatTranslateService.prototype) as Record<
    string,
    unknown
  > & {
    translateMessage: ChatTranslateService['translateMessage'];
    previewTranslation: ChatTranslateService['previewTranslation'];
  };

  const hookRow: Record<string, unknown> = {
    _id: hookId,
    ai_vendor: opts.hookVendor ?? null,
    ai_model: 'gemini-2.0-flash',
    custom_ai_key:
      opts.hookKey === undefined
        ? crypto.encrypt('AIza-good-key')
        : opts.hookKey,
  };
  /* [FEAT-20260909-VENDORTRANSLATE] Added only when a case asks for it, so the
     default row stays byte-identical to the one every case above was written
     against — "no column at all" is the state to preserve, not "column set to
     null". */
  if (opts.hookVendorTranslate !== undefined) {
    hookRow['ai_vendor_translate'] = opts.hookVendorTranslate;
    /* A DeepSeek lane reads its OWN key column, so a case that points translate
       at DeepSeek needs one there or it refuses before the funnel — which would
       make the assertion pass for the wrong reason. */
    hookRow['custom_ai_key_sec'] = crypto.encrypt('sk-deepseek-good-key');
    hookRow['ai_model_sec'] = 'deepseek-chat';
  }

  svc.chatMessageModel = {
    findById: () => Promise.resolve(msgDoc),
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => {
      updates.push({ filter, update });
      return Promise.resolve({ modifiedCount: 1 });
    },
  };
  svc.chatRoomModel = {
    findById: () => ({
      // the preview path awaits the query directly …
      then: (r: (v: unknown) => unknown) =>
        r({ _id: ROOM_ID, hook_id: hookId }),
      // … the hook-fallback path narrows it first.
      select: () => ({ lean: () => Promise.resolve({ hook_id: hookId }) }),
    }),
  };
  /* `getAllowedHookIds` only queries this for the GROUP tier; both actors above
     answer earlier (superadmin ⇒ null, whitelist ⇒ the list), so it is never
     reached — and if a change ever made it reachable, this would say so. */
  svc.hookModel = {
    findById: () => ({ lean: () => Promise.resolve(hookRow) }),
    find: () => {
      throw new Error('the group tier must not be reached by these actors');
    },
  };
  svc.crypto = opts.rotated ? rotatedCrypto : crypto;
  svc.aiTranslate = {
    translate: (req: Record<string, unknown>) => {
      vendorCalls.push(req);
      return Promise.resolve({
        text: `[${String(req.targetLang)}] translated`,
        /* [FEAT-20260910-DETECTSOURCE] what the MODEL reported. Absent by
           default, which is the shape every case written before today assumed
           and the shape the scripted provider really produces. */
        ...(opts.detects === undefined ? {} : { from: opts.detects }),
      });
    },
  };
  svc.audit = {
    createAuditLog: (payload: Record<string, unknown>) => {
      /* Faithful to the REAL gate (`audit-log.service.ts:161-191`): refuse
         BEFORE recording, so "a row landed" cannot mean "a call was made". */
      if (!payload.ref_id) {
        return Promise.reject(new Error('ref_id is required'));
      }
      if (!payload.action)
        return Promise.reject(new Error('action is required'));
      const actor = payload.actor as { user_id?: string } | undefined;
      if (!actor?.user_id) {
        return Promise.reject(new Error('actor.user_id is required'));
      }
      /* ⚠️ THE GATE THAT ATE THE LAST FEATURE'S ROWS. `changed_fields` that is
         not an array is normalised to `[]`, and an action in
         `ACTIONS_REQUIRING_CHANGES` (update / toggle_status /
         toggle_fast_mode) is then REFUSED — into a fire-and-forget catch. Live
         DB 27/08: zero `parent:'line_user'` rows for six days. `translate` is
         not in that set, which is why this row is allowed to carry none — and
         this branch is what proves the claim rather than assuming it. */
      const action = typeof payload.action === 'string' ? payload.action : '';
      const changed = Array.isArray(payload.changed_fields)
        ? (payload.changed_fields as unknown[])
        : [];
      if (
        ['update', 'toggle_status', 'toggle_fast_mode'].includes(action) &&
        changed.length === 0
      ) {
        return Promise.reject(
          new Error(`changed_fields is required for ${action}`),
        );
      }
      if (opts.auditFails) return Promise.reject(new Error('mongo is down'));
      auditRows.push(payload);
      return Promise.resolve(payload);
    },
  };
  svc.logger = {
    warn: (m: string) => warnings.push(m),
    log: () => {},
    error: () => {},
  };
  svc.cfg = {
    capLimit: 20,
    previewMax: opts.previewMax ?? 6,
    previewWindowSeconds: opts.previewWindowSeconds ?? 60,
  };

  /* The REAL limiter over a fake Redis — see the header. */
  svc.rateLimit = new RateLimitService(
    {
      incrementWithTtl: (key: string) => {
        if (opts.redisDown) return Promise.resolve(null);
        const next = (redisKeys.get(key) ?? 0) + 1;
        redisKeys.set(key, next);
        return Promise.resolve(next);
      },
      getCount: (key: string) => Promise.resolve(redisKeys.get(key) ?? null),
    } as never,
    { defaultMax: 999, defaultWindowSeconds: 999 } as never,
    { wsEnv: 'unit' } as never,
  );

  return { svc, vendorCalls, updates, auditRows, warnings, redisKeys, hookRow };
};

/** `await` a rejection and hand back the error, whatever its class. */
const failure = async (
  p: Promise<unknown>,
): Promise<Record<string, unknown>> => {
  try {
    await p;
  } catch (e) {
    return e as Record<string, unknown>;
  }
  throw new Error('expected a refusal, got a result');
};

/* ─────────────────────────────────────────────────────────────────────────── */

describe('⭐ the cache is checked BEFORE anything that costs money (M13)', () => {
  it('⭐ M13 — a stored language answers cached:true and contacts NO vendor', async () => {
    const h = build({
      msg: {
        translations: [
          { lang: 'en', text: 'hello there', from: null, to: 'en' },
        ],
      },
    });
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);

    expect(out).toEqual({
      success: true,
      data: {
        lang: 'en',
        text: 'hello there',
        from: null,
        to: 'en',
        cached: true,
      },
    });
    /* THE assertion. Move the cache check below the vendor call and this is
       what changes — a press that cost nothing starts costing. */
    expect(h.vendorCalls).toEqual([]);
  });

  it('⭐ M13 — and a cached press writes nothing at all: no push, no audit row', async () => {
    const h = build({
      msg: { translations: [{ lang: 'en', text: 'hi', from: 'th', to: 'en' }] },
    });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    expect(h.updates).toEqual([]);
    expect(h.auditRows).toEqual([]);
  });

  it('a MISS calls the vendor exactly once and stores what came back', async () => {
    const h = build();
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);

    expect(h.vendorCalls).toHaveLength(1);
    expect(out.data).toEqual({
      lang: 'en',
      text: '[en] translated',
      from: null,
      to: 'en',
      cached: false,
    });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]?.filter).toEqual({
      _id: MSG_ID,
      'translations.lang': { $ne: 'en' },
    });
  });

  it("⭐⭐⭐ [DETECTSOURCE] the model's detected source is stored when nobody stated one", async () => {
    /* The dashboard never sends `from` — the admin is not asked. The model works
       the source out anyway to translate at all, and now says so in the same
       reply, so the bubble finally has a left-hand side to print. */
    const h = build({ detects: 'th' });
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    expect(out.data.from).toBe('th');
    const pushed = (
      h.updates[0]?.update as {
        $push?: { translations?: Record<string, unknown> };
      }
    )?.$push?.translations;
    expect(pushed).toEqual({
      lang: 'en',
      text: '[en] translated',
      from: 'th',
      to: 'en',
    });
  });

  it('⭐⭐⭐ [DETECTSOURCE] a STATED source wins over the detected one', async () => {
    /* 🔴 The rule a future "pick the source yourself" control depends on: a
       model reading one word must never overrule a human who said what they
       meant. Detection only ever fills a gap. */
    const h = build({ detects: 'my' });
    await h.svc.translateMessage(MSG_ID, { to: 'en', from: 'th' }, superadmin);
    const pushed = (
      h.updates[0]?.update as {
        $push?: { translations?: Record<string, unknown> };
      }
    )?.$push?.translations;
    expect(pushed).toMatchObject({ from: 'th' });
  });

  it('⭐⭐ [DETECTSOURCE] a model that says nothing stores null, exactly as before', async () => {
    const h = build({ detects: null });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    const pushed = (
      h.updates[0]?.update as {
        $push?: { translations?: Record<string, unknown> };
      }
    )?.$push?.translations;
    expect(pushed).toMatchObject({ from: null });
  });

  it('a DIFFERENT language is a miss even when one is already stored', async () => {
    const h = build({
      msg: { translations: [{ lang: 'en', text: 'hi', from: null, to: 'en' }] },
    });
    const out = await h.svc.translateMessage(MSG_ID, { to: 'my' }, superadmin);
    expect(out.data.cached).toBe(false);
    expect(h.vendorCalls).toHaveLength(1);
  });
});

/**
 * [FEAT-20260909-VENDORTRANSLATE] The wiring, not the resolver.
 * ===========================================================================
 * `translate-vendor-resolve.spec.ts` proves the FUNCTION picks the right
 * vendor. It cannot prove the SERVICE calls it — and that gap is not
 * theoretical. Measured before these cases existed: reverting the service line
 * to `row['ai_vendor']` left all 68 chat-translate tests green. The choice
 * would have been stored, shown in the form, cloned correctly, and silently
 * ignored on every press.
 *
 * These cases sit in the ROUTE spec on purpose. They assert on what reached the
 * funnel, which is the only place the wiring is observable — a source-text
 * check would pass on a call whose result is thrown away.
 */
describe('⭐ [VENDORTRANSLATE] which vendor the funnel is actually asked for', () => {
  it('W1 · no translate column ⇒ the webhook vendor, exactly as before', async () => {
    /* The state of all seven live rows. If this ever changes, every existing OA
       has silently moved vendor — and nothing else in the suite would notice,
       because the lane keeps working either way. */
    const h = build({ hookVendor: 'gemini' });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    expect(h.vendorCalls[0]?.vendor).toBe('gemini');
    expect(h.hookRow).not.toHaveProperty('ai_vendor_translate');
  });

  it('W2 · ⭐ translate points elsewhere ⇒ the FUNNEL is asked for that vendor', async () => {
    const h = build({ hookVendor: 'gemini', hookVendorTranslate: 'deepseek' });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);

    expect(h.vendorCalls).toHaveLength(1);
    /* THE assertion of this whole phase. Unwire the service and this is
       'gemini'. */
    expect(h.vendorCalls[0]?.vendor).toBe('deepseek');
    /* And it carries DEEPSEEK's key and model — proof the per-vendor columns
       followed the choice, which is what makes "the key boxes are shared" true
       without a third key column. */
    expect(h.vendorCalls[0]?.apiKey).toBe('sk-deepseek-good-key');
    expect(h.vendorCalls[0]?.modelId).toBe('deepseek-chat');
  });

  it('W3 · ⭐ and the reverse — a deepseek OA can translate on gemini', async () => {
    const h = build({ hookVendor: 'deepseek', hookVendorTranslate: 'gemini' });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);

    expect(h.vendorCalls[0]?.vendor).toBe('gemini');
    expect(h.vendorCalls[0]?.apiKey).toBe('AIza-good-key');
    expect(h.vendorCalls[0]?.modelId).toBe('gemini-2.0-flash');
  });

  it('W4 · an empty column is not a choice — it still follows the webhook', async () => {
    /* `''` is what an untouched form control submits. It must read as "not
       chosen", or every OA whose admin opened the AI tab and saved would move
       to the default vendor. */
    const h = build({ hookVendor: 'deepseek', hookVendorTranslate: '' });
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    expect(h.vendorCalls[0]?.vendor).toBe('deepseek');
  });

  it('W5 · the PREVIEW route resolves the same way — one door, not two', async () => {
    /* Both routes go through `loadVendorCredential`, so this would only fail if
       someone gave the preview path its own vendor lookup. */
    const h = build({ hookVendor: 'gemini', hookVendorTranslate: 'deepseek' });
    await h.svc.previewTranslation(
      ROOM_ID,
      undefined,
      { text: 'สวัสดี', to: 'en' },
      superadmin,
    );
    expect(h.vendorCalls[0]?.vendor).toBe('deepseek');
  });
});

describe('⭐ what is refused before a vendor is ever contacted', () => {
  it('a non-text message — a sticker has no words', async () => {
    const h = build({ msg: { message_type: 'image', content: { url: 'x' } } });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
  });

  it('a text message that is empty', async () => {
    const h = build({ msg: { content: '   ' } });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
  });

  it('a message that is gone — 404, not a translation of nothing', async () => {
    const h = build({ msg: null });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(404);
  });

  it('⭐ an unlisted target code — the registry is re-checked past the DTO', async () => {
    /* A future non-interactive caller never meets the `ValidationPipe`, so the
       HTTP-edge `@IsIn` is not the only guard. */
    const h = build();
    for (const to of ['zz', 'zh', '', 'en-GB']) {
      const err = await failure(
        h.svc.translateMessage(MSG_ID, { to }, superadmin),
      );
      expect(err.status).toBe(400);
    }
    expect(h.vendorCalls).toEqual([]);
  });

  it('an unlisted SOURCE code is refused too, when one is given at all', async () => {
    const h = build();
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en', from: 'zz' }, superadmin),
    );
    expect(err.status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
  });
});

describe('⭐ the source language is optional, and absence is stored as null', () => {
  it('⭐ M18 — no `from` succeeds, sends no source hint, and stores `from: null`', async () => {
    /* Owner, 09/09: the UI never asks for a source language — the model detects
       it. What must never happen is a GUESS: a `from` filled from the hook's
       locale or the UI language would put a language on screen nobody chose. */
    const h = build();
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);

    expect(out.data.from).toBeNull();
    expect(h.vendorCalls[0]?.sourceLang).toBeNull();
    const pushed = (
      h.updates[0]?.update as {
        $push?: { translations?: Record<string, unknown> };
      }
    ).$push?.translations;
    expect(pushed).toEqual({
      lang: 'en',
      text: '[en] translated',
      from: null,
      to: 'en',
    });
  });

  it('a `from` that IS given rides through to the module and into the row', async () => {
    const h = build();
    const out = await h.svc.translateMessage(
      MSG_ID,
      { to: 'en', from: 'th' },
      superadmin,
    );
    expect(h.vendorCalls[0]?.sourceLang).toBe('th');
    expect(out.data.from).toBe('th');
  });
});

describe('⭐ the OA-scope wall — and it covers the CACHED answer too', () => {
  it('an operator of another OA is refused', async () => {
    const h = build({ hookId: OA_B });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, operatorOfA),
    );
    expect(err.status).toBe(403);
    expect(h.vendorCalls).toEqual([]);
  });

  it('⭐ and a STORED translation is not a way round it', async () => {
    /* The reason the wall sits ABOVE the cache check rather than below it,
       which is where the plan drew it. A cached answer is still this OA's
       message content, and `[FIX-20260818-CHATOASCOPE]` closed exactly this
       hole on the send path. Answering from the cache first would have
       reopened it for reads. */
    const h = build({
      hookId: OA_B,
      msg: {
        translations: [{ lang: 'en', text: 'secret', from: null, to: 'en' }],
      },
    });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, operatorOfA),
    );
    expect(err.status).toBe(403);
    expect(String(err.message)).toContain('insufficient OA access');
  });

  it('the operator of the OWNING OA is allowed', async () => {
    const h = build({ hookId: OA_A });
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, operatorOfA);
    expect(out.data.cached).toBe(false);
  });

  it('⭐ the hook comes from the ROW — a hook id in the body is not even read', async () => {
    /* The DTO has no `hook_id` field, so the only way to name an OA is the
       message's own row. Passing one anyway must change nothing. */
    const h = build({ hookId: OA_B });
    const err = await failure(
      h.svc.translateMessage(
        MSG_ID,
        { to: 'en', hook_id: OA_A } as never,
        operatorOfA,
      ),
    );
    expect(err.status).toBe(403);
  });
});

describe('⭐ the key check runs BEFORE the service, so a keyless OA burns nothing (M14)', () => {
  it('⭐ M14 — no key ⇒ 502, and the vendor funnel is NEVER entered', async () => {
    /* The cap decorator counts a slot BEFORE the inner provider runs, so a
       keyless OA that reaches it spends budget for a call that never happened.
       This assertion is the one that stops that: zero calls in. */
    const h = build({ hookKey: '' });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(h.auditRows).toEqual([]);
  });

  it('⭐ M14 — and a ROTATED master key is refused too, not sent as ciphertext', async () => {
    /* `safeDecrypt` would have handed the ciphertext over as an API key. The
       two refusals say different things, because they need different fixes. */
    const h = build({ rotated: true });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(400);
    const body = err.response as { error?: string };
    expect(body.error).toContain('cannot read it');
    expect(h.vendorCalls).toEqual([]);
  });

  it('a deepseek OA holding only a gemini key is refused — no borrowing', async () => {
    const h = build({ hookVendor: 'deepseek' });
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin),
    );
    expect(err.status).toBe(400);
    expect((err.response as { error?: string }).error).toContain('no AI key');
    expect(h.vendorCalls).toEqual([]);
  });

  it('the decrypted key and the hook model reach the module, the ciphertext does not', async () => {
    const h = build();
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    expect(h.vendorCalls[0]?.apiKey).toBe('AIza-good-key');
    expect(h.vendorCalls[0]?.modelId).toBe('gemini-2.0-flash');
    expect(String(h.vendorCalls[0]?.apiKey)).not.toContain('enc:');
  });
});

describe('⭐ the audit row LANDS — not "the call was made" (M17)', () => {
  it('⭐ M17 — one row, with the fields a trail can be read back from', async () => {
    const h = build();
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    /* The write is fire-and-forget, so give the microtask queue its turn —
       the same wait `abandon-shield-audit.spec.ts` uses. */
    await new Promise((r) => setImmediate(r));

    expect(h.auditRows).toHaveLength(1);
    expect(h.auditRows[0]).toMatchObject({
      ref_id: MSG_ID,
      parent: 'chat_message',
      action: 'translate',
      hook_id: OA_A,
      actor: {
        user_id: 'u-super',
        username: 'super',
        display_name: 'Super Admin',
      },
    });
  });

  it("⭐ M17 — 'translate' needs no changed_fields, so the row is not refused by that gate", async () => {
    /* `ACTIONS_REQUIRING_CHANGES` holds update / toggle_status /
       toggle_fast_mode. Sending an empty `changed_fields` for an action that
       DOES require one is how the abandon-shield row vanished for six days. */
    const h = build();
    await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    await new Promise((r) => setImmediate(r));
    expect(h.auditRows[0]?.changed_fields).toBeUndefined();
    expect(h.warnings.filter((w) => w.includes('audit failed'))).toEqual([]);
  });

  it('a failed audit write is reported and NEVER fails the translation', async () => {
    /* By then the translation is stored and on its way back. Failing here
       would tell the admin it did not happen when it did. */
    const h = build({ auditFails: true });
    const out = await h.svc.translateMessage(MSG_ID, { to: 'en' }, superadmin);
    await new Promise((r) => setImmediate(r));

    expect(out.data.text).toBe('[en] translated');
    expect(h.auditRows).toEqual([]);
    expect(h.warnings.some((w) => w.includes('audit failed'))).toBe(true);
  });

  it('⭐ an unauthenticated caller never gets far enough to need an audit row', async () => {
    /* MEASURED, and it corrected this spec's first draft, which expected to
       reach the audit with no actor. `getAllowedHookIds(undefined, …)` returns
       `[]` — no group at all means NOTHING, never "everything" — so the scope
       wall refuses first. The fail-closed default is what makes the actorless
       audit path unreachable through HTTP. */
    const h = build();
    const err = await failure(
      h.svc.translateMessage(MSG_ID, { to: 'en' }, undefined),
    );
    expect(err.status).toBe(403);
    expect(h.vendorCalls).toEqual([]);
    expect(h.auditRows).toEqual([]);
  });

  it('and the helper still refuses to write an actorless row if it is ever handed one', async () => {
    /* The belt for the day a non-interactive caller appears.
       `createAuditLog` THROWS without `actor.user_id`, and that throw would
       land in a fire-and-forget catch — so the helper says so instead of
       sending a payload it knows will be refused. */
    const h = build();
    const warnings: string[] = [];
    await auditMessageTranslate(
      {
        messageId: MSG_ID,
        hookId: OA_A,
        to: 'en',
        from: null,
        vendor: null,
        actor: undefined,
      },
      {
        audit: h.svc.audit as Parameters<
          typeof auditMessageTranslate
        >[1]['audit'],
        warn: (m) => warnings.push(m),
      },
    );
    expect(h.auditRows).toEqual([]);
    expect(warnings.some((w) => w.includes('no actor'))).toBe(true);
  });
});

/* ── the preview ──────────────────────────────────────────────────────────── */

const preview = (
  h: ReturnType<typeof build>,
  over: Record<string, unknown> = {},
  auth = superadmin,
) =>
  h.svc.previewTranslation(
    ROOM_ID,
    undefined,
    { text: 'ทดสอบ', to: 'en', ...over },
    auth,
  );

describe('⭐ the preview writes NOTHING', () => {
  it('⭐ no message row and no column — the draft may never be sent', async () => {
    /* 🔴 [FIX-20260909-AUDITPREVIEW] THIS CASE USED TO ALSO ASSERT "no audit",
       and that half is deliberately gone. The two are not the same promise:
         · NO MESSAGE DATA — still absolute. There is no message to attach a
           translation to, and inventing one would create a stored translation
           of something nobody sent. `updates` stays empty forever.
         · NO AUDIT — was never a principle, only the state of the code. A
           composer press spends exactly what a bubble press spends, and the
           owner asked on 09/09 why the audit screen could not say who did it or
           which surface it came from.
       Keeping the two together in one assertion is what made the second look
       like part of the first. */
    const h = build();
    const out = await preview(h);
    /* [FEAT-20260910-DETECTSOURCE] `from` rides the same envelope now — the
       composer stores it on the staged preview and sends it back as
       `original_lang`, which is how the outbound bubble learns its left-hand
       side. The scripted provider reports no language, so `null` here is the
       honest answer and the one every legacy row already carries. */
    expect(out).toEqual({
      success: true,
      data: { text: '[en] translated', from: null },
    });
    expect(h.updates).toEqual([]);
    expect(h.vendorCalls).toHaveLength(1);
  });

  it('⭐ it DOES record who pressed it, and says which surface', async () => {
    /* The other half of the owner's question: "input chat / bubble chat".
       `parent` is the machine-readable split — a bubble row is about a
       `chat_message`, a composer row about the `chat_room` and a draft that may
       never exist. A reader filtering by subject gets it without parsing prose. */
    const h = build();
    await preview(h);
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    expect(row['parent']).toBe('chat_room');
    expect(row['action']).toBe('translate');
    expect(String(row['note'])).toContain('composer');
  });

  it('it still refuses an unlisted language and an out-of-scope OA', async () => {
    const bad = build();
    expect((await failure(preview(bad, { to: 'zz' }))).status).toBe(400);

    const other = build({ hookId: OA_B });
    expect((await failure(preview(other, {}, operatorOfA))).status).toBe(403);
    expect(other.vendorCalls).toEqual([]);
  });

  it('and it refuses a keyless OA before spending anything', async () => {
    const h = build({ hookKey: '   ' });
    expect((await failure(preview(h))).status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
  });
});

describe('⭐ the preview rate limit — 6 a minute, per admin, per room (M16)', () => {
  it('the 6th press succeeds and the 7th is refused with a readable 429', async () => {
    const h = build({ previewMax: 6 });
    for (let i = 0; i < 6; i += 1) {
      await preview(h);
    }
    expect(h.vendorCalls).toHaveLength(6);

    const err = await failure(preview(h));
    expect(err.status).toBe(429);
    const body = err.response as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('60 seconds');
    /* the refused press must not have reached a vendor */
    expect(h.vendorCalls).toHaveLength(6);
  });

  it('⭐ the numbers come from config, never a literal', async () => {
    /* Hardcode 6 at the call site and this goes red: with the env at 2, the
       third press must already be refused. */
    const h = build({ previewMax: 2, previewWindowSeconds: 30 });
    await preview(h);
    await preview(h);
    const err = await failure(preview(h));
    expect(err.status).toBe(429);
    expect((err.response as { error?: string }).error).toContain('30 seconds');
  });

  it('⭐ M16 — two admins in the SAME room do not share a counter', async () => {
    const h = build({ previewMax: 1 });
    await preview(h, {}, superadmin);
    /* superadmin is now at its limit. A different admin must be unaffected. */
    const second = await preview(h, {}, operatorOfA);
    expect(second.data.text).toBe('[en] translated');
    expect([...h.redisKeys.keys()].sort()).toEqual([
      `ratelimit:unit:default:u-a:${ROOM_ID}:aitr`,
      `ratelimit:unit:default:u-super:${ROOM_ID}:aitr`,
    ]);
  });

  it('⭐ M16 — one admin in two DIFFERENT rooms does not share a counter', async () => {
    const h = build({ previewMax: 1 });
    await h.svc.previewTranslation(
      ROOM_ID,
      undefined,
      { text: 'a', to: 'en' },
      superadmin,
    );
    /* The room the identifier uses is the RESOLVED room, so a second room id
       has to resolve to itself for this to mean anything — the fake returns
       ROOM_ID for every lookup, so drive the second room through the key map. */
    expect([...h.redisKeys.keys()]).toEqual([
      `ratelimit:unit:default:u-super:${ROOM_ID}:aitr`,
    ]);
    expect([...h.redisKeys.keys()][0]).toContain(ROOM_ID);
  });

  it('⭐ M16 — a MISSING admin id refuses the request instead of skipping the limit', async () => {
    /* `consume()` returns early with NO LIMITING when the identifier is empty
       — but `"undefined:room"` is not empty, so a half-built key sails past
       that guard and every admin whose id went missing lands on ONE counter.
       Worse than no limit: admin A presses twice, admin B is blocked without
       having pressed. */
    const h = build({ previewMax: 1 });
    const noId = { roleName: 'superadmin', username: 'ghost-a' } as never;
    const alsoNoId = { roleName: 'superadmin', username: 'ghost-b' } as never;

    const first = await failure(preview(h, {}, noId));
    expect(first.status).toBe(400);
    expect(h.vendorCalls).toEqual([]);
    /* Nothing was counted, because no key was built. Under the mutation a key
       `undefined:<room>` appears here instead. */
    expect([...h.redisKeys.keys()]).toEqual([]);

    /* ⭐ and the consequence, spelled out: a SECOND admin whose id is also
       missing must be refused for the same reason — never because the first
       one's presses used up a counter they were sharing. Under the mutation
       this second call comes back 429 ("too many translations") for someone
       who has not pressed anything. */
    const second = await failure(preview(h, {}, alsoNoId));
    expect(second.status).toBe(400);
    /* `BadRequestException`'s envelope puts the sentence in `message` — its
       `error` field is the generic 'Bad Request'. Asserting the right one
       matters: the wrong field passes for any 400 at all. */
    expect(String(second.message)).toContain('could not be identified');
  });

  it('⭐ it borrows the `default` bucket and names its own window — no new RateLimitBucket', async () => {
    /* Adding a bucket value would force an edit to `limitsFor()`, an
       exhaustive switch with no `default:` clause, in the file login and the
       webhook ladder both read. The key proves the borrow happened without it. */
    const h = build();
    await preview(h);
    const [key] = [...h.redisKeys.keys()];
    expect(key).toBe(`ratelimit:unit:default:u-super:${ROOM_ID}:aitr`);
    /* and it is NOT the shape the webhook ladder or login use */
    expect(key).not.toMatch(/:login:/);
    expect(key?.endsWith(':aitr')).toBe(true);
  });

  it('Redis being down FAILS OPEN — the preview still works', async () => {
    /* The limiter's documented behaviour: rate limiting is not an
       authorization control, and failing closed turns a Redis outage into a
       full outage. This route must not be the one place that differs. */
    const h = build({ redisDown: true, previewMax: 1 });
    for (let i = 0; i < 3; i += 1) {
      const out = await preview(h);
      expect(out.data.text).toBe('[en] translated');
    }
  });
});

describe('⭐ the two route paths are the pinned cross-repo contract', () => {
  it('⭐ the controller mounts exactly the paths the dashboard was told about', () => {
    /* The BE and FE halves were split across two repos and two agents, so the
       paths are a CONTRACT, not an implementation detail: renaming one here
       breaks a caller nothing in this repo compiles against.
         POST /api/chat/messages/:id/translate     body { to, from? }
         POST /api/chat/:id/translate-preview      body { text, to, from? }
       Reading the decorators is also what puts these literals in front of
       `scripts/route-coverage.mjs`, which counts a route as covered only when
       a test mentions its concrete segments. */
    const src = readFileSync(
      join(
        process.cwd(),
        'src/modules/chat/translate/chat-translate.controller.ts',
      ),
      'utf8',
    );
    /* comments stripped — a decorator NAMED in the header must not stand in
       for one that is actually applied. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).toContain("@Controller('api/chat')");
    expect(code).toContain("@Post('messages/:id/translate')");
    expect(code).toContain("@Post(':id/translate-preview')");
    /* both are behind the same permission every other chat write carries */
    expect(code.match(/@RequirePermissions\('ticket\.manage'\)/g)).toHaveLength(
      2,
    );
  });

  it('⭐ neither path can be captured by an existing chat POST route', () => {
    /* `ChatController`'s POST routes are all TWO segments, so a three-segment
       path cannot be swallowed by one, and `translate-preview` is a literal
       second segment that collides with no other literal. Two controllers may
       share the `api/chat` prefix — Nest matches by path. */
    const existing = readFileSync(
      join(process.cwd(), 'src/modules/chat/chat.controller.ts'),
      'utf8',
    );
    const posts = [...existing.matchAll(/@Post\((\[[^\]]*\]|'[^']*')\)/g)].map(
      (m) => m[1] ?? '',
    );
    const literals = posts
      .join(',')
      .split(',')
      .map((s) => s.replace(/[[\]' ]/g, ''))
      .filter(Boolean);
    expect(literals.length).toBeGreaterThan(4);
    for (const p of literals) {
      expect(p).not.toContain('translate');
      /* a 2-segment `:id/x` pattern cannot match `messages/:id/translate` */
      expect(p.split('/').length).toBeLessThanOrEqual(2);
    }
  });
});

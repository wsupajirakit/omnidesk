import {
  buildFlexProfileReply,
  buildFlexTagReply,
  buildFlexProfileCustomReply,
  type FlexReplyDeps,
} from '@/modules/webhook';

/**
 * [FIX-20260808-FLEXBUILDER] The flex profile / tag reply builders.
 *
 * WHY A UNIT TEST: reaching these through `POST /webhook` needs a model reply
 * carrying `[[[flex_profile]]]` / `[[[flex_mNNNNN]]]` / `[[[flex_pcNNNNN]]]`, and
 * the AI budget is spent. So the builders are driven directly with FAKED deps —
 * the FlexMessage model is a stub returning a canned doc, and `buildDataVars`
 * (the injected var-map assembly) is faked. No Mongo, no network: the only
 * collaborators are the two injected functions, and neither opens a socket.
 *
 * WHAT IS ASSERTED: the builders' own control flow (the gates that return null,
 * the tag/id lookup filter, the flex_pc body override) and that the assembled
 * card JSON matches the template shape after substitution.
 */

/** A stub of Mongoose's `findOne(...).lean().exec()` chain. */
function fakeFlexModel(doc: unknown): {
  flexModel: FlexReplyDeps['flexModel'];
  lastFilter: () => unknown;
} {
  let captured: unknown = null;
  const flexModel = {
    findOne: (filter: unknown) => {
      captured = filter;
      return {
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      };
    },
  } as unknown as FlexReplyDeps['flexModel'];
  return { flexModel, lastFilter: () => captured };
}

/** The real substitution walk isn't under test here — assert the builders hand
 *  it the right doc/vars and pass its result through. */
const passThroughRender: NonNullable<FlexReplyDeps['renderFlexDoc']> = (
  doc,
  dataVars,
  content,
) => ({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: String(dataVars['bank_account_name'] ?? '-'),
      },
      { type: 'text', text: typeof content === 'string' ? content : '-' },
    ],
  },
  _echoContentJson: (doc as Record<string, unknown>).content_json,
});

const silentLog = { warn: () => {}, error: () => {} };

function deps(doc: unknown): FlexReplyDeps & { lastFilter: () => unknown } {
  const { flexModel, lastFilter } = fakeFlexModel(doc);
  return {
    flexModel,
    buildDataVars: () => ({
      bank_account_name: 'สมชาย ใจดี',
      bank_code: 'Bangkok Bank',
    }),
    renderFlexDoc: passThroughRender,
    logger: silentLog,
    lastFilter,
  };
}

const CARD_DOC = {
  _id: 'card1',
  content_json: { type: 'bubble', body: { type: 'box' } },
  content_tags: [],
  source_roles: [],
};

describe('buildFlexProfileReply', () => {
  it('returns null when hook has no flex_profile_id', async () => {
    const out = await buildFlexProfileReply(
      { hook: {}, profileData: {}, content: 'hi' },
      deps(CARD_DOC),
    );
    expect(out).toBeNull();
  });

  it('returns null when the card is not found / has no content_json', async () => {
    const out = await buildFlexProfileReply(
      { hook: { flex_profile_id: 'x' }, profileData: {}, content: 'hi' },
      deps(null),
    );
    expect(out).toBeNull();
  });

  it('assembles a card from the pinned flex_profile_id', async () => {
    const d = deps(CARD_DOC);
    const out = (await buildFlexProfileReply(
      {
        hook: { flex_profile_id: 'card1' },
        profileData: {},
        content: 'สวัสดีค่ะ',
      },
      d,
    )) as Record<string, unknown>;

    expect(out.type).toBe('bubble');
    const body = out.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;
    // profile var substituted, content threaded through
    expect(contents[0]!.text).toBe('สมชาย ใจดี');
    expect(contents[1]!.text).toBe('สวัสดีค่ะ');
    // looked up by _id + not-deleted, legacy's exact filter
    expect(d.lastFilter()).toEqual({
      _id: 'card1',
      deleted_at: { $exists: false },
    });
  });
});

describe('buildFlexTagReply', () => {
  it('returns null with no flexTag', async () => {
    const out = await buildFlexTagReply(
      {
        hook: { flex_custom_ids: ['a'] },
        profileData: {},
        content: 'x',
        flexTag: null,
      },
      deps(CARD_DOC),
    );
    expect(out).toBeNull();
  });

  it('returns null when hook allow-list is empty (scope gate)', async () => {
    const out = await buildFlexTagReply(
      {
        hook: { flex_custom_ids: [] },
        profileData: {},
        content: 'x',
        flexTag: 'flex_m00001',
      },
      deps(CARD_DOC),
    );
    expect(out).toBeNull();
  });

  it('looks up only cards the hook allow-lists', async () => {
    const d = deps(CARD_DOC);
    const out = await buildFlexTagReply(
      {
        hook: { flex_custom_ids: ['card1', 'card2'] },
        profileData: {},
        content: 'x',
        flexTag: 'flex_m00001',
      },
      d,
    );
    expect(out).not.toBeNull();
    expect(d.lastFilter()).toEqual({
      flex_tag: 'flex_m00001',
      _id: { $in: ['card1', 'card2'] },
      deleted_at: { $exists: false },
    });
  });
});

describe('buildFlexProfileCustomReply', () => {
  const PC_DOC = { ...CARD_DOC, flex_type: 'profile-semi-custom' };

  it('returns null when allow-list is empty', async () => {
    const out = await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: [] },
        profileData: {},
        content: '{}',
        flexTag: 'flex_pc00001',
      },
      deps(PC_DOC),
    );
    expect(out).toBeNull();
  });

  it('filters by flex_type profile-semi-custom', async () => {
    const d = deps(PC_DOC);
    await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: ['card1'] },
        profileData: {},
        content: 'ok',
        flexTag: 'flex_pc00001',
      },
      d,
    );
    expect(d.lastFilter()).toEqual({
      flex_tag: 'flex_pc00001',
      _id: { $in: ['card1'] },
      flex_type: 'profile-semi-custom',
      deleted_at: { $exists: false },
    });
  });

  it('overrides ONLY body with the sanitized AI JSON, keeps template otherwise', async () => {
    const aiJson = JSON.stringify({
      tag: 'flex_pc00001',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'ยอดเงิน 1,000 บาท' }],
        // an unsafe prop must be dropped by the sanitizer
        evil: 'DROP_ME',
      },
    });
    const out = (await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: ['card1'] },
        profileData: {},
        content: aiJson,
        flexTag: 'flex_pc00001',
      },
      deps(PC_DOC),
    )) as Record<string, unknown>;

    const body = out.body as Record<string, unknown>;
    expect(body.type).toBe('box');
    expect(body.layout).toBe('vertical');
    expect(body).not.toHaveProperty('evil'); // sanitized away
    const contents = body.contents as Array<Record<string, unknown>>;
    expect(contents[0]!.text).toBe('ยอดเงิน 1,000 บาท');
    // the rest of the bubble is still the rendered template
    expect(out.type).toBe('bubble');
  });

  it('keeps the template body when the AI JSON is unusable', async () => {
    const out = (await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: ['card1'] },
        profileData: {},
        content: 'not json at all',
        flexTag: 'flex_pc00001',
      },
      deps(PC_DOC),
    )) as Record<string, unknown>;
    // template body from passThroughRender survives (has two text nodes)
    const body = out.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;
    expect(contents).toHaveLength(2);
  });

  it('does not leak raw JSON into {{content}} on the fallback path', async () => {
    // content looks like JSON → safeContent replaces it, so the rendered
    // template's {{content}} slot must NOT be the raw JSON string.
    const out = (await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: ['card1'] },
        profileData: {},
        content: '{"type":"notabox"}',
        flexTag: 'flex_pc00001',
      },
      deps(PC_DOC),
    )) as Record<string, unknown>;
    const body = out.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;
    expect(contents[1]!.text).toBe('ขออภัย ระบบแสดงข้อมูลไม่ได้ชั่วคราวค่ะ');
  });
});

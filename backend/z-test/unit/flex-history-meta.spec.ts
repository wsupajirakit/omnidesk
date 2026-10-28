/**
 * [FIX-20260822-FLEXHISTORYTYPE] The history row of a sent card must say WHICH
 * card it was. Three kinds converge into one variable at the send site
 * (`flexProfileContents` ← [[[flex_profile]]] · [[[flex_mNNNNN]]] · [[[flex_pcNNNNN]]]),
 * and the history patch used to choose between only two labels — so every
 * flex_m / flex_pc card was stored as "flex_profile" with the PROFILE doc's id
 * and the text "[Flex] ข้อมูลโปรไฟล์". Real data 22/08: 11 of 11 rows labelled
 * flex_profile on the local clone were "แจ้ง สถานะระบบ" / "สถานะยอดกิจกรรมโปรโมชั่น" cards.
 *
 * Two pieces, both pure:
 *   · the builders report the doc they rendered through an optional `out`
 *     (callers that pass nothing are untouched);
 *   · `flexHistoryMeta` turns (kind, out, hook) into the three fields the
 *     history `$set` and the realtime publish BOTH read — one source, so they
 *     can never disagree.
 */
import {
  buildFlexTagReply,
  buildFlexProfileReply,
  buildFlexProfileCustomReply,
  flexHistoryMeta,
  type FlexReplyDeps,
  type FlexReplyOut,
} from '@/modules/webhook';

function fakeModel(doc: unknown) {
  return {
    findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(doc) }) }),
  };
}
const deps = (doc: unknown): FlexReplyDeps =>
  ({
    flexModel: fakeModel(doc),
    buildDataVars: () => ({}),
    renderFlexDoc: (d: { content_json: unknown }) => d.content_json,
  }) as unknown as FlexReplyDeps;

const TAG_DOC = {
  _id: 'm30',
  name: 'แจ้งปิดถอน',
  content_json: { type: 'bubble' },
};
const PROFILE_DOC = {
  _id: 'p1',
  name: 'dev-profile',
  content_json: { type: 'bubble' },
};

describe('builders report the doc they rendered (optional `out`)', () => {
  it('buildFlexTagReply fills out.docId + out.name; return value unchanged', async () => {
    const out: FlexReplyOut = {};
    const card = await buildFlexTagReply(
      {
        hook: { flex_custom_ids: ['m30'] },
        profileData: {},
        content: 'x',
        flexTag: 'flex_m00030',
        out,
      },
      deps(TAG_DOC),
    );
    expect(card).toEqual({ type: 'bubble' });
    expect(out).toEqual({ docId: 'm30', name: 'แจ้งปิดถอน' });
  });
  it('buildFlexProfileReply fills out from the profile doc', async () => {
    const out: FlexReplyOut = {};
    await buildFlexProfileReply(
      { hook: { flex_profile_id: 'p1' }, profileData: {}, content: 'x', out },
      deps(PROFILE_DOC),
    );
    expect(out).toEqual({ docId: 'p1', name: 'dev-profile' });
  });
  it('buildFlexProfileCustomReply fills out', async () => {
    const out: FlexReplyOut = {};
    await buildFlexProfileCustomReply(
      {
        hook: { flex_profile_custom_ids: ['pc1'] },
        profileData: {},
        content: '{}',
        flexTag: 'flex_pc00001',
        out,
      },
      deps({ _id: 'pc1', name: 'custom', content_json: { type: 'bubble' } }),
    );
    expect(out.docId).toBe('pc1');
  });
  it('a builder that returns null leaves out empty', async () => {
    const out: FlexReplyOut = {};
    await buildFlexTagReply(
      {
        hook: { flex_custom_ids: [] },
        profileData: {},
        content: 'x',
        flexTag: 'flex_m00030',
        out,
      },
      deps(TAG_DOC),
    );
    expect(out).toEqual({});
  });
  it('no `out` passed → exactly the old call (every existing caller/spec)', async () => {
    const card = await buildFlexTagReply(
      {
        hook: { flex_custom_ids: ['m30'] },
        profileData: {},
        content: 'x',
        flexTag: 'flex_m00030',
      },
      deps(TAG_DOC),
    );
    expect(card).toEqual({ type: 'bubble' });
  });
});

describe('flexHistoryMeta — the three history fields from the kind that was sent', () => {
  const hook = { flex_profile_id: 'p1', flex_customerhelper_id: 'h1' };
  it('customer-helper card → unchanged from today', () => {
    expect(
      flexHistoryMeta({ kind: 'helper', hook, out: {}, replyBody: '' }),
    ).toEqual({
      auto_reply_type: 'flex_customerhelper',
      flex_doc_id: 'h1',
      content: '[Flex] ขออนุญาตเชื่อมต่อข้อมูล',
    });
  });
  it('profile card → unchanged from today (type, id, label)', () => {
    expect(
      flexHistoryMeta({
        kind: 'profile',
        hook,
        out: { docId: 'p1', name: 'dev-profile' },
        replyBody: '',
      }),
    ).toEqual({
      auto_reply_type: 'flex_profile',
      flex_doc_id: 'p1',
      content: '[Flex] ข้อมูลโปรไฟล์',
    });
  });
  it('[[[flex_mNNNNN]]] card → flex_tag, the TAG doc id, the doc name as label', () => {
    expect(
      flexHistoryMeta({
        kind: 'tag',
        hook,
        out: { docId: 'm30', name: 'แจ้งปิดถอน' },
        replyBody: '',
      }),
    ).toEqual({
      auto_reply_type: 'flex_tag',
      flex_doc_id: 'm30',
      content: '[Flex] แจ้งปิดถอน',
    });
  });
  it('[[[flex_pcNNNNN]]] card → flex_pc', () => {
    expect(
      flexHistoryMeta({
        kind: 'pc',
        hook,
        out: { docId: 'pc1', name: 'custom' },
        replyBody: '',
      }).auto_reply_type,
    ).toBe('flex_pc');
  });
  it('the AI text beside the tag wins the label when present (as before)', () => {
    expect(
      flexHistoryMeta({
        kind: 'tag',
        hook,
        out: { docId: 'm30', name: 'แจ้งปิดถอน' },
        replyBody: 'ระบบปิดถอนชั่วคราวค่ะ',
      }).content,
    ).toBe('[Flex] ระบบปิดถอนชั่วคราวค่ะ');
  });
  it('a tag card whose doc id is unknown (out empty) → null id, never the PROFILE id', () => {
    const m = flexHistoryMeta({ kind: 'tag', hook, out: {}, replyBody: '' });
    expect(m.flex_doc_id).toBeNull();
    expect(m.auto_reply_type).toBe('flex_tag');
    expect(m.content).toBe('[Flex] การ์ด');
  });
  it('helper card with a fallback (no bound id) → null id, as before', () => {
    expect(
      flexHistoryMeta({ kind: 'helper', hook: {}, out: {}, replyBody: '' })
        .flex_doc_id,
    ).toBeNull();
  });
});

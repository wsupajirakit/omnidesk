/**
 * [FEAT-20260824-BCASTTRANSCRIPT] The campaign's copy in the customer's chat.
 *
 * Owner, 24/08: *"sender เหมือน bot ทุกอย่าง ห้ามพัง"* · *"ห้ามเด้งรัวๆ"* ·
 * *"ทำ flag ไว้ด้วยว่า chat msg นี้คือ multi … ต้องมีท่อต่อไว้รอเสียบ"*.
 */
import {
  CAMPAIGN_KINDS,
  CAMPAIGN_META_KEY,
  MULTICAST_DIVIDER_VARIANT,
  campaignTag,
  readCampaignTag,
  writeCampaignTranscript,
} from '@/modules/content/broadcast-transcript';

const TARGETS = [
  { roomId: 'room-1', hookId: 'hook-1' },
  { roomId: 'room-2', hookId: 'hook-1' },
];

function fakeModel(fail = false) {
  const inserted: Record<string, unknown>[][] = [];
  return {
    inserted,
    model: {
      insertMany: (rows: Record<string, unknown>[]) => {
        if (fail) return Promise.reject(new Error('mongo down'));
        inserted.push(rows);
        return Promise.resolve(rows);
      },
    },
  };
}

describe('campaignTag — the flag, and the pipe left open', () => {
  it('🔴 `broadcast` is part of the vocabulary even though nothing writes it', () => {
    /* Owner asked for the pipe to exist before the day it is used, so the day
       broadcast becomes storable no reader has to learn a new word.
       ท่อเปิดรอไว้ ยังไม่มีใครเสียบ. */
    expect(CAMPAIGN_KINDS).toContain('multicast');
    expect(CAMPAIGN_KINDS).toContain('broadcast');
  });

  it('rides inside `metadata` under one key', () => {
    const tag = campaignTag({
      kind: 'multicast',
      job_id: 'j1',
      job_name: 'ทัก',
    });
    expect(Object.keys(tag)).toEqual([CAMPAIGN_META_KEY]);
  });

  it('🔴 omits what it does not know rather than writing null', () => {
    const tag = campaignTag({ kind: 'multicast' })[CAMPAIGN_META_KEY];
    expect(tag).toEqual({ kind: 'multicast' });
    expect(tag).not.toHaveProperty('job_name');
  });

  it('round-trips through the reader', () => {
    const meta = campaignTag({
      kind: 'multicast',
      job_id: 'j1',
      job_name: 'แคมเปญ',
      run_id: 'r1',
    });
    expect(readCampaignTag(meta)).toEqual({
      kind: 'multicast',
      job_id: 'j1',
      job_name: 'แคมเปญ',
      run_id: 'r1',
    });
  });

  it('🔴 an UNMARKED row is an ordinary message — never guessed at', () => {
    /* Every message written before today is in this state. Answering a kind for
       one would relabel years of ordinary conversation as campaign traffic. */
    expect(readCampaignTag({})).toBeNull();
    expect(readCampaignTag({ tag_status: null })).toBeNull();
    expect(readCampaignTag(undefined)).toBeNull();
    expect(readCampaignTag(null)).toBeNull();
  });

  it('🔴 a kind nobody wrote on purpose reads as no mark', () => {
    expect(readCampaignTag({ campaign: { kind: 'newsletter' } })).toBeNull();
    expect(readCampaignTag({ campaign: { kind: 42 } })).toBeNull();
  });
});

describe('writeCampaignTranscript — sender เหมือน bot ทุกอย่าง', () => {
  it('🔴 every row is `sender_type: "bot"` — the enum AND the silence', () => {
    /* `sender_type` has a real enum (`customer|bot|admin`) and a row outside it
       fails to LOAD. It is also what keeps this silent: the FE alert rule is
       `sender_type === 'customer'`, and the unread `$inc` uses the same test. */
    const f = fakeModel();
    return writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'flex',
      content: '[Flex] ทักลูกค้าเก่า',
      flexJson: { type: 'bubble' },
      targets: TARGETS,
      jobName: 'ทักลูกค้าเก่า',
    }).then(() => {
      for (const row of f.inserted[0] ?? []) {
        expect(row.sender_type).toBe('bot');
      }
    });
  });

  it('🔴 NEVER writes `last_message` — this is what stops the list bouncing', async () => {
    /* Unlike sound and unread, `last_message` is written for EVERY sender with
       no condition, so touching it would jump every recipient room to the top of
       the chat list at once — the "เด้งรัวๆ" the owner ruled out. */
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'สวัสดี',
      targets: TARGETS,
    });
    const written = JSON.stringify(f.inserted[0]);
    expect(written).not.toContain('last_message');
    expect(written).not.toContain('unread_count');
  });

  it('🔴 message first, divider AFTER it — per the owner', async () => {
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'flex',
      content: '[Flex] แคมเปญ A',
      flexJson: { type: 'bubble' },
      targets: [TARGETS[0]!],
      jobName: 'แคมเปญ A',
    });
    const rows = f.inserted[0] ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.message_type).toBe('flex');
    expect(rows[1]?.message_type).toBe('divider');
    expect(rows[1]?.metadata).toMatchObject({
      variant: MULTICAST_DIVIDER_VARIANT,
    });
  });

  it('🔴 the divider is stamped AFTER the message, by a whole second', async () => {
    /**
     * [FIX-20260824-DIVIDERORDER] The owner saw the divider render ABOVE its own
     * card. The rows were inserted in the right order and Mongoose stamped them
     * 1ms apart — technically ordered, but one millisecond survives nothing: any
     * layer that rounds or groups to the second turns it into a tie, and a tie
     * falls back to whatever order the API returned.
     * ห่างกัน 1ms = เสมอกันทันทีที่มีใครปัดเป็นวินาที.
     */
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: [TARGETS[0]!],
    });
    const [msg, divider] = f.inserted[0] ?? [];
    const msgAt = (msg?.created_at as Date).getTime();
    const divAt = (divider?.created_at as Date).getTime();
    expect(divAt - msgAt).toBeGreaterThanOrEqual(1000);
  });

  it('every recipient gets the same pair of instants', async () => {
    /* Two rooms must not drift apart — the campaign happened once. */
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: TARGETS,
    });
    const rows = f.inserted[0] ?? [];
    expect((rows[0]?.created_at as Date).getTime()).toBe(
      (rows[2]?.created_at as Date).getTime(),
    );
  });

  it('the divider names the job, and reads on its own without the variant', () => {
    /* An older frontend that does not know the variant still shows something a
       person can read, not a bare code. */
    const f = fakeModel();
    return writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: [TARGETS[0]!],
      jobName: 'ทักลูกค้าเก่า',
    }).then(() => {
      expect(String(f.inserted[0]?.[1]?.content)).toContain('ทักลูกค้าเก่า');
      expect(String(f.inserted[0]?.[1]?.content)).toContain('Multicast');
    });
  });

  it('a job with no name still gets a readable divider', () => {
    const f = fakeModel();
    return writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: [TARGETS[0]!],
    }).then(() => {
      expect(String(f.inserted[0]?.[1]?.content)).toBe('Multicast');
    });
  });

  it('two rows per recipient room', async () => {
    const f = fakeModel();
    const n = await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: TARGETS,
    });
    expect(n).toBe(4);
  });
});

describe('🔴 content เป็น string เสมอ — object ทำหน้าแชทพังทั้งหน้า', () => {
  /**
   * REGRESSION, found by the owner opening the chat after a real send.
   *
   * The first version of this writer put the flex CARD OBJECT into `content`.
   * `ChatRoomView.tsx:1427` calls `msg.content.includes('[[[img_')`, which is
   * not a function on an object — React threw and unmounted the entire
   * conversation view. Every one of the 1,018 rows already in `chat_messages`
   * stores a STRING there, whatever the message type; a flex row reads
   * `"[Flex] <name>"` and keeps the card in `metadata.flex_json`.
   * ยัด object ลง content = หน้าแชทพังทั้งหน้า ไม่ใช่แค่แถวนั้น.
   */
  it('🔴 never writes a non-string into `content`', async () => {
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'flex',
      content: '[Flex] แคมเปญ',
      flexJson: { type: 'bubble', body: {} },
      targets: TARGETS,
    });
    for (const row of f.inserted[0] ?? []) {
      expect(typeof row.content).toBe('string');
    }
  });

  it('🔴 the card goes to `metadata.flex_json` — where the renderer looks', async () => {
    const f = fakeModel();
    const card = { type: 'bubble', body: { hero: 1 } };
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'flex',
      content: '[Flex] แคมเปญ',
      flexJson: card,
      targets: [TARGETS[0]!],
    });
    const msg = (f.inserted[0] ?? [])[0] as Record<string, unknown>;
    expect((msg.metadata as Record<string, unknown>).flex_json).toEqual(card);
  });

  it('a text message carries NO `flex_json` key at all', async () => {
    /* A key that means nothing is worse than no key — the renderer branches on
       its presence. absent ≠ undefined-in-the-document. */
    const f = fakeModel();
    await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'สวัสดี',
      targets: [TARGETS[0]!],
    });
    const msg = (f.inserted[0] ?? [])[0] as Record<string, unknown>;
    expect(msg.metadata).not.toHaveProperty('flex_json');
  });
});

describe('writeCampaignTranscript — เก็บสำเนาพัง ห้ามทำให้การส่งพัง', () => {
  it('🔴 a database failure is `null`, never a throw', async () => {
    /* The message is already on the customer's phone. Failing the send because
       the COPY failed would be the tail wagging the dog. */
    const f = fakeModel(true);
    await expect(
      writeCampaignTranscript(f.model as never, {
        kind: 'multicast',
        messageType: 'text',
        content: 'hi',
        targets: TARGETS,
      }),
    ).resolves.toBeNull();
  });

  it('no recipients ⇒ `0`, and nothing is written', async () => {
    /* `0` = nothing to write · `null` = it failed. absent ≠ 0. */
    const f = fakeModel();
    expect(
      await writeCampaignTranscript(f.model as never, {
        kind: 'multicast',
        messageType: 'text',
        content: 'hi',
        targets: [],
      }),
    ).toBe(0);
    expect(f.inserted).toEqual([]);
  });

  it('a target with no room is skipped, not written as a junk row', async () => {
    const f = fakeModel();
    const n = await writeCampaignTranscript(f.model as never, {
      kind: 'multicast',
      messageType: 'text',
      content: 'hi',
      targets: [{ roomId: null, hookId: 'h' }, TARGETS[0]!],
    });
    expect(n).toBe(2);
  });
});

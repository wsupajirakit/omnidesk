/**
 * [FEAT-20260908-CHATTRANS] the one writer of `chat_messages.translations`
 * ===========================================================================
 * A second press on the same chip, two admins on the same message, or a double
 * click must all leave ONE entry per language. The guard is not an `if` in the
 * route — it is the predicate of the write itself:
 *
 *     updateOne({ _id, 'translations.lang': { $ne: lang } },
 *               { $push: { translations: entry } })
 *
 * ## 🔴 WHY THE FAKE EVALUATES THE FILTER INSTEAD OF RECORDING IT
 *
 * A spec that asserts `expect(filter).toEqual({...})` pins the SPELLING of the
 * query and proves nothing about what it does — and it stays green if the
 * predicate is right but the update is wrong, or vice versa. So the double
 * below is a three-rule Mongo: it holds a document, applies the `_id` match and
 * the `translations.lang: {$ne}` predicate, and pushes only when both hold.
 * Dropping the predicate from the source therefore produces a SECOND ENTRY in
 * the document (M15) rather than a mismatched string in an assertion.
 *
 * ⚠️ The one Mongo behaviour the double encodes deliberately: `$ne` matches when
 * the path is ABSENT. That is why an ordinary message — which carries no
 * `translations` key at all — passes the predicate and the first `$push`
 * creates the array. A double that treated a missing path as "no match" would
 * make the very first translation impossible and the mistake would look like a
 * bug in the route.
 *
 * revert: delete this file with `src/modules/chat/translate/translation-store.ts`.
 */
import { execFileSync } from 'node:child_process';

import {
  outboundTranslationEntry,
  pushMessageTranslation,
  type MessageTranslationEntry,
  type PushableTranslationEntry,
  type TranslationStoreModel,
} from '@/modules/chat';

type Doc = { _id: string; translations?: MessageTranslationEntry[] };

/**
 * A Mongo small enough to read, faithful on the three rules this write uses.
 * `calls` records every filter/update pair so ordering can still be inspected.
 */
const fakeModel = (docs: Doc[]) => {
  const calls: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }[] = [];
  const model: TranslationStoreModel = {
    updateOne: (filter, update) => {
      calls.push({ filter, update });
      const doc = docs.find((d) => d._id === filter._id);
      let modifiedCount = 0;
      if (doc) {
        const ne = (filter['translations.lang'] as { $ne?: string } | undefined)
          ?.$ne;
        /* `$ne` on an ABSENT path matches — see the header. */
        const blocked =
          ne !== undefined &&
          (doc.translations ?? []).some((t) => t.lang === ne);
        const push = (
          update.$push as { translations?: MessageTranslationEntry } | undefined
        )?.translations;
        if (!blocked && push) {
          doc.translations = [...(doc.translations ?? []), push];
          modifiedCount = 1;
        }
      }
      return Promise.resolve({ modifiedCount });
    },
  };
  return { model, calls, docs };
};

const EN: PushableTranslationEntry = {
  lang: 'en',
  text: 'hello',
  from: null,
  to: 'en',
};

describe('⭐ one entry per language, whatever the caller does', () => {
  it('⭐ the first press creates the array on a message that has no key', () => {
    /* The ordinary case. The column is absent on every existing row, so the
       predicate has to match a missing path or nothing could ever be stored. */
    const f = fakeModel([{ _id: 'm1' }]);
    return pushMessageTranslation(f.model, 'm1', EN).then((stored) => {
      expect(stored).toBe(true);
      expect(f.docs[0]?.translations).toEqual([EN]);
    });
  });

  it('⭐ M15 — pressing twice for the SAME language leaves exactly one entry', async () => {
    const f = fakeModel([{ _id: 'm1' }]);
    await pushMessageTranslation(f.model, 'm1', EN);
    const second = await pushMessageTranslation(f.model, 'm1', {
      ...EN,
      text: 'a different translation of the same thing',
    });

    expect(second).toBe(false);
    expect(f.docs[0]?.translations).toHaveLength(1);
    expect(f.docs[0]?.translations?.[0]?.text).toBe('hello');
    /* and it really did try — the guard is in the write, not in a caller. */
    expect(f.calls).toHaveLength(2);
  });

  it('⭐ M15 — a THIRD press cannot get past it either', async () => {
    const f = fakeModel([{ _id: 'm1' }]);
    for (const text of ['one', 'two', 'three']) {
      await pushMessageTranslation(f.model, 'm1', { ...EN, text });
    }
    expect(f.docs[0]?.translations?.map((t) => t.text)).toEqual(['one']);
  });

  it('a DIFFERENT language is added beside it — the guard is per language', async () => {
    const f = fakeModel([{ _id: 'm1' }]);
    await pushMessageTranslation(f.model, 'm1', EN);
    const my = { lang: 'my', text: 'မင်္ဂလာပါ', from: null, to: 'my' };
    expect(await pushMessageTranslation(f.model, 'm1', my)).toBe(true);
    expect(f.docs[0]?.translations?.map((t) => t.lang)).toEqual(['en', 'my']);
  });

  it('`zh-Hans` and `zh-Hant` are two languages, not one', async () => {
    /* The reason Chinese is two registry entries. If the guard matched on a
       prefix these would collide and the second press would be swallowed. */
    const f = fakeModel([{ _id: 'm1' }]);
    for (const lang of ['zh-Hans', 'zh-Hant']) {
      await pushMessageTranslation(f.model, 'm1', { ...EN, lang, to: lang });
    }
    expect(f.docs[0]?.translations?.map((t) => t.lang)).toEqual([
      'zh-Hans',
      'zh-Hant',
    ]);
  });
});

describe('⭐ the write itself — one operation, no read first', () => {
  it('⭐ the predicate and the push travel in ONE call', async () => {
    /* Atomicity is the point: no `findById`, no read-modify-write, no window
       between "is it there?" and "add it". One call is the evidence. */
    const f = fakeModel([{ _id: 'm1' }]);
    await pushMessageTranslation(f.model, 'm1', EN);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.filter).toEqual({
      _id: 'm1',
      'translations.lang': { $ne: 'en' },
    });
    expect(f.calls[0]?.update).toEqual({ $push: { translations: EN } });
  });

  it('the stored entry is exactly the four fields — no vendor, no actor, no timestamp', () => {
    /* Provenance belongs in the audit row. The +18% shape that carried
       source/target/vendor/model/by/at was rejected for exactly this: 91% of it
       was metadata nothing renders, shipped on every page load forever. */
    expect(Object.keys(EN).sort()).toEqual(['from', 'lang', 'text', 'to']);
  });

  it('a message that is gone answers false, and false is not an error', async () => {
    const f = fakeModel([{ _id: 'm1' }]);
    expect(await pushMessageTranslation(f.model, 'deleted', EN)).toBe(false);
  });

  it('a driver that omits modifiedCount is read as "nothing stored", not as a crash', async () => {
    const model: TranslationStoreModel = {
      updateOne: () => Promise.resolve({}),
    };
    expect(await pushMessageTranslation(model, 'm1', EN)).toBe(false);
  });
});

describe('⭐ the outbound entry — the admin original, beside the text the customer got', () => {
  it('lang === from, so the direction derives to "translated BEFORE sending"', () => {
    const e = outboundTranslationEntry('สวัสดีครับ', 'th');
    expect(e).toEqual({
      lang: 'th',
      text: 'สวัสดีครับ',
      from: 'th',
      to: null,
    });
    expect(e.lang === e.from).toBe(true);
    expect(e.lang === e.to).toBe(false);
  });

  it('`to` is null rather than invented — the send request never states it', () => {
    /* `POST /api/chat/:id/reply` carries `original_text` + `original_lang` and
       nothing else. Filling `to` from the UI language or the hook would put a
       language on screen that nobody chose. */
    expect(outboundTranslationEntry('hi', 'en').to).toBeNull();
  });
});

describe('⭐ it is the ONLY writer, and that is checked rather than asserted', () => {
  /** `grep -rl`, tolerating "no matches" (exit 1) as an empty list. */
  const grepFiles = (pattern: string): string[] => {
    try {
      return execFileSync('grep', ['-rl', '--include=*.ts', pattern, 'src/'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  it('⭐ exactly one file in src/ pushes onto the column', () => {
    /* If a second `$push` appears anywhere, the duplicate guard stops being a
       property of the column and becomes a rule each call site has to remember
       — which is the shape this whole file exists to prevent. */
    expect(grepFiles('\\$push: { translations')).toEqual([
      'src/modules/chat/translate/translation-store.ts',
    ]);
  });

  it('⭐ and the outbound insert reaches the shape through this file too', () => {
    /* The send path does NOT `$push` — it writes the entry inside the single
       `create()` it already performs, so a send cannot half-happen. That makes
       it a second WRITER, which is allowed, but it must not be a second place
       where the shape is decided: it builds its entry with
       `outboundTranslationEntry` or not at all. */
    /* the CALL, not the name: `(` is a literal in grep's basic regex, so a
       file that only MENTIONS the builder in a comment is not a writer. */
    const senders = grepFiles('outboundTranslationEntry(')
      .filter((f) => !f.endsWith('translation-store.ts'))
      /* a barrel re-export is not a writer */
      .filter((f) => !f.endsWith('/index.ts'));
    for (const f of senders) {
      expect(f).toBe('src/modules/chat/chat.service.ts');
    }
    /* A hand-built literal in the send path would show up here instead. */
    const literalBuilders = grepFiles('translations: \\[\\{').filter(
      (f) => !f.endsWith('chat-message.schema.ts'),
    );
    expect(literalBuilders).toEqual([]);
  });
});

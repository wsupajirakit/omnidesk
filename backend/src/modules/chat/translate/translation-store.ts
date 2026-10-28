/**
 * [FEAT-20260908-CHATTRANS] The ONE writer of `chat_messages.translations`.
 * ===========================================================================
 * Every path that stores a translation comes through this file, so the shape of
 * a stored entry and the rule that stops a language being stored twice live in
 * exactly one place. `translation-store.spec.ts` is what keeps that claim
 * checkable — it greps the tree for `$push` against the column.
 *
 * ## 🔴 THE DUPLICATE GUARD IS THE PREDICATE, NOT A READ-THEN-WRITE
 *
 *     updateOne({ _id, 'translations.lang': { $ne: lang } },
 *               { $push: { translations: entry } })
 *
 * The predicate and the push are evaluated together against ONE document by the
 * server, so there is no window between "is it already there?" and "add it".
 * Two admins pressing the same chip on the same message in the same second
 * produce one entry, not two, and no `arrayFilters`, no transaction and no
 * optimistic retry is involved. The alternative — read, decide, write — is the
 * shape that looks correct in a unit test and duplicates under a double click.
 * เงื่อนไขกับการเขียนตัดสินพร้อมกันในคำสั่งเดียว.
 *
 * `'translations.lang': { $ne: lang }` also matches when the array is ABSENT,
 * which is the ordinary case: `$ne` on a missing path is true. That is why the
 * column can stay unset until the first press and the first `$push` creates it.
 *
 * ## What "false" means, and why the caller must not treat it as an error
 *
 * `modifiedCount === 0` means the predicate did not match: either the message is
 * gone, or that language is ALREADY stored. Both are "nothing to add", never
 * "the write failed" — the caller answers the admin from what it has rather
 * than raising. A press that lost a race must still show a translation.
 *
 * ## Deliberately NOT in this file
 *
 * No vendor call, no cap, no audit, no permission check and no HTTP. It takes
 * the narrowest slice of the model it can (`updateOne` only), so a spec drives
 * the real function against a fake rather than a Mongo connection, and so this
 * file cannot grow into a second place where the route's rules are decided.
 *
 * revert: delete this file and its two call sites (the translate route, and the
 * outbound send — which does NOT use `$push`, see the note at the bottom).
 */
import type { Types } from 'mongoose';

/** One stored rendering. Mirrors `MessageTranslation` in the schema exactly. */
export interface MessageTranslationEntry {
  /** The language of `text`. `null` only where it was never stated — see below. */
  lang: string | null;
  /** The only field that is always there. */
  text: string;
  /** `null` when the caller stated no source language — never a guess. */
  from: string | null;
  /** `null` on the outbound path, which is never told the target. */
  to: string | null;
}

/**
 * What the `$push` path may store.
 *
 * 🔴 The duplicate guard matches on `lang`, so an entry with no language could
 * never be found again and a second press would append beside it forever. The
 * read path always knows the target — the admin picked it — so this type makes
 * "the cache key is present" a compile-time fact rather than a convention.
 * Only the OUTBOUND builder below is allowed a null language, and that entry is
 * never pushed: it rides an insert.
 */
export type PushableTranslationEntry = MessageTranslationEntry & {
  lang: string;
};

/**
 * Just the slice of `Model<ChatMessageDocument>` this needs.
 *
 * `PromiseLike`, not `Promise`: mongoose's `updateOne` hands back a `Query`,
 * which is thenable but is not a `Promise`. Widening the type here is what lets
 * the real model and a three-line fake satisfy the same signature.
 */
export interface TranslationStoreModel {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): PromiseLike<{ modifiedCount?: number }>;
}

/**
 * Add one rendering to a message, at most once per language.
 *
 * @returns `true` when this call is what stored it; `false` when the language
 *   was already there or the message is gone. See the header — `false` is not
 *   an error.
 */
export async function pushMessageTranslation(
  model: TranslationStoreModel,
  messageId: string | Types.ObjectId,
  entry: PushableTranslationEntry,
): Promise<boolean> {
  const res = await model.updateOne(
    {
      _id: messageId,
      /* 🔴 The whole duplicate guard. Dropping this predicate makes a second
         press append a second entry for the same language, and the read side
         would then render whichever one it found first. */
      'translations.lang': { $ne: entry.lang },
    },
    { $push: { translations: entry } },
  );
  return (res?.modifiedCount ?? 0) > 0;
}

/**
 * Build the entry an ADMIN SEND stores — the admin's own original, alongside the
 * translated `content` the customer actually received.
 *
 * ⚠️ This one is NOT pushed. It rides the single `create()` that `sendChatReply`
 * already performs, so a send cannot half-happen: either the row exists with its
 * original, or there is no row. Kept in this file anyway, because "the shape of
 * a stored translation" must have one owner even when two operations write it.
 *
 * ⚠️ TWO NULLS, AND NEITHER IS A GAP TO FILL LATER.
 *
 * [FEAT-20260910-OUTBOUNDTARGET] `to` is no longer null ALWAYS — the request may
 * now carry `translated_lang`, which is the language the ADMIN PICKED in the
 * composer, not a detection. Absent (an older dashboard, or a send with no
 * translation) ⇒ still null, and rows written before today keep it.
 *
 * ⚠️ `to` is therefore no longer a direction marker on its own. What separates
 * the two shapes is stated below and is unchanged: an INBOUND entry's `text` is
 * in the target language (`lang === to`), an OUTBOUND entry's `text` is the
 * original (`lang === from`). Readers must derive from that, not from a null.
 *
 * `originalLang` is OPTIONAL, and in practice usually absent. The composer does
 * not ask the admin what language they just typed in, the preview answers with
 * `{ text }` only, and the panel's UI language is not the language of the
 * draft — so the dashboard sends the text alone rather than guess (agent E,
 * 09/09). When it is absent both `lang` and `from` are null and the bubble
 * renders the original with no language pair, which is precisely what is known
 * about it. Filling either from the UI locale would put a language on screen
 * that nobody chose. ไม่รู้ = null · ห้ามเดา.
 *
 * When the language IS stated, `lang === from` is what marks the entry as
 * "translated BEFORE sending" once the direction is derived.
 */
export function outboundTranslationEntry(
  originalText: string,
  originalLang: string | null,
  /* [FEAT-20260910-OUTBOUNDTARGET] the language the customer received. Optional
     so every existing caller compiles and stores what it stored before. */
  targetLang: string | null = null,
): MessageTranslationEntry {
  const lang = originalLang && originalLang.trim() ? originalLang.trim() : null;
  const to = targetLang && targetLang.trim() ? targetLang.trim() : null;
  return {
    lang,
    text: originalText,
    from: lang,
    to,
  };
}

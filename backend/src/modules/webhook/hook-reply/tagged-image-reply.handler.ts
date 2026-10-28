import axios from 'axios';

import { objectRuntimeScopeFilter } from '@/modules/content';

import { asString, errText } from '../logging/coerce-mask.util';

/**
 * [PROG-20260905-C1] The tagged-image carousel reply, lifted out of the spine.
 *
 * WHEN IT RUNS. The AI answer carried an image tag, and the album that tag names is
 * shared with this OA. It answers with up to five images (media) or one flex carousel,
 * posts them itself, files the webhook_log row and ends the turn.
 *
 * THE CONTRACT IS A BOOLEAN, and it is exactly the block's original control flow:
 *   true  — the carousel went out. The caller returns immediately, skipping the flex
 *           ladder, the staleness guards, the send ladder and the post-send stamps —
 *           the same gates the original `return;` skipped from this position.
 *   false — nothing was sent: no album in scope, no album for the tag, no storages, or
 *           the send threw. The caller falls through to the plain-text reply, which is
 *           what the original did by NOT returning.
 *
 * ⚠️ THE CATCH DOES NOT RETHROW AND MUST NOT START. A failed carousel deliberately falls
 * through so the customer still gets something. It also writes NO webhook_log row on that
 * path — the row is only for a delivered carousel.
 *
 * ⚠️ THE SEND IS RAW AXIOS, not the push dispatcher, and that is legacy behaviour kept
 * on purpose (legacy:4617). Its wlog row is frozen byte-for-byte in golden flow-matrix
 * snapshots, so the object literal below is behaviour, not formatting.
 *
 * ⚠️ `LINE_REPLY_ENDPOINT` and `errText` are redeclared here rather than exported from
 * the service — importing them back from `webhook.service.ts` would be a cycle. The
 * repo already does this twice (`customer-register.handler.ts`,
 * `chat/channels/outbound-audit.ts`).
 */

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/** A lean Mongo document as this flow reads it. */
type Doc = Record<string, unknown>;

export interface TaggedImageReplyArgs {
  matchingTag: string;
  hookId: unknown;
  hookGroup: unknown;
  accessToken: string;
  replyToken?: string;
  eventId?: string;
  logContext: Record<string, unknown>;
}

export interface TaggedImageReplyDeps {
  /* Typed as plain documents rather than mongoose Models: this file must not import the
     schema layer, and the two queries are the only thing it needs from it. */
  objectImageModel: {
    findOne: (filter: Record<string, unknown>) => {
      lean: <T = Doc>() => { exec: () => Promise<T | null> };
    };
  };
  imageStorageModel: {
    find: (filter: Record<string, unknown>) => {
      sort: (order: Record<string, number>) => {
        /* `lean<T>()` takes the FULL result type, arrays included — that is how the call
           site writes it (`.lean<Array<Doc>>()`), so `exec` resolves T, not T[]. */
        limit: (n: number) => {
          lean: <T = Doc[]>() => { exec: () => Promise<T> };
        };
      };
    };
  };
  wlogEmit: (row: Record<string, unknown>) => Promise<void>;
  logger: { log: (m: string) => void; error: (m: string) => void };
}

export async function replyWithTaggedImages(
  args: TaggedImageReplyArgs,
  deps: TaggedImageReplyDeps,
): Promise<boolean> {
  deps.logger.log(`[ImageTag] Detected tag in response: ${args.matchingTag}`);
  /* [FEAT-20260901-OBJSCOPE] Constrain the album to the OA being
     talked to.

     Before this the lookup filtered on `matching_tag` alone. That
     column is NOT unique (measured on the live database), so two groups
     could hold the same tag and the bot would serve whichever row Mongo
     reached first — one group's image answering another group's
     customer.

     `hook` is already in hand here; nothing extra is fetched, and the
     legs go into the SAME filter object, so this is still one findOne
     in and one out, still served by the existing `matching_tag_1`.

     ⚠️ A null filter means the OA could not be identified. Skip the
     lookup rather than running it unscoped — an unidentified OA serving
     library images is the exact leak being closed here.

     revert: drop the `...scope` spread and the `scope === null` guard;
     the lookup goes back to tag-only. */
  const scope = objectRuntimeScopeFilter(args.hookId, args.hookGroup);
  const objImage =
    scope === null
      ? null
      : await deps.objectImageModel
          .findOne({
            matching_tag: args.matchingTag,
            deleted_at: { $exists: false },
            ...scope,
          })
          .lean<Record<string, unknown>>()
          .exec();

  /* A miss used to log nothing at all, leaving an operator unable to
     tell "the tag is wrong" from "this album is not shared with this
     OA". One line, no branch, no behaviour change. */
  if (!objImage) {
    /* `asString` rather than `String(...)`: these come off an untyped
       cache, and a non-scalar would log as "[object Object]" — a value
       that tells an operator nothing about which OA was asking. */
    deps.logger.log(
      `[ImageTag] No album in scope for ${args.matchingTag} ` +
        `(hook=${asString(args.hookId) ?? '-'} ` +
        `group=${asString(args.hookGroup) ?? '-'})`,
    );
  }
  if (objImage) {
    const storages = await deps.imageStorageModel
      .find({
        object_image_id: objImage['_id'],
        deleted_at: { $exists: false },
      })
      .sort({ priority: 1 })
      .limit(10)
      .lean<Array<Record<string, unknown>>>()
      .exec();

    if (storages.length > 0) {
      let messages: Array<Record<string, unknown>>;
      if (objImage['response_type'] === 'media') {
        // ⚠️ LINE caps a reply at 5 messages, so `media` sends at most 5
        //    even though up to 10 rows were fetched.
        messages = storages.slice(0, 5).map((s) => {
          const secureUrl = String(s['image_url']).replace(
            /^http:\/\//i,
            'https://',
          );
          return {
            type: 'image',
            originalContentUrl: secureUrl,
            previewImageUrl: secureUrl,
          };
        });
      } else {
        const bubbles = storages.map((s) => {
          const secureUrl = String(s['image_url']).replace(
            /^http:\/\//i,
            'https://',
          );
          const hero: Record<string, unknown> = {
            type: 'image',
            url: secureUrl,
            size: 'full',
            aspectRatio: '2:3',
            aspectMode: 'fit',
          };
          if (s['detail_link']) {
            hero['action'] = { type: 'uri', uri: s['detail_link'] };
          }
          return {
            type: 'bubble',
            hero,
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text:
                    (s['detail_text'] as string) ||
                    (objImage['detail'] as string) ||
                    'ดูรายละเอียด',
                  weight: 'bold',
                  size: 'xs',
                  wrap: true,
                },
              ],
            },
          };
        });
        messages = [
          {
            type: 'flex',
            altText: objImage['detail'] || 'ดูรายการรูปภาพ',
            contents: { type: 'carousel', contents: bubbles },
          },
        ];
      }

      const lineStart = Date.now();
      try {
        // ⚠️ legacy:4617 posts this one RAW with axios rather than
        //    going through `sendLineFlexReply`, because the payload is a
        //    MESSAGE ARRAY (up to five images) and that helper wraps a
        //    single flex message. Reproduced as found, timeout included.
        const lineResponse = await axios.post(
          LINE_REPLY_ENDPOINT,
          { replyToken: args.replyToken, messages },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${args.accessToken}`,
            },
            timeout: 15_000,
          },
        );
        await deps.wlogEmit({
          ...args.logContext,
          channel: 'line_api',
          action_type:
            objImage['response_type'] === 'media'
              ? 'line_reply_image'
              : 'line_reply_flex',
          method: 'POST',
          endpoint: LINE_REPLY_ENDPOINT,
          status: 'success',
          http_status: lineResponse.status,
          payload_summary: {
            matching_tag: args.matchingTag,
            img_count: storages.length,
            flex_json: messages,
          },
          response_summary: lineResponse.data,
          duration_ms: Date.now() - lineStart,
          line_event_id: args.eventId,
        });
        return true;
      } catch (axiosErr) {
        // ⚠️ NO return, NO rethrow: a failed carousel falls through to
        //    the plain-text reply below, so the customer still gets
        //    something.
        deps.logger.error(
          `[ImageTag] Error sending Flex message: ${errText(axiosErr)}`,
        );
      }
    }
  }
  return false;
}

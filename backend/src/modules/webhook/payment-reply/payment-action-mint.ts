/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] `{{paylink.*}}` — mint the BUTTONS an
 *      admin authored into a flex card ====
 *
 * 📍 `docs/payment-states.md` §7e is the map of every tag namespace and who fills
 * it (LOCAL ONLY, `.gitignore:46` ignores `*.md` repo-wide). §7d explains the
 * retry button's resume contract. อ่านสองหัวข้อนั้นก่อนแก้ไฟล์นี้.
 *
 * WHAT: an admin designs the payment reply card on the web page and writes a
 * button's payload as a tag. This file turns those tags into real, working
 * actions at send time:
 *
 *   `{{paylink.retry}}`         → the resume postback payload (`action.data`)
 *   `{{paylink.contact_admin}}` → a POSTBACK action carrying `paylink:v1:…`,
 *                                   with CONTACT_ADMIN_MESSAGE as `displayText`
 *   `{{paylink.contact_admin_via_withdraw}}` → the same, its own payload
 *
 * [FEAT-20260902-ADMINPOSTBACK] The two contact tags are authored on a
 * `type:"message"` button and REWRITTEN here into a `type:"postback"` one. That
 * asymmetry is the whole point: a message button posts text anyone can type, so
 * the doors that consume it could not tell a press from a typed sentence. The
 * rewrite happens at send time so no stored card, seed file or guide row has to
 * change. See `common/utils/paylink-tag.ts` for the scope notes.
 *
 * WHY A SEPARATE FILE FROM `flex-slip-tags.util.ts`: that util substitutes VALUES
 * a customer reads (amount, bank name) on the stringified card. This one changes
 * the card's STRUCTURE — it can delete a node (see THE HARD RULE) — which a string
 * replace cannot do. Two different jobs, run in sequence, neither aware of the
 * other; keeping them apart means editing slip formatting can never accidentally
 * change which buttons exist. ห้ามรวมสองไฟล์นี้เข้าด้วยกัน.
 *
 * ══ 🔴 THE HARD RULE — the reason this file exists ═════════════════════════════
 * `{{paylink.retry}}` is only honest when the run HAS somewhere to resume to
 * (state `no_match_retry`, statements left). On `review`, or once statements are
 * exhausted, there is nothing to advance to. In that case the button is NOT
 * blanked and NOT left raw:
 *
 *   · blanked (`data: ''`)  ⇒ a button that does nothing when tapped. The
 *     customer taps, silence, and believes the system is broken (or worse, that
 *     the money is being handled).
 *   · left raw              ⇒ the customer literally reads `{{paylink.retry}}`.
 *
 *   ⇒ THE WHOLE BUTTON NODE IS REMOVED FROM ITS PARENT ARRAY.
 *
 * That inherits the intent already enforced in `payment-mint-flex.builder.ts`
 * `buildAction:229` — `if (!ctx.resume) return null` — which omits the retry
 * button on the code-built card. A retry button that cannot advance anything is a
 * lie, and the same rule must hold for an admin-built card.
 * ปุ่มที่กดแล้วไปต่อไม่ได้ = โกหกลูกค้า ⇒ ตัดทิ้งทั้ง node.
 *
 * ══ SHAPE ═════════════════════════════════════════════════════════════════════
 * Pure function: no Nest, no DB, no network, no logger. Input is never mutated
 * and NOTHING throws — callers sit on the money path, so a malformed card must
 * degrade to "send what we were given" rather than kill the reply.
 *
 * HOW TO CHANGE LATER
 *   · a NEW tag            → add one entry to `mintOne` below. Nothing else.
 *   · the retry payload    → `buildRetryPostbackData` (payment-postback.handler)
 *     is the ONLY place that knows the format; it is imported, never rebuilt.
 *   · the admin message    → CONTACT_ADMIN_MESSAGE (payment/payment-reply-copy.ts)
 * revert: delete this file + its call in the payment reply delivery path. A card
 * that uses no `{{paylink.*}}` tag comes back byte-identical either way.
 */
import {
  PAYLINK_MINTS_POSTBACK,
  PAYLINK_TAG_FIELD,
  payLinkPostbackData,
} from '@/common/utils/paylink-tag';
import {
  CONTACT_ADMIN_MESSAGE,
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
} from '@/modules/payment';

import { buildRetryPostbackData } from './payment-postback.handler';

/** What the mint needs to know: where a `[ลองใหม่]` tap should resume, if anywhere. */
export interface PayLinkContext {
  /**
   * Present ⇒ the run paused with a statement left, so retry is real work.
   * Absent  ⇒ nothing to advance to ⇒ the retry button node is REMOVED.
   */
  resume?: {
    /** The paused run to continue. */
    runId: string;
    /** The statement index to try next — the run's `resume_cursor`. */
    nextIdx: number;
  };
}

export interface MintPayLinksResult {
  /** The card, with tags minted and dead buttons pruned. A fresh structure. */
  contents: unknown;
  /** Tags that became a working action, e.g. `['paylink.retry']`. */
  minted: string[];
  /**
   * What was thrown away and why — one entry per removed node, plus a note when
   * the card could not be walked at all. Caller-loggable; nothing here is fatal.
   */
  dropped: string[];
}

/**
 * Matches ONE `{{paylink.<name>}}` occupying a whole string value.
 *
 * ANCHORED on purpose: a tag is a button's entire payload, not a fragment of
 * prose. `data: "pay:{{paylink.retry}}"` is not a thing an admin can write
 * usefully, and treating it as a tag would produce a corrupt payload. Anything
 * unanchored therefore falls through untouched and stays visible.
 * Whitespace-tolerant and case-insensitive to match the slip tags' convention
 * (`flex-slip-tags.util.ts:133-139`) — the same admins author both.
 */
const PAYLINK_RE = /^\s*\{\{\s*paylink\.([a-z0-9_]+)\s*\}\}\s*$/i;

/* [FEAT-20260831-MENUVARSET] The map moved to `@/common/utils/paylink-tag`
   so the flex editor's guide can OFFER exactly the tags this file ACCEPTS.
   `content` cannot import this module (it would close a runtime cycle —
   `payment.module.ts:19` already imports content), hence a leaf both can read.
   Same values, same name here, so every use below is unchanged.
   revert: paste the literal back and drop the import. */
const TAG_FIELD = PAYLINK_TAG_FIELD;

/** `{ type:'button', action:{...} }` and friends — everything is optional. */
type Node = Record<string, unknown>;

const isObj = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read the `{{paylink.*}}` tag a node's own `action` carries, if any.
 *
 * The tag sits at `node.action.data` (or `.text`), so the node that OWNS the
 * `action` — typically the `{type:'button'}` wrapper — is the unit we mint or
 * remove. Reading it here, one level up from the string, is what makes removal
 * possible at all: at the string itself there is no way back to the parent array.
 */
function readTag(node: Node): { name: string; field: 'data' | 'text' } | null {
  const action = node['action'];
  if (!isObj(action)) return null;

  for (const field of ['data', 'text'] as const) {
    const raw = action[field];
    if (typeof raw !== 'string') continue;
    const m = PAYLINK_RE.exec(raw);
    if (m) return { name: (m[1] as string).toLowerCase(), field };
  }
  return null;
}

/**
 * Decide one tagged node: keep it with a real action, or drop it.
 *
 * @returns a PATCH of `action` keys to apply, or `null` to DROP the whole node.
 *
 * 🔴 [FEAT-20260902-ADMINPOSTBACK] THIS USED TO RETURN A BARE STRING, and the
 * caller wrote it back into the one field the tag was authored in. That shape
 * could only ever substitute a VALUE — it could not change `action.type` and
 * could not introduce `displayText`, so a `message` button could never become a
 * `postback` one. Returning a patch is what makes the rewrite possible without
 * touching a single stored card. The caller drops the authored tag field first,
 * so a leftover `text` can never ride along beside the new `data`.
 * ⇒ คืนเป็นชุดคีย์ ไม่ใช่สตริง เพราะต้องเปลี่ยน type ของปุ่มได้ด้วย
 */
function resolveTag(
  name: string,
  field: 'data' | 'text',
  ctx: PayLinkContext,
): Node | null {
  // UNKNOWN tag, or a known tag in the WRONG field (`{{paylink.retry}}` typed
  // into a message button's `text`, where a postback payload can never fire).
  // Either way this button cannot be made to work, so it is DROPPED and reported
  // rather than minted into something that looks alive and is not. The alternative
  // — leaving the raw tag in place — puts `{{paylink.…}}` in front of a customer.
  if (TAG_FIELD[name] !== field) return null;

  if (name === 'retry') {
    // 🔴 THE HARD RULE. See the header: no resume ⇒ the node goes, not the value.
    if (!ctx.resume) return null;
    // Authored AND minted in `data` on a button the operator already drew as a
    // postback — so the patch is the single field, exactly as before.
    return {
      data: buildRetryPostbackData(ctx.resume.runId, ctx.resume.nextIdx),
    };
  }

  const text = MESSAGE_BY_TAG[name];
  if (text === undefined) return null;

  /* [FEAT-20260902-ADMINPOSTBACK] the message→postback rewrite.
     ═══════════════════════════════════════════════════════════════
     The card says `{type:'message', label:'💬 ติดต่อแอดมิน', text:'{{paylink.contact_admin}}'}`
     and the customer must keep seeing exactly that button. What changes is what
     the tap SENDS: a postback carrying a payload only a button can produce,
     instead of text anyone can type.

     `displayText` is why the rewrite is invisible to everyone: LINE still shows
     the same sentence in the chat thread on the customer's phone, so the
     conversation reads identically — it simply arrives as a postback event
     rather than a message one. Dropping it would make the tap silent on screen,
     which looks broken to the customer even though the case opens.
     ⇒ ลูกค้าเห็นเหมือนเดิมทุกอย่าง เปลี่ยนแค่ชนิด event ที่ส่งกลับ

     ⚠️ `label` is NOT set here on purpose: the caller keeps every other key the
        operator drew (colour, height, style, label), so a card redesign needs no
        change in this file.
     SCOPE: to turn one tag back into a plain message button, remove its name
     from `PAYLINK_MINTS_POSTBACK` — this branch then falls to the line below
     and substitutes the copy text in place, which is the pre-02/09 behaviour. */
  if (PAYLINK_MINTS_POSTBACK.has(name)) {
    return {
      type: 'postback',
      data: payLinkPostbackData(name),
      displayText: text,
    };
  }

  /* [FEAT-20260831-ADMINVIAWITHDRAW] a LOOKUP, where this used to be a bare
     `return CONTACT_ADMIN_MESSAGE`.

     That line read "every name that is not retry means contact_admin", which was
     true while there were two tags and becomes a silent bug the moment there is
     a third: a typo'd name would have minted the admin message. `TAG_FIELD`
     above already refused unknown names, so the old line was safe — but only by
     a guard two lines away, and that is not a property worth relying on twice.
     A missing entry answers null (the `text === undefined` line above), and null
     means the node is dropped, which is this file's rule for anything that
     cannot be made to work. */
  return { [field]: text };
}

/**
 * `paylink` name → the text a message button posts on the customer's behalf.
 *
 * Both entries are copy owned by `payment-reply-copy.ts`; this maps names to
 * them and holds no strings of its own. Add a tag: one row here, one row in
 * `PAYLINK_TAG_FIELD`, and the guide picks it up from the same table.
 */
const MESSAGE_BY_TAG: Readonly<Record<string, string>> = {
  contact_admin: CONTACT_ADMIN_MESSAGE,
  contact_admin_via_withdraw: CONTACT_ADMIN_WITHDRAW_MESSAGE,
};

/**
 * A container that LINE rejects when its `contents` array is empty.
 *
 * A box/carousel with `contents: []` is an API error, not an empty-looking card —
 * so pruning the last child of a box must prune the box too, or removing one dead
 * button would break the entire reply. Bubbles are NOT in this list: a bubble's
 * body is a single object, not an array, and a bubble with no footer is valid
 * (that is exactly what `buildMintFlex` renders when no button survives).
 */
const EMPTY_CONTENTS_INVALID = new Set(['box', 'carousel']);

/**
 * [FIX-20260810-KEEPSPACER] An empty box that carries SIZE is a spacer, not debris.
 *
 * The rule above prunes empty containers because LINE rejects `contents: []` — but
 * an empty box given a `height`/`width` (or `flex`) is the standard way designers add
 * vertical space, and LINE renders it happily. Pruning those quietly tightened up
 * every card an admin had laid out, which is a visual change we have no business
 * making while minting a button.
 *
 * Found while verifying the generated templates in `todo/flex/`: the owner's own
 * layout used `{type:'box', layout:'vertical', contents:[], height:'20px'}` and its
 * spacing vanished from the sent card.
 *
 * A truly empty box — no size at all — is still dropped, because that IS the invalid
 * shape the rule was written for. box ว่างที่กำหนดขนาด = spacer ตั้งใจ ⇒ เก็บไว้.
 */
function isDeliberateSpacer(node: Record<string, unknown>): boolean {
  return (
    node['height'] !== undefined ||
    node['width'] !== undefined ||
    node['flex'] !== undefined
  );
}

/**
 * Walk the card, minting tags and pruning what cannot work.
 *
 * @returns the rebuilt value, or `DROP` when this node must vanish from its parent.
 *
 * Depth-first and bottom-up, so a box whose only child was a dead retry button is
 * seen as empty by the time its own turn comes and is pruned in the same pass —
 * no second sweep, no half-pruned intermediate state.
 *
 * `seen` guards against a cyclic card (a hand-built object, never valid JSON from
 * the DB): revisiting a node returns `DROP`, which ends the walk instead of
 * recursing forever. `mintPayLinks` reports it and returns the ORIGINAL card.
 */
const DROP = Symbol('drop-node');

function walk(
  value: unknown,
  ctx: PayLinkContext,
  out: { minted: string[]; dropped: string[] },
  seen: Set<object>,
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      out.dropped.push('card:cycle');
      return DROP;
    }
    seen.add(value);
    const kept = value
      .map((item) => walk(item, ctx, out, seen))
      .filter((item) => item !== DROP);
    seen.delete(value);
    return kept;
  }

  if (!isObj(value)) return value; // string / number / bool / null — nothing to do.

  if (seen.has(value)) {
    out.dropped.push('card:cycle');
    return DROP;
  }
  seen.add(value);

  const tag = readTag(value);
  if (tag) {
    const patch = resolveTag(tag.name, tag.field, ctx);
    if (patch === null) {
      seen.delete(value);
      // The reason line names the tag, because the two causes need telling apart
      // by whoever reads the log: `paylink.retry` = pruned BY DESIGN (no resume);
      // anything else = the card asks for a tag this version cannot mint.
      out.dropped.push(`paylink.${tag.name}`);
      return DROP;
    }
    out.minted.push(`paylink.${tag.name}`);
    /* [FEAT-20260902-ADMINPOSTBACK] the authored field is REMOVED before the
       patch is applied, not overwritten by it. A tag authored in `text` that
       mints into `data` would otherwise leave the raw `{{paylink.…}}` string
       sitting in `action.text` next to the new payload — and LINE reads `text`
       on a message action, so the customer would post the literal tag. Deleting
       first makes the rewrite total: whatever the patch does not set is gone.
       Every OTHER key the operator drew (label, colour, style) is preserved. */
    const carried = { ...(value['action'] as Node) };
    delete carried[tag.field];
    const action = { ...carried, ...patch };
    const rebuilt: Node = { ...value, action };
    seen.delete(value);
    return rebuilt;
  }

  const rebuilt: Node = {};
  for (const [key, child] of Object.entries(value)) {
    const next = walk(child, ctx, out, seen);
    if (next !== DROP) rebuilt[key] = next;
  }
  seen.delete(value);

  // Bottom-up prune: this container lost its last child ⇒ it is now invalid flex,
  // so it goes too (recursively, because its own parent is still being built).
  // `type` is only trusted when it is really a string — a malformed card must not
  // be coerced into matching (or into an `[object Object]` reason line).
  const contents = rebuilt['contents'];
  const type = typeof rebuilt['type'] === 'string' ? rebuilt['type'] : '';
  if (
    Array.isArray(contents) &&
    contents.length === 0 &&
    EMPTY_CONTENTS_INVALID.has(type) &&
    !isDeliberateSpacer(rebuilt)
  ) {
    out.dropped.push(`empty:${type}`);
    return DROP;
  }

  return rebuilt;
}

/**
 * Mint `{{paylink.*}}` into an admin-authored card.
 *
 * @param contentJson the card as stored in `flex_messages.content_json`.
 * @param ctx `resume` present ⇒ the retry button works; absent ⇒ it is removed.
 * @returns a NEW structure plus what was minted and what was dropped. The input
 *   object is never touched, because the same stored card is reused for the next
 *   customer and must not carry this run's payload.
 *
 * NEVER THROWS. A card that cannot be walked (cyclic, or anything unexpected)
 * comes back exactly as it arrived with a `dropped` note: on the money path a
 * card with visible braces is a bug someone reports, while a thrown error is a
 * customer who paid and got no reply at all. เส้นทางเงินห้าม throw.
 */
export function mintPayLinks(
  contentJson: unknown,
  ctx: PayLinkContext = {},
): MintPayLinksResult {
  const out = { minted: [] as string[], dropped: [] as string[] };
  try {
    const contents = walk(contentJson, ctx, out, new Set());
    // The ROOT itself resolving to DROP means the whole card was pruned away (a
    // card that is nothing but a dead button, or a cycle at the top). Sending
    // nothing is not an option, so hand the original back untouched.
    if (contents === DROP) {
      return {
        contents: contentJson,
        minted: [],
        dropped: [...out.dropped, 'card:unrenderable'],
      };
    }
    return { contents, minted: out.minted, dropped: out.dropped };
  } catch (err) {
    return {
      contents: contentJson,
      minted: [],
      dropped: [`card:mint_failed:${(err as Error)?.message ?? 'unknown'}`],
    };
  }
}

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { render as renderFlex } from 'flex-render';
import 'flex-render/css';

/**
 * [FEAT-20260809-FLEXRENDER] Spec-accurate LINE Flex renderer (single source of truth).
 *
 * WHAT
 *   Renders a LINE Flex JSON (bubble | carousel | {type:'flex'} envelope) to HTML using
 *   `flex-render`, which implements the official LINE Flex layout spec, then sanitises the
 *   HTML before it reaches the DOM. Used by BOTH the chat room and the template preview
 *   modal so "what you design" === "what the customer sees" === "what LINE renders".
 *
 * WHY (measured on this project's real data, not a guess)
 *   The previous hand-rolled renderer (`renderFlexNode` in FlexSlipCard.tsx) covered only
 *   7 of ~11 LINE component types and ignored several layout properties outright. Scanning
 *   all 151 rows of `flex_messages` found 16 templates that render WRONG today:
 *     - layout:"baseline"      413 uses / 11 templates  → text never sits on a shared
 *                                                          baseline (this is the single
 *                                                          biggest cause of "เพี้ยนไปเลย")
 *     - spacing xs|xl|xxl      148 uses /  9 templates  → collapsed to 0px
 *     - bubble.styles           36 uses / 10 templates  → per-block background ignored
 *     - carousel                11 uses / 11 templates  → only the FIRST bubble was drawn;
 *                                                          the rest vanished silently
 *     - maxLines                 3 uses /  1 template   → no line clamping
 *   Worst offenders are customer-facing: the coin point-round card (110 baseline), bonus-ref-1 (95),
 *   dep-with-1 (76). The slip templates used by payment (flex_error, flex_not_found,
 *   flex_Other) are all carousel + styles.
 *
 * SECURITY — DO NOT REMOVE THE SANITISE STEP (two independent holes, both closed here)
 *   `flex-render` returns an HTML *string*, so it must be injected via
 *   dangerouslySetInnerHTML, which bypasses React's automatic escaping. Two verified
 *   problems make sanitising mandatory, not optional hardening:
 *     1. flex-render does NOT escape text nodes. `content_json` is operator-editable
 *        through the web UI, so raw template text would execute as markup in an
 *        authenticated admin's browser (stored XSS → token theft on mere chat-room open).
 *     2. flex-render EMITS `onclick="…"` itself for message/postback actions, inlining
 *        action text into a JS string. Scanning this project's 151 real templates showed
 *        `onclick` in the generated markup — i.e. hole (2) is reached by ordinary data,
 *        not just by a crafted payload.
 *   DOMPurify + the allow-list below closes both. Verified by test: inline onclick,
 *   `<img onerror>` and `javascript:` URIs are all stripped, while Thai text, colours and
 *   baseline layout survive intact, and no <div> is lost across all 151 templates.
 *   ห้ามถอด DOMPurify ออก — ถอดเมื่อไหร่ = เปิดช่อง XSS ในหน้าแอดมินทันที.
 *
 *   TRADE-OFF (deliberate): stripping `onclick` also disables in-preview button clicks.
 *   That is correct here — this component RENDERS what the customer will see; it is not an
 *   interactive LINE client. Never restore interactivity by allowing `on*` attributes;
 *   if buttons must act, parse `action` from the JSON and attach a React handler instead.
 *
 * HOW TO CHANGE LATER
 *   - Allow a new tag/attribute: extend PURIFY_CONFIG below. Keep it a strict allow-list;
 *     never switch to a deny-list, and never allow 'on*' event attributes.
 *   - Restyle the bubble frame: edit the wrapper <div> class here only.
 *   - revert: see USE_FLEX_RENDER in FlexSlipCard.tsx / FlexPreviewModal.tsx — flipping it
 *     to false restores the legacy renderer, which is still present and untouched.
 */

/**
 * Strict allow-list. Flex output is plain layout markup — div/span/p/img/a plus inline
 * style and class. Anything outside this (script, iframe, form, event handlers) is dropped.
 * ALLOWED_ATTR deliberately omits every `on*` handler, so `onerror=`/`onclick=` payloads
 * cannot survive even if a future library version emits them.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['div', 'span', 'p', 'img', 'a', 'br', 'video', 'source'],
  // [FEAT-20260817-ADMINBTNLINK] `target`/`rel` added for the admin-side button
  // links below. Still no `on*` — the link is a plain href, not a handler.
  ALLOWED_ATTR: ['class', 'style', 'src', 'href', 'dir', 'alt', 'poster', 'type', 'target', 'rel'],
  // Block javascript:/data: URIs in href/src — only real web/image schemes pass.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):|^\//i,
  // Not `as const`: DOMPurify's Config types these as mutable string[], so a readonly
  // tuple fails to typecheck. Treat the arrays as append-only by convention instead.
};

/**
 * ==== [FEAT-20260817-ADMINBTNLINK] make the buttons clickable FOR THE ADMIN ====
 *
 * THE PROBLEM: a card's buttons are `postback` / `message` actions. flex-render
 * emits those as `<a onclick="alert(…)">` with NO href, and the sanitiser above
 * strips every `on*` — correctly, that is the XSS guard. So in the ticket-support
 * chat an admin sees buttons that do nothing when clicked.
 *
 * THE FIX, and why it does not weaken the guard: the ACTIONS are rewritten to
 * `uri` actions on a COPY of the JSON before rendering, so flex-render itself
 * emits a real `<a target="_blank" href="…">`. An href survives the allow-list;
 * no handler is ever restored. The file's security rule — "never allow on*" —
 * still holds exactly as written.
 *
 * WHAT IT DOES NOT TOUCH: the customer's card. This is a render-time decision in
 * the dashboard only; nothing about the message sent to LINE changes, and the
 * postback the customer taps still resumes the payment run.
 * ลูกค้ากดใน LINE ได้เหมือนเดิม · แอดมินกดในแดชบอร์ดเปิดลิงก์
 *
 * OPT-IN by design: only a caller passing `linkButtonsTo` is affected, so the
 * flex DESIGNER preview keeps showing the customer's card untouched.
 *
 * revert: delete this block, the `linkButtonsTo` prop and its use below, plus
 * `target`/`rel` from ALLOWED_ATTR.
 */
/* [FEAT-20260817-ADMINBTNLINK] flex-render emits `target="_blank"` but no `rel`,
   and a blank-target link without `noopener` hands the new page a handle on this
   one (reverse tabnabbing). Modern browsers imply noopener, but the dashboard is
   an authenticated admin surface — state it explicitly rather than rely on the
   default. DOMPurify's documented afterSanitizeAttributes hook is the right place:
   it runs on the sanitiser's own output, so nothing can bypass it.
   Registered once at module load, not per render. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element) || node.tagName !== 'A') return;
  const href = node.getAttribute('href') || '';
  if (!/^https?:/i.test(href)) return;
  // Set BOTH here rather than trusting the renderer: flex-render emits `target`
  // for a uri action but the sanitiser drops it, and relying on either one's
  // behaviour is how this would silently regress. `afterSanitizeAttributes` is
  // DOMPurify's last step, so what we set here is what ships.
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

const linkifyActions = (node: any, uri: string): any => {
  if (Array.isArray(node)) return node.map((n) => linkifyActions(n, uri));
  if (!node || typeof node !== 'object') return node;
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    // `action` is the only member LINE uses for taps, at any depth (button, box,
    // image, text all accept one), so rewriting it by key covers every case.
    out[k] =
      k === 'action' && v && typeof v === 'object'
        ? { type: 'uri', label: (v as any).label ?? '', uri }
        : linkifyActions(v, uri);
  }
  return out;
};

interface FlexBubbleProps {
  /** LINE Flex JSON: a bubble, a carousel, or a {type:'flex', contents:…} envelope. */
  json: any;
  className?: string;
  /**
   * [FEAT-20260817-ADMINBTNLINK] When set, every tappable action is rendered as a
   * link to this URL for the admin looking at the card. Omit for a faithful
   * preview of what the customer sees.
   */
  linkButtonsTo?: string;
}

export const FlexBubble: React.FC<FlexBubbleProps> = ({
  json,
  className,
  linkButtonsTo,
}) => {
  const html = useMemo(() => {
    if (!json) return '';
    try {
      // flex-render accepts the bare container; unwrap the messaging envelope if present
      // so callers can hand us either shape without pre-processing.
      const raw = json?.type === 'flex' && json?.contents ? json.contents : json;
      // [FEAT-20260817-ADMINBTNLINK] on a COPY — the caller's object is never mutated
      const container = linkButtonsTo ? linkifyActions(raw, linkButtonsTo) : raw;
      return DOMPurify.sanitize(renderFlex(container), PURIFY_CONFIG);
    } catch (err) {
      // A malformed template must never blank the chat room — degrade to nothing and let
      // the caller's fallback (legacy card) show instead.
      console.error('[FlexBubble] render failed:', err);
      return '';
    }
  }, [json, linkButtonsTo]);

  if (!html) return null;

  return (
    <div
      className={className}
      // Safe: `html` is DOMPurify output produced immediately above under PURIFY_CONFIG.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/** Probe used by callers to decide between the new renderer and the legacy fallback. */
export const canRenderFlex = (json: any): boolean => {
  if (!json) return false;
  const c = json?.type === 'flex' && json?.contents ? json.contents : json;
  return c?.type === 'bubble' || c?.type === 'carousel';
};

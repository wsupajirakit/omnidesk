import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ReplyTarget,
  type ReplyBlockReason,
  replyBlockedBy,
} from './replyTarget';

/**
 * The one owner of "which message am I replying to".
 * ===========================================================================
 * WHY A HOOK AND NOT STATE IN THE PAGE
 *   Reply is going to grow (owner: "reply จะถูกใช้อีก"), and the page that hosts
 *   the composer is already 4,600 lines. Every rule that decides whether a reply
 *   exists lives here, so a second page can adopt the feature by calling this
 *   and rendering two components — no rule is ever copied.
 *
 * WHAT IT GUARANTEES
 *   • a reply and an attachment never coexist — asking for one while something
 *     is attached is REFUSED and reported; attaching afterwards CANCELS it;
 *   • the refusal reason is state, not a callback, so the host renders whatever
 *     dialog it likes without this file knowing about modals;
 *   • switching room clears everything (`reset`), because a quote from another
 *     conversation would be nonsense.
 *
 * UI ONLY at this point: nothing here sends, and no BE field is involved.
 *
 * revert: delete this file and the three call sites in TicketChat.
 */
export interface ReplyDraft {
  /** the message being replied to, or null */
  target: ReplyTarget | null;
  /** why the last request was refused; null = nothing to report */
  blockedBy: ReplyBlockReason;
  /** ask to reply to a message — refused (and reported) while an attachment waits */
  requestReply: (target: ReplyTarget) => boolean;
  /** the ✕ on the preview bar */
  cancel: () => void;
  /** dismiss the refusal dialog */
  dismissBlocked: () => void;
  /** drop everything — call when the open conversation changes */
  reset: () => void;
}

export function useReplyDraft(attachments: {
  hasImages?: boolean;
  hasSticker?: boolean;
}): ReplyDraft {
  const [target, setTarget] = useState<ReplyTarget | null>(null);
  const [blockedBy, setBlockedBy] = useState<ReplyBlockReason>(null);

  // Read inside `requestReply` without making the callback change identity on
  // every keystroke that touches the attachment lists.
  const attachRef = useRef(attachments);
  attachRef.current = attachments;

  const requestReply = useCallback((next: ReplyTarget) => {
    const reason = replyBlockedBy(attachRef.current);
    if (reason) {
      setBlockedBy(reason);
      return false;
    }
    setTarget(next);
    return true;
  }, []);

  const cancel = useCallback(() => setTarget(null), []);
  const dismissBlocked = useCallback(() => setBlockedBy(null), []);
  const reset = useCallback(() => { setTarget(null); setBlockedBy(null); }, []);

  // The other direction: something got attached while a reply was open → drop
  // the reply. Silent on purpose; the bar disappearing IS the feedback.
  const blocked = replyBlockedBy(attachments);
  useEffect(() => {
    if (blocked) setTarget(null);
  }, [blocked]);

  return { target, blockedBy, requestReply, cancel, dismissBlocked, reset };
}

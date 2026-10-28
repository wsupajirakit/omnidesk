/**
 * [FIX-20260830-HEADERDUP] the chat-room header's top line, de-duplicated.
 *
 * Owner 30/08: the line read `dev_User-2 | dev_User-2` when two of its values
 * happened to be the same text. The RULES for whether each segment shows are
 * untouched (owner: "ห้ามเปลี่ยนเงื่อนไข — มันอาจจะไม่ซ้ำก็ได้"); the ONE new
 * rule is: a segment whose text has already been shown on the line is skipped.
 *
 * Pure and tiny so it is testable without mounting ChatRoomView. The original
 * conditions, carried verbatim:
 *   1. first  = headerTitle, else customerName(user_data)   (always shows)
 *   2. full_name shows when present AND !== headerTitle     (existing rule)
 *   3. nickname shows when present                          (existing rule)
 * …each now ALSO skipped when equal to any text already on the line.
 *
 * revert: delete this file and inline the three original JSX conditions back
 *         into ChatRoomView's header row (tag FEAT-20260729-FULLNAME).
 */

export interface HeaderNameInput {
  headerTitle?: string;
  /** the first segment as the JSX computes it: headerTitle || customerName(...) */
  first: string;
  full_name?: string | null;
  nickname?: string | null;
}

/** The texts to render, in order — index 0 is the title span, the rest follow a `|`. */
export function headerNameParts(input: HeaderNameInput): string[] {
  const parts: string[] = [input.first];

  const fullName = input.full_name;
  if (
    fullName &&
    fullName !== input.headerTitle && // the pre-existing rule, verbatim
    !parts.includes(fullName) // the new de-dup: never repeat what is shown
  ) {
    parts.push(fullName);
  }

  const nickname = input.nickname;
  if (nickname && !parts.includes(nickname)) {
    parts.push(nickname);
  }

  return parts;
}

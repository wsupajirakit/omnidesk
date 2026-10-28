/**
 * Ask a model to pull a phone number and a bank account out of what a customer
 * wrote. Returns what it found. Does nothing with it.
 * ===========================================================================
 * ⚠️ IMPORTS NOTHING, ON PURPOSE. The model is handed in as a function, so this
 * file knows no vendor, no HTTP client, no Nest and no webhook — the caller owns
 * all of that. It can be run from a cron, a CLI or a test by passing a stub, and
 * deleting it changes nothing else. ไม่ผูกกับใครเลย · ฉีดฟังก์ชันเข้ามา.
 *
 * ⚠️ TAKES A LIST OF MESSAGES FROM DAY ONE even though the caller passes one.
 * The owner said the input may later become a stretch of conversation history;
 * accepting an array now means that change is a caller-side change only, not a
 * new signature and a migration of every call site. รับเป็น list ไว้ก่อน.
 *
 * ⚠️ NEVER THROWS. A model that is unavailable, slow, or answers in prose is an
 * ordinary outcome here, not an error: this runs beside a customer conversation
 * that has already been answered. ล้มก็เงียบ คืน found=false.
 *
 * The wording lives in `build-member-info.prompt.ts` and can be edited without
 * touching this file.
 *
 * revert: delete this file and its call in `register.helper.ts`.
 */
import {
  BUILD_MEMBER_INFO_PROMPT,
  MEMBER_INFO_FIELDS,
} from './build-member-info.prompt';

/**
 * The one thing this needs from the outside: something that answers a question.
 *
 * Structural on purpose — it matches the project's `AiReplyProvider.generate`
 * without importing it, so this file stays free of the AI module entirely.
 */
export type MemberInfoGenerate = (request: {
  question: string;
  docText: string;
  suggestionText: string;
  profileData: Record<string, unknown> | null;
}) => Promise<{ text?: string | null } | null | undefined>;

export interface BuildMemberInfoInput {
  /** What the customer wrote. One message today, a history slice later. */
  messages: string[];
}

export interface BuildMemberInfoDeps {
  generate: MemberInfoGenerate;
  warn: (msg: string) => void;
}

export interface MemberInfoResult {
  /** Did the model return usable JSON with at least one field filled in? */
  found: boolean;
  phoneNumber: string | null;
  accountNo: string | null;
}

const NOTHING: MemberInfoResult = {
  found: false,
  phoneNumber: null,
  accountNo: null,
};

/**
 * Pull the JSON object out of an answer that may be wrapped in prose or fences.
 *
 * Models are asked for bare JSON and usually give it; when they do not, the
 * object is still in there. Taking the first `{`…`}` is enough and cannot throw.
 */
function parseAnswer(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A value the model may have filled in, normalised, or null. */
function field(bag: Record<string, unknown>, key: string): string | null {
  const raw = bag[key];
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned || cleaned.toLowerCase() === 'null') return null;
  return cleaned;
}

export async function buildMemberInfo(
  input: BuildMemberInfoInput,
  deps: BuildMemberInfoDeps,
): Promise<MemberInfoResult> {
  const messages = (input?.messages ?? []).filter(
    (m) => typeof m === 'string' && m.trim(),
  );
  if (!messages.length || typeof deps?.generate !== 'function') return NOTHING;

  try {
    const answer = await deps.generate({
      // the conversation is the question; the instruction is the training text,
      // which is where this project already puts "how to answer"
      question: messages.join('\n'),
      docText: '',
      suggestionText: BUILD_MEMBER_INFO_PROMPT,
      profileData: null,
    });
    const text = String(answer?.text ?? '');
    const bag = text ? parseAnswer(text) : null;
    if (!bag) return NOTHING;

    const [phoneKey, accountKey] = MEMBER_INFO_FIELDS;
    const phoneNumber = field(bag, phoneKey);
    const accountNo = field(bag, accountKey);
    return {
      found: !!(phoneNumber || accountNo),
      phoneNumber,
      accountNo,
    };
  } catch (err) {
    deps.warn(
      `[REGISTER] build member info skipped: ${(err as Error)?.message}`,
    );
    return NOTHING;
  }
}

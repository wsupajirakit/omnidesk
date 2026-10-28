/**
 * [FEAT-20260822-BCASTMATRIX] type × sub-type — how each combination sends,
 * and what it is allowed to do.
 * ===========================================================================
 * เจ้าของ 22/08: "เราต้อง dynamic ตาม type + sub type … อิสระแยกส่วน ปรับเงื่อนไขได้ แต่ต้องมี".
 *
 *   send_kind (type)     : broadcast | multicast   — which LINE endpoint
 *   card type (sub-type) : plain | personal        — what the admin ticked
 *
 * One cell per combination. Adding a combination = adding one entry; tuning a
 * combination = editing its numbers. Neither touches the runner, which only
 * ever reads the cell it was handed. เพิ่ม/แก้ = 1 entry ตัวส่งไม่ต้องแก้.
 *
 * 🔴 ONE COMBINATION IS IMPOSSIBLE, NOT MERELY EXPENSIVE:
 *   broadcast + personal — `/message/broadcast` hands the message to LINE and
 *   LINE fans it out to every friend. We never learn who they are, so there is
 *   nobody to personalise FOR. Its cell is `allowed: false` and the caller must
 *   refuse, never "send it anyway with N/A". (แผน §V.11.5)
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import {
  LINE_MULTICAST_MAX_TO,
  MAX_PARALLEL_OA,
  MAX_REQUESTS_PER_RUN,
} from './limits';
import { SEND_PROFILES, type SendProfile } from './send-profile.registry';

export type SendKind = 'broadcast' | 'multicast';
export type CardType = 'plain' | 'personal';

export interface SendCell {
  readonly sendKind: SendKind;
  readonly cardType: CardType;
  readonly label_th: string;
  /** false ⇒ the caller must refuse with `reason`; nothing is sent. */
  readonly allowed: boolean;
  readonly reason?: string;
  /** How many recipients ride in one request. 0 = recipients are not addressed. */
  readonly recipientsPerRequest: number;
  /** Recipients allowed FOR ONE OA. null = not applicable (broadcast). */
  readonly maxRecipientsPerOa: number | null;
  /** OAs one job may target under this combination. */
  readonly maxHooks: number;
  /** OAs sent to at the same time. Per cell, because the cost per OA differs. */
  readonly maxParallelOa: number;
  readonly allowsTags: readonly string[];
}

const plain: SendProfile = SEND_PROFILES.plain;
const personal: SendProfile = SEND_PROFILES.personal;

/**
 * ⚠️ `maxHooks` is a POLICY number, not a measured one — it bounds how wide one
 * job may reach, which is a blast-radius question, not a performance one. The
 * performance bound is depth (`run-plan.ts`), and it applies on top.
 */
const CELLS = {
  'broadcast:plain': {
    sendKind: 'broadcast',
    cardType: 'plain',
    label_th: 'ประกาศทั้ง OA (ไม่ระบุตัวคน)',
    allowed: true,
    // LINE fans out; one request per OA regardless of how many friends it has.
    recipientsPerRequest: 0,
    maxRecipientsPerOa: null,
    maxHooks: 20,
    maxParallelOa: MAX_PARALLEL_OA,
    allowsTags: plain.allows_tags,
  },
  'broadcast:personal': {
    sendKind: 'broadcast',
    cardType: 'personal',
    label_th: 'ประกาศทั้ง OA + การ์ดรายคน',
    allowed: false,
    reason:
      'ท่อ broadcast ไม่รู้จักผู้รับเป็นรายคน จึงใส่ค่ารายคนไม่ได้ — ' +
      'ถ้าต้องการค่ารายคนให้ใช้ท่อ multicast',
    recipientsPerRequest: 0,
    maxRecipientsPerOa: null,
    maxHooks: 0,
    maxParallelOa: 1,
    allowsTags: plain.allows_tags,
  },
  'multicast:plain': {
    sendKind: 'multicast',
    cardType: 'plain',
    label_th: 'เลือกผู้รับ + การ์ดเหมือนกันทุกคน',
    allowed: true,
    recipientsPerRequest: LINE_MULTICAST_MAX_TO,
    maxRecipientsPerOa: plain.max_recipients,
    maxHooks: 20,
    maxParallelOa: MAX_PARALLEL_OA,
    allowsTags: plain.allows_tags,
  },
  'multicast:personal': {
    sendKind: 'multicast',
    cardType: 'personal',
    label_th: 'เลือกผู้รับ + การ์ดรายคน (ช้าที่สุด)',
    allowed: true,
    recipientsPerRequest: 1,
    maxRecipientsPerOa: personal.max_recipients,
    // 🔴 TWO, and it is arithmetic rather than taste. Each OA here spends a
    // whole budget of depth (300 requests), and OAs run `MAX_PARALLEL_OA` at a
    // time, so waves = ceil(maxHooks / 2) and depth = waves x 300. Anything
    // above 2 is already 600 deep — twice the budget. `cellFitsBudget` pins it.
    // (Was 5, which review exposed once MAX_PARALLEL_OA came down to 2.)
    maxHooks: 2,
    maxParallelOa: MAX_PARALLEL_OA,
    allowsTags: personal.allows_tags,
  },
} satisfies Record<string, SendCell>;

export const SEND_MATRIX = CELLS;

/**
 * Build the table key. Non-strings give `null` rather than `[object Object]` —
 * the same `String(unknown)` trap `retry-key.ts` documents. (review)
 */
export function cellKey(sendKind: unknown, cardType: unknown): string | null {
  if (typeof sendKind !== 'string' || typeof cardType !== 'string') return null;
  return `${sendKind}:${cardType}`;
}

/** Unknown combination ⇒ null. Callers decide; this file never throws. */
export function resolveSendCell(
  sendKind: unknown,
  cardType: unknown,
): SendCell | null {
  const key = cellKey(sendKind, cardType);
  if (key === null) return null;
  const table = CELLS as Record<string, SendCell | undefined>;
  return table[key] ?? null;
}

/** Cells the UI may offer — the impossible one is listed but marked. */
export function listSendCells(): SendCell[] {
  return Object.values(CELLS);
}

/** Requests one OA costs under this cell. */
export function requestsPerOaFor(cell: SendCell, recipients: number): number {
  if (!cell.allowed) return 0;
  if (cell.recipientsPerRequest === 0) return 1; // broadcast: one per OA
  const n = Math.max(0, Math.trunc(recipients));
  if (n === 0) return 0;
  return Math.ceil(n / cell.recipientsPerRequest);
}

/** Sanity the spec pins: no cell may promise more depth than the budget allows. */
export function cellFitsBudget(cell: SendCell): boolean {
  if (!cell.allowed) return true;
  const worstPerOa = requestsPerOaFor(cell, cell.maxRecipientsPerOa ?? 0);
  const waves = Math.ceil(cell.maxHooks / Math.max(1, cell.maxParallelOa));
  return waves * worstPerOa <= MAX_REQUESTS_PER_RUN;
}

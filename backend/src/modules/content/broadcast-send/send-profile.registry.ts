/**
 * [FEAT-20260822-BCASTPROFILE] Send profiles — the card TYPE the admin ticks,
 * and the ceiling that type carries.
 * ===========================================================================
 * ทะเบียน — เพิ่มชนิดใหม่ = เพิ่ม 1 entry · แก้เพดาน = แก้ตัวเลขในนี้ · ตัวส่งไม่ต้องแก้.
 *
 * The admin picks the type when binding a flex to a job (owner, 2026-08-22).
 * The system does NOT infer it — but it DOES verify the gift cards the tick
 * (see `needs-per-recipient.ts`), because ticking "plain" on a card that reads
 * per-recipient values sends successfully and shows every customer `N/A` where
 * their own name belongs.
 *
 * WHY THE TWO CEILINGS DIFFER BY 33x — it is not about people, it is about
 * requests to LINE:
 *   plain    → one request carries 500 recipients
 *   personal → one request carries 1 recipient (each body differs)
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import { LINE_MULTICAST_MAX_TO, MAX_REQUESTS_PER_RUN } from './limits';

export interface SendProfile {
  /** Stored on the job. NEVER rename once real jobs carry it. */
  readonly key: string;
  readonly label_th: string;
  readonly label_en: string;
  /** true = the body differs per person ⇒ one request per recipient. */
  readonly per_recipient: boolean;
  /** Recipients this profile accepts in ONE run. */
  readonly max_recipients: number;
  /** Requests this profile may spend in ONE run (never above the global budget). */
  readonly max_requests: number;
  /**
   * Tag families a card of this type may use.
   * ⚠️ This is also the gate that keeps `member.*` off cards read by other
   *    paths, which know nothing about it (answers D41).
   */
  readonly allows_tags: readonly string[];
  /** Set true instead of deleting an entry that live jobs still reference. */
  readonly deprecated?: boolean;
}

const PLAIN_TAGS = ['hook_*', 'site_rules.*', 'content_tags'] as const;

/**
 * ⚠️ `satisfies` rather than a `Record<string, SendProfile>` annotation: it
 * still checks every entry against the interface, but keeps the exact keys, so
 * `SEND_PROFILES.plain` is a SendProfile and not `SendProfile | undefined`.
 * Dynamic lookups go through `getSendProfile`, which handles the unknown key.
 */
const PROFILES = {
  plain: {
    key: 'plain',
    label_th: 'การ์ดธรรมดา (ไม่ดึงข้อมูลรายคน)',
    label_en: 'Plain card',
    per_recipient: false,
    // Owner-set (2026-08-22). Uses only 20 of the 300-request budget at this
    // size, so there is ~93% head-room if it is ever raised.
    max_recipients: 10_000,
    max_requests: MAX_REQUESTS_PER_RUN,
    allows_tags: PLAIN_TAGS,
  },
  personal: {
    key: 'personal',
    label_th: 'การ์ดมีคิวรี่ (ดึงข้อมูลรายคน)',
    label_en: 'Personalised card',
    per_recipient: true,
    // One request per person ⇒ the recipient ceiling IS the request budget.
    max_recipients: MAX_REQUESTS_PER_RUN,
    max_requests: MAX_REQUESTS_PER_RUN,
    allows_tags: [...PLAIN_TAGS, 'member.*', 'profile.*'],
  },
} satisfies Record<string, SendProfile>;

export const SEND_PROFILES = PROFILES;

export const DEFAULT_SEND_PROFILE = 'plain';

/** Unknown key ⇒ null. Callers decide; this file never throws. */
export function getSendProfile(key: unknown): SendProfile | null {
  if (typeof key !== 'string') return null;
  const table = PROFILES as Record<string, SendProfile | undefined>;
  return table[key] ?? null;
}

/** Profiles the UI may offer (deprecated ones stay usable but unlisted). */
export function listSelectableProfiles(): SendProfile[] {
  return (Object.values(PROFILES) as SendProfile[]).filter(
    (p) => !p.deprecated,
  );
}

/** How many LINE requests `recipients` will cost under this profile. */
export function requestsFor(profile: SendProfile, recipients: number): number {
  const n = Math.max(0, Math.trunc(recipients));
  if (n === 0) return 0;
  return profile.per_recipient ? n : Math.ceil(n / LINE_MULTICAST_MAX_TO);
}

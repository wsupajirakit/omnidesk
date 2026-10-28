/**
 * [FEAT-20260823-BCASTCARDTYPE] Per-recipient values, loaded ONE PAGE AT A TIME.
 * ===========================================================================
 * 🔴 THIS FILE EXISTS TO NOT BE AN N+1.
 *
 *    `RecipientVarSource.varsFor` is SYNCHRONOUS on purpose — a builder cannot
 *    await inside a render — so the values have to be in memory before the
 *    chunk is built. The obvious shape (look the member up when the card is
 *    rendered) is impossible for that reason, and the next-obvious one (await
 *    per recipient before each send) would be one `members` read per person on
 *    a path that already costs one LINE request per person.
 *
 *    `prefetch` is called ONCE PER PAGE by the executor, with the page's whole
 *    id list, and does one `$in`. A page is `MEMBER_PAGE_SIZE` recipients, so
 *    a 10,000-person run reads `members` twenty times, not ten thousand.
 *    โหลดต่อหน้า ไม่ใช่ต่อคน — ไม่งั้นยิงหนึ่งครั้งอ่านหนึ่งครั้ง.
 *
 * 🔴 AND IT FORGETS THE PREVIOUS PAGE. Keeping every page would grow with the
 *    audience — the exact thing `chunk.ts` bounds its de-dupe set to avoid.
 *    A recipient is rendered while their page is loaded and never again.
 *    ลืมหน้าเก่า ไม่งั้นหน่วยความจำโตตามจำนวนผู้รับ.
 *
 * ⚠️ A RECIPIENT WITH NO ROW RENDERS NOTHING. `varsFor` answers `null`, and
 *    `PersonalCardMessageBuilder` turns that into a refused chunk rather than
 *    a card addressed with somebody else's values. Loud beats wrong.
 *
 * ⚠️ Field names read from the real schemas, not remembered:
 *    `members.line_user_id` / `members.raw_profile_data`
 *    (`chat/schemas/member.schema.ts`) and `MEMBER_COLUMNS`
 *    (`broadcast-var/read/build-broadcast-vars.ts:37`).
 *
 * revert: delete this file, drop it from `adapters/index.ts`, and stop passing
 * a source to `PersonalCardMessageBuilder`.
 */
import {
  MEMBER_COLUMNS,
  buildBroadcastVars,
  type TranslateFn,
} from '../../broadcast-var';
import type { RecipientVarSource } from './card-message.builder';

/** The one read this reader performs, injected so the file stays pure. */
export interface RecipientRowReader {
  /** One `$in` on `members`, keyed by `line_user_id`. */
  findMembersByLineIds(
    lineUserIds: readonly string[],
    columns: Record<string, 1>,
  ): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/** Only these leave `members` — a card needs names, not the whole row. */
export const RECIPIENT_VAR_COLUMNS: Record<string, 1> = {
  line_user_id: 1,
  raw_profile_data: 1,
  ...Object.fromEntries(MEMBER_COLUMNS.map((c) => [c, 1 as const])),
};

export interface RecipientVarsInput {
  readonly reader: RecipientRowReader;
  readonly translate: TranslateFn;
  /** The OA's row — `hook_*` and `site_rules.*` are the same for everyone. */
  readonly hook: Record<string, unknown> | null;
  readonly storedSiteRules: unknown;
}

/**
 * A source the executor refills page by page.
 *
 * Not a cache: `prefetch` REPLACES what it holds. Two pages are never in
 * memory at once, so the footprint is one page however large the audience is.
 */
export class PagedRecipientVarSource implements RecipientVarSource {
  private page: Map<string, Readonly<Record<string, string>>> = new Map();

  constructor(private readonly input: RecipientVarsInput) {}

  /** How many recipients the current page holds. For a health line and specs. */
  get loaded(): number {
    return this.page.size;
  }

  /**
   * Load exactly these recipients, forgetting whatever came before.
   *
   * Never throws: a read that fails leaves the page EMPTY, so every recipient
   * on it answers `null` and their chunks are refused. A campaign that cannot
   * read its members must not send cards full of `N/A` to real customers —
   * that is worse than sending nothing and saying so.
   * อ่านไม่ได้ = ไม่ส่ง ไม่ใช่ส่งการ์ดว่างเปล่า.
   */
  async prefetch(lineUserIds: readonly string[]): Promise<void> {
    this.page = new Map();
    if (lineUserIds.length === 0) return;

    let rows: ReadonlyArray<Record<string, unknown>>;
    try {
      rows = await this.input.reader.findMembersByLineIds(
        lineUserIds,
        RECIPIENT_VAR_COLUMNS,
      );
    } catch {
      return;
    }

    for (const row of rows) {
      const id = row['line_user_id'];
      if (typeof id !== 'string' || id === '') continue;
      this.page.set(
        id,
        buildBroadcastVars({
          storedProfile: row['raw_profile_data'],
          storedSiteRules: this.input.storedSiteRules,
          member: row,
          hook: this.input.hook,
          translate: this.input.translate,
        }),
      );
    }
  }

  varsFor(lineUserId: string): Readonly<Record<string, string>> | null {
    return this.page.get(lineUserId) ?? null;
  }
}

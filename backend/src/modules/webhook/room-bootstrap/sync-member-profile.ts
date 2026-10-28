/**
 * [PROG-20260905-C3] Member sync + LINE profile upsert, lifted out of the spine.
 *
 * WHAT IT DOES, unchanged from the block it replaces: look the member up, refresh the
 * cached LINE profile when it is missing or older than an hour, upsert what came back,
 * re-read the row when the member was brand new, and fall back to the stored row when
 * LINE gave nothing. Every failure is swallowed and logged — a profile lookup must never
 * cost the customer their reply.
 *
 * WHY THE COLLABORATORS ARRIVE AS ARROWS RATHER THAN MODELS. This is the one shape the
 * extraction is allowed to take, and it is not a style choice:
 * `z-test/unit/member-user-id-index.spec.ts` asserts that `webhook.service.ts` still
 * contains `findOne({ member_user_id` — it is how the repo proves the index it pays for
 * is still being used by the live path. Moving the query itself out empties the file of
 * that literal and turns the spec red for a change that altered no behaviour. Keeping the
 * queries at the call site, behind arrows, preserves the proof AND the extraction.
 * A future reader "simplifying" this to take the model directly will redden that spec;
 * if they do it deliberately, the spec must be re-proved red-first with the new file
 * listed as a caller.
 *
 * ⚠️ THE ORDER OF THE TWO READS IS BEHAVIOUR. The re-read after the upsert exists because
 * a brand-new member has no `_id` until the upsert creates it, and later gates put that
 * `_id` on chat rows. Collapsing the two reads into one leaves those rows without it.
 */

/** The stored member row, as the spine reads it. */
export type MemberRow = Record<string, unknown>;

/** What LINE answers for a profile lookup. */
export interface LineProfile {
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/** The two values the spine reads afterwards. */
export interface MemberProfileSync {
  existingUser: MemberRow | null;
  userProfile: { displayName: string; pictureUrl: string } | null;
}

export interface SyncMemberProfileDeps {
  /** `memberModel.findOne({ member_user_id: userId })` — kept at the call site on purpose. */
  findMember: () => Promise<MemberRow | null>;
  /** `lineApi.getLineProfile(accessToken, userId)`. */
  fetchLineProfile: () => Promise<LineProfile | null>;
  /** `memberModel.updateOne({ line_user_id: userId }, { $set }, { upsert: true })`. */
  upsertMember: (set: Record<string, unknown>) => Promise<void>;
  /** Receives the raw error; the caller formats it, so the log line stays byte-identical. */
  logError: (err: unknown) => void;
}

/** Refresh a cached profile at most once an hour. */
const PROFILE_REFRESH_MS = 3600000; // 1 hour

export async function syncMemberProfile(
  userId: string,
  deps: SyncMemberProfileDeps,
): Promise<MemberProfileSync> {
  let existingUser: MemberRow | null = null;
  let userProfile: MemberProfileSync['userProfile'] = null;

  try {
    existingUser = await deps.findMember();
    const now = Date.now();
    const lastSyncRaw = existingUser?.['last_synced_at'];
    const lastSync = lastSyncRaw
      ? new Date(lastSyncRaw as string).getTime()
      : 0;
    const needsRefresh =
      !existingUser ||
      !existingUser['display_name'] ||
      now - lastSync > PROFILE_REFRESH_MS;

    if (needsRefresh) {
      const freshProfile = await deps.fetchLineProfile();
      if (freshProfile) {
        /* The `$set` shape is byte-for-byte the original, `line_user_id` included: it is
           written into the document the upsert may CREATE, so dropping it would leave a
           new member row without the id every later lookup joins on. */
        const set: Record<string, unknown> = {
          line_user_id: userId,
          display_name: freshProfile.displayName,
          picture_url: freshProfile.pictureUrl,
          status_message: freshProfile.statusMessage,
          last_synced_at: new Date(),
        };
        // Nickname is seeded once and then belongs to the operator.
        if (!existingUser || !existingUser['nickname']) {
          set['nickname'] = freshProfile.displayName;
        }
        await deps.upsertMember(set);
        userProfile = {
          displayName: freshProfile.displayName as string,
          pictureUrl: freshProfile.pictureUrl as string,
        };
        if (!existingUser) {
          // The row exists only now; later gates put its `_id` on chat rows.
          existingUser = await deps.findMember();
        }
      }
    }

    if (!userProfile && existingUser) {
      userProfile = {
        displayName: existingUser['display_name'] as string,
        pictureUrl: existingUser['picture_url'] as string,
      };
    }
  } catch (err) {
    deps.logError(err);
  }

  return { existingUser, userProfile };
}

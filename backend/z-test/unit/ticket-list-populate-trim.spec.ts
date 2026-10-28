/**
 * [PERF-20260826-TKTPOPTRIM] 📖 docs/bottleneck_26_aug.md (S2) — the LIST's
 * member populate stops shipping the columns the trim was built to throw away.
 * ============================================================================
 * WHY. `listTickets` populates `chat_user_id` FULL from Mongo, then
 * `trimListMember` deletes the same eight columns in JS on every row
 * (`list-member-trim.ts` — measured there: 33.7% of the member, 13.9% of the
 * whole response). The bytes still crossed the Mongo→BE wire and sat in the
 * heap first. This pushes the SAME deny-list down into the populate select, so
 * the trim becomes a no-op for those keys — and stays in place as the net.
 *
 * WHY ONLY THE MEMBER-LEVEL KEYS — THE PROFILE HEAVIES STAY IN JS.
 * `trimListProfile` carries `_trimmed` marker semantics: a profile that
 * consisted ONLY of heavy keys must come back as `{_trimmed:true}` so the
 * green ring ("has ANY key") stays lit. A DB-level exclusion would deliver
 * `{}` and the marker could never be computed — the ring would go out with no
 * error anywhere. So `HEAVY_PROFILE_KEYS` must NEVER appear in this
 * projection; that is pinned below.
 * ตัดที่ DB เฉพาะชั้น member · ชั้น profile ต้องตัดใน JS เพราะ marker.
 *
 * WHY THE RESPONSE CANNOT MOVE. Between the populate and the trims nothing
 * reads the excluded columns (`refIdToString` reads `_id`; `formatTicket`
 * passes the doc through), and `trimListMember` removes exactly these keys
 * afterwards — containment is asserted below, and the detail paths
 * (`getTicketById`) are pinned FULL.
 *
 * Harness style copied from `ticket-list-cursor.spec.ts`.
 */
import { Types } from 'mongoose';

import { TicketsService } from '@/modules/tickets';
import {
  LIST_MEMBER_POPULATE_EXCLUSION,
  UNREAD_MEMBER_KEYS,
  trimListMember,
} from '@/modules/tickets/list-member-trim';

const HOOK = 'a0d000000000000000000017';

function stub(rows: Array<Record<string, unknown>>) {
  const populates: Array<[unknown, unknown]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) {
    q[m] = jest.fn((...a: unknown[]) => {
      if (m === 'populate') populates.push([a[0], a[1]]);
      return m === 'lean' ? Promise.resolve(rows) : q;
    });
  }
  const ticketModel = {
    find: jest.fn(() => q),
    findById: jest.fn(() => q),
    countDocuments: jest.fn(() => Promise.resolve(rows.length)),
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
    {
      resolve: () => ({
        tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
      }),
    } as never,
  );
  jest
    .spyOn(service as never, 'resolveScopeHookIds')
    .mockResolvedValue([HOOK] as never);
  jest
    .spyOn(service as never, 'enrichTicketRows')
    .mockImplementation((r: unknown) => Promise.resolve(r) as never);
  return { service, populates };
}

const memberPopulate = (populates: Array<[unknown, unknown]>) =>
  populates.find(([path]) => path === 'chat_user_id');

describe('⭐ the LIST member populate carries the deny-list exclusion', () => {
  it('chat_user_id is populated with exactly the UNREAD_MEMBER_KEYS excluded', async () => {
    const { service, populates } = stub([]);
    await service.listTickets({ job_status: '0,1', limit: 'all' }, HOOK);

    const found = memberPopulate(populates);
    expect(found).toBeDefined();
    expect(found![1]).toBe(LIST_MEMBER_POPULATE_EXCLUSION);

    const terms = String(found![1]).trim().split(/\s+/);
    // exclusion-only: ONE inclusion term would flip Mongo into whitelist mode
    // and every unlisted member column would vanish from the response.
    for (const term of terms) expect(term.startsWith('-')).toBe(true);
    // drift guard: the projection may remove ONLY what the trim removes anyway.
    for (const term of terms) {
      expect(UNREAD_MEMBER_KEYS as readonly string[]).toContain(term.slice(1));
    }
    // ...and all eight are there — the point of pushing the list down.
    expect(terms).toHaveLength(UNREAD_MEMBER_KEYS.length);
  });

  it('⭐ the profile heavies are NOT in the projection — the _trimmed marker needs them in JS', async () => {
    const { service, populates } = stub([]);
    await service.listTickets({ job_status: '0,1', limit: 'all' }, HOOK);

    expect(String(memberPopulate(populates)![1])).not.toContain(
      'raw_profile_data',
    );
  });

  it('the hook and admin populates are untouched', async () => {
    const { service, populates } = stub([]);
    await service.listTickets({ job_status: '0,1', limit: 'all' }, HOOK);

    expect(populates).toContainEqual(['hook_id', 'display_name line_oa_name']);
    expect(populates).toContainEqual([
      'admin_user_id',
      'username display_name email role',
    ]);
  });
});

describe('⭐ detail path stays FULL — only the list projects', () => {
  it('getTicketById populates chat_user_id with NO select', async () => {
    /* the single-ticket endpoints feed PersonalPanel's own fetch and the
       raw-profile route — list-member-trim.ts:47-49 records they must stay
       whole. No _id / line_user_id on the row, so the attached-files and
       assign-history lookups are skipped and no further models are needed. */
    const { service, populates } = stub([{ job_status: 0 }]);
    await service.getTicketById(String(new Types.ObjectId()));

    const found = memberPopulate(populates);
    expect(found).toBeDefined();
    expect(found![1]).toBeUndefined();
  });
});

describe('⭐ containment: the projection removes only what the trim removed anyway', () => {
  const fullMember: Record<string, unknown> = {
    _id: 'm1',
    display_name: 'A',
    nickname: 'B',
    tier: { code: 'vip' },
    raw_profile_data: { profile: { promotion: [1], phone: '08' } },
    ignore_abandon_assist: true,
    // the eight unread columns, all present
    member_user_id: 'mu',
    status_message: 's',
    last_synced_at: 'd',
    profile_data_updated_at: 'd',
    config: { follow_up: {} },
    created_at: 'd',
    updated_at: 'd',
    __v: 3,
  };

  /** what the Mongo exclusion projection does to the populated doc */
  const afterExclusion = (doc: Record<string, unknown>) => {
    const out = { ...doc };
    for (const k of UNREAD_MEMBER_KEYS) delete out[k];
    return out;
  };

  it('trim(full) === trim(projected) — the wire just stops carrying dead bytes', () => {
    expect(trimListMember(afterExclusion(fullMember))).toEqual(
      trimListMember(fullMember),
    );
  });
});

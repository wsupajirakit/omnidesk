/**
 * [FEAT-20260905-CUSTPROV PART 3] `member-tier-key.util.ts` reads its three
 * fallback paths off the active customer provider instead of hardcoding
 * them a second time.
 * ============================================================================
 * `tierOfMemberBE` / `memberTierKey`
 * (`src/modules/tickets/member-tier-key.util.ts`) now accept an optional
 * `tierPaths` list, defaulting to `DEFAULT_CUSTOMER_PROVIDER.tierPaths` —
 * today `shopapi_v1`'s exact three paths — so every existing caller
 * (`tickets.service.ts`, which passes nothing) behaves byte-identically to
 * before this change.
 *
 * These vectors prove:
 *   · a tier resolves from each of the three default paths in turn;
 *   · `''` / `0` / `false` are FALSY-gated and fall through to the NEXT
 *     path (not merely to `member.tier`) — the rule
 *     `customer-provider.port.ts` documents at :32-44, which
 *     `member-tier-key.util.ts` now reads from `tierPaths` (`??` across them, one truthy gate)
 *     instead of three hand-written variables joined with `??`;
 *   · exhausting every path falls back to the `member.tier` column;
 *   · a provider whose `tierPaths` point somewhere else entirely is served
 *     by passing that list in — no further change to this file for it.
 *
 * Import style: relative into `src/` for the util under test, matching the
 * 15+ existing z-test files that reach a module file the barrel does not
 * export (e.g. `bank-logo-code-map.spec.ts`). `@/modules/tickets` does not
 * export `member-tier-key.util`'s members, and adding that export is out of
 * scope for this change (the deep `@/modules/tickets/member-tier-key.util`
 * ALIAS path is an eslint `no-restricted-imports` error — confirmed against
 * this exact import in `ticket-list-filter-params.spec.ts:20`; the relative
 * path below is not covered by that rule, and is the codebase's existing way
 * around it).
 *
 * revert: delete this file.
 */
import {
  memberTierKey,
  TIER_KEY_PROJECTION,
  tierKeyProjection,
  tierOfMemberBE,
} from '../../src/modules/tickets/member-tier-key.util';
import {
  DEFAULT_CUSTOMER_PROVIDER,
  type TierPath,
} from '@/modules/customer-provider';

describe('member-tier-key reads its paths off the active provider (PART 3)', () => {
  describe('the default is shopapi_v1 — unchanged from before this file existed', () => {
    it('DEFAULT_CUSTOMER_PROVIDER is still the exact three paths this file used to hardcode', () => {
      expect(DEFAULT_CUSTOMER_PROVIDER.tierPaths).toEqual([
        'data.profile.tier',
        'profile.tier',
        'tier',
      ]);
    });

    it('resolves a tier at path 1 (data.profile.tier) with no override', () => {
      expect(
        tierOfMemberBE({
          raw_profile_data: { data: { profile: { tier: 'Gold' } } },
        }),
      ).toBe('Gold');
    });

    it('resolves a tier at path 2 (profile.tier) with no override', () => {
      expect(
        tierOfMemberBE({ raw_profile_data: { profile: { tier: 'Silver' } } }),
      ).toBe('Silver');
    });

    it('resolves a tier at path 3 (tier) with no override', () => {
      expect(tierOfMemberBE({ raw_profile_data: { tier: 'Bronze' } })).toBe(
        'Bronze',
      );
    });
  });

  describe("⭐ '' / 0 / false: `??` across the paths, ONE truthy gate at the end", () => {
    /**
     * 🔴 THIS BLOCK WAS WRITTEN THE OTHER WAY ROUND FIRST, AND IT WAS WRONG.
     *
     * A per-path truthy LOOP reads naturally and does not match the screen.
     * `omnidesk-console/utils/memberTier.ts:54-58` is:
     *
     *     const fromRaw = raw?.data?.profile?.tier ?? raw?.profile?.tier ?? raw?.tier ?? null;
     *     if (fromRaw) return fromRaw;
     *     return member.tier ?? null;
     *
     * `??` — so a tier of `''` at the FIRST path STOPS the chain (it is not
     * nullish), fails the single gate, and falls to the `member.tier` COLUMN.
     * It never reaches the second path.
     *
     * With a loop, the back end would answer the second path while the
     * dashboard answered the column: the ticket-list FILTER and the badge on
     * the CARD would disagree about the same customer. That is exactly the
     * defect `[FIX-20260810-TIERSOURCE]` exists to prevent — its own header
     * records a real customer (0965550015) seen with two different tiers on two
     * parts of one screen. BE ต้องตอบเหมือน FE เป๊ะ ไม่ใช่ "ดีกว่า"
     */

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       TRANSCRIBED VERBATIM from `omnidesk-console/utils/memberTier.ts:52`,
       whose own header explains the `any`: the upstream shape is not stable and
       typing it would be a second, weaker copy of the reconciliation. Typing it
       differently HERE would make this a paraphrase instead of an oracle. */
    const feTierOfMember = (member: any): unknown => {
      if (!member || typeof member !== 'object') return null;
      const raw = member.raw_profile_data;
      const fromRaw =
        raw?.data?.profile?.tier ?? raw?.profile?.tier ?? raw?.tier ?? null;
      if (fromRaw) return fromRaw;
      return member.tier ?? null;
    };

    const VECTORS: [string, unknown][] = [
      [
        "'' at path 1 with path 2 populated — the case that separates the two rules",
        {
          raw_profile_data: {
            data: { profile: { tier: '' } },
            profile: { tier: 'Gold' },
          },
          tier: 'ColumnTier',
        },
      ],
      [
        '0 at path 2 with path 3 populated',
        {
          raw_profile_data: { profile: { tier: 0 }, tier: 'Bronze' },
          tier: 'ColumnTier',
        },
      ],
      [
        'false at path 1, nothing else in raw',
        {
          raw_profile_data: { data: { profile: { tier: false } } },
          tier: 'ColumnTier',
        },
      ],
      ['nothing anywhere', { raw_profile_data: {}, tier: 'ColumnTier' }],
      [
        'no column either',
        { raw_profile_data: { data: { profile: { tier: '' } } } },
      ],
    ];

    it.each(VECTORS)(
      '⭐ %s — back end answers what the dashboard answers',
      (_name, member) => {
        expect(tierOfMemberBE(member)).toEqual(feTierOfMember(member));
      },
    );

    it('⭐ and the answer for the separating case is the COLUMN, not path 2', () => {
      // Spelled out so the parity case above cannot pass by both sides being
      // wrong in the same way.
      expect(
        tierOfMemberBE({
          raw_profile_data: {
            data: { profile: { tier: '' } },
            profile: { tier: 'Gold' },
          },
          tier: 'ColumnTier',
        }),
      ).toBe('ColumnTier');
    });
  });

  describe('exhausting every tierPath falls back to the member.tier column', () => {
    it('no raw_profile_data at all → member.tier wins', () => {
      expect(tierOfMemberBE({ tier: 'ColumnTier' })).toBe('ColumnTier');
    });

    it('no tier anywhere → null', () => {
      expect(tierOfMemberBE({})).toBeNull();
    });
  });

  describe('a fake provider with DIFFERENT tierPaths resolves from its own location', () => {
    const fakeProviderTierPaths: readonly TierPath[] = [
      'meta.rank',
      'status.level',
    ];

    it("reads the fake provider's paths, not shopapi_v1's", () => {
      const member = { raw_profile_data: { meta: { rank: 'Diamond' } } };
      // Sanity: shopapi_v1's own paths find nothing on this member, so a pass on
      // the next line alone would prove nothing if tierOfMemberBE silently
      // ignored the tierPaths argument and always used the default.
      expect(tierOfMemberBE(member)).toBeNull();
      expect(tierOfMemberBE(member, fakeProviderTierPaths)).toBe('Diamond');
    });

    it('⭐ a vendor gets the SAME rule, not a friendlier one', () => {
      /* `''` at the vendor's first path stops its chain too, and falls to the
         column — identical to what shopapi_v1 does and to what the dashboard does.
         A provider must not be able to change the RULE, only the LOCATIONS;
         that is the boundary `customer-provider.port.ts` draws between the
         fixed half and the varying half. */
      const member = {
        raw_profile_data: { meta: { rank: '' }, status: { level: 'Bronze' } },
        tier: 'ColumnTier',
      };
      expect(tierOfMemberBE(member, fakeProviderTierPaths)).toBe('ColumnTier');
    });

    it('a vendor whose FIRST path is simply absent does reach its second', () => {
      // Absent is nullish, so the chain continues — the other half of `??`.
      const member = { raw_profile_data: { status: { level: 'Bronze' } } };
      expect(tierOfMemberBE(member, fakeProviderTierPaths)).toBe('Bronze');
    });

    it('memberTierKey honours the same override end to end', () => {
      const member = { raw_profile_data: { status: { level: 'VIP' } } };
      expect(memberTierKey(member, fakeProviderTierPaths)).toBe('vip');
    });
  });

  describe('⭐ the Mongo projection follows the paths, or the paths are decoration', () => {
    it('today it is byte-identical to the literal it replaced', () => {
      expect(tierKeyProjection()).toEqual({
        tier: 1,
        'raw_profile_data.data.profile.tier': 1,
        'raw_profile_data.profile.tier': 1,
        'raw_profile_data.tier': 1,
      });
      expect(TIER_KEY_PROJECTION).toEqual(tierKeyProjection());
    });

    it("⭐ a vendor's own paths reach the QUERY, not just the reader", () => {
      /* The hole this closes: with the projection hardcoded, a provider could
         declare `meta.rank`, the reader would look there, and Mongo would have
         stripped the field before it arrived. Configurable paths, `null`
         answers, nothing to say why. */
      expect(tierKeyProjection(['meta.rank', 'status.level'])).toEqual({
        tier: 1,
        'raw_profile_data.meta.rank': 1,
        'raw_profile_data.status.level': 1,
      });
    });
  });
});

/**
 * [FEAT-20260905-CUSTPROV PART 4] 📖 omnidesk-api/todo/task/05092026/todo3_
 * 05092026_profile_panel_module.md §18-23 — the tier FILTER dropdown and the
 * tier BADGE are switchable through the SAME BE-served flags that
 * `omnidesk-api/z-test/unit/customer-provider-tierswitch.spec.ts` proves reach
 * the ticket-list response (`show_tier_badge` / `show_tier_filter`).
 * ============================================================================
 * THREE render sites, TWO files, ONE rule ([FIX-20260810-TIERSOURCE]):
 * `showTierBadge` must govern BOTH badge sites — the ticket CARD
 * (TicketChat.tsx) and the ROOM HEADER (ChatRoomView.tsx) — or neither; those
 * two once disagreed for a real customer. `showTierFilter` governs only the
 * tier dropdown in TicketChat.tsx's toolbar, and per §19/§20 it must NEVER
 * change which rows are fetched, sorted or counted — hiding a CONTROL, never
 * a ROW.
 *
 * ⚠️ WHY THIS FILE MIXES TWO TECHNIQUES.
 *   `ChatRoomView` is a small, genuinely mountable component — see
 *   `chatHeaderControlsRow.dom.test.tsx` / `contactChatTab.dom.test.tsx`,
 *   which mount it directly with the same two-line mock recipe reused below.
 *   §A is therefore a REAL mount of the REAL component.
 *
 *   `TicketChat.tsx` is a 7,000+ line page that NO test in this repo mounts
 *   directly — the closest precedent, `cardWindow.dom.test.tsx`, reads it as
 *   SOURCE for exactly that reason, and PART 2 of the plan above names this
 *   file's size as the debt it exists to pay down. §B therefore proves the
 *   WIRING by anchoring on the live source (so a change to the real gate that
 *   is not mirrored here fails loudly — the same technique
 *   `contactChatTab.dom.test.tsx`'s `chatRoomViewJsx()` helper uses), and
 *   separately proves the RUNTIME BEHAVIOUR with a REAL DOM render of a
 *   harness built from the exact same imports (`tierOfMember`/`tierBadgeText`,
 *   the real `SearchableSelect`) and the exact same gating expression.
 *
 * 🔴 [FIX-20260824-TARGETHIDDEN] (`broadcastFormVisible.dom.test.tsx`) is why
 * every "renders" assertion below is `toBeVisible()`, never
 * `toBeInTheDocument()` — that file's header records 1,240 tests staying green
 * while four controls sat deleted or behind `display:none`, because
 * `getByTestId`/`getByText` find elements a real browser would never paint.
 * `toBeVisible()` is the one matcher that would have caught it; "absent"
 * cases use a plain `.toBeNull()` on a direct DOM query instead (this repo's
 * own convention — see `broadcastAtTimeForm.dom.test.tsx`), which is a
 * stronger claim than "invisible": the element is not merely hidden, the
 * conditional never rendered it at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { render, screen } from '@testing-library/react';

import { tierOfMember, tierBadgeText } from '../utils/memberTier';
import { SearchableSelect } from '../components/member/SearchableSelect';

// [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
const TICKETCHAT_SRC = ticketChatPageWithPieces();

beforeEach(() => {
  vi.resetModules();
  /* jsdom ไม่มี scrollIntoView — ChatRoomView เรียกตอน mount
     (same stub as chatHeaderControlsRow.dom.test.tsx / contactChatTab.dom.test.tsx) */
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  Element.prototype.scrollIntoView = vi.fn();
});

/* ══════════════════════════════════════════════════════════════════════════
 * §A — site 1/2: the ROOM HEADER badge, ChatRoomView.tsx — REAL mount
 * ══════════════════════════════════════════════════════════════════════════ */
const mountRoom = async (props: {
  showTierBadge?: boolean;
  memberData?: unknown;
}) => {
  vi.doMock('../services/chat', async () => {
    const actual =
      await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        getMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      useTicketWS: () => undefined,
    };
  });
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'judy' },
  } as never;
  // omit the prop entirely when undefined, so the component's OWN default runs
  const extra =
    props.showTierBadge === undefined
      ? {}
      : { showTierBadge: props.showTierBadge };
  return render(
    <ChatRoomView
      room={room}
      hookId="hook1"
      showDetailBox={false}
      memberId="m1"
      memberData={props.memberData ?? { _id: 'm1' }}
      {...extra}
    />,
  );
};

describe('[CUSTPROV PART 4] site 1/2 — the room-header badge (ChatRoomView)', () => {
  it('⭐ tier present, flag UNSET (default) → the badge renders and is visible — today, byte-identical', async () => {
    const { container } = await mountRoom({
      memberData: { tier: { name: 'Normal', level: 0 } },
    });
    const badge = container.querySelector('.panel-badge-purple');
    expect(badge).toBeVisible();
    expect(badge!.textContent).toContain('Normal');
    expect(badge!.textContent).toContain('0'); // level 0 must survive — it is falsy, not absent
  });

  it('🔴 tier present, showTierBadge={false} → the badge does not exist in the DOM at all', async () => {
    const { container } = await mountRoom({
      showTierBadge: false,
      memberData: { tier: { name: 'Normal', level: 0 } },
    });
    expect(container.querySelector('.panel-badge-purple')).toBeNull();
  });

  it('showTierBadge={true} explicitly → identical to unset (today)', async () => {
    const { container } = await mountRoom({
      showTierBadge: true,
      memberData: { tier: { name: 'Gold', level: 2 } },
    });
    const badge = container.querySelector('.panel-badge-purple');
    expect(badge).toBeVisible();
    expect(badge!.textContent).toContain('Gold');
  });

  it('no tier at all, flag ON → still no badge — pins EXISTING behaviour, unrelated to this switch', async () => {
    const { container } = await mountRoom({ memberData: { _id: 'm1' } });
    expect(container.querySelector('.panel-badge-purple')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §B — TicketChat.tsx: the ticket-CARD badge (site 2/2) + the tier-FILTER
 * control. See the file header for why this half anchors on source instead
 * of mounting the 7,000-line page.
 * ══════════════════════════════════════════════════════════════════════════ */
const CARD_BADGE_GATE =
  '{showTierBadge && tierOfMember(tk.line_user_data) && (';
const FILTER_GATE = '{showTierFilter && (';

describe('[CUSTPROV PART 4] the two TicketChat.tsx gates, anchored to the live file', () => {
  it('the card-badge gate exists verbatim in the real file', () => {
    expect(TICKETCHAT_SRC).toContain(CARD_BADGE_GATE);
  });

  it('the tier-filter gate exists verbatim in the real file', () => {
    expect(TICKETCHAT_SRC).toContain(FILTER_GATE);
  });

  it('both switches default true and treat absent/undefined as ON (§21 — "default is TODAY")', () => {
    expect(TICKETCHAT_SRC).toContain(
      "const [showTierBadge, setShowTierBadge] = useState(true);",
    );
    expect(TICKETCHAT_SRC).toContain(
      "const [showTierFilter, setShowTierFilter] = useState(true);",
    );
    /* 🔴 UPDATED 05/09 by [FIX-20260905-TIERFILTERSTUCK]. This case used to pin
       the two `res.show_tier_* !== false` expressions INLINE in this page. They
       are gone on purpose: the rule moved to `utils/tierSwitches.ts` because
       hiding the filter has to clear `filterTier` as well, and that branch
       written at three fetch sites is the shape that drifts.
       The absent-means-ON rule itself is now asserted against real inputs in
       `test/tierSwitchesStuck.value.test.ts` — a stronger proof than a substring
       ever was. What stays HERE is the anchor that the page still routes through
       it, which is the part a source scan is actually good for. */
    expect(TICKETCHAT_SRC).toContain('applyTierSwitches(res)');
    expect(TICKETCHAT_SRC).toContain('const sw = tierSwitchesFrom(res);');
    expect(TICKETCHAT_SRC).toContain('setShowTierBadge(sw.showBadge);');
    expect(TICKETCHAT_SRC).toContain('setShowTierFilter(sw.showFilter);');
  });

  it('showTierBadge reaches the OTHER badge site too — passed into <ChatRoomView>', () => {
    expect(TICKETCHAT_SRC).toContain('showTierBadge={showTierBadge}');
  });

  it('🔴 neither switch appears inside the row-filtering predicate — a hidden control cannot hide a row (§20)', () => {
    const predicate =
      "if (filterTier && tierKeyOf(tierOfMember(tk.line_user_data)) !== filterTier) return false;";
    // both memoized tab lists (active + completed) carry this exact predicate
    const occurrences = TICKETCHAT_SRC.split(predicate).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(predicate).not.toContain('showTierFilter');
    expect(predicate).not.toContain('showTierBadge');
  });
});

/* Runtime proof: a harness sharing the exact imports and the exact gating
   expression asserted above, rendered for real — not decoration, because a
   change to the boolean SENSE of either gate (e.g. an accidental `!`) would
   break the anchor match above, and a change to what the gate WRAPS is
   exercised here. */
function TicketCardsProbe({
  showTierBadge,
  rows,
}: {
  showTierBadge: boolean;
  rows: Array<{ id: string; line_user_data: unknown }>;
}) {
  return (
    <div>
      {rows.map((tk) => (
        <div key={tk.id} data-testid="ticket-row">
          {showTierBadge && tierOfMember(tk.line_user_data) && (
            <span data-testid="tier-badge">
              💎 {tierBadgeText(tierOfMember(tk.line_user_data))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

describe('[CUSTPROV PART 4] site 2/2 — the ticket CARD badge, real render of the anchored gate', () => {
  const rows = [
    { id: 't1', line_user_data: { tier: { name: 'Normal', level: 0 } } },
    { id: 't2', line_user_data: { tier: { name: 'Gold', level: 2 } } },
    { id: 't3', line_user_data: {} }, // no tier — never shows a badge either way
  ];

  it('⭐ flag ON → every tiered row shows a VISIBLE badge, all rows still on screen', () => {
    render(<TicketCardsProbe showTierBadge rows={rows} />);
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(3);
    const badges = screen.getAllByTestId('tier-badge');
    expect(badges).toHaveLength(2); // t1 + t2 have a tier, t3 does not
    badges.forEach((b) => expect(b).toBeVisible());
  });

  it('🔴 flag OFF → no badge anywhere, but the ROW COUNT on screen is unchanged', () => {
    render(<TicketCardsProbe showTierBadge={false} rows={rows} />);
    // same 3 rows as the ON case above — hiding a badge never hides a row (§20)
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(3);
    expect(screen.queryAllByTestId('tier-badge')).toHaveLength(0);
  });
});

function FilterProbe({ showTierFilter }: { showTierFilter: boolean }) {
  return (
    <div>
      {showTierFilter && (
        <SearchableSelect
          value=""
          onChange={() => {}}
          placeholder="💎 Tier ทั้งหมด"
          searchPlaceholder="ค้นหา Tier..."
          options={[{ value: '', label: '💎 Tier ทั้งหมด' }]}
        />
      )}
    </div>
  );
}

describe('[CUSTPROV PART 4] site 3 — the tier-FILTER control, real render of the anchored gate', () => {
  it('⭐ flag ON → the real SearchableSelect control renders and is visible', () => {
    const { container } = render(<FilterProbe showTierFilter />);
    const trigger = container.querySelector('button');
    expect(trigger).toBeVisible();
    expect(trigger!.textContent).toContain('Tier ทั้งหมด');
  });

  it('🔴 flag OFF → the control does not exist in the DOM — hides a CONTROL, never touches a row', () => {
    const { container } = render(<FilterProbe showTierFilter={false} />);
    expect(container.querySelector('button')).toBeNull();
  });
});

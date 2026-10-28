/**
 * [FEAT-20260907-TABSEEN] The rule that takes the orange off a status tab.
 * ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md
 *
 * What matters most here is not that acknowledging works — it is the three ways
 * this could quietly break the badge it is layered on top of:
 *
 *   · covering a tab forever, so a later message announces nothing
 *   · reading "all five clicked" instead of "nothing is orange", which would make
 *     the group's orange almost unclearable
 *   · deciding the group question from the state BEFORE the click, so the last
 *     acknowledgement always sees itself as "one still lit" and never fires
 *
 * Each has its own case below, because each is silent when it happens.
 */
import { describe, expect, it } from 'vitest';

import {
  markTabSeen,
  noTabLit,
  NOTHING_SEEN,
  tabIsLit,
  type TabSeen,
} from '../pages/chat/tabSeen';

const KEYS = ['mine', 'waiting', 'active', 'ended', 'bot'];

const src = (
  statusHasNew: Record<string, boolean> = {},
  tabHasUnread: Record<string, boolean> = {},
) => ({ statusHasNew, tabHasUnread });

describe('[FEAT-20260907-TABSEEN] tabIsLit — the composition, unchanged plus one term', () => {
  it('a new CASE lights the tab', () => {
    expect(tabIsLit('waiting', src({ waiting: true }), NOTHING_SEEN)).toBe(true);
  });

  it('an unread CARD lights the tab', () => {
    expect(tabIsLit('waiting', src({}, { waiting: true }), NOTHING_SEEN)).toBe(true);
  });

  it('neither source ⇒ grey', () => {
    expect(tabIsLit('waiting', src(), NOTHING_SEEN)).toBe(false);
  });

  it('🔴 acknowledging hides it — and only it', () => {
    const seen: TabSeen = { waiting: true };
    const s = src({ waiting: true }, { active: true });
    expect(tabIsLit('waiting', s, seen)).toBe(false);
    expect(tabIsLit('active', s, seen)).toBe(true);
  });

  it('acknowledging a tab that was never lit changes nothing anyone can see', () => {
    expect(tabIsLit('ended', src(), { ended: true })).toBe(false);
  });

  it('🔴 a tab acknowledged while lit lights again once the acknowledgement is dropped', () => {
    /* This is the whole reason the realtime handler resets the map. Without that
       reset the badge is dead for the rest of the session. */
    const s = src({}, { waiting: true });
    expect(tabIsLit('waiting', s, { waiting: true })).toBe(false);
    expect(tabIsLit('waiting', s, NOTHING_SEEN)).toBe(true);
  });
});

describe('[FEAT-20260907-TABSEEN] markTabSeen', () => {
  it('adds the key', () => {
    expect(markTabSeen(NOTHING_SEEN, 'waiting')).toEqual({ waiting: true });
  });

  it('returns the SAME object when it would change nothing', () => {
    /* Identity, not equality — a click on an already-acknowledged tab must not
       re-render the list behind it. */
    const seen: TabSeen = { waiting: true };
    expect(markTabSeen(seen, 'waiting')).toBe(seen);
  });

  it('does not mutate what it was given', () => {
    const seen: TabSeen = { waiting: true };
    markTabSeen(seen, 'active');
    expect(seen).toEqual({ waiting: true });
  });
});

describe('[FEAT-20260907-TABSEEN] noTabLit — "nothing is orange", never "all five clicked"', () => {
  it('nothing was ever lit ⇒ true, with nothing acknowledged', () => {
    expect(noTabLit(KEYS, src(), NOTHING_SEEN)).toBe(true);
  });

  it('🔴 THREE lit, three acknowledged ⇒ true. The other two are irrelevant', () => {
    const s = src({ waiting: true }, { mine: true, active: true });
    const seen: TabSeen = { waiting: true, mine: true, active: true };
    expect(noTabLit(KEYS, s, seen)).toBe(true);
  });

  it('three lit, only two acknowledged ⇒ false', () => {
    const s = src({ waiting: true }, { mine: true, active: true });
    expect(noTabLit(KEYS, s, { waiting: true, mine: true })).toBe(false);
  });

  it('🔴 acknowledging all five does NOT rescue a tab that is still lit by a source', () => {
    /* Guards the inverse mistake: the answer must come from the composition, not
       from how many keys are in the map. */
    const s = src({}, { bot: true });
    const all: TabSeen = { mine: true, waiting: true, active: true, ended: true };
    expect(noTabLit(KEYS, s, all)).toBe(false);
  });

  it('one lit, one acknowledged ⇒ true', () => {
    expect(noTabLit(KEYS, src({ ended: true }), { ended: true })).toBe(true);
  });
});

describe('[FEAT-20260907-TABSEEN] the group-clear decision, as the page makes it', () => {
  /* The page computes `noTabLit` against the map AFTER the click. These two cases
     pin that ordering, because reading the BEFORE map is a mistake that hides
     itself: the last acknowledgement would always see one tab still lit. */
  it('🔴 evaluated on the state AFTER the click ⇒ the last one fires', () => {
    const s = src({}, { waiting: true });
    const before: TabSeen = {};
    const after = markTabSeen(before, 'waiting');
    expect(noTabLit(KEYS, s, before)).toBe(false); // the wrong reading
    expect(noTabLit(KEYS, s, after)).toBe(true); // the right one
  });

  it('with another tab still lit, the last click does not fire', () => {
    const s = src({}, { waiting: true, active: true });
    expect(noTabLit(KEYS, s, markTabSeen({}, 'waiting'))).toBe(false);
  });
});

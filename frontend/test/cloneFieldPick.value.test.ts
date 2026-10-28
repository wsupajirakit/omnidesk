/**
 * [FEAT-20260822-CLONEFIELDS] Ticking SOME fields of a tab in Multi-Clone.
 * The rules live in one pure helper so the modal only renders:
 *   · a tab with no explicit pick = ALL its fields (today's meaning of a tick)
 *   · unticking a field makes the tab PARTIAL; unticking the last one unticks the tab
 *   · the request carries `fields` ONLY when some tab is partial — a whole-tab
 *     clone sends exactly the request it always sent (BE: absent = whole tab)
 *   · secrets are not in this helper: they keep their own `include_secrets` list
 */
import { describe, it, expect } from 'vitest';
import {
  tickTab,
  untickTab,
  toggleField,
  tabState,
  fieldsPayload,
  type FieldPick,
} from '../components/hook/cloneFieldPick';

const TABS = [
  { key: 'ai', fields: ['doc_id', 'hook_text_reply_mode', 'fast_mode'] },
  { key: 'slip', fields: ['slip_check', 'slip_require_profile'] },
];

describe('tab ticks', () => {
  it('ticking a tab selects ALL its fields; unticking removes it entirely', () => {
    let p: FieldPick = {};
    p = tickTab(p, TABS[0]!);
    expect(p).toEqual({ ai: ['doc_id', 'hook_text_reply_mode', 'fast_mode'] });
    p = untickTab(p, 'ai');
    expect(p).toEqual({});
  });
});

describe('field toggles', () => {
  it('unticking one field → partial; the tab stays selected', () => {
    let p = tickTab({}, TABS[0]!);
    p = toggleField(p, TABS[0]!, 'fast_mode');
    expect(p).toEqual({ ai: ['doc_id', 'hook_text_reply_mode'] });
    expect(tabState(p, TABS[0]!)).toBe('partial');
  });
  it('ticking a field on an unselected tab selects the tab with ONLY that field ("เอาแค่ doc")', () => {
    const p = toggleField({}, TABS[0]!, 'doc_id');
    expect(p).toEqual({ ai: ['doc_id'] });
    expect(tabState(p, TABS[0]!)).toBe('partial');
  });
  it('unticking the last field unticks the tab', () => {
    const p = toggleField({ ai: ['doc_id'] }, TABS[0]!, 'doc_id');
    expect(p).toEqual({});
    expect(tabState(p, TABS[0]!)).toBe('none');
  });
  it('re-ticking every field returns to full (order = registry order, not click order)', () => {
    let p: FieldPick = { ai: ['fast_mode'] };
    p = toggleField(p, TABS[0]!, 'doc_id');
    p = toggleField(p, TABS[0]!, 'hook_text_reply_mode');
    expect(p).toEqual({ ai: ['doc_id', 'hook_text_reply_mode', 'fast_mode'] });
    expect(tabState(p, TABS[0]!)).toBe('full');
  });
});

describe('the request', () => {
  it('all selected tabs full → NO fields key: byte-identical to the old request', () => {
    const p = tickTab(tickTab({}, TABS[0]!), TABS[1]!);
    expect(fieldsPayload(p, TABS)).toEqual({ tabs: ['ai', 'slip'] });
  });
  it('any partial tab → fields = every selected field across selected tabs (full tabs spelled out too)', () => {
    const p = toggleField(tickTab(tickTab({}, TABS[0]!), TABS[1]!), TABS[0]!, 'fast_mode');
    expect(fieldsPayload(p, TABS)).toEqual({
      tabs: ['ai', 'slip'],
      fields: ['doc_id', 'hook_text_reply_mode', 'slip_check', 'slip_require_profile'],
    });
  });
  it('"เอาแค่ doc" → tabs ai, fields [doc_id]', () => {
    expect(fieldsPayload({ ai: ['doc_id'] }, TABS)).toEqual({ tabs: ['ai'], fields: ['doc_id'] });
  });
  it('tab order follows the registry, not the click order', () => {
    const p = tickTab(tickTab({}, TABS[1]!), TABS[0]!);
    expect(fieldsPayload(p, TABS).tabs).toEqual(['ai', 'slip']);
  });
});

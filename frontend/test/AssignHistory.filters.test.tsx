/* [FEAT-20260806-SEARCHSELECT] AssignHistory page — before/after proof that turning the 3 native
 * <select>s (ACTION / ผู้รับงาน / ผู้เปลี่ยน) into searchable combos changed ONLY the picker UX,
 * not the outcome:
 *   • the option set is identical (all users + the "All Users" default appear),
 *   • picking an assignee produces the SAME fetch filter (assign_to=<id>),
 *   • the inline search box narrows options (the new UX) without changing value semantics.
 * NOTE: assign-history has NO date-scope filter (owner scoped within_days to the ticket page only),
 * so the fetch must NOT carry within_days here. Renders the REAL page with services mocked.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const getCalls: any[] = [];
vi.mock('../services/chat', () => ({
  assignHistoryService: {
    getAssignHistories: (filters: any) => { getCalls.push(filters); return Promise.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 1 } }); },
  },
}));
// partial-mock: keep every real export (i18n reads getInitialPreferences from here) and
// override only userService.listUsers.
vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    userService: {
      ...actual.userService,
      listUsers: () => Promise.resolve({ data: [
        { id: 'u1', username: 'alice', display_name: 'Alice A' },
        { id: 'u2', username: 'bob', display_name: 'Bob B' },
      ], pagination: { page: 1, limit: 1000, total: 2, total_pages: 1 } }),
    },
  };
});

import { AssignHistory } from '../pages/handoff/AssignHistory';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => { getCalls.length = 0; });

const renderPage = () => render(<I18nProvider><AssignHistory /></I18nProvider>);

describe('AssignHistory — searchable filters keep identical behavior (no date filter)', () => {
  it('on load, fetches with NO filters selected and NO within_days (date scope is ticket-page only)', async () => {
    renderPage();
    await waitFor(() => expect(getCalls.length).toBeGreaterThan(0));
    const first = getCalls[getCalls.length - 1];
    expect(first.within_days).toBeUndefined();
    expect(first.assign_to).toBeUndefined();
    expect(first.changed_by_id).toBeUndefined();
    expect(first.action).toBeUndefined();
  });

  // default locale in tests is 'th' → the "All Users" default renders as "ผู้ใช้ทั้งหมด"
  const ALL_USERS = 'ผู้ใช้ทั้งหมด';

  it('the assignee combo lists every user + the All Users default (option set unchanged)', async () => {
    const { getAllByText, getByText } = renderPage();
    await waitFor(() => expect(getCalls.length).toBeGreaterThan(0));
    // open the assignee dropdown (its trigger shows the "All Users" default label)
    fireEvent.click(getAllByText(ALL_USERS)[0]);
    // the searchable list renders the users
    await waitFor(() => expect(getByText('Alice A')).toBeTruthy());
    expect(getByText('Bob B')).toBeTruthy();
    // the "All Users" default is still an option (trigger + option → at least 2 matches)
    expect(getAllByText(ALL_USERS).length).toBeGreaterThanOrEqual(2);
  });

  it('picking an assignee fires the SAME filter as the old <select> (assign_to=<id>)', async () => {
    const { getAllByText, getByText } = renderPage();
    await waitFor(() => expect(getCalls.length).toBeGreaterThan(0));
    getCalls.length = 0;
    fireEvent.click(getAllByText(ALL_USERS)[0]);
    await waitFor(() => expect(getByText('Alice A')).toBeTruthy());
    fireEvent.click(getByText('Alice A'));
    await waitFor(() => expect(getCalls.length).toBeGreaterThan(0));
    const call = getCalls[getCalls.length - 1];
    expect(call.assign_to).toBe('u1');
    // no date scope on this page → within_days must never be sent
    expect(call.within_days).toBeUndefined();
  });

  it('typing in the combo search narrows options (the new UX) without changing the value semantics', async () => {
    const { getAllByText, getByText, queryByText, getAllByPlaceholderText } = renderPage();
    await waitFor(() => expect(getCalls.length).toBeGreaterThan(0));
    fireEvent.click(getAllByText(ALL_USERS)[0]);
    await waitFor(() => expect(getByText('Alice A')).toBeTruthy());
    const searchBox = getAllByPlaceholderText('ค้นหา…')[0];
    fireEvent.change(searchBox, { target: { value: 'bob' } });
    await waitFor(() => expect(queryByText('Alice A')).toBeNull());
    expect(getByText('Bob B')).toBeTruthy();
  });
});

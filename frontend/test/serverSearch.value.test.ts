/**
 * [FEAT-20260819-SERVERSEARCH] Searching now asks the DATABASE, not the browser.
 * ===========================================================================
 * Before: the page downloaded a date-scoped list and filtered it on screen, so
 * "search" could never reach a customer whose cases were older than the window —
 * the ⚙️ picker silently limited the search box. Measured on real data: a name
 * search saw 17 rows within 2 days where 79 exist.
 *
 * The precondition was making the server search a SUPERSET of the browser filter.
 * The browser also matches `raw_profile_data` (bank account no/name, profile
 * phone), which live in no column — proven on live data: account 7771012765
 * appears in 0 member columns and 1 raw_profile_data. Without those paths on the
 * server, moving the search would have silently broken searching by bank account.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const be = (p: string) => readFileSync(resolve(__dirname, '../../backend', p), 'utf8');

describe('the server is asked, and asked correctly', () => {
  const page = src('pages/chat/TicketChat.tsx');

  it('both lists carry the search term — including the ended tab\'s "load more" page', () => {
    // (?:sc\.)? — the counts refresher (phase 1.1, no-bias round) reads the term
    // through its fire-time scope ref (`sc.serverSearch`); same term, same universe.
    const withSearch = page.match(/search: (?:sc\.)?serverSearch/g) ?? [];
    // group + hook (active), the completed first page, and — since
    // [PERF-20260821-TICKETCURSOR] — the completed NEXT page: a later page that
    // forgot the term would append unfiltered rows under a filtered list.
    // [PERF-20260822-TKTIDSFETCH] the fifth is the partial fetch that replaces
    // the full refetch on a WS event. It MUST carry the term for the same
    // reason: a ticket that does not match the active search would otherwise be
    // merged into a filtered list and appear out of nowhere. The count is a
    // census of list calls — raising it is only correct because the new call
    // carries the term; a call WITHOUT it would leave this number unchanged and
    // is what the next case guards.
    // [FEAT-20260826-ACTIVEPAGING] the sixth is the float-up fetch (S8b):
    // it merges rows into a possibly-filtered list, so it MUST carry the term
    // — same reasoning as the partial fetch before it.
    // [FEAT-20260826-PAGINGCOUNTS] the seventh is the counts-only refresh
    // (paging phase 1.1): the badge numbers must describe the SAME filtered
    // universe the list shows — a counts request without the term would count
    // rows the operator cannot see. Census 6→7 flipped 26/08 evening; this pin
    // caught the newcomer red-first, which is exactly its job.
    expect(withSearch.length).toBe(7);
    // and the two completed calls go through ONE params builder, so they cannot drift
    expect((page.match(/closedListParams\(\{ cursor: /g) ?? []).length).toBe(2);
  });

  it('every list request names the term — the builder and the float-up both carry it', () => {
    /* flipped 26/08 [FEAT-20260826-ACTIVEPAGING]: fetchActive's inline object
       moved into services/chat/activeListParams.ts (ONE builder, both shapes),
       and the float-up fetch builds the one remaining inline object. The
       invariant is unchanged — no list call may forget the term — it just
       lives where the objects live now. */
    const builder = src('services/chat/activeListParams.ts');
    expect((builder.match(/search: input.search/g) ?? []).length).toBe(2); // legacy + paged
    const floatAt = page.indexOf('const scheduleFloatUp');
    expect(floatAt).toBeGreaterThan(-1);
    expect(page.slice(floatAt, floatAt + 2500)).toContain('search: serverSearch');
  });

  it('a search drops the date window — that limit was never intended', () => {
    expect(page).toContain('const scopeForQuery = debouncedSearch ? undefined : withinDaysParam;');
  });

  it('an empty box is byte-identical to the old behaviour', () => {
    // `undefined` makes the service omit the param entirely
    expect(page).toContain('const serverSearch = debouncedSearch || undefined;');
  });

  it('typing does not fire one request per keystroke', () => {
    /* [SEARCHMIN4] debounce เดิม 350ms ยังอยู่ แต่ห่อ gate ≥4 ตัวอักษร
       (ต่ำกว่า 4 server ต้องไม่เห็นอะไรเลย — คำสั่งเจ้าของ 27/08) */
    expect(page).toContain("setDebouncedSearch(q.length >= TICKET_SEARCH_MIN_CHARS ? q : '')");
    expect(page).toMatch(/setTimeout\(\(\) => \{/);
    // the fetches depend on the DEBOUNCED value, never the raw one
    expect(page).toContain('scopeForQuery, serverSearch]);');
  });

  it('the browser filter still runs on the immediate value, so typing feels instant', () => {
    /* ตัวกรองจอวิ่งบน activeSearch — ยัง "ทันที" (derive ตรงจาก searchPhone
       ไม่ต้องรอ debounce) แค่มีเกณฑ์ ≥4 ชุดเดียวกับ server */
    expect(page).toContain('if (activeSearch.trim()) {');
  });
});

describe('the server search covers what the browser could find', () => {
  /* [PERF-20260821-MEMBERSEARCH] the ten-path $or moved out of tickets.service.ts
     into member-search.util.ts (the `legacy_regex` mode that ships); the
     service now calls buildMemberSearchQuery. The guarantee is unchanged — every
     path the browser searches is searched server-side — so the pin follows the
     code to its new home and ALSO pins that the service goes through it. */
  const util = be('src/modules/tickets/member-search.util.ts');
  const service = be('src/modules/tickets/tickets.service.ts');
  const matcher = src('utils/memberSearchText.ts');

  it('the service asks through the one builder (no inline regex left behind)', () => {
    /* flipped 26/08: S3 (hybrid) widened the call to (term, leg) — the pin is
       the INVARIANT (one builder, no inline regex), not the argument shape,
       so it holds on both sides of the BE merge. */
    expect(service).toContain('buildMemberSearchQuery(');
    expect(service).not.toContain("{ 'raw_profile_data.data.profile.phone': regex }");
  });

  it('every raw-profile path the browser searches is searched server-side too', () => {
    // the browser's list, kept in one place on purpose
    expect(matcher).toContain("'phone',");
    expect(matcher).toContain("'bank.account_no',");
    expect(matcher).toContain("'bank.account_name',");
    // …and each one, rooted at the document, in the legacy path list
    expect(util).toContain("'raw_profile_data.data.profile.phone',");
    expect(util).toContain("'raw_profile_data.data.profile.bank.account_no',");
    expect(util).toContain("'raw_profile_data.data.profile.bank.account_name',");
  });

  it('the original column matches are still there — nothing was traded away', () => {
    for (const f of ['display_name', 'nickname', 'member_user_id', 'full_name', 'phone_number', 'contract_code', 'detail']) {
      expect(util).toContain(`'${f}',`);
    }
    // and legacy_regex is what ships
    expect(util).toContain("export const MEMBER_SEARCH_MODE: MemberSearchMode = 'legacy_regex';");
  });
});

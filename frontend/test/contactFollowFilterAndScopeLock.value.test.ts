/**
 * [FEAT-20260823-CONTACTFOLLOW] + [LOCK-20260823-WITHDRAWSCOPE]
 *
 * Two changes that are easy to get half-right:
 *   · a filter that is added to the UI but never reaches the server filters
 *     nothing, and the page count keeps saying the old number
 *   · a locked dropdown that still shows the stored value would let an operator
 *     save a value the select does not offer
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE = 'pages/chat/Contact.tsx';
const SVC = 'services/chat/chatService.ts';
const TAB = 'components/hook/form/tabs/HookNoticeTab.tsx';

describe('[FEAT-20260823-CONTACTFOLLOW] the filter reaches the SERVER', () => {
  const page = read(PAGE);
  const svc = read(SVC);

  it('⭐ the page sends `follow` with the request, not just to itself', () => {
    /* The failure this pins: a dropdown wired to local state only. The list is
       paginated by the server, so a client-side filter would filter ONE page
       and leave `meta.total` announcing the unfiltered number. */
    expect(page).toContain('follow: followFilter || null');
  });

  it('⭐ changing it refetches — it is in the fetch dependency list', () => {
    const deps = page.slice(page.indexOf('}, [groupsLoaded'), page.indexOf('perPage]);') + 10);
    expect(deps).toContain('followFilter');
  });

  it('⭐ the service omits the param unless a real mode was chosen', () => {
    expect(svc).toContain("if (follow && follow !== 'all') qs.append('follow', follow);");
  });

  it('offers exactly the four modes plus "all"', () => {
    const opts = page.slice(page.indexOf('const followOpts'), page.indexOf('const followOpts') + 600);
    for (const v of ['deposit', 'withdraw', 'both', 'none']) {
      expect(opts).toContain(`value: '${v}'`);
    }
    expect(opts).toContain("value: ''"); // ทั้งหมด
  });

  it('⭐ the "found N" line and the empty message both know about it', () => {
    /* Otherwise an empty result reads "ยังไม่มีลูกค้าในขอบเขตนี้" — which is a
       different claim from "nothing matched your filter". */
    expect(page).toContain('query || tagFilter || followFilter');
    expect(page).not.toMatch(/\{\(query \|\| tagFilter\) &&/);
  });
});

describe('[LOCK-20260823-WITHDRAWSCOPE] the withdraw scope offers one value', () => {
  const tab = read(TAB);

  it('⭐ the withdraw select is locked to `text`', () => {
    const at = tab.indexOf("'notice_withdraw_scope'");
    expect(at).toBeGreaterThan(-1);
    expect(tab.slice(at, at + 300)).toContain("'text',");
  });

  it('⭐ the DEPOSIT select is NOT locked — it still offers all three', () => {
    const at = tab.indexOf("'notice_deposit_scope'");
    const block = tab.slice(at, at + 300);
    expect(block).not.toContain("'text',");
    expect(block).not.toContain("'all',");
    expect(block).not.toContain("'slip',");
  });

  it('⭐ a locked select shows the locked value, not whatever the row holds', () => {
    /* Showing a stored `slip` inside a select whose only option is `text` would
       let a save write a value the operator never picked. */
    expect(tab).toContain('value={lockedTo ?? readScope(');
    expect(tab).toContain('{(lockedTo ? [lockedTo] : SCOPES).map(');
  });

  it('⭐ create and edit share one helper, so the lock cannot apply to only one', () => {
    expect(tab.match(/const scopeSelect = \(/g)?.length).toBe(1);
  });

  it('the note says why, and names the line that makes it true', () => {
    expect(tab).toContain('LOCK-20260823-WITHDRAWSCOPE');
    expect(tab).toContain('notice-context.ts:54');
    // and records that the withdraw side itself is NOT broken
    expect(tab).toContain('case-c');
  });
});

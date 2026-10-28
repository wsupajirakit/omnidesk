/**
 * [FIX-20260823-FOLLOWDIALOG] + [HIDE-20260823-FOLLOWERSWITCH] + [FEAT-20260823-FOLLOWSTAMP]
 *
 * Three changes around the same feature, and each is pinned by the thing that
 * would actually go wrong:
 *   · the confirm dialog used to call a follower change "Fast Mode"
 *   · the follower column is hidden, and a column is TWO tags — miss one and
 *     every column after it shifts by one for every row
 *   · the contact header shows the two follow-up stamps raw
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  followStampRaw,
  followStampLabel,
} from '../components/contact/ContactHeaderInfo';

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

const LIST = 'pages/hook/WebhookList.tsx';
const TAB = 'components/hook/form/tabs/HookNoticeTab.tsx';

describe('[FIX-20260823-FOLLOWDIALOG] the confirm box names the right setting', () => {
  const src = read(LIST);

  /* ⚠️ Anchor on THIS modal, not on the first `title={` in the file — the page
     has several modals and the clone one comes first. Slicing from the wrong
     anchor made these cases fail against correct code, which is its own lesson:
     a source-text assertion is only as good as the block it reads. */
  const block = (() => {
    const from = src.indexOf('onConfirm={confirmToggle}');
    const to = src.indexOf('type="warning"', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return src.slice(from, to);
  })();
  const titlePart = block.slice(block.indexOf('title={'), block.indexOf('message={'));
  const messagePart = block.slice(block.indexOf('message={'));

  it('⭐ the follower field has its OWN title — it must not fall into the Fast Mode else', () => {
    /* The defect: `field === 'status' ? statusTitle : fastModeTitle` — two
       branches for three fields, so a follower change asked "เปลี่ยน Fast Mode?" */
    expect(titlePart).toContain("toggleConfirm.field === 'follow_player_status'");
    expect(titlePart).toContain('webhook_list.toggle_follow_player_title');
  });

  it('⭐ and its own message, naming the OA and the direction', () => {
    expect(messagePart).toContain("toggleConfirm.field === 'follow_player_status'");
    expect(messagePart).toContain('webhook_list.toggle_follow_player_message');
    // the two facts an operator checks before confirming
    expect(messagePart).toMatch(/toggle_follow_player_message[\s\S]{0,200}name:/);
    expect(messagePart).toMatch(/toggle_follow_player_message[\s\S]{0,200}state:/);
  });

  it('⭐ the follower branch is tested BEFORE the fast-mode fallback', () => {
    expect(titlePart.indexOf('toggle_follow_player_title')).toBeGreaterThan(-1);
    expect(titlePart.indexOf('toggle_follow_player_title')).toBeLessThan(
      titlePart.indexOf('toggle_fast_mode_title'),
    );
  });

  it('every locale carries both new strings', () => {
    for (const lang of ['th', 'en', 'zh']) {
      const j = JSON.parse(read(`i18n/translations/${lang}.json`));
      expect(j['webhook_list.toggle_follow_player_title']).toBeTruthy();
      expect(j['webhook_list.toggle_follow_player_message']).toBeTruthy();
    }
  });
});

describe('[HIDE-20260823-FOLLOWERSWITCH] hidden as a WHOLE column, never half', () => {
  const src = read(LIST);

  it('⭐ the switch is hidden, because nothing in the back end reads it', () => {
    expect(src).toContain('const SHOW_FOLLOWER_COLUMN = false;');
  });

  it('⭐ BOTH the <th> and the <td> sit behind the same flag', () => {
    /* Hiding only one of them does not error, does not fail a type check, and
       silently shifts every column after it — the failure this test exists for. */
    const th = src.indexOf('header_follow_player');
    const td = src.indexOf("openToggleModal(hook, 'follow_player_status')");
    for (const at of [th, td]) {
      expect(at).toBeGreaterThan(-1);
      const before = src.slice(Math.max(0, at - 400), at);
      expect(before).toContain('SHOW_FOLLOWER_COLUMN &&');
    }
  });

  it('⭐ the empty-state row spans the column count, not a frozen number', () => {
    /* It said colSpan={7} while the table had 9 columns — "no results" stopped
       two columns short. Now derived, so it cannot drift either way. */
    expect(src).toContain('colSpan={TABLE_COLUMN_COUNT}');
    expect(src).toContain('const TABLE_COLUMN_COUNT = SHOW_FOLLOWER_COLUMN ? 9 : 8;');
    expect(src).not.toContain('colSpan={7}');
  });

  it('⭐ the form section is hidden too — one setting, one story', () => {
    const tab = read(TAB);
    expect(tab).toContain('HIDE-20260823-FOLLOWERSWITCH');
    const at = tab.indexOf('hook_form.notice_section_follower');
    expect(tab.slice(Math.max(0, at - 300), at)).toContain('{false && (');
  });

  it('the note says what does the job instead — the two switches that do', () => {
    const tab = read(TAB);
    expect(tab).toContain('notice_deposit_status');
    expect(tab).toContain('notice_withdraw_status');
    expect(tab).toContain('notice-context.ts:52-53');
  });

  it('⭐ nothing was DELETED — the write route and the toggle survive a flip back', () => {
    expect(src).toContain('follow_player_status: toggleConfirm.nextValue === 1');
    expect(src).toContain('updateHookNotice');
  });
});

describe('[FEAT-20260823-FOLLOWSTAMP] the header shows both stamps, raw', () => {
  const room = (line: Record<string, unknown> | undefined) =>
    ({ user_data: { config: { follow_up: { line } } } }) as never;

  it('⭐ raw value is the stored UTC instant, unformatted', () => {
    const r = room({ notice_deposit_at: '2026-08-22T16:30:00.000Z' });
    expect(followStampRaw(r, 'deposit')).toBe('2026-08-22T16:30:00.000Z');
  });

  it('⭐ the bracket is Bangkok time — 7 hours ahead of the stored value', () => {
    const label = followStampLabel(
      room({ notice_deposit_at: '2026-08-22T16:30:00.000Z' }),
      'deposit',
    );
    expect(label).toContain('2026-08-22T16:30:00.000Z');
    expect(label).toContain('23:30'); // 16:30Z = 23:30 in Bangkok
  });

  it('⭐ deposit and withdraw are read SEPARATELY, never merged', () => {
    const r = room({
      notice_deposit_at: '2026-08-22T16:30:00.000Z',
      notice_withdraw_at: '2026-09-29T07:00:00.000Z',
    });
    expect(followStampRaw(r, 'deposit')).toBe('2026-08-22T16:30:00.000Z');
    expect(followStampRaw(r, 'withdraw')).toBe('2026-09-29T07:00:00.000Z');
  });

  it.each([
    ['no line bag at all', undefined],
    ['bag present, key absent', {}],
    ['explicit null', { notice_deposit_at: null }],
    ['empty string', { notice_deposit_at: '' }],
    ['unparseable', { notice_deposit_at: 'not-a-date' }],
  ])('⭐ %s reads as n/a, never as a crash or a wrong date', (_l, line) => {
    expect(followStampRaw(room(line as never), 'deposit')).toBeNull();
    expect(followStampLabel(room(line as never), 'deposit')).toBe('n/a');
  });

  it('a real Date survives, not only the API’s ISO string', () => {
    const r = room({ notice_deposit_at: new Date('2026-08-22T16:30:00.000Z') });
    expect(followStampRaw(r, 'deposit')).toBe('2026-08-22T16:30:00.000Z');
  });

  it('⭐ a member with only one side shows the other as n/a', () => {
    const r = room({ notice_withdraw_at: '2026-09-29T07:00:00.000Z' });
    expect(followStampLabel(r, 'deposit')).toBe('n/a');
    expect(followStampLabel(r, 'withdraw')).toContain('2026-09-29T07:00:00.000Z');
  });

  it('⭐ both labels are rendered in the header, after the copy button', () => {
    const src = read('components/contact/ContactHeaderInfo.tsx');
    const copyAt = src.indexOf('<Copy size={12} />');
    const depAt = src.indexOf("followStampLabel(room, 'deposit')");
    const witAt = src.indexOf("followStampLabel(room, 'withdraw')");
    expect(copyAt).toBeGreaterThan(-1);
    expect(depAt).toBeGreaterThan(copyAt);
    expect(witAt).toBeGreaterThan(depAt);
    expect(src).toContain('ติดตามฝาก');
    expect(src).toContain('ติดตามถอน');
  });

  it('the back end already sends it — no service change was needed', () => {
    expect(existsSync(join(process.cwd(), 'services/chat/chatService.ts'))).toBe(true);
    const svc = read('services/chat/chatService.ts');
    // nothing was added to the service: the whole member rides on user_data
    expect(svc).not.toContain('notice_deposit_at');
  });
});

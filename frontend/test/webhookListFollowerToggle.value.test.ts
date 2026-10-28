/* [FEAT-20260822-NOTICEMODE] the follower switch in the OA table — WIRING pin.
 *
 * ⚠️ WHAT THIS IS AND IS NOT: a source-text pin, not a render test. The list
 * page is ~1.5k lines and pulls in the router, auth and half the service layer,
 * so a DOM test would mock more than it proves. What CAN silently break here is
 * exactly what text can pin: the column writing through the WRONG route. The
 * main `PUT /hook/:id` drops `follow_player_status` by design and answers 200,
 * so a mistake there looks like success and changes nothing — no error, no
 * failing test, just a switch that never sticks. เขียนผิด route = 200 แต่ไม่เปลี่ยนอะไร.
 *
 * The behaviour of the value itself (the boolean, the gate, the body) is tested
 * for real in hookNoticeTab.dom.test.tsx and noticeCardGate.value.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'pages/hook/WebhookList.tsx'),
  'utf8',
);

describe('⭐ the follower toggle is wired to its own route', () => {
  it('⭐ it writes through updateHookNotice, never through updateHook', () => {
    const at = src.indexOf("toggleConfirm.field === 'follow_player_status'");
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, at + 900);
    expect(branch).toContain('webhookService.updateHookNotice(');
    expect(branch).toContain('follow_player_status: toggleConfirm.nextValue === 1');
    // the main route would answer 200 and drop the field
    expect(branch).not.toContain('updateHook(');
  });

  it('⭐ the cell reads the column with === true, the lean rule the BE uses', () => {
    expect(src).toContain('follow_player_status === true');
    // a truthy read would switch the wrong way on the string "false"
    expect(src).not.toMatch(/on=\{!!\(hook as any\)\.follow_player_status\}/);
  });

  it('⭐ it does NOT write a second audit row — the route writes one already', () => {
    expect(src).toContain(
      "if (toggleConfirm.field !== 'follow_player_status')",
    );
  });

  it('⭐ the column has a header key, and both locales carry it', () => {
    expect(src).toContain("t('webhook_list.header_follow_player')");
    for (const locale of ['th', 'en']) {
      const dict = JSON.parse(
        readFileSync(
          join(process.cwd(), `i18n/translations/${locale}.json`),
          'utf8',
        ),
      ) as Record<string, string>;
      expect(dict['webhook_list.header_follow_player']).toBeTruthy();
      expect(dict['webhook_list.toggle_field_follow_player']).toBeTruthy();
    }
  });

  it('⭐ every toggle still goes through the confirm modal — none writes on click', () => {
    /* owner's rule for this table: a switch that changes an OA asks first. */
    const cells = [...src.matchAll(/onClick=\{\(\) => openToggleModal\(hook, '([a-z_]+)'\)\}/g)]
      .map((m) => m[1]);
    expect(cells).toEqual(['status', 'follow_player_status']);
  });
});

/**
 * [REFACTOR-20260819-DIVIDERDOOR] ONE door for the `direct_ticket` divider.
 *
 * The sentence an admin reads when the system opened a case was built in THREE
 * places (one create + two retitles), with the filter, the sort and the wording
 * copied verbatim — comments included. Nothing failed when they drifted; two
 * transcripts simply said different things.
 *
 * These tests pin the door itself AND the fact that it is the only one: a
 * source-assert counts the places that build the sentence or reach for a
 * `direct_ticket` divider, because a fourth copy would pass every behavioural
 * test ever written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  directTicketDividerText,
  updateLatestDirectTicketDivider,
} from '@/modules/tickets/ticket-divider.helper';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/**
 * Source WITHOUT comments. Several files explain this divider in prose — one of
 * them quotes the sentence inside a block comment — and a naive line filter
 * counted that as a second author. Comments describe the rule; only code can
 * break it. คอมเมนต์อธิบายได้ ไม่นับว่าเป็นคนประกอบข้อความ.
 */
const codeOnly = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const codeLines = (text: string, needle: string): string[] =>
  codeOnly(text)
    .split('\n')
    .filter((l) => l.includes(needle));

describe('[REFACTOR-20260819-DIVIDERDOOR] the wording has one author', () => {
  it('builds the admin-facing sentence', () => {
    expect(directTicketDividerText('ยอดไม่ตรง')).toBe(
      'เคสนี้สร้างโดยระบบ เนื่องจาก ยอดไม่ตรง',
    );
  });

  it('is the ONLY place in src that composes it', () => {
    const files = [
      'src/modules/tickets/ticket-divider.helper.ts',
      'src/modules/payment/payment-ticket.helper.ts',
      'src/modules/payment/payment-runner.service.ts',
    ];
    const authors = files.flatMap((f) =>
      codeLines(src(f), 'เคสนี้สร้างโดยระบบ เนื่องจาก').map(() => f),
    );
    expect(authors).toEqual(['src/modules/tickets/ticket-divider.helper.ts']);
  });

  it('is the ONLY place that reaches for a direct_ticket divider row', () => {
    const files = [
      'src/modules/tickets/ticket-divider.helper.ts',
      'src/modules/payment/payment-ticket.helper.ts',
    ];
    const writers = files.flatMap((f) =>
      codeLines(src(f), "'metadata.variant': 'direct_ticket'").map(() => f),
    );
    expect(writers).toEqual(['src/modules/tickets/ticket-divider.helper.ts']);
  });
});

describe('[REFACTOR-20260819-DIVIDERDOOR] the update itself is unchanged', () => {
  const makeDeps = () => {
    const exec = jest.fn().mockResolvedValue({ _id: 'msg-1' });
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    return {
      deps: {
        chatMessageModel: { findOneAndUpdate } as never,
        warn: jest.fn(),
      },
      findOneAndUpdate,
      exec,
    };
  };

  it('targets the NEWEST divider of that room only', async () => {
    const { deps, findOneAndUpdate } = makeDeps();
    const ok = await updateLatestDirectTicketDivider(
      { roomId: 'room-1', reason: 'ยอดไม่ตรง' },
      deps,
    );
    expect(ok).toBe(true);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      room_id: 'room-1',
      message_type: 'divider',
      'metadata.variant': 'direct_ticket',
    });
    expect(update).toEqual({
      $set: { content: 'เคสนี้สร้างโดยระบบ เนื่องจาก ยอดไม่ตรง' },
    });
    // newest first — older dividers carry earlier amounts and must not move
    expect(options).toEqual({ sort: { created_at: -1 } });
  });

  it('a blank reason leaves the existing wording alone', async () => {
    const { deps, findOneAndUpdate } = makeDeps();
    expect(
      await updateLatestDirectTicketDivider(
        { roomId: 'r', reason: '   ' },
        deps,
      ),
    ).toBe(false);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('no room means nothing is touched', async () => {
    const { deps, findOneAndUpdate } = makeDeps();
    expect(
      await updateLatestDirectTicketDivider(
        { roomId: null, reason: 'x' },
        deps,
      ),
    ).toBe(false);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('never throws — the customer reply already went out', async () => {
    const warn = jest.fn();
    const deps = {
      chatMessageModel: {
        findOneAndUpdate: () => ({
          exec: () => Promise.reject(new Error('boom')),
        }),
      } as never,
      warn,
    };
    expect(
      await updateLatestDirectTicketDivider({ roomId: 'r', reason: 'x' }, deps),
    ).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

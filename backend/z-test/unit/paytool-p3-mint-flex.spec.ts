import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

import type { PaymentRunResult } from '@/modules/payment';
import { LineApiService } from '@/modules/webhook';
import {
  buildMintFlex,
  buildRetryPostbackData,
  MINT_FLEX_ALT_TEXT,
  PAYMENT_POSTBACK_PREFIX,
} from '@/modules/webhook/payment-reply';
import { STATE_NOTES } from '@/modules/webhook/payment-reply/payment-mint-flex.builder';

/**
 * [FEAT-20260808-PAYTOOL-P3] checkpoint 3a — the two RENDER/TRANSPORT pieces the
 * payment reply needs, before anything is wired into the webhook.
 *
 * Scope, stated plainly: this pins (1) the mint flex bubble the `review` state
 * renders and (2) that `sendLinePushFlexMessage` puts a FLEX on the push
 * endpoint. It does NOT prove the webhook sends either — no seam exists yet
 * (that is 3c), so there is nothing end-to-end to drive. Same limitation, and
 * the same reason, as line-api.spec.ts.
 *
 * WHY THE PUSH-FLEX CASE MATTERS: the fallback for a spent reply token used to
 * be text-only (`sendLinePushMessage`), which would DROP the retry /
 * contact-admin buttons on the money path. The chosen design keeps ONE delivery
 * rule — same kind, different pipe — instead of a text/flex mode flag whose
 * unused branch would rot. These tests are what stop that regressing.
 *
 * NO REAL LINE TRAFFIC: axios.post/get and fetch are stubbed to REJECT by
 * default, so an unstubbed call fails loudly with its URL. Credentials are
 * obvious fakes.
 */

const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
const FAKE_USER_ID = 'unit-test-user-id';
const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const TIMEOUT_MS = 15_000;

const lineOk = (data: unknown = {}): AxiosResponse<unknown> =>
  ({
    status: 200,
    statusText: 'OK',
    data,
    headers: {},
    config: {},
  }) as unknown as AxiosResponse<unknown>;

interface PostCall {
  url: string;
  body: Record<string, unknown>;
  config: { headers: Record<string, string>; timeout: number };
}

/** A `review` reply exactly as the runner emits it (P2C + P2B `detail`). */
const reviewReply = (
  over: Partial<NonNullable<PaymentRunResult['reply']>> = {},
): NonNullable<PaymentRunResult['reply']> => ({
  state: 'review',
  kind: 'flex',
  text: 'ไม่สามารถดำเนินรายการอัตโนมัติได้ กรุณาลองใหม่อีกครั้งหรือติดต่อแอดมิน',
  actions: ['retry', 'contact_admin'],
  detail: '-',
  ...over,
});

type FlexBox = {
  type: string;
  layout: string;
  contents: Record<string, unknown>[];
};

const bodyOf = (flex: Record<string, unknown>): FlexBox =>
  flex['body'] as FlexBox;
const footerOf = (flex: Record<string, unknown>): FlexBox | undefined =>
  flex['footer'] as FlexBox | undefined;

describe('[P3-3a] payment mint flex builder', () => {
  it('renders a bubble carrying the runner text and the detail line', () => {
    const flex = buildMintFlex(reviewReply({ detail: 'ยอด 500 บาท' }));

    expect(flex['type']).toBe('bubble');

    const texts = bodyOf(flex)
      .contents.filter((c) => c['type'] === 'text')
      .map((c) => c['text']);

    // The runner owns the copy (config-overridable per tool); the builder must
    // pass it through verbatim rather than restating it.
    expect(texts).toContain(reviewReply().text);
    expect(texts).toContain('ยอด 500 บาท');
  });

  it('renders the detail row even when unset, because the runner sends "-"', () => {
    // P2B guarantees `detail` is never empty, so there is deliberately no
    // empty-string branch in the builder. This pins that guarantee's effect.
    const flex = buildMintFlex(reviewReply({ detail: '-' }));
    const texts = bodyOf(flex)
      .contents.filter((c) => c['type'] === 'text')
      .map((c) => c['text']);

    expect(texts).toContain('-');
  });

  it('[2c] renders retry as a POSTBACK carrying the run + next statement', () => {
    // The agreed behaviour (1ans.md §3): tapping [ลองใหม่] resumes the SAME run
    // at the NEXT statement with the stored slip image — no re-photographing.
    // Superseded the interim `cameraRoll` once the payment postback handler
    // existed (2c-2).
    const flex = buildMintFlex(reviewReply(), {
      resume: { runId: 'RUN123', nextIdx: 3 },
    });
    const actions = (footerOf(flex)?.contents ?? []).map(
      (b) => b['action'] as Record<string, unknown>,
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]?.['type']).toBe('postback');
    expect(actions[0]?.['data']).toBe('pay:resume:RUN123:3');
    expect(actions[1]?.['type']).toBe('message');

    // Every button must carry a non-empty label, or LINE rejects the message.
    for (const a of actions) {
      expect(typeof a['label']).toBe('string');
      expect((a['label'] as string).length).toBeGreaterThan(0);
    }
  });

  it('[2c] omits the retry button when there is nothing to resume to', () => {
    // `review` means timeout / exhausted / ambiguous — there is no next
    // statement. Offering "ลองใหม่" there would be a lie that re-opens a
    // money-unknown case, so the button is dropped, not rendered dead.
    const flex = buildMintFlex(reviewReply()); // no resume context
    const actions = (footerOf(flex)?.contents ?? []).map(
      (b) => b['action'] as Record<string, unknown>,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.['type']).toBe('message'); // contact_admin survives
    expect(actions.map((a) => a['type'])).not.toContain('postback');
  });

  it('[2c] round-trips the postback payload through the handler', () => {
    // The builder and the parser must agree on the format forever. Pinning the
    // round trip is what stops them drifting apart.
    const data = buildRetryPostbackData('RUN9', 7);
    expect(data.startsWith(PAYMENT_POSTBACK_PREFIX)).toBe(true);

    const parts = data.split(':');
    expect(parts[1]).toBe('resume');
    expect(parts[2]).toBe('RUN9');
    expect(Number(parts[3])).toBe(7);
  });

  it('omits the footer entirely when there are no actions', () => {
    // An empty footer box renders as a bare grey strip, so it must not exist.
    const flex = buildMintFlex(reviewReply({ actions: [] }));
    expect(footerOf(flex)).toBeUndefined();
  });

  it('drops an unknown action instead of emitting a broken button', () => {
    const flex = buildMintFlex(
      reviewReply({
        actions: ['retry', 'not_a_real_action'] as never,
      }),
      { resume: { runId: 'RUN1', nextIdx: 1 } },
    );
    const actions = (footerOf(flex)?.contents ?? []).map(
      (b) => b['action'] as Record<string, unknown>,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.['type']).toBe('postback');
  });

  it('is a pure function — same input, structurally equal output', () => {
    // No I/O, no clock, no DB: what makes this unit-testable without mocks and
    // safe to call from either webhook seam.
    expect(buildMintFlex(reviewReply())).toEqual(buildMintFlex(reviewReply()));
  });
});

describe('[P3-3a] [ASK-OWNER] open-question register', () => {
  // WHY THIS TEST EXISTS: the unconfirmed decisions in this feature are the ones
  // most likely to be quietly inherited — code that "works" is easy to mistake
  // for code that was AGREED. These assertions make the register a build
  // artefact: an open question cannot be silently deleted, and a new one cannot
  // be added without also recording it where the owner will see it.
  const readFile = (p: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(p, 'utf8');

  const BUILDER =
    'src/modules/webhook/payment-reply/payment-mint-flex.builder.ts';
  const INDEX = 'src/modules/webhook/payment-reply/index.ts';
  // [FEAT-20260809-PAYTOOL-COPY] The customer-facing STRINGS moved out of the
  // builder into this copy file, and two OWNER-DECIDED records (button labels,
  // altText) travelled WITH the copy they annotate. The assertion below is
  // unchanged in strength — still ≥3 records — it just now reads both files,
  // because that is where the same three decisions live after the move.
  const COPY = 'src/modules/payment/payment-reply-copy.ts';

  it('records an answered decision as OWNER-DECIDED, not as silent code', () => {
    const decisions = [BUILDER, COPY].map(readFile).join('\n');

    // 2026-08-08: labels/altText (#2) and card design (#3) were ANSWERED, so
    // their [ASK-OWNER] tags are gone by design. What must NOT vanish with them
    // is the record of who decided and when — otherwise a future reader cannot
    // tell an agreed choice from an assumption someone typed.
    expect(decisions.match(/OWNER-DECIDED/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('[2c] no longer carries the interim retry placeholder', () => {
    const builder = readFile(BUILDER);

    // The interim `cameraRoll` existed only because no postback handler was
    // found. One exists (payment-postback.handler.ts), so the agreed behaviour
    // is now implemented and the placeholder — and its KNOWN-WRONG warning —
    // must be gone. This test is the proof the debt was paid, not deferred.
    expect(builder).not.toContain('cameraRoll');
    expect(builder).not.toMatch(/REPLACE IN 2c/);
    expect(builder).toContain('buildRetryPostbackData');
  });

  it('documents every runner reply state, so copy edits know what they describe', () => {
    // STATE_NOTES is the human-readable map of what each state MEANS. It must
    // stay complete: a state added to the runner without a note here leaves the
    // next person editing customer copy guessing.
    /* [DEMO-20261019] alphabetical: 'walletpay_success' sorts last since the demo rename. */
    expect(Object.keys(STATE_NOTES).sort()).toEqual([
      'matched_pending',
      'no_match_retry',
      'not_linked',
      'review',
      'statement_not_found',
      'topup_success',
      'walletpay_success',
    ]);
  });

  it('keeps the register in index.ts pointing at the same grep tag', () => {
    const index = readFile(INDEX);
    expect(index).toContain('ASK-OWNER');
    expect(index).toMatch(/BEFORE GO-LIVE/);
    // The register must tell a future session how to clear an entry, or it rots
    // into a list nobody trusts.
    expect(index).toMatch(/DELETE its/i);
  });

  it('keeps answered decisions in the register instead of dropping them', () => {
    const index = readFile(INDEX);

    // An answered question that simply disappears is indistinguishable from one
    // nobody ever asked. Answers stay, dated, with the decision recorded.
    expect(index).toMatch(/ANSWERED 2026-08-08/);

    // The two answers that are agreed but NOT yet built must stay visible as
    // pending work, or 2c silently ships without them.
    expect(index).toMatch(/PENDING IMPLEMENTATION/);
    expect(index).toMatch(/2c/);

    // The accepted external dependency (Shop-API dedupes duplicate slip images)
    // must remain stated — it is a money-path assumption, not a fact we own.
    expect(index).toMatch(/Shop-API/);
  });
});

describe('[P3-3a] LineApiService.sendLinePushFlexMessage', () => {
  let service: LineApiService;
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );

    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    getSpy = jest
      .spyOn(axios, 'get')
      .mockImplementation((url: unknown) => reject(url));
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const moduleRef = await Test.createTestingModule({
      providers: [LineApiService],
    }).compile();
    service = moduleRef.get(LineApiService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const postCall = (n = 0): PostCall => {
    const call = postSpy.mock.calls[n] as unknown[];
    return {
      url: call[0] as string,
      body: call[1] as Record<string, unknown>,
      config: call[2] as PostCall['config'],
    };
  };

  it('posts a FLEX message to the push endpoint keyed by `to`', async () => {
    const response = lineOk({ sentMessages: [] });
    postSpy.mockResolvedValueOnce(response);
    const contents = buildMintFlex(reviewReply());

    const result = await service.sendLinePushFlexMessage(
      FAKE_TOKEN,
      FAKE_USER_ID,
      contents,
      MINT_FLEX_ALT_TEXT,
    );

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    const { url, body, config } = postCall();
    expect(url).toBe(PUSH_URL);
    expect(body).toEqual({
      to: FAKE_USER_ID,
      messages: [{ type: 'flex', altText: MINT_FLEX_ALT_TEXT, contents }],
    });
    expect(config.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });
    expect(config.timeout).toBe(TIMEOUT_MS);
    expect(result).toBe(response);
  });

  it('carries the action buttons through the push pipe — the whole point', async () => {
    // The regression this method exists to prevent: falling back through the
    // text-only `sendLinePushMessage` would strip retry / contact-admin.
    postSpy.mockResolvedValueOnce(lineOk());

    await service.sendLinePushFlexMessage(
      FAKE_TOKEN,
      FAKE_USER_ID,
      buildMintFlex(reviewReply(), {
        resume: { runId: 'RUN1', nextIdx: 1 },
      }),
      MINT_FLEX_ALT_TEXT,
    );

    const messages = postCall().body['messages'] as Record<string, unknown>[];
    const sent = messages[0]?.['contents'] as Record<string, unknown>;
    const footer = footerOf(sent);

    expect(footer?.contents).toHaveLength(2);
  });

  it('lets a rejection escape unchanged, without retrying', async () => {
    // Matches the two reply helpers: the caller owns the failure. A reply token
    // is single-use, so nothing in this file may add a retry.
    const failure = new Error('Request failed with status code 401');
    postSpy.mockRejectedValueOnce(failure);

    await expect(
      service.sendLinePushFlexMessage(FAKE_TOKEN, FAKE_USER_ID, {}),
    ).rejects.toBe(failure);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves the legacy text push untouched', () => {
    // Additive sibling, not an edit: `sendLinePushMessage` keeps its exact
    // legacy arity (token, userId, text) and its existing callers.
    expect(service.sendLinePushMessage.length).toBe(3);
  });
});

import {
  buildCustomerRegisterFlex,
  buildCustomerRegisterUrl,
  CUSTOMER_REGISTER_KEYWORD,
  type CustomerRegisterArgs,
  type CustomerRegisterDeps,
  type CustomerRegisterEvent,
  handleCustomerRegisterKeyword,
} from '@/modules/webhook';

/**
 * [FIX-20260808-CUSTREG] The `customer-register` keyword handler —
 * legacy webhookController.js `handleCustomerRegisterKeyword`.
 *
 * WHY A UNIT TEST: reaching the handler through `POST /webhook` needs the exact
 * keyword on an OA with `customer_link_enabled === true`, plus LINE + Mongo.
 * The two are the caller's guard (verified by reading the wire, per the port
 * note) — this spec drives the handler directly with faked deps. Nothing here
 * opens a socket: `sendLineReplyMessage` / `sendLineFlexReply` are jest.fn()s and
 * the member lookup is a stubbed Mongoose query.
 */

const HOOK_ID = 'a0d000000000000000000014';
const USER_ID = 'Ucustrega0d000000000000000000012';

/** A Mongoose query stub whose chain resolves to `result`. */
function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'lean', 'sort', 'limit']) q[m] = () => q;
  q['exec'] = () => Promise.resolve(result);
  return q;
}

interface HarnessOptions {
  /** The Member the lookup returns. null = no member (not registered). */
  member?: Record<string, unknown> | null;
  /** Make the member lookup throw (legacy treats it as "not linked"). */
  lookupThrows?: boolean;
  /** Make mintLinkToken throw. */
  mintThrows?: boolean;
  /** Force mintLinkToken to return an empty string. */
  emptyToken?: boolean;
  /** Landing url on the hook. */
  landing?: string | null;
}

function harness(opts: HarnessOptions = {}) {
  const member = opts.member === undefined ? null : opts.member;

  const sendLineReplyMessage = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { ok: true } });
  const sendLineFlexReply = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { ok: true } });
  const persistWebhookLog = jest.fn().mockResolvedValue(undefined);
  const logMessage = jest.fn();
  const mintLinkToken = jest.fn(() =>
    opts.mintThrows
      ? ((): string => {
          throw new Error('mint boom');
        })()
      : opts.emptyToken
        ? ''
        : 'TESTTOKEN',
  );

  const deps: CustomerRegisterDeps = {
    memberModel: {
      findOne: () =>
        opts.lookupThrows
          ? {
              select: () => ({
                lean: () => ({
                  exec: () => Promise.reject(new Error('db down')),
                }),
              }),
            }
          : query(member),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    mintLinkToken,
    sendLineReplyMessage,
    sendLineFlexReply,
    persistWebhookLog,
    logMessage,
  };

  const event: CustomerRegisterEvent = {
    replyToken: 'reply-abc',
    eventId: 'evt-1',
    message: { type: 'text', text: CUSTOMER_REGISTER_KEYWORD },
  };

  const args: CustomerRegisterArgs = {
    userId: USER_ID,
    hook: {
      _id: HOOK_ID,
      channel_type: 'line',
      customer_link_landing_url:
        opts.landing === undefined ? 'https://land.example' : opts.landing,
    },
    event,
    accessToken: 'access-token',
    logContext: { hook_id: HOOK_ID },
    channelId: 'chan-1',
  };

  return {
    args,
    deps,
    fns: {
      sendLineReplyMessage,
      sendLineFlexReply,
      persistWebhookLog,
      logMessage,
      mintLinkToken,
    },
  };
}

describe('handleCustomerRegisterKeyword', () => {
  it('sends the register Flex when the member is not registered', async () => {
    const { args, deps, fns } = harness({ member: null });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: true });
    expect(fns.mintLinkToken).toHaveBeenCalledTimes(1);
    expect(fns.sendLineFlexReply).toHaveBeenCalledTimes(1);
    expect(fns.sendLineReplyMessage).not.toHaveBeenCalled();
    // altText verbatim from legacy.
    expect(fns.sendLineFlexReply.mock.calls[0][3]).toBe('ลงทะเบียนสมาชิก');
    // Token never appears in the webhook log — only the landing base.
    const logRow = fns.persistWebhookLog.mock.calls[0][0];
    expect(logRow.action_type).toBe('custreg_send_link');
    expect(JSON.stringify(logRow)).not.toContain('TESTTOKEN');
    // History bubble is the fixed placeholder, not the URL.
    expect(fns.logMessage.mock.calls[0][0].content).toBe(
      '[ส่งลิงก์ลงทะเบียนสมาชิก]',
    );
  });

  it('replies with the confirm text when already registered (no mint)', async () => {
    const { args, deps, fns } = harness({
      member: { full_name: 'สมชาย ใจดี', raw_profile_data: { x: 1 } },
    });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: true });
    expect(fns.mintLinkToken).not.toHaveBeenCalled();
    expect(fns.sendLineFlexReply).not.toHaveBeenCalled();
    expect(fns.sendLineReplyMessage).toHaveBeenCalledTimes(1);
    expect(fns.sendLineReplyMessage.mock.calls[0][2]).toBe(
      'คุณ สมชาย ใจดี ได้ลงทะเบียน เรียบร้อยแล้ว',
    );
    expect(fns.persistWebhookLog.mock.calls[0][0].action_type).toBe(
      'custreg_already_linked',
    );
  });

  it('treats a member with only full_name as NOT registered', async () => {
    // Needs BOTH full_name and raw_profile_data — one alone falls through.
    const { args, deps, fns } = harness({
      member: { full_name: 'ครึ่งทาง', raw_profile_data: null },
    });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: true });
    expect(fns.sendLineFlexReply).toHaveBeenCalledTimes(1);
    expect(fns.sendLineReplyMessage).not.toHaveBeenCalled();
  });

  it('no-ops with handled=false when there is no replyToken', async () => {
    const { args, deps, fns } = harness({ member: null });
    args.event = { message: { type: 'text', text: CUSTOMER_REGISTER_KEYWORD } };

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: false });
    expect(fns.sendLineFlexReply).not.toHaveBeenCalled();
    expect(fns.sendLineReplyMessage).not.toHaveBeenCalled();
    expect(fns.mintLinkToken).not.toHaveBeenCalled();
  });

  it('no-ops with handled=false when there is no userId', async () => {
    const { args, deps } = harness({ member: null });
    args.userId = undefined;

    const res = await handleCustomerRegisterKeyword(args, deps);
    expect(res).toEqual({ handled: false });
  });

  it('falls through (handled=false) when mintLinkToken throws', async () => {
    const { args, deps, fns } = harness({ member: null, mintThrows: true });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: false });
    expect(fns.sendLineFlexReply).not.toHaveBeenCalled();
  });

  it('falls through when mintLinkToken returns an empty token', async () => {
    const { args, deps, fns } = harness({ member: null, emptyToken: true });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: false });
    expect(fns.sendLineFlexReply).not.toHaveBeenCalled();
  });

  it('treats a member lookup failure as not-registered and still sends the link', async () => {
    const { args, deps, fns } = harness({ lookupThrows: true });

    const res = await handleCustomerRegisterKeyword(args, deps);

    expect(res).toEqual({ handled: true });
    expect(fns.sendLineFlexReply).toHaveBeenCalledTimes(1);
  });
});

describe('buildCustomerRegisterUrl', () => {
  it('appends token + openExternalBrowser=0 for a normal landing', () => {
    expect(buildCustomerRegisterUrl('https://land.example/', 'TOK')).toBe(
      'https://land.example/?t=TOK&openExternalBrowser=0',
    );
  });

  it('uses the central default when no landing is set', () => {
    expect(buildCustomerRegisterUrl(null, 'TOK')).toBe(
      'https://customer.example.comm/?t=TOK&openExternalBrowser=0',
    );
  });

  it('drops openExternalBrowser=0 for a LIFF landing', () => {
    expect(
      buildCustomerRegisterUrl('https://liff.line.me/1657-abcd', 'TOK'),
    ).toBe('https://liff.line.me/1657-abcd?t=TOK');
  });

  it('url-encodes the token', () => {
    expect(buildCustomerRegisterUrl('https://x.io', 'a b/c')).toContain(
      't=a%20b%2Fc',
    );
  });
});

describe('buildCustomerRegisterFlex', () => {
  it('embeds the register url in the button action and keeps the label', () => {
    const flex = buildCustomerRegisterFlex('https://x.io/?t=TOK') as {
      footer: { contents: Array<Record<string, unknown>> };
    };
    const button = flex.footer.contents.find((c) => c['type'] === 'button') as {
      action: { uri: string; label: string };
    };
    expect(button.action.uri).toBe('https://x.io/?t=TOK');
    expect(button.action.label).toBe('ลงทะเบียน');
  });
});

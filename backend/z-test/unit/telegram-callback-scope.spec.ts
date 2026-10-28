/**
 * [FIX-20260818-TGSCOPE] plan §2.4 B3 = T2-1 of fix_plan_18_aug · closes C5
 *
 * ## What was open
 * The Telegram callback parsed `action:alias:mongoChatId` out of the payload and
 * then wrote `assist_status` on `mongoChatId` ALONE — `alias`, the only field
 * naming an OA, was never used for the write. It was read afterwards, purely to
 * find the bot key for the reply. So a room id was the whole authorisation: any
 * id flipped any room's assist state, in any OA.
 *
 * The secret check in front of it is skipped entirely when
 * `TELEGRAM_WEBHOOK_SECRET` is unset — fail-open — which is what made the route
 * reachable in the first place.
 *
 * ## The fix, and why the order matters
 * The hook is resolved BEFORE the write. That lets the handler do two things it
 * could not do afterwards: refuse when the OA has no `telegram_key` (so a
 * deployment nobody configured — every OA today, 0 of 7 — is inert without
 * anyone remembering an env var), and scope the write to that OA's rooms.
 *
 * ⚠️ `.populate('user_id','display_name')` MUST survive: `displayName` is read
 * from it into the card text. The plan's own snippet dropped it, which would
 * have made every card say "ลูกค้า" — pinned below.
 */
import { WebhookService } from '@/modules/webhook';

const ALIAS = 'demo-oa-three';
const HOOK_A = 'a0d000000000000000000043';
const ROOM = 'a0d000000000000000000045';

type Seen = { filter?: Record<string, unknown>; populated?: string[] };

const buildService = (opts: {
  telegramKey?: string | null;
  room?: Record<string, unknown> | null;
}) => {
  const seen: Seen = {};
  const svc = Object.create(WebhookService.prototype) as Record<
    string,
    unknown
  >;

  svc.channel = { telegramWebhookSecret: undefined };
  svc.logger = {
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
  };
  svc.crypto = { safeDecrypt: (v: string) => (v ? `plain:${v}` : null) };
  svc.hookCache = {
    getHookByAlias: () =>
      Promise.resolve(
        opts.telegramKey === null
          ? { _id: HOOK_A }
          : { _id: HOOK_A, telegram_key: opts.telegramKey ?? 'enc:tg' },
      ),
  };
  svc.chatRoomModel = {
    findOneAndUpdate: (filter: Record<string, unknown>) => {
      seen.filter = filter;
      return {
        populate: (path: string) => {
          seen.populated = [...(seen.populated ?? []), path];
          return { exec: () => Promise.resolve(opts.room ?? null) };
        },
      };
    },
  };
  return { svc: svc as unknown as WebhookService, seen };
};

const callback = (action: string) => ({
  callback_query: {
    id: 'cb1',
    data: `${action}:${ALIAS}:${ROOM}`,
    from: { first_name: 'A' },
    message: { chat: { id: 1 }, message_id: 2 },
  },
});

describe('[TGSCOPE] the callback may only touch a room of the OA it names', () => {
  it('⭐ the write is scoped by hook_id, not by room id alone', async () => {
    const { svc, seen } = buildService({ room: { user_id: null } });

    await svc.processTelegramWebhook(callback('on'), {});

    expect(seen.filter).toEqual({ _id: ROOM, hook_id: HOOK_A });
  });

  it('⭐ the display-name populate survives — the card would say "ลูกค้า" without it', async () => {
    const { svc, seen } = buildService({ room: { user_id: null } });
    await svc.processTelegramWebhook(callback('on'), {});
    expect(seen.populated).toContain('user_id');
  });

  it('⭐ an OA with no telegram_key does nothing at all — no write', async () => {
    const { svc, seen } = buildService({ telegramKey: null });
    await svc.processTelegramWebhook(callback('on'), {});
    expect(seen.filter).toBeUndefined();
  });

  it('a key whose ciphertext no longer decrypts counts as not configured', async () => {
    const { svc, seen } = buildService({ telegramKey: '' });
    await svc.processTelegramWebhook(callback('off'), {});
    expect(seen.filter).toBeUndefined();
  });

  it('a malformed payload is still ignored quietly, unchanged', async () => {
    const { svc, seen } = buildService({ room: null });
    await svc.processTelegramWebhook(
      { callback_query: { id: 'x', data: 'only:two' } },
      {},
    );
    expect(seen.filter).toBeUndefined();
  });
});

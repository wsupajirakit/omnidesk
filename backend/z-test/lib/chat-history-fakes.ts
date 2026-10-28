/**
 * Fake Mongoose models for the chat-history port.
 *
 * Shared by two specs on purpose:
 *   - `z-test/unit/chat-history.spec.ts` drives the port through them and
 *     asserts each documented behaviour by name.
 *   - `z-test/unit/chat-history-parity.spec.ts` drives the LEGACY JavaScript
 *     and the port through the SAME fakes and diffs what each asked the models
 *     to do.
 *
 * The second use is the reason the fakes record calls rather than just
 * returning canned values: the service is a write path, so "what it asked the
 * database to do" IS its behaviour, and that is what has to match.
 *
 * These fakes are scripted, not a Mongo emulator. Every value they return is
 * stated by the scenario, so a test cannot pass because the fake guessed the
 * same wrong thing the port did.
 */

/** One model method call, in order, with the arguments as they were passed. */
export interface CallRecord {
  model: string;
  op: string;
  args: unknown[];
}

/** A realtime event as it would reach Redis — i.e. after the publisher's own
 * "no hook_id, no publish" guard, which both sides have. */
export interface PublishRecord {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Everything the fakes will return, stated up front.
 *
 * `undefined` means "the scenario does not exercise this call". A scenario that
 * reaches an unstated call gets `null`, which is a visible result rather than a
 * silent success.
 */
export interface ChatHistoryScenario {
  /** `Member.findOne({ member_user_id })` — the Phase 3.1e read-cutover read. */
  memberFindOne?: Record<string, unknown> | null;
  /** `Member.findOneAndUpdate(...)` — the placeholder upsert. */
  memberUpsert?: Record<string, unknown> | null;
  /** First `ChatRoom.findOneAndUpdate(...)` — the upsert. Throws when this is
   * an `Error`, which is how the E11000 branch is reached. */
  roomUpsert?: Record<string, unknown> | Error | null;
  /** Second `ChatRoom.findOneAndUpdate(...)` — the E11000 recovery. */
  roomRecovery?: Record<string, unknown> | Error | null;
  /** `ChatRoom.findOne(...).select(...).lean()` — logSystemMessage only. */
  roomFindOne?: Record<string, unknown> | null;
  /** `ChatRoom.updateOne(...)` result. */
  roomUpdateResult?: { modifiedCount: number };
  /** `ChatMessage.findOne({ provider_msg_id })` — the duplicate check. */
  messageFindOne?: Record<string, unknown> | null;
  /** `Hook.findById(...).select('channel_type').lean()`. */
  hookFindById?: { channel_type?: string } | null;
  /** Thrown by `message.save()` when set. */
  messageSaveError?: Error;
}

/** Deterministic so the two sides' returned documents compare by value. */
export const FAKE_MESSAGE_ID = 'fake-message-id';
export const FAKE_CREATED_AT = new Date('2026-01-02T03:04:05.000Z');
export const FAKE_DB_NAME = 'fake_db';

export interface ChatHistoryFakes {
  calls: CallRecord[];
  publishes: PublishRecord[];
  Member: unknown;
  ChatRoom: unknown;
  ChatMessage: unknown;
  Hook: unknown;
  /** Stands in for `RealtimePublisherService`. */
  publisher: {
    publish: (type: string, data: Record<string, unknown>) => Promise<void>;
  };
  /** Stands in for legacy's `wsPublisher.publishMessageEvent`. */
  publishMessageEvent: (data: Record<string, unknown>, type?: string) => void;
}

/** `undefined` is "unstated"; anything else (including null) is the answer. */
function stated<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

export function createChatHistoryFakes(
  scenario: ChatHistoryScenario = {},
): ChatHistoryFakes {
  const calls: CallRecord[] = [];
  const publishes: PublishRecord[] = [];
  const record = (model: string, op: string, args: unknown[]): void => {
    calls.push({ model, op, args });
  };

  let roomUpdateCalls = 0;

  const Member = {
    findOne: (...args: unknown[]) => {
      record('Member', 'findOne', args);
      return Promise.resolve(stated(scenario.memberFindOne, null));
    },
    findOneAndUpdate: (...args: unknown[]) => {
      record('Member', 'findOneAndUpdate', args);
      return Promise.resolve(stated(scenario.memberUpsert, null));
    },
  };

  const ChatRoom = {
    findOneAndUpdate: (...args: unknown[]) => {
      record('ChatRoom', 'findOneAndUpdate', args);
      roomUpdateCalls += 1;
      // Call 1 is the upsert; call 2 is the E11000 recovery. Dispatching by
      // ordinal keeps the fake from having to understand the query.
      const configured =
        roomUpdateCalls === 1 ? scenario.roomUpsert : scenario.roomRecovery;
      // A rejected promise, not a synchronous throw — that is how Mongoose
      // surfaces a write error, and both call sites `await` it inside a `try`.
      if (configured instanceof Error) return Promise.reject(configured);
      return Promise.resolve(stated(configured, null));
    },
    findOne: (...args: unknown[]) => {
      record('ChatRoom', 'findOne', args);
      return {
        select: (...selectArgs: unknown[]) => {
          record('ChatRoom', 'findOne.select', selectArgs);
          return {
            lean: () => {
              record('ChatRoom', 'findOne.lean', []);
              return Promise.resolve(stated(scenario.roomFindOne, null));
            },
          };
        },
      };
    },
    updateOne: (...args: unknown[]) => {
      record('ChatRoom', 'updateOne', args);
      return Promise.resolve(
        stated(scenario.roomUpdateResult, { modifiedCount: 1 }),
      );
    },
  };

  /**
   * Constructed with `new`, exactly as both implementations construct it. The
   * document it produces carries the fields it was given plus the two the
   * database would supply, so the returned value can be compared by value.
   */
  class FakeChatMessage {
    public _id = FAKE_MESSAGE_ID;
    public created_at = FAKE_CREATED_AT;

    constructor(doc: Record<string, unknown>) {
      record('ChatMessage', 'constructor', [doc]);
      Object.assign(this, doc);
    }

    save(): Promise<this> {
      record('ChatMessage', 'save', []);
      if (scenario.messageSaveError) {
        return Promise.reject(scenario.messageSaveError);
      }
      return Promise.resolve(this);
    }
  }

  const ChatMessage = Object.assign(FakeChatMessage, {
    findOne: (...args: unknown[]) => {
      record('ChatMessage', 'findOne', args);
      return Promise.resolve(stated(scenario.messageFindOne, null));
    },
    // The port logs the database name; legacy reads it off the mongoose
    // connection. Same string either way.
    db: { name: FAKE_DB_NAME },
  });

  const Hook = {
    findById: (...args: unknown[]) => {
      record('Hook', 'findById', args);
      return {
        select: (...selectArgs: unknown[]) => {
          record('Hook', 'findById.select', selectArgs);
          return {
            lean: () => {
              record('Hook', 'findById.lean', []);
              return Promise.resolve(stated(scenario.hookFindById, null));
            },
          };
        },
      };
    },
  };

  /**
   * The guard lives here for BOTH sides, because it is where legacy puts it:
   * `wsPublisher.publishMessageEvent` returns early when `data.hook_id` is
   * falsy. The port's publisher has the same guard, expressed in its type. So
   * this records what would actually reach Redis, which is what has to match.
   */
  const publishMessageEvent = (
    data: Record<string, unknown>,
    type = 'message:new',
  ): void => {
    if (!data || !data['hook_id']) return;
    publishes.push({ type, data });
  };

  return {
    calls,
    publishes,
    Member,
    ChatRoom,
    ChatMessage,
    Hook,
    publisher: {
      publish: (type: string, data: Record<string, unknown>) => {
        publishMessageEvent(data, type);
        return Promise.resolve();
      },
    },
    publishMessageEvent,
  };
}

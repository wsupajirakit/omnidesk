import {
  HANDLED,
  NOT_HANDLED,
  initialFlowState,
  type FlowState,
  type HandlerResult,
} from '../../src/modules/webhook/spine';

/**
 * [PROG-20260905-CONTRACTS] These are types and one factory, so most of their value is
 * checked by `tsc`, not here. What a runtime spec CAN pin is the handful of decisions
 * that a future reader would otherwise be free to "simplify" back into a defect.
 */
describe('[PROG-20260905-CONTRACTS] spine handler contract', () => {
  it('answers control flow, in the direction the existing handler already uses', () => {
    expect(HANDLED.handled).toBe(true);
    expect(NOT_HANDLED.handled).toBe(false);
  });

  it('cannot be mutated by a handler that receives it', () => {
    // Both are shared singletons. If one handler could flip HANDLED.handled, every later
    // gate in the same process would read the flipped value — a whole-service outage from
    // one careless line.
    expect(() => {
      HANDLED.handled = false;
    }).toThrow();
    expect(HANDLED.handled).toBe(true);
  });

  it('lets a handler build its own result without the singletons', () => {
    const custom: HandlerResult = { handled: true };
    expect(custom.handled).toBe(true);
  });
});

describe('[PROG-20260905-CONTRACTS] flow state', () => {
  it('starts in the state the spine starts a turn in today', () => {
    // These are the values the method-scope `let`s hold before any gate runs. A different
    // default here would change behaviour the day a handler starts using this carrier.
    expect(initialFlowState()).toEqual({
      skipBotProcessing: false,
      inboundRoom: null,
      forceReAssistAfterReply: false,
      autoUnassistTriggeredMinutes: null,
    });
  });

  it('gives every turn its own state — never a shared object', () => {
    const a = initialFlowState();
    const b = initialFlowState();
    a.skipBotProcessing = true;
    // Two deliveries are processed concurrently under different user locks. A shared
    // default object would leak one customer's assist flag onto another's turn.
    expect(b.skipBotProcessing).toBe(false);
  });

  it('is mutable on purpose — gates write it for later gates to read', () => {
    const state: FlowState = initialFlowState();
    state.inboundRoom = { _id: 'room-1' };
    state.autoUnassistTriggeredMinutes = 30;
    expect(state.inboundRoom).toEqual({ _id: 'room-1' });
    expect(state.autoUnassistTriggeredMinutes).toBe(30);
  });

  it('accepts a narrowed view, which is how a handler declares what it may touch', () => {
    // The point of the carrier: `tsc` enforces the write set, not a comment.
    const narrow = (s: Pick<FlowState, 'skipBotProcessing'>): void => {
      s.skipBotProcessing = true;
    };
    const state = initialFlowState();
    narrow(state);
    expect(state.skipBotProcessing).toBe(true);
    expect(state.inboundRoom).toBeNull();
  });
});

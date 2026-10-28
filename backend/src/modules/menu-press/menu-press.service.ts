/**
 * [FEAT-20260902-MENUPRESSONCE] The decision: may this press act?
 *
 * The whole rule lives in one method so there is one place to read, one place to
 * change, and one place a test can attack. Everything it needs is handed to it —
 * it looks nothing up and knows nothing about LINE.
 *
 * revert: `enabled: false` in the policy, or unbind the module (see
 * menu-press.module.ts).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEFAULT_MENU_PRESS_POLICY,
  MENU_PRESS_POLICY_TOKEN,
  pressClaimId,
  type MenuPressPolicy,
} from './menu-press.policy';
import {
  MENU_PRESS_STORE,
  type MenuPressStore,
} from './stores/menu-press.store.port';

export interface MenuPressAttempt {
  /** The stamp peeled off the payload. Absent ⇒ an unstamped card. */
  readonly render?: string;
  /** Which button — the destination already carried by the payload. */
  readonly item: string;
  readonly lineUserId: string;
  readonly hookId: string;
}

export interface MenuPressDecision {
  readonly allowed: boolean;
  /** Which press this was, when the store could answer. */
  readonly press?: number;
  /**
   * 🔴 THE RECEIPT. Present only when a reservation was actually taken, and it
   * is what the caller MUST hand back to `release` if the action the press paid
   * for never happened. Absent ⇒ nothing was reserved ⇒ nothing to give back
   * (the switch is off, the card is unstamped, or the store was unreachable).
   */
  readonly claimId?: string;
}

const ALLOW: MenuPressDecision = { allowed: true };

@Injectable()
export class MenuPressService {
  private readonly logger = new Logger(MenuPressService.name);
  private readonly policy: MenuPressPolicy;

  public constructor(
    @Inject(MENU_PRESS_STORE) private readonly store: MenuPressStore,
    @Optional()
    @Inject(MENU_PRESS_POLICY_TOKEN)
    policy?: MenuPressPolicy,
  ) {
    this.policy = policy ?? DEFAULT_MENU_PRESS_POLICY;
  }

  /**
   * Four ways to be allowed, and only one way to be refused. The order is the
   * design: every cheap, certain reason to allow is answered BEFORE the store is
   * touched, so a card outside this feature costs exactly one boolean.
   */
  public async attempt(input: MenuPressAttempt): Promise<MenuPressDecision> {
    /* 1. The switch. Nothing below runs, nothing is written. */
    if (!this.policy.enabled) return ALLOW;

    /* 2. 🔴 NO STAMP, NO BUDGET — and this is the backward-compatibility
       guarantee, not an oversight. Cards sent before this shipped are still on
       customers' screens for ever (LINE cannot delete or edit a sent message),
       and their payloads carry no render id. Refusing them would break buttons
       that worked yesterday. It is also what makes the feature revertible: stop
       stamping and every card returns to the old behaviour with no cleanup.
       ⚠️ It also means the rule is only as wide as the STAMP is. A card sent by
       a path that does not stamp has no budget and never will — see the stamping
       seam for which paths those are. */
    if (!input.render) return ALLOW;

    /* 3. Identity we cannot key on is identity we cannot enforce. Both are
       always present on a real LINE postback; this is a guard against a caller
       passing an empty string, which would collapse different people onto one
       key and let the first press spend everybody's. */
    if (!input.lineUserId || !input.hookId || !input.item) return ALLOW;

    const id = pressClaimId({
      render: input.render,
      item: input.item,
      lineUserId: input.lineUserId,
      hookId: input.hookId,
    });

    /* 🔴 RESERVED, NOT SPENT. It has to be claimed BEFORE the card is sent — two
       taps arriving together must not both pass this line — but the send can
       still fail afterwards, and then the caller gives it back with `release`.
       Charging on the way out instead would reopen the double-tap; charging on
       the way in without a release is what the first draft got wrong, and it
       cost the customer a press for OUR failure. */
    const press = await this.store.reserve(id, this.policy.ttlSeconds);

    /* 4. The store could not answer ⇒ fail open. One extra press is a far
       cheaper failure than a menu that stops working when a database blinks. */
    if (press === null) return ALLOW;

    if (press <= this.policy.max) return { allowed: true, press, claimId: id };

    /* The only refusal. Silent by policy: one log line, no LINE call, no reply.
       The caller still reports the payload as handled, so it cannot fall through
       to the text pipeline and be answered by something else. */
    this.logger.log(
      `[MENUPRESS] refused press ${press} (max ${this.policy.max}) on ${id}`,
    );
    /* Over budget. The reservation is NOT given back: the row is already past
       `max`, and staying past it is exactly the state we want. */
    return { allowed: false, press };
  }

  /**
   * Give back a reservation whose action never happened — the send threw, LINE
   * refused the token, or the door decided to stay silent.
   *
   * Takes the receipt from `attempt`, so a caller cannot release a claim it
   * never made. Safe to call for a claim that has since expired.
   */
  public async release(claimId: string): Promise<void> {
    await this.store.release(claimId);
  }
}

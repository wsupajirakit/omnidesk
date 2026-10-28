/**
 * ==== [FEAT-20260828-MENUTAG-S1] the ONE thing the webhook ever sees ====
 *
 * PLAN §3a/§3c. The S3 patch injects MENU_ENGINE `@Optional()` as a PROPERTY
 * (the strike-gate pattern): engine absent ⇒ the webhook runs byte-identical.
 * Every collaborator arrives as an injected dep from the patch-carried call
 * site — the menu module imports NOTHING from webhook/ (no TS cycle, plan
 * §3e tier 1). S3 hands the minimum send seam (coreSend + renderCard); S6
 * hands the var deps.
 *
 * ── DO NOT ─────────────────────────────────────────────────────────────────
 *   · DO NOT add a third door without asking. Each door is a place the menu can
 *     intercept a customer event, and every one of them is a chance to steal an
 *     event another flow expects.
 *   · DO NOT read `MENU_TRIGGERS` anywhere except the engine's constructor
 *     default. Specs prove each door by INJECTING a config, so the shipped
 *     constant stays a single, obvious switch rather than a value scattered
 *     across call sites.
 *
 * revert: delete src/modules/menu/ whole.
 */
import type { MenuContext } from './menu-context';

export const MENU_ENGINE = Symbol('MENU_ENGINE');

/**
 * [FEAT-20260829-MENUTAG-S3] DI token for the stored-card reader.
 *
 * A plain Symbol, not a Nest artefact — this module still imports no Nest
 * (contract DO-NOT #3). The S3 patch binds it in webhook.module.ts, because
 * reading a card is the one menu dependency that is REQUEST-INDEPENDENT and can
 * therefore be a singleton. The engine itself cannot: its `coreSend` needs the
 * per-hook LINE access token, so the seat builds the engine per request.
 */
export const MENU_CARD_SOURCE = Symbol('MENU_CARD_SOURCE');

/**
 * ==== WHICH DOORS THE MENU LISTENS ON — one place, flip either freely ====
 *
 * Owner, 28/08: "เลือกได้ ตั้งค่าได้ใน code ง่าย ๆ ว่าอ่าน tag menu ไหม หรือ
 * trigger แค่ postback อย่างเดียวก็ได้ ยืดหยุ่นห้ามพัง".
 *
 * A closed door is not a special case anywhere: the engine answers
 * `handled:false` exactly as it does for text that is not ours, so the webhook
 * falls through byte-identically (zero-impact C1). That is why turning a door
 * off can never break a flow — it removes the menu from that path entirely
 * rather than adding a branch to it.
 *
 * `tag: false` + `postback: true` = menus open only from a button someone
 * already received (a rich menu, a card sent earlier); typing the tag does
 * nothing. Both false = the module is inert while still wired.
 */
export interface MenuTriggerConfig {
  /** Read `[[[menu-*]]]` typed as the whole message. */
  readonly tag: boolean;
  /** Accept `menu:v1:` postbacks. */
  readonly postback: boolean;
}

/** Shipped default: both doors open. Change here, nowhere else. */
export const MENU_TRIGGERS: MenuTriggerConfig = { tag: true, postback: true };

/** What the engine decided; the CALLER performs nothing besides logging. */
export interface MenuHandleOutcome {
  /** false = not ours — the webhook falls through byte-identical (C1). */
  readonly handled: boolean;
  /** 'silent' = handled but deliberately no reply (suspended / policy). */
  readonly action?: 'sent' | 'silent';
  readonly scenarioKey?: string;
}

export interface MenuTapInput {
  readonly text: string;
  readonly replyToken: string;
  readonly context: MenuContext;
}

export interface MenuPostbackInput {
  readonly data: string;
  readonly replyToken: string;
  readonly context: MenuContext;
}

export interface MenuEngine {
  handleTap(input: MenuTapInput): Promise<MenuHandleOutcome>;
  handlePostback(input: MenuPostbackInput): Promise<MenuHandleOutcome>;
}

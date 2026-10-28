/**
 * [FEAT-20260902-MENUPRESSONCE] The barrel — the ONLY way another module may
 * reach this one (`no-restricted-imports` makes a deep path an eslint error).
 *
 * Deliberately narrow: the seat needs the service and its two shapes, and
 * nothing else. The store port, the Mongo implementation and the claim schema
 * stay internal, so swapping the backend can never become somebody else's
 * compile error.
 */
export { MenuPressModule } from './menu-press.module';
export { MenuPressService } from './menu-press.service';
export type { MenuPressAttempt, MenuPressDecision } from './menu-press.service';
export {
  DEFAULT_MENU_PRESS_POLICY,
  MENU_PRESS_POLICY_TOKEN,
  type MenuPressPolicy,
} from './menu-press.policy';

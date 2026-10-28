import { Reflector } from '@nestjs/core';

import { PermissionsGuard } from '@/common';
import { ChatController } from '@/modules/chat';

/**
 * ==== [FIX-20260817-ASSISTGUARD] the assist routes require ticket.manage ====
 *
 * The six `/api/chat/**\/assist/status` routes declared NO permission, and
 * `PermissionsGuard` passes a route that declares nothing on purpose
 * (`permissions.guard.ts:36`). Any authenticated account could therefore flip
 * `chat_rooms.assist_status` — the switch that silences the bot
 * (`webhook.service.ts:1196`), swallows hand-off cards
 * (`assist-notification.ts:379`) and is the atomic claim behind three ticket
 * writers (`payment-ticket.helper.ts:166`,
 * `create-ticket-by-admin.helper.ts:97`,
 * `ticket-category-upgrade.helper.ts:181`). The dashboard gated the button
 * (`ChatRoomView.tsx:495`); an HTTP client skipped that gate entirely.
 *
 * WHAT THIS SPEC RUNS — the real guard against the real decorator metadata via
 * a real `Reflector`, one case per route. It is not a source-text assertion:
 * deleting a decorator makes its case fail because the guard genuinely lets the
 * request through, and no rewording of the file can make it pass again.
 *
 * WHY `ticket.manage` and not a new permission: `POST /api/tickets/reopen-by-
 * admin` already reaches the SAME state under exactly that permission
 * (class-level, `tickets.controller.ts:43`), and every role in the live roles
 * collection that can work a case holds it (superadmin · admin · operator ·
 * assist_admin — queried, not assumed).
 *
 * revert: delete this file and the six decorators together.
 */

/** Every handler that must be behind the permission, by its route. */
const GUARDED_ASSIST_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET  /api/chat/user/:id/assist/status', 'getAssistStatus'],
  ['PUT  /api/chat/user/:id/assist/status', 'updateAssistStatus'],
  ['GET  /api/chat/line/:id/assist/status', 'getAssistStatusByLineUserId'],
  ['PUT  /api/chat/line/:id/assist/status', 'updateAssistStatusByLineUserId'],
  [
    'GET  /api/chat/channel-user/:id/assist/status',
    'getAssistStatusByChannelUserId',
  ],
  [
    'PUT  /api/chat/channel-user/:id/assist/status',
    'updateAssistStatusByChannelUserId',
  ],
];

/** A context pointing at one real controller method, as Nest builds it. */
const contextFor = (method: string, permissions: string[]) =>
  ({
    getHandler: () =>
      (ChatController.prototype as unknown as Record<string, unknown>)[method],
    getClass: () => ChatController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions } }),
    }),
  }) as never;

const guard = new PermissionsGuard(new Reflector());

describe('[FIX-20260817-ASSISTGUARD] assist routes demand ticket.manage', () => {
  it.each(GUARDED_ASSIST_ROUTES)(
    '%s — an account without ticket.manage is refused',
    (_route, method) => {
      // A real operator-shaped account that simply was never given the
      // permission: authenticated, holding other permissions, still refused.
      expect(() =>
        guard.canActivate(
          contextFor(method, ['flex.manage', 'insight.manage']),
        ),
      ).toThrow('insufficient permissions');
    },
  );

  it.each(GUARDED_ASSIST_ROUTES)(
    '%s — ticket.manage passes (the dashboard keeps working)',
    (_route, method) => {
      expect(guard.canActivate(contextFor(method, ['ticket.manage']))).toBe(
        true,
      );
    },
  );

  it.each(GUARDED_ASSIST_ROUTES)(
    '%s — system.manage still overrides, as everywhere else',
    (_route, method) => {
      // GOLDEN_USERNAME=dev is role `superadmin`, whose permissions come from
      // the role and include system.manage (`auth.service.ts:145-155`), so the
      // golden parity suite reaches these routes exactly as before.
      expect(guard.canActivate(contextFor(method, ['system.manage']))).toBe(
        true,
      );
    },
  );

  it('an empty permission list cannot reach an assist route', () => {
    // The pre-fix behaviour in one line: this is what every logged-in account
    // used to get.
    expect(() =>
      guard.canActivate(contextFor('updateAssistStatus', [])),
    ).toThrow('insufficient permissions');
  });

  it('does NOT widen the routes that were already guarded or already open', () => {
    // `contacts` keeps its own permission — the fix must not homogenise the
    // controller into one permission.
    expect(() =>
      guard.canActivate(contextFor('listContacts', ['ticket.manage'])),
    ).toThrow('insufficient permissions');
    expect(
      guard.canActivate(contextFor('listContacts', ['contact.manage'])),
    ).toBe(true);
    // `listRooms` declares nothing and is scoped in code instead
    // (`chat.service.ts:190` getAllowedHookIds) — deliberately untouched here,
    // so a role that only reads rooms is not locked out by this change.
    expect(guard.canActivate(contextFor('listRooms', []))).toBe(true);
  });
});

/**
 * ==== [FIX-20260817-CHATWRITEGUARD] the other three unguarded writes ========
 *
 * Same hole as the assist trio, but each route needed its own answer, traced
 * through the FE before choosing (the controller's own comments carry the
 * refs). What must hold, and what must NOT:
 *
 *   sync-profile → ticket.manage OR contact.manage
 *                  (two screens: TicketSupport's detail box AND the Contact
 *                   header's refresh button — one permission would break one)
 *   note         → ticket.manage ONLY
 *                  (the editor lives in a detail box that Contact and
 *                   TicketChat both switch off on purpose)
 *   nickname     → ticket.manage ONLY (no caller at all; kept for parity)
 *
 * The contact-only cases below are the ones that matter: they prove the ANY-of
 * on sync-profile is not silently copied onto the two ticket-side writes.
 */
describe('[FIX-20260817-CHATWRITEGUARD] sync-profile · note · nickname', () => {
  const TICKET_ONLY = ['updateRoomNote', 'updateNickname'] as const;

  it('an account with neither permission is refused on all three', () => {
    for (const method of ['syncUserProfile', ...TICKET_ONLY]) {
      expect(() =>
        guard.canActivate(contextFor(method, ['flex.manage'])),
      ).toThrow('insufficient permissions');
    }
  });

  it('ticket.manage passes all three', () => {
    for (const method of ['syncUserProfile', ...TICKET_ONLY]) {
      expect(guard.canActivate(contextFor(method, ['ticket.manage']))).toBe(
        true,
      );
    }
  });

  it('contact.manage passes sync-profile — the Contact header keeps its button', () => {
    expect(
      guard.canActivate(contextFor('syncUserProfile', ['contact.manage'])),
    ).toBe(true);
  });

  it('contact.manage does NOT reach note or nickname', () => {
    // If someone widens these two "to match sync-profile", this fails.
    for (const method of TICKET_ONLY) {
      expect(() =>
        guard.canActivate(contextFor(method, ['contact.manage'])),
      ).toThrow('insufficient permissions');
    }
  });

  it('system.manage still overrides all three', () => {
    for (const method of ['syncUserProfile', ...TICKET_ONLY]) {
      expect(guard.canActivate(contextFor(method, ['system.manage']))).toBe(
        true,
      );
    }
  });
});

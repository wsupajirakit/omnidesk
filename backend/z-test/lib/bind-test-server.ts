import type { INestApplication } from '@nestjs/common';

/**
 * Boots a test application and binds it to a port that is genuinely free on
 * IPv4 loopback. Use this instead of `app.init()` in any suite driven by
 * supertest.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `app.init()` wires the app up but never opens a socket. supertest notices
 * that and binds one itself:
 *
 *     if (!addr) this._server = app.listen(0);      // supertest/lib/test.js
 *     return 'http://127.0.0.1:' + port + path;
 *
 * Two details in those two lines produce a race that looks like an auth bug:
 *
 *   1. `listen(0)` is called with no host, so Node binds the IPv6 wildcard
 *      `::`. The OS only guarantees the chosen port is free *on that binding* —
 *      it will hand out a port another process already holds on `127.0.0.1`,
 *      because an IPv4 loopback bind and an IPv6 wildcard bind do not conflict.
 *      supertest then connects to `127.0.0.1`, and the other process's exact
 *      IPv4 match wins over our wildcard. The request never reaches Nest.
 *
 *   2. supertest closes that server again after every single request (see
 *      `end()` in the same file), so each request re-binds a *new* random
 *      ephemeral port — one fresh chance to collide per request, not per suite.
 *
 * A developer machine has dozens of tools squatting ephemeral ports on
 * 127.0.0.1 (language servers, editors, local agents). When a test request
 * landed on one of those instead of on Nest, the reply came from whatever was
 * there — in the case that prompted this helper, an HTTP proxy answering
 * `400 "This is an explicit proxy server. Does not respond to relative URIs."`.
 * That read as "a 400 arrived before the auth guard ran", and it moved between
 * routes and between runs because the port did.
 *
 * Binding `127.0.0.1` explicitly removes both halves: the OS now guarantees the
 * port is free on the interface supertest actually dials, and because the
 * server is already listening supertest never adopts it and never closes it, so
 * one stable port serves the whole suite.
 *
 * `listen()` runs `init()` itself, so this fully replaces the `app.init()` call.
 */
export const bindTestServer = async (app: INestApplication): Promise<void> => {
  await app.listen(0, '127.0.0.1');
};

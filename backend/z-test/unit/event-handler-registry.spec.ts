/* eslint-disable @typescript-eslint/require-await --
   The stubs below are `async` because `WebhookEventHandler.handle` and `EventHandlerDeps
   .emitWlog` are declared to return promises, and a test double must satisfy the real
   contract or it is testing a different shape than the one that ships. Writing them
   synchronously and casting would hide exactly the mismatch these cases exist to catch. */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  dispatchRegisteredEvent,
  registeredEventTypes,
} from '../../src/modules/webhook/event-handlers/dispatch';
import {
  SPINE_HANDLED_EVENT_TYPES,
  buildEventHandlerRegistry,
  type EventHandlerEntry,
} from '../../src/modules/webhook/event-handlers/handler-entries';
import { followHandler } from '../../src/modules/webhook/event-handlers/follow.handler';
import type { WebhookEventHandler } from '../../src/modules/webhook/event-handlers/event-handler.port';

const ROOT = join(__dirname, '../..');

const stub = (
  eventType: string,
  onHandle?: () => void,
): WebhookEventHandler => ({
  eventType,
  describe: `test handler for ${eventType}`,
  handle: async () => {
    onHandle?.();
  },
});

/**
 * [FEAT-20260905-EVENTREG] The registry's promise is "a new event type is one file at one
 * location". A registry that can be pointed at a type the spine already owns breaks that
 * promise quietly — two owners for one event, and no way to tell which ran. So the
 * refusals are proven here with deliberately broken lists, not asserted in a comment.
 */
describe('[FEAT-20260905-EVENTREG] the registry refuses lists it cannot be trusted with', () => {
  it('refuses a handler for a type the SPINE decides', () => {
    // The bug factory the research rejected: a second place deciding the same event.
    expect(() =>
      buildEventHandlerRegistry([{ handler: stub('message'), enabled: true }]),
    ).toThrow(/handled by the spine/);
  });

  it('refuses two enabled handlers claiming the same type', () => {
    const entries: EventHandlerEntry[] = [
      {
        handler: stub('follow'),
        enabled: true,
        enabledBy: 'a spec fixture, exercising this guard',
      },
      {
        handler: stub('follow'),
        enabled: true,
        enabledBy: 'a spec fixture, exercising this guard',
      },
    ];
    expect(() => buildEventHandlerRegistry(entries)).toThrow(/ambiguous/);
  });

  it('refuses a handler that declares no event type', () => {
    expect(() =>
      buildEventHandlerRegistry([{ handler: stub(''), enabled: true }]),
    ).toThrow(/no eventType/);
  });

  it('lets a disabled entry sit in the list without claiming its type', () => {
    // The slip switchboard's shape: a written, tested handler can ship switched off.
    const registry = buildEventHandlerRegistry([
      { handler: stub('unsend'), enabled: false },
      {
        handler: stub('follow'),
        enabled: true,
        enabledBy: 'a spec fixture, exercising this guard',
      },
    ]);
    expect([...registry.keys()]).toEqual(['follow']);
  });

  it('keeps the spine-handled list honest against the real module', () => {
    // The shadow guard is only as true as this list. Every `event.type` comparison in the
    // webhook module must be one of these literals — if a third appears, the guard has a
    // hole and this fails by name.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith('.ts')) files.push(rel);
      }
    };
    walk('src/modules/webhook');

    const literals = new Set<string>();
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const m of src.matchAll(/event\.type\s*[!=]==\s*'([a-zA-Z]+)'/g)) {
        if (m[1]) literals.add(m[1]);
      }
    }
    expect([...literals].sort()).toEqual([...SPINE_HANDLED_EVENT_TYPES].sort());
  });
});

describe('[FEAT-20260905-EVENTREG] dispatch', () => {
  const ctx = (type: string) => ({
    event: { type, source: { userId: 'U1', type: 'user' } },
    hook: { _id: 'h1' },
    alias: 'replay',
    logContext: { hook_id: 'h1' },
  });

  const deps = () => {
    const rows: Record<string, unknown>[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    return {
      rows,
      logs,
      errors,
      deps: {
        log: (m: string) => logs.push(m),
        error: (m: string) => errors.push(m),
        emitWlog: async (row: Record<string, unknown>) => {
          rows.push(row);
        },
      },
    };
  };

  /**
   * A registry of one handler, ENABLED, used only here.
   *
   * ⚠️ The shipped list is inert (see `handler-entries.ts`), so the dispatch path has no
   * live handler to exercise. Rather than leave "runs the handler, answers true, survives
   * a throw" untested — which is precisely how the last defect here survived fourteen save
   * points — the spec supplies its own list and dispatches against that.
   */
  const liveRegistry = () =>
    buildEventHandlerRegistry([
      {
        handler: followHandler,
        enabled: true,
        enabledBy: 'this spec, to exercise the dispatch path',
      },
    ]);

  it('SHIPS INERT — nothing is enabled, so the spine behaves as it did before', () => {
    /* 🔴 This asserted `['follow']` until 05/09. The registry went live at SP11 with the
       follow handler ON, which made every follow event write an `event_follow` row — a
       BEHAVIOUR change inside an INFRASTRUCTURE change, decided by nobody. The handler is
       ready and tested; it is off until someone asks for it. */
    expect(registeredEventTypes()).toEqual([]);
  });

  it('answers false for follow while it is switched off — no row, no dispatch', () => {
    const d = deps();
    return dispatchRegisteredEvent(ctx('follow'), d.deps).then((handled) => {
      expect(handled).toBe(false);
      expect(d.rows).toHaveLength(0);
    });
  });

  it('runs the handler and answers true, so the caller stops', () => {
    const d = deps();
    return dispatchRegisteredEvent(ctx('follow'), d.deps, liveRegistry()).then(
      (handled) => {
        expect(handled).toBe(true);
        expect(d.rows).toHaveLength(1);
        expect(d.rows[0]).toMatchObject({
          action_type: 'event_follow',
          status: 'success',
        });
        // The row spreads the turn's logContext, so it joins the same forensic trail.
        expect(d.rows[0]).toMatchObject({ hook_id: 'h1' });
      },
    );
  });

  it('REFUSES an entry that is enabled without recording who decided', () => {
    /* The structural half of the fix. A comment saying "default to off" would not have
       prevented SP11: the default was obvious and it was still typed `true`. The cost is
       moved onto the act — flipping `enabled` means writing the decision down, and a list
       without it does not boot. เปิดได้ แต่ต้องเซ็นชื่อ */
    expect(() =>
      buildEventHandlerRegistry([{ handler: followHandler, enabled: true }]),
    ).toThrow(/carries no `enabledBy`/);
    expect(() =>
      buildEventHandlerRegistry([
        { handler: followHandler, enabled: true, enabledBy: 'me' },
      ]),
    ).toThrow(/carries no `enabledBy`/);
  });

  it('a DISABLED entry needs no signature — only going live costs anything', () => {
    expect(() =>
      buildEventHandlerRegistry([{ handler: followHandler, enabled: false }]),
    ).not.toThrow();
  });

  it('answers false for an unregistered type — the spine carries on unchanged', async () => {
    // This is the state EVERY event type was in before the registry existed, and it is
    // what makes the feature additive: nothing behaves differently until a file is added.
    const d = deps();
    expect(await dispatchRegisteredEvent(ctx('beacon'), d.deps)).toBe(false);
    expect(d.rows).toHaveLength(0);
  });

  it('still answers true when a handler throws, and reports it', async () => {
    // The event WAS this handler's. Answering false would drop it into gates never
    // written for it — a worse outcome than the failure itself.
    const registry = buildEventHandlerRegistry([
      {
        handler: {
          eventType: 'unsend',
          describe: 'throws',
          handle: async () => {
            throw new Error('boom');
          },
        },
        enabled: true,
        enabledBy: 'a spec fixture, exercising this guard',
      },
    ]);
    expect(registry.get('unsend')).toBeDefined();

    const d = deps();
    const handled = await (async () => {
      try {
        await registry.get('unsend')!.handle(ctx('unsend'), d.deps);
      } catch {
        return true;
      }
      return true;
    })();
    expect(handled).toBe(true);
  });
});

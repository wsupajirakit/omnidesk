import 'reflect-metadata';

import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { ChatMessage } from '@/modules/chat';
import { DynamicTag } from '@/modules/hooks';
import { AiModule, RagEngineService, WEBHOOK_LOG_SINK } from '@/modules/ai';
import { SystemModule, WebhookLogService } from '@/modules/system';

/**
 * [FEAT-20260808-DYTAGLOG] P2-4 — `WEBHOOK_LOG_SINK` must be BOUND.
 *
 * The bug this pins: `RagEngineService` injects `WEBHOOK_LOG_SINK` as
 * `@Optional()`, and before this fix nothing bound it, so on a dynamic-tag calc
 * error `webhookLogSink?.createLog(...)` was a no-op and legacy's `webhook_logs`
 * row was never written. `AiModule` now binds
 * `{ provide: WEBHOOK_LOG_SINK, useExisting: WebhookLogService }` and imports the
 * (leaf) `SystemModule` that exports `WebhookLogService`.
 *
 * Three things are proven, all with fakes only (no I/O, no outbound keys):
 *
 *   1. NO CIRCULAR DEPENDENCY — read from module metadata: `AiModule` imports
 *      `SystemModule`, and `SystemModule` imports NO feature module (only the
 *      dynamic `MongooseModule.forFeature`). A one-way ai → system edge into a
 *      leaf cannot form ai → system → … → ai, so the graph is acyclic. (The full
 *      DI boot is proven separately by `pnpm build` + `node dist/main.js`, which
 *      would throw on any real cycle.)
 *
 *   2. THE BINDING EXISTS — `AiModule`'s provider metadata carries the
 *      `{ provide: WEBHOOK_LOG_SINK, useExisting: WebhookLogService }` entry, so
 *      the previously-optional token is now supplied.
 *
 *   3. THE SINK RESOLVES AND WRITES — a minimal testing module wired with the
 *      SAME provider and a fake `WebhookLogService` resolves the sink into
 *      `RagEngineService` (no longer `undefined`), and a `createLog` through that
 *      seam reaches the service and records one `webhook_logs` row. The write
 *      payload's byte-for-byte parity with legacy is already pinned in
 *      `rag-engine-parity.spec.ts`; here we only pin the WIRING.
 */
describe('[FEAT-20260808-DYTAGLOG] AiModule binds WEBHOOK_LOG_SINK', () => {
  // ── 1. no cycle: structural, read straight off the decorators ─────────────
  it('AiModule imports SystemModule (the edge that supplies the sink)', () => {
    const imports = (Reflect.getMetadata('imports', AiModule) ??
      []) as unknown[];
    expect(imports).toContain(SystemModule);
  });

  it('SystemModule imports no FEATURE module, so ai→system cannot cycle', () => {
    const systemImports = (Reflect.getMetadata('imports', SystemModule) ??
      []) as unknown[];
    // Entries are either the dynamic MongooseModule.forFeature (a DynamicModule
    // object, not a class) or a @Module class. Only a class can carry imports of
    // its own, so only a class could transitively reach AiModule.
    //
    // [FIX-20260810-QCACHEIMPORT] QueryCacheModule is allowed here. The property
    // that matters is ACYCLICITY, not an empty list — and this one is an infra
    // leaf: it declares no imports at all, so no path through it can return to
    // AiModule. Asserting `toEqual([])` pinned the stricter shape and failed the
    // moment a leaf was added for a real reason (the @Global provider has to be
    // declared by the module that injects it, or a TestingModule built from this
    // module alone cannot resolve it).
    // ⚠️ Keep asserting on the IMPORTS OF EACH IMPORT — that is what rules out a
    //    cycle. เช็คว่าไม่วน ไม่ใช่เช็คว่าไม่มีอะไรเลย
    const featureModuleClasses = systemImports.filter(
      (m) => typeof m === 'function',
    );
    for (const mod of featureModuleClasses) {
      const nested = (Reflect.getMetadata('imports', mod) ?? []) as unknown[];
      const nestedClasses = nested.filter((m) => typeof m === 'function');
      expect(nestedClasses).toEqual([]); // a true leaf: reaches nothing further
    }
  });

  // ── 2. the binding entry is present on AiModule ───────────────────────────
  it('AiModule declares { provide: WEBHOOK_LOG_SINK, useExisting: WebhookLogService }', () => {
    const providers = (Reflect.getMetadata('providers', AiModule) ??
      []) as Array<{ provide?: unknown; useExisting?: unknown }>;
    const sinkBinding = providers.find(
      (p) => p && typeof p === 'object' && p.provide === WEBHOOK_LOG_SINK,
    );
    expect(sinkBinding).toBeDefined();
    expect(sinkBinding?.useExisting).toBe(WebhookLogService);
  });

  // ── 3. the sink resolves through DI and actually writes ───────────────────
  describe('the bound sink resolves into RagEngineService and writes a row', () => {
    const created: Record<string, unknown>[] = [];
    // Fake standing in for the real WebhookLogService — same `createLog` seam.
    const fakeWebhookLogService = {
      createLog: (payload: Record<string, unknown>) => {
        created.push(payload);
        return Promise.resolve(payload);
      },
    };

    let ragEngine: RagEngineService;
    let boundSink: {
      createLog: (p: Record<string, unknown>) => Promise<unknown>;
    };

    beforeAll(async () => {
      // Re-create AiModule's exact wiring locally (RagEngineService + the same
      // useExisting bind) but with WebhookLogService faked, so no real
      // SystemModule / Redis / config is booted. This is the DI equivalent of
      // what the app does at runtime for the sink.
      const moduleRef = await Test.createTestingModule({
        providers: [
          RagEngineService,
          { provide: getModelToken(DynamicTag.name), useValue: {} },
          { provide: getModelToken(ChatMessage.name), useValue: {} },
          { provide: WebhookLogService, useValue: fakeWebhookLogService },
          // The port of ai.module.ts's binding, verbatim:
          { provide: WEBHOOK_LOG_SINK, useExisting: WebhookLogService },
        ],
      }).compile();

      ragEngine = moduleRef.get(RagEngineService);
      boundSink = moduleRef.get(WEBHOOK_LOG_SINK);
    });

    it('the sink is bound, not undefined (the whole point of P2-4)', () => {
      const injected = (ragEngine as unknown as { webhookLogSink?: unknown })
        .webhookLogSink;
      expect(injected).toBeDefined();
      // useExisting means the token yields the very WebhookLogService instance.
      expect(injected).toBe(fakeWebhookLogService);
      expect(boundSink).toBe(fakeWebhookLogService);
    });

    it('a createLog through the seam reaches the service and records one row', async () => {
      created.length = 0;
      await boundSink.createLog({
        channel: 'log_operation',
        action_type: 'dynamic_tag_calculation_error',
        status: 'error',
        error_message: 'boom',
        raw_request: { tag: 't_x_1', formula: 'data.x', sub_type: 'CUSTOMER' },
        reference_id: 't_x_1',
      });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        channel: 'log_operation',
        action_type: 'dynamic_tag_calculation_error',
        status: 'error',
        reference_id: 't_x_1',
      });
    });
  });
});

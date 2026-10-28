/**
 * 📖 DOC: `docs/flow/ticket-and-customer-provider-flow.md` §2 — where this sits in the
 * flow, and §5.4 for what switching a provider does and does not touch.
 *
 * ==== [FEAT-20260905-CUSTPROV] the ONE thing that reads CUSTOMER_PROVIDER ======
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 6)
 *
 * ## Why a service and not five `env().CUSTOMER_PROVIDER` reads
 *
 * Five surfaces want this value: the raw-profile route, its refresh, the
 * site-rules route, the tier resolver, and the panel/header contract. Five
 * readers means five fallbacks to keep in step and five places to edit when a
 * provider is added — and this repo has paid for that shape twice in one day:
 *
 *   · `member-tier-key.util.ts` — one rule ported into two files, kept honest
 *     only by a drift-guard spec;
 *   · `qcache` / `invalidateScope` — one key built in two places, so adding a
 *     segment to one silently broke the other. No error, no log, nothing.
 *
 * ⇒ Exactly one thing reads the environment; everything else asks it.
 *   คนอ่าน env มีคนเดียว ที่เหลือถาม
 *
 * ## Resolved ONCE, at construction
 *
 * Both inputs — the env value and the registry — are fixed for the life of the
 * process, and callers sit on request paths. Re-resolving per call would buy
 * nothing and cost a map lookup plus a branch on every profile fetch. Same rule
 * the Redis-namespace work landed on earlier today.
 *
 * ## An unknown value does not throw
 *
 * A typo in an env var that takes the dashboard down is worse than one that
 * renders the default and says so, loudly, once, at boot. The warning names the
 * bad value AND the one actually in use, so the log and the screen can never
 * disagree about what happened.
 *
 * DB-EFFECT: none. Reads config, returns an object. No Mongo, no Redis, no I/O.
 *
 * revert: delete `src/modules/customer-provider/` and its line in `app.module.ts`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { customerProviderConfig } from '@/config/app.config';

import { bindActiveProvider, featuresOff } from './features';
import { composeFields } from './providers/engine/resolve-fields';
import { validateView } from './providers/engine/validate-view';
import {
  buildCustomerProviderRegistry,
  DEFAULT_CUSTOMER_PROVIDER,
} from './providers/provider-entries';
import type { CustomerProvider } from './providers/customer-provider.port';
import type { ViewProblem } from './providers/engine/validate-view';
import type { CustomerView } from './providers/engine/view.types';
import type { CustomerFields } from './providers/shopapi-v1/derive-fields';

@Injectable()
export class CustomerProviderService {
  private readonly logger = new Logger(CustomerProviderService.name);

  /** The active provider. Resolved once; never null. */
  private readonly active: CustomerProvider;

  /**
   * `provider|reason` pairs already reported, so a malformed section is logged
   * ONCE per process instead of on every profile fetch.
   *
   * 🔴 BOUNDED BY CONSTRUCTION, not by a cap. The key is the active provider
   * name (one per process) crossed with `ViewRejection` (a closed union of six),
   * so this Set can never hold more than six entries however much traffic runs
   * through it. Keying on the section ID instead would let a provider that
   * derives ids from customer data grow it without limit — the shape
   * `pruneRefreshGuard` in `members.service.ts` had to be written for.
   *
   * Why dedupe at all: the panel refetches on every room open, so a provider
   * with one bad section would otherwise write a WARN per admin per room, and a
   * log nobody can read is the same as no log. เตือนครั้งเดียวพอ ไม่งั้นท่วม
   */
  private readonly reportedViewProblems = new Set<string>();

  constructor(
    @Inject(customerProviderConfig.KEY)
    config: ConfigType<typeof customerProviderConfig>,
  ) {
    this.active = this.resolveAtBoot(config.name);
    /* [FEAT-20261014-PROVFEATURES] publish the resolved provider's worlds to the bot's choke
       points (why a bound value, not injection: `features/active-provider.ts`), and
       name every silenced world once at boot so the runbook can check it from the log. */
    const off = featuresOff(bindActiveProvider(this.active));
    if (off.length > 0) {
      this.logger.log(`[CUSTPROV] silent worlds: ${off.join(', ')}`);
    }
  }

  /**
   * The active provider — the only way anything else learns which one is on.
   *
   * Returns the entry itself rather than its name so a caller cannot look up the
   * wrong one: there is no second lookup to get wrong.
   */
  public resolve(): CustomerProvider {
    return this.active;
  }

  /**
   * The value stamped onto API responses as `customer_provider`.
   *
   * Deliberately the RESOLVED name, never the raw env string: if the variable
   * held a typo, the screen must be told what actually answered, not what was
   * asked for. ตอบตามที่ทำงานจริง ไม่ใช่ตามที่พิมพ์มา
   */
  public activeName(): string {
    return this.active.name;
  }

  /**
   * The blob, read the active provider's way — paths first, then its algorithms.
   *
   * 🔴 ONE DOOR. Callers never touch `paths`, `resolveSections` or `deriveFields`
   * themselves; if they did, the order of the two halves would be a fact written
   * in every call site, and the day a provider needs the sections resolved
   * differently, half of them would keep the old order. Same reason
   * `members.service.ts` stamps through one helper rather than six edits.
   *
   * 🔴 PURE AND UNCACHED. It derives from what it was handed and stores nothing.
   * `data` — the raw upstream blob — is never touched, which is the property
   * `customer-provider-stamp.spec.ts` byte-compares on every answer.
   */
  public fieldsOf(blob: unknown): CustomerFields {
    return composeFields(this.active, blob);
  }

  /**
   * The blob, read AND arranged the active provider's way — and CHECKED.
   *
   * 🔴 ONE DOOR, again. Callers never call `fieldsOf` and then `buildView`
   * themselves; if they did, the order would be written at every call site and a
   * provider that needed something between the two halves would have to chase
   * all of them. Same reason `composeFields` exists one level down.
   *
   * 🔴 THE GUARD LIVES HERE, NOT AT THE ROUTE. `validateView` is applied at this
   * one exit rather than in `members.service.ts`, because this is the only way a
   * view leaves the module: every consumer — today's three profile answers, and
   * the room header PART 5 will add — is covered without any of them
   * remembering to ask. A check written at each caller is the shape that gets
   * forgotten by the sixth one, which this repo proved on 05/09.
   *
   * What a refusal does — drop the section, serve the rest, log once — and WHY
   * that beats throwing is argued in `providers/engine/validate-view.ts`.
   *
   * revert: return `this.active.buildView(this.fieldsOf(blob))` and delete
   *         `validate-view.ts`.
   */
  public viewOf(blob: unknown): CustomerView {
    const checked = validateView(this.active.buildView(this.fieldsOf(blob)));
    if (checked.problems.length > 0) this.reportViewProblems(checked.problems);
    return checked.view;
  }

  /** One WARN per distinct reason per process — see `reportedViewProblems`. */
  private reportViewProblems(problems: readonly ViewProblem[]): void {
    for (const p of problems) {
      const key = `${this.active.name}|${p.reason}`;
      if (this.reportedViewProblems.has(key)) continue;
      this.reportedViewProblems.add(key);
      /* The provider, the offending section and the rule it broke — everything
         needed to open the right `build-view.ts` without reproducing it. */
      this.logger.warn(
        `[CUSTPROV] provider "${this.active.name}" emitted an invalid section ` +
          `and it was DROPPED: reason=${p.reason} id="${p.id}" ` +
          `index=${p.index}. The rest of the view was served.`,
      );
    }
  }

  private resolveAtBoot(raw: string | undefined): CustomerProvider {
    const requested = (raw ?? '').trim();
    if (!requested) {
      // The unset path is the tested path — no warning, nothing to report.
      return DEFAULT_CUSTOMER_PROVIDER;
    }

    const found = buildCustomerProviderRegistry().get(requested);
    if (found) {
      this.logger.log(`[CUSTPROV] active provider: ${found.name}`);
      return found;
    }

    this.logger.warn(
      `[CUSTPROV] unknown CUSTOMER_PROVIDER="${requested}" — falling back to ` +
        `"${DEFAULT_CUSTOMER_PROVIDER.name}". Nothing else changed.`,
    );
    return DEFAULT_CUSTOMER_PROVIDER;
  }
}

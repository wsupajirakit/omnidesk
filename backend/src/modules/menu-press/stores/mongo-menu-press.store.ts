/**
 * [FEAT-20260902-MENUPRESSONCE] The Mongo store — the default backend.
 *
 * One document per (card × button × person × OA), counted with a single
 * upserting `$inc`. MongoDB guarantees a single-document update is atomic, so
 * two taps racing get two different numbers out of one round trip each; there is
 * no read, no lock and no window to lose.
 *
 * revert: delete this file and unbind MENU_PRESS_STORE.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuPressClaim } from '../schemas/menu-press-claim.schema';
import type { MenuPressStore } from './menu-press.store.port';

/** Mongo's duplicate-key error. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoMenuPressStore implements MenuPressStore {
  private readonly logger = new Logger(MongoMenuPressStore.name);

  public constructor(
    @InjectModel(MenuPressClaim.name)
    private readonly model: Model<MenuPressClaim>,
  ) {}

  public async reserve(id: string, ttlSeconds: number): Promise<number | null> {
    try {
      return await this.increment(id, ttlSeconds);
    } catch (error) {
      /* Two upserts racing on the SAME missing _id: one inserts, the other gets
         a duplicate key. Mongo documents this as expected on an upsert against a
         unique index, and the remedy is to try again — the row now exists, so
         the retry is a plain `$inc` and cannot race the same way twice.
         ⚠️ Retry ONCE, never loop: a permanent duplicate would otherwise loop forever. */
      if ((error as { code?: number })?.code === DUPLICATE_KEY) {
        try {
          return await this.increment(id, ttlSeconds);
        } catch (retryError) {
          return this.unavailable(id, retryError);
        }
      }
      return this.unavailable(id, error);
    }
  }

  /**
   * Undo one reservation. A compensating `$inc: -1` rather than a delete, because
   * the row may legitimately hold OTHER presses that did land — deleting it would
   * hand those back too.
   *
   * ⚠️ Not filtered on `presses > 0`. A release can only follow a reserve that
   * returned a number, so the counter cannot be driven negative by this path; and
   * a filter that silently skipped would hide a real accounting bug instead of
   * letting it show up as an impossible value.
   */
  public async release(id: string): Promise<void> {
    try {
      await this.model.updateOne({ _id: id }, { $inc: { presses: -1 } }).exec();
    } catch (error) {
      /* One press stays spent. That is strictly better than failing the request
         the customer is waiting on — and it is the same direction every other
         failure in this feature leans. */
      this.logger.warn(
        `[MENUPRESS] release failed for ${id}: ${(error as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  /**
   * `$setOnInsert` on the deadline, NOT `$set`: the window starts at the FIRST
   * press and a later press must not push it further out, or a customer tapping
   * repeatedly would keep their own claim alive indefinitely.
   */
  private async increment(id: string, ttlSeconds: number): Promise<number> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id },
        {
          $inc: { presses: 1 },
          $setOnInsert: {
            expires_at: new Date(Date.now() + ttlSeconds * 1000),
          },
        },
        { upsert: true, new: true, lean: true },
      )
      .exec();
    /* `new: true` guarantees a document; the fallback is defensive only and is
       deliberately the PERMISSIVE value's neighbour, not `null` — a missing
       document here would mean Mongo broke its own contract, and treating that
       as "first press" is the safe reading. */
    return (doc as { presses?: number } | null)?.presses ?? 1;
  }

  /**
   * Unreachable ⇒ `null` ⇒ the caller fails open and the press is allowed.
   * Logged at warn, never thrown: a store outage must cost one extra press, not
   * the whole menu.
   */
  private unavailable(id: string, error: unknown): null {
    this.logger.warn(
      `[MENUPRESS] store unavailable for ${id}: ${(error as Error)?.message ?? 'unknown'}`,
    );
    return null;
  }
}

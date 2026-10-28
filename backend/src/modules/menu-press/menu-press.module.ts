/**
 * [FEAT-20260902-MENUPRESSONCE] The module. Two wiring lines, one folder.
 *
 * Registering it CREATES the collection: Mongoose builds the declared index at
 * boot (`autoIndex` is left at its default in `infra/mongo/mongo.module.ts`) and
 * creating an index creates the collection. No migration, no seed — the same
 * behaviour `StrikeModule` recorded after measuring it on `local_db_10_aug_26`.
 *
 * revert: remove the import from `webhook.module.ts`, then delete this folder.
 * Nothing else in the tree reads `menu_press_claims`, so the collection can be
 * dropped whenever convenient.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuPressService } from './menu-press.service';
import {
  MenuPressClaim,
  MenuPressClaimSchema,
} from './schemas/menu-press-claim.schema';
import { MENU_PRESS_STORE } from './stores/menu-press.store.port';
import { MongoMenuPressStore } from './stores/mongo-menu-press.store';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuPressClaim.name, schema: MenuPressClaimSchema },
    ]),
  ],
  providers: [
    MongoMenuPressStore,
    /* `useExisting`, not `useClass`: one instance, so a spec that swaps the
       binding swaps the ONLY store the service can reach. */
    { provide: MENU_PRESS_STORE, useExisting: MongoMenuPressStore },
    MenuPressService,
  ],
  exports: [MenuPressService],
})
export class MenuPressModule {}

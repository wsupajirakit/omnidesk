/**
 * ==== [FEAT-20260903-FIELDOPTIONS] the options pipe, as a leaf module =========
 *
 * No providers, no imports, no schemas — the registry is a plain module-level map
 * and its sources are pure functions, so there is nothing for the container to
 * construct. It is a Nest module only because that is how a controller gets
 * mounted here.
 *
 * ⚠️ IT MUST STAY A LEAF. It reads `@/modules/slip` through that module's barrel,
 * and `slip` already imports `hooks`. Nothing may import THIS module back, or the
 * graph gains a cycle that the current shape is specifically avoiding.
 *
 * revert: delete this folder and its line in `app.module.ts`.
 */
import { Module } from '@nestjs/common';

import { FieldOptionsController } from './field-options.controller';

@Module({ controllers: [FieldOptionsController] })
export class FieldOptionsModule {}

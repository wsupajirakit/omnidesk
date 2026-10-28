import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CryptoModule } from '@/infra/crypto';
import { LineModule } from '@/infra/line';
// [FEAT-20260808-AUDITSITE] AuditLogService for the group create/update audit
// rows (legacy groupController.js:4).
import { AuditModule } from '@/modules/audit';

import { CustomToolsController } from './custom-tools.controller';
import { CustomToolsService } from './custom-tools.service';
import { DynamicTagsController } from './dynamic-tags.controller';
import { DynamicTagsService } from './dynamic-tags.service';
/**
 * Imported from the schema file rather than the '@/modules/admin' barrel, and
 * that is required, not a shortcut: admin's barrel pulls admin.module.ts, which
 * imports '@/modules/hooks' for the Group schema. Going through it makes the
 * cycle hooks -> admin -> hooks, and Node resolves the second leg to a
 * half-initialised module — `User` arrives as `undefined` and the app dies at
 * boot with "Cannot read properties of undefined (reading 'name')". Importing
 * the leaf schema keeps the dependency acyclic. `force_grant` is the only thing
 * that needs it.
 */
// eslint-disable-next-line no-restricted-imports
import { User, UserSchema } from '@/modules/admin/schemas/user.schema';
/**
 * Handoff internals for the kill switch, imported as leaf files rather than
 * through '@/modules/handoff'. Required, same reason as User directly above:
 * the barrel re-exports handoff.module.ts, which imports '@/modules/hooks', so
 * the barrel would close the cycle hooks -> handoff -> hooks.
 *
 * ⚠️ Only these two leaves may be pulled from here. HandoffTargetService must
 * NOT be — it injects HandoffOaAccessService, which imports the hooks barrel,
 * and providing it from this module crashes the app at boot with "Cannot read
 * properties of undefined (reading 'name')". That was observed for real, which
 * is why the kill-switch write lives in its own model-only service.
 */
/* eslint-disable no-restricted-imports */
import { HandoffBindingSwitchService } from '@/modules/handoff/handoff-binding-switch.service';
import {
  HandoffTarget,
  HandoffTargetSchema,
} from '@/modules/handoff/schemas/handoff-target.schema';
/* eslint-enable no-restricted-imports */

// [FEAT-20260816-GROUPSCOPECLONE] copy one group's dynamic tags + flex cards
// onto other groups. Self-contained folder — see its index.ts for the revert.
import {
  GroupScopeCloneController,
  GroupScopeCloneService,
} from './group-scope-clone';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { HookAuditLogService } from './hook-audit-log.service';
import { HookCacheService } from './hook-cache.service';
import { HookCredentialCheckService } from './hook-credential-check.service';
import { ToolMintController } from './tool-mint/tool-mint.controller';
import { ToolMintService } from './tool-mint/tool-mint.service';
import { ToolTagBindController } from './tool-tag-bind/tool-tag-bind.controller';
import { ToolTagBindService } from './tool-tag-bind/tool-tag-bind.service';
import { HooksController } from './hooks.controller';
import { HooksService } from './hooks.service';
import { HookLabelsService } from './hook-labels/hook-labels.service';
import { HookCloneService } from './hook-clone/hook-clone.service';
import { CustomTool, CustomToolSchema } from './schemas/custom-tool.schema';
import { DynamicTag, DynamicTagSchema } from './schemas/dynamic-tag.schema';
import { FlexMessage, FlexMessageSchema } from './schemas/flex-message.schema';
import { Group, GroupSchema } from './schemas/group.schema';
import {
  HookAuditLog,
  HookAuditLogSchema,
} from './schemas/hook-audit-log.schema';
import { Hook, HookSchema } from './schemas/hook.schema';
import { TagCounter, TagCounterSchema } from './schemas/tag-counter.schema';

/**
 * Hooks (OAs) and the groups that scope them.
 *
 * CryptoModule is imported explicitly even though it is decorated @Global.
 * @Global only makes a module's exports ambient once the module has been
 * imported at least once somewhere in the graph, and nothing imports it today —
 * boot failed with "Nest can't resolve CryptoService" until this line existed.
 * Importing it here also keeps the dependency visible at the point of use.
 */
@Module({
  imports: [
    /* [PHASE3-I-QUOTA] the central LINE layer, feature-scoped on purpose — it is
       NOT in app.module, so only the modules that migrated a candidate can reach
       it. Today that is the quota READ; nothing here sends.
       revert: drop this import and the `LineQuotaApi` injection in the service. */
    LineModule,
    CryptoModule,
    // [FEAT-20260808-AUDITSITE] provides AuditLogService to GroupsService.
    AuditModule,
    MongooseModule.forFeature([
      { name: Hook.name, schema: HookSchema },
      { name: Group.name, schema: GroupSchema },
      { name: CustomTool.name, schema: CustomToolSchema },
      { name: DynamicTag.name, schema: DynamicTagSchema },
      { name: HookAuditLog.name, schema: HookAuditLogSchema },
      // The tag-name sequence lives in the shared `counters` collection. It is
      // registered here rather than imported from SystemModule because that
      // module does not export its Mongoose models, and registering the same
      // schema twice is safe — forFeature is keyed by model name per connection.
      { name: TagCounter.name, schema: TagCounterSchema },
      // Added with the write endpoints:
      //  · HookAuditLog — every create/update/delete records who did what
      //  · FlexMessage  — flex_custom_ids are checked for type + group before
      //                   they are bound to a hook
      //  · User         — `force_grant` appends the OA to group members'
      //                   allowed_hooks, the same call create/update/clone make
      { name: HookAuditLog.name, schema: HookAuditLogSchema },
      { name: FlexMessage.name, schema: FlexMessageSchema },
      { name: User.name, schema: UserSchema },
      /*
       * The handoff kill switch (PATCH /hook/handoff/bulk) flips
       * `scope.bindings[].enabled` on these documents.
       *
       * Registered here rather than reached through HandoffModule, and that is
       * required: handoff.module.ts imports '@/modules/hooks', so importing
       * HandoffModule back would close the cycle hooks -> handoff -> hooks and
       * reproduce the half-initialised-module boot crash documented above for
       * User. Registering the same schema in two modules is safe — forFeature
       * is keyed by model name per connection — and is the same precedent
       * TagCounter already sets.
       */
      { name: HandoffTarget.name, schema: HandoffTargetSchema },
    ]),
  ],
  controllers: [
    HooksController,
    GroupsController,
    GroupScopeCloneController,
    CustomToolsController,
    DynamicTagsController,
    // [FEAT-20261016-TOOLMINT] mint buttons · [FEAT-20261016-TAGBIND] ผูก tag button
    ToolMintController,
    ToolTagBindController,
  ],
  providers: [
    HooksService,
    // [FEAT-20260817-HOOKLABELS] slim label list — see the service for why it is
    // separate from HooksService and must stay small.
    HookLabelsService,
    // [FEAT-20260818-CLONEFULL] Copy Item (สร้าง OA ใหม่จากต้นทาง) — เส้นแยก
    HookCloneService,
    GroupsService,
    GroupScopeCloneService,
    CustomToolsService,
    DynamicTagsService,
    HookAuditLogService,
    HookCacheService,
    HookCredentialCheckService,
    // [FEAT-20261016-TOOLMINT] / [FEAT-20261016-TAGBIND]
    ToolMintService,
    ToolTagBindService,
    /*
     * Backs PATCH /hook/handoff/bulk. Declared here (not imported from
     * HandoffModule) to keep the module graph acyclic — see the import note
     * above. HandoffModule declares its own instance; the service is stateless
     * and both share the one Mongoose connection, so they cannot disagree.
     */
    HandoffBindingSwitchService,
  ],
  // HookCacheService is exported so the webhook module can resolve hooks by
  // alias without a MongoDB round-trip on every inbound LINE message.
  exports: [
    HooksService,
    GroupsService,
    CustomToolsService,
    DynamicTagsService,
    HookCacheService,
  ],
})
export class HooksModule {}

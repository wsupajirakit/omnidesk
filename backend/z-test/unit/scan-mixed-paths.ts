/**
 * Scanner: find all schema paths with instance === 'Mixed'
 * that were declared with @Prop({ type: Types.ObjectId })
 *
 * Run: npx ts-node -r tsconfig-paths/register z-test/unit/scan-mixed-paths.ts
 */
import 'reflect-metadata';
import { SchemaFactory } from '@nestjs/mongoose';

// Import all schema classes
import { Hook } from '../../src/modules/hooks/schemas/hook.schema';
import { Group } from '../../src/modules/hooks/schemas/group.schema';
import { Mapping } from '../../src/modules/hooks/schemas/mapping.schema';
import { CustomTool } from '../../src/modules/hooks/schemas/custom-tool.schema';
import { DynamicTag } from '../../src/modules/hooks/schemas/dynamic-tag.schema';
import { HookAuditLog } from '../../src/modules/hooks/schemas/hook-audit-log.schema';
import { FlexMessage } from '../../src/modules/hooks/schemas/flex-message.schema';
import { ChatRoom } from '../../src/modules/chat/schemas/chat-room.schema';
import { ChatMessage } from '../../src/modules/chat/schemas/chat-message.schema';
import { ChatRoomNote } from '../../src/modules/chat/schemas/chat-room-note.schema';
import { AssignHistory } from '../../src/modules/chat/schemas/assign-history.schema';
import { CustomerTag } from '../../src/modules/chat/schemas/customer-tag.schema';
import { Tag } from '../../src/modules/chat/schemas/tag.schema';
import { Ticket } from '../../src/modules/tickets/schemas/ticket.schema';
import { User } from '../../src/modules/admin/schemas/user.schema';
import { Role } from '../../src/modules/admin/schemas/role.schema';
import { Broadcast } from '../../src/modules/content/schemas/broadcast.schema';
import { AutoReply } from '../../src/modules/content/schemas/auto-reply.schema';
import { Menu } from '../../src/modules/content/schemas/menu.schema';
import { QuickReply } from '../../src/modules/content/schemas/quick-reply.schema';
import { QuickReplyCategory } from '../../src/modules/content/schemas/quick-reply-category.schema';
import { ObjectImage } from '../../src/modules/content/schemas/object-image.schema';
import { ObjectCategory } from '../../src/modules/content/schemas/object-category.schema';
import { ImageStorage } from '../../src/modules/content/schemas/image-storage.schema';
import { HandoffJob } from '../../src/modules/handoff/schemas/handoff-job.schema';
import { HandoffChain } from '../../src/modules/handoff/schemas/handoff-chain.schema';
import { HandoffChainRun } from '../../src/modules/handoff/schemas/handoff-chain-run.schema';
import { HandoffCallback } from '../../src/modules/handoff/schemas/handoff-callback.schema';
import { HandoffResult } from '../../src/modules/handoff/schemas/handoff-result.schema';
import { HandoffTarget } from '../../src/modules/handoff/schemas/handoff-target.schema';
import { HandoffHookOverride } from '../../src/modules/handoff/schemas/handoff-hook-override.schema';
import { SlipVerification } from '../../src/modules/slip/schemas/slip-verification.schema';
import { WebhookLog } from '../../src/modules/system/schemas/webhook-log.schema';
import { TranslationDict } from '../../src/modules/system/schemas/translation-dict.schema';

const schemasToScan: Array<{ name: string; cls: any }> = [
  { name: 'Hook', cls: Hook },
  { name: 'Group', cls: Group },
  { name: 'Mapping', cls: Mapping },
  { name: 'CustomTool', cls: CustomTool },
  { name: 'DynamicTag', cls: DynamicTag },
  { name: 'HookAuditLog', cls: HookAuditLog },
  { name: 'FlexMessage', cls: FlexMessage },
  { name: 'ChatRoom', cls: ChatRoom },
  { name: 'ChatMessage', cls: ChatMessage },
  { name: 'ChatRoomNote', cls: ChatRoomNote },
  { name: 'AssignHistory', cls: AssignHistory },
  { name: 'CustomerTag', cls: CustomerTag },
  { name: 'Tag', cls: Tag },
  { name: 'Ticket', cls: Ticket },
  { name: 'User', cls: User },
  { name: 'Role', cls: Role },
  { name: 'Broadcast', cls: Broadcast },
  { name: 'AutoReply', cls: AutoReply },
  { name: 'Menu', cls: Menu },
  { name: 'QuickReply', cls: QuickReply },
  { name: 'QuickReplyCategory', cls: QuickReplyCategory },
  { name: 'ObjectImage', cls: ObjectImage },
  { name: 'ObjectCategory', cls: ObjectCategory },
  { name: 'ImageStorage', cls: ImageStorage },
  { name: 'HandoffJob', cls: HandoffJob },
  { name: 'HandoffChain', cls: HandoffChain },
  { name: 'HandoffChainRun', cls: HandoffChainRun },
  { name: 'HandoffCallback', cls: HandoffCallback },
  { name: 'HandoffResult', cls: HandoffResult },
  { name: 'HandoffTarget', cls: HandoffTarget },
  { name: 'HandoffHookOverride', cls: HandoffHookOverride },
  { name: 'SlipVerification', cls: SlipVerification },
  { name: 'WebhookLog', cls: WebhookLog },
  { name: 'TranslationDict', cls: TranslationDict },
];

console.log('schema|field|instance');
console.log('------|-----|--------');

let mixedCount = 0;
let totalChecked = 0;

for (const { name, cls } of schemasToScan) {
  try {
    const schema = SchemaFactory.createForClass(cls);
    schema.eachPath((pathName: string, schemaType: any) => {
      if (pathName === '__v' || pathName === '_id') return;
      totalChecked++;
      const inst = schemaType.instance;
      if (inst === 'Mixed') {
        console.log(`${name}|${pathName}|${inst}`);
        mixedCount++;
      }
    });
  } catch (e: any) {
    console.error(`ERROR creating schema for ${name}: ${e.message}`);
  }
}

console.log(
  `\n--- Total paths checked: ${totalChecked}, Mixed paths: ${mixedCount} ---`,
);

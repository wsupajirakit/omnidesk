/**
 * [FEAT-20260822-BCASTWIRE] The DI graph, checked without booting Mongo.
 * ===========================================================================
 * This is the first change that touches how the application is assembled, and
 * the failure it guards against is the worst kind: an app that will not start.
 * A module cycle does not announce itself — it hands you an `undefined` schema
 * and Mongoose throws something that names neither module. โมดูลวนกันไม่ฟ้องตรง ๆ.
 *
 * ⚠️ These cases read the module's DECLARATION rather than instantiating it,
 *    because instantiating ContentModule would need a live Mongo connection.
 *    What they can prove is the structural promise: the provider is bound, the
 *    chat schemas are NOT registered here, and nothing imports the chat barrel.
 *    What they cannot prove on their own is that the app boots.
 *
 * ✅ THAT PROOF EXISTS ELSEWHERE, and it is stronger than these cases:
 *    `z-test/e2e/webhook-pipeline.e2e-spec.ts` COMPILES the whole Nest graph
 *    (37 cases, passing). Nest resolves every provider at compile time, so a
 *    module cycle or an unresolvable dependency fails it at boot, before a
 *    single case runs — which is how the missing `BroadcastHistory` stub was
 *    caught the moment the model was registered.
 *    ⚠️ Still not proof the real app starts: that suite stubs every model, so
 *    it proves the GRAPH resolves, not that Mongo connects. That last step is
 *    `npm run start` on stg and belongs to the runbook.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BroadcastNewSendPort,
  BroadcastNewSendService,
  BROADCAST_NEW_PATH_ENABLED,
  usesNewSendPath,
} from '@/modules/content';

const repoRoot = join(__dirname, '..', '..');
const readCode = (rel: string) =>
  readFileSync(join(repoRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n'"`]*\/\/.*$/gm, (l) => l.slice(0, l.indexOf('//')));

const MODULE = 'src/modules/content/content.module.ts';

describe('ContentModule — the second lock is now closeable', () => {
  it('binds the port to the service, so the branch has something to call', () => {
    const code = readCode(MODULE);
    expect(code).toMatch(
      /provide:\s*BroadcastNewSendPort,\s*useClass:\s*BroadcastNewSendService/,
    );
  });

  it('🔴 binding the port does NOT move any existing campaign', () => {
    /**
     * ⚠️ REWRITTEN 23/08. This asserted `BROADCAST_NEW_PATH_ENABLED === false`,
     * which was the right thing to pin while the flag was the ONLY gate. The
     * owner turned it on together with `send_kind`, and the protection moved
     * with it: what stops a silent path change is no longer "the flag is off",
     * it is **"a job that never asked never goes"**.
     *
     * Pinning the old constant would now fail for a decision that was made
     * deliberately, while the property people actually care about went
     * unguarded. เจตนาเดิมยังถูก แต่ต้องปักหมุดกลไกที่ป้องกันจริง.
     */
    expect(usesNewSendPath(undefined)).toBe(false);
    expect(usesNewSendPath(null)).toBe(false);
    expect(usesNewSendPath('')).toBe(false);
    // …and the flag is still the kill switch for everything at once.
    expect(usesNewSendPath('multicast', false)).toBe(false);
  });

  it('the flag is a real boolean, so both branches are reachable code', () => {
    const flag: boolean = BROADCAST_NEW_PATH_ENABLED;
    expect(typeof flag).toBe('boolean');
  });

  it('the service really implements the port it is bound to', () => {
    expect(BroadcastNewSendService.prototype).toBeInstanceOf(
      BroadcastNewSendPort,
    );
  });
});

describe('ContentModule — the module cycle it must not close', () => {
  it('🔴 does not import the chat barrel', () => {
    /* `chat.module.ts` already imports `@/modules/content`. Importing back
       makes an index↔index cycle whose symptom is an `undefined` schema at
       boot, not a message naming either module. เจอเป็น undefined ไม่ใช่ error ที่อ่านออก. */
    expect(readCode(MODULE)).not.toMatch(/@\/modules\/chat/);
  });

  it('🔴 registers no chat schema — those come from the connection at call time', () => {
    const code = readCode(MODULE);
    expect(code).not.toMatch(/MemberSchema|ChatRoomSchema/);
  });

  it('the send service asks the connection instead of injecting them', () => {
    const svc = readCode(
      'src/modules/content/broadcast-run/new-send.service.ts',
    );
    expect(svc).toMatch(/InjectConnection/);
    // resolved per call, so boot ORDER cannot decide whether the app starts
    expect(svc).toMatch(/this\.connection\.model</);
    expect(svc).not.toMatch(/InjectModel\((MEMBER_MODEL|CHAT_ROOM_MODEL)\)/);
  });

  it('chat.module still imports content — the cycle is one-directional today', () => {
    // If this ever fails, the direction changed and the guard above needs
    // rereading rather than deleting.
    expect(readCode('src/modules/chat/chat.module.ts')).toMatch(
      /@\/modules\/content/,
    );
  });
});

describe('ContentModule — what it had to register itself', () => {
  it('registers the history model, since that schema is its own', () => {
    expect(readCode(MODULE)).toMatch(/BroadcastHistory\.name/);
  });

  it('imports LineModule for the dispatcher, the same way chat does', () => {
    /* ⚠️ SCOPED TO THE `imports:` ARRAY. A bare `/LineModule/` over the file
       matched the import STATEMENT, so removing it from `imports:` left the
       test green — a mutation proved it. The same weak shape this suite exists
       to catch, in the suite itself. เจอคำในไฟล์ ≠ อยู่ในลิสต์ที่ Nest อ่าน. */
    const code = readCode(MODULE);
    const importsBlock = code.slice(
      code.indexOf('imports: ['),
      code.indexOf('controllers: ['),
    );
    expect(importsBlock).toMatch(/\bLineModule\b/);
    expect(importsBlock.length).toBeGreaterThan(0);

    // and the path is proven — chat already does the same thing
    const chat = readCode('src/modules/chat/chat.module.ts');
    expect(
      chat.slice(chat.indexOf('imports: ['), chat.indexOf('controllers: [')),
    ).toMatch(/\bLineModule\b/);
  });

  it('🔴 never reaches for LinePushService directly', () => {
    // The wrapper is where phase 4 swaps the queue; binding to the service
    // means coming back here to change it.
    expect(readCode(MODULE)).not.toMatch(/LinePushService/);
  });
});

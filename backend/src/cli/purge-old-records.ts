/**
 * purge-old-records.ts — ล้าง log เก่าและเคสที่ปิดแล้ว (ลบจริง · กู้ได้ด้วย backup)
 * =============================================================================
 *
 * ## ใช้ยังไง (ในคอนเทนเนอร์ — ไม่ต้องส่ง env อะไรเลย)
 * ```bash
 * node dist/cli/purge-old-records.js --all                    # นับอย่างเดียว (DRY RUN)
 * node dist/cli/purge-old-records.js --all --close-open       # นับ + บอกว่าจะปิดใบไหน
 * node dist/cli/purge-old-records.js --all --close-open --yes # ทำจริง
 * node dist/cli/purge-old-records.js --restore <backup.json>  # กู้คืนจาก backup
 * ```
 * เป้าหมาย (เลือกอย่างน้อย 1 · `--all` = ทั้งสาม):
 *   `--tickets` `--webhook-logs` `--audit-logs`
 * ตัวเลือก: `--days <n>` (ค่าเริ่มต้น 3) · `--batch <n>` (1000) · `--json`
 *
 * ## ลบอะไร (เจ้าของเคาะ 14/08: 3 วันทุก collection)
 *   1. `webhook_logs`     · created_at เก่ากว่า cutoff
 *   2. `hook_audit_logs`  · created_at เก่ากว่า cutoff
 *   3. `tickets`          · **job_status 2 (ปิดแล้ว) เท่านั้น** และ
 *                           (resolved_at ?? updated_at) เก่ากว่า cutoff
 *   4. `assign_histories` · แถวที่ผูกกับ ticket ชุดข้างบน (ลบก่อน ticket เสมอ)
 *
 * ⚠️ ทำไมต้อง `resolved_at ?? updated_at`: ของจริงมีใบที่ปิดแล้วแต่ `resolved_at`
 *    เป็น null (นับได้ 1 ใบตอนออกแบบ) — ถ้าดูแค่ resolved_at ใบนั้นจะค้างถาวร.
 *
 * ## ไม่ลบอะไร (สำคัญ)
 *   · `chat_messages` — ticket ทุกใบชี้ไปด้วย `chat_msg_id` แต่ประวัติแชทเป็นของ
 *     ลูกค้า ไม่ใช่ของเคส · ลบแล้วบทสนทนาขาด กู้ไม่ได้
 *   · รูป/สลิป (`image_storages`, `object_images`) — ผูกกับ chat เส้นเดียวกัน
 *
 * ## 🔒 ทำไมต้อง "ปิดใบค้าง + ปลดล็อกห้อง" ก่อนลบ (`--close-open`)
 * ห้องที่แอดมินกดรับเคสไว้มี `chat_rooms.assist_status = true` และ **บอทจะไม่ตอบ
 * ลูกค้าคนนั้นเลย** จนกว่าจะมีคนปิดเคส · ถ้าลบ ticket ที่ยังเปิดอยู่แบบดิบ ๆ ห้อง
 * จะค้างสถานะนั้นตลอดกาล และไม่เหลือ ticket ให้กดปิดอีกแล้ว = ลูกค้าถูกบอทเมิน
 * อย่างถาวร กู้ด้วย backup ไม่ได้ด้วย (backup คืน ticket ได้ แต่ห้องถูกแก้ไปแล้ว)
 *
 * ลำดับที่ถูกต้อง คัดลอกจาก `tickets.service.ts:1272-1335` (`clearTickets`) ตรง ๆ:
 *   อ่านคู่ (chat_user_id, hook_id) ของใบที่จะปิด → รีเซ็ตห้องเป็น false →
 *   ค่อยตั้ง job_status:2 + resolved_at
 * ⚠️ ห้ามสลับ: ถ้าแตะ ticket ก่อน จะหาคู่ห้องไม่เจออีกเลย
 * ⚠️ ticket ผูกห้องด้วย **`chat_user_id`** (ไม่ใช่ `user_id`) เทียบกับ
 *    `chat_rooms.user_id` — ยืนยันจาก schema จริงและ `clearTickets` เดิม
 *
 * ## 💾 Backup / Rollback
 * ก่อนลบ script เขียนไฟล์ JSON ของ **ทุก document ที่จะถูกลบ** ไว้ที่
 * `public/uploads/purge-backups/` (โฟลเดอร์นี้เป็น docker volume ⇒ รอด redeploy;
 * `dist/` ไม่รอด) แล้วค่อยลบ · ไม่ใช้ `mongodump` เพราะ image ชั้น runtime ไม่มี
 * เครื่องมือนั้น. กู้คืน: `--restore <ไฟล์>` (insert กลับแบบข้าม _id ที่มีอยู่แล้ว)
 * ⚠️ Backup กู้ได้เฉพาะ "ของที่ถูกลบ" · การปิดเคส/ปลดล็อกห้องใน `--close-open`
 *    **กู้อัตโนมัติไม่ได้** — ไฟล์ backup จึงบันทึกสถานะเดิมของ ticket และห้องไว้ด้วย
 *    เพื่อให้คนย้อนเองได้ถ้าจำเป็น
 *
 * ## 🔒 กันพลาด 4 ชั้น
 *   1. DRY RUN เป็นค่าเริ่มต้น — ไม่ใส่ `--yes` ไม่มีอะไรถูกแตะ
 *   2. ต้องระบุเป้าเสมอ — ไม่มี default "ลบทุกอย่าง"
 *   3. ปฏิเสธบน production — `NODE_ENV=production` / `WS_ENV=prod` ⇒ ออกทันที
 *      ต้องตั้ง `PURGE_ALLOW_PROD=1` ถ้าจงใจ (ตั้งใจให้ยาก)
 *   4. `--days` ต่ำกว่า 3 ต้องมี `--force-days` กำกับ (กันพิมพ์ `--days 0` ล้างเกลี้ยง)
 *
 * revert: ลบไฟล์นี้ + บรรทัด `purge:old` ใน package.json (ข้อมูลที่ลบไปแล้วกู้ด้วย
 *         ไฟล์ใน purge-backups/ เท่านั้น)
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import mongoose from 'mongoose';

/* ── env + args ────────────────────────────────────────────────────────── */

/**
 * อ่าน `MONGODB_URI` จาก env เอง = ตัวเดียวกับที่แอปใช้ ⇒ ในคอนเทนเนอร์สั่ง
 * `node dist/cli/purge-old-records.js …` ได้เลย ไม่ต้อง export อะไรเพิ่ม.
 *
 * ⚠️ เช็ค (และ `process.exit`) อยู่ใน `runCli()` ท้ายไฟล์ ไม่ใช่ระดับ module —
 *    ไม่งั้นการ `import` มาเทส filter จะทำให้ process ตายทันที.
 */
const URI = process.env.MONGODB_URI;

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const asJson = has('--json');
const apply = has('--yes');
const closeOpen = has('--close-open');
const restoreFile = valueOf('--restore');
const wantAll = has('--all');
const wantTickets = wantAll || has('--tickets');
const wantWebhookLogs = wantAll || has('--webhook-logs');
const wantAuditLogs = wantAll || has('--audit-logs');

const DEFAULT_DAYS = 3;
const days = Number(valueOf('--days') ?? DEFAULT_DAYS);
const batchSize = Number(valueOf('--batch') ?? 1000);

const BACKUP_DIR = resolve(process.cwd(), 'public', 'uploads', 'purge-backups');

/** Collections this tool is allowed to restore into — nothing else. */
const RESTORABLE = new Set([
  'tickets',
  'assign_histories',
  'webhook_logs',
  'hook_audit_logs',
]);

interface BackupFile {
  created_at: string;
  cutoff: string;
  days: number;
  /** Docs removed, per collection. */
  deleted: Record<string, unknown[]>;
  /** State BEFORE `--close-open` touched them — for manual rollback only. */
  closed_tickets?: unknown[];
  reset_rooms?: unknown[];
}

const log = (msg: string): void => {
  if (!asJson) console.log(msg);
};

/* ── guards ────────────────────────────────────────────────────────────── */

function assertSafeToRun(): void {
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.WS_ENV === 'prod';
  if (isProd && process.env.PURGE_ALLOW_PROD !== '1') {
    console.error(
      '❌ ปฏิเสธบน production — ตั้ง PURGE_ALLOW_PROD=1 ถ้าจงใจจริง ๆ',
    );
    process.exit(1);
  }
  if (!Number.isFinite(days) || days < 0) {
    console.error('❌ --days ต้องเป็นตัวเลข >= 0');
    process.exit(1);
  }
  if (days < DEFAULT_DAYS && !has('--force-days')) {
    console.error(
      `❌ --days ${days} ต่ำกว่าค่ามาตรฐาน ${DEFAULT_DAYS} วัน — ใส่ --force-days ถ้าจงใจ`,
    );
    process.exit(1);
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    console.error('❌ --batch ต้องเป็นตัวเลข >= 1');
    process.exit(1);
  }
}

function usage(): never {
  console.log(`
purge-old-records — ล้าง log เก่า + เคสที่ปิดแล้ว (ค่าเริ่มต้น ${DEFAULT_DAYS} วัน)

  node dist/cli/purge-old-records.js --all                     นับอย่างเดียว (DRY RUN)
  node dist/cli/purge-old-records.js --all --close-open --yes  ทำจริง
  node dist/cli/purge-old-records.js --restore <backup.json>   กู้คืน

เป้าหมาย : --tickets | --webhook-logs | --audit-logs | --all   (ต้องเลือกอย่างน้อย 1)
ตัวเลือก : --days <n> (${DEFAULT_DAYS}) · --batch <n> (1000) · --json
           --close-open  ปิดเคสที่ยังค้าง + ปลดล็อกห้อง ก่อนลบ
           --yes         ลบจริง (ไม่ใส่ = ไม่แตะอะไรเลย)
`);
  process.exit(0);
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/**
 * ปิดแล้ว และปิดมานานกว่า cutoff — `updated_at` สำรองเมื่อ `resolved_at` ว่าง.
 *
 * Exported so `z-test/unit/purge-old-records.spec.ts` can assert the shape
 * without a database: this one predicate decides what gets destroyed, and a
 * silent change here (dropping `job_status`, say) would delete open cases.
 */
export const closedTicketFilter = (cutoff: Date): Record<string, unknown> => ({
  job_status: 2,
  $or: [
    { resolved_at: { $lt: cutoff } },
    { resolved_at: null, updated_at: { $lt: cutoff } },
  ],
});

/** เก่ากว่า cutoff — ใช้กับ log ทั้งสองก้อน (`created_at` เหมือนกัน). */
export const olderThanFilter = (cutoff: Date): Record<string, unknown> => ({
  created_at: { $lt: cutoff },
});

/** ยังไม่ปิด และเก่ากว่า cutoff — ชุดที่ `--close-open` จะจัดการ. */
export const stillOpenFilter = (cutoff: Date): Record<string, unknown> => ({
  created_at: { $lt: cutoff },
  job_status: { $ne: 2 },
});

/** ลบเป็นก้อน — ยิงทีเดียวหลายพัน doc ทำ prod ค้างได้. */
async function deleteInBatches(
  col: mongoose.mongo.Collection,
  filter: Record<string, unknown>,
  size: number,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const ids = (
      await col
        .find(filter, { projection: { _id: 1 } })
        .limit(size)
        .toArray()
    ).map((d) => d._id);
    if (ids.length === 0) break;
    const res = await col.deleteMany({ _id: { $in: ids } });
    removed += res.deletedCount ?? 0;
    if (ids.length < size) break;
  }
  return removed;
}

/* ── restore ───────────────────────────────────────────────────────────── */

async function runRestore(db: mongoose.mongo.Db, file: string): Promise<void> {
  const path = file.includes('/') ? file : resolve(BACKUP_DIR, file);
  const backup = JSON.parse(readFileSync(path, 'utf8')) as BackupFile;
  log(`กู้คืนจาก ${path}  (สำรองไว้เมื่อ ${backup.created_at})`);

  const restored: Record<string, number> = {};
  for (const [name, docs] of Object.entries(backup.deleted)) {
    if (!RESTORABLE.has(name)) {
      log(`  ⚠️ ข้าม ${name} — ไม่อยู่ในรายการที่อนุญาตให้กู้`);
      continue;
    }
    if (!Array.isArray(docs) || docs.length === 0) continue;
    if (!apply) {
      log(`  [DRY] ${name}: จะ insert ${docs.length} docs`);
      restored[name] = 0;
      continue;
    }
    // ordered:false ⇒ _id ที่มีอยู่แล้วถูกข้าม ไม่ล้มทั้งชุด (กู้ซ้ำได้)
    try {
      const res = await db
        .collection(name)
        .insertMany(docs as never[], { ordered: false });
      restored[name] = res.insertedCount ?? 0;
    } catch (e) {
      const inserted = (e as { result?: { nInserted?: number } })?.result
        ?.nInserted;
      restored[name] = inserted ?? 0;
    }
    log(`  ${name}: กู้คืน ${restored[name]} / ${docs.length}`);
  }

  if (backup.closed_tickets?.length || backup.reset_rooms?.length) {
    log('');
    log(
      '⚠️ ไฟล์นี้มีบันทึกการปิดเคส/ปลดล็อกห้องไว้ด้วย — ต้องย้อนเอง (ไม่อัตโนมัติ)',
    );
    log(`   ticket ที่ถูกปิด : ${backup.closed_tickets?.length ?? 0}`);
    log(`   ห้องที่ถูกปลดล็อก: ${backup.reset_rooms?.length ?? 0}`);
  }
  if (asJson) console.log(JSON.stringify({ restored }, null, 2));
  if (!apply) log('\nDRY RUN — ใส่ --yes เพื่อกู้จริง');
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  await mongoose.connect(URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db connection');

  if (restoreFile) {
    await runRestore(db, restoreFile);
    return;
  }

  if (!wantTickets && !wantWebhookLogs && !wantAuditLogs) usage();

  const cutoff = new Date(Date.now() - days * 86_400_000);
  log(`cutoff: ${cutoff.toISOString()}  (${days} วัน)`);
  log(
    apply
      ? '⚠️ APPLY — จะลบจริง'
      : 'DRY RUN — ไม่มีอะไรถูกแตะ (ใส่ --yes เพื่อลบจริง)',
  );
  log('');

  const tickets = db.collection('tickets');
  const rooms = db.collection('chat_rooms');

  /* ── 1. นับก่อนเสมอ (read-only) ─────────────────────────────────────── */
  const closedFilter = closedTicketFilter(cutoff);
  const counts = {
    tickets_total_old: await tickets.countDocuments({
      created_at: { $lt: cutoff },
    }),
    tickets_closed_deletable: await tickets.countDocuments(closedFilter),
    tickets_still_open: await tickets.countDocuments({
      created_at: { $lt: cutoff },
      job_status: { $ne: 2 },
    }),
    webhook_logs: await db
      .collection('webhook_logs')
      .countDocuments({ created_at: { $lt: cutoff } }),
    hook_audit_logs: await db
      .collection('hook_audit_logs')
      .countDocuments({ created_at: { $lt: cutoff } }),
  };

  log('นับก่อน (read-only):');
  if (wantTickets) {
    log(`  tickets เก่ากว่า cutoff ทั้งหมด : ${counts.tickets_total_old}`);
    log(`  ├─ ปิดแล้ว → ลบได้            : ${counts.tickets_closed_deletable}`);
    log(`  └─ ⚠️ ยังค้างเปิด → ห้ามลบดิบ   : ${counts.tickets_still_open}`);
  }
  if (wantWebhookLogs)
    log(`  webhook_logs                 : ${counts.webhook_logs}`);
  if (wantAuditLogs)
    log(`  hook_audit_logs              : ${counts.hook_audit_logs}`);
  log('');

  const backup: BackupFile = {
    created_at: new Date().toISOString(),
    cutoff: cutoff.toISOString(),
    days,
    deleted: {},
  };

  /* ── 2. ปิดใบค้าง + ปลดล็อกห้อง (ลำดับนี้เท่านั้น) ──────────────────── */
  if (wantTickets && counts.tickets_still_open > 0) {
    if (!closeOpen) {
      log(
        `⚠️ มี ${counts.tickets_still_open} ใบที่ยังค้างเปิด — จะไม่ถูกแตะ` +
          ' (ใส่ --close-open ถ้าต้องการปิดให้เรียบร้อยก่อนลบ)',
      );
      log('');
    } else {
      const openFilter = {
        created_at: { $lt: cutoff },
        job_status: { $ne: 2 },
      };
      // อ่านคู่ห้องก่อน — แตะ ticket ก่อนแล้วจะหาห้องไม่เจออีกเลย
      const openTickets = await tickets
        .find(openFilter, {
          projection: { _id: 1, chat_user_id: 1, hook_id: 1, job_status: 1 },
        })
        .toArray();
      const pairSet = new Set(
        openTickets
          .filter((t) => t.chat_user_id && t.hook_id)
          .map((t) => `${String(t.chat_user_id)}|${String(t.hook_id)}`),
      );
      const roomCandidates = await rooms
        .find(
          {
            assist_status: true,
            user_id: {
              $in: openTickets.map((t) => t.chat_user_id).filter(Boolean),
            },
            hook_id: { $in: openTickets.map((t) => t.hook_id).filter(Boolean) },
          },
          { projection: { _id: 1, user_id: 1, hook_id: 1, assist_status: 1 } },
        )
        .toArray();
      const roomIds = roomCandidates
        .filter((r) => pairSet.has(`${String(r.user_id)}|${String(r.hook_id)}`))
        .map((r) => r._id);

      backup.closed_tickets = openTickets;
      backup.reset_rooms = roomCandidates.filter((r) =>
        roomIds.some((id) => String(id) === String(r._id)),
      );

      log(
        `ปิดใบค้าง: ${openTickets.length} ใบ · ปลดล็อกห้อง: ${roomIds.length} ห้อง`,
      );
      if (apply) {
        const now = new Date();
        // ห้องก่อน — ถ้า ticket หายก่อน คู่ห้องจะหาไม่เจอ
        if (roomIds.length > 0) {
          await rooms.updateMany(
            { _id: { $in: roomIds }, assist_status: true },
            { $set: { assist_status: false, last_assist_changed_at: now } },
          );
        }
        await tickets.updateMany(openFilter, {
          $set: { job_status: 2, resolved_at: now },
        });
        log('  ✅ ปิด + ปลดล็อกแล้ว');
      }
      log('');
    }
  }

  /* ── 3. เก็บ backup ของทุก doc ที่จะลบ ─────────────────────────────── */
  const toDelete: Array<{ name: string; filter: Record<string, unknown> }> = [];

  let ticketIds: unknown[] = [];
  if (wantTickets) {
    // อ่านใหม่หลังขั้น 2 — ใบที่เพิ่งปิดต้องถูกนับด้วยเมื่อผ่าน cutoff
    ticketIds = (
      await tickets
        .find(closedTicketFilter(cutoff), { projection: { _id: 1 } })
        .toArray()
    ).map((d) => d._id);
    if (ticketIds.length > 0) {
      // พ่วงก่อน — ลบ ticket ก่อนจะเหลือแถวกำพร้าที่หาเจ้าของไม่ได้
      toDelete.push({
        name: 'assign_histories',
        filter: { ticket_id: { $in: ticketIds } },
      });
      toDelete.push({ name: 'tickets', filter: { _id: { $in: ticketIds } } });
    }
  }
  if (wantWebhookLogs) {
    toDelete.push({
      name: 'webhook_logs',
      filter: { created_at: { $lt: cutoff } },
    });
  }
  if (wantAuditLogs) {
    toDelete.push({
      name: 'hook_audit_logs',
      filter: { created_at: { $lt: cutoff } },
    });
  }

  const plan: Record<string, number> = {};
  for (const { name, filter } of toDelete) {
    const docs = await db.collection(name).find(filter).toArray();
    plan[name] = docs.length;
    backup.deleted[name] = docs;
  }

  log('จะลบ:');
  for (const { name } of toDelete) log(`  ${name}: ${plan[name]}`);
  log('');

  if (!apply) {
    log(
      'DRY RUN — ไม่มีอะไรถูกลบ · ใส่ --yes เพื่อลบจริง (backup จะถูกเขียนก่อนลบ)',
    );
    if (asJson) console.log(JSON.stringify({ counts, plan }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(BACKUP_DIR, `purge-${stamp}.json`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(backupPath, JSON.stringify(backup), 'utf8');
  log(`💾 backup: ${backupPath}`);

  /* ── 4-6. ลบเป็นก้อน ตามลำดับ (พ่วงก่อน → ticket → log) ───────────── */
  const deleted: Record<string, number> = {};
  for (const { name, filter } of toDelete) {
    deleted[name] = await deleteInBatches(
      db.collection(name),
      filter,
      batchSize,
    );
    log(`  ลบ ${name}: ${deleted[name]}`);
  }

  log('');
  log(
    `✅ เสร็จ · กู้คืน: node dist/cli/purge-old-records.js --restore ${backupPath} --yes`,
  );
  if (asJson)
    console.log(JSON.stringify({ counts, deleted, backupPath }, null, 2));
}

/**
 * Entry point. Everything with a side effect lives in here so the pure filters
 * above can be imported by tests without connecting to a database or exiting
 * the process. Runs only when this file IS the process entry (`node dist/cli/…`).
 */
function runCli(): void {
  if (!URI) {
    console.error('❌ ต้องตั้ง MONGODB_URI (env) ก่อน');
    process.exit(1);
  }
  assertSafeToRun();
  void main()
    .catch((e) => {
      console.error('❌ ล้มเหลว:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => void mongoose.disconnect());
}

if (require.main === module) runCli();

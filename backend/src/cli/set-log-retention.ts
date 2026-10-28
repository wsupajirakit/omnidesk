/**
 * [FEAT-20260815-WLOGTTL30] Change how long `webhook_logs` are kept.
 * ===========================================================================
 * เจ้าของสั่ง 15/08: *"กำหนด ttl ให้ webhook log ใหม่ 30 วัน"* + *"ทำเป็น script
 * run บน server run env เลย เหมือนทำ seed"*.
 *
 * ## ทำไมต้องมีสคริปต์ ไม่ใช่แค่แก้ schema
 * Mongo **ปฏิเสธการแก้ `expireAfterSeconds` ของ index ที่มีอยู่แล้ว** และ
 * `ensureIndex` ของ Mongoose จะ **เงียบ ๆ ใช้ค่าเดิม** เมื่อ key pattern ซ้ำ ⇒
 * แก้เลขใน schema อย่างเดียว = โค้ดบอก 30 แต่ฐานจริงยังลบที่ 90 วัน และไม่มีใคร
 * รู้ว่าไม่เคยมีผล การเปลี่ยน retention จึงต้องมีขั้นตอนบนฐานจริงเสมอ.
 *
 * ## ลำดับ (ลบก่อน สร้างทีหลัง — บังคับ ไม่มีทางเลือก)
 *   1. **นับก่อน** ว่าจะหายกี่แถว (read-only) — TTL ลบแล้วกู้ไม่ได้
 *   2. **ลบ** ทุก index ที่ถือคีย์ `{created_at:1}` — ตามคีย์ ไม่ใช่ตามชื่อ
 *   3. **สร้าง** `created_at_ttl<days>` ชื่อตามจำนวนวันจริง
 *
 * ทำไมต้องลบก่อน: Mongo ยอมให้มี index ต่อหนึ่ง key pattern เพียงตัวเดียว
 * สร้างก่อนจะได้ "An equivalent index already exists with a different name and
 * options" ทันที (พิสูจน์แล้วบน local 15/08).
 *
 * ## [FEAT-20260901-AUDITTTL] `hook_audit_logs` — now reachable, by name only
 * This file used to refuse to touch `hook_audit_logs` at all, on the grounds
 * that an audit trail is EVIDENCE rather than an operational log, and said any
 * TTL for it had to be a separate instruction from the owner. That instruction
 * came on 01/09: keep audit rows 45 days too.
 *
 * It is still not the default. `--collection hook_audit_logs` is required, so
 * nobody deletes an audit trail by running this script the usual way and
 * nobody can do it by accident. Measured before applying: 0 rows were older
 * than 45 days (oldest 27/07), so the first run removes nothing — the deletions
 * start about nine days later.
 *
 * ⚠️ What this costs, stated plainly: after this, "who switched this off, and
 * when" is unanswerable beyond 45 days. That is the trade the owner chose.
 *
 * ## ใช้
 *   node dist/cli/set-log-retention.js              # DRY RUN — นับอย่างเดียว (45 วัน)
 *   node dist/cli/set-log-retention.js --yes        # ทำจริง → created_at_ttl45
 *   node dist/cli/set-log-retention.js --days 60    # ใช้ค่าอื่น → created_at_ttl60
 *   node dist/cli/set-log-retention.js --revert --yes   # กลับไป 90 วัน (created_at_1)
 *   node dist/cli/set-log-retention.js --collection hook_audit_logs --yes   # audit 45 วัน
 *
 * รันซ้ำได้เสมอ (idempotent): ถ้า index ตรงอยู่แล้วมันไม่แตะอะไรเลย และถ้าเจอ
 * ชื่อเก่าจากรอบก่อนก็ลบให้เอง ⇒ เปลี่ยนเลขกี่รอบก็ไม่ติด.
 *
 * อ่าน `MONGODB_URI` จาก env เอง = ตัวเดียวกับที่แอปใช้ ⇒ ในคอนเทนเนอร์สั่งได้เลย
 * ไม่ต้อง export อะไรเพิ่ม (แบบเดียวกับ `purge-old-records.ts`).
 *
 * ⚠️ **กู้คืนไม่ได้**: index สร้างใหม่ได้เสมอ แต่เอกสารที่ TTL ลบไปแล้วหายถาวร
 *    สคริปต์นี้จึงไม่ยอมทำอะไรจนกว่าจะใส่ `--yes` และรายงานจำนวนที่จะหายก่อนทุกครั้ง.
 *
 * revert: `--revert --yes` (คืน index 90 วัน) + แก้ `webhook-log.schema.ts` กลับ
 *         · ข้อมูลที่ถูกลบไปแล้วกู้ไม่ได้ด้วยวิธีใด
 */
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI;

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const apply = has('--yes');
const revert = has('--revert');

/**
 * Owner's decision 15/08: 30 was the first call, revised to **45** the same day
 * after the dry run showed 296 logs and nothing older than a month — a wider
 * window costs almost nothing here. `--revert` restores the 90-day policy.
 */
const DEFAULT_DAYS = 45;
const LEGACY_DAYS = 90;
const days = Number(valueOf('--days') ?? (revert ? LEGACY_DAYS : DEFAULT_DAYS));

/**
 * [FEAT-20260901-AUDITTTL] Which collection. Defaults to `webhook_logs`, so the
 * documented commands keep meaning what they meant.
 *
 * The allow-list is not decoration: this script DROPS AND CREATES indexes and
 * installs a TTL that deletes rows. A typo'd collection name must fail loudly
 * rather than quietly build a TTL somewhere nobody expected one.
 */
const ALLOWED_COLLECTIONS = ['webhook_logs', 'hook_audit_logs'] as const;
const COLLECTION = valueOf('--collection') ?? 'webhook_logs';
const FIELD = 'created_at';
/** The 90-day index that shipped with the collection. */
const OLD_INDEX = 'created_at_1';

const DAY_MS = 86_400_000;

/* ── pure helpers (exported for tests — no DB, no process.exit) ─────────── */

/** Cutoff date implied by a retention window. Documents older than this go. */
export const cutoffFor = (retentionDays: number, now = Date.now()): Date =>
  new Date(now - retentionDays * DAY_MS);

/** Mongo wants seconds; the CLI speaks days. */
export const secondsFor = (retentionDays: number): number =>
  Math.round(retentionDays * 86_400);

/**
 * Which index name to install for a given policy.
 *
 * ⚠️ The number in the name is DERIVED from the retention actually applied — it
 * is never hard-coded. An earlier version pinned the string `created_at_ttl30`,
 * so `--days 45` installed a 45-day TTL under a name that read "30". The index
 * worked; the name lied, and the next person to open Mongo would have believed
 * the name. A name that can disagree with its own value is a trap, so the two
 * are now generated from one number.
 *
 * Reverting reinstalls the ORIGINAL name so the database ends up exactly as it
 * shipped — a revert that left a differently-named index behind would look
 * fixed while the schema and the database disagreed on the name forever.
 *
 * ชื่อ index ต้องมาจากจำนวนวันจริงเสมอ · ห้าม hardcode เลขในชื่อ.
 */
export const targetIndexName = (
  isRevert: boolean,
  retentionDays: number,
): string => (isRevert ? OLD_INDEX : `${FIELD}_ttl${retentionDays}`);

/**
 * Every index on this field that a previous run may have installed, so the drop
 * step can clear the way for the new one.
 *
 * ⚠️ This CANNOT be a fixed pair of names. Mongo allows only ONE index per key
 * pattern, so ANY leftover TTL index on `created_at` blocks the create with
 * "An equivalent index already exists with a different name and options" —
 * including one this tool itself installed under a different day count. Listing
 * two names would have failed the moment retention changed twice.
 *
 * The runner therefore drops by KEY PATTERN (see `isOnField`), and this helper
 * exists for the dry-run message and the tests. ต้องลบทุกตัวที่ถือ key เดียวกัน
 * ไม่ใช่แค่ชื่อที่รู้จัก — ไม่งั้นรันรอบที่สองล้มแน่.
 */
export const staleIndexNames = (
  isRevert: boolean,
  retentionDays: number,
  existingNames: readonly string[] = [],
): string[] => {
  const keep = targetIndexName(isRevert, retentionDays);
  const known = [OLD_INDEX, `${FIELD}_ttl${retentionDays}`];
  return [...new Set([...known, ...existingNames])].filter((n) => n !== keep);
};

/** Does an index sit on exactly `{ created_at: 1 }` — the pattern we contend for? */
export const isOnField = (
  key: Record<string, unknown> | undefined,
): boolean => {
  if (!key) return false;
  const entries = Object.keys(key);
  return entries.length === 1 && entries[0] === FIELD;
};

/* ── runner ────────────────────────────────────────────────────────────── */

interface IndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  expireAfterSeconds?: number;
}

const describe = (i: IndexInfo): string =>
  `${i.name} ${JSON.stringify(i.key)}` +
  (i.expireAfterSeconds !== undefined
    ? `  TTL=${i.expireAfterSeconds}s (${i.expireAfterSeconds / 86_400} วัน)`
    : '');

async function runCli(): Promise<void> {
  if (!URI) {
    console.error('❌ ไม่มี MONGODB_URI ใน env');
    process.exit(1);
  }
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`❌ --days ต้องเป็นจำนวนวันบวก (ได้: ${String(days)})`);
    process.exit(1);
  }
  /* [FEAT-20260901-AUDITTTL] Refuse anything not on the list, by name. */
  if (!(ALLOWED_COLLECTIONS as readonly string[]).includes(COLLECTION)) {
    console.error(
      `❌ --collection "${COLLECTION}" ไม่อยู่ในรายการที่อนุญาต ` +
        `(${ALLOWED_COLLECTIONS.join(', ')})`,
    );
    process.exit(1);
  }

  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db connection');
  const col = db.collection(COLLECTION);

  const wanted = targetIndexName(revert, days);
  const seconds = secondsFor(days);
  const cutoff = cutoffFor(days);

  console.log(`DB          : ${mongoose.connection.name}`);
  console.log(`collection  : ${COLLECTION}`);
  console.log(`retention   : ${days} วัน (${seconds}s)`);
  console.log(`cutoff      : ${cutoff.toISOString()}`);
  console.log('');

  // ── 1. อ่านสภาพปัจจุบัน ───────────────────────────────────────────────
  const existing = (await col.indexes()) as IndexInfo[];
  const ttlNow = existing.filter((i) => i.expireAfterSeconds !== undefined);
  console.log('index ตอนนี้:');
  if (ttlNow.length === 0) console.log('  (ไม่มี TTL index เลย)');
  ttlNow.forEach((i) => console.log(`  ${describe(i)}`));
  console.log('');

  // ── 2. นับก่อนเสมอ — read-only, ห้ามข้าม ──────────────────────────────
  const total = await col.countDocuments({});
  const doomed = await col.countDocuments({ [FIELD]: { $lt: cutoff } });
  console.log('นับก่อน (read-only):');
  console.log(`  เอกสารทั้งหมด            : ${total}`);
  console.log(`  เก่ากว่า ${days} วัน → จะถูกลบ : ${doomed}`);
  if (doomed > 0) {
    console.log(
      `  ⚠️ ${doomed} แถวนี้จะถูก Mongo ลบทิ้งภายในไม่กี่นาทีหลังสร้าง index — กู้ไม่ได้`,
    );
  }
  console.log('');

  /* Everything currently holding our key pattern — these are what block the
     create, whatever they happen to be called. Read from the DB, not guessed. */
  const contending = existing.filter(
    (i) => isOnField(i.key) && i.name && i.name !== wanted,
  );

  if (!apply) {
    console.log('DRY RUN — ไม่มีอะไรถูกแตะ (ใส่ --yes เพื่อทำจริง)');
    console.log('จะทำ:');
    contending.forEach((i, n) =>
      console.log(`  ${n + 1}) dropIndex "${i.name}"`),
    );
    console.log(
      `  ${contending.length + 1}) createIndex {${FIELD}:1} expireAfterSeconds=${seconds} name="${wanted}"`,
    );
    await mongoose.disconnect();
    return;
  }

  // ── 3. DROP ก่อน แล้วค่อย CREATE ─────────────────────────────────────
  /* ⚠️ ลำดับนี้ถูกแก้หลังลองจริงบน local 15/08 — แผนแรกคือ "สร้างก่อนลบ" เพื่อ
     ไม่ให้มีช่วงที่ไม่มี index แต่ Mongo ปฏิเสธ:

       "An equivalent index already exists with a different name and options"

     Mongo ไม่ยอมให้มีสอง index ที่ key pattern เหมือนกัน ต่อให้ตั้งชื่อต่างกัน
     ⇒ **บังคับต้องลบก่อนสร้าง ไม่มีทางเลือกอื่น** · สคริปต์ล้มตรงนั้นพอดี ก่อน
     แตะอะไร index เดิมจึงอยู่ครบ — แต่ในรอบจริงต้องยอมรับช่วงว่างสั้น ๆ

     ช่วงว่างนี้ยอมรับได้เพราะ: มี `status_1_created_at_-1` รับ query ที่กรอง
     status อยู่แล้ว, `createIndex` บน collection ขนาดนี้จบในเสี้ยววินาที, และ
     ทั้งสองคำสั่งอยู่ติดกันไม่มี await อื่นคั่น. ถ้า `createIndex` ล้มหลังลบ
     สำเร็จ สคริปต์จะบอกคำสั่งกู้ให้ทันทีในบรรทัดถัดไป. */
  const wantedNow = existing.find((i) => i.name === wanted);
  if (
    wantedNow &&
    wantedNow.expireAfterSeconds === seconds &&
    contending.length === 0
  ) {
    console.log(`✓ "${wanted}" มีอยู่แล้วและค่าตรง — ไม่ต้องทำอะไร`);
  } else {
    /* Drop by KEY PATTERN, not by a list of names we think might be there.
       A run that renamed the index (30 → 45) leaves a name this tool would not
       have guessed, and Mongo would then reject the create. ลบตามคีย์ ไม่ใช่ตามชื่อ */
    for (const i of contending) {
      await col.dropIndex(i.name as string);
      console.log(`✓ ลบ "${i.name}" แล้ว`);
    }
    // The wanted name existing with a WRONG value must go too — same key pattern.
    if (wantedNow && wantedNow.expireAfterSeconds !== seconds) {
      await col.dropIndex(wanted);
      console.log(`✓ ลบ "${wanted}" (ค่าเดิมไม่ตรง) แล้ว`);
    }
    try {
      await col.createIndex(
        { [FIELD]: 1 },
        { expireAfterSeconds: seconds, name: wanted },
      );
      console.log(`✓ สร้าง "${wanted}" แล้ว (${days} วัน)`);
    } catch (e) {
      console.error('');
      console.error('❌ ลบสำเร็จแต่สร้างไม่สำเร็จ — ตอนนี้ไม่มี TTL index!');
      console.error('   รันคำสั่งนี้เพื่อกู้ทันที:');
      console.error(
        `   db.${COLLECTION}.createIndex({${FIELD}:1},{expireAfterSeconds:${seconds},name:"${wanted}"})`,
      );
      throw e;
    }
  }

  // ── 5. ยืนยันผลจากฐานจริง ไม่ใช่จากที่เราเพิ่งสั่ง ─────────────────────
  console.log('');
  console.log('index หลังทำ:');
  const after = (await col.indexes()) as IndexInfo[];
  after
    .filter((i) => i.expireAfterSeconds !== undefined)
    .forEach((i) => console.log(`  ${describe(i)}`));

  const ok = after.some(
    (i) => i.name === wanted && i.expireAfterSeconds === seconds,
  );
  console.log('');
  console.log(
    ok
      ? `✅ สำเร็จ — ${COLLECTION} เก็บ ${days} วัน`
      : '❌ ไม่สำเร็จ — index ที่ต้องการไม่อยู่ในฐาน ตรวจสิทธิ์ผู้ใช้ DB',
  );

  await mongoose.disconnect();
  if (!ok) process.exit(1);
}

/**
 * Side effects only when run as a program — importing this file for tests must
 * never connect to a database or exit the process.
 */
if (require.main === module) {
  runCli().catch((e: unknown) => {
    console.error('❌ ล้มเหลว:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

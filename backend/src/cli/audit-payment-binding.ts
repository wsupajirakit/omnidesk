/**
 * audit-payment-binding.ts — ตรวจ hook ที่ผูก payment tool ด้วย SCHEMA เก่า (READ-ONLY)
 * ==================================================================================
 *
 * ## ใช้ยังไง
 * ```bash
 * node dist/cli/audit-payment-binding.js            # ตรวจทุก hook, พิมพ์รายงาน
 * node dist/cli/audit-payment-binding.js --json      # ผลเป็น JSON (feed อีก command)
 * ```
 * อ่าน `MONGODB_URI` จาก env เอง (ตัวเดียวกับที่แอปใช้) — รันในคอนเทนเนอร์ได้.
 *
 * ## ตรวจอะไร
 * payment-runner อ่านแค่ `payment_tool_id`/`payment_tool_status` (schema ใหม่),
 * ไม่เคยอ่าน `custom_tool_id` (schema เก่า — `payment-runner.service.ts:601,608`).
 * hook ที่ตั้ง tool ไว้สมัย field เก่า (มี `custom_tool_id` แต่ `payment_tool_id` ว่าง)
 * ⇒ payment/walletpay จะไม่รัน (GATE A ปิด). CLI นี้หา hook พวกนั้นและแจ้ง alias.
 *
 * ## READ-ONLY — ไม่เขียนอะไรเลย
 * ตรวจอย่างเดียว. การแก้อยู่ที่ command แยก `fix-payment-binding.ts` (ต้องระบุ alias).
 *
 * revert: ลบไฟล์นี้ + `fix-payment-binding.ts` + 2 script ใน package.json.
 */
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('❌ ต้องตั้ง MONGODB_URI (env) ก่อน');
  process.exit(1);
}

const asJson = process.argv.includes('--json');

async function main() {
  await mongoose.connect(URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db connection');
  const hooks = await db
    .collection('hooks')
    .find(
      {},
      {
        projection: {
          alias: 1,
          status: 1,
          custom_tool_id: 1,
          custom_tool_status: 1,
          payment_tool_id: 1,
          payment_tool_status: 1,
          walletpay_tool_id: 1,
          walletpay_tool_status: 1,
        },
      },
    )
    .toArray();

  const rows = hooks.map((h) => {
    const hasNewPayment = !!h.payment_tool_id;
    const hasLegacy = !!h.custom_tool_id;
    // "ผิด schema" = ตั้ง tool ไว้ด้วย field เก่า (custom_tool_id) แต่ field ใหม่
    // (payment_tool_id) ว่าง ⇒ payment-runner จะมองไม่เห็น = ไม่รัน.
    const staleLegacyOnly = hasLegacy && !hasNewPayment;
    return {
      alias: h.alias as string,
      status: h.status,
      custom_tool_id: h.custom_tool_id ? String(h.custom_tool_id) : null,
      payment_tool_id: h.payment_tool_id ? String(h.payment_tool_id) : null,
      walletpay_tool_id: h.walletpay_tool_id
        ? String(h.walletpay_tool_id)
        : null,
      payment_tool_status: h.payment_tool_status ?? null,
      walletpay_tool_status: h.walletpay_tool_status ?? null,
      staleLegacyOnly,
    };
  });

  const bad = rows.filter((r) => r.staleLegacyOnly);

  if (asJson) {
    console.log(JSON.stringify({ total: rows.length, bad }, null, 2));
  } else {
    console.log(`\n=== ตรวจ ${rows.length} hooks ===`);
    for (const r of rows) {
      const mark = r.staleLegacyOnly
        ? '🔴 SCHEMA เก่า (custom_tool_id ตั้งไว้ แต่ payment_tool_id ว่าง)'
        : r.payment_tool_id
          ? '✅ ใช้ field ใหม่'
          : '·  ไม่ผูก payment tool';
      console.log(`  ${r.alias.padEnd(16)} status=${r.status}  ${mark}`);
    }
    console.log('');
    if (bad.length) {
      console.log(
        `🔴 ต้องแก้ ${bad.length} hook (payment/walletpay ไม่รันเพราะ field เก่า):`,
      );
      bad.forEach((r) =>
        console.log(
          `   - ${r.alias}  (custom_tool_id=${r.custom_tool_id})  → แก้ด้วย: node dist/cli/fix-payment-binding.js ${r.alias} --yes`,
        ),
      );
    } else {
      console.log(
        '✅ ไม่มี hook ที่ผูก tool ด้วย schema เก่า — ทุกตัวใช้ payment_tool_id',
      );
    }
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

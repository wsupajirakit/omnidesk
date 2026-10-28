/**
 * ==== [TEMP-20260810-SEEDCLI] seed การ์ด payment reply + bind ให้ OA — รันในคอนเทนเนอร์ ====
 *
 * 🔴 **ของชั่วคราว ตั้งใจให้ลบทิ้ง** — เจ้าของสั่ง 2026-08-10: "ง่ายๆปลอดภัย ค่อยเอาสคริปออก"
 * ใช้ตั้งค่า stg รอบเดียวแล้วลบไฟล์นี้ + บรรทัด `seed:cards` ใน package.json ออก
 * ไม่มีอะไรอื่นอ้างถึงมันเลย ลบแล้วไม่กระทบอะไร
 *
 * ## ทำไมต้องอยู่ใน `src/` ไม่ใช่ `z-test/`
 * `.dockerignore` ตัด `z-test` ทั้งโฟลเดอร์ และ runtime stage ก็อปแค่ `dist` +
 * `node_modules` + `public` ⇒ `z-test/seeder_final.mjs` **ไม่มีอยู่ในคอนเทนเนอร์เลย**
 * (อาการที่เจอ: `Cannot find module '/app/z-test/seeder_final.mjs'`)
 * ของที่นี่ถูก compile เป็น `dist/cli/seed-payment-cards.js` จึงติดไปกับ image
 *
 * ## ใช้ยังไง (ในคอนเทนเนอร์ ไม่ต้องส่ง env อะไรเลย)
 * ```bash
 * node dist/cli/seed-payment-cards.js omnideskdevoa          # dry-run (ค่าเริ่มต้น)
 * node dist/cli/seed-payment-cards.js omnideskdevoa --yes     # เขียนจริง
 * node dist/cli/seed-payment-cards.js --list               # ดูทุก OA
 * ```
 * อ่าน `MONGODB_URI` จาก env ของคอนเทนเนอร์เอง — ตัวเดียวกับที่แอปใช้
 *
 * ## 🔒 กันพลาด 3 ชั้น (เพราะไฟล์นี้ติดไปกับ image ของ prod ด้วย)
 * 1. **dry-run เป็นค่าเริ่มต้น** — ไม่ใส่ `--yes` = ไม่เขียนอะไรเลย
 * 2. **ต้องระบุ OA เสมอ** — ไม่มี default ไม่มี "ทุก OA"
 * 3. **ปฏิเสธบน production** — `NODE_ENV=production` หรือ `WS_ENV=prod` ⇒ ออกทันที
 *    ต้องตั้ง `SEED_ALLOW_PROD=1` ถ้าจงใจจริง (ตั้งใจให้ยาก ไม่ใช่ให้สะดวก)
 *
 * ## เขียนอะไร
 * `flex_messages` 5 ใบ (upsert by name) + `hooks.payment_flex_ids` ของ OA ที่ระบุ
 * `content_json` ทับทุกครั้ง · flag/ข้อความ ticket เขียนแค่ตอนสร้างใหม่ (`$setOnInsert`)
 * ⇒ รันซ้ำไม่ทับค่าที่แอดมินแก้จาก UI
 * 3 state ที่ไม่อยู่ในนี้ (`topup_success`/`walletpay_success`/`matched_pending`) ตั้งใจไม่ผูก
 * ⇒ ตอบเหมือนเดิม (การ์ด Swiftcheck / text เดิม)
 *
 * revert: ลบไฟล์นี้ + script `seed:cards` · ถอน binding ด้วย `--unbind --yes`
 */
import mongoose from 'mongoose';
import { CARDS } from './seed-payment-cards.data';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const target = args.find((a) => !a.startsWith('--'));
  const write = has('--yes'); // ไม่ใส่ = dry-run

  // ชั้นที่ 3 — prod ต้องจงใจจริงถึงจะผ่าน
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.WS_ENV === 'prod';
  if (isProd && process.env.SEED_ALLOW_PROD !== '1') {
    console.error(
      'ปฏิเสธ: นี่คือ production (NODE_ENV/WS_ENV) — ตั้ง SEED_ALLOW_PROD=1 ถ้าจงใจจริง',
    );
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ไม่มี MONGODB_URI ใน env ของคอนเทนเนอร์');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('ต่อ DB ไม่ได้');
    process.exit(1);
  }
  const hooks = db.collection('hooks');
  const flexes = db.collection('flex_messages');

  try {
    if (has('--list')) {
      console.log('alias                status  pay    bound');
      const rows = await hooks
        .find(
          {},
          {
            projection: {
              alias: 1,
              status: 1,
              payment_tool_status: 1,
              payment_flex_ids: 1,
            },
          },
        )
        .toArray();
      for (const h of rows) {
        const n = Object.keys((h.payment_flex_ids as object) ?? {}).length;
        console.log(
          `${String(h.alias).padEnd(20)} ${String(h.status).padEnd(7)} ` +
            `${String(!!h.payment_tool_status).padEnd(6)} ${n}`,
        );
      }
      return;
    }

    // ชั้นที่ 2 — ไม่ระบุ OA = ไม่ทำอะไร
    if (!target) {
      console.error(
        'usage: node dist/cli/seed-payment-cards.js <alias|hookId> [--yes|--unbind]',
      );
      console.error('       node dist/cli/seed-payment-cards.js --list');
      process.exit(1);
    }

    const hook = mongoose.isValidObjectId(target)
      ? await hooks.findOne({ _id: new mongoose.Types.ObjectId(target) })
      : await hooks.findOne({ alias: target });
    if (!hook) {
      console.error(`ไม่เจอ hook '${target}' — ดูรายชื่อด้วย --list`);
      process.exit(1);
    }
    console.log(
      `hook: ${String(hook.alias)} (${String(hook._id)})  status=${String(hook.status)}`,
    );
    if (!hook.payment_tool_status) {
      console.log(
        '⚠️  payment_tool_status ไม่ได้เปิด — bind ได้ แต่ payment ไม่ทำงาน',
      );
    }
    if (!write)
      console.log('— DRY RUN — ไม่เขียนอะไร (ใส่ --yes เพื่อเขียนจริง)');

    if (has('--unbind')) {
      if (write) {
        await hooks.updateOne(
          { _id: hook._id },
          { $unset: { payment_flex_ids: '' } },
        );
        console.log(`unbound — ทุก state กลับไปตอบแบบเดิม (การ์ดยังอยู่)`);
      } else {
        console.log('[dry] จะ $unset payment_flex_ids');
      }
      return;
    }

    const now = new Date();
    const map: Record<string, unknown> = {};

    for (const c of CARDS) {
      const seen = await flexes.findOne(
        { name: c.name },
        { projection: { _id: 1 } },
      );
      if (!write) {
        console.log(
          `[dry] ${(seen ? 'update' : 'create').padEnd(7)} ${c.name.padEnd(24)} → ${c.state}`,
        );
        continue;
      }
      await flexes.updateOne(
        { name: c.name },
        {
          $set: {
            flex_type: 'slip',
            content_json: c.content_json,
            updated_at: now,
          },
          // flag/ข้อความ แตะแค่ตอนสร้างใหม่ ⇒ ไม่ทับของที่แอดมินแก้จาก UI
          $setOnInsert: {
            direct_ticket_on_reply: c.direct_ticket_on_reply,
            direct_ticket_text: c.direct_ticket_text,
            content_tags: [],
            group_ids: [],
            created_at: now,
          },
        },
        { upsert: true },
      );
      const saved = await flexes.findOne(
        { name: c.name },
        { projection: { _id: 1, direct_ticket_on_reply: 1 } },
      );
      if (saved) {
        map[c.state] = saved._id; // ObjectId — resolver อ่าน string ก็ได้ แต่เก็บให้ตรงชนิด
        console.log(
          `  ${c.name.padEnd(24)} → ${c.state.padEnd(22)} flag=${String(saved.direct_ticket_on_reply)}`,
        );
      }
    }

    if (!write) {
      console.log(
        `[dry] แล้วจะ bind ${CARDS.length} states ให้ ${String(hook.alias)}`,
      );
      return;
    }

    // $set ทับทั้งก้อน ⇒ state ที่ไม่อยู่ใน CARDS จะถูกถอด binding (ตั้งใจ: เอา 5 ใบ)
    await hooks.updateOne(
      { _id: hook._id },
      { $set: { payment_flex_ids: map } },
    );
    const bound = Object.keys(map).sort().join(', ');
    console.log(
      `\nbound to ${String(hook.alias)}: ${Object.keys(map).length} states — ${bound}`,
    );
    console.log(
      'state ที่ไม่ได้ผูก (matched_pending, topup_success, walletpay_success) = ตอบเหมือนเดิม',
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e: Error) => {
  console.error('FAILED:', e?.message);
  process.exit(1);
});

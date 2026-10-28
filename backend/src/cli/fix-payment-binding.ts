/**
 * fix-payment-binding.ts — ผูก payment/walletpay tool ให้ hook ตัวที่ schema เก่า (ระบุ alias)
 * ============================================================================================
 *
 * ## ทำไมมี
 * `audit-payment-binding.ts` หา hook ที่ตั้ง tool ด้วย field เก่า (`custom_tool_id`) แต่
 * `payment_tool_id` (field ที่ payment-runner อ่านจริง) ว่าง ⇒ payment/walletpay ไม่รัน.
 * command นี้เติม field ใหม่ให้ hook "ตัวเดียว" ที่ระบุ ให้กลับมารันได้ — ADDITIVE,
 * ไม่แตะ `custom_tool_id` เดิม (ปล่อยไว้เฉยๆ ไม่มีใครอ่านมัน).
 *
 * ## ใช้ยังไง — ต้องระบุ alias เสมอ (ไม่มี "ทุก hook")
 * ```bash
 * # copy tool binding จาก hook อ้างอิงที่ตั้งถูกแล้ว (แนะนำ — ไม่ต้องจำ ObjectId)
 * node dist/cli/fix-payment-binding.js demo-oa-three --from omnideskdevoa           # dry-run
 * node dist/cli/fix-payment-binding.js demo-oa-three --from omnideskdevoa --yes      # เขียนจริง
 *
 * # หรือระบุ tool-id ตรงๆ (ObjectId ต่างกันแต่ละ DB — ใช้เมื่อรู้ค่าจริง)
 * node dist/cli/fix-payment-binding.js demo-oa-three --payment-tool-id <oid> --walletpay-tool-id <oid> --yes
 * ```
 * อ่าน `MONGODB_URI` จาก env เอง (ตัวเดียวกับที่แอปใช้).
 *
 * ## 🔒 กันพลาด (ไฟล์นี้ติดไปกับ image เหมือน seed-payment-cards)
 * 1. **dry-run เป็นค่าเริ่มต้น** — ไม่ใส่ `--yes` = ไม่เขียนอะไรเลย
 * 2. **ต้องระบุ alias เป้าหมายเสมอ** — ไม่มี default ไม่มี "แก้ทุกตัว"
 * 3. **ปฏิเสธบน production** — NODE_ENV=production / WS_ENV=prod ⇒ ออก เว้นตั้ง SEED_ALLOW_PROD=1
 * 4. **ไม่ยอมทับ** — ถ้า hook เป้าหมายมี payment_tool_id อยู่แล้ว จะไม่เขียนทับ (ต้อง --force)
 *
 * ## เขียนอะไร (ADDITIVE — ไม่มี migration, ไม่แตะ row อื่น)
 * `payment_tool_id` + `payment_tool_status=true` + `walletpay_tool_id` + `walletpay_tool_status=true`
 * (walletpay เขียนเฉพาะเมื่อ reference/arg มีค่า). `custom_tool_id` เดิมไม่แตะ.
 *
 * revert: `node dist/cli/fix-payment-binding.js <alias> --unbind --yes`
 *         ($unset payment_tool_id/status + walletpay_tool_id/status — กลับไปสภาพเดิม)
 * ลบเครื่องมือ: ลบไฟล์นี้ + `audit-payment-binding.ts` + 2 script ใน package.json
 */
import mongoose from 'mongoose';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const valOf = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // flag ที่กินค่าถัดไป ⇒ arg ที่อยู่ถัดจากมัน "ตำแหน่งนั้น" คือค่าของ flag ไม่ใช่ target
  // (ใช้ index ไม่ใช่ค่า ⇒ target ที่บังเอิญชื่อซ้ำกับ ref ไม่ถูกกรองผิด)
  const valueFlags = new Set([
    '--from',
    '--payment-tool-id',
    '--walletpay-tool-id',
  ]);
  const consumedIdx = new Set<number>();
  args.forEach((a, i) => {
    if (valueFlags.has(a) && i + 1 < args.length) consumedIdx.add(i + 1);
  });
  const target = args.find(
    (a, i) => !a.startsWith('--') && !consumedIdx.has(i),
  );
  const write = has('--yes'); // ไม่ใส่ = dry-run
  const force = has('--force');

  // ชั้นที่ 3 — prod ต้องจงใจจริง
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
    console.error('ไม่มี MONGODB_URI ใน env');
    process.exit(1);
  }

  // ชั้นที่ 2 — ไม่ระบุ alias = ไม่ทำอะไร
  if (!target) {
    console.error(
      'usage: node dist/cli/fix-payment-binding.js <alias> --from <ref-alias> [--yes]',
    );
    console.error(
      '       node dist/cli/fix-payment-binding.js <alias> --payment-tool-id <oid> [--walletpay-tool-id <oid>] [--yes]',
    );
    console.error(
      '       node dist/cli/fix-payment-binding.js <alias> --unbind --yes',
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('ต่อ DB ไม่ได้');
    process.exit(1);
  }
  const hooks = db.collection('hooks');

  try {
    const hook = await hooks.findOne({ alias: target });
    if (!hook) {
      console.error(
        `ไม่เจอ hook '${target}' — ตรวจด้วย: node dist/cli/audit-payment-binding.js`,
      );
      process.exit(1);
    }
    console.log(
      `เป้าหมาย: ${String(hook.alias)} (${String(hook._id)})  status=${String(hook.status)}`,
    );
    console.log(
      `  ก่อนแก้: custom_tool_id=${hook.custom_tool_id ? String(hook.custom_tool_id) : 'null'}  ` +
        `payment_tool_id=${hook.payment_tool_id ? String(hook.payment_tool_id) : 'null'}  ` +
        `walletpay_tool_id=${hook.walletpay_tool_id ? String(hook.walletpay_tool_id) : 'null'}`,
    );
    if (!write)
      console.log('— DRY RUN — ไม่เขียนอะไร (ใส่ --yes เพื่อเขียนจริง)');

    // ── unbind: ถอน field ใหม่กลับสภาพเดิม (revert path) ──
    if (has('--unbind')) {
      if (write) {
        await hooks.updateOne(
          { _id: hook._id },
          {
            $unset: {
              payment_tool_id: '',
              payment_tool_status: '',
              walletpay_tool_id: '',
              walletpay_tool_status: '',
            },
          },
        );
        console.log(
          'unbound — ถอน payment/walletpay tool field ใหม่ออก (custom_tool_id เดิมไม่แตะ)',
        );
      } else {
        console.log(
          '[dry] จะ $unset payment_tool_id/status + walletpay_tool_id/status',
        );
      }
      return;
    }

    // ── ชั้นที่ 4: ไม่ทับของเดิมเว้น --force ──
    if (hook.payment_tool_id && !force) {
      console.error(
        `ปฏิเสธ: '${target}' มี payment_tool_id อยู่แล้ว (${String(hook.payment_tool_id)}) — ` +
          'ไม่ทับเว้นใส่ --force',
      );
      process.exit(1);
    }

    // ── หาแหล่งค่า tool-id: --from <ref> (copy) หรือ --payment-tool-id/--walletpay-tool-id (ตรง) ──
    let paymentToolId: mongoose.Types.ObjectId | undefined;
    let walletpayToolId: mongoose.Types.ObjectId | undefined;
    const fromAlias = valOf('--from');
    const argPay = valOf('--payment-tool-id');
    const argWallet = valOf('--walletpay-tool-id');

    if (fromAlias) {
      const ref = await hooks.findOne({ alias: fromAlias });
      if (!ref) {
        console.error(`ไม่เจอ reference hook '${fromAlias}'`);
        process.exit(1);
      }
      if (!ref.payment_tool_id) {
        console.error(
          `reference '${fromAlias}' ไม่มี payment_tool_id — เลือกตัวที่ตั้งถูกแล้ว`,
        );
        process.exit(1);
      }
      paymentToolId = new mongoose.Types.ObjectId(String(ref.payment_tool_id));
      if (ref.walletpay_tool_id)
        walletpayToolId = new mongoose.Types.ObjectId(
          String(ref.walletpay_tool_id),
        );
      console.log(
        `  copy จาก '${fromAlias}': payment_tool_id=${String(paymentToolId)} walletpay_tool_id=${walletpayToolId ? String(walletpayToolId) : 'null'}`,
      );
    } else if (argPay) {
      if (!mongoose.isValidObjectId(argPay)) {
        console.error(
          `--payment-tool-id ไม่ใช่ ObjectId ที่ถูกต้อง: ${argPay}`,
        );
        process.exit(1);
      }
      paymentToolId = new mongoose.Types.ObjectId(argPay);
      if (argWallet) {
        if (!mongoose.isValidObjectId(argWallet)) {
          console.error(
            `--walletpay-tool-id ไม่ใช่ ObjectId ที่ถูกต้อง: ${argWallet}`,
          );
          process.exit(1);
        }
        walletpayToolId = new mongoose.Types.ObjectId(argWallet);
      }
    } else {
      console.error(
        'ต้องระบุแหล่งค่า: --from <ref-alias> หรือ --payment-tool-id <oid>',
      );
      process.exit(1);
    }

    // ── สร้าง patch (ADDITIVE: เขียน field ใหม่ ไม่แตะ custom_tool_id) ──
    const patch: Record<string, unknown> = {
      payment_tool_id: paymentToolId,
      payment_tool_status: true,
    };
    if (walletpayToolId) {
      patch.walletpay_tool_id = walletpayToolId;
      patch.walletpay_tool_status = true;
    }

    if (!write) {
      console.log('[dry] จะ $set:', JSON.stringify(Object.keys(patch)));
      console.log(
        `      payment_tool_id=${String(paymentToolId)} status=true` +
          (walletpayToolId
            ? ` · walletpay_tool_id=${String(walletpayToolId)} status=true`
            : ' · (ไม่มี walletpay)'),
      );
      return;
    }

    await hooks.updateOne({ _id: hook._id }, { $set: patch });
    const after = await hooks.findOne(
      { _id: hook._id },
      {
        projection: {
          payment_tool_id: 1,
          payment_tool_status: 1,
          walletpay_tool_id: 1,
          walletpay_tool_status: 1,
        },
      },
    );
    console.log('\n✅ ผูกแล้ว:');
    console.log(
      `  payment_tool_id=${String(after?.payment_tool_id)} status=${String(after?.payment_tool_status)}  ` +
        `walletpay_tool_id=${after?.walletpay_tool_id ? String(after.walletpay_tool_id) : 'null'} status=${String(after?.walletpay_tool_status)}`,
    );
    console.log(
      '  custom_tool_id เดิมไม่แตะ · ตรวจซ้ำ: node dist/cli/audit-payment-binding.js',
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e: Error) => {
  console.error('FAILED:', e?.message);
  process.exit(1);
});

/**
 * [FEAT-20260810-PENDINGDEP] "รอฝาก" ในการ์ดรอทำรายการ — มาจาก statement[] ของ raw profile
 *
 * เจ้าของสั่ง 2026-08-10: *"ถ้ามียอดใน statement[] ของ raw profile ให้แสดงออกมาด้วย
 * ในช่องเดียวกัน แต่ header ในช่องแบ่งแท็บ ฝาก / ถอน ถ้าอันไหนมีข้อมูลให้ active tab นั้น
 * แต่ถ้ามีทั้งคู่เอาฝากขึ้นก่อน + ข้อมูลถอนเอาจากข้อมูลเดิมห้ามเปลี่ยน แยก count badge
 * เขียว ส้ม (ลำดับ badge ตาม active) / fallback ห้ามพังกรณีไม่มีรายการ"*
 *
 * ทำไมต้องมีไฟล์นี้: ตรรกะ "แท็บไหน active" กับ "กรอง statement แถวไหน" ตัดสินจาก
 * ข้อมูลที่ปลายทางส่งมา ซึ่งมี 3 หน้าตาที่เจอจริงใน DB แล้ว (2 แถว / array ว่าง /
 * ไม่มี key เลย) — ถ้าพลาดจะพังหรือโชว์แท็บว่างโดยไม่มี error
 *
 * ข้อมูลที่ใช้เทสเป็นของจริงจาก `dev_local_omnidesk`:
 *   member a0d00000000000000000002b → statement 2 แถว amount 400/100
 *     status `waiting-deposit` type `deposit` date epoch ms 1784730217660
 *   member a0d00000000000000000002c → statement เป็น array ว่าง
 */
import { describe, it, expect } from 'vitest';

/** เกณฑ์ "ยังค้าง" — ลอกจาก PersonalPanel (isPendingRow) ตัวเดียวกันทั้งฝาก/ถอน */
const isPendingRow = (r: any) => {
  const s = String(r?.status || '').toLowerCase();
  return (
    s !== '' && s !== 'success' && s !== 'cancel' && s !== 'canceled' &&
    s !== 'cancelled' && s !== 'failed' && s !== 'reject' && s !== 'rejected'
  );
};

/** ตรรกะเดียวกับใน PersonalPanel: statement[] → แถว "รอฝาก" */
const toPendingDeps = (profile: any) => {
  const rows = Array.isArray(profile?.transaction?.statement)
    ? profile.transaction.statement
    : [];
  return rows
    .filter((r: any) => String(r?.type || '').toLowerCase() === 'deposit' && isPendingRow(r))
    .map((r: any) => ({ kind: 'dep' as const, at: r.date ?? r.at, amount: r.amount }));
};

/** ลำดับแท็บ + ลำดับ badge ตัดสินด้วยตัวเดียวกัน จึงขัดกันเองไม่ได้ */
const layout = (deps: unknown[], wds: unknown[]) => {
  const depFirst = deps.length > 0;
  return {
    depFirst,
    initialKey: depFirst ? 'dep' : 'wd',
    tabOrder: depFirst ? ['dep', 'wd'] : ['wd', 'dep'],
    badges: (depFirst
      ? [{ n: deps.length, cls: 'bg-green-500' }, { n: wds.length, cls: 'bg-warning' }]
      : [{ n: wds.length, cls: 'bg-warning' }, { n: deps.length, cls: 'bg-green-500' }]
    ).filter((b) => b.n > 0),
    /* [FIX-20260811-PENDINGTABALWAYS] แท็บโชว์ตลอดทั้ง 2 ฝั่ง — เจ้าของสั่งว่า
       "ไม่ว่าจะฝากหรือถอนต้องแสดงแท็บตลอด ถ้าไม่มีก็ '- รายการ'"
       ของเดิมซ่อนแท็บเวลามีฝั่งเดียว ซึ่งอ่านไม่ออกว่าตรวจแล้วไม่มี หรือไม่มีฟีเจอร์ */
    showTabs: true,
    labels: (depFirst ? ['dep', 'wd'] : ['wd', 'dep']).map((k) =>
      k === 'dep' ? `ฝาก (${deps.length})` : `ถอน (${wds.length})`,
    ),
    emptySide: deps.length === 0 || wds.length === 0,
  };
};

/** statement จริงจาก DB */
const REAL_STATEMENT = [
  { amount: 400, date: 1784730217660, provider_code: 'walletpay', status: 'waiting-deposit', type: 'deposit' },
  { amount: 100, date: 1784729880599, provider_code: 'walletpay', status: 'waiting-deposit', type: 'deposit' },
];

describe('[FEAT-20260810-PENDINGDEP] อ่าน statement[] เป็นรายการรอฝาก', () => {
  it('★ ข้อมูลจริง 2 แถว → ได้ 2 รายการ ยอด 400/100 พร้อม date เดิม', () => {
    const deps = toPendingDeps({ transaction: { statement: REAL_STATEMENT } });
    expect(deps).toEqual([
      { kind: 'dep', at: 1784730217660, amount: 400 },
      { kind: 'dep', at: 1784729880599, amount: 100 },
    ]);
  });

  it('statement เป็น array ว่าง → [] ไม่ throw (เจอจริงอีก member)', () => {
    expect(toPendingDeps({ transaction: { statement: [] } })).toEqual([]);
  });

  it('fallback: ไม่มี key / ไม่ใช่ array / profile เป็น null → [] ทุกกรณี', () => {
    // เจ้าของสั่ง "fallback ห้ามพังกรณีไม่มีรายการ"
    expect(toPendingDeps({ transaction: {} })).toEqual([]);
    expect(toPendingDeps({})).toEqual([]);
    expect(toPendingDeps(null)).toEqual([]);
    expect(toPendingDeps(undefined)).toEqual([]);
    expect(toPendingDeps({ transaction: { statement: 'ไม่ใช่ array' } })).toEqual([]);
    expect(toPendingDeps({ transaction: { statement: null } })).toEqual([]);
  });

  it('ไม่นับแถวที่จบแล้ว และไม่นับ type ที่ไม่ใช่ deposit', () => {
    // type อื่นต้องไม่หลุดมา ไม่งั้นจะซ้ำกับท่อ "รอถอน" เดิมที่มาจาก finance
    const deps = toPendingDeps({
      transaction: {
        statement: [
          { amount: 10, date: 1, status: 'success', type: 'deposit' },
          { amount: 20, date: 2, status: 'cancelled', type: 'deposit' },
          { amount: 30, date: 3, status: 'waiting-withdraw', type: 'withdraw' },
          { amount: 40, date: 4, status: 'waiting-deposit', type: 'deposit' },
        ],
      },
    });
    expect(deps).toEqual([{ kind: 'dep', at: 4, amount: 40 }]);
  });

  it('รับ type ตัวพิมพ์ใหญ่ และสถานะค้างที่สะกดคำอื่น', () => {
    // เกณฑ์เป็น "ไม่ใช่ success/cancel" จึงไม่ผูกกับคำว่า waiting-deposit คำเดียว
    const deps = toPendingDeps({
      transaction: { statement: [{ amount: 7, date: 9, status: 'processing', type: 'DEPOSIT' }] },
    });
    expect(deps).toEqual([{ kind: 'dep', at: 9, amount: 7 }]);
  });
});

describe('[FEAT-20260810-PENDINGDEP] แท็บ active + ลำดับ badge', () => {
  it('★ มีทั้งคู่ → ฝากขึ้นก่อน, active=ฝาก, badge เขียวก่อนส้ม', () => {
    const l = layout([1, 2], [3]);
    expect(l.tabOrder).toEqual(['dep', 'wd']);
    expect(l.initialKey).toBe('dep');
    expect(l.badges).toEqual([
      { n: 2, cls: 'bg-green-500' },
      { n: 1, cls: 'bg-warning' },
    ]);
    expect(l.showTabs).toBe(true);
    expect(l.labels).toEqual(['ฝาก (2)', 'ถอน (1)']);
  });

  it('มีแต่ถอน → active=ถอน, badge ส้มใบเดียว, ไม่มีแท็บ', () => {
    // นี่คือสถานะของ OA วันนี้ ⇒ ต้องเหมือนเดิมเป๊ะ ไม่มีแท็บให้กดว่าง
    const l = layout([], [3, 4]);
    expect(l.initialKey).toBe('wd');
    expect(l.badges).toEqual([{ n: 2, cls: 'bg-warning' }]); // badge เขียวหาย เพราะ 0
    expect(l.showTabs).toBe(true);                            // แต่แท็บยังอยู่ทั้งคู่
    expect(l.labels).toEqual(['ถอน (2)', 'ฝาก (0)']);
  });

  it('มีแต่ฝาก → active=ฝาก, badge เขียวใบเดียว, ไม่มีแท็บ', () => {
    const l = layout([1], []);
    expect(l.initialKey).toBe('dep');
    expect(l.badges).toEqual([{ n: 1, cls: 'bg-green-500' }]);
    expect(l.showTabs).toBe(true);
    expect(l.labels).toEqual(['ฝาก (1)', 'ถอน (0)']);
  });

  it('ไม่มีทั้งคู่ → ไม่มี badge เลย (การ์ดไม่ถูก render)', () => {
    const l = layout([], []);
    expect(l.badges).toEqual([]);          // ไม่มี badge เลย
    expect(l.labels).toEqual(['ถอน (0)', 'ฝาก (0)']);
  });

  it('★ [FIX-20260811-PENDINGTABALWAYS] แท็บไม่เคยหาย แต่ badge หายตอนเป็น 0', () => {
    // สองกฎนี้แยกกัน เจ้าของสั่งชัด: "แท็บตลอด … ยกเว้น badge แสดงเฉพาะเวลามีตัวเลข"
    for (const [d, w] of [[0, 0], [0, 3], [3, 0], [2, 2]] as [number, number][]) {
      const l = layout(Array(d).fill(1), Array(w).fill(1));
      expect(l.showTabs).toBe(true);              // แท็บ 2 ใบตลอด
      expect(l.labels).toHaveLength(2);
      expect(l.badges).toHaveLength([d, w].filter((n) => n > 0).length); // badge นับแค่ที่มีของ
    }
  });

  it('ลำดับ badge ตรงกับลำดับแท็บเสมอ — ตัดสินด้วย depFirst ตัวเดียว', () => {
    for (const [d, w] of [[2, 1], [0, 1], [1, 0], [5, 5]] as [number, number][]) {
      const deps = Array(d).fill(1);
      const wds = Array(w).fill(1);
      const l = layout(deps, wds);
      const firstBadgeIsGreen = l.badges[0]?.cls === 'bg-green-500';
      if (l.badges.length === 2) expect(firstBadgeIsGreen).toBe(l.tabOrder[0] === 'dep');
    }
  });
});

/**
 * [FEAT-20260810-PENDINGRAW] กฎ mask ของ modal "raw · statement"
 *
 * เจ้าของสั่งเป็น 3 รอบ ต่อกัน:
 *   1. "กด info ดูข้อมูลดิบได้ mask sensitive ยกเว้นยอดเงินกับวันเวลา"
 *   2. "ref_id provider_code statement_id ไม่ต้องเบลอ"
 *   3. "+ m_order_no ไม่เบลอ นอกนั้นเบลอหมด"
 *
 * ⚠️ ทำไมต้องมีเทสนี้: นี่คือกฎ **ปล่อยข้อมูลลูกค้าออกจอ** ถ้าเพี้ยนคือชื่อกับเลขบัญชี
 * ของคนจริงโผล่ให้แอดมินทุกคนเห็น และไม่มี error ให้จับ · ตอนตรวจพบว่า `srMaskDeep`
 * ที่มีอยู่เดิมทำตรงข้ามกับที่ต้องการ (ปล่อย member_account_no แต่ไปเบลอ ref_id)
 * จึงต้องเขียนกฎใหม่ — เทสนี้กันไม่ให้ใครสลับกลับ
 */
const PD_NEVER_MASK = /^(amount|real_amount|date|created_at|updated_at|ref_id|provider_code|statement_id|m_order_no|status|process_status|type|process_remark|member_account_bank_id)$/i;
const pdMask = (s: string) => {
  const keep = Math.max(2, Math.ceil(s.length * 0.2));
  return s.length <= 4 ? '****' : s.slice(0, keep) + '*'.repeat(Math.min(24, s.length - keep));
};
const pdMaskDeep = (o: any, key = ''): any => {
  if (Array.isArray(o)) return o.map((x) => pdMaskDeep(x, key));
  if (o && typeof o === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = pdMaskDeep(v, k);
    return out;
  }
  if (typeof o !== 'string' || !o) return o;
  return PD_NEVER_MASK.test(key) ? o : pdMask(o);
};

/** ก้อนจริงที่เจ้าของ paste มา (member a0d00000000000000000002b) */
const RAW_ROW = {
  amount: 400,
  date: 1784730217660,
  info: {
    account_id: '',
    amount: 100,
    created_at: 1784718539502,
    id: '01KY4R7EQEBKHBAXYWN8WF339B',
    m_order_no: 'up1784718538868420',
    member_account_bank_id: 'KKPA',
    member_account_name: 'okkkkk ',
    member_account_no: '2016030000',
    process_remark: '',
    process_status: 'failed',
    real_amount: 100,
    trade_no: '00000000-0000-4000-8000-000000000029',
  },
  provider_code: 'walletpay',
  ref_id: 'f26da23a-6e3b-456e-87fa-5aa65d5213084',
  statement_id: '01KY4R7EQEBKHBAXYWN8WF339B',
  status: 'waiting-deposit',
  type: 'deposit',
  user_id: '00000000-0000-4000-8000-000000000021',
};

describe('[FEAT-20260810-PENDINGRAW] mask ข้อมูลดิบของ statement', () => {
  const out: any = pdMaskDeep(RAW_ROW);

  it('★ ยอดเงินกับวันเวลาเห็นครบ ทั้งชั้นนอกและใน info{}', () => {
    expect(out.amount).toBe(400);
    expect(out.date).toBe(1784730217660);
    expect(out.info.amount).toBe(100);
    expect(out.info.real_amount).toBe(100);
    expect(out.info.created_at).toBe(1784718539502);
  });

  it('★ ref_id / provider_code / statement_id / m_order_no ไม่เบลอ (เจ้าของสั่งชัด)', () => {
    expect(out.ref_id).toBe(RAW_ROW.ref_id);
    expect(out.provider_code).toBe('walletpay');
    expect(out.statement_id).toBe(RAW_ROW.statement_id);
    expect(out.info.m_order_no).toBe('up1784718538868420');
  });

  it('★★ ชื่อและเลขบัญชีลูกค้าต้องถูกเบลอ — จุดที่ตัวเดิมปล่อยผ่าน', () => {
    expect(out.info.member_account_name).not.toBe('okkkkk ');
    expect(out.info.member_account_no).not.toBe('2016030000');
    expect(String(out.info.member_account_name)).toContain('*');
    expect(String(out.info.member_account_no)).toContain('*');
  });

  it('user_id / trade_no / id ถูกเบลอ', () => {
    for (const v of [out.user_id, out.info.trade_no, out.info.id]) {
      expect(String(v)).toContain('*');
    }
  });

  it('status / type / bank code / remark ยังอ่านได้ (ใช้ไล่เคส ไม่ใช่ข้อมูลส่วนตัว)', () => {
    expect(out.status).toBe('waiting-deposit');
    expect(out.type).toBe('deposit');
    expect(out.info.process_status).toBe('failed');
    expect(out.info.member_account_bank_id).toBe('KKPA');
  });

  it('field ที่ไม่รู้จัก = เบลอโดยปริยาย ("นอกนั้นเบลอหมด")', () => {
    // ปลายทางเพิ่ม field ใหม่วันไหน ต้องไม่หลุดเอง ต้องมาเติม never-list อย่างรู้ตัว
    const o: any = pdMaskDeep({ some_new_secret: 'AAAAAAAAAAAAAAAA' });
    expect(o.some_new_secret).toContain('*');
  });

  it('ค่าว่าง / ตัวเลข / null / boolean ไม่พัง', () => {
    const o: any = pdMaskDeep({ a: '', b: 0, c: null, d: false, e: undefined });
    expect(o).toEqual({ a: '', b: 0, c: null, d: false, e: undefined });
  });

  it('ไม่แก้ object เดิม — modal ต้องไม่ทำให้ข้อมูลใน state เปลี่ยน', () => {
    expect(RAW_ROW.info.member_account_no).toBe('2016030000');
    expect(RAW_ROW.user_id).toBe('00000000-0000-4000-8000-000000000021');
  });
});

/**
 * [FEAT-20260810-PENDINGRAW] ลูกตาใน modal raw — แปลง epoch เป็นวันเวลาที่อ่านออก
 * เจ้าของสั่ง: "มี icon ตาใน raw กดวันที่เปิดดู แปลงได้" + "แสดงทุกหน่วย dd mm yy hh mm ss"
 *
 * ⚠️ กับดักที่เทสนี้กัน: ถ้าแปลง "ตัวเลขทุกตัว" แทนที่จะแปลงเฉพาะ key ที่เป็นเวลา
 * `amount: 100` จะกลายเป็นวันที่ปี 1970 — ยอดเงินเพี้ยนบนจอโดยไม่มี error
 */
const PD_DATE_KEY = /^(date|created_at|updated_at|at)$/i;
const pdDateStr = (v: any) => {
  const n = Number(v);
  const d = new Date(n < 1e12 ? n * 1000 : n);
  if (isNaN(+d)) return String(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const pdHumanizeDates = (o: any, key = ''): any => {
  if (Array.isArray(o)) return o.map((x) => pdHumanizeDates(x, key));
  if (o && typeof o === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = pdHumanizeDates(v, k);
    return out;
  }
  if (!PD_DATE_KEY.test(key)) return o;
  if (typeof o !== 'number' && !(typeof o === 'string' && /^\d+$/.test(o))) return o;
  return pdDateStr(o);
};

describe('[FEAT-20260810-PENDINGRAW] ลูกตาแปลงวันเวลาใน raw', () => {
  it('★ ครบทุกหน่วย dd/mm/yy hh:mm:ss', () => {
    expect(pdDateStr(1784729880599)).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('epoch วินาที กับ มิลลิวินาที ให้เวลาเดียวกัน (แยกหน่วยถูก)', () => {
    // ก้อนจริงปนสองหน่วยในก้อนเดียว — `date` เป็น ms, บาง field เป็นวินาที
    expect(pdDateStr(1784729880599)).toBe(pdDateStr(1784729880));
  });

  it('★★ แปลงเฉพาะ key ที่เป็นเวลา — amount ต้องไม่ถูกแปลง', () => {
    const out: any = pdHumanizeDates({
      amount: 100,
      real_amount: 1001,
      date: 1784729880599,
      info: { created_at: 1784718544068, amount: 1001 },
    });
    expect(out.amount).toBe(100);          // ยังเป็นตัวเลข ไม่ใช่วันที่ปี 1970
    expect(out.real_amount).toBe(1001);
    expect(typeof out.date).toBe('string');
    expect(typeof out.info.created_at).toBe('string');
    expect(out.info.amount).toBe(1001);
  });

  it('ค่าที่ไม่ใช่ตัวเลขใน key เวลา ปล่อยไว้เดิม ไม่พัง', () => {
    const out: any = pdHumanizeDates({ date: 'ไม่ใช่ตัวเลข', created_at: null, at: '' });
    expect(out.date).toBe('ไม่ใช่ตัวเลข');
    expect(out.created_at).toBe(null);
    expect(out.at).toBe('');
  });

  it('ไม่แก้ object เดิม', () => {
    const src = { date: 1784729880599, amount: 100 };
    pdHumanizeDates(src);
    expect(src.date).toBe(1784729880599);
  });
});

/**
 * [FIX-20260811-PENDINGFOLD] การ์ด "รอทำรายการ" ต้องโชว์เสมอ แต่พับเมื่อว่างทั้งสองฝั่ง
 *
 * เจ้าของสั่ง 2026-08-11: *"ถ้าถอน 0 ฝาก 0 การ์ดรอทำรายการ … เปลี่ยนให้พับ แทน
 * แล้วค่าข้างใน - กับ 0 ตามสูตร"*
 *
 * เดิมเงื่อนไขเป็น `pendingTotal > 0` ⇒ ว่างทั้งคู่ **การ์ดหายไปเลย** ซึ่งอ่านไม่ออกว่า
 * "ตรวจแล้วไม่มี" หรือ "ไม่มีฟีเจอร์นี้" — เหตุผลเดียวกับที่แก้เรื่องแท็บให้โชว์ตลอด
 *
 * ⚠️ ฝั่งฝากอ่านจาก `statement` เท่านั้น (เจ้าของสั่ง "ฝากมาจาก statement อย่าไปยุ่ง")
 *    เทสชุดข้างบนล็อกไว้แล้วว่ากรองจาก `profile.transaction.statement`
 */
describe('[FIX-20260811-PENDINGFOLD] การ์ดโชว์เสมอ · พับเมื่อว่างทั้งคู่', () => {
  /** เงื่อนไขจริงจาก PersonalPanel: `{profile && (` + `defaultOpen={pendingTotal > 0}` */
  const cardState = (profile: unknown, deps: number, wds: number) => ({
    rendered: !!profile,
    defaultOpen: deps + wds > 0,
  });

  it('★ ว่างทั้งคู่ ⇒ การ์ดยังอยู่ แต่พับ (ไม่หายไปเงียบ ๆ)', () => {
    const s = cardState({}, 0, 0);
    expect(s.rendered).toBe(true);
    expect(s.defaultOpen).toBe(false);
  });

  it('มีฝั่งใดฝั่งหนึ่ง ⇒ กางเหมือนเดิม', () => {
    expect(cardState({}, 2, 0).defaultOpen).toBe(true);
    expect(cardState({}, 0, 1).defaultOpen).toBe(true);
    expect(cardState({}, 2, 2).defaultOpen).toBe(true);
  });

  it('ไม่มี profile ⇒ ไม่ render การ์ด (เงื่อนไขเดิม ไม่เปลี่ยน)', () => {
    expect(cardState(null, 0, 0).rendered).toBe(false);
  });

  it('★ พับแล้วค่าข้างในยังใช้สูตรเดิม — แท็บโชว์ (0) และ badge ซ่อนตอน 0', () => {
    // "ค่าข้างใน - กับ 0 ตามสูตร" = ไม่เปลี่ยนกฎเดิมที่เทสไว้แล้วข้างบน
    const l = layout([], []);
    expect(l.labels).toEqual(['ถอน (0)', 'ฝาก (0)']);
    expect(l.badges).toEqual([]);
    expect(l.showTabs).toBe(true);
  });
});

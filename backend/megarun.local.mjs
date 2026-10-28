/* local-only mega-test driver: 3 full rounds × 3 scenarios × 3 lanes.
   Reads the OA's own channel secret to sign a synthetic LINE event, exactly as
   LINE would; never prints a secret or a token. */
import mongoose from 'mongoose';
import fs from 'node:fs';
import { createHash, createDecipheriv, createHmac } from 'node:crypto';

const KEY = createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
const dec = (t) => {
  if (typeof t !== 'string' || !t.startsWith('enc:')) return t ?? '';
  const [a,b,c] = t.slice(4).split('.');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(a,'base64url'));
  d.setAuthTag(Buffer.from(c,'base64url'));
  return Buffer.concat([d.update(Buffer.from(b,'base64url')), d.final()]).toString('utf8');
};
const TOKEN = fs.readFileSync('/tmp/mega.token','utf8').trim();
const BASE = 'http://console.omnidesk.test:8088';
const NGROK = process.env.MEGA_BASE;
const H = { 'Content-Type':'application/json', Origin: BASE, Cookie:`access_token=${TOKEN}` };
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const hooks = {};
for (const a of ['omnideskdevoa','demo-oa-three']) hooks[a] = await db.collection('hooks').findOne({ alias:a });

const setVendor = async (alias, v) => {
  await db.collection('hooks').updateOne({ alias },
    v === null ? { $unset:{ ai_vendor:'' } } : { $set:{ ai_vendor:v } });
};

async function webhook(alias, text) {
  const secret = dec(hooks[alias].channel_secret ?? hooks[alias].line_secret);
  const body = JSON.stringify({ destination:'Ux', events:[{ type:'message', mode:'active',
    timestamp:Date.now(), source:{ type:'user', userId:'Umega'+alias },
    webhookEventId:'MG'+Date.now(), deliveryContext:{ isRedelivery:false },
    replyToken:'MG-'+Date.now(), message:{ type:'text', id:String(Date.now()), text } }] });
  const sig = createHmac('sha256', secret).update(body).digest('base64');
  const r = await fetch(`${NGROK}/${alias}/webhook`, { method:'POST',
    headers:{ 'Content-Type':'application/json','x-line-signature':sig }, body });
  return r.status;
}
const post = async (path, body) => {
  const r = await fetch(BASE+path, { method:'POST', headers:H, body:JSON.stringify(body) });
  const j = await r.json().catch(()=>({}));
  return { status:r.status, data:j?.data ?? j };
};
const lastReply = () => {
  const m = [...fs.readFileSync('/tmp/omnidesk-api.log','utf8')
    .matchAll(/\[AI-REAL\] (\w+) request[\s\S]*?Reply with Final Text: (.*?) \{"req"/g)];
  const l = m.at(-1);
  return l ? { vendor:l[1], text:l[2].slice(0,60) } : { vendor:'?', text:'?' };
};
const lastAudit = async () => (await db.collection('hook_audit_logs')
  .find({ action:'translate' }).sort({ _id:-1 }).limit(1).toArray())[0]?.note ?? '?';

const MSG = { omnideskdevoa:'a0d000000000000000000001', demo-oa-three:'a0d000000000000000000002' };
const ROOM = { omnideskdevoa:'a0d000000000000000000003', demo-oa-three:'a0d000000000000000000004' };
const BUBBLE = { omnideskdevoa:['my','km','lo'], demo-oa-three:['en','km','zh-Hans'] };
const PREVIEW = ['en','my','km'];
const rows = [];

for (let round = 0; round < 3; round++) {
  for (const sc of [
    { n:'1 omnideskdevoa (ไม่แตะ)', alias:'omnideskdevoa', vendor:undefined },
    { n:'2 demo-oa-three gemini หลัก', alias:'demo-oa-three', vendor:null },
    { n:'3 demo-oa-three deepseek หลัก', alias:'demo-oa-three', vendor:'deepseek' },
  ]) {
    if (sc.vendor !== undefined) await setVendor(sc.alias, sc.vendor);
    const st = await webhook(sc.alias, 'สวัสดีครับ วันนี้เปิดกี่โมง');
    await sleep(9000);
    const rep = lastReply();
    const b = await post(`/api/chat/messages/${MSG[sc.alias]}/translate`, { to: BUBBLE[sc.alias][round] });
    const bAudit = await lastAudit();
    const p = await post(`/api/chat/${ROOM[sc.alias]}/translate-preview`,
      { text:'ขอบคุณที่ติดต่อเข้ามาครับ', to: PREVIEW[round] });
    const pAudit = await lastAudit();
    rows.push({ round:round+1, sc:sc.n, hook:st, replyVendor:rep.vendor, reply:rep.text,
      bubble:`${BUBBLE[sc.alias][round]} ${b.status} ${bAudit.split('·').pop().trim()}${b.data?.cached?' CACHED':''} from=${b.data?.from ?? '-'}`,
      preview:`${PREVIEW[round]} ${p.status} ${pAudit.split('·').pop().trim()} from=${p.data?.from ?? '-'}` });
    console.log(`R${round+1} · ${sc.n.padEnd(26)} webhook=${st} reply=${rep.vendor.padEnd(9)} | bubble ${rows.at(-1).bubble} | preview ${rows.at(-1).preview}`);
    await sleep(1500);
  }
}
await setVendor('demo-oa-three','deepseek');
fs.writeFileSync('/tmp/mega-rounds.json', JSON.stringify(rows,null,1));
console.log('\nreply texts:');
for (const r of rows) console.log(` R${r.round} ${r.sc.padEnd(26)} ${r.reply}`);
await mongoose.disconnect();

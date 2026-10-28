#!/usr/bin/env node
/**
 * Demo data for a fresh OmniDesk database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/omnidesk node demo/seed-demo.mjs          # insert
 *   MONGODB_URI=mongodb://127.0.0.1:27017/omnidesk node demo/seed-demo.mjs --reset  # wipe demo rows first
 *
 * What it creates (all fictional — a small retail store with a loyalty programme):
 *   2 groups · 2 messaging accounts (OAs) · 6 customers with a chat room each ·
 *   tickets in every state (waiting, in progress, closed) · customer tags ·
 *   dynamic tags · a quick-reply category with replies.
 *
 * Users, roles and menus are NOT created here: the API seeds them on boot
 * (ACL_SEED_ON_BOOT, INIT_* variables in backend/.env.example).
 *
 * Channel credentials are left empty on purpose. Add your own LINE channel secret and
 * access token from the console (Webhook → edit) — the API encrypts them with ENCRYPTION_KEY.
 * Every demo row carries `demo: true` so --reset removes exactly what this script added.
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI first (see backend/.env.example).');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const { Types } = mongoose;
const id = () => new Types.ObjectId();
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

await mongoose.connect(uri);
const db = mongoose.connection.db;
const C = (name) => db.collection(name);
const DEMO_COLLECTIONS = ['groups', 'hooks', 'members', 'chat_rooms', 'tickets', 'tags', 'dynamic_tags', 'quick_reply_categories', 'quick_replies'];

if (reset) {
  for (const name of DEMO_COLLECTIONS) {
    const { deletedCount } = await C(name).deleteMany({ demo: true });
    console.log(`reset ${name}: ${deletedCount}`);
  }
}
if (await C('hooks').countDocuments({ demo: true })) {
  console.log('Demo data already present — run with --reset to recreate it.');
  await mongoose.disconnect();
  process.exit(0);
}

// ── groups + accounts ────────────────────────────────────────────────────────
const groups = [
  { _id: id(), group_name: 'Northwind Store', description: 'Main storefront', status: true, demo: true },
  { _id: id(), group_name: 'Northwind Outlet', description: 'Clearance outlet', status: true, demo: true },
];
await C('groups').insertMany(groups);

const hooks = [
  { _id: id(), alias: 'northwind', line_oa_name: 'Northwind Store', display_name: 'Northwind Store', group: groups[0]._id },
  { _id: id(), alias: 'northwind-outlet', line_oa_name: 'Northwind Outlet', display_name: 'Northwind Outlet', group: groups[1]._id },
].map((h) => ({
  ...h,
  channel_type: 'line',
  status: 1,
  company_name: 'Northwind Retail',
  description: 'Demo account',
  oa_url: 'https://shop.example.com',
  channel_secret: '',
  access_token: '',
  default_answer_text: 'Thanks for your message — an agent will reply shortly.',
  created_at: minutesAgo(60 * 24 * 30),
  updated_at: minutesAgo(60),
  demo: true,
}));
await C('hooks').insertMany(hooks);

// ── customers + rooms ────────────────────────────────────────────────────────
const people = [
  ['Alex Morgan', 'Alex', 'gold', 2],
  ['Sam Rivera', 'Sam', 'silver', 1],
  ['Jordan Lee', 'Jordan', 'normal', 0],
  ['Taylor Kim', 'Taylor', 'gold', 2],
  ['Casey Chen', 'Casey', 'normal', 0],
  ['Riley Park', 'Riley', 'silver', 1],
];
const members = people.map(([full, nick, tier, level], i) => ({
  _id: id(),
  line_user_id: `Udemo${String(i + 1).padStart(28, '0')}`,
  display_name: nick,
  nickname: nick,
  full_name: full,
  phone_number: `080555${String(1000 + i).slice(-4)}`,
  picture_url: `https://i.pravatar.cc/150?img=${i + 10}`,
  tier: { code: tier, name: tier[0].toUpperCase() + tier.slice(1), level },
  raw_profile_data: {
    success: true,
    data: {
      profile: {
        full_name: full,
        tier: { code: tier, name: tier[0].toUpperCase() + tier.slice(1), level },
        wallet: { balances: [{ asset_code: 'credit', amount: 250 + i * 40 }, { asset_code: 'coin', amount: 120 + i * 15 }] },
        orders: [{ order_no: `NW-10${i}21`, status: i % 2 ? 'shipped' : 'processing', total: 590 + i * 75 }],
      },
    },
  },
  profile_data_updated_at: minutesAgo(30),
  created_at: minutesAgo(60 * 24 * (10 + i)),
  updated_at: minutesAgo(30),
  demo: true,
}));
await C('members').insertMany(members);

const rooms = members.map((m, i) => ({
  _id: id(),
  user_id: m._id,
  line_user_id: m.line_user_id,
  hook_id: hooks[i % 2]._id,
  channel_type: 'line',
  status: 'active',
  unread_count: i % 3,
  assist_status: i % 3 !== 2,
  last_message: { text: ['Where is my order?', 'Can I change my address?', 'How many points do I have?'][i % 3], sender_type: 'user', timestamp: minutesAgo(5 + i * 7) },
  created_at: m.created_at,
  updated_at: minutesAgo(5 + i * 7),
  demo: true,
}));
await C('chat_rooms').insertMany(rooms);

// ── tickets: waiting / in progress / closed ─────────────────────────────────
const states = [0, 0, 1, 1, 2, 2];
const needs = ['Order not delivered yet', 'Change delivery address', 'Points balance question', 'Refund request', 'Size exchange', 'Invoice copy'];
await C('tickets').insertMany(
  members.map((m, i) => ({
    _id: id(),
    line_oa_hook_id: rooms[i].hook_id,
    hook_id: rooms[i].hook_id,
    channel_type: 'line',
    line_user_id: m._id,
    chat_user_id: m._id,
    category: i % 2 ? 'payment' : 'other',
    need_detail: needs[i],
    chat_status: rooms[i].assist_status ? 'admin' : 'bot',
    job_status: states[i],
    assigned_at: states[i] >= 1 ? minutesAgo(40 - i) : null,
    resolved_at: states[i] === 2 ? minutesAgo(20 - i) : null,
    created_at: minutesAgo(90 - i * 5),
    updated_at: minutesAgo(10 + i),
    demo: true,
  })),
);

// ── tags, dynamic tags, quick replies ────────────────────────────────────────
await C('tags').insertMany(
  [['VIP', '#7c3aed'], ['New customer', '#16a34a'], ['Follow up', '#ea580c']].map(([label, color]) => ({
    _id: id(), label, key: label.toLowerCase().replace(/\s+/g, '_'), color, group_ids: groups.map((g) => g._id), use_count: 0, demo: true,
  })),
);
await C('dynamic_tags').insertMany(
  [['store_hours', 'Open daily 09:00–21:00'], ['return_policy', 'Returns accepted within 14 days with receipt'], ['support_line', 'Call 02-000-0000']].map(([tag, value]) => ({
    _id: id(), tag, value, detail: 'Demo value', status: true, group_ids: groups.map((g) => g._id), hook_ids: [], demo: true,
  })),
);
const cat = { _id: id(), name: 'General', order: 1, demo: true };
await C('quick_reply_categories').insertOne(cat);
await C('quick_replies').insertMany(
  ['Hello! How can I help you today?', 'Your order is on its way — tracking will follow by SMS.', 'Thank you, we have closed this request.'].map((text, order) => ({
    _id: id(), category_id: cat._id, text, order, demo: true,
  })),
);

for (const name of DEMO_COLLECTIONS) console.log(`${name}: ${await C(name).countDocuments({ demo: true })} demo rows`);
await mongoose.disconnect();

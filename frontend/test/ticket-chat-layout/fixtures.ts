/**
 * [REFACTOR-20261027-TCSPLIT] Ticket rows for test/ticketChatLayout.dom.test.tsx — split out of
 * that suite to keep it under 400 lines. Shapes follow the rows the page reads (see the suite's
 * header); factories, so every case starts from a fresh copy.
 */
export const row = (over: Record<string, unknown>): Record<string, any> => ({
  line_oa_hook_id: 'h1',
  job_status: 0,
  customer_tags: [],
  need_detail: '',
  updated_at: '2026-09-01T09:00:00Z',
  created_at: '2026-09-01T08:00:00Z',
  ...over,
});
export const ACTIVE = () => [
  row({
    _id: 'w1', line_user_id: 'Uw1', chat_room_id: 'r1', category: 'payment', need_detail: 'ถามยอดค้าง', direct_ticket: true,
    line_user_data: { _id: 'mem1', full_name: 'ลูกค้าเอ', display_name: 'Aa', phone_number: '0810000001', picture_url: 'https://img.test/a.png' },
    customer_tags: [{ _id: 't1', label: 'VIP', color: '#f00' }, { _id: 't2', label: 'ใหม่', color: '#0f0' }],
  }),
  row({ _id: 'w2', line_user_id: 'Uw2', chat_room_id: 'r2', line_user_data: { full_name: 'ลูกค้าบี' } }),
  row({
    _id: 'mine1', line_user_id: 'Um1', chat_room_id: 'r3', job_status: 1, assist_status: true, chat_status: 'admin',
    admin_user_id: 'admin1', admin_user_data: { _id: 'admin1', display_name: 'แอดมินหนึ่ง' }, assigned_at: '2026-09-01T08:30:00Z',
    line_user_data: { full_name: 'ลูกค้าซี' },
  }),
  row({
    _id: 'other1', line_user_id: 'Uo1', chat_room_id: 'r4', job_status: 1, assist_status: true, chat_status: 'admin',
    admin_user_id: 'admin2', admin_user_data: { _id: 'admin2', display_name: 'แอดมินสอง' }, line_user_data: { full_name: 'ลูกค้าดี' },
  }),
];
export const COMPLETED = () => [
  row({ _id: 'c1', line_user_id: 'Uc1', chat_room_id: 'rc1', job_status: 2, assist_status: false, resolved_at: '2026-08-31T10:00:00Z', line_user_data: { full_name: 'ลูกค้าอี', nickname: 'อีอี', phone_number: '0820000002', display_name: 'Ee' }, customer_tags: [{ _id: 't3', label: 'เก่า', color: '#00f' }, { _id: 't4', label: 'ด่วน', color: '#ff0' }] }),
  row({ _id: 'c2', line_user_id: 'Uc1', chat_room_id: 'rc1', job_status: 2, resolved_at: '2026-08-30T10:00:00Z', need_detail: 'ปิดแล้ว', line_user_data: { full_name: 'ลูกค้าอี' } }),
];

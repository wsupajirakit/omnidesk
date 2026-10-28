/**
 * [FEAT-20260905-CUSTPROV PART 7] `empty` — the card that stays on screen with
 * nothing in it.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (`empty` = "โปรโมชั่น → ไม่มีโปรโมชั่น")
 *
 * ## 🔴 WHY A TYPE FOR "NOTHING" INSTEAD OF OMITTING THE SECTION
 * [FIX-20260801-GAMESEMPTY]: the สินค้าที่ซื้อล่าสุด card used to VANISH when the
 * list came back empty, which moved every card below it — per customer. So the
 * producer emits an `empty` section rather than no section, and the card holds
 * its place. A renderer that returned `null` here would put that bug back on the
 * other side of the wire. การ์ดหายไป = การ์ดใบล่างเลื่อนทั้งแถบ
 *
 * ## THE MESSAGE IS THE PROVIDER'S
 * `section.text` is drawn verbatim — the producer sends "ยังไม่มีสินค้าที่ซื้อล่าสุด"
 * because it knows what is missing; the dashboard does not. A provider that
 * sends no text gets the markup with nothing in it, which is still a held place
 * and still not a crash. REJECTED: a hardcoded default message. It would be the
 * dashboard inventing copy about a vendor's data — the exact coupling this
 * design removes, and it would read as the provider's own words.
 *
 * The class string is the panel's existing empty state, used in five places
 * today (`RecentProductsCard.tsx:43`, `BonusCard.tsx:57, :72`,
 * `ProfilePanel.tsx:2453, :2465`).
 *
 * revert: delete this file and its `empty` entry in `./index.tsx`.
 */
import React from 'react';
import { xpText } from './values';
import type { SectionProps } from './types';

export const EmptySection: React.FC<SectionProps> = ({ section }) => (
  <div className="text-xs text-gray-400 italic py-4 text-center" data-testid={`empty-section-${section.id}`}>
    {xpText(section.text) ?? ''}
  </div>
);

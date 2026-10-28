/**
 * [REFACTOR-20260905-CUSTPROV] Draws the "สินค้าที่ซื้อล่าสุด" card — the scrollable
 * list of recently-played products (thumbnail or colour-block fallback, name,
 * last-played time, amount, provider · product-type chip).
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` (was the third of six cards rendered
 * inside `PersonalPanelNarrow`, guarded by `{promotion && (…)}` — yes,
 * `promotion`, not a "products" flag; see `[FIX-20260801-GAMESEMPTY]` in the
 * moved comment below for why). That guard stayed in the parent — see
 * `ProfilePanel.tsx`'s call site — because `dev-local §6.3` moves markup, not
 * the "when to render" decision. No class string, element order, or
 * condition changed; only the file this JSX lives in.
 *
 * STATE STAYS IN THE PARENT (`dev-local §6.4`): this card owns no
 * `useState`/`useEffect` — `promoProducts` is a plain derived array already
 * computed (and sorted) in `PersonalPanelNarrow` and threaded down as a
 * prop. Nothing here is coupled.
 *
 * ==== [FEAT-20260905-CUSTPROV] THE ROWS ARE NORMALISED BEFORE THEY GET HERE ==
 * This card held the widest vendor-name spread on the panel — thirteen
 * spellings for five values (`product`/`name`/`catalog_name`,
 * `provider`/`product_name`, `product_type`, `image`/`catalog_image_path`,
 * `played_at`/`at`/`date`/`updated_at`/`created_at`) — and the sort that put
 * them newest-first read five of them again. All of it now resolves once, on
 * the back end (`row-paths.ts` → `product`, sorted in `derive-fields.ts`), and this
 * card receives `ListItem`s: `label` = the name, `tags` = `[provider, type]`
 * unjoined, `secondary` = the same pair already uppercased and joined,
 * `image` = the raw path, `at` = the raw timestamp, `amount` = the amount spent.
 *
 * ⚠️ THE ONE THING THAT STAYED HERE IS THE `https://` PREFIX. Some upstream rows
 * omit the scheme (`cdn.x/y.png`) and the img falls back to a colour block when
 * it 404s — display logic, which belongs beside the `onError` handler that
 * completes it, not in a lookup table.
 *
 * ⚠️ ACCEPTED COST, stated rather than discovered later: the initials block
 * reads `tags[0]` as the provider, and `tags` is `[provider, type]` with the
 * falsy parts filtered OUT by the producer. A row with a `product_type` and NO
 * provider therefore hands `tags[0]` the TYPE, where this card used to fall
 * through to the product name. Neither upstream can produce that row (both always
 * send a provider), it changes two letters inside an image-load fallback, and
 * the alternative — splitting `secondary` back apart on ` · ` — breaks the day a
 * provider name contains the separator, which is worse and silent.
 * REJECTED: a `provider` field of its own on `ListItem`. That is a third
 * spelling of the same value on the wire to serve two letters.
 *
 * Props: `promoProducts` — the `products` section's items, already sorted
 * newest-first by the producer.
 *
 * revert: paste the `<PanelCard title="สินค้าที่ซื้อล่าสุด">…</PanelCard>` JSX
 * below back into `PersonalPanelNarrow` inside its existing
 * `{promotion && (…)}` guard, delete this file, and drop the
 * `<RecentProductsCard …/>` call site. To revert only the provider wiring,
 * restore the six `g.…` reads from `git show ce8fcaa:…/RecentProductsCard.tsx`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { Bot } from 'lucide-react';
import { PanelCard } from '../shared/PanelCard';
import { xpAmt, xpDT } from '../shared/formatters';
import { XP_PRODUCT_COLORS } from '../ProfilePanel';
import type { ListItem } from '../renderers/types';

export const RecentProductsCard: React.FC<{
  promoProducts: ListItem[];
}> = ({ promoProducts }) => {
  const { t } = useI18n();
  return (
      <PanelCard title={t('ticketui.panel.recent_products', 'สินค้าที่ซื้อล่าสุด')} icon={<Bot size={14} />} defaultOpen={false}>
        {/* [FIX-20260802-GAMEWRAP] ของจริงส่งมา 8 รายการ (mock ส่ง 3) พอชื่อสินค้าตัดบรรทัด
            การ์ดยิ่งสูงจนดันการ์ดใบล่างตกจอ → จำกัดความสูงแล้วให้เลื่อนในกล่องตัวเอง
            ⚠️ ใช้ max-h ไม่ใช่ h — รายการน้อยกล่องก็ยังหดตามปกติ ไม่มีที่ว่างค้าง
            revert: เอา div ครอบชั้นนอกออก เหลือ space-y-1 อันเดียวเหมือนเดิม */}
        <div className="max-h-72 overflow-y-auto custom-scrollbar pr-1">
        <div className="space-y-1">
          {promoProducts.length === 0 && (
            <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_recent_products', 'ยังไม่มีสินค้าที่ซื้อล่าสุด')}</div>
          )}
          {/* ==== [FIX-20260802-GAMEFIELDS] อ่านชื่อ field ให้ตรงกับ Shop-API ตัวจริง
               🔒 สาย AUTO — to_dev_auto / to_prod_auto

               เดิมอ่าน g.product / g.provider / g.played_at ซึ่งเป็นชื่อของ mock ล้วน ๆ
               ของจริงส่งมาคนละชื่อทั้งหมด → ทุกช่องเลยขึ้น "-" ทั้งใบ:
                 catalog_name        ชื่อสินค้า        (เดิมหาจาก product / name)
                 product_name            แบรนด์สินค้า        (เดิมหาจาก provider)
                 product_type            ประเภทสินค้า      (ของใหม่ SLOT / ELECTRONICS)
                 catalog_image_path  รูปสินค้า         (ของใหม่ เดิมไม่มีเลย)
                 created_at           เวลาที่เล่น    (epoch วินาที — xpDT แยกให้แล้ว)

               ⚠️ อ่าน "ชื่อของ mock ก่อนเสมอ" ด้วย ?? ตามแบบทั้งไฟล์ → จอเดิมของ demo
                  ยังเหมือนเดิมเป๊ะ ไม่ได้แตะเงื่อนไขการโชว์การ์ดหรือสิทธิ์ใด ๆ
               ⚠️ รูปมาจากโดเมนภายนอกและบางเส้นไม่มี https:// นำหน้า (เจอจริงในตัวอย่าง)
                  → เติมให้ + ถ้าโหลดไม่ขึ้นก็สลับกลับไปใช้บล็อกสีตัวอักษรแบบเดิม
                  ไม่ปล่อยให้เป็นรูปแตก
               revert: เอา 6 บรรทัดเดิมกลับมา (ดู marker เดียวกัน)
               [FEAT-20260905-CUSTPROV] the five chains above are now `row-paths.ts`
               entries on the back end; what is left here is the two lines that
               are DISPLAY (the scheme prefix, the initials source). */}
          {promoProducts.map((g, i: number) => {
            const [c1, c2] = XP_PRODUCT_COLORS[i % XP_PRODUCT_COLORS.length];
            const gName = g.label;
            /* The provider ALONE, for the two-letter block — see the header for
               why `tags[0]` and not a re-split of `secondary`. */
            const gProvider = g.tags?.[0];
            const rawImg = g.image;
            const gImg = rawImg && !/^https?:\/\//i.test(String(rawImg)) ? `https://${rawImg}` : rawImg;
            return (
              <div key={i} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded border border-transparent hover:border-gray-200 transition-colors">
                {gImg ? (
                  <img
                    src={String(gImg)}
                    alt={String(gName || '')}
                    loading="lazy"
                    className="w-8 h-8 rounded object-cover shrink-0 bg-gray-200"
                    onError={(e) => {
                      // รูปเสีย → ซ่อนรูป แล้วโชว์บล็อกสีที่ซ่อนอยู่ข้าง ๆ แทน
                      const img = e.currentTarget;
                      img.style.display = 'none';
                      const fb = img.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="w-8 h-8 rounded items-center justify-center text-white text-[10px] font-bold shrink-0"
                  style={{ background: c1, display: gImg ? 'none' : 'flex' }}
                >
                  {String(gProvider || gName || '?').slice(0, 2).toUpperCase()}
                </div>
                {/* [FIX-20260802-GAMEWRAP] ชื่อสินค้ายาวเกินกรอบ (เช่น "Target Hunt: Da Sheng…")
                    เดิม truncate ทิ้งท้ายจนอ่านไม่ออกว่าสินค้าอะไร → ให้ตัดขึ้นบรรทัดใหม่แทน
                    ⚠️ min-w-0 จำเป็น: ลูกของ flex มี min-width:auto เป็นค่าเริ่มต้น
                       ถ้าไม่ใส่ ข้อความยาวจะดันกรอบจนป้ายแบรนด์สินค้าหลุดขอบ */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 leading-snug break-words">{gName || '-'}</p>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    {/* ผู้ใช้สั่ง: "ซื้อล่าสุด" = updated_at (created_at คือครั้งแรกที่เจอสินค้านี้)
                        — which of the five timestamps that means is the
                        provider's answer now (`row-paths.ts` → `product.at`). */}
                    {t('ticketui.panel.last_played', 'ซื้อล่าสุด')} {xpDT(g.at)}
                    {g.amount ? ` · ${xpAmt(g.amount)}` : ''}
                  </p>
                </div>
                {/* ผู้ใช้สั่ง: แบรนด์สินค้า = product_name + product_type (เช่น "PG · SLOT")
                    ไม่มี product_type ก็โชว์แค่ค่าย — mock ที่ส่งแต่ provider จึงเหมือนเดิม
                    [FEAT-20260905-CUSTPROV] `secondary` IS that join, done once by
                    the producer with the same filter-uppercase-join rule. Keeping
                    a second copy here would be two rules for one badge. */}
                <span className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded shrink-0" style={{ background: c2 }}>
                  {g.secondary || '-'}
                </span>
              </div>
            );
          })}
        </div>
        </div>
      </PanelCard>
  );
};

/**
 * ==== [FEAT-20260803-SITERULESEX] START — ไฟล์ใหม่ทั้งไฟล์
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * "ตัวอย่าง json" ของ **กติกาเว็บ (site rules)** — โครงที่ระบบส่งให้ AI ตอนเปิดสวิตช์
 * "ส่ง Site Rules เข้า AI" โดยห่อไว้ในบล็อก [RAW_SITE_RULES_START] ... [RAW_SITE_RULES_END]
 *
 * โชว์เมื่อกดปุ่ม [ตัวอย่าง json] ข้างสวิตช์นั้นในฟอร์ม hook — เปิดเป็นหน้าเปล่า
 * ใช้กลไกเดียวกับ RAW_JSON_DATA_EXAMPLE (ของฝั่งข้อมูลลูกค้า) ไม่ได้ทำของใหม่ซ้อน
 *
 * ⚠️ คนละก้อนกับ RAW_JSON_DATA_EXAMPLE — อันนั้นคือข้อมูล "ลูกค้ารายคน"
 *    อันนี้คือกติกา "ระดับเว็บ" ที่ทุกคนเห็นเหมือนกัน
 *
 * ⚠️ คัดลอกโครงมาจาก src/config/siteRulesSample.json ของฝั่ง BE ซึ่งเป็นแหล่งเดียวกับที่
 *    ตารางแนะนำตัวแปรอ่าน — ให้ตัวอย่างที่แอดมินเห็นตรงกับของจริงเสมอ
 *    (ตัด _readme ออก เพราะเป็นโน้ตภายในไฟล์ ไม่ใช่ส่วนที่ AI ได้รับ)
 *
 * เป็น CONTENT ไม่ใช่ UI copy — เก็บ verbatim ไม่แปลไม่จัดรูปใหม่
 * เป็นบัญชี demo (web_code = demo-omnidesk) ห้ามเอาข้อมูลลูกค้าจริงมาใส่
 *
 * revert: ลบไฟล์นี้ + ปุ่ม [ตัวอย่าง json] ของ site rules + openSiteRulesExample()
 * ==== [FEAT-20260803-SITERULESEX] END
 */

export const SITE_RULES_DATA_EXAMPLE = `{
  "data": {
    "shop": {
      "cashback": {
        "cashback": {
          "agent_id": "00000000-0000-4000-8000-000000000022",
          "cashback_type": "spend_total",
          "created_at": 1741761772,
          "id": "00000000-0000-4000-8000-000000000023",
          "interval": 1,
          "is_cashback_open": true,
          "is_previous_process": false,
          "percent": 0,
          "percent_home_living": 10,
          "percent_online_activity": 10,
          "percent_electronics": 10,
          "percent_gift_card": 10,
          "percent_collectibles": 10,
          "percent_fashion": 10,
          "percent_outdoor_activity": 10,
          "start_at": 1779344800,
          "act_home_living": 99999,
          "act_online_activity": 99999,
          "act_electronics": 99999,
          "act_gift_card": 99999,
          "act_collectibles": 99999,
          "act_fashion": 99999,
          "act_outdoor_activity": 99999,
          "activity_volume": 99999,
          "updated_at": 1785681531
        }
      },
      "referral": {
        "referral": {
          "agent_id": "00000000-0000-4000-8000-000000000022",
          "created_at": 1741926404,
          "id": "00000000-0000-4000-8000-000000000024",
          "is_referral_open": true,
          "percent": 20,
          "percent_home_living": 20,
          "percent_online_activity": 20,
          "percent_electronics": 20,
          "percent_gift_card": 20,
          "percent_collectibles": 20,
          "percent_fashion": 20,
          "percent_outdoor_activity": 20,
          "act_home_living": 99999,
          "act_online_activity": 99999,
          "act_electronics": 99999,
          "act_gift_card": 99999,
          "act_collectibles": 99999,
          "act_fashion": 99999,
          "act_outdoor_activity": 99999,
          "activity_volume": 99999,
          "updated_at": 1785570470
        }
      },
      "wallet": {
        "wallet_setting": {
          "agent_id": "00000000-0000-4000-8000-000000000022",
          "clear_act": 10,
          "created_at": 1741515806,
          "deposit_amount_approve": 0,
          "deposit_amount_min": 100,
          "deposit_amount_mode": "ALL",
          "deposit_coin_rate": 10,
          "deposit_min_delay": 5,
          "deposit_sort": "[\\"gateway\\",\\"promptpay\\",\\"auto\\",\\"truemoney\\",\\"manual\\"]",
          "deposit_text": "",
          "deposit_activity_volume": 0,
          "id": "00000000000000000000000003",
          "is_open_credit_add": true,
          "is_open_deposit": true,
          "is_open_register_truemoney": true,
          "is_qr_open": true,
          "is_withdraw_all": false,
          "is_withdraw_bank_verify": false,
          "is_withdraw_new_user": false,
          "is_withdraw_open": true,
          "show_bank_member_deposit_mode": "ALL",
          "updated_at": 1785523043,
          "withdraw_amount_approve": 5000,
          "withdraw_amount_min": 50,
          "withdraw_limit_per_day": 10,
          "withdraw_max_per_bill": 10000,
          "withdraw_transfer_group_amount": 45000,
          "withdraw_transfer_group_open": false,
          "withdraw_truemoney_mode": "WITHDRAW_APPROVE"
        }
      },
      "products": {
        "deposit_coin_rate": 10,
        "products": [
          {
            "default_config": {
              "spend_amount": 10,
              "spend_asset": "coin",
              "layout_slot": 4,
              "limit_per_day": 300,
              "rate_config": [
                {
                  "amount": 0,
                  "color_theme": "#ffffff",
                  "image_path": "",
                  "index_channel": 1,
                  "length_channel": 0,
                  "name": "",
                  "rate": 0,
                  "rate_text_color": "#ffffff",
                  "reward_type": "credit",
                  "act_home_living": 0,
                  "act_online_activity": 0,
                  "act_electronics": 0,
                  "act_gift_card": 0,
                  "act_collectibles": 0,
                  "act_fashion": 0,
                  "act_outdoor_activity": 0
                },
                {
                  "amount": 0,
                  "color_theme": "#ffffff",
                  "image_path": "",
                  "index_channel": 2,
                  "length_channel": 0,
                  "name": "",
                  "rate": 10.5,
                  "rate_text_color": "#ffffff",
                  "reward_type": "credit",
                  "act_home_living": 0,
                  "act_online_activity": 0,
                  "act_electronics": 0,
                  "act_gift_card": 0,
                  "act_collectibles": 0,
                  "act_fashion": 0,
                  "act_outdoor_activity": 0
                },
                {
                  "amount": 0,
                  "color_theme": "#ffffff",
                  "image_path": "",
                  "index_channel": 3,
                  "length_channel": 0,
                  "name": "",
                  "rate": 0,
                  "rate_text_color": "#ffffff",
                  "reward_type": "credit",
                  "act_home_living": 0,
                  "act_online_activity": 0,
                  "act_electronics": 0,
                  "act_gift_card": 0,
                  "act_collectibles": 0,
                  "act_fashion": 0,
                  "act_outdoor_activity": 0
                },
                {
                  "amount": 0,
                  "color_theme": "#ffffff",
                  "image_path": "",
                  "index_channel": 4,
                  "length_channel": 0,
                  "name": "",
                  "rate": 0.001,
                  "rate_text_color": "#ffffff",
                  "reward_type": "credit",
                  "act_home_living": 0,
                  "act_online_activity": 0,
                  "act_electronics": 0,
                  "act_gift_card": 0,
                  "act_collectibles": 0,
                  "act_fashion": 0,
                  "act_outdoor_activity": 0
                }
              ],
              "theme_config": {
                "img_bg": "",
                "img_bg_reward": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "img_button": "",
                "img_button_auto": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "img_icon_point_round": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "img_point": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "img_quota": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "img_point_round": "https://cdn.example.com/cdn-cgi/image/f=auto/",
                "mark_bg_1": "#BF953F",
                "mark_bg_2": "#FCF6BA",
                "point_color": "#ffffff",
                "quota_color": "#ffffff",
                "reward_color": "",
                "round_color": "",
                "text_color": "",
                "point_round_border_1": "#BF953F",
                "point_round_border_2": "#FCF6BA",
                "point_round_border_3": "#B38728"
              }
            },
            "id": "POINT_ROUND",
            "img_path": "",
            "is_active": true,
            "name": "point round #2"
          },
          {
            "default_config": null,
            "id": "RAND_BOX",
            "img_path": "",
            "is_active": false,
            "name": "Random Box"
          },
          {
            "default_config": null,
            "id": "RAND_COLLECTIBLES",
            "img_path": "",
            "is_active": false,
            "name": "Random Collectibles"
          },
          {
            "default_config": null,
            "id": "RAND_REWARD",
            "img_path": "",
            "is_active": false,
            "name": "Random Reward"
          },
          {
            "default_config": null,
            "id": "RAND_COUPON",
            "img_path": "",
            "is_active": false,
            "name": "Random Coupon"
          },
          {
            "default_config": null,
            "id": "OMNI_POINT_ROUND",
            "img_path": "",
            "is_active": false,
            "name": "Lucky Point Round"
          }
        ]
      },
      "tier": null,
      "promotions": {
        "category": "",
        "page": {
          "from": 0,
          "size": 10,
          "total": 1
        },
        "promotions": [
          {
            "asset_code": "credit",
            "coupon_code": "",
            "created_at": 1754550848,
            "deposit_amount": 50,
            "desc": "เฉพาะหมวดแฟชั่น",
            "end_date": 1788109200000,
            "id": "00000000-0000-4000-8000-000000000025",
            "img_path": "https://cdn.example.com/cdn-cgi/image/f=auto/SETTING-1754550821.png",
            "is_cal_cashback": false,
            "is_view": true,
            "max_per_user": 10,
            "max_user": 100,
            "mtk_code": "",
            "name": "ซื้อครบ 500 รับ 50 แต้ม ",
            "promotion_clear": 10,
            "promotion_config_info": {
              "act_home_living": 99999,
              "act_online_activity": 99999,
              "act_electronics": 99999,
              "act_gift_card": 99999,
              "act_collectibles": 99999,
              "act_fashion": 1,
              "act_outdoor_activity": 99999,
              "withdraw_max_amount": 100,
              "withdraw_min_amount": 0,
              "withdraw_min_balance": 200
            },
            "promotion_info": {
              "amount_bonus": 50,
              "balance_amount": 0,
              "deposit_per_day": 0,
              "max_bonus": 0,
              "percent_bonus": 0
            },
            "promotion_mode": "fix-deposit",
            "promotion_type": "forever",
            "promotion_type_clear": "fix_value",
            "start_date": 1785430800000,
            "status": "open",
            "tier_accepts": [],
            "activity_volume_open_info": {
              "act_home_living_open": false,
              "act_online_activity_open": false,
              "act_electronics_open": false,
              "act_gift_card_open": false,
              "act_collectibles_open": false,
              "act_fashion_open": true,
              "act_outdoor_activity_open": false
            },
            "updated_at": 1785522958,
            "use_true_money": false,
            "withdraw_all_open": true,
            "withdraw_mode": "wait-approve"
          }
        ]
      }
    }
  },
  "success": true
}`;

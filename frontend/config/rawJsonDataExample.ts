/**
 * ==== [FEAT-20260801-RAWJSONEXAMPLE] START — ไฟล์ใหม่ทั้งไฟล์
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * "ตัวอย่าง json" ของข้อมูลดิบลูกค้า (โครงที่ระบบส่งให้ AI ตอนเปิดใช้งาน raw json)
 * โชว์เมื่อกดปุ่ม [ตัวอย่าง json] ข้างช่อง "เปิดใช้งานการวิเคราะห์ raw json"
 * ในฟอร์ม hook — เปิดเป็นหน้าเปล่า แสดง JSON แบบ pretty อย่างเดียว
 *
 * คนละอย่างกับ RAW_JSON_RULES_SAMPLE (นั่นคือ "ตัวอย่างกติกา" ที่แอดมินคัดลอกไปวาง)
 * อันนี้คือ "รูปร่างข้อมูล" ให้แอดมินดูว่ามี field อะไรบ้างตอนเขียนกติกา
 *
 * เป็น CONTENT ไม่ใช่ UI copy — เก็บ verbatim ไม่แปลไม่จัดรูปใหม่ · ไม่มีใครนำค่านี้
 * ไปส่ง API หรือเซฟลง DB เป็นข้อความให้ "อ่าน" อย่างเดียว
 *
 * revert: ลบไฟล์นี้ + ปุ่ม [ตัวอย่าง json] + openRawJsonExample() ใน HookFormModal.tsx
 * ==== [FEAT-20260801-RAWJSONEXAMPLE] END
 */

export const RAW_JSON_DATA_EXAMPLE = `{
  "data": {
    "profile": {
      "web_code": "demo-omnidesk",
      "line_user_id": "U2e9daca4b8ab5265a21e3ecda626a720",
      "status": "enable",
      "line_of_work": "",
      "phone": "0955550010",
      "tier": {
        "code": "normal",
        "name": "Normal",
        "level": 0
      },
      "registered_at": "2026-07-17T06:49:24.073507Z",
      "bank": {
        "code": "BBL",
        "account_no": "xxxxxx4725",
        "account_name": "judy"
      },
      "truewallet": "",
      "promotion": {
        "current_promotion_info": {
          "agent_id": "00000000-0000-4000-8000-000000000001",
          "asset_code": "credit",
          "created_at": 1754550848,
          "deleted_at": null,
          "deposit_amount": 50,
          "desc": "เฉพาะหมวดแฟชั่น",
          "end_date": 1788109200000,
          "id": "00000000-0000-4000-8000-000000000002",
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
        },
        "has_active_promotion": true,
        "outstanding": {
          "home_living": 0,
          "online_activity": 0,
          "electronics": 0,
          "gift_card": 0,
          "collectibles": 0,
          "fashion": 0,
          "outdoor_activity": 0,
          "total": 0
        },
        "recent_products": [],
        "activity_volume_done": {
          "home_living": 0,
          "online_activity": 0,
          "electronics": 0,
          "gift_card": 0,
          "collectibles": 0,
          "fashion": 0,
          "outdoor_activity": 0,
          "total": 0
        },
        "activity_volume_required": {
          "home_living": 9999900,
          "online_activity": 9999900,
          "electronics": 9999900,
          "gift_card": 9999900,
          "collectibles": 9999900,
          "fashion": 100,
          "outdoor_activity": 9999900,
          "total": 59999500
        }
      },
      "finance": {
        "balances": [
          {
            "amount": 0,
            "asset_code": "cash",
            "asset_description": "รับเงินจาก bank",
            "updated_at": 1785565468
          },
          {
            "amount": 572.41,
            "asset_code": "credit",
            "asset_description": "แปลงเงินจาก cash",
            "updated_at": 1785565469
          },
          {
            "amount": 110,
            "asset_code": "coin",
            "asset_description": "ได้รับจากกิจกรรม",
            "updated_at": 1785565469
          },
          {
            "amount": 0,
            "asset_code": "diamond",
            "asset_description": "ได้รับจากกิจกรรม หรือ รอบสะสมแต้ม",
            "updated_at": 1784270973
          }
        ],
        "is_auto_deposit": false,
        "is_auto_withdraw": true,
        "total_deposit": 23422,
        "total_withdraw": 0,
        "transactions": {
          "deposit": [
            {
              "amount": 50,
              "date": 1785565456421,
              "status": "success",
              "type": "deposit"
            },
            {
              "amount": 1000,
              "date": 1785524965356,
              "status": "success",
              "type": "deposit"
            },
            {
              "amount": 50,
              "date": 1785523072088,
              "status": "success",
              "type": "deposit"
            },
            {
              "amount": 100,
              "date": 1785521759286,
              "status": "success",
              "type": "deposit"
            },
            {
              "amount": 22222,
              "date": 1785521415338,
              "status": "success",
              "type": "deposit"
            }
          ],
          "withdraw": []
        }
      },
      "bonus": {
        "cashback_history": [
          {
            "amount": 0,
            "date": 1785528064999,
            "status": "pending"
          },
          {
            "amount": 0,
            "date": 1785268868867,
            "status": "cancel"
          },
          {
            "amount": 0,
            "date": 1785009848224,
            "status": "cancel"
          },
          {
            "amount": 0,
            "date": 1784750535223,
            "status": "cancel"
          },
          {
            "amount": 0,
            "date": 1784491364915,
            "status": "cancel"
          }
        ],
        "pending_cashback": 0,
        "pending_referral_bonus": 0,
        "referral_history": []
      },
      "activity": {
        "coin_received": [
          {
            "action": "ACTION_COIN_DEPOSIT",
            "amount": 5,
            "date": 1785565469738,
            "note": "ฝากเงิน 50.00 บาท(คำนวนจาก10/ 1 เหรียญ)"
          },
          {
            "action": "ACTION_COIN_DEPOSIT",
            "amount": 100,
            "date": 1785565240297,
            "note": "ฝากเงิน 1000.00 บาท(คำนวนจาก10/ 1 เหรียญ)"
          },
          {
            "action": "ACTION_COIN_DEPOSIT",
            "amount": 5,
            "date": 1785523081494,
            "note": "ฝากเงิน 50.00 บาท(คำนวนจาก10/ 1 เหรียญ)"
          }
        ],
        "coin_spent": [],
        "point_round_history": [],
        "point_round_tickets": null
      }
    }
  },
  "success": true
}`;

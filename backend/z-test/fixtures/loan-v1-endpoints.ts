/**
 * [FLOWTEST-20261014-LOANV1FIXTURE] loan_v1 upstream answers — REAL, masked, GENERATED.
 *
 * 🔴 DO NOT EDIT BY HAND. Regenerate:
 *   npx ts-node -r tsconfig-paths/register z-test/tmp/extract-loan-v1-responses.ts
 *
 * Source: `v2_db_07_sep_26.webhook_logs`, rows the custom-tool prefetch wrote when it fired the
 * loan API (demo host) for real — `action_type: customer_link_fetch_<key>`. Endpoint list
 * from `src/cli/custom-tool-seed/bundles/loan-v1.bundle.ts` (purpose data). Per endpoint: the newest
 * success row (all success rows proven to share ONE shape) and one row per distinct failure
 * shape. `source` carries the row counts the sample was chosen from.
 *
 * Masked by path (PII replaced, same type; device ids deleted; LINE ids replaced) — the
 * rule table is in the generator. Money, terms, dates, statuses and contract codes are
 * real, because they are what the tests measure.
 *
 * Guarded by `z-test/unit/loan-v1-fixture-guard.spec.ts`.
 */
/* eslint-disable */
export const LOAN_V1_ENDPOINTS = {
  "CUSTOMER_PROFILE": {
    "source": {
      "db": "v2_db_07_sep_26",
      "action_type": "customer_link_fetch_customer_profile",
      "rows": 38,
      "success": 14,
      "failure": 24
    },
    "success": {
      "http_status": 200,
      "created_at": "2026-09-06T17:49:48.144Z",
      "body": {
        "success": true,
        "status_code": 200,
        "message": "Customer profile retrieved successfully",
        "timestamp": "2026-09-07 00:49:47",
        "data": {
          "customer": {
            "customer_id": 20,
            "customer_number": "CUST-000001",
            "customer_name": "ทดสอบ ระบบ",
            "customer_tel": "0640000000"
          },
          "contract": {
            "contract_number": "CT0226-SRI001-0020-01",
            "contract_status": "Active",
            "contract_total_amount": 23460,
            "down_payment": 3225,
            "principal_amount": 9675
          },
          "product": {
            "device_model": "iPad Gen11 A16 WIFI 128 GB ชมพู",
            "is_locked": false,
            "device_type": "General",
            "warranty_expire_date": null
          },
          "installment": {
            "total_terms": 12,
            "current_term": 7,
            "installment_amount": 1955,
            "payment_status": "Pending",
            "due_date": "2026-09-05",
            "overdue_days": 2,
            "fine_amount": 0,
            "unlock_fee": 0,
            "total_due_amount": 1955,
            "remaining_balance": 21505,
            "last_payment_date": "2026-02-27 06:47:00",
            "last_payment_amount": 1955
          }
        }
      }
    },
    "failures": [
      {
        "http_status": 404,
        "created_at": "2026-09-06T17:50:01.515Z",
        "body": {
          "success": false,
          "status_code": 404,
          "message": "Customer not found",
          "timestamp": "2026-09-07 00:50:00",
          "errors": []
        }
      },
      {
        "http_status": 404,
        "created_at": "2026-09-06T17:50:01.470Z",
        "body": "<!DOCTYPE html>\n<html lang=\"en\" class=\"color-sidebar sidebarcolor5\">\n\n<head>\n\t<!-- Required meta tags -->\n\t<meta charset=\"utf-8\">\n\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n    <base href=\"https://partner.example.com/\" />\n\t<!--favicon-->\n\t<link rel=\"icon\" href=\"assets/images/favicon-32x32.png\" type=\"image/png\" />\n\t<!-- loader-->\n\t<link href=\"assets/css/pace.min.css\" rel=\"stylesheet\" />\n\t<script src=\"assets/js/pace.min.js\"></script>\n\t<!-- Bootstrap CSS -->\n\t<link href=\"assets/css/bootstrap.min.css\" rel=\"stylesheet\">\n\t<link href=\"assets/css/bootstrap-extended.css\" rel=\"stylesheet\">\n\t<link href=\"https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap\" rel=\"stylesheet\">\n\t<link href=\"assets/css/app.css\" rel=\"stylesheet\">\n\t<link href=\"assets/css/icons.css\" rel=\"stylesheet\">\n\t<title>404 Error | Fast Fone 365</title>\n</head>\n\n<body>\n\t<!-- wrapper -->\n\t<div class=\"wrapper\">\n\t\t<nav class=\"navbar navbar-expand-lg navbar-light bg-white rounded fixed-top rounded-0 shadow-sm\">\n\t\t\t<div class=\"container-fluid\">\n\t\t\t\t<a class=\"navbar-brand\" href=\"https://partner.example.com/\">\n\t\t\t\t\t<img src=\"assets/images/favicon-32x32.png?v=1001\" width=\"40\" alt=\"\" /> Fast Fone 365\n\t\t\t\t</a>\n\t\t\t\t<button class=\"navbar-toggler\" type=\"button\" data-bs-toggle=\"collapse\" data-bs-target=\"#navbarSupportedContent1\" aria-controls=\"navbarSupportedContent1\" aria-expanded=\"false\" aria-label=\"Toggle navigation\"> <span class=\"navbar-toggler-icon\"></span>\n\t\t\t\t</button>\n\t\t\t\t<div class=\"collapse navbar-collapse\" id=\"navbarSupportedContent1\">\n\t\t\t\t\t<ul class=\"navbar-nav ms-auto mb-2 mb-lg-0\">\n\t\t\t\t\t\t<li class=\"nav-item\"> <a class=\"nav-link active\" aria-current=\"page\" href=\"https://partner.example.com/\"><i class='bx bx-home-alt me-1'></i>Home</a>\n\t\t\t\t\t\t</li>\n\t\t\t\t\t</ul>\n\t\t\t\t</div>\n\t\t\t</div>\n\t\t</nav>\n\t\t<div class=\"error-404 d-flex align-items-center justify-content-center\">\n\t\t\t<div class=\"container\">\n\t\t\t\t<div class=\"card py-5\">\n\t\t\t\t\t<div class=\"row g-0\">\n\t\t\t\t\t\t<div class=\"col col-xl-5\">\n\t\t\t\t\t\t\t<div class=\"card-body p-4\">\n\t\t\t\t\t\t\t\t<h1 class=\"display-1\"><span class=\"text-primary\">4</span><span class=\"text-danger\">0</span><span class=\"text-success\">4</span></h1>\n\t\t\t\t\t\t\t\t<h2 class=\"font-weight-bold display-4\">Lost in Space</h2>\n\t\t\t\t\t\t\t\t<p>You have reached the edge of the universe.\n\t\t\t\t\t\t\t\t\t<br>The page you requested could not be found.\n\t\t\t\t\t\t\t\t\t<br>Dont'worry and return to the previous page.</p>\n\t\t\t\t\t\t\t\t<div class=\"mt-5\"> <a href=\"https://partner.example.com/\" class=\"btn btn-primary btn-lg px-md-5 radius-30\">Go Home</a>\n\t\t\t\t\t\t\t\t\t<a href=\"javascript:history.back();\" class=\"btn btn-outline-dark btn-lg ms-3 px-md-5 radius-30\">Back</a>\n\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t</div>\n\t\t\t\t\t\t<div class=\"col-xl-7\">\n\t\t\t\t\t\t\t<img src=\"assets/images/404.webp\" class=\"img-fluid\" alt=\"\">\n\t\t\t\t\t\t</div>\n\t\t\t\t\t</div>\n\t\t\t\t\t<!--end row-->\n\t\t\t\t</div>\n\t\t\t</div>\n\t\t</div>\n\t\t<div class=\"bg-white p-3 fixed-bottom border-top shadow\">\n\t\t\t<div class=\"d-flex align-items-center justify-content-between flex-wrap\">\n\t\t\t\t<ul class=\"list-inline mb-0\">\n\t\t\t\t\t<li class=\"list-inline-item\">Follow Us :</li>\n\t\t\t\t\t<li class=\"list-inline-item\"><a href=\"https://www.facebook.com/examplepartner/\"><i class='bx bxl-facebook me-1'></i>Facebook</a>\n\t\t\t\t\t</li>\n\t\t\t\t\t<li class=\"list-inline-item\"><a href=\"https://www.instagram.com/examplepartner/\"><i class='bx bxl-twitter me-1'></i>Twitter</a>\n\t\t\t\t\t</li>\n\t\t\t\t\t<li class=\"list-inline-item\"><a href=\"https://www.youtube.com/@Globex\"><i class='bx bxl-youtube me-1'></i>Youtube</a>\n\t\t\t\t\t</li>\n\t\t\t\t</ul>\n\t\t\t\t<p class=\"mb-0\">Copyright © 2024. All right reserved.</p>\n\t\t\t</div>\n\t\t</div>\n\t</div>\n\t<!-- end wrapper -->\n\t<!-- Bootstrap JS -->\n\t<script src=\"assets/js/bootstrap.bundle.min.js\"></script>\n</body>\n\n</html>"
      },
      {
        "http_status": 0,
        "created_at": "2026-09-06T17:49:03.080Z",
        "body": {
          "message": "timeout of 4000ms exceeded"
        }
      }
    ]
  },
  "INSTALLMENT_CURRENT": {
    "source": {
      "db": "v2_db_07_sep_26",
      "action_type": "customer_link_fetch_installment_current",
      "rows": 38,
      "success": 14,
      "failure": 24
    },
    "success": {
      "http_status": 200,
      "created_at": "2026-09-06T17:49:48.144Z",
      "body": {
        "status": true,
        "result": "success",
        "message": "Success",
        "total": 9,
        "this_time": "7 ก.ย. 2569, 00:49 น.",
        "data": {
          "member": {
            "id": "20",
            "code": "MEM-000001",
            "name": "ทดสอบ ระบบ",
            "nickname": "ทดสอบ",
            "identityNumber": "0000000000000",
            "tel": "0640000000",
            "profile": "https://example.invalid/profile.jpg",
            "lineUid": "U00000000000000000000000000000000",
            "nationality": "ไทย",
            "isVerify": "1"
          },
          "contract": {
            "id": 19,
            "code": "CT0226-SRI001-0020-01",
            "created": "2026-02-01 13:45:51",
            "approved": "2026-02-01 15:34:07",
            "status": "Active",
            "partner": "SRI001",
            "deposit": 3225,
            "finance": 23460,
            "balance_total": 21505,
            "balance_current": 11730
          },
          "product": {
            "id": 848,
            "code": "P0102435151581-SRI001",
            "brand": "Apple",
            "name": "iPad Gen11 A16 WIFI 128 GB ชมพู",
            "price": "12900.00",
            "color": "เทาสเปซเกรย์",
            "storage": "128GB",
            "type": "เครื่องมือ 1",
            "deposit": 3225,
            "finance": 9675,
            "finance_per_month": 807,
            "increase": 2.3,
            "increase_amount": 12578,
            "increase_per_month": 1048,
            "installment_per_month": 1955,
            "installment_number": 12,
            "installment_total": 23460,
            "processing_fee": 100,
            "total": 26685
          },
          "installment": {
            "id": 127,
            "number": "7/12",
            "amount": 11730,
            "status": "<button type=\"button\" class=\"btn btn-default\" style=\"font-size: 12px; background:red;padding:3px 10px;border:none;\"><i class=\"fa fa-clock-o\" aria-hidden=\"true\"></i> ยังไม่ถึงกำหนดชำระ</button>",
            "current_amount": 1955,
            "remain_amount": 9775,
            "mulct_amount": 0,
            "locked_amount": 0,
            "due_date": "5 ก.ย. 2569"
          }
        }
      }
    },
    "failures": [
      {
        "http_status": 200,
        "created_at": "2026-09-06T17:50:01.515Z",
        "body": {
          "status": false,
          "result": "error",
          "message": "ไม่พบข้อมูลสมาชิกในระบบ กรุณาลองใหม่ค่ะ!!",
          "data": []
        }
      }
    ]
  },
  "PAYMENT_HISTORY": {
    "source": {
      "db": "v2_db_07_sep_26",
      "action_type": "customer_link_fetch_payment_history",
      "rows": 38,
      "success": 14,
      "failure": 24
    },
    "success": {
      "http_status": 200,
      "created_at": "2026-09-06T17:49:48.144Z",
      "body": {
        "status": true,
        "result": "success",
        "message": "Success",
        "total": 1,
        "now": "7 ก.ย. 2569, 00:49 น.",
        "data": {
          "remaining": {
            "contract_id": 19,
            "contract_code": "CT0226-SRI001-0020-01",
            "amount": 23460,
            "paid": 1955,
            "balance": 21505,
            "increaseBalance": 11528,
            "processingBalance": 1100,
            "financeBalance": 8877,
            "discount": 0,
            "financeDiscount": 0,
            "increaseDiscount": 0,
            "mulct": 0
          },
          "history": [
            {
              "id": 29,
              "code": "TXRT0226-SRI001-0020-01-1",
              "title": "ชำระค่างวดจากสัญญาเลขที่ CT0226-SRI001-0020-01 ครั้งที่ 1",
              "amount": 1955,
              "installment": 1955,
              "mulct": 0,
              "unlocked": 0,
              "discount": 0,
              "total": 1955,
              "slip": "https://example.invalid/slip.jpg",
              "date": "27 ก.พ. 2569, 06:47 น.",
              "remark": "จบงวด มีค",
              "type": "ชำระปกติ",
              "status": true
            }
          ]
        }
      }
    },
    "failures": [
      {
        "http_status": 200,
        "created_at": "2026-09-06T17:50:01.515Z",
        "body": {
          "status": false,
          "result": "error",
          "message": "ไม่พบข้อมูลสมาชิกในระบบ กรุณาลองใหม่ค่ะ!!",
          "data": []
        }
      }
    ]
  },
  "CONTRACT_INFO": {
    "source": {
      "db": "v2_db_07_sep_26",
      "action_type": "customer_link_fetch_contract_info",
      "rows": 38,
      "success": 14,
      "failure": 24
    },
    "success": {
      "http_status": 200,
      "created_at": "2026-09-06T17:49:48.144Z",
      "body": {
        "status": true,
        "result": "success",
        "message": "Success",
        "total": 1,
        "data": {
          "member": {
            "id": "20",
            "code": "MEM-000001",
            "name": "ทดสอบ ระบบ",
            "nickname": "ทดสอบ",
            "identityNumber": "0000000000000",
            "tel": "0640000000",
            "profile": "https://example.invalid/profile.jpg",
            "lineUid": "U00000000000000000000000000000000",
            "nationality": "ไทย",
            "isVerify": "1"
          },
          "contract": {
            "id": 19,
            "code": "CT0226-SRI001-0020-01",
            "created": "2026-02-01 13:45:51",
            "approved": "2026-02-01 15:34:07",
            "status": "Active",
            "partner": "SRI001"
          },
          "product": {
            "id": 848,
            "code": "P0102435151581-SRI001",
            "brand": "Apple",
            "name": "iPad Gen11 A16 WIFI 128 GB ชมพู",
            "price": "12,900.00 บาท",
            "color": "เทาสเปซเกรย์",
            "storage": "128GB",
            "type": "เครื่องมือ 1",
            "deposit": "3,225.00 บาท",
            "finance": "23,460.00 บาท",
            "finance_per_month": 807,
            "increase": 2.3,
            "increase_amount": 12578,
            "increase_per_month": 1048,
            "installment_per_month": "1,955.00 บาท",
            "installment_number": "12 งวด",
            "installment_total": "23,460.00 บาท",
            "processing_fee": 100,
            "total": 26685,
            "img": "https://example.invalid/product.jpg"
          }
        }
      }
    },
    "failures": [
      {
        "http_status": 200,
        "created_at": "2026-09-06T17:50:01.515Z",
        "body": {
          "status": false,
          "result": "error",
          "message": "ไม่พบข้อมูลสมาชิกในระบบ กรุณาลองใหม่ค่ะ!! U00000000000000000000000000000000",
          "data": []
        }
      }
    ]
  },
  "ALL_INSTALLMENTS": {
    "source": {
      "db": "v2_db_07_sep_26",
      "action_type": "customer_link_fetch_all_installments",
      "rows": 38,
      "success": 14,
      "failure": 24
    },
    "success": {
      "http_status": 200,
      "created_at": "2026-09-06T17:49:48.144Z",
      "body": {
        "status": true,
        "result": "success",
        "message": "Success",
        "total": 12,
        "now": "7 ก.ย. 2569, 00:49 น.",
        "data": {
          "member": {
            "id": "20",
            "code": "MEM-000001",
            "name": "ทดสอบ ระบบ",
            "nickname": "ทดสอบ",
            "identityNumber": "0000000000000",
            "tel": "0640000000",
            "profile": "https://example.invalid/profile.jpg",
            "lineUid": "U00000000000000000000000000000000",
            "nationality": "ไทย",
            "isVerify": "1"
          },
          "contract": {
            "id": 19,
            "code": "CT0226-SRI001-0020-01",
            "created": "2026-02-01 13:45:51",
            "approved": "2026-02-01 15:34:07",
            "status": "Active",
            "partner": "SRI001",
            "deposit": 3225,
            "finance": 23460,
            "balance_total": 21505,
            "balance_current": 11730
          },
          "product": {
            "id": 848,
            "code": "P0102435151581-SRI001",
            "brand": "Apple",
            "name": "iPad Gen11 A16 WIFI 128 GB ชมพู",
            "price": "12900.00",
            "color": "เทาสเปซเกรย์",
            "storage": "128GB",
            "type": "เครื่องมือ 1",
            "deposit": 3225,
            "finance": 9675,
            "finance_per_month": 807,
            "increase": 2.3,
            "increase_amount": 12578,
            "increase_per_month": 1048,
            "installment_per_month": 1955,
            "installment_number": 12,
            "installment_total": 23460,
            "processing_fee": 100,
            "total": 26685
          },
          "installment": [
            {
              "no": 1,
              "id": 121,
              "code": "TXRT0226-SRI001-0020-01-1",
              "dueDate": "5 มี.ค. 2569",
              "amount": 1955,
              "paid": 1955,
              "balance": 0,
              "discount": 0,
              "mulct": 0,
              "status": "4"
            },
            {
              "no": 2,
              "id": 122,
              "code": "TXRT0226-SRI001-0020-01-2",
              "dueDate": "5 เม.ย. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 3,
              "id": 123,
              "code": "TXRT0226-SRI001-0020-01-3",
              "dueDate": "5 พ.ค. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 4,
              "id": 124,
              "code": "TXRT0226-SRI001-0020-01-4",
              "dueDate": "5 มิ.ย. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 5,
              "id": 125,
              "code": "TXRT0226-SRI001-0020-01-5",
              "dueDate": "5 ก.ค. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 6,
              "id": 126,
              "code": "TXRT0226-SRI001-0020-01-6",
              "dueDate": "5 ส.ค. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 7,
              "id": 127,
              "code": "TXRT0226-SRI001-0020-01-7",
              "dueDate": "5 ก.ย. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 8,
              "id": 128,
              "code": "TXRT0226-SRI001-0020-01-8",
              "dueDate": "5 ต.ค. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 9,
              "id": 129,
              "code": "TXRT0226-SRI001-0020-01-9",
              "dueDate": "5 พ.ย. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 10,
              "id": 130,
              "code": "TXRT0226-SRI001-0020-01-10",
              "dueDate": "5 ธ.ค. 2569",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 11,
              "id": 131,
              "code": "TXRT0226-SRI001-0020-01-11",
              "dueDate": "5 ม.ค. 2570",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            },
            {
              "no": 12,
              "id": 132,
              "code": "TXRT0226-SRI001-0020-01-12",
              "dueDate": "5 ก.พ. 2570",
              "amount": 1955,
              "paid": 0,
              "balance": 1955,
              "discount": 0,
              "mulct": 0,
              "status": "0"
            }
          ]
        }
      }
    },
    "failures": [
      {
        "http_status": 200,
        "created_at": "2026-09-06T17:50:01.515Z",
        "body": {
          "status": false,
          "result": "error",
          "message": "ไม่พบข้อมูลสมาชิกในระบบ กรุณาลองใหม่ค่ะ!!",
          "data": []
        }
      }
    ]
  }
} as const;

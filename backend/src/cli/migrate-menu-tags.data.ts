/**
 * migrate-menu-tags.data.ts — the five menu rows, captured from local on 01/09/2026.
 * ===========================================================================
 * Embedded so the migration is ONE command on the server: no export step, no
 * file to copy into the container, nothing to go stale between the two halves.
 *
 * ⚠️ CAPTURED BY `flex_tag`, NOT BY `flex_slug`. `sub-register` exists twice in
 * the source and one copy was soft-deleted on 31/08; a slug capture would have
 * dragged the dead one along and resurrected it in the target.
 *
 * ⚠️ FIELDS DELIBERATELY ABSENT, and why:
 *   · `_id`, `__v`            — the target mints its own
 *   · `hook_ids`, `group_ids` — the CLI fills these with every hook and group
 *                              enabled IN THE TARGET, which is a different set
 *   · `created_at`/`updated_at` — stamped at insert time
 *   · `created_by`/`updated_by` — these were user ids from the SOURCE database.
 *                              Those users do not exist in the target, so the
 *                              reference would dangle. Left off rather than
 *                              pointed at a stranger.
 *
 * 🔴 `source_roles` MUST BE `["site_rules"]` ON EVERY ROW HERE — [FIX-20260902-MENUSRCROLES]
 * Two rows (`menu_sub_00013`, `menu_sub_00014`) were captured carrying `[]` and
 * were corrected on 02/09. `[]` is not a harmless difference, it is the shape of
 * a defect that already reached a customer:
 *   `flex-messages.service.ts:990` FORCES a `menu` card to `MENU_SOURCE_ROLES`
 *   (`['site_rules']`) on every save, because the editor's variable guide offers
 *   `{{site_rules.*}}` for this card type and the central builder reads
 *   `source_roles` off the row to decide what it may resolve. With `[]` stored,
 *   the guide advertised those variables and the card then PRINTED THEM RAW at a
 *   customer — seen live 31/08 on `sub-register`.
 * Shipping `[]` to a target would write that shape straight back in, and the
 * migrator copies this field verbatim (it only withholds `_id`, `__v`,
 * `hook_ids`, `group_ids`). ⇒ ค่านี้ `[]` = ป้ายดิบหลุดถึงลูกค้า ห้ามปล่อยผ่าน
 *
 * To recapture after editing the menus locally, re-run the query in
 * `todo/task/01092026/be_todo116_01092026_flex-menutag-migrate.md` §3.2 and
 * replace the array below.
 * ⚠️ AFTER ANY RECAPTURE, CHECK `source_roles` AGAIN. A row read back from a
 *    database that predates the forcing rule will carry `[]`, and pasting it here
 *    silently undoes this fix. `z-test/unit/menu-tag-rows-source-roles.spec.ts`
 *    fails when any row drifts, so the recapture cannot pass unnoticed.
 */
export const MENU_TAG_ROWS: ReadonlyArray<Record<string, unknown>> = [
  {
    name: 'เมนูหลัก',
    content_json: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://images.example.com/demo/banner.png',
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'MEMBER SERVICE',
            weight: 'bold',
            size: 'xs',
            color: '#1D4ED8',
          },
          {
            type: 'separator',
            margin: 'md',
            color: '#E0F2FE',
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'lg',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#1D4ED8',
                height: 'md',
                action: {
                  type: 'postback',
                  label: '✨ สมัครสมาชิก',
                  data: 'menu:v1:open:sub-register',
                  displayText: 'สมัครสมาชิก',
                },
              },
              {
                type: 'button',
                style: 'primary',
                color: '#2563EB',
                height: 'md',
                action: {
                  type: 'postback',
                  label: '🛒 ทางเข้าร้านค้า',
                  data: 'menu:v1:open:sub-web-url',
                  displayText: 'ทางเข้าร้านค้า',
                },
              },
              {
                type: 'button',
                style: 'primary',
                color: '#3B82F6',
                height: 'md',
                action: {
                  type: 'postback',
                  label: '🎁 โปรโมชั่น',
                  data: 'menu:v1:open:flex:flex_m00026',
                  displayText: 'โปรโมชั่น',
                },
              },
              {
                type: 'button',
                style: 'primary',
                color: '#0284C7',
                height: 'md',
                action: {
                  type: 'postback',
                  label: '🔑 ลืมรหัสผ่าน',
                  data: 'menu:v1:open:sub-forget-password',
                  displayText: 'ลืมรหัสผ่าน',
                },
              },
              {
                type: 'button',
                style: 'primary',
                color: '#0EA5E9',
                height: 'md',
                action: {
                  type: 'postback',
                  label: '📥 แจ้งปัญหาฝากเงิน',
                  data: 'menu:v1:open:sub-slip-request',
                },
              },
              {
                type: 'button',
                style: 'primary',
                color: '#38BDF8',
                height: 'md',
                action: {
                  type: 'message',
                  label: '📤 แจ้งปัญหาถอนเงิน',
                  text: '{{paylink.contact_admin_via_withdraw}}',
                },
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'link',
            height: 'sm',
            color: '#1D4ED8',
            action: {
              type: 'message',
              label: '💬 ติดต่อแอดมิน',
              text: '{{paylink.contact_admin}}',
            },
          },
        ],
      },
      styles: {
        footer: {
          separator: true,
          separatorColor: '#E0F2FE',
        },
      },
    },
    flex_type: 'menu',
    flex_sub_type: 'main',
    flex_slug: 'main-menu',
    content_tags: [],
    source_role: null,
    source_roles: ['site_rules'],
    flex_tag: 'menu_main_00010',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    callback_detail: '',
    callback_tag: '',
  },
  {
    name: 'สมัครสมาชิก',
    content_json: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '24px',
        contents: [
          {
            type: 'image',
            url: 'https://images.example.com/demo/banner.png',
            size: 'full',
            aspectMode: 'cover',
            aspectRatio: '9:16',
            gravity: 'center',
            position: 'absolute',
            offsetTop: '0px',
            offsetBottom: '0px',
            offsetStart: '0px',
            offsetEnd: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            position: 'absolute',
            background: {
              type: 'linearGradient',
              angle: '180deg',
              startColor: '#00000066',
              endColor: '#000000AA',
            },
            width: '100%',
            height: '100%',
            offsetTop: '0px',
            offsetStart: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '🌻 สมัครสมาชิก',
                weight: 'bold',
                size: 'xl',
                color: '#ffffff',
              },
              {
                type: 'text',
                text: 'การสมัครสมาชิกไม่เสียค่าใช้จ่ายค่ะ',
                weight: 'bold',
                size: 'lg',
                color: '#00E676',
                margin: 'md',
                wrap: true,
              },
              {
                type: 'text',
                text: 'ลูกค้ากดสมัครที่ลิงค์ด้านล่างได้เลยนะคะ',
                weight: 'bold',
                size: 'lg',
                color: '#00E676',
                margin: 'md',
                wrap: true,
              },
            ],
            position: 'relative',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: 'สมัครสมาชิก',
                  uri: '{{hook_domain}}/register',
                },
                style: 'primary',
                color: '#00B900',
                margin: 'xxl',
                offsetBottom: 'md',
                height: 'md',
                scaling: true,
                adjustMode: 'shrink-to-fit',
              },
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'xl',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '📍',
                        flex: 0,
                        size: 'md',
                      },
                      {
                        type: 'text',
                        text: 'ฝากขั่นต่ำ {{site_rules.dep_min}} บาท \n ถอนขั้นต่ำ {{site_rules.wd_min}} บาท',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'lg',
                      },
                    ],
                    offsetBottom: 'xs',
                  },
                ],
                offsetTop: 'md',
              },
            ],
            position: 'relative',
            margin: 'xxl',
            offsetTop: 'none',
            paddingTop: 'xxl',
          },
        ],
      },
    },
    flex_type: 'menu',
    flex_sub_type: 'sub',
    flex_slug: 'sub-register',
    content_tags: [],
    source_role: null,
    source_roles: ['site_rules'],
    flex_tag: 'menu_sub_00011',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    callback_detail: '',
    callback_tag: '',
  },
  {
    name: 'แก้ไขรหัสผ่าน',
    content_json: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '0px',
        contents: [
          {
            type: 'image',
            url: 'https://images.example.com/demo/banner.png',
            size: 'full',
            aspectMode: 'cover',
            aspectRatio: '9:16',
            gravity: 'center',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            position: 'absolute',
            background: {
              type: 'linearGradient',
              angle: '180deg',
              startColor: '#00000066',
              endColor: '#00000099',
            },
            width: '100%',
            height: '100%',
            offsetTop: '0px',
            offsetStart: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            position: 'absolute',
            offsetTop: '18px',
            offsetStart: '0px',
            offsetEnd: '0px',
            paddingStart: '20px',
            paddingEnd: '20px',
            contents: [
              {
                type: 'text',
                text: '🔐 ลืมรหัสผ่าน',
                weight: 'bold',
                size: 'xl',
                color: '#ffffff',
              },
              {
                type: 'text',
                text: '🌈 ขั้นตอนการเปลี่ยนรหัสผ่าน 🌈',
                weight: 'bold',
                size: 'sm',
                color: '#00E676',
                margin: 'sm',
              },
              {
                type: 'separator',
                color: '#ffffff44',
                margin: 'md',
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            position: 'absolute',
            offsetTop: '32%',
            offsetBottom: '90px',
            offsetStart: '0px',
            offsetEnd: '0px',
            paddingStart: '20px',
            paddingEnd: '20px',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '☀️',
                        flex: 0,
                        size: 'md',
                      },
                      {
                        type: 'text',
                        text: 'กดเข้าสู่ระบบ แล้วกด "ลืมรหัสผ่าน"',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'md',
                        flex: 1,
                      },
                    ],
                  },
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '☀️',
                        flex: 0,
                        size: 'md',
                      },
                      {
                        type: 'text',
                        text: 'กรอกหมายเลขโทรศัพท์ กด "ส่งรหัส OTP"',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'md',
                        flex: 1,
                      },
                    ],
                  },
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '☀️',
                        flex: 0,
                        size: 'md',
                      },
                      {
                        type: 'text',
                        text: 'นำรหัส OTP ที่ได้รับมากรอก แล้วกดยืนยัน',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'md',
                        flex: 1,
                      },
                    ],
                  },
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '☀️',
                        flex: 0,
                        size: 'md',
                      },
                      {
                        type: 'text',
                        text: 'สร้างรหัสผ่านใหม่ได้เลยค่ะ 👏',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'md',
                        flex: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            position: 'absolute',
            offsetBottom: '20px',
            offsetStart: '20px',
            offsetEnd: '20px',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: 'ไปที่หน้าเว็บไซต์',
                  uri: '{{hook_domain}}/dashboard',
                },
                style: 'primary',
                color: '#00B900',
                height: 'sm',
              },
            ],
          },
        ],
      },
    },
    flex_type: 'menu',
    flex_sub_type: 'sub',
    flex_slug: 'sub-forget-password',
    content_tags: [],
    source_role: null,
    source_roles: ['site_rules'],
    flex_tag: 'menu_sub_00013',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    callback_detail: '',
    callback_tag: '',
  },
  {
    name: 'ทางเข้าร้านค้า',
    content_json: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '24px',
        contents: [
          {
            type: 'image',
            url: 'https://images.example.com/demo/banner.png',
            size: 'full',
            aspectMode: 'cover',
            aspectRatio: '9:16',
            gravity: 'center',
            position: 'absolute',
            offsetTop: '0px',
            offsetBottom: '0px',
            offsetStart: '0px',
            offsetEnd: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            position: 'absolute',
            background: {
              type: 'linearGradient',
              angle: '180deg',
              startColor: '#00000066',
              endColor: '#000000AA',
            },
            width: '100%',
            height: '100%',
            offsetTop: '0px',
            offsetStart: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '🛒 ทางเข้าร้านค้า',
                weight: 'bold',
                size: 'xxl',
                color: '#ffffff',
              },
              {
                type: 'text',
                text: '📍 ลูกค้าคัดลอกลิ้งค์ด้านล่าง 📍',
                weight: 'bold',
                size: 'md',
                color: '#00E676',
                margin: 'md',
                wrap: true,
              },
              {
                type: 'separator',
                color: '#ffffff44',
                margin: 'lg',
              },
            ],
            position: 'relative',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '☑',
                        flex: 0,
                        size: 'md',
                        color: '#00E676',
                      },
                      {
                        type: 'text',
                        text: 'แนะนำให้ลูกค้าก็อปปี้ลิ้งค์ไปเปิดใน Google Chrome หรือ safari เพื่อการใช้งานที่มีประสิทธิภาพสูงสุด และหลีกเลี่ยงการใช้งานผ่านทางไลน์ นะคะ',
                        wrap: true,
                        color: '#EFEFEF',
                        size: 'md',
                      },
                    ],
                  },
                ],
              },
              {
                type: 'button',
                action: {
                  type: 'clipboard',
                  label: 'คัดลอกลิงก์ทางเข้าร้านค้า',
                  clipboardText: '{{hook_domain}}',
                },
                style: 'primary',
                color: '#00B900',
                margin: 'xxl',
              },
            ],
            position: 'relative',
            margin: 'xxl',
          },
        ],
      },
    },
    flex_type: 'menu',
    flex_sub_type: 'sub',
    flex_slug: 'sub-web-url',
    content_tags: [],
    source_role: null,
    source_roles: ['site_rules'],
    flex_tag: 'menu_sub_00014',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    callback_detail: '',
    callback_tag: '',
  },
  {
    name: 'แจ้งฝาก',
    content_json: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '0px',
        contents: [
          {
            type: 'image',
            url: 'https://images.example.com/demo/banner.png',
            size: 'full',
            aspectMode: 'cover',
            aspectRatio: '9:8',
            gravity: 'center',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            position: 'absolute',
            background: {
              type: 'linearGradient',
              angle: '180deg',
              startColor: '#00000066',
              endColor: '#00000099',
            },
            width: '100%',
            height: '100%',
            offsetTop: '0px',
            offsetStart: '0px',
          },
          {
            type: 'box',
            layout: 'vertical',
            position: 'absolute',
            offsetTop: '18px',
            offsetStart: '0px',
            offsetEnd: '0px',
            paddingStart: '20px',
            paddingEnd: '20px',
            contents: [
              {
                type: 'text',
                text: 'น้องน้องลั๊คกี้รบกวนขอสลิปด้วยนะคะ',
                weight: 'bold',
                size: 'lg',
                color: '#ffffff',
                wrap: true,
              },
              {
                type: 'separator',
                color: '#ffffff44',
                margin: 'md',
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            position: 'absolute',
            offsetTop: '32%',
            offsetBottom: '90px',
            offsetStart: '0px',
            offsetEnd: '0px',
            paddingStart: '20px',
            paddingEnd: '20px',
            contents: [],
          },
        ],
      },
    },
    flex_type: 'menu',
    flex_sub_type: 'sub',
    flex_slug: 'sub-slip-request',
    content_tags: [],
    source_role: null,
    source_roles: ['site_rules'],
    flex_tag: 'menu_sub_00019',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    callback_detail: '',
    callback_tag: '',
  },
];

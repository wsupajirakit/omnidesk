/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] `payment_flex_ids` must survive a save ====
 *
 * WHY THIS TEST EXISTS: `hooks.service.ts` copies an update through an explicit
 * FIELD LIST. A field missing from that list is not rejected — it is **dropped
 * silently**, so an admin picks cards, saves, and the selection simply is not
 * there. The list carries two comments warning about exactly this
 * (`doc_retrieval`, `flex_customerhelper_id`), which means it has already bitten
 * twice. A comment cannot fail a build; this test can.
 *
 * The same applies to cloning: `FIELD_TAB` decides which fields a clone carries,
 * so an omission there leaves a cloned OA on its old replies while the source
 * looks configured.
 *
 * These assertions read the real modules — no mocks — so they break the moment
 * someone reorganises either list without carrying the field along.
 * ไม่อยู่ใน list = ตั้งค่าแล้วหายเงียบ ๆ ⇒ ต้องมีเทสจับ ไม่ใช่แค่ comment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIELD_TAB } from '@/modules/hooks/hook-field-tabs';

describe('[FEAT-20260810-PAYSTATEFLEX] payment_flex_ids persistence wiring', () => {
  it('is in the hook update field list, or every selection is dropped on save', () => {
    // Read as source: the list is a private module-level const, and asserting on
    // the text is what keeps this honest — importing a copy would not prove the
    // service uses it.
    const src = readFileSync(
      join(__dirname, '../../src/modules/hooks/hooks.service.ts'),
      'utf8',
    );

    // The neighbouring flex ids are the anchor: if they are still listed and ours
    // is not, the omission is ours and not a wholesale refactor of the list.
    expect(src).toContain("'flex_out_of_time'");
    expect(src).toContain("'payment_flex_ids'");
  });

  it('is cloneable, and grouped with the slip cards rather than the payment tool', () => {
    // 'slip' not 'external_api': these are card bindings, the same nature as
    // flex_success. The External API tab carries the payment TOOL binding, whose
    // documented money risk is a different concern.
    expect(FIELD_TAB['payment_flex_ids']).toBe('slip');
    expect(FIELD_TAB['flex_success']).toBe('slip');
  });

  it('is not accidentally marked as a credential', () => {
    // Card ids are not secrets; if this ever moves to SENSITIVE_FIELD it must be
    // a deliberate decision, not a side effect of a bulk edit.
    const src = readFileSync(
      join(__dirname, '../../src/modules/hooks/hook-field-tabs.ts'),
      'utf8',
    );
    /* [FIX-20260910-DOCLABELS] BOUNDED to the map, not "to the end of the file".
       The old slice ran from `SENSITIVE_FIELD` to EOF, so it also swallowed
       `NEVER_CLONE` and `FIELD_LABEL_KEY` — and the day `payment_flex_ids` got a
       clone LABEL, this case reported it as a credential. The claim was never
       about the rest of the file; it is about one object. */
    const from = src.indexOf(
      'export const SENSITIVE_FIELD: Readonly<Record<string, string>> = {',
    );
    // jest's `expect` takes no message argument (vitest's does) — the name says it
    expect({ sensitiveFieldMapFound: from > -1 }).toEqual({
      sensitiveFieldMapFound: true,
    });
    const sensitiveBlock = src.slice(from, src.indexOf('\n};', from));
    expect(sensitiveBlock).not.toContain('payment_flex_ids');
  });
});

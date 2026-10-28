/**
 * [FEAT-20260808-PAYTOOL-P4] Before/after guard for the payment-tool BINDING
 * write path: the PUT whitelist and the clone-tab registry.
 *
 * Two silent-failure modes are pinned here, both of which returned success to
 * the operator while persisting nothing:
 *  (a) `HooksService.ALLOWED_UPDATES` is the ONLY filter `updateHook` applies.
 *      `payment_tool_status` / `payment_tool_id` were absent, so a PUT carrying
 *      them dropped both keys and still answered 200 — no error, no log entry.
 *  (b) `FIELD_TAB` is the only source of "which fields a clone copies".
 *      The payment pair was absent, so cloning the External API tab carried the
 *      `custom_tool_*` binding but silently left the payment binding behind.
 *
 * FAKES ONLY — no DB, no network, no keys. (a) is asserted against the static
 * whitelist plus a re-implementation of updateHook's filter loop, so the test
 * fails if the list regresses without needing a live Mongo. (b) is asserted
 * against the pure `fieldsForTabs`.
 *
 * revert: delete this file together with the [FEAT-20260808-PAYTOOL-P4] edits.
 */
import {
  CLONEABLE_TABS,
  FIELD_TAB,
  HookSchema,
  HooksService,
  NEVER_CLONE,
  SENSITIVE_FIELD,
  fieldsForTabs,
  labelKeyOf,
} from '@/modules/hooks';

/**
 * `ALLOWED_UPDATES` is `private static readonly`. Reading it through a cast is
 * deliberate: the alternative is booting the whole HooksService with its eight
 * injected collaborators just to observe a constant. เข้าถึงตรง ๆ เพื่อไม่ต้อง
 * ยก DI ทั้งชุดมาเพื่ออ่านค่าคงที่ตัวเดียว.
 */
const ALLOWED: readonly string[] = (
  HooksService as unknown as { ALLOWED_UPDATES: readonly string[] }
).ALLOWED_UPDATES;

/**
 * The exact filter `updateHook` runs over the request body (hooks.service.ts —
 * "for (const key of Object.keys(body)) if (ALLOWED_UPDATES.includes(key))").
 * Mirrored here so the assertion is about observable behaviour ("does this key
 * survive a save") rather than about array membership alone.
 */
function applyUpdateWhitelist(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED.includes(key)) updates[key] = body[key];
  }
  return updates;
}

/** A stand-in ObjectId string; never inserted anywhere. */
const TOOL_ID = 'a0d000000000000000000014';

describe('[PAYTOOL-P4a] PUT whitelist — the payment binding survives a save', () => {
  it('ALLOWED_UPDATES carries both payment fields (absent before ⇒ silent drop)', () => {
    expect(ALLOWED).toContain('payment_tool_status');
    expect(ALLOWED).toContain('payment_tool_id');
  });

  it('they sit next to their custom_tool siblings (ordering convention)', () => {
    // The list header forbids reordering legacy entries, so the new pair is
    // appended directly after the pair it mirrors rather than inserted midway.
    const i = ALLOWED.indexOf('custom_tool_status');
    expect(ALLOWED[i + 1]).toBe('custom_tool_id');
    expect(ALLOWED[i + 2]).toBe('payment_tool_status');
    expect(ALLOWED[i + 3]).toBe('payment_tool_id');
  });

  it('a PUT body carrying the pair keeps both keys after filtering', () => {
    const updates = applyUpdateWhitelist({
      payment_tool_status: true,
      payment_tool_id: TOOL_ID,
    });
    expect(updates).toEqual({
      payment_tool_status: true,
      payment_tool_id: TOOL_ID,
    });
  });

  it('turning the kill switch OFF also survives (false is not treated as absent)', () => {
    // Guards the failure that matters most on a money feature: an operator who
    // cannot switch it back off. ปิดสวิตช์ต้องบันทึกได้เสมอ.
    const updates = applyUpdateWhitelist({
      payment_tool_status: false,
      payment_tool_id: null,
    });
    expect(
      Object.prototype.hasOwnProperty.call(updates, 'payment_tool_status'),
    ).toBe(true);
    expect(updates['payment_tool_status']).toBe(false);
    expect(updates['payment_tool_id']).toBeNull();
  });

  it('BEFORE-STATE: a list without the pair drops it silently and still "succeeds"', () => {
    // Reproduces the old whitelist to show the bug this change fixes: the
    // filter throws nothing, so the caller would have answered 200 with an
    // empty update. No log, no error — exactly what the operator reported.
    const legacyList = ALLOWED.filter((f) => !f.startsWith('payment_tool_'));
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys({
      payment_tool_status: true,
      payment_tool_id: TOOL_ID,
    })) {
      if (legacyList.includes(key)) updates[key] = 'x';
    }
    expect(updates).toEqual({});
  });

  it('unknown keys are still dropped — the whitelist did not become permissive', () => {
    expect(applyUpdateWhitelist({ payment_tool_secret: 'nope' })).toEqual({});
  });

  it('the schema still defaults the pair OFF, so the save is the only way ON', () => {
    // Reading defaults off the schema needs no connection.
    const statusPath = HookSchema.path('payment_tool_status') as unknown as {
      defaultValue: unknown;
      instance: string;
    };
    const idPath = HookSchema.path('payment_tool_id') as unknown as {
      defaultValue: unknown;
      instance: string;
    };
    expect(statusPath.instance).toBe('Boolean');
    // ⚠️ ObjectId, not Mixed — a Mixed path casts nothing and every
    // find({ payment_tool_id }) would match zero documents.
    expect(idPath.instance).toBe('ObjectId');
    expect(statusPath.defaultValue).toBe(false);
    expect(idPath.defaultValue).toBeNull();
  });
});

describe('[PAYTOOL-P4a] clone registry — the payment binding travels with its sibling', () => {
  it('both fields are registered on the same tab as custom_tool_*', () => {
    expect(FIELD_TAB['custom_tool_status']).toBe('external_api');
    expect(FIELD_TAB['payment_tool_status']).toBe('external_api');
    expect(FIELD_TAB['payment_tool_id']).toBe('external_api');
  });

  it('the pair moves TOGETHER — never one field without the other', () => {
    // This is the reason the pair lives in FIELD_TAB rather than the per-field
    // opt-in SENSITIVE_FIELD: a half-tick would write status:true with id:null,
    // an OA whose kill switch reads ON while the runner finds no tool.
    expect(FIELD_TAB['payment_tool_status']).toBe(FIELD_TAB['payment_tool_id']);
    const fields = fieldsForTabs(['external_api']);
    expect(fields).toContain('payment_tool_status');
    expect(fields).toContain('payment_tool_id');
  });

  it('cloning the External API tab now carries the payment binding', () => {
    const fields = fieldsForTabs(['external_api']);
    // Follows the custom_tool precedent exactly: copied by default, no tick.
    expect(fields).toContain('custom_tool_status');
    expect(fields).toContain('payment_tool_status');
  });

  it('other tabs do NOT carry it — a money switch is not copied by an AI clone', () => {
    for (const tab of ['ai', 'slip', 'notifications']) {
      const fields = fieldsForTabs([tab]);
      expect(fields).not.toContain('payment_tool_status');
      expect(fields).not.toContain('payment_tool_id');
    }
  });

  it('the binding is not a secret and not un-cloneable (mirrors custom_tool)', () => {
    // A pointer to a global tool definition is not an OA credential, so it is
    // absent from SENSITIVE_FIELD; and it is a setting, not identity, so it is
    // absent from NEVER_CLONE. Both statements hold for custom_tool_* too.
    expect(SENSITIVE_FIELD['payment_tool_status']).toBeUndefined();
    expect(SENSITIVE_FIELD['payment_tool_id']).toBeUndefined();
    expect(NEVER_CLONE.has('payment_tool_status')).toBe(false);
    expect(NEVER_CLONE.has('payment_tool_id')).toBe(false);
  });

  it('the clone modal gets a real label key, not the untranslated fallback', () => {
    expect(labelKeyOf('payment_tool_status')).toBe(
      'hook_clone.field_payment_tool_status',
    );
    expect(labelKeyOf('payment_tool_id')).toBe(
      'hook_clone.field_payment_tool_id',
    );
    // The fallback the pair would otherwise have hit.
    expect(labelKeyOf('some_other_field')).toBe('hook_form.some_other_field');
  });

  it('the P4a work added no tab; the four legacy tabs keep their positions', () => {
    /* Written as "the tab list is unchanged" when P4a landed. The notice tab
     * (owner-ordered, 22/08 — [FEAT-20260822-NOTICEMODE]) is APPENDED after
     * the four legacy tabs, so what this case still pins is what it always
     * meant: P4a itself added nothing, and the legacy positions are frozen. */
    expect(CLONEABLE_TABS.map((t) => t.key)).toEqual([
      'ai',
      'slip',
      'notifications',
      'external_api',
      'notice',
    ]);
  });

  it('BEFORE-STATE: without the registry entries a clone left the binding behind', () => {
    // Every consumer reads FIELD_TAB, so an unregistered field is skipped with
    // no error — the target OA keeps its old payment binding while the operator
    // is told the clone succeeded.
    const before = Object.entries(FIELD_TAB)
      .filter(
        ([f, tab]) => tab === 'external_api' && !f.startsWith('payment_tool_'),
      )
      .map(([f]) => f);
    expect(before).not.toContain('payment_tool_status');
    expect(before).toContain('custom_tool_status');
  });
});

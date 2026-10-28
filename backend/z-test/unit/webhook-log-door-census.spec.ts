/**
 * ==== [FEAT-20260827-WLOGONEDOOR] the door stays the only door ====
 *
 * WHAT THIS GUARDS: `webhook_logs` had TWELVE writers. Eleven of them wrote
 * `webhookLogModel.create({...})` straight to Mongoose, so anything added at the
 * service layer — an S3 mirror, a metric, a redaction pass — would have missed
 * them silently. They now all go through `WebhookLogWriter.persist`.
 *
 * WHY A SOURCE CENSUS RATHER THAN A BEHAVIOUR TEST: the failure being guarded is
 * someone ADDING a new writer, months from now, in a file that does not exist
 * yet. No behavioural test can fail for code nobody has written; a census can.
 * It reads the tree the same way the refactor did — `grep`, not reasoning.
 *
 * WHEN THIS GOES RED: a new `webhook_logs` write appeared outside the door.
 * The fix is to inject `WebhookLogWriter` and call `persist`, NOT to widen the
 * allow-list here. ห้ามแก้เทสให้ผ่าน ให้ย้ายไปใช้ประตู
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * A grep hit that is only a COMMENT is not a call site. Every migrated service
 * carries a note saying what it used to inject, and those notes would otherwise
 * fail the very census that motivated them. คอมเมนต์ไม่ใช่โค้ดที่รัน
 */
function isComment(line: string): boolean {
  const code = line.replace(/^[^:]+:\d+:/, '').trim();
  return code.startsWith('*') || code.startsWith('//') || code.startsWith('/*');
}

/** grep the source tree; returns matching NON-comment lines. */
function grepSrc(pattern: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      ['-rn', '--include=*.ts', '-E', pattern, 'src'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return out
      .split('\n')
      .filter(Boolean)
      .filter((l) => !isComment(l));
  } catch {
    // grep exits 1 when nothing matched — that is a pass, not an error.
    return [];
  }
}

describe('[FEAT-20260827-WLOGONEDOOR] webhook_logs has exactly one write door', () => {
  it('(D1) 🔴 nothing outside the writer calls `.create` on the webhook-log model', () => {
    const hits = grepSrc(
      'webhookLogModel[[:space:]]*$|webhookLogModel\\.',
    ).filter(
      (line) =>
        // the ONE legitimate holder: the broadcast history READER (find, never create)
        !line.startsWith(
          'src/modules/content/broadcast-run/history.service.ts',
        ) &&
        // a comment recording that a dead injection was removed
        !line.includes('[FIX-20260820-KILLDEADPUSH]'),
    );
    expect(hits).toEqual([]);
  });

  it('(D2) 🔴 the model is created in exactly one place in the whole tree', () => {
    const hits = grepSrc('logModel\\.create\\(').filter(
      (line) => !line.includes('revert:'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('src/modules/system/webhook-log.writer.ts');
  });

  it('(D3) the five migrated services no longer inject the WebhookLog model', () => {
    const migrated = [
      'src/modules/external/external-api.service.ts',
      'src/modules/external/custom-tool.service.ts',
      'src/modules/customer-link/customer-link.service.ts',
      'src/modules/content/broadcasts.service.ts',
      'src/modules/content/broadcast-run/new-send.service.ts',
    ];
    const injections = grepSrc('@InjectModel\\(WebhookLog').filter((line) =>
      migrated.some((f) => line.startsWith(f)),
    );
    expect(injections).toEqual([]);
  });

  it('(D4) every migrated site now calls the door', () => {
    const persists = grepSrc(
      '(this|deps)\\.wlog[[:space:]\\n]*\\.?[[:space:]]*$|\\.wlog\\.persist\\(|\\.persist\\(\\{',
    );
    // 11 migrated sites + the service's own createLog hand-off
    expect(persists.length).toBeGreaterThanOrEqual(11);
  });
});

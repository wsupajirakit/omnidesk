/**
 * [FEAT-20260822-AIPROMPTLOG] — diagnostic fingerprints for the AI reply path.
 *
 * Why these tests exist: on the night of 21→22 Aug an OA answered with a
 * stale Training Doc and it took hours of log archaeology to prove which
 * prompt version the hook held at reply time. These helpers put that answer
 * into the existing `generate_response` webhook_logs row (doc_sha/doc_len/
 * thai_time/answer_tags) and one stdout line (block sizes). They are LOG-ONLY:
 * every helper must be total — any input, including garbage, returns a value
 * and never throws, because a diagnostics failure must never touch a reply.
 */
import {
  buildDocFingerprint,
  describeBlocks,
  extractAnswerTags,
  sha8,
  thaiClock,
} from '../../src/modules/webhook/ai-reply/prompt-log.util';

describe('[FEAT-20260822-AIPROMPTLOG] prompt-log.util', () => {
  describe('sha8', () => {
    it('is 8 lowercase hex chars and stable for the same input', () => {
      const a = sha8('เอกสารทดสอบ');
      expect(a).toMatch(/^[0-9a-f]{8}$/);
      expect(sha8('เอกสารทดสอบ')).toBe(a);
    });

    it('changes when a single character changes', () => {
      expect(sha8('doc v1')).not.toBe(sha8('doc v2'));
    });

    it('treats null/undefined as empty string and never throws', () => {
      expect(sha8(null)).toBe(sha8(''));
      expect(sha8(undefined)).toBe(sha8(''));
    });
  });

  describe('buildDocFingerprint', () => {
    it('fingerprints both Training Doc boxes as sha/sha and len/len', () => {
      const out = buildDocFingerprint({
        suggestion_text: 'box one',
        suggestion_company_text: 'box two!',
      });
      expect(out.doc_sha).toBe(`${sha8('box one')}/${sha8('box two!')}`);
      expect(out.doc_len).toBe('7/8');
    });

    it('missing hook or missing fields degrade to empty-string hashes', () => {
      const empty = `${sha8('')}/${sha8('')}`;
      expect(buildDocFingerprint(null).doc_sha).toBe(empty);
      expect(buildDocFingerprint(undefined).doc_len).toBe('0/0');
      expect(buildDocFingerprint({}).doc_sha).toBe(empty);
    });

    it('non-string field values are stringified, not thrown on', () => {
      const out = buildDocFingerprint({
        suggestion_text: 12345,
        suggestion_company_text: null,
      });
      expect(out.doc_sha).toBe(`${sha8('12345')}/${sha8('')}`);
      expect(out.doc_len).toBe('5/0');
    });
  });

  describe('extractAnswerTags', () => {
    it('lists triple-bracket markers without the brackets', () => {
      expect(
        extractAnswerTags('ok [[[flex_m00031]]] แล้วก็ [[[assist]]]'),
      ).toEqual(['flex_m00031', 'assist']);
    });

    it('returns [] for plain text, null, and undefined', () => {
      expect(extractAnswerTags('สวัสดีค่ะ')).toEqual([]);
      expect(extractAnswerTags(null)).toEqual([]);
      expect(extractAnswerTags(undefined)).toEqual([]);
    });

    it('caps the list so one bad answer cannot bloat a log row', () => {
      const noisy = Array.from({ length: 9 }, (_, i) => `[[[t${i}]]]`).join(
        ' ',
      );
      expect(extractAnswerTags(noisy)).toHaveLength(5);
    });

    it('ignores two-bracket dynamic tags — only reply markers count', () => {
      expect(extractAnswerTags('ฝากขั้นต่ำ [[odk_s_00001]] บาท')).toEqual([]);
    });
  });

  describe('thaiClock', () => {
    it('extracts HH:mm from a formatThaiDateTime string', () => {
      expect(thaiClock('วันศุกร์ที่ 22 สิงหาคม 69 00:34:14')).toBe('00:34');
      expect(thaiClock('วันพฤหัสบดีที่ 21 สิงหาคม 69 23:59:59')).toBe('23:59');
    });

    it('passes through a string with no trailing clock, and survives null', () => {
      expect(thaiClock('no clock here')).toBe('no clock here');
      expect(thaiClock(null)).toBe('');
    });
  });

  describe('describeBlocks', () => {
    it('reports kind:length per block, comma-joined', () => {
      expect(
        describeBlocks([
          { kind: 'raw_json', text: 'x'.repeat(384) },
          { kind: 'site_rules', text: 'y'.repeat(150) },
        ]),
      ).toBe('raw_json:384,site_rules:150');
    });

    it('marks a truncated site_rules block with !TRUNC', () => {
      const clipped = '{"a":1}'.padEnd(50, ' ') + '{"_truncated": true}';
      expect(describeBlocks([{ kind: 'site_rules', text: clipped }])).toBe(
        `site_rules:${clipped.length}!TRUNC`,
      );
    });

    it('empty, null, and malformed blocks degrade to safe output', () => {
      expect(describeBlocks([])).toBe('');
      expect(describeBlocks(null)).toBe('');
      expect(describeBlocks([{}])).toBe('?:0');
    });
  });
});

import {
  CONTENT_TAG_MAX,
  CONTENT_TAG_PREFIX,
  buildContentTagGuidelines,
  buildContentTagMap,
  normalizeContentTags,
  parseContentMarkers,
  stripContentMarkers,
} from '@/modules/content';

describe('Flex Content Tags Utility (Commit 1474245 Parity)', () => {
  describe('Constants', () => {
    it('should export correct CONTENT_TAG_MAX and CONTENT_TAG_PREFIX', () => {
      expect(CONTENT_TAG_MAX).toBe(10);
      expect(CONTENT_TAG_PREFIX).toBe('custom_content_');
    });
  });

  describe('normalizeContentTags', () => {
    it('should handle absent/null/empty values as empty array (pre-feature behavior)', () => {
      expect(normalizeContentTags(undefined)).toEqual({ value: [] });
      expect(normalizeContentTags(null)).toEqual({ value: [] });
      expect(normalizeContentTags('')).toEqual({ value: [] });
      expect(normalizeContentTags('   ')).toEqual({ value: [] });
      expect(normalizeContentTags([])).toEqual({ value: [] });
    });

    it('should accept valid JSON string array or object', () => {
      const jsonArr = JSON.stringify([
        { no: 1, label: 'Intro', hint: 'Short' },
      ]);
      expect(normalizeContentTags(jsonArr)).toEqual({
        value: [{ no: 1, label: 'Intro', hint: 'Short' }],
      });

      const jsonObj = JSON.stringify({ '1': 'Greeting', '3': 'Footer' });
      expect(normalizeContentTags(jsonObj)).toEqual({
        value: [
          { no: 1, label: 'Greeting' },
          { no: 3, label: 'Footer' },
        ],
      });
    });

    it('should reject malformed JSON string', () => {
      const result = normalizeContentTags('{invalid json');
      expect(result).toEqual({
        error: 'content_tags ต้องเป็น JSON ที่อ่านได้ (array หรือ object)',
      });
    });

    it('should assign lowest free slot number when no number is specified', () => {
      const input = [{ label: 'First' }, { label: 'Second' }];
      expect(normalizeContentTags(input)).toEqual({
        value: [
          { no: 1, label: 'First' },
          { no: 2, label: 'Second' },
        ],
      });
    });

    it('should claim explicit numbers first before auto-assigning free slots', () => {
      const input = [{ label: 'Auto' }, { no: 1, label: 'Explicit' }];
      expect(normalizeContentTags(input)).toEqual({
        value: [
          { no: 1, label: 'Explicit' },
          { no: 2, label: 'Auto' },
        ],
      });
    });

    it('should sort output slots by slot number ascending', () => {
      const input = [
        { no: 3, label: 'Slot 3' },
        { no: 1, label: 'Slot 1' },
      ];
      expect(normalizeContentTags(input)).toEqual({
        value: [
          { no: 1, label: 'Slot 1' },
          { no: 3, label: 'Slot 3' },
        ],
      });
    });

    it('should reject duplicates in explicit slot numbers', () => {
      const input = [
        { no: 2, label: 'First' },
        { no: 2, label: 'Duplicate' },
      ];
      expect(normalizeContentTags(input)).toEqual({
        error: 'ช่องที่ 2: เลขช่อง 2 ซ้ำกับช่องก่อนหน้า',
      });
    });

    it('should reject slot numbers out of 1-10 range', () => {
      expect(normalizeContentTags([{ no: 0, label: 'Invalid' }])).toEqual({
        error: 'ช่องที่ 1: เลขช่องต้องเป็นจำนวนเต็ม 1-10 (ได้ "0")',
      });
      expect(normalizeContentTags([{ no: 11, label: 'Too high' }])).toEqual({
        error: 'ช่องที่ 1: เลขช่องต้องเป็นจำนวนเต็ม 1-10 (ได้ "11")',
      });
    });

    it('should reject when total tags exceed CONTENT_TAG_MAX (10)', () => {
      const input = Array.from({ length: 11 }, (_, i) => ({
        label: `Slot ${i + 1}`,
      }));
      expect(normalizeContentTags(input)).toEqual({
        error: 'content_tags ได้สูงสุด 10 ช่อง (ส่งมา 11)',
      });
    });

    it('should fallback empty label to default "ช่อง N"', () => {
      const input = [{ no: 2, label: '  ' }];
      expect(normalizeContentTags(input)).toEqual({
        value: [{ no: 2, label: 'ช่อง 2' }],
      });
    });

    it('should coerce non-primitives matching legacy String(x ?? "") behavior', () => {
      expect(normalizeContentTags([{ no: {} as unknown as number }])).toEqual({
        error:
          'ช่องที่ 1: เลขช่องต้องเป็นจำนวนเต็ม 1-10 (ได้ "[object Object]")',
      });
      expect(
        normalizeContentTags([{ no: [1, 2] as unknown as number }]),
      ).toEqual({
        error: 'ช่องที่ 1: เลขช่องต้องเป็นจำนวนเต็ม 1-10 (ได้ "1,2")',
      });
      expect(
        normalizeContentTags([{ label: { a: 1 } as unknown as string }]),
      ).toEqual({
        value: [{ no: 1, label: '[object Object]' }],
      });
      expect(
        normalizeContentTags([{ label: ['a', 'b'] as unknown as string }]),
      ).toEqual({
        value: [{ no: 1, label: 'a,b' }],
      });
      expect(
        normalizeContentTags([{ hint: { a: 1 } as unknown as string }]),
      ).toEqual({
        value: [{ no: 1, label: 'ช่อง 1', hint: '[object Object]' }],
      });
    });

    it('LOAD-BEARING: deleting slot 2 must leave slot 3 as slot 3 (numbers are stored, not derived from array index)', () => {
      const initial = normalizeContentTags(['Slot 1', 'Slot 2', 'Slot 3']);
      expect(initial.value).toEqual([
        { no: 1, label: 'Slot 1' },
        { no: 2, label: 'Slot 2' },
        { no: 3, label: 'Slot 3' },
      ]);

      const afterDelete = [
        { no: 1, label: 'Slot 1' },
        { no: 3, label: 'Slot 3' },
      ];
      const normalizedAfterDelete = normalizeContentTags(afterDelete);
      expect(normalizedAfterDelete.value).toEqual([
        { no: 1, label: 'Slot 1' },
        { no: 3, label: 'Slot 3' },
      ]);

      const afterAdd = [...afterDelete, { label: 'New Slot' }];
      const normalizedAfterAdd = normalizeContentTags(afterAdd);
      expect(normalizedAfterAdd.value).toEqual([
        { no: 1, label: 'Slot 1' },
        { no: 2, label: 'New Slot' },
        { no: 3, label: 'Slot 3' },
      ]);
      expect(normalizedAfterAdd.value?.[2]?.no).toBe(3);
    });
  });

  describe('parseContentMarkers', () => {
    it('should parse markers [[[custom_content_N]]] correctly', () => {
      const text = '[[[custom_content_1]]] Hello [[[custom_content_3]]] World';
      const parsed = parseContentMarkers(text);
      expect(parsed.get(1)).toBe('Hello');
      expect(parsed.get(3)).toBe('World');
      expect(parsed.has(2)).toBe(false);
    });

    it('should match case-insensitively with "i" flag (e.g. [[[CUSTOM_CONTENT_1]]])', () => {
      const text = '[[[CUSTOM_CONTENT_1]]] Upper Text';
      const parsed = parseContentMarkers(text);
      expect(parsed.get(1)).toBe('Upper Text');
    });

    it('should join text when the same slot is marked twice', () => {
      const text =
        '[[[custom_content_1]]] Line 1 [[[custom_content_1]]] Line 2';
      const parsed = parseContentMarkers(text);
      expect(parsed.get(1)).toBe('Line 1\nLine 2');
    });

    it('should return empty map when text is empty or has no markers', () => {
      expect(parseContentMarkers('').size).toBe(0);
      expect(parseContentMarkers('Ordinary reply text').size).toBe(0);
    });
  });

  describe('stripContentMarkers', () => {
    it('should return string untouched when no markers exist (FIX-20260805-STRIPNOOP)', () => {
      const plain = '  Hello   World  ';
      expect(stripContentMarkers(plain)).toBe('  Hello   World  ');
    });

    it('should strip [[[custom_content_N]]] markers case-insensitively and clean extra spaces', () => {
      const marked =
        '[[[CUSTOM_CONTENT_1]]] Hello   [[[CUSTOM_CONTENT_2]]] World';
      expect(stripContentMarkers(marked)).toBe('Hello World');
    });

    it('should NOT carry stateful "g" flag on .test() RegExp so consecutive calls succeed', () => {
      const str = '[[[custom_content_1]]] Hello';
      const first = stripContentMarkers(str);
      const second = stripContentMarkers(str);
      expect(first).toBe('Hello');
      expect(second).toBe('Hello');
    });
  });

  describe('buildContentTagMap', () => {
    it('should yield empty map and declared set when card declares no slots (content_tags = [])', () => {
      const { map, declared } = buildContentTagMap([], 'Some text');
      expect(map).toEqual({});
      expect(declared.size).toBe(0);
    });

    it('should drop slots with non-1..10 integer numbers (e.g. 0, 11, 2.5)', () => {
      const tags = [
        { no: 0, label: 'Zero' },
        { no: 11, label: 'Eleven' },
        { no: 2.5, label: 'Float' },
        { no: 1, label: 'Valid' },
      ];
      const { map, declared } = buildContentTagMap(tags, 'Model output text');
      expect(declared.has('custom_content_1')).toBe(true);
      expect(declared.has('custom_content_0')).toBe(false);
      expect(declared.has('custom_content_11')).toBe(false);
      expect(declared.has('custom_content_2')).toBe(false);
      expect(map['custom_content_1']).toBe('Model output text');
    });

    it('should assign full model text to lowest-numbered slot if model emitted no markers', () => {
      const tags = [
        { no: 3, label: 'Slot 3' },
        { no: 1, label: 'Slot 1' },
      ];
      const { map, declared } = buildContentTagMap(tags, 'Full AI Answer');
      expect(declared.has('custom_content_1')).toBe(true);
      expect(declared.has('custom_content_3')).toBe(true);
      expect(map['custom_content_1']).toBe('Full AI Answer');
      expect(map['custom_content_3']).toBe('');
    });

    it('should map model answer to declared slots correctly', () => {
      const tags = [
        { no: 1, label: 'Greeting' },
        { no: 2, label: 'Body' },
      ];
      const aiText =
        '[[[custom_content_1]]] Hi! [[[custom_content_2]]] Main text';
      const { map } = buildContentTagMap(tags, aiText);
      expect(map['custom_content_1']).toBe('Hi!');
      expect(map['custom_content_2']).toBe('Main text');
    });
  });

  describe('buildContentTagGuidelines', () => {
    it('should build guidelines table rows for declared slots and sort them by slot number', () => {
      const tags = [
        { no: 3, label: 'Footer' },
        { no: 1, label: 'Greeting', hint: 'Short' },
      ];
      const guidelines = buildContentTagGuidelines(tags);
      expect(guidelines).toHaveLength(2);
      expect(guidelines[0]).toEqual({
        tag: '{{custom_content_1}}',
        desc: 'Greeting — Short',
        source: 'content_tags[no=1]',
        example: 'AI ใส่ผ่าน [[[custom_content_1]]]',
        noPrefix: true,
      });
      expect(guidelines[1]).toEqual({
        tag: '{{custom_content_3}}',
        desc: 'Footer (ช่องเนื้อหาของการ์ดนี้)',
        source: 'content_tags[no=3]',
        example: 'AI ใส่ผ่าน [[[custom_content_3]]]',
        noPrefix: true,
      });
    });
  });
});

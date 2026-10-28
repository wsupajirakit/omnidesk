/**
 * ==== [FIX-20260810-PAYLINKWARN] the leftover-tag warning must ignore `paylink` ====
 *
 * `resolveStateFlex` measures `leftover` with the SLIP-tag pass, which runs before
 * `mintPayLinks`. So at measuring time every `{{paylink.*}}` is still a literal
 * string, and the warning named a tag the customer never saw — it fired on every
 * card with a retry or contact-admin button.
 *
 * Found by running the real flow on hook `demo-oa-three` (2026-08-10): the log said
 * `card 'PAYreview' still has unresolved tags: {{paylink.contact_admin}}` while
 * the delivered card, read back from `chat_messages.metadata.flex_json`, correctly
 * carried `"text":"ติดต่อแอดมิน"`.
 *
 * The risk was never the customer — it was the next person reading the log
 * chasing a bug that does not exist, then learning to skip this line.
 *
 * What is pinned here: `paylink` is filtered, and NOTHING else is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The predicate as it appears in `webhook.service.ts` — kept identical below. */
const isPayLink = (t: string) => /^\{\{\s*paylink\./i.test(t);
const surviving = (tags: string[]) => tags.filter((t) => !isPayLink(t));

describe('[FIX-20260810-PAYLINKWARN] which leftover tags still warn', () => {
  it('★ paylink tags are silenced — the mint owns them', () => {
    // The exact strings seen in the live log, plus the spacing/case a hand-written
    // card can legally carry (`substituteSlipTags` matches `{{ tag }}` too).
    expect(
      surviving([
        '{{paylink.contact_admin}}',
        '{{paylink.retry}}',
        '{{ paylink.retry }}',
        '{{PAYLINK.RETRY}}',
      ]),
    ).toEqual([]);
  });

  it('a genuinely unknown or unfillable tag STILL warns', () => {
    // The whole point of the warning. Silencing these would hide a card that
    // shows raw `{{…}}` to a customer — the opposite failure, and a worse one.
    const tags = ['{{amount}}', '{{sender_name}}', '{{nonsense_tag}}'];
    expect(surviving(tags)).toEqual(tags);
  });

  it('a tag that merely CONTAINS the word paylink is not silenced', () => {
    // Anchored at `{{` so only the real namespace is exempt — a card written with
    // `{{my_paylink_note}}` is still a broken tag and must be reported.
    expect(surviving(['{{my_paylink_note}}', '{{x_paylink.retry}}'])).toEqual([
      '{{my_paylink_note}}',
      '{{x_paylink.retry}}',
    ]);
  });

  it('mixed list keeps only the non-paylink ones', () => {
    expect(
      surviving([
        '{{paylink.retry}}',
        '{{unknown_one}}',
        '{{paylink.contact_admin}}',
      ]),
    ).toEqual(['{{unknown_one}}']);
  });

  it('the service really applies this filter before warning', () => {
    // Asserted against the source: the predicate lives inline in a private method
    // behind LINE, Mongo and a live hook, so driving it would test the harness.
    // If someone later warns on raw `leftover` again, this goes red.
    const src = readFileSync(
      join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    );
    expect(src).toContain('paylink\\.');
    expect(src).toContain('if (unresolved.length) {');
    // The unfiltered form must be gone.
    expect(src).not.toContain('if (bound!.leftover.length) {');
  });
});

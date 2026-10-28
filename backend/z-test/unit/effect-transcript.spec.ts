import type { EffectEvent, EffectTrace } from '../lib/effect-transcript';
import {
  findUnreportedEffects,
  renderTranscript,
  scrubVolatile,
  traceFromSteps,
} from '../lib/effect-transcript';

/**
 * [PROG-20260905-P8] The transcript is the reduction program's proof engine, so the
 * engine itself has to be proven first. Three properties matter, and each has cases here:
 *
 *   STABLE  — identical behaviour must produce an identical text, or every move looks
 *             like a regression and the proof gets ignored.
 *   SHARP   — a real behavioural change must produce a diff, or the proof is decoration.
 *             Every scrub rule below is paired with a case showing what it still catches.
 *   HONEST  — a harness that under-reports must be detectable, because a transcript with
 *             a silent gap reads exactly like "nothing changed".
 */
describe('[PROG-20260905-P8] effect transcript — STABLE', () => {
  it('sorts object keys so insertion order is not mistaken for a change', () => {
    const a = renderTranscript({
      effects: [{ kind: 'chat.row', detail: { b: 2, a: 1 } }],
    });
    const b = renderTranscript({
      effects: [{ kind: 'chat.row', detail: { a: 1, b: 2 } }],
    });
    expect(a).toBe(b);
  });

  it('scrubs the values that legitimately differ between two runs of the same code', () => {
    const text = scrubVolatile(
      '{"_id":"a0d000000000000000000050","at":"2026-09-05T12:00:00.000Z","duration_ms":417,"user":"U70fe070edcf12512204dff242e566cd3","ts":1786606243866}',
    );
    expect(text).toBe(
      '{"_id":"<id>","at":"<ts>","duration_ms":<ms>,"user":"<lineUserId>","ts":<epoch>}',
    );
  });

  it('scrubs the wall-clock text the flow builds for the model prompt', () => {
    // Found while generating the first goldens: this string is rebuilt every run, so
    // leaving it in makes the proof flaky — and a flaky proof gets ignored.
    expect(
      scrubVolatile(
        '{"timeContextText":"Today is วันเสาร์ที่ 05 กันยายน 69 13:18:03 (Bangkok Time)","thai_time":"13:18"}',
      ),
    ).toBe(
      '{"timeContextText":"Today is <thaiDate> <clock> (Bangkok Time)","thai_time":"<clock>"}',
    );
  });

  it('still sees the time FORMAT change, which is a real behaviour change', () => {
    const thai = scrubVolatile('"Today is วันเสาร์ที่ 05 กันยายน 69 13:18:03"');
    const iso = scrubVolatile('"Today is 2026-09-05 13:18:03"');
    expect(thai).not.toBe(iso);
  });

  it('renders the same trace identically on every call', () => {
    const trace = { effects: [{ kind: 'line.reply', detail: { text: 'hi' } }] };
    expect(renderTranscript(trace)).toBe(renderTranscript(trace));
  });
});

describe('[PROG-20260905-P8] effect transcript — SHARP', () => {
  const reply: EffectEvent = { kind: 'line.reply', detail: { text: 'hello' } };
  const row: EffectEvent = { kind: 'chat.row', detail: { senderType: 'bot' } };
  const base: EffectTrace = { effects: [reply, row] };

  it('goes red when an effect ORDER changes (order is behaviour in this flow)', () => {
    const swapped: EffectTrace = { effects: [row, reply] };
    expect(renderTranscript(swapped)).not.toBe(renderTranscript(base));
  });

  it('goes red when an extra effect appears', () => {
    const extra: EffectTrace = {
      effects: [reply, row, { kind: 'line.push', detail: {} }],
    };
    expect(renderTranscript(extra)).not.toBe(renderTranscript(base));
  });

  it('goes red when an effect disappears', () => {
    expect(renderTranscript({ effects: [reply] })).not.toBe(
      renderTranscript(base),
    );
  });

  it('goes red when a value changes, even one the scrubber touches nearby', () => {
    const changed: EffectTrace = {
      effects: [{ kind: 'line.reply', detail: { text: 'goodbye' } }, row],
    };
    expect(renderTranscript(changed)).not.toBe(renderTranscript(base));
  });

  it('still sees a field STOP being written, even though its value is scrubbed', () => {
    // This is the case that makes the scrub honest: `<id>` proves presence and shape.
    const withId = renderTranscript({
      effects: [
        { kind: 'chat.row', detail: { _id: 'a0d000000000000000000050', t: 1 } },
      ],
    });
    const withoutId = renderTranscript({
      effects: [{ kind: 'chat.row', detail: { t: 1 } }],
    });
    expect(withId).not.toBe(withoutId);
  });
});

describe('[PROG-20260905-P8] effect transcript — HONEST', () => {
  it('pairs each step with its payload, in recorded order', () => {
    const trace = traceFromSteps(['line.reply', 'chat.row', 'line.reply'], {
      'line.reply': [{ text: 'first' }, { text: 'second' }],
      'chat.row': [{ id: 1 }],
    });
    expect(trace.effects.map((e) => e.kind)).toEqual([
      'line.reply',
      'chat.row',
      'line.reply',
    ]);
    expect(trace.effects[2]?.detail).toEqual({ text: 'second' });
  });

  it('names a step with no payload bucket rather than dropping it', () => {
    const trace = traceFromSteps(['lock.acquired'], {});
    expect(trace.effects).toEqual([{ kind: 'lock.acquired' }]);
  });

  it('reports a harness that collected more effects than it announced', () => {
    // A silent gap in the transcript reads exactly like "nothing changed" — the most
    // dangerous failure this program can have. It must be loud.
    expect(
      findUnreportedEffects(['line.reply'], {
        'line.reply': [{}, {}],
        'chat.row': [{}],
      }),
    ).toEqual(['chat.row', 'line.reply']);
  });

  it('is silent when every collected effect was announced', () => {
    expect(
      findUnreportedEffects(['line.reply', 'chat.row'], {
        'line.reply': [{}],
        'chat.row': [{}],
      }),
    ).toEqual([]);
  });
});

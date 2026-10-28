/**
 * [FEAT-20261026-RAGENGINE] Turn the selected chunks into what the prompt receives.
 *
 *   add      → `docText`: the passages, for the existing `Document:` block. The Training
 *              Doc stays whole in the system instruction, so nothing the OA wrote is lost —
 *              which is also why pinned chunks are left out here: they are already sent.
 *   replace  → `suggestionOverride`: the Training Doc rebuilt from pinned + selected chunks
 *              in the SAME shape `buildSuggestionForHook` produces — `${start}\n${body}\n${end}`
 *              per box, boxes joined by `\n`, a box with nothing kept is dropped (as an empty
 *              box is today). Dynamic tags, `{{ctx}}` and `[[[history]]]` inside the kept text
 *              are then substituted by the unchanged pipeline downstream.
 * Nothing selected ⇒ `NO_RAG_CONTEXT` ⇒ the prompt is exactly today's.
 * ไม่มีอะไรถูกเลือก = prompt เหมือนเดิมทุกไบต์
 */
import type { RagPromptMode } from '../rag.config';
import {
  NO_RAG_CONTEXT,
  type RagChunk,
  type RagContext,
  type RagSection,
} from '../rag.types';

export function composeContext(
  sections: readonly RagSection[],
  chunks: readonly RagChunk[],
  selected: readonly number[],
  mode: RagPromptMode,
): RagContext {
  if (!selected.length) return NO_RAG_CONTEXT;

  if (mode === 'add') {
    const passages = selected.map((i) => chunks[i]!).filter((c) => !c.pinned);
    if (!passages.length) return NO_RAG_CONTEXT;
    const docText = passages
      .map((c) =>
        c.heading && !c.text.trimStart().startsWith(c.heading)
          ? `[${c.heading}]\n${c.text}`
          : c.text,
      )
      .join('\n\n');
    return { docText, suggestionOverride: null };
  }

  const keep = new Set(selected);
  chunks.forEach((c, i) => c.pinned && keep.add(i));
  const boxes = sections
    .map((s, si) => {
      const body = chunks
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => c.section === si && keep.has(i))
        .map(({ c }) => c.text)
        .join('\n');
      if (!body.trim()) return '';
      return s.start || s.end ? `${s.start}\n${body}\n${s.end}` : body;
    })
    .filter(Boolean);
  return { docText: '', suggestionOverride: boxes.join('\n') };
}

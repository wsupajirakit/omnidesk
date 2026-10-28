/**
 * [FEAT-20261026-RAGENGINE] RAG engine controls — AI tab, "AI ขั้นสูง" sub-tab
 * ============================================================================
 * WHAT: the per-OA switch `doc_retrieval` (moved here VERBATIM from HookAiTab.tsx — markup
 *   pinned by the structure snapshot in test/ragEngineSection.dom.test.tsx, taken on the old
 *   code) plus the engine's two modes, rendered only while the switch is on:
 *   - `rag_prompt_mode`: '' (= null → engine default `add`) | 'add' | 'replace'
 *   - `rag_search_mode`: '' (= null → engine default `bm25`) | 'bm25' | 'hybrid'
 * WHY: the BE engine (omnidesk-api `src/modules/rag/`, lane demo) decides; null
 *   means "the code default", so a hook that never touched these behaves exactly as before.
 *   The option values must equal BE `RAG_PROMPT_MODES` / `RAG_SEARCH_MODES` — the BE refuses
 *   anything else with a 400.
 * ⚠️ Hidden while the switch is off (the BE ignores both then). Hiding does NOT clear them:
 *   a stored mode survives switching off and on again.
 * State stays in the parent — everything arrives on `ctx`; no useState here.
 * 📖 BE note: omnidesk-api todo/task/26102026/be_todo1_26102026_rag-engine-overhaul_demo.md
 * revert: paste the first block back where <RagEngineSection/> mounts in HookAiTab.tsx, delete
 *   this file, and drop `rag_prompt_mode` / `rag_search_mode` from types/default/load/payload.
 */
import React from 'react';
import type { HookFormTabCtx } from './hookFormTabCtx';

export const RagEngineSection: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const { formData, setFormData, isViewMode, t, inputClass } = ctx;

  // literal t() keys on purpose — test/i18nKeyCoverage.value.test.ts can only see literals
  const modes = [
    {
      name: 'rag_prompt_mode',
      label: t('hook_form.rag_prompt_mode'),
      hint: t('hook_form.rag_prompt_mode_hint'),
      options: [
        ['', t('hook_form.rag_prompt_mode_default')],
        ['add', t('hook_form.rag_prompt_mode_add')],
        ['replace', t('hook_form.rag_prompt_mode_replace')],
      ],
    },
    {
      name: 'rag_search_mode',
      label: t('hook_form.rag_search_mode'),
      hint: t('hook_form.rag_search_mode_hint'),
      options: [
        ['', t('hook_form.rag_search_mode_default')],
        ['bm25', t('hook_form.rag_search_mode_bm25')],
        ['hybrid', t('hook_form.rag_search_mode_hybrid')],
      ],
    },
  ] as const;

  return (
    <>
      {/* ==== [FEAT-20260810-DOCRETRIEVAL] วิธีส่ง Training Document ให้ AI ====
          WHAT: เลือกว่าจะส่งเอกสารทั้งฉบับ (เดิม) หรือค้นเฉพาะย่อหน้าที่เกี่ยวข้อง
          WHY : เปิดต่อ OA · ค่าเริ่มต้นปิด = พฤติกรรมเดิมเป๊ะ
                (เดิม 10/08 ผูกกับ `findRelevantText` ซึ่งไม่เคยรันจริง · ตั้งแต่ 26/10 ผูกกับ
                 RAG engine ใหม่ของ BE — `src/modules/rag/`)
          ⚠️ ค่าเริ่มต้นต้องเป็น "ส่งทั้งฉบับ" — hook เก่าไม่มี field นี้ อ่านเป็น false
             ทั้งฝั่ง FE (`?? false` ตอน load) และ BE (schema default) ⇒ seamless
          ⚠️ BE เป็นตัวตัดสินจริง ตรงนี้แค่ตั้งค่า · engine ใหม่ไม่เรียก AI ตอบเพิ่ม
             (bm25 ค้นในเครื่องล้วน · hybrid เรียกแค่ embedding ของ Gemini)
          revert: ลบบล็อกนี้ + `doc_retrieval` ใน default/load */}
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('hook_form.doc_retrieval')}
        </label>
        <select
          disabled={isViewMode}
          name="doc_retrieval"
          value={formData.doc_retrieval ? 'true' : 'false'}
          onChange={(e) =>
            setFormData(prev => ({ ...prev, doc_retrieval: e.target.value === 'true' }))
          }
          className={inputClass(false, 'bg-white')}
        >
          <option value="false">{t('hook_form.doc_retrieval_full')}</option>
          <option value="true">{t('hook_form.doc_retrieval_search')}</option>
        </select>
        <p className="mt-1 text-xs text-slate-500/80">
          {t('hook_form.doc_retrieval_hint')}
        </p>
      </div>
      {/* ==== [FEAT-20260810-DOCRETRIEVAL] END */}
      {formData.doc_retrieval && modes.map((m) => (
        <div key={m.name}>
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {m.label}
          </label>
          <select
            disabled={isViewMode}
            name={m.name}
            value={formData[m.name] || ''}
            onChange={(e) => {
              // '' = "the engine default"; buildHookPayload turns it into null (one place only)
              const next = e.target.value;
              setFormData((prev: Record<string, unknown>) => ({ ...prev, [m.name]: next }));
            }}
            className={inputClass(false, 'bg-white')}
          >
            {m.options.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500/80">{m.hint}</p>
        </div>
      ))}
    </>
  );
};

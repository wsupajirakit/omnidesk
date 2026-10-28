/**
 * Public surface of the AI module — import '@/modules/ai'.
 *
 * The free functions are exported because that is how legacy exports them (a
 * module singleton with sixteen named exports, several prefixed `__` for its own
 * tests). Keeping the same surface means the differential suite can drive the
 * port and the legacy JavaScript through the same names on the same inputs,
 * which is the only evidence available that this port is behaviour-identical —
 * there is no HTTP route to diff yet.
 */

export * from './ai.module';
export * from './rag-engine.service';
// [FEAT-20260829-EPOCHTHAI] revert: ลบบรรทัดนี้ + ไฟล์ epoch-thai-time.util.ts
export * from './epoch-thai-time.util';

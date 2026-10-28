/**
 * [FEAT-20261022-I18NTICKETEN] A ticket category's Thai label → the UI language, display only.
 * Keyed by the Thai label the screen already draws (each label has one meaning), so the
 * stored category value and every filter that matches on it stay untouched. English follows
 * `ticketCategoryCatalog.ts` labelEN. Unknown label ⇒ shown as is.
 * revert: delete this file + its calls (OpenCaseModal, ticketPresentation).
 */
type T = (key: string, fallback?: string) => string;

const KEYS: Readonly<Record<string, string>> = {
  'อื่นๆ': 'ticketui.cat.other',
  'แจ้งฝาก': 'ticketui.cat.deposit',
  'ทวงถาม': 'ticketui.cat.collection',
  'อุปกรณ์': 'ticketui.cat.it',
  'ชำระค่างวด': 'ticketui.cat.installment',
  'สินเชื่อ': 'ticketui.cat.loan',
};

export const categoryLabelI18n = (label: string, t: T): string =>
  KEYS[label] ? t(KEYS[label], label) : label;

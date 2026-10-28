/**
 * ==== [FEAT-20260903-FIELDOPTIONS] ask the server what a field may be set to ==
 *
 * WHAT THIS REPLACED. `slip_provider` was a free-text box, then briefly a list
 * typed on this side. Both are the same bug in different clothes: a client that
 * decides what values exist can offer one the server cannot act on, and the
 * operator then picks it, sees it saved, and gets the old behaviour with nothing
 * anywhere saying the choice was ignored. **The server is the only side that can
 * answer this honestly**, so it answers it.
 *
 * ⇒ There is no list of vendors in this repository any more. Deleting one was the
 * point of the endpoint.
 *
 * ⚠️ `choice_count` EXCLUDES the default option, and the caller uses it to decide
 * whether to render the control at all. Counting the array here instead would
 * mean this side has to know which entry is the fallback — the exact knowledge
 * being kept on one side. A field with one real value cannot be changed to
 * anything, so a form drops it; the day the server registers a second value the
 * control appears on its own, with no release here.
 *
 * ⚠️ NOT CACHED, deliberately. It is one small request when a form opens, and a
 * cache would mean a newly registered value stays invisible until a reload —
 * reintroducing the staleness this endpoint exists to remove. Add caching when a
 * measurement says it is needed, not before.
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export interface FieldOption {
  /** stored verbatim in the field */
  value: string;
  /** an i18n key — this side owns the wording */
  label_key: string;
  /**
   * [FEAT-20260903-FALLBACKLABEL] a plain name to show when this build has no
   * translation for `label_key` — a proper noun, never a sentence. Present only
   * on entries the server can add on its own; the ones that shipped with this
   * client already have a translation. Rendering goes through
   * `components/hook/form/fieldOptionLabel.ts`, which keeps a real translation
   * winning over this.
   */
  fallback_label?: string;
  /** the value the field falls back to when nothing is set */
  is_default?: boolean;
}

export interface FieldOptionsResponse {
  key: string;
  options: FieldOption[];
  /** how many options are a real choice — the default excluded */
  choice_count: number;
}

export const fieldOptionsService = {
  /**
   * @param key the FIELD NAME, exactly as the form knows it.
   * @throws when the server has no options registered for that key (404) — the
   * caller decides whether that is fatal or simply "render nothing".
   */
  get: async (key: string): Promise<FieldOptionsResponse> => {
    const response = await authFetch(`${API_BASE_URL}/api/field-options/${key}`);
    return handleApiResponse(response, `load options for ${key}`);
  },
};

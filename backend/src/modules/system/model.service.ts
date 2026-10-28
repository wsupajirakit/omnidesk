import { Inject, Injectable } from '@nestjs/common';
import { GEMINI_MODELS_URL } from '@/common/ai-endpoints';
import type { ConfigType } from '@nestjs/config';

import { aiConfig } from '@/config/app.config';

/** One row of the model list as the dashboard's dropdown consumes it. */
export interface ModelSummary {
  id?: string;
  displayName?: string;
  description?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelListResponse {
  success: boolean;
  current_time: string;
  models: ModelSummary[];
}

/** Legacy's failure body — `{success, message, error}`, not the `{error}` envelope. */
export interface ModelErrorResponse {
  success: false;
  message: string;
  error: string;
}

/** Shape of the upstream Gemini list response, narrowed to what is read. */
interface GeminiModel {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class ModelService {
  constructor(
    @Inject(aiConfig.KEY)
    private readonly ai: ConfigType<typeof aiConfig>,
  ) {}

  /**
   * Lists the Gemini models available to the configured key.
   *
   * The key travels as a query parameter because that is the only form the v1
   * list endpoint accepts; it is never echoed back — only the mapped model
   * summaries leave this method.
   */
  async getModels(): Promise<ModelListResponse> {
    /* [FEAT-20260908-AIVENDORHOSTS] Host and version from the door.
       BYTE-IDENTICAL: `GEMINI_MODELS_URL` is pinned to `/v1` precisely so this
       caller keeps the surface it has always used — the v1↔v1beta equivalence
       was measured on generateContent, never on the listing endpoint, and
       assuming it transfers would be a wire change dressed as a cleanup.
       ⚠️ The key is still ENCODED here, unlike the generateContent callers which
       send it raw. That difference is real and stays with the caller.
       ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
    const url = `${GEMINI_MODELS_URL}?key=${encodeURIComponent(
      this.ai.geminiApiKey ?? '',
    )}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Request failed with status code ${res.status}`);
      }
      const body = (await res.json()) as { models?: GeminiModel[] };
      const models = (body.models ?? []).map((m) => ({
        id: m.name?.replace('models/', ''),
        displayName: m.displayName,
        description: m.description,
        inputTokens: m.inputTokenLimit,
        outputTokens: m.outputTokenLimit,
      }));

      return {
        success: true,
        current_time: new Date().toISOString(),
        models,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

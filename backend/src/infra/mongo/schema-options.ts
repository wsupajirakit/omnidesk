import type { SchemaOptions } from 'mongoose';

/**
 * Shared schema options for every model ported from the legacy backend.
 *
 * Two things here are contract, not preference:
 *
 * - **`collection` is always stated explicitly** by each schema. Mongoose
 *   derives a collection name from the model name when you leave it out, and a
 *   derived name that disagrees with the existing one silently creates an empty
 *   collection next to the real data.
 * - **Timestamps are `created_at` / `updated_at`**, not Mongoose's camelCase
 *   defaults. Existing documents carry the snake_case fields and the dashboard
 *   reads them by those names.
 */
export const legacyTimestamps = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
} satisfies SchemaOptions;

/** Options for a collection whose documents have no timestamps at all. */
export const noTimestamps = { timestamps: false } satisfies SchemaOptions;

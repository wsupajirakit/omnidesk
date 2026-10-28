/**
 * The data layer: JSON seed files, no database. A store loads its seed ONCE, keeps a pristine
 * copy, and serves a mutable in-memory working copy. Writes (link, top-up, pay-in) live only in
 * memory and vanish on restart — on purpose, a mock must be reproducible. `reset()` restores the
 * seed (tests call it between cases).
 */
import { readFileSync } from 'node:fs';

export class JsonStore<T> {
  readonly #seed: T;
  #state: T;

  constructor(seed: T) {
    this.#seed = structuredClone(seed);
    this.#state = structuredClone(seed);
  }

  static fromFile<T>(path: string, validate?: (v: unknown) => v is T): JsonStore<T> {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (validate && !validate(parsed)) throw new Error(`seed file failed validation: ${path}`);
    return new JsonStore(parsed as T);
  }

  /** A deep copy — callers can never mutate the store by accident. */
  read(): T {
    return structuredClone(this.#state);
  }

  /** The only write path. The callback edits a draft; the draft becomes the new state. */
  write<R>(fn: (draft: T) => R): R {
    const draft = structuredClone(this.#state);
    const out = fn(draft);
    this.#state = draft;
    return out;
  }

  reset(): void {
    this.#state = structuredClone(this.#seed);
  }
}

/**
 * [FEAT-20260828-MENUTAG-S1] the look seam (plan §3f): a definition names its
 * renderer (`render`, default 'fixed'); a future flex-document renderer reads
 * a per-hook stored flex without touching existing scenarios.
 * revert: delete src/modules/menu/ whole.
 */
import type { MenuDefinition } from '../scenarios/scenario.types';
import type { MenuContext } from '../menu-context';

/** A ready-to-send LINE message object (flex/text/image shape). */
export type RenderedMenuMessage = Record<string, unknown>;

export interface MenuRenderer {
  render(definition: MenuDefinition, context: MenuContext): RenderedMenuMessage;
}

/**
 * The renderer map, keyed by `MenuDefinition.render`.
 *
 * A future stored-card renderer is ONE entry here — the engine already asks the
 * map by key and falls back to the fixed renderer for anything missing, so
 * adding or removing a kind never edits the engine. Async on purpose: a stored
 * card is a DB read.
 */
export type MenuRendererMap = Readonly<
  Record<string, MenuRenderer | MenuAsyncRenderer>
>;

export interface MenuAsyncRenderer {
  render(
    definition: MenuDefinition,
    context: MenuContext,
  ): Promise<RenderedMenuMessage>;
}

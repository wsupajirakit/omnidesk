/**
 * [FEAT-20260905-CUSTPROV PART 7] The HOST — draws `view.sections` in order.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (`group` = tabs) · §38 (this folder) · §39 (a new provider
 *          adds no FE file) · §40 (BE decides presentation order)
 *
 * ## WHAT IT DOES, IN ORDER
 * 1. drop every section with no resolvable label (`./labels.ts` — a blank title
 *    is a bug that looks like a design);
 * 2. walk what is left IN ARRAY ORDER, collecting sections that share a `group`
 *    into one card at the position of the group's FIRST member;
 * 3. draw each card with the existing `PanelCard`; a card with 2+ members draws
 *    the existing `PanelTabs`, one tab per member, in array order;
 * 4. body comes from `renderSection`, which never returns null (§40).
 *
 * 🔴 THE BE DECIDES ORDER. §40 calls this out as a deliberate trade: presentation
 * order moves to the payload, and that is exactly what removes the FE release
 * from a provider switch. There is no sort, no priority table and no per-id
 * special case in this file — adding one would put a provider list back on the
 * dashboard by the back door. ลำดับมาจาก payload ห้ามจัดเรียงเองบน FE
 *
 * ## 🔴 A GROUP HAS NO TITLE ON THE WIRE — SO THE TITLE IS DERIVED
 * The contract carries `group` as a bare id (`finance`) and no group label. Card
 * titles for grouped cards therefore resolve as: `t('panel.group.<id>')` when the
 * dictionary has it, else `humanId(id)` (`finance` → `Finance`). Same shape as
 * the label rule and the icon rule — a known id gets the nice answer, an unknown
 * id still gets a correct one, and NO front-end release is needed for either.
 * REJECTED (a): title the card with its first member's label. `finance` would be
 * titled "ประวัติฝาก" and then show a "ประวัติฝาก" tab inside itself.
 * REJECTED (b): a group-id → Thai-title map in this file. That is a vendor
 * vocabulary list on the dashboard — the one thing §38 says must not exist here,
 * because it is what forces an FE release per provider.
 * The day the contract gains a `groupLabel`, read it first and this derivation
 * becomes the fallback; nothing else changes.
 *
 * ## The group's card takes its BADGE and its COLLAPSED state from its FIRST member
 * The producer puts the finance chips on `finance.deposits` and leaves
 * `finance.withdrawals` without them, so "first member that HAS a badge" is what
 * reproduces the current card; `collapsed` reads the first member only, because
 * a card is open or shut as a whole and a per-tab answer has nowhere to go.
 *
 * ## 🔴 TONE → COLOUR: `off` IS GREY, NOT RED — a deliberate call
 * The producer collapses two of today's colours into one token: `ไม่มีโปรโมชั่น`
 * is `off` and grey today (`PromotionCard.tsx:51`), while `ฝาก: ปิด` is `off` and
 * RED today (`ProfilePanel.tsx:2424`). Four tones cannot express five colours, so
 * one of them loses. Grey wins: a customer with no promotion is not a fault, and
 * painting "ไม่มีโปรโมชั่น" red invents an alarm. The reverse mistake — "ฝาก: ปิด"
 * in grey — is quieter than the truth, never wrong about it.
 * REJECTED: `off` → red. It is the louder half of the conflict and it is the half
 * that misleads. สีที่หลอกให้ตกใจ แย่กว่าสีที่เงียบไป
 *
 * ## SAFE IMPORT CYCLE (stated, not accidental)
 * `./index.tsx` re-exports this component while this file imports `renderSection`
 * from it. Safe because nothing here reads that binding at MODULE scope — it is
 * called during render, long after both modules have finished evaluating.
 * Keeping `renderSection` in `./index.tsx` is the point: the closed set lives in
 * exactly one file.
 *
 * revert: delete this file and its re-export line at the bottom of `./index.tsx`.
 */
import React from 'react';
import { PanelCard } from '../shared/PanelCard';
import { PanelTabs } from '../shared/PanelTabs';
import { useI18n } from '../../../i18n';
import { renderSection } from './index';
import { iconFor } from './icons';
import { humanId, resolveLabel, sectionLabelSource, type Translate } from './labels';
import type { Chip, CustomerView, Section } from './types';

/** The panel's chip vocabulary. `off` → grey — see the header for why. */
/**
 * 🔴 ONE TONE PER COLOUR, and the class strings are the ones already on screen.
 *
 * The first version of this map had to guess, because the contract sent `off`
 * for two chips that are two different colours today: `ฝาก: ปิด` is RED
 * (`ProfilePanel.tsx:2424`) and `ไม่มีโปรโมชั่น` is GREY
 * (`cards/PromotionCard.tsx:51`). Whichever colour it picked was wrong for the
 * other one — grey for `ฝาก: ปิด` mutes a real alarm, red for
 * `ไม่มีโปรโมชั่น` invents one. The back end now sends four tones for four
 * colours (`view.types.ts`, `Chip`), so nothing here guesses.
 *
 * `warn` is deliberately absent: no provider emits amber, and a colour nobody
 * sends is weight the dashboard carries for nobody. An unknown tone falls back
 * to `muted` — visible and quiet, never invisible.
 */
const TONE_CLASS: Record<string, string> = {
  ok: 'panel-badge panel-badge-green text-green-700 bg-green-100 border-green-200',
  off: 'panel-badge panel-badge-red text-red-700 bg-red-100 border-red-200',
  info: 'panel-badge-promo text-blue-700 bg-blue-100 border-blue-200',
  muted: 'text-gray-500 bg-gray-100 border-gray-200',
};

/** A card header's chips. A chip with no label is skipped, like every label. */
const Badges: React.FC<{ chips: readonly Chip[]; t: Translate }> = ({ chips, t }) => (
  <span className="flex items-center gap-1">
    {chips.map((chip, i) => {
      const label = resolveLabel(t, chip);
      if (label === null) return null;
      const tone = TONE_CLASS[chip.tone ?? 'muted'] ?? TONE_CLASS['muted'];
      return (
        <span
          key={`${label}-${i}`}
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${tone}`}
        >
          {label}
        </span>
      );
    })}
  </span>
);

/** One card on screen: a lone section, or a group drawn as tabs. */
interface Card {
  readonly key: string;
  /** The id the icon map is asked about — the group when there is one. */
  readonly iconId: string;
  readonly title: string;
  readonly members: { section: Section; label: string }[];
}

/**
 * Sections → cards, in array order.
 *
 * The `g:` / `s:` prefixes keep a group named `finance` from colliding with an
 * ungrouped section whose id is also `finance` — both are provider-chosen
 * strings out of the same namespace, so nothing stops them being equal.
 */
const toCards = (sections: readonly Section[], t: Translate): Card[] => {
  const cards: Card[] = [];
  const byKey = new Map<string, Card>();

  for (const section of sections) {
    const label = resolveLabel(t, sectionLabelSource(section));
    if (label === null) continue; // no label ⇒ not drawn (see the header)

    const group = section.group;
    const key = group ? `g:${group}` : `s:${section.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push({ section, label });
      continue;
    }

    /* A grouped card is titled from its group id; a lone one keeps its own
       label. `panel.group.<id>` is the key namespace — see the header. */
    const groupTitle = group ? (resolveLabel(t, { labelKey: `panel.group.${group}` }) ?? humanId(group)) : null;
    const card: Card = {
      key,
      iconId: group ?? section.id,
      title: groupTitle ?? label,
      members: [{ section, label }],
    };
    byKey.set(key, card);
    cards.push(card);
  }
  return cards;
};

export const ProfilePanelView: React.FC<{ view?: CustomerView | null }> = ({ view }) => {
  const { t } = useI18n();
  /* `?? []` — the panel renders before the profile request lands, and a
     provider may answer an envelope with no `view` at all (it is ADDITIVE; §36
     keeps `data` as the only thing guaranteed). Nothing to draw is a normal
     state, not an error state. */
  const cards = toCards(view?.sections ?? [], t);

  return (
    <div className="space-y-3" data-testid="profile-panel-view">
      {cards.map((card) => {
        /* Badge: the first member that HAS one. Collapsed: the first member,
           full stop — a card opens or shuts as a whole. */
        const withBadge = card.members.find((m) => (m.section.badge?.length ?? 0) > 0);
        const first = card.members[0]!.section;
        return (
          <PanelCard
            key={card.key}
            title={card.title}
            icon={iconFor(card.iconId)}
            defaultOpen={first.collapsed !== true}
            badge={withBadge ? <Badges chips={withBadge.section.badge ?? []} t={t} /> : undefined}
          >
            {card.members.length > 1 ? (
              <PanelTabs
                tabs={card.members.map(({ section, label }) => ({
                  key: section.id,
                  label,
                  content: renderSection(section),
                }))}
              />
            ) : (
              renderSection(first)
            )}
          </PanelCard>
        );
      })}
    </div>
  );
};

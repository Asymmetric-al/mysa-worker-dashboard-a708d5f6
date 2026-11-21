/**
 * Home's one translation from the envelope's record to the view a row validates.
 *
 * **Why this file exists.** `readHome` states each item in the service's own vocabulary — `itemId`,
 * a kebab-case `reason` key, a bare `destination` route, a `label` that may be absent — while a row
 * validates the strict `homeItemViewSchema`, which asks for `id`, a sentence saying why the item is
 * there, a reason badge code and a destination carrying its own words. Handing a service item
 * straight to a row therefore leaves that row unable to open it, and the item is shown as an
 * incomplete row rather than as work to do. This module is the one place the two vocabularies are
 * reconciled: it is pure, holds no React and no hook, reads no clock and states no rule of its own.
 *
 * **Why the wording is a table and not a fallback.** Every sentence, badge code and destination
 * label comes from `ITEM_WORDING`, which is total over the service's closed reason vocabulary, so a
 * reason the service adds fails compilation here instead of reaching a row that had to invent
 * words. Nothing in this file composes prose of its own.
 *
 * **What it deliberately leaves out.**
 *
 * - No `statusWord`, no `lifecycle` and no `simulatedEffect`. The envelope states no content
 *   lifecycle and no simulated effect for a Home item, and the reason badge already carries the
 *   state ("Overdue", "Awaiting review"), so manufacturing a second status vocabulary here would
 *   duplicate copy the row already owns and would let one state read two ways on one page.
 * - No `figure`, in any form. The support item's amounts, currencies and coverage are the report's
 *   own statement, and `copy.ts` states that this family formats no number, date, amount or
 *   percentage; the item leads to `/support`, which states them with their basis and coverage. The
 *   view has no money member for a figure to occupy.
 *
 * **Order is the read's, not this file's.** Sections follow `HOME_SECTION_KEYS`, the order Home
 * renders them in. Items inside a section keep the order the read already sorted them into — this
 * file filters and maps, and never re-sorts.
 *
 * **Validation stays in the row.** `parseHomeItem` remains the single validator of an item view, so
 * an item is checked once, where it is rendered, and this mapper only builds the candidate.
 */
import type { reads } from "@/modules/data-service";
import { ITEM_WORDING, type HomeItemWording } from "./copy";
import { HOME_SECTION_KEYS, type HomeItemView, type HomeSectionKey } from "./home-schema";

// The service's own shapes, taken from the read rather than restated
/** What `readHome` answers with: the envelope, a denial, or an unavailable source behind it. */
type HomeResult = Awaited<ReturnType<typeof reads.context.readHome>>;

/** Everything the Home envelope states: its items, in section order, and nothing else. */
export type HomeData = Extract<HomeResult, { readonly kind: "envelope" }>["envelope"]["data"];

/** One item as the read states it, before a view is built from it. */
type HomeItem = HomeData["items"][number];

/** The one section — Attention, Information or Unfinished work — formed from the items the read placed in it. */
export interface HomeSectionGroupView {
  readonly sectionKey: HomeSectionKey;
  readonly items: readonly HomeItemView[];
}

/** The words a detail line is built from, and the separator between its two parts. */
const DETAIL_DATE_PREFIX = "Date on record: ";

const DETAIL_LOCALE_PREFIX = "Language edition: ";

const DETAIL_SEPARATOR = " · ";

/**
 * The item's detail line, built only from what the envelope actually stated: the civil date exactly
 * as it arrived and the language tag exactly as it arrived, each labelled for what it is. An item
 * that stated neither has no detail line rather than an empty one, so the row omits it instead of
 * rendering a blank paragraph.
 */
function detailOf(item: HomeItem): string | undefined {
  const stated: string[] = [];
  if (item.onDate !== null) {
    stated.push(`${DETAIL_DATE_PREFIX}${item.onDate}`);
  }
  if (item.locale !== null) {
    stated.push(`${DETAIL_LOCALE_PREFIX}${item.locale}`);
  }
  return stated.length === 0 ? undefined : stated.join(DETAIL_SEPARATOR);
}

/**
 * One service item as the view its row validates: the identity the envelope gave it, the subject it
 * stated or the reason's own subject when it stated none, the words for its reason, and the route it
 * opens with the words for that route.
 */
function viewOf(item: HomeItem): HomeItemView {
  const wording: HomeItemWording = ITEM_WORDING[item.reason];
  const detail = detailOf(item);
  return {
    id: item.itemId,
    title: item.label ?? wording.fallbackTitle,
    reason: wording.sentence,
    reasonCode: wording.code,
    destination: { href: item.destination, label: wording.destinationLabel },
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Home's three sections, in display order, each carrying the items the read placed in it, already
 * worded as the rows render them. A section with nothing in it is present with no items, so the
 * surface states that section's own empty result rather than dropping the section.
 */
export function homeSectionGroupsOf(data: HomeData): readonly HomeSectionGroupView[] {
  return HOME_SECTION_KEYS.map((sectionKey) => ({
    sectionKey,
    items: data.items.filter((item) => item.section === sectionKey).map(viewOf),
  }));
}

/** Home's one translation from the envelope's record to the view a row validates: `readHome` states each item in the service's own vocabulary — `itemId`, a kebab-case reason — and a row reads only validated views. */
import type { reads } from "@/modules/data-service";
import { ITEM_WORDING, type HomeItemWording } from "./copy";
import { HOME_SECTION_KEYS, type HomeItemView, type HomeSectionKey } from "./home-schema";
/** The service's own shapes, taken from the read rather than restated: a denial or an unavailable source is one of them. */
type HomeResult = Awaited<ReturnType<typeof reads.context.readHome>>;
export type HomeData = Extract<HomeResult, { readonly kind: "envelope" }>["envelope"]["data"];
type HomeItem = HomeData["items"][number];
export type HomeSectionGroupView = { readonly sectionKey: HomeSectionKey; readonly items: readonly HomeItemView[] };

/** The detail line, built only from what the envelope stated: the civil date and the language tag exactly as they arrived, each labelled for what it is. */
function detailOf(item: HomeItem): string | undefined {
  const stated: string[] = [];
  if (item.onDate !== null) stated.push(`Date on record: ${item.onDate}`);
  if (item.locale !== null) stated.push(`Language edition: ${item.locale}`);
  return stated.length === 0 ? undefined : stated.join(" · ");
}
/** One service item as the view its row validates: the identity the envelope gave it, the subject it stated or the reason's own subject when it stated none, the words for its reason, and the route it opens. */
function viewOf(item: HomeItem): HomeItemView {
  const wording: HomeItemWording = ITEM_WORDING[item.reason];
  const detail = detailOf(item);
  return { id: item.itemId, title: item.label ?? wording.fallbackTitle, reason: wording.sentence, reasonCode: wording.code, destination: { href: item.destination, label: wording.destinationLabel }, ...(detail === undefined ? {} : { detail }) };
}
export function homeSectionGroupsOf(data: HomeData): readonly HomeSectionGroupView[] {
  return HOME_SECTION_KEYS.map((sectionKey) => ({ sectionKey, items: data.items.filter((item) => item.section === sectionKey).map(viewOf) }));
}

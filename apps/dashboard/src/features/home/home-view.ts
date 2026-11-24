import type { reads } from "@/modules/data-service";
import { ITEM_WORDING, type HomeItemWording } from "./copy";
import { HOME_SECTION_KEYS, type HomeItemView, type HomeSectionKey } from "./home-schema";
export type HomeData = Extract<Awaited<ReturnType<typeof reads.context.readHome>>, { readonly kind: "envelope" }>["envelope"]["data"];
type HomeItem = HomeData["items"][number];
export type HomeSectionGroupView = { readonly sectionKey: HomeSectionKey; readonly items: readonly HomeItemView[] };
function detailOf(item: HomeItem): string | undefined {
  const stated: string[] = [];
  if (item.onDate !== null) stated.push(`Date on record: ${item.onDate}`);
  if (item.locale !== null) stated.push(`Language edition: ${item.locale}`);
  return stated.length === 0 ? undefined : stated.join(" · ");
}
function viewOf(item: HomeItem): HomeItemView {
  const wording: HomeItemWording = ITEM_WORDING[item.reason];
  const detail = detailOf(item);
  return { id: item.itemId, title: item.label ?? wording.fallbackTitle, reason: wording.sentence, reasonCode: wording.code, destination: { href: item.destination, label: wording.destinationLabel }, ...(detail === undefined ? {} : { detail }) };
}
export const homeSectionGroupsOf = (data: HomeData): readonly HomeSectionGroupView[] => HOME_SECTION_KEYS.map((sectionKey) => ({ sectionKey, items: data.items.filter((item) => item.section === sectionKey).map(viewOf) }));

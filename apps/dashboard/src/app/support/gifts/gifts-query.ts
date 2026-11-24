import { GIFTS_PARAM } from "@/features/support/gift-params";
import type { reads } from "@/modules/data-service";
import { paramOf, wholeNumberOf, type SearchParams } from "../../page-frame";
/** The bounded filter set the ledger read accepts, taken from its own signature rather than restated. */ export type GiftsQueryInput = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;
/** The page window the ledger read accepts, taken from the same signature. */ export type GiftsPageInput = NonNullable<GiftsQueryInput["page"]>;
const SIGNED_INTEGER = /^-?\d{1,16}$/u;
function minorUnitsOf(value: string | undefined): number | undefined {
  if (value === undefined || !SIGNED_INTEGER.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function periodOf(stated: SearchParams): GiftsQueryInput["period"] {
  const from = paramOf(stated, GIFTS_PARAM.from);
  const to = paramOf(stated, GIFTS_PARAM.to);
  if (from !== undefined && to !== undefined) return { kind: "explicit", from, to };
  const preset = paramOf(stated, GIFTS_PARAM.period);
  return preset === undefined ? undefined : { kind: "preset", preset };
}
/** The amount range the address states, carried exactly as stated whether or not it names a currency: the read refuses a range with no single currency in its own words, and a reader that dropped the bounds would hand back the whole result to be presented under a filter that was never applied. */
function amountRangeOf(stated: SearchParams): GiftsQueryInput["amountRange"] {
  const minMinor = minorUnitsOf(paramOf(stated, GIFTS_PARAM.amountMin));
  const maxMinor = minorUnitsOf(paramOf(stated, GIFTS_PARAM.amountMax));
  return minMinor === undefined || maxMinor === undefined ? undefined : { minMinor, maxMinor };
}
function partnerOf(stated: SearchParams): GiftsQueryInput["partner"] {
  const recipient = paramOf(stated, GIFTS_PARAM.recipient);
  if (recipient === "anonymous") return { kind: "anonymous" };
  if (recipient === "unresolved") return { kind: "unresolved" };
  const partnerId = recipient === "partner" ? paramOf(stated, GIFTS_PARAM.partnerId) : undefined;
  return partnerId === undefined ? undefined : { kind: "partner", partnerId };
}
function sortOf(stated: SearchParams): GiftsQueryInput["sort"] {
  const field = paramOf(stated, GIFTS_PARAM.sortField);
  const direction = paramOf(stated, GIFTS_PARAM.sortDirection);
  return field === undefined || (direction !== "asc" && direction !== "desc") ? undefined : { field, direction };
}
/** The page window the address states, or `undefined` where it states none, so the ledger's own default stays the ledger's. */ export function statedPageOf(stated: SearchParams): GiftsQueryInput["page"] {
  const index = wholeNumberOf(paramOf(stated, GIFTS_PARAM.page));
  const size = wholeNumberOf(paramOf(stated, GIFTS_PARAM.pageSize));
  return index === undefined && size === undefined ? undefined : { ...(index === undefined ? {} : { index }), ...(size === undefined ? {} : { size }) };
}
/** The ledger's question as the address states it: every filter the read admits, and the page window the route decided. */ export function giftQueryOf(stated: SearchParams, page: GiftsQueryInput["page"]): GiftsQueryInput {
  const period = periodOf(stated);
  const currency = paramOf(stated, GIFTS_PARAM.currency);
  const amountRange = amountRangeOf(stated);
  const partner = partnerOf(stated);
  const sort = sortOf(stated);
  const designation = paramOf(stated, GIFTS_PARAM.designation);
  const method = paramOf(stated, GIFTS_PARAM.method);
  const search = paramOf(stated, GIFTS_PARAM.search);
  return {
    ...(period === undefined ? {} : { period }),
    ...(currency === undefined ? {} : { currency }),
    ...(amountRange === undefined ? {} : { amountRange }),
    ...(designation === undefined ? {} : { designation }),
    ...(partner === undefined ? {} : { partner }),
    ...(method === undefined ? {} : { method }),
    ...(search === undefined ? {} : { search }),
    ...(sort === undefined ? {} : { sort }),
    ...(page === undefined ? {} : { page }),
  };
}

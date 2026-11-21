/** `/support/gifts/[giftId]` — one row of received support, stated at the grain, in the currency and with the provenance the source reports for it (AAP 0.9.1 "Gift/allocation detail"; AAP 0.11.1 files every route here as composition).
 *
 * What this file is. Composition and nothing else. The address's own filter set is translated into the one ledger query the service reads, that read is taken once, and the record itself is rendered entirely by `features/support/components/gift-detail`. No field, amount, grain statement, currency exponent, provenance reference, coverage or as-of instant is stated here: every one of them comes from the read and is rendered by that component, so this record can never disagree with the ledger, the chart, the drilldown, the CSV or the print view it was opened beside (AAP 0.8.8).
 *
 * What this surface never does. It is read-only. Nothing here posts, corrects, refunds, retries or infers money, and nothing here creates a pledge, a receipt, a message or a stewardship obligation (AAP 0.8.1, 0.10.2). The single affordance a gift offers — the thank-you follow-up task — lives inside the detail component, creates a task and nothing else, and is deliberately not wired again here, because a second implementation of one concern is a second answer to the same question (AAP 0.3.4).
 */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { GiftDetail } from "@/features/support/components/gift-detail";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service and the component rather than restated
// ---------------------------------------------------------------------------------------------

/** The bounded filter set the gifts read accepts, read from the read's own first parameter so this route can never describe a query the service does not declare. */
type GiftsQueryInput = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

/** Props of the route: Next 16 hands both members over as promises, and both are awaited before any read. */
export type GiftDetailPageProps = { readonly params: Promise<{ readonly giftId: string }>; readonly searchParams: Promise<SearchParams> };

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The read resolves the session, the selected context and the scenario instant per request, so no rendered record may be cached across a context switch, a restriction or a scope change. */
export const dynamic = "force-dynamic";

/** The ledger this record was opened from, and the address this route answers on so a retry re-reads the same record rather than dropping the filters it was opened under. */
const LEDGER_HREF = "/support/gifts";

const GIFT_PATH = "/support/gifts/";

/** The interface locale every amount and date on the record is formatted in: the one the ledger beside it formats in, so the two never state one gift at two locales. */
const INTERFACE_LOCALE = "en-GB";

/** This route's own wording. The record's own words belong to the detail component. */
const RETURN_LABEL = "Back to the gifts ledger";

const RETRY_LABEL = "Read this gift again";

const DENIED_TITLE = "This gift is not shown in this context";

/** A refusal states no count, no title, no existence flag and no size: the reason code is the whole answer this surface can honestly give. */
const DENIED_DESCRIPTION = "The gifts read was refused for the context this session is admitted to, before it enumerated anything. Nothing here states whether a gift carries that identifier, what such a gift would hold, who it is attributed to or how large it is, so a refusal is not an empty record.";

const UNAVAILABLE_TITLE = "The gift could not be read";

const REFUSED_TITLE = "This gift's request was refused";

/** The search parameters this route reads, named once. Anything else in the URL is an unrelated key this route neither applies nor discards from the way back. */
const PARAM = {
  period: "period",
  from: "from",
  to: "to",
  currency: "currency",
  amountMin: "amountMin",
  amountMax: "amountMax",
  recipient: "recipient",
  partnerId: "partnerId",
  designation: "designation",
  method: "method",
  search: "search",
  sortField: "sortField",
  sortDirection: "sortDirection",
  page: "page",
  pageSize: "pageSize",
} as const;

/** The three attributions the ledger's URL names; a partner attribution additionally names its record. */
const RECIPIENT_PARTNER = "partner";

const RECIPIENT_ANONYMOUS = "anonymous";

const RECIPIENT_UNRESOLVED = "unresolved";

/** The two sort directions the report engine admits. */
const SORT_ASCENDING = "asc";

const SORT_DESCENDING = "desc";

/** A page or a page size: a whole count, never a sign and never a fraction. */
const WHOLE_NUMBER = /^\d{1,9}$/u;

/** An amount bound: whole minor units of the selected currency, which may be a correction and so may be negative. */
const SIGNED_INTEGER = /^-?\d{1,16}$/u;

// ---------------------------------------------------------------------------------------------
// The address's query state, translated into the read's vocabulary
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no list is treated as a facet decision. */
function paramOf(stated: SearchParams, name: string): string | undefined {
  const value = stated[name];
  return Array.isArray(value) ? value[0] : value;
}

/** One parameter as the text it states: a blank parameter states no filter at all, which is how this application's own ledger writes an unstated facet. */
function textOf(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A whole count from a parameter, or `undefined` when the parameter is absent, malformed or beyond exact integers — a value this route cannot read is left to the read's own default rather than coerced into a number the worker never asked for. */
function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** An amount bound from a parameter, exactly as stated: no rounding, no conversion between major and minor units, and no clamping to a band. */
function minorUnitsOf(value: string | undefined): number | undefined {
  if (value === undefined || !SIGNED_INTEGER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The period the address states: two calendar days when both ends are stated, otherwise the preset it names, otherwise none — an unstated or half-stated period is the read's own default rather than one this route invents. */
function periodOf(stated: SearchParams): GiftsQueryInput["period"] {
  const from = textOf(paramOf(stated, PARAM.from));
  const to = textOf(paramOf(stated, PARAM.to));
  if (from !== undefined && to !== undefined) {
    return { kind: "explicit", from, to };
  }
  const preset = textOf(paramOf(stated, PARAM.period));
  return preset === undefined ? undefined : { kind: "preset", preset };
}

/** The amount range the address states, in the minor units of the one currency it names: the range is a filter of that currency, so a range stated without one is not a range the read could apply. */
function amountRangeOf(stated: SearchParams, currency: string | undefined): GiftsQueryInput["amountRange"] {
  if (currency === undefined) {
    return undefined;
  }
  const minMinor = minorUnitsOf(paramOf(stated, PARAM.amountMin));
  const maxMinor = minorUnitsOf(paramOf(stated, PARAM.amountMax));
  if (minMinor === undefined || maxMinor === undefined) {
    return undefined;
  }
  return { minMinor, maxMinor };
}

/** The attribution the address states: a partner's own reference, anonymous support, support the source left unattributed, or none at all. */
function partnerOf(stated: SearchParams): GiftsQueryInput["partner"] {
  switch (textOf(paramOf(stated, PARAM.recipient))) {
    case RECIPIENT_PARTNER: {
      const partnerId = textOf(paramOf(stated, PARAM.partnerId));
      return partnerId === undefined ? undefined : { kind: "partner", partnerId };
    }
    case RECIPIENT_ANONYMOUS:
      return { kind: "anonymous" };
    case RECIPIENT_UNRESOLVED:
      return { kind: "unresolved" };
    default:
      return undefined;
  }
}

/** The sort the address states: a field together with one of the two admitted directions. Which fields are sortable belongs to the report engine, which answers an unknown one in the envelope's actions. */
function sortOf(stated: SearchParams): GiftsQueryInput["sort"] {
  const field = textOf(paramOf(stated, PARAM.sortField));
  const direction = textOf(paramOf(stated, PARAM.sortDirection));
  if (field === undefined || (direction !== SORT_ASCENDING && direction !== SORT_DESCENDING)) {
    return undefined;
  }
  return { field, direction };
}

/** The page window the address states, exactly as stated: the default size and the 200-row cap belong to the service, which clamps them, so this route neither repeats nor anticipates that decision. */
function pageOf(stated: SearchParams): GiftsQueryInput["page"] {
  const index = wholeNumberOf(paramOf(stated, PARAM.page));
  const size = wholeNumberOf(paramOf(stated, PARAM.pageSize));
  if (index === undefined && size === undefined) {
    return undefined;
  }
  return { ...(index === undefined ? {} : { index }), ...(size === undefined ? {} : { size }) };
}

/** The read's query, built from the address and from nothing else: no scope, no authority and no scenario instant is supplied here, because the service derives all three from this session. */
function giftQueryOf(stated: SearchParams): GiftsQueryInput {
  const period = periodOf(stated);
  const currency = textOf(paramOf(stated, PARAM.currency));
  const amountRange = amountRangeOf(stated, currency);
  const partner = partnerOf(stated);
  const sort = sortOf(stated);
  const page = pageOf(stated);
  const designation = textOf(paramOf(stated, PARAM.designation));
  const method = textOf(paramOf(stated, PARAM.method));
  const search = textOf(paramOf(stated, PARAM.search));
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

/** The address's search state as it was stated, carried to the ledger unchanged so the way back restores the filters, the sort and the page the worker left — the keys this route translates are appended by their own spelling, and every other key is preserved rather than assumed away. */
function searchSuffixOf(stated: SearchParams): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(stated)) {
    if (typeof value === "string") {
      params.set(name, value);
      continue;
    }
    if (value === undefined) {
      continue;
    }
    for (const entry of value) {
      params.append(name, entry);
    }
  }
  const search = params.toString();
  return search.length === 0 ? "" : `?${search}`;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** One gift or allocation: the ledger read for the address's filter set, rendered by the detail component, or the read's own refusal stated as `denied`, `unavailable` or `refused`. */
export default async function GiftDetailPage({ params, searchParams }: GiftDetailPageProps): Promise<ReactElement> {
  const { giftId } = await params;
  const stated = await searchParams;
  // The address decides the filter set the record is read under and where it returns to. It never supplies a
  // scope: the organisation, ministry, support subject and principal are derived by the service from this session.
  const carried = searchSuffixOf(stated);
  const result = await reads.support.readGifts(giftQueryOf(stated));
  switch (result.kind) {
    case "envelope":
      // The row is located inside this read rather than described again: `gift-detail` matches the opaque
      // identifier against the rows the scoped read returned, and when the read holds no such row it renders its
      // own absent-record state. That is the no-oracle property, and it comes free of scoping — an identifier from a
      // context this session is not admitted to is simply not in the result, so it is indistinguishable from one
      // that never existed, and nothing here adds a count, a title or a hint that would tell the two apart.
      //
      // The ledger query is deliberately not passed down: the component parses this same address itself through the
      // one query transport the family owns, so its read and its way back are the address as stated rather than this
      // route's re-statement of it — one implementation of that transport, and no second copy free to drift.
      return <GiftDetail scope={result.envelope.scope} giftId={giftId} locale={INTERFACE_LOCALE} />;
    case "denied":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          {/* A refusal is not an empty record and not a zero: the notice carries the closed reason code and a
              single action back to the ledger, and nothing from the address is re-attached to it. */}
          <StateNotice kind="denied" headingLevel={1} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} action={{ label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` }} />
        </div>
      );
    case "unavailable":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          {/* The source did not answer, so the record is unavailable rather than absent and rather than zero. The
              notice states the source identity and the service's own guidance, and its retry is this same address:
              requesting it again re-runs the same read against the same session. */}
          <StateNotice kind="unavailable" headingLevel={1} title={UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: RETRY_LABEL, href: `${GIFT_PATH}${encodeURIComponent(giftId)}${carried}` }} />
        </div>
      );
    case "refused":
      // This route calls the gifts read directly, so the request is its own and never one a transport refused: the
      // arm is stated here rather than thrown, and the notice says the request was refused rather than the gifts
      // source failing — the two are different answers and must stay different.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="refused" headingLevel={1} title={REFUSED_TITLE} action={{ label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` }} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled gifts read result");
  }
}

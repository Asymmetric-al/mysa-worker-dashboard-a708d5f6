/** `/support/gifts` — the received-support ledger (AAP 0.9.1, 0.6.4). **What this file is.** Composition, nothing else. */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import GiftsLedger from "@/features/support/components/gifts-ledger";
import { assertNever } from "@/lib/result";
import { reads, type ReadEnvelope } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** The bounded filter set the gifts read accepts, read from the read's own first parameter. */
type GiftsQueryInput = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;

/** The period a support read accepts: a preset, two calendar days, or a calendar year. */
type GiftsPeriodInput = GiftsQueryInput["period"];

/** The attribution a support read accepts. */
type GiftsPartnerInput = GiftsQueryInput["partner"];

/** The page window a support read accepts. */
type GiftsPageInput = NonNullable<GiftsQueryInput["page"]>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Gifts";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** The interface locale amounts and counts are formatted in. */
const INTERFACE_LOCALE = "en-GB";

/** This ledger's own address, and the overview one level above it. */
const GIFTS_HREF = "/support/gifts";

const SUPPORT_HREF = "/support";

/** The page window the service documents (AAP 0.8.7): 50 rows, or the 200 cap when the reader asks for it, at a 0-based page index. */
const PAGE_SIZE_DEFAULT = 50;

const PAGE_SIZE_CAP = 200;

const FIRST_PAGE = 0;

/** A page size states a count of rows, so zero is not a size and leaves the default in force. */
const NO_ROWS = 0;

/** The search parameters this route reads, named once. Anything else in the URL is an unrelated key. */
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

/** This page's own wording. */
const PAGE_COPY = {
  title: "Received gifts",
  denied: {
    title: "The gifts ledger is not available in this context",
    body: "This session may not read received support in the context it is working in, so no row, count, " + "total or coverage is stated here — a refusal is not an empty ledger. Another context, if this " + "session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "The gifts ledger could not be read" },
  refused: { title: "The gifts ledger's request was refused" },
  retry: "Try this read again",
  overview: "Read the support overview",
} as const;

// ---------------------------------------------------------------------------------------------
// The URL's query state, translated into the read's vocabulary
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no list is treated as a facet decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/** One parameter as the text it states: a blank parameter states no filter at all. */
function textOf(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A whole count from a parameter, or `undefined` when the parameter is absent, malformed or beyond exact integers. */
function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** An amount bound from a parameter, exactly as stated: no rounding, and no conversion between major and minor units. */
function minorUnitsOf(value: string | undefined): number | undefined {
  if (value === undefined || !SIGNED_INTEGER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The period the URL states: two calendar days when both ends are stated, otherwise the preset it names, otherwise nothing — an unstated or half-stated period is the read's own default, never one … */
function periodOf(searchParams: SearchParams): GiftsPeriodInput {
  const from = textOf(paramOf(searchParams, PARAM.from));
  const to = textOf(paramOf(searchParams, PARAM.to));
  if (from !== undefined && to !== undefined) {
    return { kind: "explicit", from, to };
  }
  const preset = textOf(paramOf(searchParams, PARAM.period));
  return preset === undefined ? undefined : { kind: "preset", preset };
}

/** The amount range the URL states, in the minor units of the one currency it names. */
function amountRangeOf(searchParams: SearchParams, currency: string | undefined): GiftsQueryInput["amountRange"] {
  if (currency === undefined) {
    return undefined;
  }
  const minMinor = minorUnitsOf(paramOf(searchParams, PARAM.amountMin));
  const maxMinor = minorUnitsOf(paramOf(searchParams, PARAM.amountMax));
  if (minMinor === undefined || maxMinor === undefined) {
    return undefined;
  }
  return { minMinor, maxMinor };
}

/** The attribution the URL states: a partner's own reference, anonymous support, source support with no attribution, or none at all. */
function partnerOf(searchParams: SearchParams): GiftsPartnerInput {
  const recipient = textOf(paramOf(searchParams, PARAM.recipient));
  switch (recipient) {
    case RECIPIENT_PARTNER: {
      const partnerId = textOf(paramOf(searchParams, PARAM.partnerId));
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

/** The sort the URL states: a field together with one of the two admitted directions. */
function sortOf(searchParams: SearchParams): GiftsQueryInput["sort"] {
  const field = textOf(paramOf(searchParams, PARAM.sortField));
  const direction = textOf(paramOf(searchParams, PARAM.sortDirection));
  if (field === undefined || (direction !== SORT_ASCENDING && direction !== SORT_DESCENDING)) {
    return undefined;
  }
  return { field, direction };
}

/** The page window, admitted exactly as the ledger admits it before asking the browser handler: any stated size reads at the default or the cap, and an unreadable index leaves the first page in force … */
function pageWindowOf(searchParams: SearchParams): GiftsPageInput {
  const stated = wholeNumberOf(paramOf(searchParams, PARAM.pageSize));
  const size = stated === undefined || stated <= NO_ROWS ? PAGE_SIZE_DEFAULT : stated >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
  return { index: wholeNumberOf(paramOf(searchParams, PARAM.page)) ?? FIRST_PAGE, size };
}

/** The read's query, built from the URL and from nothing else. */
function giftQueryOf(searchParams: SearchParams): GiftsQueryInput {
  const currency = textOf(paramOf(searchParams, PARAM.currency));
  const period = periodOf(searchParams);
  const amountRange = amountRangeOf(searchParams, currency);
  const partner = partnerOf(searchParams);
  const sort = sortOf(searchParams);
  const designation = textOf(paramOf(searchParams, PARAM.designation));
  const method = textOf(paramOf(searchParams, PARAM.method));
  const search = textOf(paramOf(searchParams, PARAM.search));
  return {
    ...(period === undefined ? {} : { period }),
    ...(currency === undefined ? {} : { currency }),
    ...(amountRange === undefined ? {} : { amountRange }),
    ...(designation === undefined ? {} : { designation }),
    ...(partner === undefined ? {} : { partner }),
    ...(method === undefined ? {} : { method }),
    ...(search === undefined ? {} : { search }),
    ...(sort === undefined ? {} : { sort }),
    page: pageWindowOf(searchParams),
  };
}

/** This same ledger with the query the URL states, so a retry re-reads the view the reader was in rather than dropping the filters they set. */
function ledgerHrefOf(searchParams: SearchParams): string {
  const stated = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) {
      stated.append(name, first);
    }
  }
  const query = stated.toString();
  return query === "" ? GIFTS_HREF : `${GIFTS_HREF}?${query}`;
}

/** The seed in the form the browser handler would state it. */
function wireFormOf(envelope: ReadEnvelope<unknown>): ReadEnvelope<unknown> {
  const wire: unknown = JSON.parse(JSON.stringify(envelope));
  return wire as ReadEnvelope<unknown>;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** What this route receives: Next 16 hands `searchParams` as a promise, resolved before any read. */
export interface GiftsLedgerPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/** The Gifts ledger: one whole-query read over the filter set the URL states, rendered by the family's own ledger body, with an honest notice in place of the ledger when the read refuses or cannot … */
export default async function GiftsLedgerPage({ searchParams }: GiftsLedgerPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const result = await reads.support.readGifts(giftQueryOf(stated));
  switch (result.kind) {
    case "envelope": {
      const { envelope } = result;
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          {/* The one h1 on this page: the ledger's own filter toolbar, table and snapshot statement
              carry their headings below it. */}
          <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_COPY.title}</h1>
          {/* The envelope read here seeds the ledger's first read, in the wire's own encoding, so the
              browser neither requests figures this render already holds nor receives a value it could
              not have fetched itself. The table keeps the query state the URL states. */}
          <GiftsLedger scope={envelope.scope} locale={INTERFACE_LOCALE} initialEnvelope={wireFormOf(envelope)} />
        </div>
      );
    }
    case "denied":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          {/* A refusal states no count, title, existence flag or size: the closed reason code is the
              whole answer, and the overview is the only recovery this route can offer. */}
          <StateNotice kind="denied" headingLevel={1} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} action={{ label: PAGE_COPY.overview, href: SUPPORT_HREF }} />
        </div>
      );
    case "unavailable":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          {/* The source did not answer, so the ledger is reported as unavailable and never as an empty
              one: the notice states the source, the service's own retry guidance, and a retry that
              re-requests this same filtered view. */}
          <StateNotice kind="unavailable" headingLevel={1} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.retry, href: ledgerHrefOf(stated) }} />
        </div>
      );
    case "refused":
      // The filters this address states are not ones the read admits. This route calls the read
      // directly, so the arm is stated here rather than thrown, and the notice says the request was
      // refused rather than the gifts source failing.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refused.title} action={{ label: PAGE_COPY.retry, href: ledgerHrefOf(stated) }} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled gifts read result");
  }
}

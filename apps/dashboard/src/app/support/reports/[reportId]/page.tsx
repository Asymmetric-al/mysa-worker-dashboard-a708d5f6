/**
 * `/support/reports/[reportId]` — route composition for the four fixed Support reports (AAP 0.9.1, 0.6.4):
 * it reads the address, performs the one authorised report read, and renders the one report frame.
 *
 * No financial value is computed, formatted or rounded here. The summary, the chart series, the table
 * rows, the drill-down, the CSV and the printed page are all produced from the single `ReportResult`
 * that one `reads.support.readReport` call returns, which is what holds the six artifacts of a query in
 * agreement. `asOf`, the coverage and the query the figures were computed from are taken from that
 * answer rather than restated, and each non-envelope answer is stated as itself — never as an empty
 * report, a zero, or a report substituted for the one the address names.
 */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import ReportFrame from "@/features/support/components/report-frame";
import { REPORT_CATALOG, REPORT_ORDER, isReportId, reportHref, reportTitle, type ReportId } from "@/features/support/report-catalog";
import { assertNever } from "@/lib/result";
import { reads, type ReadEnvelope } from "@/modules/data-service";
import type { ReportQuery } from "@/modules/support/report";
import { AMOUNT_RANGE_CURRENCY_MESSAGE } from "../../../api/support/query";

/** What `readReport` answers with: an envelope, a denial, an outage, or a refusal of the request itself. */
type ReportReadResult = Awaited<ReturnType<typeof reads.support.readReport>>;

/** The bounded filter set the report read accepts, taken from the read's own second parameter. */
type ReportFilters = NonNullable<Parameters<typeof reads.support.readReport>[1]>;

/** The refusal arm, narrowed once so the notice states the read's own field messages. */
type ReportRefusal = Extract<ReportReadResult, { readonly kind: "refused" }>["refused"];

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Props of {@link SupportReportPage}. */
export interface SupportReportPageProps {
  readonly params: Promise<{ reportId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The read resolves the session, the context and the scenario instant per request, so nothing here is cached. */
export const dynamic = "force-dynamic";

/** The interface locale the frame formats amounts and counts in. */
const INTERFACE_LOCALE = "en-GB";

/** The overview above these reports, and the one recovery destination every notice on this route offers. */
const SUPPORT_HREF = "/support";

/** The id the valid-report list is labelled by, stated once so the heading and the list agree. */
const REPORT_LIST_ID = "support-report-choices";

/**
 * The search parameters this route reads, named once. Any other name in the address is not part of a report's
 * query. The filter set is the one the gifts ledger states, in the same names, so the query a worker
 * investigated on that ledger can be opened, exported and printed here without being restated.
 */
const PARAM = {
  period: "period",
  from: "from",
  to: "to",
  year: "year",
  currency: "currency",
  amountMin: "amountMin",
  amountMax: "amountMax",
  designation: "designation",
  search: "search",
  recipient: "recipient",
  partnerId: "partnerId",
  sortField: "sortField",
  sortDirection: "sortDirection",
  page: "page",
  pageSize: "pageSize",
} as const;

/** The three attributions a report may be narrowed to; a partner attribution additionally names its record. */
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";

/** A calendar year as an address states it: digits only, so no sign, fraction or exponent reaches the read. */
const WHOLE_YEAR = /^[0-9]{1,4}$/u;

/** A page index or a page size as an address states it: a whole count of pages or rows, never a sign and never a fraction. */
const WHOLE_COUNT = /^[0-9]{1,9}$/u;

/** An amount bound as an address states it: a whole count of minor units, which may be a correction and so may be negative. */
const AMOUNT_BOUND = /^-?[0-9]{1,16}$/u;

/** This route's own wording for the states that are not a report. */
const PAGE_COPY = {
  deniedTitle: "This report is not available in this context",
  deniedBody: "This session may not read received support in the context it is working in, so no figure, count, " + "period or coverage is stated here — a refusal is not an empty report. Another context, if this " + "session holds one, can be chosen from the shell.",
  unavailableTitle: "This report could not be read",
  refusedTitle: "This report's request was refused",
  retry: "Retry this read",
  unknownTitle: "That report is not one of the four",
  unknownBody: "This application reports received support in four fixed ways, and this address names none of " + "them. No other report is computed and none is substituted for it, because a report that looks " + "like the one you asked for is worse than a report you know is different.",
  unknownAction: "Open the support overview",
  listHeading: "The four reports",
  amountRangeNeedsBoth: "State both bounds of an amount range: one bound on its own states no range, and no report is computed from half of one.",
  amountBound: "State an amount bound as a whole number of the selected currency's minor units. A bound that is not one is refused rather than rounded, because rounding would change which rows match.",
  pageIndex: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
} as const;

/** One problem an address states that stops this route reading a report it could state honestly: the field the reader corrects, and what to correct. */
interface AddressProblem {
  readonly field: string;
  readonly message: string;
}

/** One value of a repeated search key: the same key may arrive more than once, and a list is never read as a series of filter decisions. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** One search parameter as the address states it, passed on exactly as written: blankness and validity are the read's to judge, and nothing is repaired here. */
function statedText(search: SearchParams, name: string): string | undefined {
  return firstValue(search[name]);
}

/** The year the address states, in the form the read declares. A value that is not a whole year states none rather than a repaired one, and the report then covers the period the read documents for it. */
function statedYear(search: SearchParams): number | undefined {
  const stated = statedText(search, PARAM.year);
  if (stated === undefined || !WHOLE_YEAR.test(stated)) {
    return undefined;
  }
  return Number(stated);
}

/** The period the address states: two calendar days when both ends are named, otherwise the year it names, otherwise the preset it names, and nothing when it names none. */
function periodOf(search: SearchParams): ReportFilters["period"] {
  const from = statedText(search, PARAM.from);
  const to = statedText(search, PARAM.to);
  if (from !== undefined && to !== undefined) {
    return { kind: "explicit", from, to };
  }
  const year = statedYear(search);
  if (year !== undefined) {
    return { kind: "year", year };
  }
  const preset = statedText(search, PARAM.period);
  return preset === undefined ? undefined : { kind: "preset", preset };
}

/** The attribution the address narrows to, in the read's own three members. A partner attribution states its reference as written, and an empty one is left for the read to refuse. */
function partnerOf(search: SearchParams): ReportFilters["partner"] {
  switch (statedText(search, PARAM.recipient)) {
    case RECIPIENT_PARTNER:
      return { kind: "partner", partnerId: statedText(search, PARAM.partnerId) ?? "" };
    case RECIPIENT_ANONYMOUS:
      return { kind: "anonymous" };
    case RECIPIENT_UNRESOLVED:
      return { kind: "unresolved" };
    default:
      return undefined;
  }
}

/** The sort the address states: both members are passed as written, so a half-stated sort is refused by the read rather than silently completed. */
function sortOf(search: SearchParams): ReportFilters["sort"] {
  const field = statedText(search, PARAM.sortField);
  const direction = statedText(search, PARAM.sortDirection);
  if (field === undefined && direction === undefined) {
    return undefined;
  }
  return { field, direction };
}

/** A whole count of minor units as the address states one, or nothing when it states a value that is not one: no bound is repaired into a number it never was. */
function statedAmount(stated: string): number | undefined {
  if (!AMOUNT_BOUND.test(stated)) {
    return undefined;
  }
  const value = Number(stated);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * The amount range the address states, in the minor units of the one currency it selects. The facet compares one
 * currency's amounts (AAP 0.8.1), so a range stated with no currency, half a range, or a bound that is not a whole
 * number of minor units is stated as the problem to correct: the report is not read, because neither the screen nor
 * the file it exports may present an unfiltered result as the filtered query the address states.
 */
function amountRangeOf(search: SearchParams, problems: AddressProblem[]): ReportFilters["amountRange"] | undefined {
  const min = statedText(search, PARAM.amountMin);
  const max = statedText(search, PARAM.amountMax);
  if (min === undefined && max === undefined) {
    return undefined;
  }
  if (min === undefined || max === undefined) {
    problems.push({ field: min === undefined ? PARAM.amountMax : PARAM.amountMin, message: PAGE_COPY.amountRangeNeedsBoth });
    return undefined;
  }
  const minMinor = statedAmount(min);
  const maxMinor = statedAmount(max);
  if (minMinor === undefined || maxMinor === undefined) {
    const field = minMinor === undefined ? PARAM.amountMin : PARAM.amountMax;
    problems.push({ field, message: PAGE_COPY.amountBound });
    return undefined;
  }
  const currency = statedText(search, PARAM.currency);
  if (currency === undefined || currency.trim() === "") {
    problems.push({ field: PARAM.amountMin, message: AMOUNT_RANGE_CURRENCY_MESSAGE });
    return undefined;
  }
  return { minMinor, maxMinor };
}

/** The page window the address states: a whole page index counted from zero, and the row count it holds, which travels with it because a size with no page states no window. */
function pageWindowOf(search: SearchParams, problems: AddressProblem[]): ReportFilters["page"] {
  const stated = statedText(search, PARAM.page);
  if (stated === undefined) {
    return undefined;
  }
  if (!WHOLE_COUNT.test(stated)) {
    problems.push({ field: PARAM.page, message: PAGE_COPY.pageIndex });
    return undefined;
  }
  const index = Number(stated);
  const statedSize = statedText(search, PARAM.pageSize);
  if (statedSize === undefined) {
    return { index };
  }
  if (!WHOLE_COUNT.test(statedSize)) {
    problems.push({ field: PARAM.pageSize, message: PAGE_COPY.pageSize });
    return undefined;
  }
  return { index, size: Number(statedSize) };
}

/**
 * The filter set the read is asked for, built from the address and from nothing else. The bounded filter set is the
 * one the gifts ledger states — period, currency, amount range within that currency, attribution, designation,
 * search, sort and the page window — so the query a worker investigated there is the query this route reads, states
 * and exports. Nothing an address states and this route cannot apply is dropped silently: it is stated as a problem.
 */
function filtersOf(search: SearchParams, problems: AddressProblem[]): ReportFilters {
  const period = periodOf(search);
  const partner = partnerOf(search);
  const sort = sortOf(search);
  const currency = statedText(search, PARAM.currency);
  const amountRange = amountRangeOf(search, problems);
  const page = pageWindowOf(search, problems);
  const designation = statedText(search, PARAM.designation);
  const searchText = statedText(search, PARAM.search);
  return {
    ...(period === undefined ? {} : { period }),
    ...(currency === undefined ? {} : { currency }),
    ...(amountRange === undefined ? {} : { amountRange }),
    ...(designation === undefined ? {} : { designation }),
    ...(partner === undefined ? {} : { partner }),
    ...(searchText === undefined ? {} : { search: searchText }),
    ...(sort === undefined ? {} : { sort }),
    ...(page === undefined ? {} : { page }),
  };
}

/** This same report with the query the address states, so a retry re-reads the view the reader was in rather than dropping the filters they set. */
function addressOf(reportId: ReportId, search: SearchParams): string {
  const stated = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    const first = firstValue(value);
    if (first !== undefined) {
      stated.append(name, first);
    }
  }
  const query = stated.toString();
  const path = reportHref(reportId);
  return query === "" ? path : `${path}?${query}`;
}

/** The refusal's own field messages, stated so a reader is told which input the report does not admit. A server route cannot call the browser-side form aggregate, so the messages are joined here and none is added. */
function refusalDescription(refused: ReportRefusal): string | undefined {
  const stated = Object.entries(refused.fields)
    .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
    .join(" ");
  return stated === "" ? undefined : stated;
}

/**
 * The wire form of a value read on the server: the JSON the browser also receives. A civil date crosses
 * the boundary as its own text, and the frame identifies a request by its canonical JSON, so both the
 * seeded envelope and the query behind it are handed on in the encoding a client component can hold.
 */
function wireFormOf<T>(value: unknown): T {
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return wire as T;
}

/** The in-shell state an address that names no report gets: the four reports it could name, and the way back to the overview. It is deliberately not the framework's 404, because that renders outside the shell and would drop the Development-data label this application must keep visible on every surface. */
function UnknownReportNotice(): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <StateNotice kind="empty" headingLevel={1} title={PAGE_COPY.unknownTitle} description={PAGE_COPY.unknownBody} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
      <section aria-labelledby={REPORT_LIST_ID} className="flex min-w-0 flex-col gap-2">
        <h2 id={REPORT_LIST_ID} className="text-base font-semibold text-pretty">
          {PAGE_COPY.listHeading}
        </h2>
        <ul className="flex min-w-0 flex-col gap-1">
          {REPORT_ORDER.map((id) => (
            <li key={id}>
              <a href={reportHref(id)} className="text-sm underline underline-offset-4">
                <bdi>{reportTitle(id)}</bdi>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The problems an address states, in the wording this route gives them, so a reader is told which search parameter to correct and why. */
function addressProblemsDescription(problems: readonly AddressProblem[]): string {
  return problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
}

/**
 * One of the four fixed reports, read once and rendered by the frame the family shares.
 */
export default async function SupportReportPage({ params, searchParams }: SupportReportPageProps): Promise<ReactElement> {
  const { reportId } = await params;
  const stated = await searchParams;
  if (!isReportId(reportId)) {
    // An address that names no report of the four gets the honest not-found state and no read at all: no
    // report is substituted, and nothing is recorded in place of the one that was asked for.
    return <UnknownReportNotice />;
  }
  // A filter the address states and this route cannot apply is stated before any read: a report computed
  // without it would be presented — on the screen, in the CSV and on the printed page — as the filtered
  // result the address asked for, which is the one thing a financial surface must never do.
  const problems: AddressProblem[] = [];
  const filters = filtersOf(stated, problems);
  if (problems.length > 0) {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refusedTitle} description={addressProblemsDescription(problems)} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
      </div>
    );
  }
  const result = await reads.support.readReport(REPORT_CATALOG[reportId].queryId, filters);
  switch (result.kind) {
    case "envelope": {
      const { envelope } = result;
      return <ReportFrame scope={envelope.scope} reportId={reportId} query={wireFormOf<ReportQuery>(envelope.data.snapshot.query)} initialEnvelope={wireFormOf<ReadEnvelope<unknown>>(envelope)} locale={INTERFACE_LOCALE} />;
    }
    case "denied":
      // No figure, count, period, coverage or size is stated: the closed reason code is the whole answer,
      // so the notice reads the same whether or not a report exists in the scope this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="denied" headingLevel={1} title={PAGE_COPY.deniedTitle} description={PAGE_COPY.deniedBody} reasonCode={result.denied.reasonCode} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
        </div>
      );
    case "unavailable":
      // The source did not answer, so this is an outage and never an empty report or a zero: the notice
      // names the source, states the service's own guidance, and offers the same filtered view again.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={PAGE_COPY.unavailableTitle} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.retry, href: addressOf(reportId, stated) }} />
        </div>
      );
    case "refused":
      // The filter set this address states is not one the read admits. This route calls the read directly,
      // so the arm is stated here rather than thrown, with the read's own field messages and no partial report.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refusedTitle} description={refusalDescription(result.refused)} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled report read result");
  }
}

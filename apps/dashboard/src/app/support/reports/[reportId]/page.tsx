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

/** The search parameters this route reads, named once. Any other name in the address is not part of a report's query. */
const PARAM = { period: "period", from: "from", to: "to", year: "year", currency: "currency", designation: "designation", search: "search", recipient: "recipient", partnerId: "partnerId", sortField: "sortField", sortDirection: "sortDirection" } as const;

/** The three attributions a report may be narrowed to; a partner attribution additionally names its record. */
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";

/** A calendar year as an address states it: digits only, so no sign, fraction or exponent reaches the read. */
const WHOLE_YEAR = /^[0-9]{1,4}$/u;

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
} as const;

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

/**
 * The filter set the read is asked for, built from the address and from nothing else. No page window is
 * stated: the four fixed reports carry no paging control, so the read serves the document's default of
 * 50 rows and its 200-row cap rather than a window this route invented.
 */
function filtersOf(search: SearchParams): ReportFilters {
  const period = periodOf(search);
  const partner = partnerOf(search);
  const sort = sortOf(search);
  const currency = statedText(search, PARAM.currency);
  const designation = statedText(search, PARAM.designation);
  const searchText = statedText(search, PARAM.search);
  return { ...(period === undefined ? {} : { period }), ...(currency === undefined ? {} : { currency }), ...(designation === undefined ? {} : { designation }), ...(partner === undefined ? {} : { partner }), ...(searchText === undefined ? {} : { search: searchText }), ...(sort === undefined ? {} : { sort }) };
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

/** One of the four fixed reports, read once and rendered by the frame the family shares. */
export default async function SupportReportPage({ params, searchParams }: SupportReportPageProps): Promise<ReactElement> {
  const { reportId } = await params;
  const stated = await searchParams;
  if (!isReportId(reportId)) {
    // An address that names no report of the four gets the honest not-found state and no read at all: no
    // report is substituted, and nothing is recorded in place of the one that was asked for.
    return <UnknownReportNotice />;
  }
  const result = await reads.support.readReport(REPORT_CATALOG[reportId].queryId, filtersOf(stated));
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

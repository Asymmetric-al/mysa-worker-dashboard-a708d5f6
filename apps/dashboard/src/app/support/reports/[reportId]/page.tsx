import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import ReportFrame from "@/features/support/components/report-frame";
import { REPORT_CATALOG, REPORT_ORDER, isReportId, reportHref, reportTitle, type ReportId } from "@/features/support/report-catalog";
import { reads, type ReadEnvelope } from "@/modules/data-service";
import { PageColumn, ReadNotices, firstValueOf, searchSuffixOf, wireFormOf } from "../../../page-frame";
import type { ReportQuery } from "@/modules/support/report";
import { unadmittedSearchParameterMessage } from "../../../api/search";
import { AMOUNT_RANGE_CURRENCY_MESSAGE } from "../../../api/support/query";
type ReportReadResult = Awaited<ReturnType<typeof reads.support.readReport>>;
type ReportFilters = NonNullable<Parameters<typeof reads.support.readReport>[1]>;
type ReportRefusal = Extract<ReportReadResult, { readonly kind: "refused" }>["refused"];
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
export const dynamic = "force-dynamic";
/**
 * The title of the report this address names, taken from the static catalogue rather than from any record, so a
 * report that cannot be read still titles the tab with its family word and an address naming no report says
 * "Report" instead of enumerating one.
 */
export async function generateMetadata({ params }: { readonly params: Promise<{ readonly reportId: string }> }): Promise<Metadata> {
  const { reportId } = await params;
  return { title: isReportId(reportId) ? reportTitle(reportId) : "Report" };
}
const SUPPORT_HREF = "/support";
const REPORT_LIST_ID = "support-report-choices";
/** The search parameters this route reads, named once: the filter set is the one the gifts ledger states, in the same names, so the query a worker investigated on that ledger can be opened, exported and printed here without being restated. `method` is named because the ledger states it, and is refused with its own reason below rather than applied, because the received-support projection carries no giving-method or classification field. Any other name in the address is refused by name rather than ignored, in the one wording the shared `app/api/search.ts` grammar owns for it: a name this grammar does not declare is not part of a report's query, and a report read while a stated name was dropped would be presented as a narrower result than it is. */
const PARAM = {
  period: "period",
  from: "from",
  to: "to",
  year: "year",
  currency: "currency",
  amountMin: "amountMin",
  amountMax: "amountMax",
  designation: "designation",
  method: "method",
  search: "search",
  recipient: "recipient",
  partnerId: "partnerId",
  sortField: "sortField",
  sortDirection: "sortDirection",
  page: "page",
  pageSize: "pageSize",
} as const;
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";
const WHOLE_YEAR = /^[0-9]{1,4}$/u;
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
  methodNotApplicable:
    "This report's projection carries no giving-method or classification field, so a method filter cannot be applied to it. Remove the method from the address: a report read without it would be presented, on the screen, in the CSV and on the printed page, as the filtered result the address stated, which is the one thing a financial surface must never do.",
  pageIndex: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
} as const;
/** One problem an address states that stops this route reading a report it could state honestly: the field the reader corrects, and what to correct. */
interface AddressProblem {
  readonly field: string;
  readonly message: string;
}
const statedText = (search: SearchParams, name: string): string | undefined => firstValueOf(search[name]);
function statedYear(search: SearchParams): number | undefined {
  const stated = statedText(search, PARAM.year);
  if (stated === undefined || !WHOLE_YEAR.test(stated)) return undefined;
  return Number(stated);
}
function periodOf(search: SearchParams): ReportFilters["period"] {
  const from = statedText(search, PARAM.from);
  const to = statedText(search, PARAM.to);
  if (from !== undefined && to !== undefined) return { kind: "explicit", from, to };
  const year = statedYear(search);
  if (year !== undefined) return { kind: "year", year };
  const preset = statedText(search, PARAM.period);
  return preset === undefined ? undefined : { kind: "preset", preset };
}
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
function sortOf(search: SearchParams): ReportFilters["sort"] {
  const field = statedText(search, PARAM.sortField);
  const direction = statedText(search, PARAM.sortDirection);
  if (field === undefined && direction === undefined) return undefined;
  return { field, direction };
}
/** A page index or a page size as an address states it: a whole count of pages or rows, never a sign and never a fraction. */
const WHOLE_COUNT = /^[0-9]{1,9}$/u;
/** An amount bound as an address states it: a whole count of minor units, which may be a correction and so may be negative. */
const AMOUNT_BOUND = /^-?[0-9]{1,16}$/u;
/** A whole count of minor units as the address states one, or nothing when it states a value that is not one: no bound is repaired into a number it never was. */
function statedAmount(stated: string): number | undefined {
  if (!AMOUNT_BOUND.test(stated)) return undefined;
  const value = Number(stated);
  return Number.isSafeInteger(value) ? value : undefined;
}
/** The amount range the address states, in the minor units of the one currency it selects. The facet compares one currency's amounts (AAP 0.8.1), so a range stated with no currency, half a range, or a bound that is not a whole number of minor units is stated as the problem to correct: the report is not read, because neither the screen nor the file it exports may present an unfiltered result as the filtered query the address states. */
function amountRangeOf(search: SearchParams, problems: AddressProblem[]): ReportFilters["amountRange"] | undefined {
  const min = statedText(search, PARAM.amountMin);
  const max = statedText(search, PARAM.amountMax);
  if (min === undefined && max === undefined) return undefined;
  if (min === undefined || max === undefined) {
    problems.push({ field: min === undefined ? PARAM.amountMax : PARAM.amountMin, message: PAGE_COPY.amountRangeNeedsBoth });
    return undefined;
  }
  const minMinor = statedAmount(min);
  const maxMinor = statedAmount(max);
  if (minMinor === undefined || maxMinor === undefined) {
    problems.push({ field: minMinor === undefined ? PARAM.amountMin : PARAM.amountMax, message: PAGE_COPY.amountBound });
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
  if (stated === undefined) return undefined;
  if (!WHOLE_COUNT.test(stated)) {
    problems.push({ field: PARAM.page, message: PAGE_COPY.pageIndex });
    return undefined;
  }
  const index = Number(stated);
  const statedSize = statedText(search, PARAM.pageSize);
  if (statedSize === undefined) return { index };
  if (!WHOLE_COUNT.test(statedSize)) {
    problems.push({ field: PARAM.pageSize, message: PAGE_COPY.pageSize });
    return undefined;
  }
  return { index, size: Number(statedSize) };
}
/** A method filter the address states is refused here rather than forwarded to the read: the received-support projection carries no giving-method or classification field, so the report engine cannot apply it, and a report computed without it would be presented as the filtered result the address asked for. */
function methodProblemOf(search: SearchParams, problems: AddressProblem[]): void {
  if (statedText(search, PARAM.method) === undefined) return;
  problems.push({ field: PARAM.method, message: PAGE_COPY.methodNotApplicable });
}
/** The names the address states that this grammar does not admit, each refused by name in the wording the shared search grammar owns (`app/api/search.ts`): the address is answered with the name to remove rather than with a report read while one of its stated names was dropped. */
function unadmittedParametersOf(search: SearchParams): AddressProblem[] {
  const admitted = new Set<string>(Object.values(PARAM));
  return Object.keys(search)
    .filter((name) => !admitted.has(name))
    .map((name): AddressProblem => ({ field: name, message: unadmittedSearchParameterMessage(name) }));
}
function filtersOf(search: SearchParams, problems: AddressProblem[]): ReportFilters {
  methodProblemOf(search, problems);
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
const addressOf = (reportId: ReportId, search: SearchParams): string => `${reportHref(reportId)}${searchSuffixOf(search)}`;
function refusalDescription(refused: ReportRefusal): string | undefined {
  const stated = Object.entries(refused.fields)
    .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
    .join(" ");
  return stated === "" ? undefined : stated;
}
const UnknownReportNotice = (): ReactElement => (
  <div className="flex min-w-0 flex-col gap-6 text-start">
    <StateNotice kind="empty" headingLevel={1} title={PAGE_COPY.unknownTitle} description={PAGE_COPY.unknownBody} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
    <section aria-labelledby={REPORT_LIST_ID} className="flex min-w-0 flex-col gap-2">
      <h2 id={REPORT_LIST_ID} className="type-section-title text-pretty">
        {PAGE_COPY.listHeading}
      </h2>
      <ul className="flex min-w-0 flex-col gap-1">
        {REPORT_ORDER.map((id) => (
          <li key={id}>
            <a href={reportHref(id)} className="inline-link text-sm">
              <bdi>{reportTitle(id)}</bdi>
            </a>
          </li>
        ))}
      </ul>
    </section>
  </div>
);
/** One of the four fixed reports, read once and rendered by the frame the family shares. */
export default async function SupportReportPage({ params, searchParams }: { readonly params: Promise<{ reportId: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const { reportId } = await params;
  const stated = await searchParams;
  if (!isReportId(reportId)) return <UnknownReportNotice />;
  // A filter the address states and this route cannot apply is stated before any read: a report computed without it would be presented — on the screen, in the CSV and on the printed page — as the filtered result the address asked for, which is the one thing a financial surface must never do.
  const problems: AddressProblem[] = unadmittedParametersOf(stated);
  const filters = filtersOf(stated, problems);
  if (problems.length > 0) {
    return (
      <PageColumn gap={4}>
        <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refusedTitle} description={problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ")} action={{ label: PAGE_COPY.unknownAction, href: SUPPORT_HREF }} />
      </PageColumn>
    );
  }
  const result = await reads.support.readReport(REPORT_CATALOG[reportId].queryId, filters);
  if (result.kind !== "envelope") {
    const refusedBody = result.kind === "refused" ? refusalDescription(result.refused) : undefined;
    return (
      <PageColumn gap={4}>
        <ReadNotices
          failure={result}
          copy={{
            headingLevel: 1,
            denied: { title: PAGE_COPY.deniedTitle, body: PAGE_COPY.deniedBody, action: { label: PAGE_COPY.unknownAction, href: SUPPORT_HREF } },
            unavailable: { title: PAGE_COPY.unavailableTitle, action: { label: PAGE_COPY.retry, href: addressOf(reportId, stated) } },
            refused: { title: PAGE_COPY.refusedTitle, body: refusedBody, action: { label: PAGE_COPY.unknownAction, href: SUPPORT_HREF } },
          }}
        />
      </PageColumn>
    );
  }
  const { envelope } = result;
  return <ReportFrame scope={envelope.scope} reportId={reportId} query={wireFormOf<ReportQuery>(envelope.data.snapshot.query)} initialEnvelope={wireFormOf<ReadEnvelope<unknown>>(envelope)} locale="en-GB" />;
}

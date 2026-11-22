/** The one server-side reader for the Support job's browser transports: the search-parameter grammar the four Support reads share, the page window `readCommitments` accepts, and the JSON body the two … */
import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import type { reads } from "@/modules/data-service";
import { REPORT_IDS, SORT_DIRECTIONS, SORT_FIELDS } from "@/modules/support/report";
/** The bounded filter set the query-shaped Support reads accept, taken from a read's own signature rather than restated: a member the service adds, renames or withdraws reaches this file by. */
export type SupportQuery = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;
/** The window `readCommitments` accepts, taken from that read's own signature. */
export type SupportPageQuery = NonNullable<Parameters<typeof reads.support.readCommitments>[0]>;
/** One of the four report identities `readReport` computes, read from its own first parameter. */
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];
/** A parsed request, or the grammar error that refused it. */
export type ParsedQuery<Query> = Result<Query, z.ZodError>;
// One search parameter, as the URL carries it
const PAGE_NUMBER = /^\d{1,9}$/u;

// An amount bound: a whole count of minor units, which may be a correction and so may be negative.
// The pattern admits every magnitude the read's own minor-unit vocabulary admits, and no more: a
// bound of 16 digits reaches the safe-integer ceiling the open-ended band states, and the value is
// taken exactly as written rather than rounded or clamped to it.
const AMOUNT_BOUND = /^-?\d{1,16}$/u;

function firstValue(search: URLSearchParams, name: string): string | undefined {
  return search.get(name) ?? undefined;
}
/** Every name the request stated, with the value it stated, so the closed grammar below decides which names a read admits instead of a fixed list of names quietly discarding the rest. */
function statedSearchValues(search: URLSearchParams): Record<string, string> {
  const stated = new Map<string, string>();
  for (const name of new Set(search.keys())) {
    const value = firstValue(search, name);
    if (value !== undefined) {
      stated.set(name, value);
    }
  }
  return Object.fromEntries(stated);
}
function wholeNumber(message: string) {
  return z
    .string()
    .regex(PAGE_NUMBER, message)
    .transform((value) => Number(value));
}
function amountBound(message: string) {
  return z
    .string()
    .regex(AMOUNT_BOUND, message)
    .refine((value) => Number.isSafeInteger(Number(value)), message)
    .transform((value) => Number(value));
}
// The ledger's search grammar
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";
const RECIPIENT_ANONYMOUS_OR_UNRESOLVED = "anonymous-or-unresolved";

/** The rule an amount range obeys wherever one is read or offered: a range compares one currency's minor units, so it applies only while a single currency is selected, and no range is ever compared across currencies. Exported so this grammar and the surface that offers the range state it in one wording rather than a second copy of the rule. */
export const AMOUNT_RANGE_CURRENCY_MESSAGE = "An amount range compares one currency's minor units, so a single currency must be selected with it: choose one currency to use the range, or remove the range, because no range is applied across currencies.";

const MESSAGES = {
  pageNumber: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
  pageSizeNeedsPage: "State the page a size applies to: a size with no page would be read as the first page or ignored, and neither is the page that was asked for.",
  commitmentId: "State the commitment as a non-empty identifier, or omit it: the identifier is compared with the rows the read reports and is never parsed into one.",
  showAdditionalTypes: "State the additional-types display choice as 1 to ask the source for additional commitment types, as 0 for the list without that choice, or omit it: no other value states a choice this read can carry.",
  amountBound: "State an amount bound as a whole number of the selected currency's minor units.",
  amountRangeNeedsBoth: "State both bounds of an amount range: a range compares the minor units of one currency, and one bound alone states no range for the read to apply.",
  periodNeedsBoth: "State both ends of the period, each as a calendar day: one day is not a range, and the ledger's figures are read over a range.",
  sortNeedsBoth: "State the sort field and its direction together: a field with no direction, or a direction with no field, orders the ledger by nothing the worker chose.",
  sortField: "A result is sorted by the gift's own date, its amount or its designation. State one of those fields.",
  sortDirection: "A sort runs ascending or descending. State asc or desc.",
  recipientUnknown: `State the attribution filter as ${RECIPIENT_PARTNER}, ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}.`,
  recipientCombined: `The ledger's combined "anonymous-or-unresolved" choice names two attributions the read selects one at a time: anonymous support and support that supplied no attribution are separate filters, so state ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}. Narrowing the pair to one member here would drop the other's rows while presenting the filter as applied.`,
  recipientNeedsPartner: "State the partner a partner attribution names: the filter narrows to one record's own reference, and a kind with no reference would narrow to nothing.",
  partnerNeedsRecipient: "State the partner attribution beside a partnerId, because a reference with no attribution named would be a filter this transport could only drop.",
} as const;

function unadmittedSearchParameterMessage(name: string): string {
  return `This read accepts no search parameter named "${name}", so remove it: a name the read does not declare is refused rather than ignored, because a read that ignored it would answer a page or a result the caller did not ask for.`;
}

/** Re-keys the grammar's single rejected-names issue onto each name it carries, so a caller is told which search parameter to remove instead of reading one message that lists several. */
function refusedSearchParameters(error: z.ZodError): z.ZodError {
  type Issue = NonNullable<ConstructorParameters<typeof z.ZodError>[0]>[number];
  const issues: Issue[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const name of issue.keys) {
        issues.push({ code: "custom", path: [...issue.path, name], message: unadmittedSearchParameterMessage(name) });
      }
    } else {
      issues.push(issue);
    }
  }
  return new z.ZodError(issues);
}
const supportSearchSchema = z
  .strictObject({
    period: z.string().optional(),
    from: z.string().min(1, MESSAGES.periodNeedsBoth).optional(),
    to: z.string().min(1, MESSAGES.periodNeedsBoth).optional(),
    currency: z.string().optional(),
    amountMin: amountBound(MESSAGES.amountBound).optional(),
    amountMax: amountBound(MESSAGES.amountBound).optional(),
    recipient: z.string().optional(),
    partnerId: z.string().optional(),
    designation: z.string().optional(),
    method: z.string().optional(),
    search: z.string().optional(),
    sortField: z.enum(SORT_FIELDS, { error: MESSAGES.sortField }).optional(),
    sortDirection: z.enum(SORT_DIRECTIONS, { error: MESSAGES.sortDirection }).optional(),
    page: wholeNumber(MESSAGES.pageNumber).optional(),
    pageSize: wholeNumber(MESSAGES.pageSize).optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) {
      context.addIssue({ code: "custom", path: ["pageSize"], message: MESSAGES.pageSizeNeedsPage });
    }
    if ((params.from === undefined) !== (params.to === undefined)) {
      context.addIssue({ code: "custom", path: ["from"], message: MESSAGES.periodNeedsBoth });
    }
    if ((params.amountMin === undefined) !== (params.amountMax === undefined)) {
      context.addIssue({ code: "custom", path: ["amountMin"], message: MESSAGES.amountRangeNeedsBoth });
    }
    // A range is scoped to the one currency it compares, so a range stated with no currency is refused at the bound the
    // caller stated instead of reaching a read that could only drop it: the read applies a range only while a single
    // currency is selected, and answering the unfiltered whole result would present a filter that was never applied.
    const rangeStated = params.amountMin !== undefined || params.amountMax !== undefined;
    const currencyBlank = params.currency === undefined || params.currency.trim() === "";
    if (rangeStated && currencyBlank) {
      if (params.amountMin !== undefined) {
        context.addIssue({ code: "custom", path: ["amountMin"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
      }
      if (params.amountMax !== undefined) {
        context.addIssue({ code: "custom", path: ["amountMax"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
      }
    }
    if ((params.sortField === undefined) !== (params.sortDirection === undefined)) {
      context.addIssue({ code: "custom", path: ["sortField"], message: MESSAGES.sortNeedsBoth });
    }
    const { recipient, partnerId } = params;
    if (recipient === undefined) {
      if (partnerId !== undefined) {
        context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.partnerNeedsRecipient });
      }
      return;
    }
    if (recipient !== RECIPIENT_PARTNER && recipient !== RECIPIENT_ANONYMOUS && recipient !== RECIPIENT_UNRESOLVED) {
      context.addIssue({ code: "custom", path: ["recipient"], message: recipient === RECIPIENT_ANONYMOUS_OR_UNRESOLVED ? MESSAGES.recipientCombined : MESSAGES.recipientUnknown });
      return;
    }
    if (recipient === RECIPIENT_PARTNER && (partnerId === undefined || partnerId.trim() === "")) {
      context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.recipientNeedsPartner });
    }
  });
type SupportSearchParams = z.output<typeof supportSearchSchema>;

function periodOf(params: SupportSearchParams): SupportQuery["period"] {
  if (params.from !== undefined && params.to !== undefined) {
    return { kind: "explicit", from: params.from, to: params.to };
  }
  if (params.period === undefined || params.period === "") {
    return undefined;
  }
  return { kind: "preset", preset: params.period };
}
function partnerOf(params: SupportSearchParams): SupportQuery["partner"] {
  switch (params.recipient) {
    case undefined:
      return undefined;
    case RECIPIENT_PARTNER:
      return params.partnerId === undefined ? undefined : { kind: "partner", partnerId: params.partnerId };
    case RECIPIENT_ANONYMOUS:
      return { kind: "anonymous" };
    case RECIPIENT_UNRESOLVED:
      return { kind: "unresolved" };
    default:
      // Unreachable: the grammar refused every other value before assembly, and the combined
      // anonymous-or-unresolved choice among them.
      return undefined;
  }
}
function amountRangeOf(params: SupportSearchParams): SupportQuery["amountRange"] {
  return params.amountMin === undefined || params.amountMax === undefined ? undefined : { minMinor: params.amountMin, maxMinor: params.amountMax };
}
function sortOf(params: SupportSearchParams): SupportQuery["sort"] {
  return params.sortField === undefined || params.sortDirection === undefined ? undefined : { field: params.sortField, direction: params.sortDirection };
}
function pageWindowOf(params: SupportSearchParams): SupportQuery["page"] {
  if (params.page === undefined) {
    return undefined;
  }
  return params.pageSize === undefined ? { index: params.page } : { index: params.page, size: params.pageSize };
}
function queryOf(params: SupportSearchParams): SupportQuery {
  const period = periodOf(params);
  const amountRange = amountRangeOf(params);
  const partner = partnerOf(params);
  const sort = sortOf(params);
  const page = pageWindowOf(params);
  return {
    ...(period === undefined ? {} : { period }),
    ...(params.currency === undefined ? {} : { currency: params.currency }),
    ...(amountRange === undefined ? {} : { amountRange }),
    ...(params.designation === undefined ? {} : { designation: params.designation }),
    ...(partner === undefined ? {} : { partner }),
    ...(params.method === undefined ? {} : { method: params.method }),
    ...(params.search === undefined ? {} : { search: params.search }),
    ...(sort === undefined ? {} : { sort }),
    ...(page === undefined ? {} : { page }),
  };
}
/** Reads a Support read's query out of the request's search parameters, refusing by name every parameter the grammar does not declare. */
export function supportQueryFromSearch(search: URLSearchParams): ParsedQuery<SupportQuery> {
  // Every name the request stated goes to the closed grammar, so the grammar decides which names this
  // read admits: a name it does not declare is refused by name, never read as if it were absent.
  const parsed = supportSearchSchema.safeParse(statedSearchValues(search));
  return parsed.success ? ok(queryOf(parsed.data)) : err(refusedSearchParameters(parsed.error));
}
// The commitments list's page window, the one commitment a detail names, and the display choice its own
// control states with every request
const FLAG_ON = "1";
const FLAG_OFF = "0";

const commitmentsSearchSchema = z
  .strictObject({
    "page.index": wholeNumber(MESSAGES.pageNumber).optional(),
    "page.size": wholeNumber(MESSAGES.pageSize).optional(),
    commitmentId: z.string().min(1, MESSAGES.commitmentId).optional(),
    // The list states this display choice on every request it makes, so both of its values are admitted
    // here and the parsed choice is forwarded to the read. The read answers it by publishing the
    // additional-types capability, with the reason it cannot change a row, in the envelope's actions:
    // the source supplies the three commitment kinds it distinguishes and no other. The choice is
    // therefore neither refused at this boundary nor silently dropped at it.
    showAdditionalTypes: z
      .enum([FLAG_ON, FLAG_OFF], { error: MESSAGES.showAdditionalTypes })
      .transform((value) => value === FLAG_ON)
      .optional(),
  })
  .superRefine((params, context) => {
    if (params["page.size"] !== undefined && params["page.index"] === undefined) {
      context.addIssue({ code: "custom", path: ["page.size"], message: MESSAGES.pageSizeNeedsPage });
    }
  });
/** Reads the commitments list's page window, the commitment a detail names and the additional-types display choice out of the request's search parameters, refusing by name every parameter the grammar does not declare. */
export function supportPageFromSearch(search: URLSearchParams): ParsedQuery<SupportPageQuery> {
  // The same closed grammar decides which names this read admits, so a parameter it does not declare is
  // refused by name rather than dropped from the page or the detail the caller asked for.
  const parsed = commitmentsSearchSchema.safeParse(statedSearchValues(search));
  if (!parsed.success) {
    return err(refusedSearchParameters(parsed.error));
  }
  const index = parsed.data["page.index"];
  const size = parsed.data["page.size"];
  const { commitmentId, showAdditionalTypes } = parsed.data;
  const narrowing: SupportPageQuery = { ...(commitmentId === undefined ? {} : { commitmentId }), ...(showAdditionalTypes === undefined ? {} : { showAdditionalTypes }) };
  if (index === undefined) {
    return ok(narrowing);
  }
  return ok({ ...narrowing, page: size === undefined ? { index } : { index, size } });
}
// The body the report and export posts carry
const BODY_MESSAGES = {
  reportId: `Name one of the four reports this application computes as query.reportId: ${REPORT_IDS.join(", ")}. No other report exists, and none is substituted for an identity this build does not compute.`,
  snapshotId: "State the request identity as a non-empty string, or omit it: it is the caller's own cache discriminator and never the snapshot the service computes.",
  period: "State the period as a preset, as two calendar days (kind: explicit, from, to), or as a calendar year; no other period is read.",
  year: "State a calendar year as a whole four-digit year.",
  currency: 'State the currency as its ISO code, or as the report query\'s own selection — { kind: "one", currency } or { kind: "all" }. Nothing else states a currency, and no code is assumed.',
  amountRange: "State both bounds of an amount range as whole minor units of the selected currency, or omit the range.",
  partner: "State the attribution as { kind: partner, partnerId }, { kind: anonymous } or { kind: unresolved }.",
  sort: "State the sort's field and direction as non-empty text: which fields are sortable and which direction is admitted belong to the report engine, and a member stated as blank orders nothing.",
  page: "State the page window's index and size as whole numbers from zero: the default size and the cap belong to the report engine.",
  timeZone: "Name the zone a period preset resolves in as a non-empty identifier, or omit it and the read uses its declared default.",
} as const;
/** The report identities are the engine's own list, so a report it computes can never be unreachable through this grammar. */
const reportIdentitySchema = z.enum(REPORT_IDS, { error: BODY_MESSAGES.reportId });

const periodBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: z.string() }),
  z.strictObject({ kind: z.literal("explicit"), from: z.string().min(1, BODY_MESSAGES.period), to: z.string().min(1, BODY_MESSAGES.period) }),
  z.strictObject({ kind: z.literal("year"), year: z.int({ error: BODY_MESSAGES.year }) }),
]);
const currencyBodySchema = z.union([z.string(), z.strictObject({ kind: z.literal("one"), currency: z.string().min(1, BODY_MESSAGES.currency) }), z.strictObject({ kind: z.literal("all") })], { error: BODY_MESSAGES.currency });
const amountRangeBodySchema = z.strictObject({ minMinor: z.int({ error: BODY_MESSAGES.amountRange }), maxMinor: z.int({ error: BODY_MESSAGES.amountRange }) });
const partnerBodySchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("partner"), partnerId: z.string().min(1, BODY_MESSAGES.partner) }), z.strictObject({ kind: z.literal("anonymous") }), z.strictObject({ kind: z.literal("unresolved") })]);
const sortBodySchema = z.strictObject({ field: z.string().min(1, BODY_MESSAGES.sort).optional(), direction: z.string().min(1, BODY_MESSAGES.sort).optional() });
const pageBodySchema = z.strictObject({ index: z.int({ error: BODY_MESSAGES.page }).optional(), size: z.int({ error: BODY_MESSAGES.page }).optional() });
const POSTED_FILTER_FIELDS = {
  period: periodBodySchema.optional(),
  currency: currencyBodySchema.optional(),
  amountRange: amountRangeBodySchema.optional(),
  designation: z.string().optional(),
  partner: partnerBodySchema.optional(),
  method: z.string().optional(),
  search: z.string().optional(),
  sort: sortBodySchema.optional(),
  page: pageBodySchema.optional(),
  timeZone: z.string().min(1, BODY_MESSAGES.timeZone).optional(),
};
const postedScopeField = z.unknown().optional();
/** The two members of a posted query the amount-range rule relates: the selection amounts are stated in, and the range stated over them. */
type PostedCurrencyAndRange = { readonly currency?: z.output<typeof currencyBodySchema>; readonly amountRange?: z.output<typeof amountRangeBodySchema> };

/** Whether a posted query names exactly one currency: the code stated as the selection itself, or the single-currency form of the report query's own selection. */
function postsOneCurrency(currency: PostedCurrencyAndRange["currency"]): boolean {
  if (currency === undefined) {
    return false;
  }
  return typeof currency === "string" ? currency.trim() !== "" : currency.kind === "one";
}
/** Refuses an amount range posted with no single currency selected, at the range's own path: a range compares one currency's minor units, so a read given an unpaired one would drop it rather than carry it into the report or the file. */
function refineAmountRangeCurrency(query: PostedCurrencyAndRange, context: z.RefinementCtx): void {
  if (query.amountRange === undefined || postsOneCurrency(query.currency)) {
    return;
  }
  context.addIssue({ code: "custom", path: ["amountRange"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
}

const snapshotIdSchema = z.string().min(1, BODY_MESSAGES.snapshotId).optional();
/** The body `POST /api/report` reads: which of the four reports, the filters it is computed under, and the caller's own request identity. */
export const reportRequestSchema = z.strictObject({ query: z.strictObject({ reportId: reportIdentitySchema, scope: postedScopeField, ...POSTED_FILTER_FIELDS }).superRefine(refineAmountRangeCurrency), snapshotId: snapshotIdSchema });
/** The body `POST /api/export` reads: the same shape, whose query needs no report identity, under the same amount-range rule so the two artifacts of a query are built from the same reading of it. */
export const exportRequestSchema = z.strictObject({ query: z.strictObject({ reportId: reportIdentitySchema.optional(), scope: postedScopeField, ...POSTED_FILTER_FIELDS }).superRefine(refineAmountRangeCurrency), snapshotId: snapshotIdSchema });
/** A posted query as the broader of the two bodies reads it. */
export type PostedQuery = z.output<typeof exportRequestSchema>["query"];

function postedCurrencyOf(posted: PostedQuery): string | undefined {
  const currency = posted.currency;
  if (currency === undefined) {
    return undefined;
  }
  if (typeof currency === "string") {
    return currency;
  }
  return currency.kind === "one" ? currency.currency : undefined;
}
/** Reduces a posted query to the bounded filter set the reads accept. */
export function supportQueryOf(posted: PostedQuery): SupportQuery {
  const currency = postedCurrencyOf(posted);
  return {
    ...(posted.period === undefined ? {} : { period: posted.period }),
    ...(currency === undefined ? {} : { currency }),
    ...(posted.amountRange === undefined ? {} : { amountRange: posted.amountRange }),
    ...(posted.designation === undefined ? {} : { designation: posted.designation }),
    ...(posted.partner === undefined ? {} : { partner: posted.partner }),
    ...(posted.method === undefined ? {} : { method: posted.method }),
    ...(posted.search === undefined ? {} : { search: posted.search }),
    ...(posted.sort === undefined ? {} : { sort: posted.sort }),
    ...(posted.page === undefined ? {} : { page: posted.page }),
    ...(posted.timeZone === undefined ? {} : { timeZone: posted.timeZone }),
  };
}

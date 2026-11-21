/**
 * The one server-side reader for the Support job's browser transports: the search-parameter grammar
 * the four Support reads share, the page window `readCommitments` accepts, and the JSON body the two
 * report-shaped posts carry.
 */
import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import type { reads } from "@/modules/data-service";
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

const AMOUNT_BOUND = /^-?\d{1,15}$/u;

function firstValue(search: URLSearchParams, name: string): string | undefined {
  return search.get(name) ?? undefined;
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
    .transform((value) => Number(value));
}
// The ledger's search grammar
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";
const RECIPIENT_ANONYMOUS_OR_UNRESOLVED = "anonymous-or-unresolved";

const MESSAGES = {
  pageNumber: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
  pageSizeNeedsPage: "State the page a size applies to: a size with no page would be read as the first page or ignored, and neither is the page that was asked for.",
  commitmentId: "State the commitment as a non-empty identifier, or omit it: the identifier is compared with the rows the read reports and is never parsed into one.",
  showAdditionalTypes:
    "The commitments read reports the three commitment kinds the source distinguishes and no additional type, so this display choice cannot change a result. State it as 0, or omit it: asking for types the read cannot report is refused rather than answered with the same rows under a choice the read did not apply.",
  amountBound: "State an amount bound as a whole number of the selected currency's minor units.",
  amountRangeNeedsBoth: "State both bounds of an amount range: a range compares the minor units of one currency, and one bound alone states no range for the read to apply.",
  periodNeedsBoth: "State both ends of the period, each as a calendar day: one day is not a range, and the ledger's figures are read over a range.",
  sortNeedsBoth: "State the sort field and its direction together: a field with no direction, or a direction with no field, orders the ledger by nothing the worker chose.",
  recipientUnknown: `State the attribution filter as ${RECIPIENT_PARTNER}, ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}.`,
  recipientCombined: `The ledger's combined "anonymous-or-unresolved" choice names two attributions the read selects one at a time: anonymous support and support that supplied no attribution are separate filters, so state ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}. Narrowing the pair to one member here would drop the other's rows while presenting the filter as applied.`,
  recipientNeedsPartner: "State the partner a partner attribution names: the filter narrows to one record's own reference, and a kind with no reference would narrow to nothing.",
  partnerNeedsRecipient: "State the partner attribution beside a partnerId, because a reference with no attribution named would be a filter this transport could only drop.",
} as const;
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
    sortField: z.string().min(1, MESSAGES.sortNeedsBoth).optional(),
    sortDirection: z.string().min(1, MESSAGES.sortNeedsBoth).optional(),
    page: wholeNumber(MESSAGES.pageNumber).optional(),
    pageSize: wholeNumber(MESSAGES.pageSize).optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) {
      context.addIssue({
        code: "custom",
        path: ["pageSize"],
        message: MESSAGES.pageSizeNeedsPage,
      });
    }
    if ((params.from === undefined) !== (params.to === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: MESSAGES.periodNeedsBoth,
      });
    }
    if ((params.amountMin === undefined) !== (params.amountMax === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["amountMin"],
        message: MESSAGES.amountRangeNeedsBoth,
      });
    }
    if ((params.sortField === undefined) !== (params.sortDirection === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["sortField"],
        message: MESSAGES.sortNeedsBoth,
      });
    }
    const { recipient, partnerId } = params;
    if (recipient === undefined) {
      if (partnerId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["partnerId"],
          message: MESSAGES.partnerNeedsRecipient,
        });
      }
      return;
    }
    if (recipient !== RECIPIENT_PARTNER && recipient !== RECIPIENT_ANONYMOUS && recipient !== RECIPIENT_UNRESOLVED) {
      context.addIssue({
        code: "custom",
        path: ["recipient"],
        message: recipient === RECIPIENT_ANONYMOUS_OR_UNRESOLVED ? MESSAGES.recipientCombined : MESSAGES.recipientUnknown,
      });
      return;
    }
    if (recipient === RECIPIENT_PARTNER && (partnerId === undefined || partnerId.trim() === "")) {
      context.addIssue({
        code: "custom",
        path: ["partnerId"],
        message: MESSAGES.recipientNeedsPartner,
      });
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
/** Reads a Support read's query out of the request's search parameters. */
export function supportQueryFromSearch(search: URLSearchParams): ParsedQuery<SupportQuery> {
  const parsed = supportSearchSchema.safeParse({
    period: firstValue(search, "period"),
    from: firstValue(search, "from"),
    to: firstValue(search, "to"),
    currency: firstValue(search, "currency"),
    amountMin: firstValue(search, "amountMin"),
    amountMax: firstValue(search, "amountMax"),
    recipient: firstValue(search, "recipient"),
    partnerId: firstValue(search, "partnerId"),
    designation: firstValue(search, "designation"),
    method: firstValue(search, "method"),
    search: firstValue(search, "search"),
    sortField: firstValue(search, "sortField"),
    sortDirection: firstValue(search, "sortDirection"),
    page: firstValue(search, "page"),
    pageSize: firstValue(search, "pageSize"),
  });
  return parsed.success ? ok(queryOf(parsed.data)) : err(parsed.error);
}
// The commitments list's page window, the one commitment a detail names, and the answer its own
// display choice states with every request
const FLAG_OFF = "0";

const commitmentsSearchSchema = z
  .strictObject({
    "page.index": wholeNumber(MESSAGES.pageNumber).optional(),
    "page.size": wholeNumber(MESSAGES.pageSize).optional(),
    commitmentId: z.string().min(1, MESSAGES.commitmentId).optional(),
    // The list states this display choice on every request it makes. The read reports the three
    // commitment kinds and no additional type, and its envelope states no capability for one, so only
    // the value that asks for nothing is admitted here: a request that asks for types the read cannot
    // produce is refused, rather than answered with the same rows under a choice it never applied.
    showAdditionalTypes: z.literal(FLAG_OFF, { error: MESSAGES.showAdditionalTypes }).optional(),
  })
  .superRefine((params, context) => {
    if (params["page.size"] !== undefined && params["page.index"] === undefined) {
      context.addIssue({
        code: "custom",
        path: ["page.size"],
        message: MESSAGES.pageSizeNeedsPage,
      });
    }
  });
/** Reads the commitments list's page window and the commitment a detail names out of the request's search parameters. */
export function supportPageFromSearch(search: URLSearchParams): ParsedQuery<SupportPageQuery> {
  const parsed = commitmentsSearchSchema.safeParse({
    "page.index": firstValue(search, "page.index"),
    "page.size": firstValue(search, "page.size"),
    commitmentId: firstValue(search, "commitmentId"),
    showAdditionalTypes: firstValue(search, "showAdditionalTypes"),
  });
  if (!parsed.success) {
    return err(parsed.error);
  }
  const index = parsed.data["page.index"];
  const size = parsed.data["page.size"];
  const { commitmentId } = parsed.data;
  const narrowing = commitmentId === undefined ? {} : { commitmentId };
  if (index === undefined) {
    return ok(narrowing);
  }
  return ok({ ...narrowing, page: size === undefined ? { index } : { index, size } });
}
// The body the report and export posts carry
const REPORT_IDENTITIES = ["received-period-and-year-to-date", "monthly-history", "partner-month-matrix", "period-comparison"] as const satisfies readonly ReportIdentity[];

const BODY_MESSAGES = {
  reportId: `Name one of the four reports this application computes as query.reportId: ${REPORT_IDENTITIES.join(", ")}. No other report exists, and none is substituted for an identity this build does not compute.`,
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
const reportIdentitySchema = z.enum(REPORT_IDENTITIES, { error: BODY_MESSAGES.reportId });

const periodBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: z.string() }),
  z.strictObject({
    kind: z.literal("explicit"),
    from: z.string().min(1, BODY_MESSAGES.period),
    to: z.string().min(1, BODY_MESSAGES.period),
  }),
  z.strictObject({ kind: z.literal("year"), year: z.int({ error: BODY_MESSAGES.year }) }),
]);
const currencyBodySchema = z.union([z.string(), z.strictObject({ kind: z.literal("one"), currency: z.string().min(1, BODY_MESSAGES.currency) }), z.strictObject({ kind: z.literal("all") })], {
  error: BODY_MESSAGES.currency,
});
const amountRangeBodySchema = z.strictObject({
  minMinor: z.int({ error: BODY_MESSAGES.amountRange }),
  maxMinor: z.int({ error: BODY_MESSAGES.amountRange }),
});
const partnerBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("partner"),
    partnerId: z.string().min(1, BODY_MESSAGES.partner),
  }),
  z.strictObject({ kind: z.literal("anonymous") }),
  z.strictObject({ kind: z.literal("unresolved") }),
]);
const sortBodySchema = z.strictObject({
  field: z.string().min(1, BODY_MESSAGES.sort).optional(),
  direction: z.string().min(1, BODY_MESSAGES.sort).optional(),
});
const pageBodySchema = z.strictObject({
  index: z.int({ error: BODY_MESSAGES.page }).optional(),
  size: z.int({ error: BODY_MESSAGES.page }).optional(),
});
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

const snapshotIdSchema = z.string().min(1, BODY_MESSAGES.snapshotId).optional();
/** The body `POST /api/report` reads: which of the four reports, the filters it is computed under, and the caller's own request identity. */
export const reportRequestSchema = z.strictObject({
  query: z.strictObject({
    reportId: reportIdentitySchema,
    scope: postedScopeField,
    ...POSTED_FILTER_FIELDS,
  }),
  snapshotId: snapshotIdSchema,
});
/** The body `POST /api/export` reads: the same shape, whose query needs no report identity. */
export const exportRequestSchema = z.strictObject({
  query: z.strictObject({
    reportId: reportIdentitySchema.optional(),
    scope: postedScopeField,
    ...POSTED_FILTER_FIELDS,
  }),
  snapshotId: snapshotIdSchema,
});
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

import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { refusedRead, type reads, type ReadResult } from "@/modules/data-service";
import { sameScope, scopeSchema, type Scope } from "@/modules/data-service/envelope";
import { REPORT_IDS, SORT_DIRECTIONS, SORT_FIELDS } from "@/modules/support/report";
import { wholePageParameter } from "../paging";
import { READ_ATTEMPT } from "../read";
import { refusedSearchParameters, statedSearchValues } from "../search";
/** The bounded filter set the query-shaped Support reads accept, taken from a read's own signature rather than restated: a member the service adds, renames or withdraws reaches this file by. */
export type SupportQuery = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;
/** The window `readCommitments` accepts, taken from that read's own signature. */
export type SupportPageQuery = NonNullable<Parameters<typeof reads.support.readCommitments>[0]>;
/** One of the four report identities `readReport` computes, read from its own first parameter. */
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];
/** A parsed request, or the grammar error that refused it. */
export type ParsedQuery<Query> = Result<Query, z.ZodError>;
const AMOUNT_BOUND = /^-?\d{1,16}$/u;
function amountBound(message: string) {
  return z
    .string()
    .regex(AMOUNT_BOUND, message)
    .refine((value) => Number.isSafeInteger(Number(value)), message)
    .transform((value) => Number(value));
}
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";
const RECIPIENT_ANONYMOUS_OR_UNRESOLVED = "anonymous-or-unresolved";
/** The rule an amount range obeys wherever one is read or offered: a range compares one currency's minor units, so it applies only while a single currency is selected, and no range is ever compared across currencies. Exported so this grammar and the surface that offers the range state it in one wording rather than a second copy of the rule. */
export const AMOUNT_RANGE_CURRENCY_MESSAGE = "An amount range compares one currency's minor units, so a single currency must be selected with it: choose one currency to use the range, or remove the range, because no range is applied across currencies.";
/** The rule an amount range obeys about its own two bounds, stated once here for every reader of one: both bounds are inclusive, so a lower bound above the upper one matches no row, and such a pair is refused at the bound the caller stated rather than answered with the unfiltered result. Exported so a surface that offers the range states the same rule in the same words instead of a second copy of them. */
export const AMOUNT_RANGE_ORDER_MESSAGE = "An amount range states its lower bound first, because both bounds are inclusive: this pair starts above where it ends, so it matches no row at all. State the lower bound below the upper one, or remove the range.";
const MESSAGES = {
  pageNumber: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
  pageSizeNeedsPage: "State the page a size applies to: a size with no page would be read as the first page or ignored, and neither is the page that was asked for.",
  commitmentId: "State the commitment as a non-empty identifier, or omit it: the identifier is compared with the rows the read reports and is never parsed into one.",
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
  record: "State the record an address names as the non-empty identifier the source states for one gift row or one gift, or omit it: the identifier is compared with the rows the read reports and is never parsed into one.",
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
    sortField: z.enum(SORT_FIELDS, { error: MESSAGES.sortField }).optional(),
    sortDirection: z.enum(SORT_DIRECTIONS, { error: MESSAGES.sortDirection }).optional(),
    page: wholePageParameter(MESSAGES.pageNumber).optional(),
    pageSize: wholePageParameter(MESSAGES.pageSize).optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) context.addIssue({ code: "custom", path: ["pageSize"], message: MESSAGES.pageSizeNeedsPage });
    if ((params.from === undefined) !== (params.to === undefined)) context.addIssue({ code: "custom", path: ["from"], message: MESSAGES.periodNeedsBoth });
    if ((params.amountMin === undefined) !== (params.amountMax === undefined)) context.addIssue({ code: "custom", path: ["amountMin"], message: MESSAGES.amountRangeNeedsBoth });
    // A range is scoped to the one currency it compares, so a range stated with no currency is refused at the bound the caller stated instead of reaching a read that could only drop it: the read applies a range only while a single currency is selected, and answering the unfiltered whole result would present a filter that was never applied.
    if ((params.amountMin !== undefined || params.amountMax !== undefined) && (params.currency === undefined || params.currency.trim() === "")) {
      if (params.amountMin !== undefined) context.addIssue({ code: "custom", path: ["amountMin"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
      if (params.amountMax !== undefined) context.addIssue({ code: "custom", path: ["amountMax"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
    }
    // A range that starts above where it ends matches no row, so it is refused at the bounds the caller stated instead of reaching a read that could only refuse it: a caller told which bound to correct can correct it, where a caller answered the whole result would read a filter that was never applied.
    if (params.amountMin !== undefined && params.amountMax !== undefined && params.amountMin > params.amountMax) {
      context.addIssue({ code: "custom", path: ["amountMin"], message: AMOUNT_RANGE_ORDER_MESSAGE });
      context.addIssue({ code: "custom", path: ["amountMax"], message: AMOUNT_RANGE_ORDER_MESSAGE });
    }
    if ((params.sortField === undefined) !== (params.sortDirection === undefined)) context.addIssue({ code: "custom", path: ["sortField"], message: MESSAGES.sortNeedsBoth });
    const { recipient, partnerId } = params;
    if (recipient === undefined) {
      if (partnerId !== undefined) context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.partnerNeedsRecipient });
      return;
    }
    if (recipient !== RECIPIENT_PARTNER && recipient !== RECIPIENT_ANONYMOUS && recipient !== RECIPIENT_UNRESOLVED) {
      context.addIssue({ code: "custom", path: ["recipient"], message: recipient === RECIPIENT_ANONYMOUS_OR_UNRESOLVED ? MESSAGES.recipientCombined : MESSAGES.recipientUnknown });
      return;
    }
    if (recipient === RECIPIENT_PARTNER && (partnerId === undefined || partnerId.trim() === "")) context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.recipientNeedsPartner });
  });
type SupportSearchParams = z.output<typeof supportSearchSchema>;
function partnerOf(params: SupportSearchParams): SupportQuery["partner"] {
  if (params.recipient === RECIPIENT_ANONYMOUS) return { kind: "anonymous" };
  if (params.recipient === RECIPIENT_UNRESOLVED) return { kind: "unresolved" };
  return params.recipient === RECIPIENT_PARTNER && params.partnerId !== undefined ? { kind: "partner", partnerId: params.partnerId } : undefined;
}
function queryOf(params: SupportSearchParams): SupportQuery {
  const period: SupportQuery["period"] = params.from !== undefined && params.to !== undefined ? { kind: "explicit", from: params.from, to: params.to } : params.period === undefined || params.period === "" ? undefined : { kind: "preset", preset: params.period };
  const amountRange: SupportQuery["amountRange"] = params.amountMin === undefined || params.amountMax === undefined ? undefined : { minMinor: params.amountMin, maxMinor: params.amountMax };
  const sort: SupportQuery["sort"] = params.sortField === undefined || params.sortDirection === undefined ? undefined : { field: params.sortField, direction: params.sortDirection };
  const page: SupportQuery["page"] = params.page === undefined ? undefined : params.pageSize === undefined ? { index: params.page } : { index: params.page, size: params.pageSize };
  const partner = partnerOf(params);
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
  const parsed = supportSearchSchema.safeParse(statedSearchValues(search));
  return parsed.success ? ok(queryOf(parsed.data)) : err(refusedSearchParameters(parsed.error));
}
const RECORD_PARAMETER = "record";
/** The member as the grammar refuses it: keyed by its own parameter name, so a blank record is refused at `record` rather than at the request. */
const recordParameter = z.object({ record: z.string().min(1, MESSAGES.record) });
/** Reads the gifts read's query: the support grammar's own parameters, plus the one record that read alone declares. The record is read here rather than in the shared grammar because the overview and the goal do not narrow to a record, and a grammar all three shared would have those reads accept a parameter they ignore. */
export function giftsQueryFromSearch(search: URLSearchParams): ParsedQuery<SupportQuery> {
  const stated = search.get(RECORD_PARAMETER); // Null, not undefined, when the request does not state it, so an address that names no record is read by the shared grammar unchanged.
  if (stated === null) return supportQueryFromSearch(search);
  const rest = new URLSearchParams(search);
  rest.delete(RECORD_PARAMETER);
  const parsed = supportQueryFromSearch(rest);
  if (!parsed.ok) return parsed;
  const record = recordParameter.safeParse({ record: stated });
  return record.success ? ok({ ...parsed.value, record: record.data.record }) : err(refusedSearchParameters(record.error));
}
const commitmentsSearchSchema = z.strictObject({ "page.index": wholePageParameter(MESSAGES.pageNumber).optional(), "page.size": wholePageParameter(MESSAGES.pageSize).optional(), commitmentId: z.string().min(1, MESSAGES.commitmentId).optional() }).superRefine((params, context) => {
  if (params["page.size"] !== undefined && params["page.index"] === undefined) context.addIssue({ code: "custom", path: ["page.size"], message: MESSAGES.pageSizeNeedsPage });
});
/** Reads the commitments list's page window and the commitment a detail names out of the request's search parameters, refusing by name every parameter the grammar does not declare. */
export function supportPageFromSearch(search: URLSearchParams): ParsedQuery<SupportPageQuery> {
  const parsed = commitmentsSearchSchema.safeParse(statedSearchValues(search));
  if (!parsed.success) return err(refusedSearchParameters(parsed.error));
  const { commitmentId } = parsed.data;
  const narrowing: SupportPageQuery = commitmentId === undefined ? {} : { commitmentId };
  const index = parsed.data["page.index"];
  const size = parsed.data["page.size"];
  return ok(index === undefined ? narrowing : { ...narrowing, page: size === undefined ? { index } : { index, size } });
}
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
/** A posted query may state the authority it believes it is read under: a well-formed scope is admitted and then held against the authority the read ran under, while a malformed one is refused here by its own field, and omitting it reads under the session's own authority as this application's own client does. */
const postedScopeField = scopeSchema.optional();
/** The two members of a posted query the amount-range rule relates: the selection amounts are stated in, and the range stated over them. */
type PostedCurrencyAndRange = { readonly currency?: z.output<typeof currencyBodySchema>; readonly amountRange?: z.output<typeof amountRangeBodySchema> };
/** Whether a posted query names exactly one currency: the code stated as the selection itself, or the single-currency form of the report query's own selection. */
function postsOneCurrency(currency: PostedCurrencyAndRange["currency"]): boolean {
  if (currency === undefined) return false;
  return typeof currency === "string" ? currency.trim() !== "" : currency.kind === "one";
}
/** Refuses an amount range posted with no single currency selected, at the range's own path: a range compares one currency's minor units, so a read given an unpaired one would drop it rather than carry it into the report or the file. */
function refineAmountRangeCurrency(query: PostedCurrencyAndRange, context: z.RefinementCtx): void {
  if (query.amountRange === undefined || postsOneCurrency(query.currency)) return;
  context.addIssue({ code: "custom", path: ["amountRange"], message: AMOUNT_RANGE_CURRENCY_MESSAGE });
}
const snapshotIdSchema = z.string().min(1, BODY_MESSAGES.snapshotId).optional();
/** The body `POST /api/report` reads: which of the four reports, the filters it is computed under, and the caller's own request identity. */
export const reportRequestSchema = z.strictObject({ query: z.strictObject({ reportId: reportIdentitySchema, scope: postedScopeField, ...POSTED_FILTER_FIELDS }).superRefine(refineAmountRangeCurrency), snapshotId: snapshotIdSchema });
/** The body `POST /api/export` reads: the same shape, whose query may name the report it is an export of, under the same amount-range rule so the two artifacts of a query are built from the same reading of it. */
export const exportRequestSchema = z.strictObject({ query: z.strictObject({ reportId: reportIdentitySchema.optional(), scope: postedScopeField, ...POSTED_FILTER_FIELDS }).superRefine(refineAmountRangeCurrency), snapshotId: snapshotIdSchema });
/** A posted query as the broader of the two bodies reads it. */
export type PostedQuery = z.output<typeof exportRequestSchema>["query"];
/** Reduces a posted query to the bounded filter set the reads accept, naming the one currency a scoped selection states and the one report an export is of when it names one. */
export function supportQueryOf(posted: PostedQuery): SupportQuery {
  const stated = posted.currency;
  const currency = stated === undefined ? undefined : typeof stated === "string" ? stated : stated.kind === "one" ? stated.currency : undefined;
  return {
    ...(posted.reportId === undefined ? {} : { reportId: posted.reportId }),
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
/** The four members a posted scope states, each with the noun a refusal names it by, so every member that is not the authority the read ran under is refused at its own path. */
const POSTED_SCOPE_MEMBERS: readonly { readonly member: keyof Scope; readonly noun: string }[] = [
  { member: "organizationId", noun: "organization" },
  { member: "ministryId", noun: "ministry" },
  { member: "supportSubjectId", noun: "support subject" },
  { member: "principalId", noun: "principal" },
];
/** The message one member of a stated scope is refused with: the rule, why no read runs under another authority, and what the caller does instead. */
function foreignScopeMessage(noun: string): string {
  return `A posted query's scope is the authority the query is read under, and the envelope answers with the authority the read actually ran under: this read cannot run under any ${noun} but the session's own, so state the session's own ${noun}, or omit scope and the read answers under the session's own authority.`;
}
/** Refuses a posted scope that is not the authority the read ran under, one message per member that differs, keyed by its own path. Answers `undefined` when no scope was stated or the stated one is that authority: the application's own client posts no scope, and a stated one is judged rather than dropped, because the envelope's scope is the exact authority the read ran under. */
export function foreignScopeRefusal(stated: Scope | undefined, held: Scope): ReadResult<never> | undefined {
  if (stated === undefined || sameScope(stated, held)) return undefined;
  const fields: Record<string, readonly string[]> = {};
  for (const { member, noun } of POSTED_SCOPE_MEMBERS) {
    if (stated[member] === held[member]) continue;
    fields[`query.scope.${member}`] = [foreignScopeMessage(noun)];
  }
  return refusedRead(READ_ATTEMPT, fields);
}

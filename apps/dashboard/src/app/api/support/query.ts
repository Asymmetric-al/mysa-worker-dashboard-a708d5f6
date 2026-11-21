/**
 * The one server-side reader for the Support job's browser transports: the search-parameter grammar
 * the four Support reads share, the page window `readCommitments` accepts, and the JSON body the two
 * report-shaped posts carry.
 *
 * **Why this is a module and not a route.** Only a `route.ts` file is a route in the App Router, and
 * each one exports the verbs it serves. These grammars are shared: `/api/support`,
 * `/api/support/gifts` and `/api/support/goal` read one filter vocabulary, and `/api/report` and
 * `/api/export` read one body. Written once here, a field name cannot mean two things on two paths
 * and cannot drift between them. Nothing in this file answers a request.
 *
 * **Every field name below is one a browser transport actually sends.** The ledger's URL vocabulary
 * is `toGiftsParams`'s in `features/support/hooks/use-gifts.ts` — `period` or `from` + `to`,
 * `currency` with `amountMin`/`amountMax`, `recipient` with `partnerId`, `designation`, `method`,
 * `search`, `sortField` + `sortDirection`, `page` + `pageSize` — and the commitments list's is
 * `toCommitmentsParams`'s, whose window travels as `page.index` and `page.size`. The body fields are
 * `use-report.ts`'s `{ reportId, ...filters }` and `use-export.ts`'s snapshot query. No other
 * parameter is invented, and three a client carries are deliberately not forwarded because the
 * read's own type has no member for them: the ledger's `giftId` row selection (the named inventory
 * has no `readGift`, so a detail narrowing is the client's own row lookup over rows it already
 * read), and the commitments list's `commitmentId` and `showAdditionalTypes` (the read accepts only
 * the page window and states the kinds and buckets in its own data).
 *
 * **It maps and it refuses; it decides no value.** Nothing here searches, filters, sorts, counts,
 * clamps, sums, resolves a period or authorises: the period a preset resolves to, the number of rows
 * a page holds, whether one currency can carry an amount range, and whether a sort field or a
 * giving method is admitted all belong to the reads, which report what they actually applied in
 * their envelope. A parameter this grammar cannot read as the read's own type is refused here with
 * a field path, because the closed read result has no "your request was invalid" branch, and a
 * filter silently dropped would answer a question nobody asked.
 *
 * A read that accepts the filter set but applies less of it is a different case and is not refused
 * here: `readSupportOverview`, `readGoal` and `readExport` take a page window they do not use,
 * because each reads the whole result rather than a page, and `readCommitments` takes no filter at
 * all. Each read reports the filters that took effect in its data and the ones it could not apply in
 * its `actions`, which is where a surface reads what its figures actually cover.
 *
 * **The status is never chosen here.** A caller turns the refusal into the application's one
 * response ladder through `outcomeFromError`, and the read's own answer into `toResponse` unchanged.
 *
 * Layering: `app/api → modules/data-service`. This file imports the service's own signatures by
 * type alone and names no route, component, feature, store or development-runtime module.
 */

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import type { reads } from "@/modules/data-service";

/**
 * The bounded filter set the query-shaped Support reads accept, taken from a read's own signature
 * rather than restated: a member the service adds, renames or withdraws reaches this file by
 * compilation instead of leaving a hand-written copy to drift.
 */
export type SupportQuery = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;

/** The window `readCommitments` accepts, taken from that read's own signature. */
export type SupportPageQuery = NonNullable<Parameters<typeof reads.support.readCommitments>[0]>;

/** One of the four report identities `readReport` computes, read from its own first parameter. */
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];

/**
 * A parsed request, or the grammar error that refused it.
 *
 * The failure branch carries the `ZodError` itself, so a caller hands it to `outcomeFromError` and
 * the refusal reaches the browser with a message keyed by the field path the client sent — the same
 * shape a refused mutation payload has, rather than a prose sentence a surface cannot place.
 */
export type ParsedQuery<Query> = Result<Query, z.ZodError>;

// ---------------------------------------------------------------------------------------------
// One search parameter, as the URL carries it
// ---------------------------------------------------------------------------------------------

/** Digits only, with no sign, separator or fraction: the form a page index and a page size take. */
const PAGE_NUMBER = /^\d{1,9}$/u;

/**
 * An amount bound: a signed count of minor units of at most fifteen digits, which keeps every value
 * an exact safe integer. A bound is signed because a refund or a correction is a negative row, and
 * it is never parsed as a decimal because a major-unit figure would not state which minor unit was
 * meant.
 */
const AMOUNT_BOUND = /^-?\d{1,15}$/u;

/** One parameter's single value, or `undefined` when the URL does not carry it. */
function firstValue(search: URLSearchParams, name: string): string | undefined {
  return search.get(name) ?? undefined;
}

/**
 * One whole, non-negative number written in decimal, for a page index or a page size.
 *
 * Only the shape is checked. The default page size and the cap a larger request is clamped to are
 * the report engine's, so a handler-side clamp would silently disagree with the whole-result `total`
 * printed beside it; this schema decides solely that "notanumber" and "-1" are not page values.
 */
function wholeNumber(message: string) {
  return z
    .string()
    .regex(PAGE_NUMBER, message)
    .transform((value) => Number(value));
}

/** One amount bound, read as the exact integer of minor units the read compares. */
function amountBound(message: string) {
  return z
    .string()
    .regex(AMOUNT_BOUND, message)
    .transform((value) => Number(value));
}

// ---------------------------------------------------------------------------------------------
// The ledger's search grammar
// ---------------------------------------------------------------------------------------------

/**
 * The attributions the reads select one at a time: a named partner, anonymous support, or a source
 * row that supplied no attribution at all.
 *
 * The gifts ledger's own transport collapses the last two into one `anonymous-or-unresolved`
 * choice. They are two different facts about a donation and the read filters them one at a time, so
 * that collapsed value names a pair this grammar cannot forward as one selection: it is refused in
 * words that ask for the attribution the caller meant, rather than narrowed to one member.
 */
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";
const RECIPIENT_ANONYMOUS_OR_UNRESOLVED = "anonymous-or-unresolved";

/** The wording every refusal in this file uses, stated once so one rule cannot be told two ways. */
const MESSAGES = {
  pageNumber: "State the page as a whole number of pages from 0, the first page.",
  pageSize: "State the page size as a whole number of rows.",
  pageSizeNeedsPage:
    "State the page a size applies to: a size with no page would be read as the first page or ignored, and neither is the page that was asked for.",
  amountBound: "State an amount bound as a whole number of the selected currency's minor units.",
  amountRangeNeedsBoth:
    "State both bounds of an amount range: a range compares the minor units of one currency, and one bound alone states no range for the read to apply.",
  periodNeedsBoth:
    "State both ends of the period, each as a calendar day: one day is not a range, and the ledger's figures are read over a range.",
  sortNeedsBoth:
    "State the sort field and its direction together: a field with no direction, or a direction with no field, orders the ledger by nothing the worker chose.",
  recipientUnknown: `State the attribution filter as ${RECIPIENT_PARTNER}, ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}.`,
  recipientCombined: `The ledger's combined "anonymous-or-unresolved" choice names two attributions the read selects one at a time: anonymous support and support that supplied no attribution are separate filters, so state ${RECIPIENT_ANONYMOUS} or ${RECIPIENT_UNRESOLVED}. Narrowing the pair to one member here would drop the other's rows while presenting the filter as applied.`,
  recipientNeedsPartner:
    "State the partner a partner attribution names: the filter narrows to one record's own reference, and a kind with no reference would narrow to nothing.",
  partnerNeedsRecipient:
    "State the partner attribution beside a partnerId, because a reference with no attribution named would be a filter this transport could only drop.",
} as const;

/**
 * The wire grammar of the ledger query: one flat set of search parameters, assembled below into the
 * query object the reads take.
 *
 * The handler checks that each parameter is a value the read can accept — a whole page number, a
 * period with both ends, an amount range with both bounds, a sort with a field and a direction. It
 * never decides which presets, currencies, designations, giving methods or sort fields exist, how
 * many rows a page holds, or what any figure is: a name the read does not admit travels through
 * untouched and the read states in its `actions` that it could not apply it.
 */
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
    if (
      recipient !== RECIPIENT_PARTNER &&
      recipient !== RECIPIENT_ANONYMOUS &&
      recipient !== RECIPIENT_UNRESOLVED
    ) {
      context.addIssue({
        code: "custom",
        path: ["recipient"],
        message:
          recipient === RECIPIENT_ANONYMOUS_OR_UNRESOLVED
            ? MESSAGES.recipientCombined
            : MESSAGES.recipientUnknown,
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

/** The ledger's search parameters as they arrived, before they are assembled into a read query. */
type SupportSearchParams = z.output<typeof supportSearchSchema>;

/**
 * The period a request states, read with the ledger's own precedence: two civil days when both are
 * present, otherwise the named preset.
 *
 * A preset travels as the opaque string the client wrote, never as a value this file admits, so a
 * preset this build does not know is refused by the read in its own words rather than silently
 * replaced by another period. An empty preset is the client's own "no period stated" sentinel, so it
 * is omitted here instead of being forwarded as a name.
 */
function periodOf(params: SupportSearchParams): SupportQuery["period"] {
  if (params.from !== undefined && params.to !== undefined) {
    return { kind: "explicit", from: params.from, to: params.to };
  }
  if (params.period === undefined || params.period === "") {
    return undefined;
  }
  return { kind: "preset", preset: params.period };
}

/** The attribution a request states, in the read's own three members. */
function partnerOf(params: SupportSearchParams): SupportQuery["partner"] {
  switch (params.recipient) {
    case undefined:
      return undefined;
    case RECIPIENT_PARTNER:
      return params.partnerId === undefined
        ? undefined
        : { kind: "partner", partnerId: params.partnerId };
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

/** The amount range a request states, in the selected currency's minor units. */
function amountRangeOf(params: SupportSearchParams): SupportQuery["amountRange"] {
  return params.amountMin === undefined || params.amountMax === undefined
    ? undefined
    : { minMinor: params.amountMin, maxMinor: params.amountMax };
}

/** The sort a request states, as the pair the read reads. */
function sortOf(params: SupportSearchParams): SupportQuery["sort"] {
  return params.sortField === undefined || params.sortDirection === undefined
    ? undefined
    : { field: params.sortField, direction: params.sortDirection };
}

/** The page window a list asks for, in the read's own member paths. */
function pageWindowOf(params: SupportSearchParams): SupportQuery["page"] {
  if (params.page === undefined) {
    return undefined;
  }
  return params.pageSize === undefined
    ? { index: params.page }
    : { index: params.page, size: params.pageSize };
}

/**
 * Assembles the query object the Support reads take from the parameters that passed the grammar.
 *
 * The work is purely structural: the two ends of a range become one member, the attribution kind and
 * its reference become the read's own selection, and every facet travels as the text the client
 * wrote. No value is trimmed, re-cased, defaulted, dropped or interpreted — including the empty
 * `designation`, `method` and `search` a cleared filter control writes, which the read itself reads
 * as "no filter stated" while an omitted parameter and a stated one stay two different requests.
 */
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

/**
 * Reads a Support read's query out of the request's search parameters.
 *
 * Absent parameters are passed as `undefined` rather than as empty text, so "not stated" and "stated
 * as empty" stay two different requests. A parameter this grammar refuses never reaches a read: it
 * is answered with the field path that carried it.
 */
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

// ---------------------------------------------------------------------------------------------
// The commitments list's page window
// ---------------------------------------------------------------------------------------------

/**
 * The commitments list's own search grammar: the window `readCommitments` accepts and nothing else.
 *
 * The names are the list's, not a translation of them — `page.index` and `page.size` mirror the
 * read's own member paths, so a handler maps them onto its argument without a second table. The
 * list's other two parameters, `commitmentId` and `showAdditionalTypes`, are read by no member of
 * the read and are therefore not part of this grammar: the detail narrowing and the "additional
 * types" offer are the list's own state, and the read states the kinds and buckets it holds.
 */
const commitmentsSearchSchema = z
  .strictObject({
    "page.index": wholeNumber(MESSAGES.pageNumber).optional(),
    "page.size": wholeNumber(MESSAGES.pageSize).optional(),
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

/**
 * Reads the commitments list's page window out of the request's search parameters.
 *
 * An unstated window is an empty query, which the read answers with its own first page at its own
 * default size: the default and the 200-row cap are the engine's, so neither is written here.
 */
export function supportPageFromSearch(search: URLSearchParams): ParsedQuery<SupportPageQuery> {
  const parsed = commitmentsSearchSchema.safeParse({
    "page.index": firstValue(search, "page.index"),
    "page.size": firstValue(search, "page.size"),
  });
  if (!parsed.success) {
    return err(parsed.error);
  }

  const index = parsed.data["page.index"];
  const size = parsed.data["page.size"];
  if (index === undefined) {
    return ok({});
  }
  return ok({ page: size === undefined ? { index } : { index, size } });
}

// ---------------------------------------------------------------------------------------------
// The body the report and export posts carry
// ---------------------------------------------------------------------------------------------

/**
 * The four report identities the engine computes, mirrored from its closed list.
 *
 * The engine's tuple is not re-exported through the service's index, and importing the engine module
 * itself from a route would put the whole report computation behind a handler that only needs to
 * recognise four names. The `satisfies` clause is what makes the repetition safe: an identity the
 * service stops computing fails to compile here, while one it adds stays simply unoffered rather
 * than becoming a report this transport claims to serve.
 */
const REPORT_IDENTITIES = [
  "received-period-and-year-to-date",
  "monthly-history",
  "partner-month-matrix",
  "period-comparison",
] as const satisfies readonly ReportIdentity[];

/** The wording the body grammar refuses with. */
const BODY_MESSAGES = {
  reportId: `Name one of the four reports this application computes as query.reportId: ${REPORT_IDENTITIES.join(", ")}. No other report exists, and none is substituted for an identity this build does not compute.`,
  snapshotId:
    "State the request identity as a non-empty string, or omit it: it is the caller's own cache discriminator and never the snapshot the service computes.",
  period:
    "State the period as a preset, as two calendar days (kind: explicit, from, to), or as a calendar year; no other period is read.",
  year: "State a calendar year as a whole four-digit year.",
  currency:
    'State the currency as its ISO code, or as the report query\'s own selection — { kind: "one", currency } or { kind: "all" }. Nothing else states a currency, and no code is assumed.',
  amountRange:
    "State both bounds of an amount range as whole minor units of the selected currency, or omit the range.",
  partner:
    "State the attribution as { kind: partner, partnerId }, { kind: anonymous } or { kind: unresolved }.",
  sort: "State the sort's field and direction as non-empty text: which fields are sortable and which direction is admitted belong to the report engine, and a member stated as blank orders nothing.",
  page: "State the page window's index and size as whole numbers from zero: the default size and the cap belong to the report engine.",
  timeZone:
    "Name the zone a period preset resolves in as a non-empty identifier, or omit it and the read uses its declared default.",
} as const;

/** The report identity a post names, in the engine's own vocabulary. */
const reportIdentitySchema = z.enum(REPORT_IDENTITIES, { error: BODY_MESSAGES.reportId });

/**
 * The period a posted query states, in the shape the reads accept.
 *
 * A preset is carried opaquely and resolved by the read; two civil days travel as the text a date
 * control produces, so a browser that serialised a calendar date and one that wrote the day by hand
 * state the same period; a year is the whole year the monthly history buckets into months.
 */
const periodBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: z.string() }),
  z.strictObject({
    kind: z.literal("explicit"),
    from: z.string().min(1, BODY_MESSAGES.period),
    to: z.string().min(1, BODY_MESSAGES.period),
  }),
  z.strictObject({ kind: z.literal("year"), year: z.int({ error: BODY_MESSAGES.year }) }),
]);

/**
 * The currency a posted query states, in either spelling a browser transport uses.
 *
 * The report transport posts the bare ISO code the ledger's own filter state holds; the export
 * transport posts the snapshot query it is exporting, whose currency is the engine's own selection.
 * Both are the same fact, so both are read here and reduced to the one code the reads take, with a
 * `{ kind: "all" }` selection becoming the absence of a currency rather than a code that names none.
 */
const currencyBodySchema = z.union(
  [
    z.string(),
    z.strictObject({ kind: z.literal("one"), currency: z.string().min(1, BODY_MESSAGES.currency) }),
    z.strictObject({ kind: z.literal("all") }),
  ],
  { error: BODY_MESSAGES.currency },
);

/** An inclusive range in the selected currency's minor units. */
const amountRangeBodySchema = z.strictObject({
  minMinor: z.int({ error: BODY_MESSAGES.amountRange }),
  maxMinor: z.int({ error: BODY_MESSAGES.amountRange }),
});

/** The attribution a posted query restricts to, in the read's own three members. */
const partnerBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("partner"),
    partnerId: z.string().min(1, BODY_MESSAGES.partner),
  }),
  z.strictObject({ kind: z.literal("anonymous") }),
  z.strictObject({ kind: z.literal("unresolved") }),
]);

/**
 * The ordering a posted query states.
 *
 * Both members stay optional because they are optional in the read's own query type, and this
 * transport adds no rule of its own: a field the engine does not sort by, and a direction it does not
 * order in, are refused by the read in its `actions` rather than here, so the sortable vocabulary has
 * one owner. The ledger's URL grammar states the pair together because its writer always writes one;
 * a body is the read's own typed query, so it is read as the type states it.
 */
const sortBodySchema = z.strictObject({
  field: z.string().min(1, BODY_MESSAGES.sort).optional(),
  direction: z.string().min(1, BODY_MESSAGES.sort).optional(),
});

/**
 * The page window a posted query states; a report is paged, an export is the whole query.
 *
 * Neither member is required, for the same reason: the read defaults an unstated index to the first
 * page and clamps a stated size to its own default and cap, so a window this grammar demanded would be
 * a second statement of a rule the engine owns.
 */
const pageBodySchema = z.strictObject({
  index: z.int({ error: BODY_MESSAGES.page }).optional(),
  size: z.int({ error: BODY_MESSAGES.page }).optional(),
});

/**
 * The filter fields both report-shaped posts carry, declared once.
 *
 * Each is the read's own member, in the read's own spelling, so the body a browser sends is the
 * query the read is asked for — nothing is renamed on the way in, and a filter added to the read is
 * added here in one place.
 */
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

/**
 * The `scope` a post's query may carry, and why it is not a filter.
 *
 * The export transport posts the snapshot query it is taking out of the application, and that query
 * repeats the four references it was computed under. It is accepted and never forwarded: the service
 * derives the scope from the development session on every call, so a caller cannot name a context it
 * is not admitted to by writing one here.
 */
const postedScopeField = z.unknown().optional();

/**
 * The `snapshotId` a post may carry, described in one sentence.
 *
 * It is the caller's own cache discriminator for the query it is sending — the identity the screen
 * and the download beside it share so that two surfaces are known to answer one question. The
 * snapshot a response states is the one the service computed, so this value is read and dropped: it
 * never reaches a read, and a missing one costs the caller nothing but its own correlation handle.
 */
const snapshotIdSchema = z.string().min(1, BODY_MESSAGES.snapshotId).optional();

/**
 * The body `POST /api/report` reads: which of the four reports, the filters it is computed under, and
 * the caller's own request identity.
 *
 * `reportId` is required here because this path dispatches on it: the handler splits it out of the
 * query and asks `readReport` for that one report. Nothing else in the body names a report, so a body
 * without one asks a question this application cannot answer.
 */
export const reportRequestSchema = z.strictObject({
  query: z.strictObject({
    reportId: reportIdentitySchema,
    scope: postedScopeField,
    ...POSTED_FILTER_FIELDS,
  }),
  snapshotId: snapshotIdSchema,
});

/**
 * The body `POST /api/export` reads: the same shape, whose query needs no report identity.
 *
 * An export is the whole-query file of one ledger query rather than one of the four reports, so the
 * read selects its own report identity and a stated one is accepted and not forwarded. The shape is
 * otherwise the same object, which is what lets one browser component post the query it is looking at
 * to either path.
 */
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

/**
 * The currency code a posted query states, or `undefined` when it reads every currency present.
 *
 * The engine's `{ kind: "all" }` selection and the absence of a currency are the same request to the
 * reads, so neither becomes a code: the partition across every currency present is the engine's, and
 * a made-up code would select nothing.
 */
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

/**
 * Reduces a posted query to the bounded filter set the reads accept.
 *
 * The work is structural, as in the search grammar: the engine's currency selection becomes the code
 * or nothing, and every other filter travels as the caller stated it. `reportId` and `scope` are the
 * two members this function drops on purpose — the identity belongs to the handler that dispatches
 * to one report, and the scope is the service's to derive from the session.
 */
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

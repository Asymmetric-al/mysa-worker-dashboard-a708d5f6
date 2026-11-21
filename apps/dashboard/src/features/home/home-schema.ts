/**
 * Home's own vocabulary, and the boundary validator that makes "a reason and a destination on every
 * item" enforceable rather than assumed.
 *
 * Home answers one question — what needs my attention today — by partitioning what the worker could
 * look at into three sections: Attention, Information and Unfinished work (AAP 0.10.1 family 1). The
 * rule that makes that partition trustworthy is that every item states *why* it is on Home and
 * *where* it takes the worker. An item that cannot say both is not a triage item, and Home is not a
 * notification feed.
 *
 * The service already holds both facts: `readHome` answers a `ReadEnvelope` whose items carry their
 * section, their reason key and their destination (AAP 0.7.1). What it answers in is the service's
 * shape — opaque record references, statuses, civil dates and an optional received-support figure.
 * This module is the last step between that shape and a rendered row, so it is the place to state
 * once what a row is allowed to be. The section, the row and the mapper that turns a service item
 * into a view all read the vocabulary here rather than inventing a second set of strings for the same
 * three sections.
 *
 * Four properties are deliberate.
 *
 * - **One closed set per concern.** Sections, reason codes, lifecycle states and the five simulated
 *   effects each exist once, as a runtime tuple with its type derived from it, so a control, a switch
 *   and a test read one list. `HOME_SECTION_KEYS` order *is* the display order, which is why there is
 *   no separate order constant: two lists could disagree about the order Home renders in.
 * - **Honest failure.** A section group that arrives in a shape this surface cannot render is
 *   reported as `unknown`, and an item that cannot be parsed keeps whatever title and reason text was
 *   readable, rather than the surface rendering a silent empty. "Nothing here" and "this could not be
 *   read" are different facts, and `components/state-notice` gives them different words.
 * - **A reason code never hides work.** `reasonCode` is a plain non-empty string at this boundary,
 *   not the closed tuple: a reason the service adds tomorrow must not blank or drop a real item. The
 *   tuple drives the short label; the item's own `reason` sentence is what a row falls back to, so a
 *   code this family has never heard of still leaves a row that says why it is there.
 * - **Triage only.** No amount, currency, count, deadline, next occurrence or percentage is computed,
 *   derived or defaulted here, and no partner, donor or financial identity is carried. `count` is only
 *   ever the number the envelope stated — never `items.length`, because that number covers the whole
 *   result while `items` may be a window of it. The received-support figure Home shows stays on the
 *   service item the Support surfaces read too, so the number is the one report computation's and
 *   never a second sum of Home's own.
 *
 * Why the lifecycle list is a runtime tuple here. This module must import no React, so that a
 * Server Component, a Client Component and a Vitest test can each import it, and it therefore
 * states the eight states itself rather than importing `CONTENT_LIFECYCLE_STATES` from
 * `@/components/draft-status`. The words remain that module's: the annotation below ties this tuple
 * to its `ContentLifecycleState` union, so a state renamed or removed there, or a member this copy
 * invents, is a compile error rather than a silent divergence, and an item whose state is not in
 * this copy is reported as unreadable rather than guessed at. Both component imports are types, so
 * no React reaches this graph: the other is `SimulatedEffect`, which keeps the five effects here
 * from drifting from the five that `components/simulation-label` has a sentence for.
 *
 * Plan items: AAP 0.10.1 family 1 (Home separates Attention, Information and Unfinished work, with a
 * reason and a destination on every item); AAP 0.11.1 row `features/home/**`; AAP 0.6.1 read
 * `readHome`; AAP 0.8.1 (the value states are the envelope's, and no component decides one);
 * AAP 0.12.1 criteria 2 and 5. Rule 1 clause 2: one closed vocabulary per concern and the simplest
 * implementation that completes the job. Rule 1 clause 3: a saved draft, a submitted candidate, an
 * unavailable source and a simulated effect stay distinguishable in words on this surface, and
 * nothing here claims that saving, completing or publishing proved a person was reached.
 */

import { z } from "zod";

import type { ContentLifecycleState } from "@/components/draft-status";
import type { SimulatedEffect } from "@/components/simulation-label";

// ---------------------------------------------------------------------------------------------
// Text a reader must be able to see
// ---------------------------------------------------------------------------------------------

/**
 * Text a reader must be able to see: a string, present, and made of more than whitespace.
 *
 * Emptiness is judged on the trimmed value, so a field of spaces, tabs or a lone newline is refused
 * instead of reaching a reader as a blank heading, while the value itself is never trimmed,
 * re-cased or otherwise normalised: the record's own words are what the row shows, leading zeros and
 * all. The two messages stay apart because they describe different mistakes — a value of the wrong
 * type, and a value with nothing visible in it — and each one names its own field's job rather than
 * restating this rule.
 */
function requiredText(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z.string({ error: invalidMessage }).refine((value) => value.trim().length > 0, {
    error: emptyMessage,
  });
}

// ---------------------------------------------------------------------------------------------
// The three sections, in the order Home renders them
// ---------------------------------------------------------------------------------------------

/**
 * Home's three sections, in display order.
 *
 * The tuple's order is Attention, then Information, then Unfinished work, and that order is what the
 * surface renders, so there is no second "section order" constant that could disagree with it. The
 * values are also the section discriminator every item carries, restated here because
 * `@/modules/data-service` re-exports the envelope and outcome contracts but not Home's item
 * vocabulary, and a feature reads that public surface rather than the read module behind it. A value
 * outside this tuple is refused rather than rendered into a fourth section that would have no
 * heading, no copy and no state of its own.
 */
export const HOME_SECTION_KEYS = ["attention", "information", "unfinished-work"] as const;

/** One section of Home: the group an item is triaged into. */
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

/** Validates the section an item or a section group belongs to against the closed set. */
export const homeSectionKeySchema = z.enum(HOME_SECTION_KEYS, {
  error: "A Home section is Attention, Information or Unfinished work.",
});

// ---------------------------------------------------------------------------------------------
// Why an item is on Home
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of short reason labels this family renders, grouped the way the sections use them.
 *
 * Work and its series own the first three: something is late, something is due today, or a repeating
 * plan has missed enough dates that it needs a decision rather than another overdue row. Content owns
 * the next three: a draft is saved, a candidate waits for its one review step, and a simulated notice
 * needs attention. Outreach follows with a recorded response and a referral whose original
 * introduction date is incomplete — and that last code is deliberately not an expiry, because an
 * unknown or approximate date produces no deadline at all. Import and coaching add their two
 * review-and-attention reasons, and `source-unavailable` states that a section's own source could not
 * be read, which is never the same fact as a section with nothing in it.
 *
 * This is the *presentation* vocabulary, deliberately smaller than the reasons the service can state.
 * An item's `reasonCode` is a plain string at this boundary (see `homeItemViewSchema`), so a reason
 * this tuple has never heard of still parses, and its row shows the item's own `reason` sentence
 * instead of a label somebody would have had to invent. That is why this list may lag the service
 * without ever hiding work — and why it must not be used to filter items or to decide that something
 * belongs on Home.
 */
export const HOME_REASON_CODES = [
  "overdue",
  "due-today",
  "plan-needs-review",
  "draft-saved",
  "awaiting-review",
  "notice-needs-attention",
  "response-recorded",
  "referral-incomplete-date",
  "import-needs-review",
  "target-needs-attention",
  "source-unavailable",
] as const;

/** One reason Home labels an item with. */
export type HomeReasonCode = (typeof HOME_REASON_CODES)[number];

/** Validates a reason code against the closed set this family labels. */
export const homeReasonCodeSchema = z.enum(HOME_REASON_CODES, {
  error: "A Home reason code is one of the short labels this surface renders.",
});

// ---------------------------------------------------------------------------------------------
// Where an item takes the worker
// ---------------------------------------------------------------------------------------------

/**
 * A destination: the route Home opens for an item, with the words the worker reads on the way out.
 *
 * `href` is a route in this application, so it begins with a single `/` and carries the query state
 * that makes returning useful — a filtered list keeps its filters, a record keeps its section. Three
 * shapes are refused on purpose: an external URL, because Home never sends a worker to another site
 * from a triage row; `#`, because a destination that goes nowhere is not a destination; and a value
 * beginning `//`, which browsers read as another site even though it starts with a slash.
 *
 * `label` is required and non-empty for the same reason: a link with no words cannot be read by a
 * screen-reader user following the row's links, and cannot be understood by anyone scanning it. The
 * wording is the caller's own, because this module holds no copy.
 */
export const homeDestinationSchema = z.object({
  href: requiredText(
    "A destination is a route in this application, so it is text.",
    "A destination needs the route it opens.",
  )
    .startsWith("/", {
      error: "A destination is a route in this application, so it begins with a slash.",
    })
    .refine((href) => !href.startsWith("//"), {
      error:
        "A destination carries one leading slash, because two of them name another site rather than a route.",
    }),
  label: requiredText(
    "A destination label is the words the worker reads, so it is text.",
    "A destination needs a label, because a route with no words cannot be followed or read.",
  ),
});

/** One destination an item opens. */
export type HomeDestination = z.infer<typeof homeDestinationSchema>;

// ---------------------------------------------------------------------------------------------
// The lifecycle states and simulated effects an item may carry
// ---------------------------------------------------------------------------------------------

/**
 * The lifecycle states `components/draft-status` renders, restated here so this module imports no
 * React.
 *
 * A saved draft, a frozen candidate, a current release, a partially released batch, a withdrawal and
 * a stale translation are different facts, and Home says which one an item is in without ever
 * claiming that a save published anything or that a release reached anybody. The list must match
 * `CONTENT_LIFECYCLE_STATES` exactly; a state this copy does not know makes `parseHomeItem` report
 * the item as unreadable rather than render a state word this surface has no sentence for.
 */
const HOME_LIFECYCLE_STATES = [
  "not-started",
  "draft",
  "candidate",
  "released",
  "partially-released",
  "withdrawn",
  "superseded-head",
  "stale-translation",
] as const satisfies readonly ContentLifecycleState[];

/**
 * The five simulated external effects, mirrored from `components/simulation-label` as a type only.
 *
 * An item that leads to a mail submission, a publication's reach, a giving destination, an import or
 * media preparation says so, and the row renders the label that component owns. `satisfies` keeps
 * every member one of the effects that has a sentence of its own, while the wording stays entirely in
 * that component, so no second copy of a disclosure can exist here.
 */
const HOME_SIMULATED_EFFECTS = [
  "mail-submission",
  "publication-reach",
  "giving-destination",
  "importer-safety",
  "media-preparation",
] as const satisfies readonly SimulatedEffect[];

// ---------------------------------------------------------------------------------------------
// One item, as a row renders it
// ---------------------------------------------------------------------------------------------

/**
 * The minimum an item may render — and the mechanism behind "a reason and a destination on every
 * item".
 *
 * `reason` and `destination` are both required, so an item that cannot answer "why am I here?" or
 * "where do I go?" does not parse, and its row reports that Home holds something it cannot open
 * rather than presenting a card that leads nowhere. `reasonCode` sits beside `reason` as a plain
 * non-empty string: the code picks a short label where the family knows it, and the sentence is what
 * a worker reads where it does not.
 *
 * Everything else is optional, because Home is a triage surface rather than a record view. `title` is
 * what the item is about; `statusWord` is the one word the record itself states — a task status, a
 * candidate's stage — and is absent where the record states none, so the row composes its own wording
 * instead of this module inventing one. `lifecycle` and `simulatedEffect` add the content indicator
 * and the effect disclosure where they apply. `detail` is one line of context, deliberately permitted
 * to be empty: an embellishment must never be able to invalidate a real item, so the row leaves an
 * empty one out instead of the parser refusing the row.
 *
 * The object keeps Zod's default strip mode: unknown keys are accepted and dropped, so an envelope
 * that grows a field never fails this boundary and the parsed view is exactly this contract. A field
 * a row must render therefore belongs here, never in an extra read behind the type's back. No member
 * states an amount, a currency, a count, a deadline or a partner identity, so no financial or
 * identity fact can travel through a Home row by accident.
 */
export const homeItemViewSchema = z.object({
  id: requiredText(
    "An item identity is the text the envelope gave it.",
    "An item needs the identity it arrived with, because a row without one cannot be opened.",
  ),
  title: requiredText(
    "An item title is text, so read the item again.",
    "An item needs a title, because a row with no subject asks the worker to guess.",
  ),
  reason: requiredText(
    "The reason an item is on Home is a sentence of text.",
    "An item must say why it is on Home, because an item that cannot say why is not actionable.",
  ),
  reasonCode: requiredText(
    "A reason code is a short text value.",
    "An item needs a reason code beside its sentence, so a row can label it without inventing a label.",
  ),
  destination: homeDestinationSchema,
  statusWord: requiredText(
    "A status word is one short text value.",
    "A status word needs a character, or leave it out so the row composes its own wording.",
  ).optional(),
  lifecycle: z
    .enum(HOME_LIFECYCLE_STATES, {
      error: "A lifecycle state is one of the states the shared draft indicator renders.",
    })
    .optional(),
  simulatedEffect: z
    .enum(HOME_SIMULATED_EFFECTS, {
      error: "A simulated effect is one of the five effects the interface has a label for.",
    })
    .optional(),
  detail: z.string({ error: "A detail line is text, so read the item again." }).optional(),
});

/** One item as a row renders it: the parsed, validated view, never a raw envelope member. */
export type HomeItemView = z.infer<typeof homeItemViewSchema>;

// ---------------------------------------------------------------------------------------------
// One section: its items, its count and the state it is in
// ---------------------------------------------------------------------------------------------

/**
 * The states a Home section can be in, listed once so the closed set has a runtime form as well as a
 * type.
 *
 * The first three are the states a group normally declares about itself: `available`, read and
 * holding whatever it holds; `unavailable`, its source could not be read, so its emptiness means
 * nothing; and `denied`, this session may not read it, so nothing about it is disclosed — no count,
 * no titles, no existence. The fourth covers the one fact a group cannot always report: that it
 * arrived in a shape this surface cannot read at all, or that it could not verify its own contents. A
 * group may declare it honestly, and the parser states it for a group it cannot read. Folding that
 * into `unavailable` would claim a source is down when the truth is that the payload is malformed,
 * and unknown and unavailable stay distinct states on every surface of this application, so the
 * section renders a notice instead of an empty list.
 */
export const HOME_SECTION_STATES = ["available", "unavailable", "denied", "unknown"] as const;

/** One state a Home section is in. */
export type HomeSectionState = (typeof HOME_SECTION_STATES)[number];

/** Validates the state a section group is in against the closed set. */
const homeSectionStateSchema = z.enum(HOME_SECTION_STATES, {
  error: "A section is available, unavailable, denied or unknown.",
});

/**
 * The notice a section group may carry: a heading and one sentence saying what a reader is looking
 * at. Both are required when the notice is present, because a heading with no sentence explains
 * nothing and a sentence with no heading has no anchor in the page outline.
 */
const homeSectionNoticeSchema = z.object({
  title: requiredText(
    "A section notice heading is text.",
    "A section notice needs a heading, so the notice joins the page outline.",
  ),
  body: requiredText(
    "A section notice sentence is text.",
    "A section notice needs a sentence saying what happened.",
  ),
});

/**
 * The source a section names when it says where its data came from: the system that issued it and an
 * opaque reference. Neither member is parsed, compared across systems or rendered as if its form
 * carried meaning, and no record identity is ever built from one.
 */
const homeSectionSourceSchema = z.object({
  system: requiredText(
    "A source reference names its system as text.",
    "A source reference names the system that issued it.",
  ),
  reference: requiredText(
    "A source reference carries its identifier as text.",
    "A source reference carries the identifier that system issued.",
  ),
});

/**
 * What a section says when its group arrived in a shape this surface cannot read.
 *
 * It states the one thing that is true — the contents could not be read — and offers the only
 * recovery that changes nothing: reloading asks for them again. It deliberately does not name a
 * source, because no source was read, and does not say the section is empty, because that is the one
 * claim this parser cannot make. A section may replace it with its own wording; it exists so that a
 * malformed group can never reach a reader as a blank heading.
 */
const UNREADABLE_SECTION_NOTICE = Object.freeze({
  title: "This section could not be read",
  body: "Its contents did not arrive in a form Home can show. Reloading asks for them again, and nothing here was changed.",
});

/**
 * A section group as it arrives, before anything is normalised.
 *
 * `items` are `unknown` on purpose: each one is validated by `parseHomeItem` on its own, so a single
 * malformed item reports one unreadable row instead of taking its whole section down with it. The
 * array defaults to empty, which is what makes "this section has nothing in it" representable
 * separately from "this section could not be read" — the latter is a failing parse, not an empty
 * list.
 *
 * `count` is the number the envelope stated and is only ever passed through: this module never counts
 * `items`, because a section may state a whole-result total while its items are one page of it.
 * `state`, `notice` and `source` are all optional, because a group that states nothing about its
 * health is an ordinary healthy group. Unknown keys are accepted and dropped, so a group that grows a
 * field never fails this boundary.
 */
export const homeSectionGroupSchema = z.object({
  items: z
    .array(z.unknown(), {
      error: "A section's items arrive as a list, so read the section again.",
    })
    .default([]),
  count: z
    .number({ error: "A section's count is the number the envelope stated." })
    .int({ error: "A section's count is a whole number of records." })
    .min(0, { error: "A section's count cannot be negative." })
    .optional(),
  state: homeSectionStateSchema.optional(),
  notice: homeSectionNoticeSchema.optional(),
  source: homeSectionSourceSchema.optional(),
});

/**
 * A section group as a section renders it: parsed, and with a state always stated.
 *
 * The wire shape may omit everything it likes except its items; this shape always answers the two
 * questions a section asks — has it anything to show, and may it show that it has nothing? A section
 * renders its notice and none of its items whenever the state is anything but `available`, so an
 * unavailable source, a denial and an unreadable payload can never be presented as an empty section,
 * and a count the envelope did not state stays absent instead of becoming a zero.
 *
 * `items` are still `unknown` here: this module validates an item's shape but never interprets its
 * record, so the row parses each one through `parseHomeItem` at the point it renders.
 */
export interface HomeSectionGroup {
  /** The items the envelope stated, unvalidated: one row parses each with `parseHomeItem`. */
  readonly items: readonly unknown[];
  /** The whole-result count the envelope stated, or nothing when it stated none. */
  readonly count?: number;
  /** Whether the section may show its items, must show a notice, or may show neither. */
  readonly state: HomeSectionState;
  /** The section's own heading and sentence, when it states one. */
  readonly notice?: { readonly title: string; readonly body: string };
  /** The source this section's data came from, when it names one. */
  readonly source?: { readonly system: string; readonly reference: string };
}

/**
 * Parses one section group, and never throws.
 *
 * Two failures are told apart, because a section must render them differently:
 *
 * - **Absent** — the caller holds no group at all, because the read stated no such section. It
 *   answers an empty, `available` group, which the section renders as its own empty state with a real
 *   first action, since a section nobody was given is a section with no work in it.
 * - **Present but unreadable** — a group arrived and did not match the shape, so nothing in it can be
 *   trusted: its items, its count and its own state are all discarded and it answers `unknown` with
 *   the notice above. That is what keeps a malformed payload from reaching a reader as "nothing to do
 *   today", which is a claim this parser would have no right to make.
 *
 * A group that parses is normalised, not rewritten: its items are passed through untouched, its count
 * is passed through as stated, its declared state is kept (defaulting to `available` when it declares
 * none), and its notice and source survive only if they were valid. Nothing is counted, summed or
 * inferred on the way.
 */
export function parseHomeSectionGroup(candidate: unknown): HomeSectionGroup {
  if (candidate === undefined || candidate === null) {
    return { items: [], state: "available" };
  }

  const parsed = homeSectionGroupSchema.safeParse(candidate);

  if (!parsed.success) {
    return { items: [], state: "unknown", notice: UNREADABLE_SECTION_NOTICE };
  }

  const { items, count, state, notice, source } = parsed.data;

  return {
    items,
    state: state ?? "available",
    ...(count === undefined ? {} : { count }),
    ...(notice === undefined ? {} : { notice }),
    ...(source === undefined ? {} : { source }),
  };
}

// ---------------------------------------------------------------------------------------------
// One item, parsed at the row that renders it
// ---------------------------------------------------------------------------------------------

/**
 * What parsing one item answers: the validated view, or the fact that the item cannot be rendered
 * plus whatever subject and reason text could still be read off it.
 *
 * The failure arm is not an empty value. A row that receives it can still say that something needs
 * attention — it has the title and the sentence when the item stated readable ones — and it simply
 * offers no destination, because the parse found no route it can vouch for. The alternative, dropping
 * the row, would hide work the worker was told about, which is the one thing a triage surface must
 * never do.
 */
export type HomeItemParseResult =
  | { readonly ok: true; readonly item: HomeItemView }
  | { readonly ok: false; readonly title?: string; readonly reason?: string };

/**
 * Reads one text member off an untrusted value, or nothing.
 *
 * It answers only for the two fields a reader needs in order to know an item exists: a non-empty
 * string is kept exactly as it arrived — not trimmed, not re-cased, not truncated — so the failure
 * arm shows the record's own words. Anything else, including a string of only spaces, answers
 * nothing, because it carries no words a reader could use.
 */
function readableText(candidate: unknown, key: "title" | "reason"): string | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }

  const value: unknown = Reflect.get(candidate, key);

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Validates one item, and never throws.
 *
 * Called once per row, which is what keeps one malformed item from blanking its section: the group
 * still renders, and only the row that could not be read reports itself as unreadable. The schema
 * decides shape and nothing else — whether the destination still opens, whether the referenced record
 * is still visible and whether the action is still permitted are the service's answers, re-checked
 * when the worker acts, so a parsed item is a renderable row and never an authorisation.
 */
export function parseHomeItem(candidate: unknown): HomeItemParseResult {
  const parsed = homeItemViewSchema.safeParse(candidate);

  if (parsed.success) {
    return { ok: true, item: parsed.data };
  }

  const title = readableText(candidate, "title");
  const reason = readableText(candidate, "reason");

  return {
    ok: false,
    ...(title === undefined ? {} : { title }),
    ...(reason === undefined ? {} : { reason }),
  };
}

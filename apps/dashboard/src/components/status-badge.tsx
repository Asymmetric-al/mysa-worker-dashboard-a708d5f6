import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { SendOutcomeState } from "@/modules/audience/consent";
import type { MembershipState } from "@/modules/audience/membership";
import type { GrantLifecycleState } from "@/modules/coaching/grant";
import type { Reach } from "@/modules/content/reach";
import type { ValueState } from "@/modules/data-service/envelope";
import { BUCKET_LABELS, type RecurringBucket } from "@/modules/support/buckets";

/**
 * The one status and audience label of the application: the closed vocabulary of every state a
 * surface reports, the tone each member carries, and the single place a tone becomes a `Badge`
 * variant.
 *
 * It exists because a state word is a promise about what happened, and the application makes several
 * promises that must never blur:
 *
 * - A draft never reads as published, and a withdrawn item never reads as current.
 * - A provider's acceptance never reads as delivery, and reading is never claimed at all.
 * - An `unknown` outcome reads as neither success nor failure, so the only honest next step is to
 *   re-query the same operation.
 * - A simulated effect says so in words; `components/simulation-label` states the effect and this
 *   component states its outcome.
 * - The six `ValueState` members stay distinct: a genuine zero, an unknown value, a withheld value,
 *   an unavailable source and an incomplete subtotal each get their own word, because a number that
 *   is not a number must never render as `0`.
 *
 * Every vocabulary below is one exhaustive `Record` over a closed union, so adding a member without
 * giving it a label and a tone is a compile error rather than an unlabelled chip. The four state
 * vocabularies take their members from the domain module that stores them — `modules/audience` for
 * memberships and send outcomes, `modules/coaching/grant` for grant episodes and
 * `modules/content/reach` for reach — so a state added or renamed there fails to compile here until
 * it has a word and a tone. A feature passes a union member through {@link statusBadgeProps} and
 * receives `{ label, tone }`; it never hand-writes the state word, which is what keeps one state
 * spelled one way across the whole application.
 *
 * The recurring-bucket words are not re-typed here: `modules/support/buckets` owns them (including
 * the `outside-partition` wording that keeps unknown or stale evidence out of the five outcomes),
 * and this file only adds the tone beside them.
 *
 * This component holds no state, reads no clock, fetches nothing and formats no money — a currency
 * label prints the ISO code and `modules/money/format` is the only formatter of an amount. It renders
 * a `span` through the installed `Badge`, so it carries no colour, radius, shadow or spacing literal:
 * every value resolves to a system token or to a `Badge` variant.
 */

/**
 * The semantic tone of a label, and the only vocabulary with which a caller says how a state should
 * read. It says nothing about colour: {@link TONE_APPEARANCE} is the one place a tone becomes a
 * `Badge` variant, so a caller chooses meaning and the design system chooses the surface.
 */
export type StatusTone = "neutral" | "info" | "positive" | "caution" | "danger" | "muted";

/** The visible word of a state and the tone that word carries. */
export interface StatusBadgeSpec {
  /** Reader-facing text. Never a class name, an icon key or a colour. */
  readonly label: string;
  readonly tone: StatusTone;
}

/** The `variant` a `Badge` accepts, taken from the installed component instead of restated. */
type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * How each tone is painted. The one mapping from a semantic tone to a design-system surface.
 *
 * `neutral` is the quiet filled chip (`--secondary`); `info` is the system's emphasis fill
 * (`--primary`); `muted` is the outlined chip, the least insistent of the six and the one used for
 * facts that are neither good nor bad. The three outcome tones use the semantic pairs the token layer
 * carries, in the order a reader expects: support arriving is `--positive`, something needing
 * attention is `--warning`, and an adverse or withdrawn outcome is `--destructive`.
 *
 * BLITZY [A11Y]: the system's `destructive` badge variant now paints the filled destructive pair the
 * token layer carries (`--destructive` with `--destructive-foreground`, 4.56:1 in the light theme and
 * 6.19:1 in dark), and this label uses the same pair for the same reason: a withdrawn, revoked or
 * failed state carries an adverse meaning, so it is painted as a strong filled chip rather than a
 * faint tint.
 *
 * `muted-foreground` is deliberately absent: the `muted` tone is the outlined chip, so its text keeps
 * `--foreground`. The least insistent tone is expressed by the absence of a fill, not by dimming the
 * text on one.
 */
const TONE_APPEARANCE: Readonly<
  Record<StatusTone, { readonly variant: BadgeVariant; readonly className?: string }>
> = {
  neutral: { variant: "secondary" },
  info: { variant: "default" },
  positive: { variant: "secondary", className: "bg-positive text-positive-foreground" },
  caution: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  danger: { variant: "secondary", className: "bg-destructive text-destructive-foreground" },
  muted: { variant: "outline" },
};

// ---------------------------------------------------------------------------------------------
// The closed vocabularies this component owns
// ---------------------------------------------------------------------------------------------

/**
 * The four states of a membership in one publisher's purpose: `active`, `awaiting-proof`, `off` and
 * `restricted`.
 *
 * The words keep three different facts apart — a choice the person made (`off`), an acceptance still
 * waiting for their confirmation (`awaiting-proof`), and a limitation the source imposed
 * (`restricted`) — so no surface can present a held record as consent.
 *
 * The members are `modules/audience/membership`'s own: `MEMBERSHIP_STATES` declares the four states
 * once, and this name is an alias for its member type so a fifth state cannot be added on one side
 * only.
 */
export type MembershipStatus = MembershipState;

/** The label and tone of each membership state. */
export const MEMBERSHIP_STATUS: Readonly<Record<MembershipStatus, StatusBadgeSpec>> = {
  active: { label: "Active", tone: "positive" },
  "awaiting-proof": { label: "Awaiting proof", tone: "caution" },
  off: { label: "Off", tone: "neutral" },
  restricted: { label: "Restricted", tone: "danger" },
};

/**
 * The three per-recipient send outcomes. `accepted` says the simulated sender took the work and
 * nothing more, so its word carries "not delivered"; `unknown` says the acknowledgement was lost, so
 * its word carries neither success nor failure.
 *
 * `modules/audience/consent` owns the union this aliases, so a fourth send state fails to compile
 * here rather than reaching a surface without a word.
 */
export type SendStatus = SendOutcomeState;

/** The label and tone of each send outcome. */
export const SEND_STATUS: Readonly<Record<SendStatus, StatusBadgeSpec>> = {
  accepted: { label: "Accepted — not delivered", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Outcome unknown", tone: "caution" },
};

/**
 * The three reach values a released edition may carry, each under the specification's fixed name:
 * Not public, Shared by link: public, and Listed publicly. `not-public` is invisible, `link-public`
 * is public but unlisted and noindex, and `listed` appears in the discovery index — three different
 * facts that a single "published" flag would collapse.
 *
 * `modules/content/reach` owns the union this aliases, and `RELEASE_REACH_VALUES` on the release
 * record is the single declaration of it, so a fourth reach value fails to compile here.
 *
 * These three labels are the one declaration of the names the specification fixes verbatim, and the
 * reach option names both families show are derived from them: `features/audience/copy/receiving`
 * and `features/ministry-pages/copy` import this map and read `label` from it, so the reach control,
 * the review text, the receiving view and the chip beside them cannot word a setting differently.
 */
export type ReleaseReachStatus = Reach;

/** The label and tone of each reach value. */
export const REACH_STATUS: Readonly<Record<ReleaseReachStatus, StatusBadgeSpec>> = {
  "not-public": { label: "Not public", tone: "neutral" },
  "link-public": { label: "Shared by link: public", tone: "info" },
  listed: { label: "Listed publicly", tone: "positive" },
};

/**
 * The states of a coaching grant episode. Delivery, deliberate acceptance, active access, expiry,
 * revocation, an ended relationship and a coach leaving are separate outcomes, and a superseded
 * invitation stays distinguishable from all of them.
 *
 * The eight stored states are `modules/coaching/grant`'s own: `GRANT_LIFECYCLE_STATES` declares them
 * once, `left` among them, so a ninth stored state fails to compile here until it has a word and a
 * tone. `accepted-but-unavailable` is the one member the lifecycle never stores — it is derived at
 * read time, and its entry below says from what.
 */
export type CoachingGrantStatus = GrantLifecycleState | "accepted-but-unavailable";

/** The label and tone of each grant state. */
export const COACHING_STATUS: Readonly<Record<CoachingGrantStatus, StatusBadgeSpec>> = {
  invited: { label: "Invited — not yet accepted", tone: "info" },
  accepted: { label: "Accepted — access not started", tone: "positive" },
  active: { label: "Active", tone: "positive" },
  revoked: { label: "Revoked", tone: "danger" },
  expired: { label: "Expired", tone: "caution" },
  ended: { label: "Ended", tone: "neutral" },
  left: { label: "Coach left — access closed", tone: "neutral" },
  superseded: { label: "Superseded by a newer invitation", tone: "muted" },
  // Derived at read time, never stored: the acceptance is recorded and the episode's source cannot
  // be read right now, so this states no closure and no access — it stays distinct from `accepted`
  // and from every lifecycle closure.
  "accepted-but-unavailable": { label: "Accepted — access unavailable", tone: "caution" },
};

/**
 * The five recurring outcomes plus `outside-partition`, each with the word the support module already
 * owns and the tone this file adds. The five keep their own words so a total never mixes an outcome
 * with evidence that could not be placed in one.
 */
export const BUCKET_STATUS: Readonly<Record<RecurringBucket, StatusBadgeSpec>> = {
  received: { label: BUCKET_LABELS.received, tone: "positive" },
  processing: { label: BUCKET_LABELS.processing, tone: "info" },
  upcoming: { label: BUCKET_LABELS.upcoming, tone: "neutral" },
  "recovery-needs-attention": {
    label: BUCKET_LABELS["recovery-needs-attention"],
    tone: "caution",
  },
  "not-received": { label: BUCKET_LABELS["not-received"], tone: "danger" },
  "outside-partition": { label: BUCKET_LABELS["outside-partition"], tone: "muted" },
};

/**
 * Every value state except `value`: the five words that say a value is not a plain number. `value`
 * itself carries no word, because a rendered amount states its own meaning.
 */
export type ValueStateWord = Exclude<ValueState, "value">;

/** The word and tone of each value state that must render differently from a number. */
export const VALUE_STATE_WORDS: Readonly<Record<ValueStateWord, StatusBadgeSpec>> = {
  zero: { label: "Zero", tone: "neutral" },
  unknown: { label: "Unknown", tone: "muted" },
  withheld: { label: "Withheld", tone: "caution" },
  unavailable: { label: "Unavailable", tone: "danger" },
  "incomplete-subtotal": { label: "Incomplete subtotal", tone: "info" },
};

/**
 * The word for a value state, or `undefined` when the value is an ordinary one.
 *
 * The state is read from the envelope, never chosen here: `incomplete-subtotal` in particular is
 * derived by `buildEnvelope` from a read's coverage, so no surface decides for itself whether a
 * subtotal is partial. Exported because the same five words must appear in CSV cells, print output
 * and accessible labels, which are not badges.
 */
export function valueStateWord(state: ValueState): StatusBadgeSpec | undefined {
  return state === "value" ? undefined : VALUE_STATE_WORDS[state];
}

/**
 * Reads one member's label and tone out of a vocabulary, so a feature passes the union member it
 * already holds and spreads the result onto {@link StatusBadge} instead of writing a state word.
 *
 *   `<StatusBadge {...statusBadgeProps(BUCKET_STATUS, row.bucketState)} />`
 *
 * The key type is the vocabulary's own, so a member added to a union without a label is a compile
 * error at the call site as well as in the vocabulary.
 */
export function statusBadgeProps<Key extends string>(
  vocabulary: Readonly<Record<Key, StatusBadgeSpec>>,
  key: Key,
): StatusBadgeSpec {
  return vocabulary[key];
}

// ---------------------------------------------------------------------------------------------
// The label
// ---------------------------------------------------------------------------------------------

/** Props of {@link StatusBadge}. */
export interface StatusBadgeProps {
  /**
   * The state word itself — "Draft", "Published", "Withdrawn", "Simulated", "Active". Required: a
   * label whose state lived only in its colour would be invisible to a reader who cannot distinguish
   * the tones, so a state cannot compile without a word.
   */
  label: string;
  /**
   * How the state reads. Defaults to `neutral`; a value state, when supplied, governs the tone
   * instead, because the state of the value is the more specific fact.
   */
  tone?: StatusTone;
  /**
   * The state of the value this label qualifies, as the read envelope recorded it. A member other
   * than `value` appends its own distinguishable word and brings its own tone, so `unknown`,
   * `withheld`, `unavailable`, `zero` and `incomplete-subtotal` can never share one rendering.
   */
  valueState?: ValueState;
  /**
   * A visually hidden lead-in, for a surface where several labels sit in one cell or column and an
   * unqualified word would be ambiguous: a screen reader then hears "status: withdrawn" rather than
   * an orphaned "withdrawn".
   */
  srPrefix?: string;
  /**
   * Caller-supplied spacing, using logical utilities only (`ms-*`, `me-*`, `mt-*`), so a label in a
   * right-to-left row keeps its place.
   */
  className?: string;
}

/**
 * The one status and audience label.
 *
 * Renders a `span` through `Badge`: the visible word always states the condition, the tone only
 * reinforces it, and nothing is ever encoded in colour alone. It holds no state and no client
 * behaviour, so a Server Component and a Client Component render it alike.
 *
 * An empty or whitespace-only label renders nothing at all: a badge with no word would carry its
 * state in its colour, which this component exists to prevent.
 */
export default function StatusBadge({
  label,
  tone = "neutral",
  valueState,
  srPrefix,
  className,
}: StatusBadgeProps) {
  const text = label.trim();
  if (text.length === 0) {
    return null;
  }

  const word = valueState === undefined ? undefined : valueStateWord(valueState);
  const appearance = TONE_APPEARANCE[word === undefined ? tone : word.tone];

  return (
    <Badge variant={appearance.variant} className={cn(appearance.className, className)}>
      {srPrefix === undefined || srPrefix.trim().length === 0 ? null : (
        <span className="sr-only">{`${srPrefix.trim()}: `}</span>
      )}
      {word === undefined ? text : `${text} — ${word.label}`}
    </Badge>
  );
}

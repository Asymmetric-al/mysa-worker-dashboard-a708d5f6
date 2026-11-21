import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { SendOutcomeState } from "@/modules/audience/consent";
import type { MembershipState } from "@/modules/audience/membership";
import type { GrantLifecycleState } from "@/modules/coaching/grant";
import type { Reach } from "@/modules/content/reach";
import type { ValueState } from "@/modules/data-service/envelope";
import { BUCKET_LABELS, type RecurringBucket } from "@/modules/support/buckets";
/** The semantic tone of a label, and the only vocabulary with which a caller says how a state should read. */
export type StatusTone = "neutral" | "info" | "positive" | "caution" | "danger" | "muted";
/** The visible word of a state and the tone that word carries. */
export interface StatusBadgeSpec {
  readonly label: string;
  readonly tone: StatusTone;
}
type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const TONE_APPEARANCE: Readonly<Record<StatusTone, { readonly variant: BadgeVariant; readonly className?: string }>> = {
  neutral: { variant: "secondary" },
  info: { variant: "default" },
  positive: { variant: "secondary", className: "bg-positive text-positive-foreground" },
  caution: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  danger: { variant: "secondary", className: "bg-destructive text-destructive-foreground" },
  muted: { variant: "outline" },
};
// The closed vocabularies this component owns
/** The four states of a membership in one publisher's purpose: `active`, `awaiting-proof`, `off` and `restricted`. */
export type MembershipStatus = MembershipState;
/** The label and tone of each membership state. */
export const MEMBERSHIP_STATUS: Readonly<Record<MembershipStatus, StatusBadgeSpec>> = {
  active: { label: "Active", tone: "positive" },
  "awaiting-proof": { label: "Awaiting proof", tone: "caution" },
  off: { label: "Off", tone: "neutral" },
  restricted: { label: "Restricted", tone: "danger" },
};
/** The three per-recipient send outcomes. */
export type SendStatus = SendOutcomeState;
/** The label and tone of each send outcome. */
export const SEND_STATUS: Readonly<Record<SendStatus, StatusBadgeSpec>> = {
  accepted: { label: "Accepted — not delivered", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Outcome unknown", tone: "caution" },
};
/** The three reach values a released edition may carry, each under the specification's fixed name: Not public, Shared by link: public, and Listed publicly. */
export type ReleaseReachStatus = Reach;
/** The label and tone of each reach value. */
export const REACH_STATUS: Readonly<Record<ReleaseReachStatus, StatusBadgeSpec>> = {
  "not-public": { label: "Not public", tone: "neutral" },
  "link-public": { label: "Shared by link: public", tone: "info" },
  listed: { label: "Listed publicly", tone: "positive" },
};
/** The states of a coaching grant episode. */
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
/** The five recurring outcomes plus `outside-partition`, each with the word the support module already owns and the tone this file adds. */
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
/** Every value state except `value`: the five words that say a value is not a plain number. */
export type ValueStateWord = Exclude<ValueState, "value">;
/** The word and tone of each value state that must render differently from a number. */
export const VALUE_STATE_WORDS: Readonly<Record<ValueStateWord, StatusBadgeSpec>> = {
  zero: { label: "Zero", tone: "neutral" },
  unknown: { label: "Unknown", tone: "muted" },
  withheld: { label: "Withheld", tone: "caution" },
  unavailable: { label: "Unavailable", tone: "danger" },
  "incomplete-subtotal": { label: "Incomplete subtotal", tone: "info" },
};
/** The word for a value state, or `undefined` when the value is an ordinary one. */
export function valueStateWord(state: ValueState): StatusBadgeSpec | undefined {
  return state === "value" ? undefined : VALUE_STATE_WORDS[state];
}
/** Reads one member's label and tone out of a vocabulary, so a feature passes the union member it already holds and spreads the result onto {@link StatusBadge} instead of writing a state word. */
export function statusBadgeProps<Key extends string>(vocabulary: Readonly<Record<Key, StatusBadgeSpec>>, key: Key): StatusBadgeSpec {
  return vocabulary[key];
}
// The label
/** Props of {@link StatusBadge}. */
export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  valueState?: ValueState;
  srPrefix?: string;
  className?: string;
}
/** The one status and audience label. */
export default function StatusBadge({ label, tone = "neutral", valueState, srPrefix, className }: StatusBadgeProps) {
  const text = label.trim();
  if (text.length === 0) {
    return null;
  }
  const word = valueState === undefined ? undefined : valueStateWord(valueState);
  const appearance = TONE_APPEARANCE[word === undefined ? tone : word.tone];
  return (
    <Badge variant={appearance.variant} className={cn(appearance.className, className)}>
      {srPrefix === undefined || srPrefix.trim().length === 0 ? null : <span className="sr-only">{`${srPrefix.trim()}: `}</span>}
      {word === undefined ? text : `${text} — ${word.label}`}
    </Badge>
  );
}

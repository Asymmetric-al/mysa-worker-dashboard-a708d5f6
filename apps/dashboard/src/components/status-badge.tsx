import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { SendOutcomeState } from "@/modules/audience/consent";
import type { MembershipState } from "@/modules/audience/membership";
import type { GrantLifecycleState } from "@/modules/coaching/grant";
import type { TaskStatus } from "@/modules/coaching/taskshare";
import type { Reach } from "@/modules/content/reach";
import type { VariantAudience } from "@/modules/content/variant";
import type { ValueState } from "@/modules/data-service/envelope";
import { BUCKET_LABELS, type RecurringBucket } from "@/modules/support/buckets";
/** The semantic tone of a label, and the only vocabulary with which a caller says how a state should read. */ export type StatusTone = "neutral" | "info" | "positive" | "caution" | "danger" | "muted";
export type StatusBadgeSpec = { readonly label: string; readonly tone: StatusTone };
const TONE_APPEARANCE: Readonly<Record<StatusTone, { readonly variant: NonNullable<ComponentProps<typeof Badge>["variant"]>; readonly className?: string }>> = {
  neutral: { variant: "secondary" },
  info: { variant: "default" },
  positive: { variant: "secondary", className: "bg-positive text-positive-foreground" },
  caution: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  danger: { variant: "secondary", className: "bg-destructive text-destructive-foreground" },
  muted: { variant: "outline" },
};
/** The word and tone of each audience an edition may serve, exhaustive over the content module's closed union so a third audience is a compile error rather than an unlabelled chip. The Updates list, the variant cards, the review panel and the preview read this one record, so one audience is never stated two ways. */
export const AUDIENCE_STATUS: Readonly<Record<VariantAudience, StatusBadgeSpec>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
/** The four states of a membership in one publisher's purpose: `active`, `awaiting-proof`, `off` and `restricted`. */ export type MembershipStatus = MembershipState;
export const MEMBERSHIP_STATUS: Readonly<Record<MembershipStatus, StatusBadgeSpec>> = { active: { label: "Active", tone: "positive" }, "awaiting-proof": { label: "Awaiting proof", tone: "caution" }, off: { label: "Off", tone: "neutral" }, restricted: { label: "Restricted", tone: "danger" } };
export type SendStatus = SendOutcomeState;
export const SEND_STATUS: Readonly<Record<SendStatus, StatusBadgeSpec>> = { accepted: { label: "Accepted — not delivered", tone: "info" }, failed: { label: "Failed", tone: "danger" }, unknown: { label: "Outcome unknown", tone: "caution" } };
/** The three reach values a released edition may carry, each under the specification's fixed name: Not public, Shared by link: public, and Listed publicly. */ export type ReleaseReachStatus = Reach;
export const REACH_STATUS: Readonly<Record<ReleaseReachStatus, StatusBadgeSpec>> = { "not-public": { label: "Not public", tone: "neutral" }, "link-public": { label: "Shared by link: public", tone: "info" }, listed: { label: "Listed publicly", tone: "positive" } };
export type CoachingGrantStatus = GrantLifecycleState | "accepted-but-unavailable";
export const COACHING_STATUS: Readonly<Record<CoachingGrantStatus, StatusBadgeSpec>> = {
  invited: { label: "Invited — not yet accepted", tone: "info" },
  accepted: { label: "Accepted — access not started", tone: "positive" },
  active: { label: "Active", tone: "positive" },
  revoked: { label: "Revoked", tone: "danger" },
  expired: { label: "Expired", tone: "caution" },
  ended: { label: "Ended", tone: "neutral" },
  left: { label: "Coach left — access closed", tone: "neutral" },
  superseded: { label: "Superseded by a newer invitation", tone: "muted" },
  "accepted-but-unavailable": { label: "Accepted — access unavailable", tone: "caution" },
};
/** The five recurring outcomes plus `outside-partition`, each with the word the support module already owns and the tone this file adds. */ export const BUCKET_STATUS: Readonly<Record<RecurringBucket, StatusBadgeSpec>> = {
  received: { label: BUCKET_LABELS.received, tone: "positive" },
  processing: { label: BUCKET_LABELS.processing, tone: "info" },
  upcoming: { label: BUCKET_LABELS.upcoming, tone: "neutral" },
  "recovery-needs-attention": { label: BUCKET_LABELS["recovery-needs-attention"], tone: "caution" },
  "not-received": { label: BUCKET_LABELS["not-received"], tone: "danger" },
  "outside-partition": { label: BUCKET_LABELS["outside-partition"], tone: "muted" },
};
/** Every value state except `value`: the five words that say a value is not a plain number. */ export type ValueStateWord = Exclude<ValueState, "value">;
/** The four states one task can stand in, in the one vocabulary the partner record and the coaching selector both read a task's state by. */
export const TASK_STATUS: Readonly<Record<TaskStatus, StatusBadgeSpec>> = { open: { label: "Open", tone: "info" }, completed: { label: "Completed", tone: "positive" }, reopened: { label: "Reopened", tone: "caution" }, cancelled: { label: "Cancelled", tone: "muted" } };
/** The word and tone of each value state that must render differently from a number. */ export const VALUE_STATE_WORDS: Readonly<Record<ValueStateWord, StatusBadgeSpec>> = {
  zero: { label: "Zero", tone: "neutral" },
  unknown: { label: "Unknown", tone: "muted" },
  withheld: { label: "Withheld", tone: "caution" },
  unavailable: { label: "Unavailable", tone: "danger" },
  "incomplete-subtotal": { label: "Incomplete subtotal", tone: "info" },
};
/** The word for a value state, or `undefined` when the value is an ordinary one. */ export const valueStateWord = (state: ValueState): StatusBadgeSpec | undefined => (state === "value" ? undefined : VALUE_STATE_WORDS[state]);
/** Reads one member's label and tone out of a vocabulary, so a feature passes the union member it already holds and spreads the result onto {@link StatusBadge} instead of writing a state word. */
export const statusBadgeProps = <Key extends string>(vocabulary: Readonly<Record<Key, StatusBadgeSpec>>, key: Key): StatusBadgeSpec => vocabulary[key];
export type StatusBadgeProps = { label: string; tone?: StatusTone; valueState?: ValueState; srPrefix?: string; className?: string };
/** The one status and audience label. */ export default function StatusBadge({ label, tone = "neutral", valueState, srPrefix, className }: StatusBadgeProps) {
  const text = label.trim();
  if (text.length === 0) return null;
  const word = valueState === undefined ? undefined : valueStateWord(valueState);
  const appearance = TONE_APPEARANCE[word === undefined ? tone : word.tone];
  return (
    <Badge variant={appearance.variant} className={cn(appearance.className, className)}>
      {srPrefix === undefined || srPrefix.trim().length === 0 ? null : <span className="sr-only">{`${srPrefix.trim()}: `}</span>}
      {word === undefined ? text : `${text} — ${word.label}`}
    </Badge>
  );
}

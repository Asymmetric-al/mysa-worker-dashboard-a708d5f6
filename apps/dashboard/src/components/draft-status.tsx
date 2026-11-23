import type { ReactNode } from "react";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { translationStaleness, type ContentVariant, type Release, type ReleaseOutcome, type TranslationSourceContext, type VariantAudience, type VariantLocale } from "@/modules/content/variant";
/** Every state an edition can be in, listed once so the closed set has a runtime form as well as a type. */
export const CONTENT_LIFECYCLE_STATES = ["not-started", "draft", "candidate", "approved", "released", "partially-released", "withdrawn", "superseded-head", "stale-translation"] as const;
export type ContentLifecycleState = (typeof CONTENT_LIFECYCLE_STATES)[number];
export type LifecycleSpec = { readonly label: string; readonly tone: StatusTone; readonly explanation: string };
/** The whole lifecycle vocabulary: one exhaustive record over the closed union, so a state added without its word, tone and sentence is a compile error rather than an unlabelled chip. */
export const LIFECYCLE_STATUS: Readonly<Record<ContentLifecycleState, LifecycleSpec>> = {
  "not-started": { label: "Not started", tone: "muted", explanation: "Nothing has been written for this audience and language yet, so there is nothing to review and nothing to read." },
  draft: { label: "Draft", tone: "neutral", explanation: "Saved and unpublished. A saved draft is not a release, so no audience can read it." },
  candidate: { label: "Submitted for review", tone: "info", explanation: "Frozen for its one review step. A reviewer can approve it or ask for changes, and only a release lets an audience read it." },
  approved: { label: "Approved", tone: "positive", explanation: "A reviewer approved this frozen candidate for this audience and language. Approval publishes nothing and notifies nobody: the release is a separate step, and a simulated notice is separate again." },
  released: { label: "Published", tone: "positive", explanation: "Published for this audience and language, so an authorised reader can open the released revision. Releasing sends no message." },
  "partially-released": { label: "Partially released", tone: "caution", explanation: "Published for this audience and language. Another edition in the same release attempt kept its earlier published revision, which was not rolled back." },
  withdrawn: { label: "Withdrawn", tone: "danger", explanation: "No longer available to this audience, and the edition now reads as a tombstone. Withdrawing deleted no source work and recalled no copy a reader already received." },
  "superseded-head": { label: "Superseded", tone: "muted", explanation: "Published once and since replaced by a later release of this edition, so it is no longer the current publication." },
  "stale-translation": { label: "Translation stale", tone: "caution", explanation: "The source revision this translation copied is no longer current. Nothing was withdrawn and nothing needs re-approval, but the translation no longer reflects the source." },
};
export type VariantReleaseOutcome = { readonly variantId: string; readonly outcome: ReleaseOutcome };
/** The facts {@link lifecycleOf} reads besides the two records themselves — both optional, because a surface that has not run a release attempt or shown a translation has neither. */
export type LifecycleEvidence = { readonly synthesis?: readonly VariantReleaseOutcome[]; readonly translationSource?: TranslationSourceContext };
/** The facts of one edition a surface or a read states, as the lifecycle vocabulary reads them: its identity, its audience and language, and its three pointers, any of which may be absent or stated as null. */
export type LifecycleEditionFold = { readonly variantId: string; readonly audience: VariantAudience; readonly locale: VariantLocale; readonly draftRevisionId?: string | null; readonly candidateId?: string | null; readonly releaseHeadId?: string | null };
/** The edition's own record as the lifecycle vocabulary reads it: the three pointers and its audience and language, nothing added. It is the one adapter from an edition view to `ContentVariant`, so a route that states an edition's lifecycle states it from the same record the matrix does rather than folding the pointers a second way. */
export function variantRecordOf(documentId: string, edition: LifecycleEditionFold): ContentVariant {
  const draft = edition.draftRevisionId ?? "";
  const candidate = edition.candidateId ?? "";
  const head = edition.releaseHeadId ?? "";
  // An absent pointer is omitted rather than set to `undefined`, so the record states exactly what the read stated.
  return { variantId: edition.variantId, documentId, audience: edition.audience, locale: edition.locale, ...(draft === "" ? {} : { draftRevisionId: draft }), ...(candidate === "" ? {} : { candidateId: candidate }), ...(head === "" ? {} : { releaseHeadId: head }) };
}
/** Derives the one lifecycle state of an edition from the records the service supplies. */
export function lifecycleOf(variant: ContentVariant, release?: Release, evidence?: LifecycleEvidence): ContentLifecycleState {
  const current = release !== undefined && release.variantId === variant.variantId ? release : undefined;
  if (current !== undefined) {
    if (current.withdrawnAt !== undefined) return "withdrawn";
    if (current.supersededBy !== undefined || (variant.releaseHeadId !== undefined && variant.releaseHeadId !== current.releaseId)) return "superseded-head";
  }
  if (variant.candidateId !== undefined) return "candidate";
  if (current !== undefined) return siblingFailed(variant, evidence) ? "partially-released" : "released";
  if (translationIsStale(variant, evidence)) return "stale-translation";
  return variant.draftRevisionId !== undefined ? "draft" : "not-started";
}
function siblingFailed(variant: ContentVariant, evidence: LifecycleEvidence | undefined): boolean {
  const synthesis = evidence?.synthesis;
  return synthesis === undefined ? false : synthesis.some((entry) => entry.variantId !== variant.variantId && entry.outcome.status === "failed");
}
function translationIsStale(variant: ContentVariant, evidence: LifecycleEvidence | undefined): boolean {
  const source = evidence?.translationSource;
  return source !== undefined && translationStaleness(variant, source).status === "stale";
}
function specFor(state: ContentLifecycleState): LifecycleSpec {
  if (!Object.hasOwn(LIFECYCLE_STATUS, state)) {
    throw new Error(`DraftStatus received a lifecycle state it has no wording for: "${String(state)}". ` + "Every state must state its word, tone and meaning, so add the member to " + "CONTENT_LIFECYCLE_STATES and LIFECYCLE_STATUS instead of passing a value the interface " + "cannot describe.");
  }
  return LIFECYCLE_STATUS[state];
}
function staleDetail(since: string | undefined, locale: string | undefined): ReactNode | null {
  const at = since === undefined ? "" : since.trim();
  const source = locale === undefined ? "" : locale.trim();
  if (source !== "" && at !== "") {
    return (
      <>
        Source edition <bdi>{source}</bdi> changed on <bdi>{at}</bdi>.
      </>
    );
  }
  if (source !== "") {
    return (
      <>
        Source edition <bdi>{source}</bdi> changed after this translation was written.
      </>
    );
  }
  if (at !== "") {
    return (
      <>
        Source changed on <bdi>{at}</bdi>.
      </>
    );
  }
  return null;
}
export type DraftStatusProps = {
  readonly state: ContentLifecycleState;
  readonly staleSince?: string;
  readonly staleLocale?: string;
  /** Whether this surface states the sentence saying what the state permits: a row that states those sentences once under its table turns it off, so no row repeats them. */ readonly explanation?: boolean;
  readonly className?: string;
};
/** The lifecycle indicator: the state word, the concrete staleness detail when there is one, and — unless a dense surface states the sentences once elsewhere — the sentence saying what the state permits. */
export function DraftStatus({ state, staleSince, staleLocale, explanation = true, className }: DraftStatusProps): ReactNode {
  const spec = specFor(state);
  const detail = staleDetail(staleSince, staleLocale);
  return (
    <div data-slot="draft-status" data-lifecycle-state={state} className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge label={spec.label} tone={spec.tone} srPrefix="Status" />
        {detail === null ? null : <span className="text-xs text-muted-foreground text-pretty wrap-anywhere">{detail}</span>}
      </span>
      {explanation ? <p className="type-supporting text-start text-pretty wrap-anywhere">{spec.explanation}</p> : null}
    </div>
  );
}
export default DraftStatus;

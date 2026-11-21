"use client";
/**
 * The one confirmed reopen of a closed initiative, and the evidence a person reads before committing
 * to it.
 *
 * **Why a dialog.** Reopening allows new solicitation again on an initiative whose closure fence was
 * put in place deliberately, so the act is consequential: it asks before it acts, and it reports what
 * happened in the place the person is already reading.
 *
 * **What it composes rather than builds.** The review step, the attempt's identity, the in-flight fence,
 * the confirmation and the durable receipt are `components/action-review`'s — this application's one
 * review-then-accept step (Rule 1 clause 2). The receipt of all eight outcomes is
 * `components/operation-result`'s, rendered by that step; the optional field's label, description and
 * per-field messages are `components/form-field`'s; the modal substrate is `components/ui/dialog`'s,
 * which owns focus containment and focus return. So this file owns no attempt identity, no second
 * confirmation, no second receipt and no validator of its own: the family's `reopenInitiativePayloadSchema`
 * checks the payload in the hook and the service re-checks it.
 *
 * **The one bridge.** The initiatives family's `useReopenInitiative` reports a settled attempt through
 * its published `state` rather than through a promise, while the shared review step submits a promise.
 * `useReopenAttempt` below is the whole of that difference: it dispatches the family's hook and resolves
 * with the outcome that hook settled on, verbatim. It starts no second request, keeps no second copy of
 * the outcome and holds no cache policy of its own — the hook keeps the family's single invalidation
 * policy, and that invalidation is what makes the surface behind this dialog re-read.
 *
 * **What reopening keeps, shown before it happens.** A reopen preserves the earlier closure — its
 * disposition and the fact that it happened — and it preserves the current exclusions, so a partner
 * marked not eligible never rejoins the working list. Those statements are evidenced from the read this
 * dialog was given instead of asserted: the recorded disposition, the initiative's lifecycle, the count
 * of exclusions and, where the page in view holds them, the recorded instant of each exclusion. Reopening
 * creates no Request, no presentation, no task and no message, and it re-asks nobody.
 *
 * **What it does not compute.** No date, no duration since the closure and no outcome is derived here:
 * the read supplies every fact and this file states it. A fact the read does not supply is shown as
 * unstated rather than invented, and a stale attempt stays a stale attempt — a `conflict`, a `denied` or
 * an `unchanged` answer is reported as what it is and is never retried on its own.
 *
 * **Accessibility.** The body is one column at 320 CSS px and never scrolls the page sideways, every
 * control is at least 24x24 CSS px, nothing needs a drag, and every colour, radius and space resolves to
 * a token declared once in `styles/globals.css`. The optional field says the word "optional" in both its
 * label and its description, and it takes `aria-invalid` / `aria-describedby` from `FormField`. The
 * confirmation's safe default and the focus move to a settled receipt belong to the shared step.
 *
 * **Layering.** `features/initiatives → components → components/ui`. It imports no store, no time module,
 * no money module, no report engine and no second transport: the one POST is the family hook's.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationOutcome, Scope, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_STATE_COPY, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, dispositionFallback } from "../copy";
import { useReopenInitiative } from "../hooks/use-initiative-mutations";
import type { ReopenInitiativePayload } from "../schemas/closure";
// The contract: the detail read's own envelope, so the evidence below is the read's and not a shape
// this file invented. `revision` is the revision a change must present, and `scope` is the authority
// the read ran under.
type InitiativeEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];

type InitiativeDetail = InitiativeEnvelope["data"];

type InitiativeView = InitiativeDetail["initiative"];

type WorkingListEntry = InitiativeDetail["workingList"]["items"][number];

type InitiativeLifecycle = InitiativeView["lifecycle"];
/** The sentences this dialog owns. The shared closure wording stays in `../copy`, which this file reads rather than restates. */
const REOPEN_COPY = {
  reviewHeading: "Review this reopen",
  evidenceHeading: "What reopening keeps",
  earlierClosureTerm: "Earlier closure",
  exclusionCountSuffix: "on the working list. Each one stays as it stands and does not rejoin the working list.",
  noExclusions: "No partner is marked not eligible right now, so no exclusion is at stake and none is added.",
  exclusionsKept: "A partner marked not eligible before the initiative closed stays not eligible: reopening does not put them back on the working list.",
  excludedListLabel: "Partners marked not eligible, with the recorded instant of that decision",
  recordedInstantNote: "Recorded when the exclusion was decided, exactly as the read supplies it.",
  noReason: "No reason given, and none is required.",
  reasonTerm: "Reason given",
  noSolicitation: "Reopening creates no new solicitation: it creates no Request and no presentation, it re-sends nothing and it re-asks nobody.",
  noRecords: "It also creates no task and no message, and it leaves every recorded response and every amount of requested terms untouched.",
  reasonLabel: "Reason",
  reasonDescription: "Optional. Say why this initiative is reopening. Leave it empty if you have nothing to add: an empty reason is accepted, and nothing is read into it later.",
  mismatchBody:
    "This dialog was given one initiative's details and another initiative's identifier, so it offers no change: submitting either one would have reopened the wrong record. Close it and reopen the initiative from its own page.",
  discardBody: "Nothing has been sent yet, so the reason you typed is not recorded anywhere. Closing this dialog discards it.",
  keepEditingLabel: "Keep editing",
  discardLabel: "Discard the reason",
  reopenedStatement: "This initiative is open again. The earlier closure and its disposition stay recorded, and every partner marked not eligible stays excluded.",
} as const;
const DIALOG_TITLE = CLOSURE_COPY.reopenHeading;

const CONFIRM_LABEL = CLOSURE_COPY.reopenHeading;

const FACT_TERM_CLASS = "text-muted-foreground";
/** What the read says about the closure, in the reader's words — never a claim stronger than the read. */
function lifecycleNoteOf(lifecycle: InitiativeLifecycle): string {
  switch (lifecycle) {
    case "closed":
      return "The initiative is closed now. That closure is the record this attempt adds to rather than replaces.";
    case "reopened":
      return "This initiative was closed before and reopened. That earlier closure is the history this attempt keeps.";
    case "open":
      return "The read states this initiative is already open, so reopening it has nothing to apply and the attempt will answer so.";
  }
}
/** The recorded instant at which this partner was last marked not eligible, or `null` when the read holds no such entry. */
function exclusionInstantOf(entry: WorkingListEntry): string | null {
  let instant: string | null = null;
  for (const step of entry.history) {
    if (step.state === "excluded") {
      instant = step.at;
    }
  }
  return instant;
}
function EvidenceFact({ term, children }: { readonly term: string; readonly children: ReactElement }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className={FACT_TERM_CLASS}>{term}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}
/** One preserved exclusion, with the instant the read recorded for it, so the statement is evidenced rather than asserted. */
function PreservedExclusion({ entry }: { readonly entry: WorkingListEntry }): ReactElement {
  const instant = exclusionInstantOf(entry);
  return (
    <li className="min-w-0 wrap-anywhere">
      <bdi>{entry.partnerDisplayName}</bdi>
      {instant === null ? null : (
        <>
          <span aria-hidden="true">{" — "}</span>
          <bdi>
            <time className="tabular-figures" dateTime={instant}>
              {instant}
            </time>
          </bdi>
        </>
      )}
    </li>
  );
}
/**
 * The evidence a person reads before they commit: the closure that will stay recorded, the exclusions
 * that will stay excluded, and the things reopening will not create.
 *
 * Everything here comes from the supplied read. A read that holds no closure date is shown as stating
 * none, because a date this file computed would be a claim about a record it cannot see.
 */
function PreservedEvidence({ detail }: { readonly detail: InitiativeDetail }): ReactElement {
  const headingId = useId();
  const initiative = detail.initiative;
  const excluded = detail.workingList.items.filter((entry) => entry.state === "excluded");
  const exclusionCount = initiative.memberStates.excluded;
  // A closure the read records no disposition for is shown as unstated: the raw token is never rendered
  // in its place, and no disposition is guessed for a record that carries none.
  const disposition = initiative.closureDisposition === null ? REQUESTED_TERMS_COPY.notStated : dispositionFallback(initiative.closureDisposition);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-heading text-sm leading-none font-medium">
          {REOPEN_COPY.evidenceHeading}
        </h3>
        <Badge variant="secondary">{INITIATIVE_STATE_COPY[initiative.state].label}</Badge>
      </div>
      <dl className="flex min-w-0 flex-col gap-1.5 text-sm">
        <EvidenceFact term={CLOSURE_COPY.dispositionLabel}>
          <bdi>{disposition}</bdi>
        </EvidenceFact>
        <EvidenceFact term={REOPEN_COPY.earlierClosureTerm}>
          <span className="text-pretty">{lifecycleNoteOf(initiative.lifecycle)}</span>
        </EvidenceFact>
        <EvidenceFact term={MEMBERSHIP_STATE_COPY.excluded.label}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="tabular-figures font-medium">{String(exclusionCount)}</span>
            <span className={cn("text-pretty", exclusionCount === 0 && "text-muted-foreground")}>{exclusionCount === 0 ? REOPEN_COPY.noExclusions : REOPEN_COPY.exclusionCountSuffix}</span>
          </span>
        </EvidenceFact>
      </dl>
      {excluded.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <ul aria-label={REOPEN_COPY.excludedListLabel} className="flex min-w-0 flex-col gap-1 text-sm">
            {excluded.map((entry) => (
              <PreservedExclusion key={entry.memberId} entry={entry} />
            ))}
          </ul>
          <p className="text-xs text-pretty text-muted-foreground">{REOPEN_COPY.recordedInstantNote}</p>
        </div>
      )}
      <p className="text-sm text-pretty text-muted-foreground">{CLOSURE_COPY.historyPreservedNote}</p>
      <p className="text-sm text-pretty text-muted-foreground">{REOPEN_COPY.exclusionsKept}</p>
      <Separator />
      <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
        <p>{REOPEN_COPY.noSolicitation}</p>
        <p>{REOPEN_COPY.noRecords}</p>
      </div>
    </section>
  );
}

/** What the shared step needs from this file: one submit that resolves with the service's answer. */
interface ReopenAttempt {
  readonly submit: MutationSubmit<ReopenInitiativePayload>;
}
/**
 * The family hook's handle as the review step's submit contract: dispatch through
 * `useReopenInitiative`, resolve with the outcome it settles on.
 *
 * The hook is the one owner of the request, of the family's payload validation and of the cache
 * invalidation a standing change makes necessary, so routing through it — rather than posting the same
 * route a second way — is what keeps one policy for this family. It reports a settled attempt through
 * its published `state` instead of returning a promise, which is the only thing bridged here: the
 * resolver waits for that state and is handed the outcome verbatim. The shared step's own in-flight
 * fence means one submission is in flight at a time, so at most one resolver is ever waiting.
 */
function useReopenAttempt(scope: Scope): ReopenAttempt {
  const reopen = useReopenInitiative(scope);
  const waiting = useRef<{ readonly resolve: (outcome: MutationOutcome) => void } | null>(null);
  const state = reopen.state;
  const settled = state.status === "settled" ? state.outcome : null;
  useEffect(() => {
    if (settled === null) {
      return;
    }
    const pending = waiting.current;
    if (pending === null) {
      return;
    }
    waiting.current = null;
    pending.resolve(settled);
  }, [settled]);
  const dispatch = reopen.submit;
  const submit = useCallback<MutationSubmit<ReopenInitiativePayload>>(
    (input) =>
      new Promise<MutationOutcome>((resolve) => {
        waiting.current = { resolve };
        dispatch({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatch],
  );
  return { submit };
}
/**
 * What a settled answer means for this dialog: whether the initiative now stands open, and therefore
 * whether the surface behind the dialog is told to re-read.
 *
 * Every one of the eight outcomes is answered separately because the differences matter.
 * `accepted` applied the reopen once. `alreadyAccepted` means this same attempt had already done so and
 * the service returned its stored result, so the initiative is open either way and neither answer is a
 * second effect. `unchanged` means the initiative was already open and nothing was written: it is a
 * legitimate answer, it is reported as "nothing to change", and it is never presented as a reopen.
 * `conflict` means a later change overtook this attempt, so the surface behind the dialog is not told
 * anything happened — the attempt is kept beside the current value, and re-applying is the person's own
 * deliberate act. `denied` reveals nothing beyond its reason code, so nothing is inferred from it.
 * `invalid` refused the payload before any effect. `unavailable` reached no effect and offers the same
 * request again. `unknown` may or may not have been applied, so no claim is made in either direction:
 * the attempt's own identity is what answers later, and resending it is the same operation rather than
 * a second reopen.
 */
function reopensBy(outcome: MutationOutcome): boolean {
  switch (outcome.outcome) {
    case "accepted":
      return true;
    case "alreadyAccepted":
      return true;
    case "unchanged":
      return false;
    case "conflict":
      return false;
    case "denied":
      return false;
    case "invalid":
      return false;
    case "unavailable":
      return false;
    case "unknown":
      return false;
    default:
      return assertNever(outcome, "Unhandled reopen outcome");
  }
}
/** The two things the dialog body can be showing: the reviewed change, or the question it asks before throwing away a typed reason. */
type DialogPhase = "review" | "confirming-discard";
/** What the last settled attempt means for this dialog, kept as facts rather than as a copy of the outcome the shared step already holds. */
interface AttemptProgress {
  readonly attempted: boolean;
  readonly reopened: boolean;
}

const INITIAL_PROGRESS: AttemptProgress = { attempted: false, reopened: false };

const FIELD_LABELS: Readonly<Record<string, string>> = {
  initiativeId: "Initiative",
  reason: REOPEN_COPY.reasonLabel,
};

/** Props of {@link ReopenInitiativeDialog}. */
export interface ReopenInitiativeDialogProps {
  /** Whether the dialog is open; the caller owns it, so the page decides when a reopen is offered. */
  readonly open: boolean;
  /** Asks the caller to open or close the dialog. A close waits for the body's answer when a typed reason would be discarded. */
  readonly onOpenChange: (open: boolean) => void;
  /** The initiative this dialog reopens: the identifier the payload carries and the subject the read presents. */
  readonly initiativeId: string;
  /** The detail read the dialog evidences itself with: its scope, the revision a change must present, and the closure history. */
  readonly envelope: InitiativeEnvelope;
  /** Told once an attempt has left the initiative open, so the page can re-read what the service now holds. */
  readonly onReopened?: () => void;
}
/** Whether the body kept the dialog open to ask about a typed reason; `true` means it did. */
type CloseGuard = () => boolean;
/** Props of the dialog's body, which holds the whole of one visit's state. */
interface ReopenInitiativeBodyProps {
  readonly initiativeId: string;
  readonly envelope: InitiativeEnvelope;
  readonly registerCloseGuard: (guard: CloseGuard | null) => void;
  readonly onClose: () => void;
  readonly onReopened?: () => void;
}
/**
 * The dialog's body and the whole of one visit's state.
 *
 * It is mounted inside the dialog's content, which the modal substrate renders while the dialog is open
 * and unmounts when it closes. A visit therefore begins with an empty reason, the review step in front of
 * the field and the revision the read states — because the body is mounted, not because something reset
 * it afterwards.
 *
 * While the visit lasts, the revision this step presents is frozen at the one the read stated when it
 * opened: that is the revision the attempt names, so the receipt of an accepted reopen survives the
 * re-read that reopen itself triggers. Re-deriving it from refreshed props would make the shared step
 * treat its own record as a different attempt and drop what the person is still reading. A record that
 * has genuinely moved on is answered as a `conflict`, which the shared step offers to re-apply against
 * the revision the conflict reports.
 *
 * The field is one optional reason held in local state rather than in a form library: one control with
 * one optional value is not a form, and the schema that judges its payload is the family's own. Its value
 * survives every failure, because WCAG 3.3.7 asks that nobody re-enters what they already typed, and a
 * close that would discard it asks first.
 */
function ReopenInitiativeBody({ initiativeId, envelope, registerCloseGuard, onClose, onReopened }: ReopenInitiativeBodyProps): ReactElement {
  const { submit } = useReopenAttempt(envelope.scope);
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<DialogPhase>("review");
  const [progress, setProgress] = useState<AttemptProgress>(INITIAL_PROGRESS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorLookup | null>(null);
  const [expectedRevision] = useState(envelope.revision);
  /* The payload states the initiative and, only when one was typed, the reason: an empty reason is left
   * out entirely rather than sent as a blank string, so no later reader can take one as a note. */
  const payload = useMemo<ReopenInitiativePayload>(() => (reason.trim() === "" ? { initiativeId } : { initiativeId, reason: reason.trim() }), [initiativeId, reason]);
  const input = useMemo(() => ({ scope: envelope.scope, expectedRevision, payload }), [envelope.scope, expectedRevision, payload]);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setFieldErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      const reopened = reopensBy(outcome);
      setProgress({ attempted: true, reopened });
      if (reopened) {
        onReopened?.();
      }
    },
    [onReopened],
  );
  /* A reason typed and not yet sent is worth one question before it disappears. Once an attempt has
   * settled, that reason belongs to a recorded attempt, so closing discards only the receipt. */
  const keepOpenForUnsentReason = useCallback((): boolean => {
    if (phase === "review" && !progress.attempted && reason.trim() !== "") {
      setPhase("confirming-discard");
      return true;
    }
    return false;
  }, [phase, progress.attempted, reason]);
  const requestClose = useCallback((): void => {
    if (keepOpenForUnsentReason()) {
      return;
    }
    onClose();
  }, [keepOpenForUnsentReason, onClose]);
  /* The modal substrate's own ways out — the close control, Escape and the backdrop — reach the wrapper,
   * which asks the open body first, so a typed reason is never discarded by a keystroke. */
  useEffect(() => {
    registerCloseGuard(keepOpenForUnsentReason);
    return () => {
      registerCloseGuard(null);
    };
  }, [keepOpenForUnsentReason, registerCloseGuard]);
  const initiative = envelope.data.initiative;
  /* A dialog given one initiative's read and another initiative's identifier offers no change at all: the
   * revision it would present belongs to a record the payload does not name. */
  const mismatched = initiative.initiativeId !== initiativeId;
  function renderDiscardQuestion(): ReactElement {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-pretty">{REOPEN_COPY.discardBody}</p>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              setPhase("review");
            }}
          >
            {REOPEN_COPY.keepEditingLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {REOPEN_COPY.discardLabel}
          </Button>
        </DialogFooter>
      </div>
    );
  }
  function renderReview(): ReactElement {
    return (
      <>
        <PreservedEvidence detail={envelope.data} />
        <FormField name="reason" label={REOPEN_COPY.reasonLabel} description={REOPEN_COPY.reasonDescription} optionalHint error={fieldErrors?.byField.reason}>
          {(field) => (
            <Textarea
              id={field.id}
              name="reason"
              rows={3}
              value={reason}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid ? true : undefined}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
        <ActionReview<ReopenInitiativePayload>
          title={REOPEN_COPY.reviewHeading}
          headingLevel={3}
          consequential
          description={
            <>
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <bdi className="font-medium text-foreground">{initiative.name}</bdi>
                <span>{CLOSURE_COPY.reopenHelp}</span>
              </p>
              <p>
                {`${REOPEN_COPY.reasonTerm}: `}
                <bdi>{reason.trim() === "" ? REOPEN_COPY.noReason : reason.trim()}</bdi>
              </p>
            </>
          }
          consequence={
            <>
              <p>{CLOSURE_COPY.historyPreservedNote}</p>
              <p>{REOPEN_COPY.exclusionsKept}</p>
            </>
          }
          confirmLabel={CONFIRM_LABEL}
          onCancel={requestClose}
          input={input}
          submit={submit}
          onSettled={handleSettled}
          fieldLabels={FIELD_LABELS}
        />
        {/* The receipt above announces the change; this sentence announces what the initiative's state now
         * is, which is the fact this dialog exists to report and the one the surface behind it shows. */}
        {progress.reopened ? <output className="block text-sm text-pretty">{REOPEN_COPY.reopenedStatement}</output> : null}
      </>
    );
  }
  function renderBody(): ReactElement {
    if (mismatched) {
      return <p className="text-sm text-pretty text-muted-foreground">{REOPEN_COPY.mismatchBody}</p>;
    }
    return phase === "confirming-discard" ? renderDiscardQuestion() : renderReview();
  }
  return <div className="flex min-w-0 flex-col gap-5">{renderBody()}</div>;
}
/**
 * The confirmed reopen of a closed initiative.
 *
 * The wrapper owns the modal substrate and the decision to close, and nothing else: the subscription to
 * the family's mutation, the field, the review step and the receipt all live in the body, whose lifetime
 * is the visit. The one thing it holds is the body's answer to "would closing now discard something?",
 * because the substrate's close control, Escape and the backdrop bypass the body's own controls and the
 * question still has to be asked.
 */
export function ReopenInitiativeDialog({ open, onOpenChange, initiativeId, envelope, onReopened }: ReopenInitiativeDialogProps): ReactElement {
  const closeGuard = useRef<CloseGuard | null>(null);
  const registerCloseGuard = useCallback((guard: CloseGuard | null): void => {
    closeGuard.current = guard;
  }, []);
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        onOpenChange(true);
        return;
      }
      if (closeGuard.current?.() === true) {
        return;
      }
      onOpenChange(false);
    },
    [onOpenChange],
  );
  const close = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-slot="reopen-initiative-dialog">
        <DialogHeader>
          <DialogTitle>{DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{CLOSURE_COPY.reopenHelp}</DialogDescription>
        </DialogHeader>
        <ReopenInitiativeBody initiativeId={initiativeId} envelope={envelope} registerCloseGuard={registerCloseGuard} onClose={close} onReopened={onReopened} />
      </DialogContent>
    </Dialog>
  );
}
export default ReopenInitiativeDialog;

"use client";

/**
 * The one review-then-accept step, and the one owner of an attempt's identity.
 *
 * AAP 0.3.4 makes "action review and result" a shared concern with exactly one implementation, and
 * 0.6.4 requires that "consequential actions go through the shared review step; every result renders
 * in place with its outcome, per-item detail and recovery action". This file is that step. Every
 * consequential mutation in the application confirms through it — import acceptance, the three bulk
 * actions, publish, notify, coaching sharing, the goal save, a media placement change, a review
 * decision and the development runtime's reset — so one set of words, one confirmation shape and one
 * recovery route serve all of them instead of a dozen hand-written dialogs drifting apart.
 *
 * What it owns, and why each part has to be here rather than in a feature:
 *
 * - **Attempt identity.** AAP 0.7.1 makes `operationId` "the identity of the attempt", and replaying
 *   it must return the stored result instead of applying a second effect. That rule only holds if
 *   something mints exactly one identity per *intent*. {@link useReviewedMutation} does: it reuses
 *   the identity while the intent (scope, expected revision, payload) is unchanged, mints a fresh one
 *   the moment the intent genuinely changes, and hands a retry the same identity so the service
 *   answers `alreadyAccepted`. This is the only place in the client that decides an attempt's
 *   identity; a feature that minted its own would be a second owner of the same rule.
 * - **The in-flight fence.** A second activation of confirm while a request is running joins the
 *   request already in flight instead of dispatching another. Two attempts from one press is exactly
 *   the duplicate the `operationId` contract exists to prevent.
 * - **The two-part composition.** A review body that says what will happen, and the receipt that
 *   says what did. They are rendered together and never replace each other silently, because a
 *   `conflict`, an `unavailable` or an `invalid` answer is only correctable with the reviewed input
 *   still on screen.
 *
 * What it refuses to do. It builds no URL, fetches nothing and holds no copy of a record: the
 * mutation transport is supplied by the consuming feature as `submit`, so the one route-handler call
 * path stays in the feature and this file holds only the review contract. It formats no amount — a
 * goal-save step receives text the money module already produced inside its `description` — and it
 * computes no total. It offers no "schedule this", "queue for delivery" or "publish later" control,
 * because this release has no scheduler, no queue and no provider (Rule 1 clause 1). It never claims
 * that a message was recalled, a third-party copy withdrawn or a payment taken.
 *
 * Outcomes are rendered, never re-derived. All eight members of `MutationOutcome` are handed to
 * `OperationResult`, which is the application's single receipt; the mapping from a thrown fault to
 * `unavailable` or `unknown` is the service's (`outcomeFromError` in `modules/data-service/outcome`),
 * so this file imports that mapping rather than inventing a second one. Because that receipt already
 * renders the one validation summary for the `invalid` arm, this file composes no second announcement
 * of the same failure — one failure speaks once.
 *
 * Confirmation is proportionate to consequence. A reversible action confirms inline with one press.
 * A `consequential` action confirms through the design system's alert dialog, which names what is
 * about to happen, traps focus, returns it to the trigger, closes on Escape, and puts the safe choice
 * first in the DOM so the destructive control is never the one that receives focus on open. Nothing
 * here needs a drag, a swipe or a press-and-hold (WCAG 2.5.7), and every control is at least 24x24
 * CSS px (WCAG 2.5.8).
 *
 * Announced once, and durably. The review body is static text and no live region, so mounting it
 * announces nothing; the receipt announces its own outcome at the priority `OperationResult` decides,
 * and this file moves the reading position to it after an outcome other than `invalid` (whose summary
 * takes focus itself) because the confirm control becomes disabled while the attempt is in flight and
 * a keyboard user would otherwise land back at the document body. No receipt disappears on a timer.
 *
 * Accessibility and direction. The step is a labelled region with a real heading element at the level
 * the surrounding page needs, the review content precedes the controls in DOM order, and every count
 * and opaque identifier renders inside `<bdi>` so a leading zero or a mixed-direction neighbour cannot
 * reorder it. Only logical utilities are used (`ms-*`, `ps-*`, `text-start`), so an RTL block mirrors
 * itself without a `direction` property here. Every colour, radius, shadow and space value resolves to
 * a token declared once in `styles/globals.css`, and the design system's transitions honour
 * `prefers-reduced-motion`, so perceiving the result needs no animation.
 *
 * Layering: this file sits in the shared component layer, above `components/ui` and the two contract
 * modules and below every feature. It imports no feature, no store, no service and no HTTP client.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import OperationResult from "@/components/operation-result";
import SimulationLabel, { type SimulatedEffect } from "@/components/simulation-label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { newOperationId } from "@/lib/ids";
import type { MutationInput } from "@/modules/data-service/envelope";
import { isOutcome, outcomeFromError, type MutationOutcome } from "@/modules/data-service/outcome";

/**
 * The sentence every review body states about its own reach.
 *
 * It is true of this step regardless of the mutation behind it: the step applies the change the
 * summary describes and nothing else. A step that *does* request a notice (publish and notify,
 * coaching sharing) names that in its own summary, which is why the sentence defers to the summary
 * rather than promising that no notice is ever sent. Publication, provider acceptance and delivery
 * stay three separate facts (AAP 0.8.5), and this sentence never merges them.
 */
const CONTAINMENT_SENTENCE =
  "Confirming applies this change once. Nothing outside the summary above changes: this step sends " +
  "no notice, creates no financial record and subscribes no one unless the summary names it.";

/** What the confirmation dialog adds before the facts: the change takes effect on confirm. */
const CONFIRM_EFFECT_SENTENCE = "It takes effect as soon as you confirm it.";

/** Said instead of the controls once a success outcome has settled this attempt. */
const SETTLED_SENTENCE =
  "This step is complete for this attempt. The result below is its record, and it stays on this page.";

/** Said when a selection exists but holds nothing, so the confirm control is unavailable. */
const NOTHING_SELECTED_SENTENCE =
  "Nothing is selected, so this step has nothing to apply. Select at least one row in the list, then " +
  "return here.";

/** How a count renders: isolated from the surrounding direction, aligned on the decimal. */
const COUNT_CLASS = "tabular-figures font-medium text-foreground";

/** The heading elements the surrounding page can need; the level is the caller's, not the step's. */
const STEP_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** The heading level a step renders at when the caller states none. */
export type ReviewHeadingLevel = keyof typeof STEP_HEADING_TAG;

/**
 * The identity of one attempt, as the hook holds it: the `operationId` the service recognises, and
 * the intent fingerprint it was minted for (`null` until a submission states that intent).
 *
 * Both members are opaque. The `operationId` is never derived from the intent — it is random, so
 * two identical submissions made deliberately still carry distinguishable identities — and the
 * fingerprint is an implementation detail used only to decide whether the identity may be reused.
 */
export interface ReviewedAttempt {
  /** The canonical identifier the service replays by. */
  readonly operationId: string;
  /** The intent this identity was minted for, or `null` before the first submission. */
  readonly intent: string | null;
}

/**
 * Renders a value as a canonical string so two intents can be compared exactly.
 *
 * Object keys are sorted and every leaf is serialised by its own kind, so the same intent built by
 * two call sites — or by the same one after a re-render reordered its keys — yields the same string.
 * `undefined` becomes `null` rather than being dropped, so a payload that loses a key changes the
 * fingerprint instead of colliding with one that never had it. The value is a comparison key only:
 * nothing parses it back, and nothing derives an identifier from it.
 */
function canonicalIntent(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
    case "boolean":
      return value ? "true" : "false";
    case "object":
      break;
    default:
      return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalIntent(record[key])}`);
  return `{${fields.join(",")}}`;
}

/**
 * The stable fingerprint of one intent: the context, the revision the caller saw, and the payload.
 *
 * All three belong to it. The same payload submitted against a different revision is a genuinely
 * different intent — that is exactly what a deliberate re-apply after a `conflict` is — so it must
 * not inherit the previous attempt's identity. The `operationId` is deliberately absent, because it
 * is what this function's caller decides.
 */
export function intentKeyOf(input: Omit<MutationInput<unknown>, "operationId">): string {
  return canonicalIntent(input);
}

/**
 * The identity an attempt must carry, given the identity already held and the intent submitted now.
 *
 * Returns the identity unchanged when the intent matches, which is what makes a retry of the same
 * work a replay rather than a second effect, and mints a fresh one when the intent differs. `mint` is
 * injectable so the rule can be exercised without a Web Crypto global, and so nothing else in the
 * application has to know how an identifier is produced.
 */
export function attemptForIntent(
  current: ReviewedAttempt | null,
  intent: string,
  mint: () => string = newOperationId,
): ReviewedAttempt {
  if (current !== null && current.intent === intent) {
    return current;
  }
  return { operationId: mint(), intent };
}

/**
 * Whether an outcome leaves the same operation worth replaying.
 *
 * Only the two outcomes whose effect is unknown or was never applied qualify: an `unavailable` source
 * may have come back, and an `unknown` acknowledgement may be recoverable by asking the service for
 * the same identity. A settled outcome has nothing to replay, and a refusal or a stale revision is
 * corrected by changing the request, which produces a new intent and therefore a new identity.
 */
export function mayReplay(outcome: MutationOutcome | null): boolean {
  return outcome !== null && (outcome.outcome === "unavailable" || outcome.outcome === "unknown");
}

/**
 * The revision a conflict's preserved input may be re-applied against, or `null` when there is no
 * conflict to re-apply.
 *
 * It reads the service's own `currentRevision` and nothing else: the value the person saw is never
 * guessed, and the preserved payload is never re-sent against the stale revision it originally
 * named. Re-applying against this revision is a new intent, so it mints a new attempt identity.
 */
export function reappliableRevision(outcome: MutationOutcome | null): string | null {
  return outcome !== null && outcome.outcome === "conflict" ? outcome.currentRevision : null;
}

/** The mutation transport a feature supplies: the one route-handler call, in the feature's hands. */
export type MutationSubmit<P> = (input: MutationInput<P>) => Promise<MutationOutcome>;

/** What {@link useReviewedMutation} hands back to the step that renders it. */
export interface UseReviewedMutationResult<P> {
  /**
   * The identity of the attempt the step holds: `null` until the first submission mints it, then the
   * identity the last submission carried and the next one will reuse while its intent is unchanged.
   *
   * It is minted by a submission rather than by the hook's first render because an identity is a random
   * value: producing one while rendering would give the server render and the hydration two different
   * identities for one mounted step, which React reports as a hydration mismatch on any attribute that
   * shows it.
   */
  readonly operationId: string | null;
  /** `true` only while a request is in flight, so the caller can state the busy condition once. */
  readonly pending: boolean;
  /** The last outcome, or `null` before the first submission settles. */
  readonly outcome: MutationOutcome | null;
  /** Submits one intent, reusing the identity when the intent is unchanged. */
  submit(input: Omit<MutationInput<P>, "operationId">): Promise<MutationOutcome>;
  /** Replays the last intent under its own identity; `null` when there is nothing to replay. */
  retry(): Promise<MutationOutcome | null>;
  /** Re-applies the last intent against a conflict's current revision; `null` when none applies. */
  reapply(): Promise<MutationOutcome | null>;
  /** Discards the last outcome and drops the attempt identity, so the next intent mints a fresh one. */
  reset(): void;
}

/**
 * Owns the attempt identity, the in-flight fence and the last outcome of one reviewed mutation.
 *
 * One identity per intent: the first submission mints it, a retry of the same intent keeps it, and a
 * changed intent mints a new one. That is the whole rule, and it is the reason `alreadyAccepted` can be
 * trusted — the service recognises the replay by identity rather than by guessing from a repeated
 * payload. Nothing is minted before a submission exists, because an identity is random and a value
 * produced by a render would differ between the server render and the hydration of one mounted step.
 *
 * The fence is a ref, not the state flag: a second activation in the same tick would otherwise see
 * the pre-update `pending` value and dispatch a second request. `submit` returns the promise already
 * in flight in that case, so a caller that awaits twice still ends up with one effect and one result.
 *
 * A thrown fault never becomes a crash and never becomes success: it is mapped by the service's own
 * `outcomeFromError`, which answers `unavailable`, `denied`, `invalid` or `unknown` and nothing else.
 * A response that is not one of the eight outcomes is treated the same way, because a body the
 * contract cannot read leaves the effect's fate genuinely unknown.
 */
export function useReviewedMutation<P = unknown>(
  submit: MutationSubmit<P>,
): UseReviewedMutationResult<P> {
  /* The consumer's transport may be an inline arrow that changes identity on every render, so it is
   * read through a ref: the callbacks this hook returns stay stable, and no effect re-runs because a
   * feature re-rendered. */
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  /* No attempt before the first submission: an identity is random, so minting one here would run on
   * the server render and again during hydration and hand one mounted step two different identities. */
  const [attempt, setAttempt] = useState<ReviewedAttempt | null>(null);
  const attemptRef = useRef<ReviewedAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const outcomeRef = useRef<MutationOutcome | null>(null);
  const inputRef = useRef<Omit<MutationInput<P>, "operationId"> | null>(null);
  const inFlightRef = useRef<Promise<MutationOutcome> | null>(null);

  /** Takes a new identity into both the ref and the state, so display and dispatch never disagree. */
  const adopt = useCallback((next: ReviewedAttempt | null): ReviewedAttempt | null => {
    attemptRef.current = next;
    setAttempt(next);
    return next;
  }, []);

  const submitInput = useCallback(
    (input: Omit<MutationInput<P>, "operationId">): Promise<MutationOutcome> => {
      const running = inFlightRef.current;
      if (running !== null) {
        return running;
      }

      /* The first submission mints the identity; a retry of the same intent keeps it, and a changed
       * intent mints a new one. */
      const identity = attemptForIntent(attemptRef.current, intentKeyOf(input));
      adopt(identity);
      inputRef.current = input;
      pendingRef.current = true;
      setPending(true);

      const request: MutationInput<P> = {
        operationId: identity.operationId,
        scope: input.scope,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      };

      const finish = (result: MutationOutcome): MutationOutcome => {
        pendingRef.current = false;
        outcomeRef.current = result;
        setPending(false);
        setOutcome(result);
        return result;
      };

      const run = (async (): Promise<MutationOutcome> => {
        try {
          const answered: unknown = await submitRef.current(request);
          return finish(
            isOutcome(answered) ? answered : outcomeFromError(identity.operationId, answered),
          );
        } catch (error) {
          return finish(outcomeFromError(identity.operationId, error));
        }
      })();

      /* Cleared on the promise's own settlement rather than inside the body: a transport that threw
       * before its first `await` would otherwise leave the fence holding a promise that had already
       * finished, and every later submission would join it and never dispatch. */
      const tracked: Promise<MutationOutcome> = run.finally(() => {
        inFlightRef.current = null;
      });
      inFlightRef.current = tracked;
      return tracked;
    },
    [adopt],
  );

  const retry = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    if (input === null || pendingRef.current || !mayReplay(outcomeRef.current)) {
      return null;
    }
    /* The same intent, so the identity is reused: the service answers with the stored result when
     * the change had already been applied, and applies it when it had not. */
    return submitInput(input);
  }, [submitInput]);

  const reapply = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    const revision = reappliableRevision(outcomeRef.current);
    if (input === null || revision === null || pendingRef.current) {
      return null;
    }
    return submitInput({ ...input, expectedRevision: revision });
  }, [submitInput]);

  const reset = useCallback((): void => {
    if (pendingRef.current) {
      return;
    }
    /* No identity is minted here either: the next submission mints one, so a deliberate reset needs no
     * random value and every identity this step submits was produced by the submission that used it. */
    adopt(null);
    inputRef.current = null;
    outcomeRef.current = null;
    setOutcome(null);
  }, [adopt]);

  return {
    operationId: attempt === null ? null : attempt.operationId,
    pending,
    outcome,
    submit: submitInput,
    retry,
    reapply,
    reset,
  };
}

/**
 * The rows a step applies to, named and counted before the write.
 *
 * Supplied only for an explicit selection made in a list. A filtered result is not a selection and a
 * list is not an audience, so no step infers this from a query: a caller that has no selected rows
 * passes no `selection` at all, and the step then makes no claim about how many records it touches.
 */
export interface ActionReviewSelection {
  /** How many records are explicitly selected. */
  readonly count: number;
  /**
   * The word for one selected record, in the form that agrees with `count` — the caller's wording,
   * because "partner", "edition" and "row" are the caller's vocabulary and not this component's.
   */
  readonly noun: string;
  /** Records the caller's review set aside, stated before the write rather than discovered after. */
  readonly excluded?: number;
}

/** Props of {@link ActionReview}. */
export interface ActionReviewProps<P = unknown> {
  /** What will happen, stated as a verb, a target and a count: "Apply the private tag “Appeal” to 12". */
  readonly title: string;

  /**
   * What changes, what does not, and anything the person must know before confirming.
   *
   * This is where a step states what it will *not* do — that it sends no message, creates no
   * financial record, subscribes no contact — because only the caller knows which of those its own
   * mutation could have been mistaken for. {@link CONTAINMENT_SENTENCE} states the part that is true
   * of every step.
   */
  readonly description?: ReactNode;

  /**
   * The exact consequence of a `consequential` action, shown inside its confirmation dialog.
   *
   * Optional because most steps need no more than the title and the counts; a step that withdraws a
   * publication, stops a series or revokes a grant should name what stops being true, since the
   * dialog's own sentences can only describe the change generically.
   */
  readonly consequence?: ReactNode;

  /** The confirm control's label. It also names the confirmation dialog. */
  readonly confirmLabel: string;

  /** The cancel control's label. Defaults to "Cancel". */
  readonly cancelLabel?: string;

  /**
   * Closes the step without applying anything.
   *
   * When it is absent no cancel control renders: a control that does nothing is worse than no
   * control. A consequential step's dialog always offers its own way out, which is Escape or the
   * dialog's cancel action.
   */
  readonly onCancel?: () => void;

  /**
   * Routes the confirmation through the alert dialog and gives the confirm control the destructive
   * treatment: a withdrawal, a stopped series, a revoked grant, a containment, a discarded draft, a
   * reset. A reversible change confirms inline with one press, because a dialog for every save is
   * friction that teaches people to dismiss dialogs.
   */
  readonly consequential?: boolean;

  /**
   * The simulated external boundary this step reaches, if any. The label renders at the trigger and
   * again on the result, so the disclosure is present before and after the effect (Rule 1 clause 3).
   */
  readonly simulationEffect?: SimulatedEffect;

  /** The explicitly selected rows this step applies to. */
  readonly selection?: ActionReviewSelection;

  /**
   * The three parts of the mutation that are not its identity: the scope the caller believes it is
   * acting in, the revision it saw, and the payload. The identity is minted here, never by the caller.
   */
  readonly input: Omit<MutationInput<P>, "operationId">;

  /**
   * The one mutation call, made by the feature that owns the transport. It receives the complete
   * four-field input and answers with one of the closed outcomes; it must never be called by this
   * file in any other way, and it is never called twice for one intent.
   */
  readonly submit: MutationSubmit<P>;

  /**
   * Called once each time an attempt settles, with the outcome the receipt renders. A feature uses
   * it to invalidate the reads the change touched; it may not use it to report the result itself,
   * because the receipt in this step is the record.
   */
  readonly onSettled?: (outcome: MutationOutcome) => void;

  /** Display names by field path, so a refused submission reads "Email" and not "emails.0.value". */
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;

  /** The heading level that fits the surrounding page. Defaults to 2; the receipt sits one deeper. */
  readonly headingLevel?: ReviewHeadingLevel;

  /** Layout classes for the step. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The heading level the receipt takes, always below the step's own.
 *
 * A receipt nested under a step's `h2` must not open a second `h2`, and a step already at `h4` has no
 * deeper level to give, so the deepest heading elements stay adjacent rather than skipping a level.
 */
function receiptHeadingLevel(level: ReviewHeadingLevel): 2 | 3 | 4 {
  switch (level) {
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 4;
  }
}

/**
 * The counts a step applies to, stated before the write.
 *
 * The set is named by the caller's noun and never by an implied audience: "Selected: 12 partners"
 * describes the rows a person marked in a list, and the sentence says nothing about who they are, what
 * they consented to or what a filter would have matched. Excluded rows are named here rather than
 * reported after the fact, because a person deciding on a write needs to know what it will skip while
 * they can still change their mind.
 */
function SelectionSummary({
  selection,
}: {
  readonly selection: ActionReviewSelection;
}): ReactElement {
  const excluded = selection.excluded ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty">
      <p>
        Selected: <bdi className={COUNT_CLASS}>{String(selection.count)}</bdi> {selection.noun}.
      </p>
      {excluded <= 0 ? null : (
        <p className="text-muted-foreground">
          Excluded before this step: <bdi className={COUNT_CLASS}>{String(excluded)}</bdi>{" "}
          {selection.noun}. This step leaves them unchanged.
        </p>
      )}
    </div>
  );
}

/**
 * The one review-then-accept step.
 *
 * Render it beside the surface whose change it confirms, pass the mutation's scope, expected revision
 * and payload — never its `operationId` — and the feature's own transport as `submit`. The step then
 * owns everything that must not vary between features: the sentences before the write, the
 * confirmation proportionate to consequence, the attempt's identity, the fence against a double
 * submission, and the receipt with its recovery actions.
 *
 * Two bodies, always together. The review body stays on the page after an attempt settles, because a
 * `conflict` is only correctable beside the input it refused, and an `unavailable` source is only
 * retryable while the change it blocked is still described. The receipt appears underneath it and is
 * never replaced by a passing notice.
 */
export function ActionReview<P = unknown>({
  title,
  description,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  onCancel,
  consequential = false,
  simulationEffect,
  selection,
  input,
  submit,
  onSettled,
  fieldLabels,
  headingLevel = 2,
  className,
}: ActionReviewProps<P>): ReactElement {
  const {
    operationId,
    pending,
    outcome,
    submit: dispatchSubmit,
    retry,
    reapply,
  } = useReviewedMutation<P>(submit);

  const titleId = useId();
  const emptySelectionId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  /* A settled attempt leaves nothing left to confirm: `accepted`, `alreadyAccepted` and `unchanged`
   * all mean the change needs no further press. The others stay open for correction or replay. */
  const settled =
    outcome !== null &&
    (outcome.outcome === "accepted" ||
      outcome.outcome === "alreadyAccepted" ||
      outcome.outcome === "unchanged");
  const nothingSelected = selection !== undefined && selection.count <= 0;
  const confirmUnavailable = pending || nothingSelected;
  const state = pending ? "working" : settled ? "settled" : "review";

  /**
   * The reading position follows the result.
   *
   * The confirm control is disabled while an attempt runs, and a disabled control cannot keep focus,
   * so without this a keyboard user would be dropped at the document body once the receipt appears.
   * `invalid` is excluded because its receipt is the form's own error summary, which takes focus and
   * announces the field messages itself; two focus moves for one failure would fight each other.
   */
  useEffect(() => {
    if (outcome === null || outcome.outcome === "invalid") {
      return;
    }
    resultRef.current?.focus();
  }, [outcome]);

  /** Runs one attempt and reports it once, so `onSettled` fires for confirm, retry and re-apply alike. */
  const settle = useCallback(
    async (run: () => Promise<MutationOutcome | null>): Promise<void> => {
      const result = await run();
      if (result !== null) {
        onSettled?.(result);
      }
    },
    [onSettled],
  );

  const confirm = (): void => {
    /* The dialog closes before the request leaves, so its focus trap cannot hold a person inside a
     * panel while the result renders on the page behind it. */
    setDialogOpen(false);
    void settle(() => dispatchSubmit(input));
  };

  /* A replay sends the same intent under the same identity, which is why it is the only recovery a
   * lost acknowledgement offers: the service answers with the stored result rather than repeating
   * the effect. */
  const replay = (): void => {
    void settle(retry);
  };

  const applyAgain = (): void => {
    void settle(reapply);
  };

  const confirmText = pending ? `${confirmLabel} — working` : confirmLabel;
  const describedByEmptySelection = nothingSelected ? emptySelectionId : undefined;
  const Heading = STEP_HEADING_TAG[headingLevel];

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={pending ? true : undefined}
      data-slot="action-review"
      data-state={state}
      /* The identity this step has submitted under, once it has submitted: a browser test asserting that
       * a repeated press produced one effect reads it here; it is a diagnostic hook, never a control. It
       * is absent before the first submission, because the identity is minted by that submission rather
       * than by a render — which is what keeps the server render and the hydration identical. */
      data-operation-id={operationId ?? undefined}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <Heading id={titleId}>{title}</Heading>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {description === undefined ? null : (
            <div className="min-w-0 text-sm text-pretty text-muted-foreground">{description}</div>
          )}
          {selection === undefined ? null : <SelectionSummary selection={selection} />}
          <p className="text-sm text-pretty text-muted-foreground">{CONTAINMENT_SENTENCE}</p>
          {simulationEffect === undefined ? null : <SimulationLabel effect={simulationEffect} />}
          <Separator />
          {settled ? (
            <p className="text-sm text-pretty text-muted-foreground">{SETTLED_SENTENCE}</p>
          ) : (
            <>
              {nothingSelected ? (
                <p id={emptySelectionId} className="text-sm text-pretty text-muted-foreground">
                  {NOTHING_SELECTED_SENTENCE}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {consequential ? (
                  /* Cancel is the dialog's first action in DOM order, so the destructive control is
                   * never the one that receives focus when the panel opens and Escape always means
                   * "not yet". The safe choice stays available throughout. */
                  <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <AlertDialogTrigger
                      render={
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={confirmUnavailable}
                          aria-describedby={describedByEmptySelection}
                        />
                      }
                    >
                      {confirmText}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{confirmLabel}</AlertDialogTitle>
                        {/* The description element is itself a paragraph, so each sentence is a span
                         * laid out as a block: nesting paragraphs would be invalid markup. */}
                        <AlertDialogDescription className="flex flex-col gap-2">
                          <span className="font-medium text-foreground">{title}</span>
                          <span>{CONFIRM_EFFECT_SENTENCE}</span>
                          {selection === undefined ? null : (
                            <span>
                              It applies to{" "}
                              <bdi className={COUNT_CLASS}>{String(selection.count)}</bdi> selected{" "}
                              {selection.noun}
                              {(selection.excluded ?? 0) <= 0 ? null : (
                                <>
                                  ;{" "}
                                  <bdi className={COUNT_CLASS}>
                                    {String(selection.excluded ?? 0)}
                                  </bdi>{" "}
                                  excluded {selection.noun} are left unchanged
                                </>
                              )}
                              .
                            </span>
                          )}
                          <span>{CONTAINMENT_SENTENCE}</span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      {consequence === undefined ? null : (
                        <div className="min-w-0 text-sm text-pretty">{consequence}</div>
                      )}
                      {simulationEffect === undefined ? null : (
                        <SimulationLabel effect={simulationEffect} context="block" />
                      )}
                      <AlertDialogFooter>
                        <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
                        <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
                          {confirmLabel}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    type="button"
                    disabled={confirmUnavailable}
                    aria-describedby={describedByEmptySelection}
                    onClick={confirm}
                  >
                    {confirmText}
                  </Button>
                )}
                {onCancel === undefined ? null : (
                  /* Disabled while an attempt runs: a request that has left cannot be called back,
                   * and closing the step now would take the receipt of it off the page. */
                  <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
                    {cancelLabel}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {outcome === null ? null : (
        /* Focusable only so the reading position can move here after an attempt settles; it carries
         * no ring of its own, because a ring around a whole receipt would read as an interactive
         * surface it is not. */
        <div
          ref={resultRef}
          tabIndex={-1}
          data-slot="action-review-result"
          data-outcome={outcome.outcome}
          className="flex min-w-0 flex-col gap-3 outline-none"
        >
          {simulationEffect === undefined ? null : (
            <SimulationLabel effect={simulationEffect} context="block" />
          )}
          <OperationResult
            outcome={outcome}
            headingLevel={receiptHeadingLevel(headingLevel)}
            /* Each recovery action appears only on the outcome it belongs to: a check for an
             * unconfirmed effect, a replay for a source that was down, and a re-apply for a stale
             * revision. None of them ever offers to send the work again under a fresh identity. */
            onCheckResult={outcome.outcome === "unknown" ? replay : undefined}
            onRetrySameWork={outcome.outcome === "unavailable" ? replay : undefined}
            onReapply={outcome.outcome === "conflict" ? applyAgain : undefined}
            fieldLabels={fieldLabels}
          />
        </div>
      )}
    </section>
  );
}

export default ActionReview;

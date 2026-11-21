"use client";
/**
 * The context-switch surface: the active context stated from the read's own scope, the memberships this session
 * admits, and one deliberate request to change between them.
 *
 * In scope because the first-release shell states the active organization and ministry wherever an action could
 * cross it and offers Save, Discard or Stay before a change with work in hand (AAP 0.10.1 family 1), because the
 * shell is what carries that indicator (AAP 0.6.4), because a switch must discard results produced under the context
 * being left while a refusal discloses nothing about it (AAP 0.12.1 criterion 19), because the indicator, the guard,
 * the submission hook and the chooser each exist once and this surface composes them instead of reproducing them
 * (AAP 0.3.4), and because any surface that states a financial or private fact states the scope it was read under
 * (AAP 0.7.1).
 *
 * What this file does not do, by design: it never switches optimistically, never states a context it was not read
 * under, never derives a context from a name, an email address or a postal address, never cancels or clears a read
 * cache and never defines a read key (the fence in `@/components/context-switch-guard` owns both), and never
 * implements a save — the guard's Save branch names the owning surface's own autosave or submit, which arrives here
 * as a callback. Selected context stays a distinct fact from identity, private information, financial facts, consent,
 * publication and communication outcomes (Rule 1: General, clause 3), and nothing is added to the closed mutation
 * inventory (clause 1).
 */
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";

import ContextIndicator, { type AdmittedContext, type ContextRequest } from "@/components/context-indicator";
import ContextSwitchGuard, { useContextFence, type ContextSelection } from "@/components/context-switch-guard";
import { fieldErrorsFromInvalid, FormErrorSummary } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { formatSourceReference } from "@/lib/ids";
import type { MutationInput, MutationOutcome, ReadEnvelope, Scope } from "@/modules/data-service";
// A type-only import of the read's own data shape: it names no value, so nothing of the synthetic store or the
// development runtime reaches the browser bundle.
import type { ContextChooserData } from "@/modules/data-service/reads/shell";

import { CONTEXT_CHANGED, CONTEXT_SWITCH_COPY, LATE_RESULT_DISCARDED } from "../copy/context-switch";
import { useContextChooser } from "../hooks/use-context-chooser";
import { useSelectContext } from "../hooks/use-select-context";
import ContextChooser from "./context-chooser";

/** How the one surface is presented. The presentation changes the chrome around the content, never the content. */
export type ContextSwitchPresentation = "inline" | "dialog" | "panel";

export interface ContextSwitchSurfaceProps {
  /**
   * The read whose authority this surface states. The context shown is its `scope` and nothing else, and its source,
   * coverage and as-of time are what the surface restates when it is stating the scope of a financial or private read.
   */
  readonly envelope: ReadEnvelope<unknown>;
  /** `inline` is a row or block in the shell chrome; `dialog` and `panel` present the memberships in the chooser's dialog. */
  readonly presentation?: ContextSwitchPresentation;
  /**
   * The memberships this session admits, as the read that enumerated them stated them — the shell's own chooser
   * read. Without it the surface still states the context it read under and offers no change, because a list of
   * memberships is not something this surface may invent.
   */
  readonly chooser?: ReadEnvelope<ContextChooserData>;
  /** Whether this surface is restating the scope a financial or private read ran under, which adds its read facts. */
  readonly restateScope?: boolean;
  /**
   * The owning surface's own save — its editor autosave or its form submit — which the guard offers as its Save
   * branch. This surface implements no save: it only waits for that one to settle before the switch is requested.
   */
  readonly onSaveAndSwitch?: () => Promise<void>;
  /** What the owning surface reports as unsaved, so the guard can say what the decision is about. */
  readonly unsavedWork?: { readonly description: string };
  readonly className?: string;
}

/** The change a person asked for, held until the guard's decision and then until the service answers. */
type PendingChange = { readonly scope: Scope; readonly label: string };

/** The decision a guard action made, which the mutation reports back so the record says how the work was resolved. */
type Decision = "discard" | "save";

const SURFACE_SLOT = "context-switch-surface";
const FACTS_LABEL = "The source, coverage and time this read states for itself";
const SOURCE_LABEL = "Source";
const COVERAGE_LABEL = "Coverage";
const AS_OF_LABEL = "As of";
const NOT_STATED = "not stated by this read";
const INVALID_TITLE = "The switch request was not valid";
const INVALID_DESCRIPTION = "Nothing was changed, so you are still in the context stated here. Correct the field this refusal names and ask for the change again.";
const INVALID_UNNAMED = "The request was refused before anything changed, and it named no field to correct. Nothing was applied, so the context is unchanged.";
const FIELD_LABELS = { organizationId: "Organization", ministryId: "Ministry", supportSubjectId: "Support subject" } as const;
const NO_MEMBERSHIPS: readonly AdmittedContext[] = [];

/** What each coverage state means for every figure read under it, said in words so no state rests on colour alone. */
const COVERAGE_SENTENCE: Readonly<Record<ReadEnvelope<unknown>["coverage"]["state"], string>> = {
  complete: "The source reports this period as fully covered, so a total over it covers the whole period.",
  partial: "The source reports this period as only partly covered, so every total here is an incomplete subtotal.",
  unknown: "Whether the source covers this whole period is not known, so every total here is an incomplete subtotal.",
};

/** The name the source of record supplied for a membership, or its opaque reference where it supplied none. */
function nameOrReference(label: string | undefined, reference: string): string {
  const named = (label ?? "").trim();
  // A blank label is a context the source named nothing for. The reference is shown rather than a blank presented as
  // a name, and no name is ever derived from a record here.
  return named === "" ? reference : named;
}

/** Whether two scopes name the same authority: the three references that decide it, never a display name. */
function sameContext(left: Scope, right: Scope): boolean {
  return left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId;
}

/** Every admitted membership the chooser read listed, in exactly the order it listed them. */
function membershipsOf(data: ContextChooserData): readonly AdmittedContext[] {
  return data.groups.flatMap((group) => group.ministries.map((ministry) => ({ organizationId: group.organizationId, organizationLabel: group.organizationLabel, ministryId: ministry.ministryId, ministryLabel: ministry.ministryLabel, supportSubjectId: ministry.supportSubjectId })));
}

/**
 * The context in force as one admitted membership: the one the chooser listed for it where it listed this context,
 * and otherwise the three references the read itself stated, with no name invented for them.
 */
function currentAdmissionOf(scope: Scope, memberships: readonly AdmittedContext[]): AdmittedContext {
  const listed = memberships.find((candidate) => candidate.organizationId === scope.organizationId && candidate.ministryId === scope.ministryId);
  if (listed !== undefined) return listed;
  return { organizationId: scope.organizationId, organizationLabel: "", ministryId: scope.ministryId, ministryLabel: "", supportSubjectId: scope.supportSubjectId };
}

/** The one sentence that announces a confirmed change, naming the new context from the envelope's own scope. */
function changeAnnouncement(organizationName: string, ministryName: string): string {
  return `${CONTEXT_CHANGED.title}. ${CONTEXT_CHANGED.body} ${CONTEXT_CHANGED.organizationLabel}: ${organizationName}. ${CONTEXT_CHANGED.ministryLabel}: ${ministryName}.`;
}

/**
 * What this surface announces, derived from the render rather than stored: the confirmed change once the server
 * states the scope the accepted attempt asked for, otherwise the report of a dropped result, otherwise nothing.
 */
function announcementFor(awaited: Scope | null, statedScope: Scope, current: AdmittedContext, discarded: boolean): string {
  if (awaited !== null && sameContext(awaited, statedScope)) {
    return changeAnnouncement(nameOrReference(current.organizationLabel, statedScope.organizationId), nameOrReference(current.ministryLabel, statedScope.ministryId));
  }
  return discarded ? LATE_RESULT_DISCARDED : "";
}

/**
 * The outcomes that keep a durable receipt of their own. An applied change needs none — the new context stated from
 * the new read is the record of it — and a conflict is asked again by the guard, which is where its preserved input
 * is compared, so neither is restated here.
 */
function receiptFor(outcome: MutationOutcome | null): MutationOutcome | null {
  if (outcome === null) return null;
  switch (outcome.outcome) {
    case "denied":
    case "unavailable":
    case "unknown":
    case "unchanged":
      return outcome;
    case "accepted":
    case "alreadyAccepted":
    case "conflict":
    case "invalid":
      return null;
  }
}

/** The source, coverage and as-of facts the envelope carries, stated beside the context it was read under. */
function ReadFacts({ envelope }: { readonly envelope: ReadEnvelope<unknown> }): ReactElement {
  const { coverage } = envelope;
  const from = coverage.from ?? NOT_STATED;
  const to = coverage.to ?? NOT_STATED;
  return (
    <div data-slot={`${SURFACE_SLOT}-read-facts`} className="flex min-w-0 max-w-full flex-col gap-1">
      {/* The caption is visible text rather than an accessible name on a grouping role: it adds no landmark, and the
          list stays a definition list of the three facts the envelope states. */}
      <p className="min-w-0 text-xs font-medium break-words text-muted-foreground">{FACTS_LABEL}</p>
      <dl className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="font-medium">{SOURCE_LABEL}</dt>
        <dd className="min-w-0 break-words">
          {/* The source identity is an opaque pair, so it is isolated from the words around it and never parsed. */}
          <bdi className="mono-identifier break-all">{formatSourceReference(envelope.source)}</bdi>
        </dd>
        <dt className="font-medium">{COVERAGE_LABEL}</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {/* The word carries the state; the badge only repeats it. */}
          <Badge variant="outline" className="shrink-0">
            {coverage.state}
          </Badge>
          <span className="min-w-0 break-words">
            {COVERAGE_SENTENCE[coverage.state]} The covered period runs from <bdi>{from}</bdi> to <bdi>{to}</bdi>.
          </span>
        </dd>
        <dt className="font-medium">{AS_OF_LABEL}</dt>
        <dd className="min-w-0 break-words">
          <bdi className="whitespace-nowrap">{envelope.asOf}</bdi>
        </dd>
      </dl>
    </div>
  );
}

/** The per-field messages a refused request produced, shown above the statement they leave untouched. */
function InvalidRequest({ outcome }: { readonly outcome: MutationOutcome }): ReactElement | null {
  if (outcome.outcome !== "invalid") return null;
  const errors = fieldErrorsFromInvalid(outcome);
  if (errors.count === 0) {
    return (
      <p role="alert" className="min-w-0 text-sm text-destructive">
        {INVALID_UNNAMED}
      </p>
    );
  }
  return <FormErrorSummary errors={errors} labels={FIELD_LABELS} title={INVALID_TITLE} description={INVALID_DESCRIPTION} headingLevel={2} />;
}

/** The active context, the memberships this session admits, and one deliberate request to change between them. */
export function ContextSwitchSurface({ envelope, presentation = "inline", chooser, restateScope = false, onSaveAndSwitch, unsavedWork, className }: ContextSwitchSurfaceProps): ReactElement {
  // The memberships are re-read over their own scope-led key so this surface holds the list as it stands now: a
  // settled answer that described the context this surface has left arrives here as `discarded`.
  const chooserRead = useContextChooser(chooser !== undefined, chooser);
  const liveChooser = chooserRead.state === "ready" ? chooserRead.envelope : null;
  const chooserData = liveChooser === null ? (chooser?.data ?? null) : liveChooser.data;
  const memberships = useMemo<readonly AdmittedContext[]>(() => (chooserData === null ? NO_MEMBERSHIPS : membershipsOf(chooserData)), [chooserData]);
  // The context record's revision as the read that enumerated the memberships stated it: a change presents the
  // revision the caller saw, so a list read under another context is never the basis of a switch.
  const expectedRevision = liveChooser !== null ? liveChooser.revision : (chooser?.revision ?? "");
  const canRequestChange = memberships.length > 1 && expectedRevision.trim() !== "";
  const currentAdmission = currentAdmissionOf(envelope.scope, memberships);
  const inChooserChrome = presentation !== "inline";
  // A menu is offered only where a change can actually be requested. With a single membership, or without the
  // revision a change must present, the context is stated and no control promises a move this surface cannot make.
  const indicatorAdmissions: readonly AdmittedContext[] = canRequestChange && !inChooserChrome ? memberships : [currentAdmission];

  const { selectContext } = useSelectContext();
  // The decision the guard's action made. The fence's dispatch carries the target membership alone, so the choice
  // travels in a ref the dispatch reads at the moment the request leaves: the one hand-off that is synchronous with
  // the attempt it belongs to, and never a second mutation from this family.
  const decisionRef = useRef<Decision>("discard");
  const dispatch = useCallback(
    (input: MutationInput<ContextSelection>): Promise<MutationOutcome> =>
      selectContext({ scope: input.scope, expectedRevision: input.expectedRevision, payload: { organizationId: input.payload.organizationId, ministryId: input.payload.ministryId, supportSubjectId: input.payload.supportSubjectId, resolveUnsavedWork: decisionRef.current } }),
    [selectContext],
  );
  // The one fence: it stops the reads in flight, clears every envelope the previous context produced and names the
  // scope a result must carry to still be current. Nothing in this file cancels, clears or keys a read itself.
  const fence = useContextFence({ scope: envelope.scope, selectContext: dispatch, copy: CONTEXT_SWITCH_COPY });

  const [pending, setPending] = useState<PendingChange | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  // The context an accepted change asked for. It is the only thing this surface remembers about a switch, and it is
  // what the announcement is matched against once the server states that scope — never a target a click named.
  const [awaitedScope, setAwaitedScope] = useState<Scope | null>(null);
  const retryMemberships = chooserRead.retry;

  /** One request for one admitted membership: the context asked for, held until the person decides and it is answered. */
  const requestChange = useCallback(
    (request: ContextRequest): void => {
      const admission = memberships.find((candidate) => candidate.organizationId === request.organizationId && candidate.ministryId === request.ministryId);
      const supportSubjectId = request.supportSubjectId ?? admission?.supportSubjectId ?? "";
      // The request names a membership the read listed, with that membership's own finance subject. A scope completed
      // with a guess is a request this surface never read, so nothing is sent and nothing is claimed.
      if (admission === undefined || supportSubjectId.trim() === "" || expectedRevision.trim() === "") return;
      setSettled(null);
      setPending({
        scope: { organizationId: admission.organizationId as Scope["organizationId"], ministryId: admission.ministryId as Scope["ministryId"], supportSubjectId: supportSubjectId as Scope["supportSubjectId"], principalId: envelope.scope.principalId },
        label: `${nameOrReference(admission.organizationLabel, admission.organizationId)} — ${nameOrReference(admission.ministryLabel, admission.ministryId)}`,
      });
      setGuardOpen(true);
    },
    [envelope.scope.principalId, expectedRevision, memberships],
  );

  /** One attempt at the held change, dispatched under the decision the person made through the guard. */
  const runSwitch = useCallback(
    async (decision: Decision): Promise<void> => {
      if (pending === null) return;
      decisionRef.current = decision;
      setSettled(null);
      const result = await fence.switchContext({ pendingScope: pending.scope, expectedRevision });
      setSettled(result.outcome);
      if (result.switched) {
        // Nothing is switched here. The dispatch's own accepted path re-reads the server, and the context on screen
        // changes only when that render states the new scope — never before it.
        setAwaitedScope(pending.scope);
        setPending(null);
        setGuardOpen(false);
        return;
      }
      if (result.outcome.outcome === "conflict") {
        // The input is preserved rather than overwritten: the guard asks the question again beside it, and the
        // memberships are re-read so the next attempt presents the revision as it now stands.
        setGuardOpen(true);
        retryMemberships();
        return;
      }
      setGuardOpen(false);
    },
    [expectedRevision, fence, pending, retryMemberships],
  );

  const stayOnChange = useCallback((): void => {
    setGuardOpen(false);
    setPending(null);
    setSettled(null);
  }, []);

  const discardAndSwitch = useCallback(async (): Promise<void> => {
    await runSwitch("discard");
  }, [runSwitch]);

  // The guard's Save branch is the owning surface's save, awaited before the switch is asked for. This family
  // implements none: a save that throws leaves the change unrequested and nothing discarded.
  const saveAndSwitch = useCallback(async (): Promise<void> => {
    if (onSaveAndSwitch === undefined) return;
    await onSaveAndSwitch();
    await runSwitch("save");
  }, [onSaveAndSwitch, runSwitch]);

  // The recovery both a refusal and an unconfirmed result offer: this same attempt again under its own identity, so
  // an applied change answers with its stored result instead of being applied twice.
  const attemptAgain = useCallback((): void => {
    void runSwitch(decisionRef.current);
  }, [runSwitch]);

  const announcement = announcementFor(awaitedScope, envelope.scope, currentAdmission, chooserRead.discarded);

  const receipt = receiptFor(settled);
  const statement = <ContextIndicator scope={envelope.scope} admissions={indicatorAdmissions} onRequestContext={requestChange} showSupportSubject={restateScope} className="min-w-0 max-w-full" />;
  const facts = restateScope ? <ReadFacts envelope={envelope} /> : null;
  const outcomeRegion = (
    <>
      {settled === null ? null : <InvalidRequest outcome={settled} />}
      {receipt === null ? null : <OperationResult outcome={receipt} headingLevel={2} fieldLabels={FIELD_LABELS} {...(receipt.outcome === "unknown" ? { onCheckResult: attemptAgain } : {})} {...(receipt.outcome === "unavailable" ? { onRetrySameWork: attemptAgain } : {})} />}
      {/* The surface's one announcement: text only, so nothing here depends on a colour or a shape to be understood. */}
      <output className="sr-only">{announcement}</output>
    </>
  );

  if (inChooserChrome) {
    return (
      <div data-slot={SURFACE_SLOT} data-presentation={presentation} className={cn("flex min-w-0 max-w-full flex-col gap-2", className)}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {statement}
          {canRequestChange ? (
            // The chooser's own dialog presentation lists exactly the admitted memberships and owns the guard, the
            // dispatch and its receipt for this chrome, so the two presentations state the same content and ask the
            // same question. Its guard offers Stay and Discard and no Save, because no owning save travels into it:
            // the owning surface's save is offered on the inline chrome, where this surface holds the guard, and this
            // family implements none of its own.
            <ContextChooser presentation="dialog" {...(chooser === undefined ? {} : { initial: chooser })} className="min-w-0" />
          ) : null}
        </div>
        {facts === null ? null : (
          <>
            <Separator />
            {facts}
          </>
        )}
        {outcomeRegion}
      </div>
    );
  }

  return (
    <>
      <div data-slot={SURFACE_SLOT} data-presentation={presentation} className={cn("flex min-w-0 max-w-full flex-col gap-2", className)}>
        {statement}
        {facts === null ? null : (
          <>
            <Separator />
            {facts}
          </>
        )}
        {outcomeRegion}
      </div>
      <ContextSwitchGuard
        copy={CONTEXT_SWITCH_COPY}
        open={guardOpen && pending !== null}
        pendingScope={pending === null ? null : pending.scope}
        {...(pending === null ? {} : { pendingScopeLabel: pending.label })}
        {...(unsavedWork === undefined ? {} : { unsavedWork })}
        busy={fence.isSwitching}
        outcome={settled !== null && settled.outcome === "conflict" ? settled : null}
        onStay={stayOnChange}
        onDiscard={discardAndSwitch}
        {...(onSaveAndSwitch === undefined ? {} : { onSaveAndSwitch: saveAndSwitch })}
      />
    </>
  );
}

export default ContextSwitchSurface;

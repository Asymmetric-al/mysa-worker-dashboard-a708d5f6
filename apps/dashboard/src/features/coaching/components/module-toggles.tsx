"use client";

/**
 * The worker's control over the five coaching modules, and what each of them currently delivers.
 *
 * Scope: AAP 0.10.1's "five independently selected modules"; AAP 0.8.4's module rules — five modules
 * chosen independently, five distinct read states with `ended` never standing for `unavailable`, and
 * one unavailable module leaving the other four usable; AAP 0.7.1's `setModule`; AAP 0.6.3's
 * `POST /api/coaching/modules`. The closed module set comes from the domain, the words come from
 * `../copy`, the toggle is the design system's `Switch`, and every outcome is rendered by the shared
 * `OperationResult`, so this file adds no sixth module, no second toggle pattern and no second
 * vocabulary for a state.
 */

import { CalendarXIcon, EyeOffIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import OperationResult, { OUTCOME_HEADINGS } from "@/components/operation-result";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey, type ModuleReadState } from "@/modules/coaching/grant";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY, STOP_EFFECT_COPY, type StateCopy } from "../copy";
import { useSetModule } from "../hooks/use-coaching-mutations";
import { moduleChangePayloadSchema, type ModuleChangePayload } from "../schemas/module";

// ---------------------------------------------------------------------------------------------
// The words this surface owns
//
// The module names, their descriptions, the five state words and the lifecycle words all come from
// `../copy`, and the stop step's title, question, consequence and assurance come from the one
// `STOP_EFFECT_COPY` entry for stopping a module. Only the sentences nothing else states live here.
// ---------------------------------------------------------------------------------------------

const CARD_HEADING = "Modules you share";
const INTRO_SENTENCE = "Modules start switched off, and each of the five is chosen on its own, so your coach can read only the ones you switch on.";
const OFF_WORD = "Switched off";
const OFF_SENTENCE = "This module is switched off, so your coach cannot read it. The work inside it stays exactly as it is, and switching it back on is the same deliberate act as switching it on the first time.";
const UNSTATED_WORD = "State not stated";
const UNSTATED_SENTENCE = "This module is switched on and the read stated no state for it, so nothing is claimed here about what your coach can read.";
const BUSY_SENTENCE = "Applying this module change, and nothing else…";
const INVITED_REASON = "Modules are chosen after the invitation is accepted: nothing is shared before that, so there is no selection to change yet.";
const ACCEPTED_REASON = "The invitation is accepted and access is not live yet, so a module cannot be switched until it is. Accepting on its own makes no module readable.";
const EXPIRED_CUTOFF_LEAD = "The share window closed at its frozen cutoff ";
const EXPIRED_CUTOFF_TAIL = ", which has passed: no new read is admitted from that instant, and lifting a hold or changing a setting does not reopen it.";
const NOT_SENT_TITLE = "This module change was not sent";
const NOT_SENT_FALLBACK = "The change stated no coaching relationship it belongs to, so it was not sent.";
const SET_INCOMPLETE_TITLE = "These five modules could not be stated";
const SET_INCOMPLETE_DESCRIPTION =
  "This surface states exactly the five modules a grant can share, and it was handed a different set. No switch is offered, because a missing module would read as switched off when nothing said it was, and a sixth would be a module no grant shares. Nothing was changed and nothing is hidden: the set itself is what does not match.";
/** The payload field names a refusal may name, in the words a worker reads. */
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { grantId: "Coaching relationship", moduleKey: "Module", enabled: "Sharing of this module" };
const CARD_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The heading levels this surface renders at: the card's own, and the one step below it that every statement inside a row uses. */
type RowHeadingLevel = 2 | 3 | 4;
const ROW_HEADING_LEVEL: Readonly<Record<RowHeadingLevel, RowHeadingLevel>> = { 2: 3, 3: 4, 4: 4 };
type StateVariant = "secondary" | "outline" | "destructive" | "ghost";
/**
 * The tone each state's badge carries. Tone never carries the state on its own — the badge always
 * shows the state word from `MODULE_READ_STATE_COPY` — so a reader who cannot see the colour reads
 * the same five distinct words.
 */
const STATE_VARIANT: Readonly<Record<ModuleReadState, StateVariant>> = { empty: "outline", partial: "secondary", withheld: "outline", unavailable: "destructive", ended: "secondary" };

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

/** One of the five modules as the read reported it: whether the grant shares it, and what a coach can read in it now. */
export type ModuleToggleEntry = {
  readonly key: ModuleKey;
  readonly enabled: boolean;
  /**
   * The state a coach meets in this module, or `null` when this read admitted none for it — which is
   * what the service itself states for a module the grant does not share (`AdmittedModuleView`), so a
   * switched-off module is never given an invented state.
   */
  readonly readState: ModuleReadState | null;
  readonly source?: SourceReference | null;
};

export type ModuleTogglesProps = {
  /** The relationship these modules belong to; the change names it, because a module is shared inside one grant. */
  readonly grantId: string;
  readonly modules: ReadonlyArray<ModuleToggleEntry>;
  readonly scope: Scope;
  readonly expectedRevision: string;
  /** The grant's lifecycle state, which decides whether a module can be switched at all and why not when it cannot. */
  readonly grantState: GrantLifecycleState;
  /** Display only: named when the window has closed, never compared with a clock in this file. */
  readonly cutoffInstant?: string | null;
  readonly onOutcome?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
};

/** Why a switch cannot be used, and the grant state that says so. */
interface ShareGate {
  readonly selectable: boolean;
  readonly stateCopy: StateCopy | null;
  readonly reason: string | null;
  readonly cutoffInstant: string | null;
}

const OPEN_GATE: ShareGate = { selectable: false, stateCopy: null, reason: null, cutoffInstant: null };

/**
 * Reads the lifecycle state into the two things a switch needs to know: whether it may submit, and
 * the words that say why when it may not. `active` is the only state in which a module can be
 * switched, because it is the only one in which the service admits `setModule`.
 */
function gateFor(grantState: GrantLifecycleState, cutoffInstant: string | null): ShareGate {
  const open: ShareGate = { ...OPEN_GATE, selectable: true };
  if (grantState === "active") return open;
  if (grantState === "invited") return { selectable: false, stateCopy: GRANT_STATE_COPY.invited, reason: INVITED_REASON, cutoffInstant: null };
  if (grantState === "accepted") return { selectable: false, stateCopy: GRANT_STATE_COPY.accepted, reason: ACCEPTED_REASON, cutoffInstant: null };
  // Every remaining state closes the grant: revoked, expired, ended, left by the coach, or superseded
  // before acceptance. Each keeps its own words, so no two of them are ever stated as one another.
  const closed = GRANT_STATE_COPY[grantState];
  return { selectable: false, stateCopy: closed, reason: null, cutoffInstant: grantState === "expired" ? cutoffInstant : null };
}

/** Whether the entries are exactly the closed set of five modules, each once. A rendering component reports anything else rather than throwing on data it did not produce. */
function hasClosedModuleSet(modules: ReadonlyArray<ModuleToggleEntry>): boolean {
  if (modules.length !== MODULE_KEYS.length) return false;
  const seen = new Set<ModuleKey>();
  for (const entry of modules) {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
  }
  return MODULE_KEYS.every((key) => seen.has(key));
}

/** The entry for one module, or `undefined` for a set that was already refused. */
function entryFor(modules: ReadonlyArray<ModuleToggleEntry>, key: ModuleKey): ModuleToggleEntry | undefined {
  for (const entry of modules) {
    if (entry.key === key) return entry;
  }
  return undefined;
}

/** The state word a row shows: the module's own state while it is shared, and the plain fact that it is off when it is not. */
function stateWordOf(entry: ModuleToggleEntry): string {
  if (!entry.enabled) return OFF_WORD;
  return entry.readState === null ? UNSTATED_WORD : MODULE_READ_STATE_COPY[entry.readState].label;
}

/** The tone a row's badge carries, matching the word it shows. */
function stateVariantOf(entry: ModuleToggleEntry): StateVariant {
  if (!entry.enabled) return "ghost";
  return entry.readState === null ? "outline" : STATE_VARIANT[entry.readState];
}

type BuiltPayload = { readonly payload: ModuleChangePayload } | { readonly refusal: string };

/**
 * The one change this surface sends, judged by the schema the route and the service judge it with
 * before anything leaves the browser. A refusal is named here as this view's own refused request, so
 * a change that could never be admitted produces no request at all.
 */
function payloadForChange(grantId: string, moduleKey: ModuleKey, enabled: boolean): BuiltPayload {
  const parsed = moduleChangePayloadSchema.safeParse({ grantId, moduleKey, enabled });
  if (parsed.success) return { payload: parsed.data };
  const messages = parsed.error.issues.map((issue) => issue.message);
  return { refusal: messages.length === 0 ? NOT_SENT_FALLBACK : messages.join(" ") };
}

// ---------------------------------------------------------------------------------------------
// One state, stated once per row
// ---------------------------------------------------------------------------------------------

/** The one statement a `partial`, `withheld` or `ended` module makes: its own word, its own words, and its own icon. */
function StateAlert({ icon, copy }: { readonly icon: ReactElement; readonly copy: StateCopy }): ReactElement {
  return (
    // No alarm role: this sentence describes a state the read has already answered, so it states
    // itself where it stands and in reading order rather than interrupting every time the row mounts.
    <Alert role={undefined} className="min-w-0">
      {icon}
      <AlertTitle>{copy.label}</AlertTitle>
      <AlertDescription>
        <p>{copy.description}</p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * One module's read state. `empty` and `unavailable` are the notice's own states and are stated by
 * the one notice surface; `partial`, `withheld` and `ended` have no notice kind that means them, so
 * each states its own word and description with its own icon rather than being folded into another.
 */
function StateStatement({ state, source, headingLevel }: { readonly state: ModuleReadState; readonly source: SourceReference | null; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  const copy = MODULE_READ_STATE_COPY[state];
  switch (state) {
    case "empty":
      return <StateNotice kind="empty" title={copy.label} description={copy.description} headingLevel={headingLevel} className="p-4 sm:p-4" />;
    case "unavailable":
      // The row names the source it could not read, so an outage is distinguishable from an ending
      // that is stated in the same position by the same kind of control.
      return <StateNotice kind="unavailable" title={copy.label} description={copy.description} source={source ?? undefined} headingLevel={headingLevel} />;
    case "partial":
      return <StateAlert icon={<TriangleAlertIcon aria-hidden="true" />} copy={copy} />;
    case "withheld":
      return <StateAlert icon={<EyeOffIcon aria-hidden="true" />} copy={copy} />;
    case "ended":
      return <StateAlert icon={<CalendarXIcon aria-hidden="true" />} copy={copy} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The receipt for a change in this row
// ---------------------------------------------------------------------------------------------

interface ModuleReceiptProps {
  readonly outcome: MutationOutcome;
  readonly heading: string;
  readonly onCheckResult?: (() => void) | undefined;
  readonly onRetrySameWork?: (() => void) | undefined;
  readonly onReapply?: (() => void) | undefined;
}

/** The one durable receipt of this row's attempt, focused when it appears so a keyboard user lands on the record of what happened. */
function ModuleReceipt({ outcome, heading, onCheckResult, onRetrySameWork, onReapply }: ModuleReceiptProps): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, [outcome]);
  return (
    <div ref={frameRef} tabIndex={-1} data-slot="module-change-result" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-2 outline-none">
      <OperationResult outcome={outcome} heading={heading} headingLevel={4} onCheckResult={onCheckResult} onRetrySameWork={onRetrySameWork} onReapply={onReapply} fieldLabels={FIELD_LABELS} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One module: its switch, its state, and the two ways a change is made
// ---------------------------------------------------------------------------------------------

interface ModuleRowProps {
  readonly entry: ModuleToggleEntry;
  readonly grantId: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly gate: ShareGate;
  readonly gateId: string | null;
  readonly rowHeadingLevel: RowHeadingLevel;
  readonly onOutcome: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: (() => void) | undefined;
}

/**
 * One module's row. Switching a module **on** is additive, so it is applied as it is asked for and
 * its receipt appears in place; switching one **off** is a stop, so it goes through the shared review
 * step first, which states in the copy's own words that the module stops being readable and that
 * nothing is deleted and nothing already seen can be recalled. That asymmetry is the whole of this
 * component's judgement: an addition needs no ceremony, a stop needs to be read before it is made.
 */
function ModuleRow({ entry, grantId, scope, expectedRevision, gate, gateId, rowHeadingLevel, onOutcome, onCheckResult }: ModuleRowProps): ReactElement {
  const copy = MODULE_COPY[entry.key];
  const nameId = useId();
  const stateId = useId();
  const descriptionId = useId();
  const { mutateAsync: changeModule } = useSetModule();
  // The hook owns the attempt's identity: a retry of the same intent replays the same operationId, so
  // the ledger answers with the original result rather than applying the change twice.
  const submit = useCallback<MutationSubmit<ModuleChangePayload>>((input) => changeModule({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [changeModule]);
  const direct = useReviewedMutation<ModuleChangePayload>(submit);
  const [stopIntent, setStopIntent] = useState<ModuleChangePayload | null>(null);
  const [settledStop, setSettledStop] = useState<MutationOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const blocked = !gate.selectable || direct.pending || stopIntent !== null;
  const describedBy = gateId === null ? descriptionId : `${descriptionId} ${gateId}`;
  const stateWord = stateWordOf(entry);
  const variant = stateVariantOf(entry);

  const runDirect = useCallback(
    (run: () => Promise<MutationOutcome | null>): void => {
      void run().then((outcome) => {
        if (outcome !== null) onOutcome?.(outcome);
      });
    },
    [onOutcome],
  );

  const changeTo = (next: boolean): void => {
    // The switch stays focusable while it cannot be used, so its name and its stated reason stay
    // reachable; activation is refused here instead of by removing it from the keyboard order.
    if (blocked) return;
    setRefusal(null);
    const built = payloadForChange(grantId, entry.key, next);
    if ("refusal" in built) {
      setRefusal(built.refusal);
      return;
    }
    if (!next) {
      direct.reset();
      setSettledStop(null);
      setStopIntent(built.payload);
      return;
    }
    setSettledStop(null);
    direct.reset();
    runDirect(() => direct.submit({ scope, expectedRevision, payload: built.payload }));
  };

  const settleStop = useCallback(
    (outcome: MutationOutcome): void => {
      onOutcome?.(outcome);
      // A stop that settled closes the review and leaves its receipt in the row; a conflict, a denial,
      // an outage or an unconfirmed result keeps the review open, because its own recovery actions are
      // the only honest next step and they belong to that step rather than to this row.
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") {
        setSettledStop(outcome);
        setStopIntent(null);
      }
    },
    [onOutcome],
  );

  const receipt = direct.outcome ?? settledStop;

  return (
    <div data-slot="module-toggle-row" data-module-key={entry.key} data-enabled={entry.enabled ? "true" : "false"} data-read-state={entry.readState ?? "not-stated"} aria-busy={direct.pending ? true : undefined} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span id={nameId} className="min-w-0 text-sm font-medium wrap-anywhere">
            <bdi>{copy.name}</bdi>
          </span>
          <span id={stateId}>
            <Badge variant={variant}>
              <bdi>{stateWord}</bdi>
            </Badge>
          </span>
        </p>
        <Switch checked={entry.enabled} onCheckedChange={changeTo} aria-labelledby={`${nameId} ${stateId}`} aria-describedby={describedBy} aria-disabled={blocked ? true : undefined} className="aria-disabled:opacity-60" />
      </div>
      <p id={descriptionId} className="text-sm text-pretty text-muted-foreground">
        {copy.description}
      </p>
      {direct.pending ? (
        <output aria-live="polite" className="block text-sm text-muted-foreground">
          {BUSY_SENTENCE}
        </output>
      ) : null}
      {refusal === null ? null : <StateNotice kind="refused" title={NOT_SENT_TITLE} description={refusal} headingLevel={rowHeadingLevel} />}
      {entry.enabled ? null : (
        <p className="text-sm text-pretty text-muted-foreground">
          <bdi>{OFF_WORD}</bdi>
          {": "}
          {OFF_SENTENCE}
        </p>
      )}
      {entry.enabled && entry.readState === null ? (
        <p className="text-sm text-pretty text-muted-foreground">
          <bdi>{UNSTATED_WORD}</bdi>
          {": "}
          {UNSTATED_SENTENCE}
        </p>
      ) : null}
      {entry.enabled && entry.readState !== null ? <StateStatement state={entry.readState} source={entry.source ?? null} headingLevel={rowHeadingLevel} /> : null}
      {receipt === null ? null : (
        <ModuleReceipt
          outcome={receipt}
          heading={`${copy.name} — ${OUTCOME_HEADINGS[receipt.outcome]}`}
          onCheckResult={receipt.outcome === "unknown" ? onCheckResult : undefined}
          onRetrySameWork={receipt.outcome === "unavailable" ? () => runDirect(direct.retry) : undefined}
          onReapply={receipt.outcome === "conflict" ? () => runDirect(direct.reapply) : undefined}
        />
      )}
      {stopIntent === null ? null : (
        <div className="flex min-w-0 flex-col gap-3">
          <Separator />
          <ActionReview<ModuleChangePayload>
            title={STOP_EFFECT_COPY["stop-module"].title}
            description={
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-medium text-foreground">
                  <bdi>{copy.name}</bdi>
                </p>
                <p>{STOP_EFFECT_COPY["stop-module"].question}</p>
                <p>{STOP_EFFECT_COPY["stop-module"].consequence}</p>
                <p>{STOP_EFFECT_COPY["stop-module"].assurance}</p>
              </div>
            }
            confirmLabel={STOP_EFFECT_COPY["stop-module"].title}
            onCancel={() => {
              setStopIntent(null);
            }}
            input={{ scope, expectedRevision, payload: stopIntent }}
            submit={submit}
            onSettled={settleStop}
            checkResult={onCheckResult}
            fieldLabels={FIELD_LABELS}
            headingLevel={rowHeadingLevel}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The five modules
// ---------------------------------------------------------------------------------------------

/**
 * The worker's control over the five coaching modules: one switch per module, each submitting
 * `setModule` for that module alone, and each module's read state stated as one of five distinct
 * statements (`empty`, `partial`, `withheld`, `unavailable`, `ended`) that are never words for one
 * another. Switching a module off is a stop: it ends future sharing of that module, deletes nothing,
 * and cannot recall what a coach has already seen; it therefore goes through the shared review step,
 * while switching one on is applied directly with its outcome recorded in the row. Every outcome is
 * one of the shared eight, rendered in place, and a module that cannot be switched says why in text.
 */
export default function ModuleToggles({ grantId, modules, scope, expectedRevision, grantState, cutoffInstant, onOutcome, onCheckResult, headingLevel = 2, className }: ModuleTogglesProps): ReactElement {
  const headingId = useId();
  const gateId = useId();
  const CardHeading = CARD_HEADING_TAG[headingLevel];
  const cutoff = cutoffInstant === null || cutoffInstant === undefined || cutoffInstant.trim() === "" ? null : cutoffInstant;
  const gate = gateFor(grantState, cutoff);
  if (!hasClosedModuleSet(modules)) {
    // A rendering component does not throw on the data it was handed: a set that is not the closed
    // five is this surface's own refused request, not a source outage, so `unavailable` — which states
    // that the source behind a read is down — is deliberately not used here.
    return <StateNotice kind="refused" title={SET_INCOMPLETE_TITLE} description={SET_INCOMPLETE_DESCRIPTION} headingLevel={headingLevel} className={className} />;
  }
  const rowHeadingLevel = ROW_HEADING_LEVEL[headingLevel];
  const rows = MODULE_KEYS.map((key) => ({ key, entry: entryFor(modules, key) }));
  const gateReasonId = gate.stateCopy === null ? null : gateId;
  const stateCopy = gate.stateCopy;
  return (
    <Card data-slot="module-toggles" data-grant-state={grantState} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <CardHeading id={headingId}>{CARD_HEADING}</CardHeading>
        </CardTitle>
        <CardDescription>
          <p>{COACHING_COPY.sharing.purpose}</p>
          <p>{INTRO_SENTENCE}</p>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {stateCopy === null ? null : (
          <Alert role={undefined} className="min-w-0">
            <AlertTitle>{stateCopy.label}</AlertTitle>
            <AlertDescription>
              <div id={gateId} className="flex min-w-0 flex-col gap-1">
                <p>{stateCopy.description}</p>
                {gate.reason === null ? null : <p>{gate.reason}</p>}
                {gate.cutoffInstant === null ? null : (
                  <p>
                    {EXPIRED_CUTOFF_LEAD}
                    <bdi className="mono-identifier">{gate.cutoffInstant}</bdi>
                    {EXPIRED_CUTOFF_TAIL}
                  </p>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex min-w-0 flex-col gap-3">
          {rows.map(({ key, entry }, index) =>
            entry === undefined ? null : (
              <li key={key} className="flex min-w-0 flex-col gap-3">
                {index === 0 ? null : <Separator />}
                <ModuleRow entry={entry} grantId={grantId} scope={scope} expectedRevision={expectedRevision} gate={gate} gateId={gateReasonId} rowHeadingLevel={rowHeadingLevel} onOutcome={onOutcome} onCheckResult={onCheckResult} />
              </li>
            ),
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

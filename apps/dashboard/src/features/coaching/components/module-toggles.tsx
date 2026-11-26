"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import OperationResult, { OUTCOME_HEADINGS } from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
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
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COMPLETE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY, STOP_EFFECT_COPY, type StateCopy } from "../copy";
import { useSetModule } from "../hooks/use-coaching";
import { moduleChangePayloadSchema, type ModuleChangePayload } from "../schemas";
import { ModuleReadStateNotice } from "./sharing-summary";
const OFF_WORD = "Off";
const SET_INCOMPLETE_DESCRIPTION = "All five coaching modules are required before sharing switches can be shown. Nothing was changed.";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { grantId: "Coaching relationship", moduleKey: "Module", enabled: "Sharing of this module" };
const CARD_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
type RowHeadingLevel = 2 | 3 | 4;
/** The one type scale's heading utility per level, so the modules card states the level it sits at with the same measure on every surface. */ const CARD_HEADING_SCALE: Readonly<Record<RowHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const ROW_HEADING_LEVEL: Readonly<Record<RowHeadingLevel, RowHeadingLevel>> = { 2: 3, 3: 4, 4: 4 };
type StateVariant = "secondary" | "outline" | "destructive" | "ghost";
const STATE_VARIANT: Readonly<Record<ModuleReadState, StateVariant>> = { empty: "outline", partial: "secondary", withheld: "outline", unavailable: "destructive", ended: "secondary" };
/** The tone a complete share carries: the secondary tone the sharing summary gives its own complete-share badge, so one reading looks the same on both surfaces. */ const COMPLETE_VARIANT: StateVariant = "secondary";
export type ModuleToggleEntry = { readonly key: ModuleKey; readonly enabled: boolean; readonly readState: ModuleReadState | null; readonly source?: SourceReference | null };
export type ModuleTogglesProps = {
  readonly grantId: string;
  readonly modules: ReadonlyArray<ModuleToggleEntry>;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly grantState: GrantLifecycleState;
  readonly cutoffInstant?: string | null;
  readonly onOutcome?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
};
type ShareGate = { readonly selectable: boolean; readonly stateCopy: StateCopy | null; readonly reason: string | null; readonly cutoffInstant: string | null };
const OPEN_GATE: ShareGate = { selectable: false, stateCopy: null, reason: null, cutoffInstant: null };
function gateFor(grantState: GrantLifecycleState, cutoffInstant: string | null): ShareGate {
  const open: ShareGate = { ...OPEN_GATE, selectable: true };
  if (grantState === "active") return open;
  if (grantState === "invited") return { selectable: false, stateCopy: GRANT_STATE_COPY.invited, reason: "Modules can be turned on after your coach accepts the invitation.", cutoffInstant: null };
  if (grantState === "accepted") return { selectable: false, stateCopy: GRANT_STATE_COPY.accepted, reason: "Your coach accepted, but access isn’t live yet. You can turn modules on once access is active.", cutoffInstant: null };
  const closed = GRANT_STATE_COPY[grantState];
  return { selectable: false, stateCopy: closed, reason: null, cutoffInstant: grantState === "expired" ? cutoffInstant : null };
}
const hasClosedModuleSet = (modules: ReadonlyArray<ModuleToggleEntry>): boolean => modules.length === MODULE_KEYS.length && new Set(modules.map((entry) => entry.key)).size === modules.length && MODULE_KEYS.every((key) => modules.some((entry) => entry.key === key));
const entryFor = (modules: ReadonlyArray<ModuleToggleEntry>, key: ModuleKey): ModuleToggleEntry | undefined => modules.find((entry) => entry.key === key);
/** The state word a row shows: the complete-share word for a switched-on module whose content is whole, the module's own state word while the read states one, and the plain fact that it is off when it is not shared. */
const stateWordOf = (entry: ModuleToggleEntry): string => (!entry.enabled ? OFF_WORD : entry.readState === null ? MODULE_COMPLETE_COPY.label : MODULE_READ_STATE_COPY[entry.readState].label);
const stateVariantOf = (entry: ModuleToggleEntry): StateVariant => (!entry.enabled ? "ghost" : entry.readState === null ? COMPLETE_VARIANT : STATE_VARIANT[entry.readState]);
/** What the read established, in the read's own vocabulary: `complete` for a switched-on module whose content is whole, the state while the read states one, and `not-stated` only for a module that is not shared. */
const readStateAttributeOf = (entry: ModuleToggleEntry): ModuleReadState | "complete" | "not-stated" => (!entry.enabled ? "not-stated" : (entry.readState ?? "complete"));
type BuiltPayload = { readonly payload: ModuleChangePayload } | { readonly refusal: string };
function payloadForChange(grantId: string, moduleKey: ModuleKey, enabled: boolean): BuiltPayload {
  const parsed = moduleChangePayloadSchema.safeParse({ grantId, moduleKey, enabled });
  if (parsed.success) return { payload: parsed.data };
  const messages = parsed.error.issues.map((issue) => issue.message);
  return { refusal: messages.length === 0 ? "No coaching relationship was specified, so this change wasn’t sent." : messages.join(" ") };
}
type ModuleReceiptProps = { readonly outcome: MutationOutcome; readonly heading: string; readonly onCheckResult?: (() => void) | undefined; readonly onRetrySameWork?: (() => void) | undefined; readonly onReapply?: (() => void) | undefined };
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
function ModuleRow({ entry, grantId, scope, expectedRevision, gate, gateId, rowHeadingLevel, onOutcome, onCheckResult }: ModuleRowProps): ReactElement {
  const copy = MODULE_COPY[entry.key];
  const [nameId, stateId, descriptionId] = [useId(), useId(), useId()];
  const { mutateAsync: changeModule } = useSetModule();
  const submit = useCallback<MutationSubmit<ModuleChangePayload>>((input) => changeModule({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [changeModule]);
  const direct = useReviewedMutation<ModuleChangePayload>(submit);
  const [stopIntent, setStopIntent] = useState<ModuleChangePayload | null>(null);
  const [settledStop, setSettledStop] = useState<MutationOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const blocked = !gate.selectable || direct.pending || stopIntent !== null;
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
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") {
        setSettledStop(outcome);
        setStopIntent(null);
      }
    },
    [onOutcome],
  );
  const receipt = direct.outcome ?? settledStop;
  return (
    <div data-slot="module-toggle-row" data-module-key={entry.key} data-enabled={entry.enabled ? "true" : "false"} data-read-state={readStateAttributeOf(entry)} aria-busy={direct.pending ? true : undefined} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span id={nameId} className="min-w-0 text-sm font-medium wrap-anywhere">
            <bdi>{copy.name}</bdi>
          </span>
          <span id={stateId}>
            <Badge variant={variant}>
              <bdi>{stateWordOf(entry)}</bdi>
            </Badge>
          </span>
        </p>
        <Switch checked={entry.enabled} onCheckedChange={changeTo} aria-labelledby={`${nameId} ${stateId}`} aria-describedby={gateId === null ? descriptionId : `${descriptionId} ${gateId}`} aria-disabled={blocked ? true : undefined} className="aria-disabled:opacity-60" />
      </div>
      <p {...{ id: descriptionId, className: "type-supporting text-pretty" }}>{copy.description}</p>
      {direct.pending ? <output {...{ "aria-live": "polite", className: "block text-sm text-muted-foreground" }}>{"Saving module setting…"}</output> : null}
      {refusal === null ? null : <StateNotice kind="refused" title="Couldn’t update module" description={refusal} headingLevel={rowHeadingLevel} />}
      {entry.enabled ? null : (
        <p className="type-supporting text-pretty">
          <bdi>{OFF_WORD}</bdi>
          {": "}
          {"Your coach can’t see this module. Your work stays intact, and you can turn it back on anytime."}
        </p>
      )}
      {entry.enabled && entry.readState === null ? (
        <p className="type-supporting text-pretty">
          <bdi>{MODULE_COMPLETE_COPY.label}</bdi>
          {": "}
          {MODULE_COMPLETE_COPY.description}
        </p>
      ) : null}
      {entry.enabled && entry.readState !== null ? <ModuleReadStateNotice readState={entry.readState} source={entry.source ?? null} headingLevel={rowHeadingLevel} /> : null}
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
export default function ModuleToggles({ grantId, modules, scope, expectedRevision, grantState, cutoffInstant, onOutcome, onCheckResult, headingLevel = 2, className }: ModuleTogglesProps): ReactElement {
  const [headingId, gateId] = [useId(), useId()];
  const CardHeading = CARD_HEADING_TAG[headingLevel];
  const cutoff = cutoffInstant === null || cutoffInstant === undefined || cutoffInstant.trim() === "" ? null : cutoffInstant;
  const gate = gateFor(grantState, cutoff);
  if (!hasClosedModuleSet(modules)) return <StateNotice kind="refused" title="Couldn’t load coaching modules" description={SET_INCOMPLETE_DESCRIPTION} headingLevel={headingLevel} className={className} />;
  const rowHeadingLevel = ROW_HEADING_LEVEL[headingLevel];
  const rows = MODULE_KEYS.map((key) => ({ key, entry: entryFor(modules, key) }));
  const enabledCount = modules.filter((entry) => entry.enabled).length;
  const stateCopy = gate.stateCopy;
  return (
    <Card data-slot="module-toggles" data-grant-state={grantState} className={cn("min-w-0", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            <CardHeading {...{ id: headingId, className: CARD_HEADING_SCALE[headingLevel] }}>{"Shared modules"}</CardHeading>
          </CardTitle>
          <Badge variant={enabledCount > 0 ? "secondary" : "outline"} className="tabular-figures">
            {`${String(enabledCount)} of ${String(MODULE_KEYS.length)} shared`}
          </Badge>
        </div>
        <CardDescription>
          <p>{COACHING_COPY.sharing.purpose}</p>
          <p>{"All modules start off. Turn on only the areas you want your coach to see."}</p>
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
                    {"Access ended at "}
                    <bdi className="mono-identifier">{gate.cutoffInstant}</bdi>
                    {". New reads aren’t permitted after this cutoff."}
                  </p>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex min-w-0 flex-col gap-2.5">
          {rows.map(({ key, entry }) =>
            entry === undefined ? null : (
              <li key={key} className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border p-3.5 transition-colors", entry.enabled ? "border-foreground/25 bg-card shadow-2xs" : "border-border/80 bg-surface-subtle")}>
                <ModuleRow entry={entry} grantId={grantId} scope={scope} expectedRevision={expectedRevision} gate={gate} gateId={gate.stateCopy === null ? null : gateId} rowHeadingLevel={rowHeadingLevel} onOutcome={onOutcome} onCheckResult={onCheckResult} />
              </li>
            ),
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

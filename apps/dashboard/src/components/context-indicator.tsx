"use client";
/** The one active-context display, and the one control that asks to change it. */
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { ContextSwitchResult, OutcomeSummary } from "@/components/context-switch-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";
export type AdmittedContext = {
  readonly organizationId: string;
  readonly organizationLabel: string;
  readonly ministryId: string;
  readonly ministryLabel: string;
  /** The finance subject this membership reports in, as the chooser listed it. */
  readonly supportSubjectId?: string;
};
export type ContextRequest = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId?: string };
export type ContextIndicatorProps = { readonly scope: Scope; readonly admissions: readonly AdmittedContext[]; readonly onRequestContext: (next: ContextRequest) => void; readonly showSupportSubject?: boolean; readonly lastResult?: ContextSwitchResult | null; readonly className?: string };
const IDENTIFIER_CLASS = "mono-identifier break-all";
function labelOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
const isCurrentContext = (admission: AdmittedContext, scope: Scope): boolean => admission.organizationId === scope.organizationId && admission.ministryId === scope.ministryId;
function keyOf(context: { readonly organizationId: string; readonly ministryId: string }): string {
  return `${context.organizationId}::${context.ministryId}`;
}
function describeContext(organizationLabel: string | null, organizationReference: string, ministryLabel: string | null, ministryReference: string): string {
  return `${organizationLabel ?? organizationReference}, ${ministryLabel ?? ministryReference}`;
}
type ContextNameProps = { readonly organizationLabel: string | null; readonly organizationReference: string; readonly ministryLabel: string | null; readonly ministryReference: string; readonly truncate: boolean; readonly markCurrent?: boolean; readonly srPrefix?: string };
function ContextName({ organizationLabel, organizationReference, ministryLabel, ministryReference, truncate, markCurrent = false, srPrefix }: ContextNameProps): ReactElement {
  const line = truncate ? "truncate" : "break-words";
  return (
    <span className="flex min-w-0 max-w-full flex-col items-start">
      {srPrefix === undefined ? null : <span className="sr-only">{srPrefix}</span>}
      <span className={cn("max-w-full text-xs leading-tight text-muted-foreground", line)}>{organizationLabel === null ? <bdi className={IDENTIFIER_CLASS}>{organizationReference}</bdi> : <bdi>{organizationLabel}</bdi>}</span>
      <span
        className={cn("max-w-full text-sm leading-tight font-medium", line)}
        // The static form is the whole of the "which context is this" answer, so it is marked as the current one. Inside the chooser the marking belongs to the menu item that denotes this context, and inside the trigger the control's accessible name already says it.
        aria-current={markCurrent ? "true" : undefined}
      >
        {ministryLabel === null ? <bdi className={IDENTIFIER_CLASS}>{ministryReference}</bdi> : <bdi>{ministryLabel}</bdi>}
      </span>
    </span>
  );
}
function SupportSubject({ reference }: { readonly reference: string }): ReactElement {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">Support subject</span>
      <Badge variant="outline" className="max-w-full">
        <bdi className={cn(IDENTIFIER_CLASS, "truncate")}>{reference}</bdi>
      </Badge>
    </span>
  );
}
function SwitchNotice({ summary }: { readonly summary: OutcomeSummary }): ReactElement {
  return (
    // `<output>` carries the implicit `status` role, so the outcome is announced once and politely, and it is still ordinary text for a reader who sees it.
    <output className="flex min-w-0 max-w-full flex-col gap-0.5 text-xs">
      <span className="break-words text-foreground">{summary.sentence}</span>
      {summary.detail === undefined ? null : (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="shrink-0">{summary.detail.label}</span>
          <bdi className={cn(IDENTIFIER_CLASS, "truncate")}>{summary.detail.value}</bdi>
        </span>
      )}
    </output>
  );
}
function requestFor(admission: AdmittedContext): ContextRequest {
  return { organizationId: admission.organizationId, ministryId: admission.ministryId };
}
type ContextChooserProps = { readonly admissions: readonly AdmittedContext[]; readonly current: AdmittedContext | null; readonly scope: Scope; readonly triggerLabel: string; readonly onRequestContext: (next: ContextRequest) => void; readonly children: ReactNode };
function ContextChooser({ admissions, current, scope, triggerLabel, onRequestContext, children }: ContextChooserProps): ReactElement {
  const currentKey = current === null ? null : keyOf(current);
  // The tooltip states the names in full — a truncated label cannot — and the two references, which are what distinguishes two ministries whose names read alike.
  const organizationName = current === null ? null : labelOrNull(current.organizationLabel);
  const ministryName = current === null ? null : labelOrNull(current.ministryLabel);
  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          {/* One element is both the menu trigger and the tooltip trigger, so the full names are reachable by pointer without a second header control; this is the composition Base UI documents, where neither trigger replaces the other's behaviour. */}
          <TooltipTrigger
            render={
              <DropdownMenuTrigger type="button" aria-label={triggerLabel} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto max-w-full min-w-0 justify-start gap-2 px-2.5 py-1 text-start")}>
                {children}
                <ChevronsUpDownIcon aria-hidden="true" className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
            }
          />
          <TooltipContent className="flex-col items-start gap-1">
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Ministry</span>
              <span className="break-words font-medium">{ministryName ?? scope.ministryId}</span>
            </span>
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Organization</span>
              <span className="break-words">{organizationName ?? scope.organizationId}</span>
            </span>
            <Separator className="my-0.5" />
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Ministry reference</span>
              <bdi className={IDENTIFIER_CLASS}>{scope.ministryId}</bdi>
            </span>
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Organization reference</span>
              <bdi className={IDENTIFIER_CLASS}>{scope.organizationId}</bdi>
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Admitted contexts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {admissions.map((admission) => {
          const atCurrent = keyOf(admission) === currentKey;
          return (
            <DropdownMenuItem
              key={keyOf(admission)}
              aria-current={atCurrent ? "true" : undefined}
              className="items-start"
              onClick={() => {
                if (atCurrent) return;
                onRequestContext(requestFor(admission));
              }}
            >
              <ContextName organizationLabel={labelOrNull(admission.organizationLabel)} organizationReference={admission.organizationId} ministryLabel={labelOrNull(admission.ministryLabel)} ministryReference={admission.ministryId} truncate />
              {atCurrent ? (
                // The word carries the state; the tick repeats it for speed of scanning only.
                <span className="ms-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  Current
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
/** The active context, always stated, and the one place a change of context is asked for. */
export function ContextIndicator({ scope, admissions, onRequestContext, showSupportSubject = false, lastResult = null, className }: ContextIndicatorProps): ReactElement {
  const current = admissions.find((admission) => isCurrentContext(admission, scope)) ?? null;
  const canChoose = admissions.length > 1;
  const organizationLabel = current === null ? null : labelOrNull(current.organizationLabel);
  const ministryLabel = current === null ? null : labelOrNull(current.ministryLabel);
  // The two names and the mode they render in, shared by the trigger and the static form.
  const nameProps = { organizationLabel, organizationReference: scope.organizationId, ministryLabel, ministryReference: scope.ministryId, truncate: canChoose } as const;
  // A switch that took effect needs no notice: the new context is the statement. Only the three outcomes that left the context where it was are reported here.
  const notice = lastResult === null || lastResult.switched ? null : lastResult.summary;
  return (
    <div className={cn("flex min-w-0 max-w-full flex-col gap-1", className)}>
      {canChoose ? (
        <ContextChooser admissions={admissions} current={current} scope={scope} triggerLabel={`Active context: ${describeContext(organizationLabel, scope.organizationId, ministryLabel, scope.ministryId)}. Change context.`} onRequestContext={onRequestContext}>
          <ContextName {...nameProps} />
        </ContextChooser>
      ) : (
        // With one membership there is nothing to choose, so the label is not a control: it is the answer, marked as the context in force and announced as such.
        <ContextName {...nameProps} markCurrent srPrefix="Active context. " />
      )}
      {showSupportSubject ? <SupportSubject reference={scope.supportSubjectId} /> : null}
      {current === null ? (
        // The scope names a context the session does not admit. Saying so is the honest rendering: the alternative is a blank or a guessed name, and either would hide that the screen and the session disagree.
        <span className="max-w-full break-words text-xs text-muted-foreground">This context is not among the memberships this session admits, so no names are available for it. The references above identify what was read.</span>
      ) : null}
      {notice === null ? null : <SwitchNotice summary={notice} />}
    </div>
  );
}
export default ContextIndicator;

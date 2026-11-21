"use client";
/**
 * The single surface for the seven states that are not a result.
 */
import Link from "next/link";
import { CircleAlertIcon, CloudOffIcon, LanguagesIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { Coverage, CoverageState } from "@/modules/data-service/envelope";
import type { DenialReason } from "@/modules/data-service/outcome";
/** Every state this component renders, listed once so the closed set has a runtime form as well as a type. */
export const NOTICE_KINDS = ["empty", "loading", "unavailable", "unknown", "denied", "partial-coverage", "language-unavailable"] as const;
/** One state a surface can be in instead of showing a result. */
export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** An in-page command a notice may run. */
export type NoticeHandler = () => void | Promise<void>;
/** The one call to action a notice offers. */
export interface NoticeAction {
  readonly label: string;
  readonly href?: string;
  readonly onClick?: NoticeHandler;
}
/** A re-request of the work that produced the notice. */
export interface NoticeRetry {
  readonly label: string;
  readonly onClick: NoticeHandler;
}
/** The heading levels a surrounding page can need; the level is the caller's, not the notice's. */
export type NoticeHeadingLevel = 1 | 2 | 3 | 4;
/** Props of {@link StateNotice}. */
export interface StateNoticeProps {
  readonly kind: NoticeKind;
  readonly title: string;
  readonly description?: string;
  readonly action?: NoticeAction;
  readonly source?: SourceReference;
  readonly retry?: NoticeRetry;
  readonly operationId?: string;
  readonly coverage?: Coverage;
  readonly reasonCode?: DenialReason;
  readonly headingLevel?: NoticeHeadingLevel;
  readonly loadingLines?: number;
  readonly className?: string;
}
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
};
const LOADING_LINE_WIDTHS = ["w-full", "w-2/3", "w-4/5", "w-1/2"] as const;

const MAX_LOADING_LINES = 12;

const DEFAULT_LOADING_LINES = 3;

type AlertNoticeKind = Exclude<NoticeKind, "empty" | "loading">;

interface AlertContent {
  readonly icon: ReactElement;
  readonly body: ReactNode;
}
interface AlertContentInput {
  readonly kind: AlertNoticeKind;
  readonly description: string | undefined;
  readonly source: SourceReference | undefined;
  readonly retry: NoticeRetry | undefined;
  readonly operationId: string | undefined;
  readonly coverage: Coverage | undefined;
  readonly reasonCode: DenialReason | undefined;
}
function NoticeHeading({ level, children }: { readonly level: NoticeHeadingLevel; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return <Tag>{children}</Tag>;
}
const NOTICE_CONTROL_CLASS = "h-auto max-w-full whitespace-normal";

const NOTICE_CONTROL_HEIGHT: Readonly<Record<"default" | "sm", string>> = {
  default: "min-h-9 py-2",
  sm: "min-h-8 py-1.5",
};
interface NoticeButtonProps {
  readonly action: NoticeAction;
  readonly variant: "default" | "outline";
  readonly size: "default" | "sm";
  readonly pending: boolean;
  readonly onRun: (() => void) | undefined;
}
function NoticeButton({ action, variant, size, pending, onRun }: NoticeButtonProps): ReactElement | null {
  const controlClass = cn(NOTICE_CONTROL_CLASS, NOTICE_CONTROL_HEIGHT[size]);
  if (action.href !== undefined) {
    return (
      <Link href={action.href} className={cn(buttonVariants({ variant, size }), controlClass)}>
        {action.label}
      </Link>
    );
  }
  if (onRun === undefined) {
    return null;
  }
  return (
    <Button type="button" variant={variant} size={size} disabled={pending} onClick={onRun} className={controlClass}>
      {pending ? <Spinner /> : null}
      {action.label}
    </Button>
  );
}
const COVERAGE_DATE_CLASS = "whitespace-nowrap";

function CoverageGapSentence({ coverage }: { readonly coverage: Coverage }): ReactNode {
  const { from, to } = coverage;
  if (from === null && to === null) {
    return "The source stated neither a start nor an end for the period its records cover.";
  }
  if (to === null) {
    return (
      <>
        The source covers records from <bdi className={COVERAGE_DATE_CLASS}>{from}</bdi> onwards; every date before that one is outside the covered period.
      </>
    );
  }
  if (from === null) {
    return (
      <>
        The source covers records up to <bdi className={COVERAGE_DATE_CLASS}>{to}</bdi>; every date after that one is outside the covered period.
      </>
    );
  }
  return (
    <>
      The source covers records from <bdi className={COVERAGE_DATE_CLASS}>{from}</bdi> to <bdi className={COVERAGE_DATE_CLASS}>{to}</bdi>; every date before or after that range is outside the covered
      period.
    </>
  );
}
function CoverageCompletenessSentence({ state }: { readonly state: CoverageState }): string {
  switch (state) {
    case "complete":
      return "The source reports that period as fully covered, so a total over it covers all of the period.";
    case "partial":
      return "The source reports that period as only partly covered, so every total here is an incomplete subtotal rather than a whole-period figure.";
    case "unknown":
      return "Whether the source covers that whole period is not known, so every total here is an incomplete subtotal rather than a whole-period figure.";
  }
}
function CoverageSummary({ coverage }: { readonly coverage: Coverage | undefined }): ReactElement {
  if (coverage === undefined) {
    return (
      <>
        <p>The source did not state the period its records cover.</p>
        <p>Without a stated period, no total here can be presented as a whole-period figure, so every total is an incomplete subtotal.</p>
      </>
    );
  }
  return (
    <>
      <p>
        <CoverageGapSentence coverage={coverage} />
      </p>
      <p>
        <CoverageCompletenessSentence state={coverage.state} />
      </p>
    </>
  );
}
function renderAlertContent(input: AlertContentInput): AlertContent {
  const { kind, description, source, retry, operationId, coverage, reasonCode } = input;
  switch (kind) {
    case "unavailable":
      return {
        icon: <CloudOffIcon aria-hidden="true" />,
        body: (
          <>
            <p>The source that holds this data could not be read, so this surface reports the outage instead of an empty result or a zero.</p>
            {source === undefined ? null : (
              <p>
                Source <bdi className="mono-identifier">{formatSourceReference(source)}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            {retry === undefined ? null : <p>Retrying re-requests this read. Until it succeeds, no value on this surface stands in for the missing data.</p>}
          </>
        ),
      };
    case "unknown":
      return {
        icon: <CircleAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>This change may have been applied and its acknowledgement never arrived, so its outcome is not known.</p>
            {operationId === undefined ? null : (
              <p>
                Operation <bdi className="mono-identifier">{operationId}</bdi>. Checking it returns the original result when the change was applied, and applies nothing when it was not.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>
              No second attempt starts from here: a check reads what happened, and repeating the same request under the same operation replays its original result rather than repeating the effect.
            </p>
          </>
        ),
      };
    case "denied":
      return {
        icon: <ShieldAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>This request is not permitted in the current scope and session.</p>
            {reasonCode === undefined ? null : (
              <p>
                Reason <bdi className="mono-identifier">{reasonCode}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>The answer is identical whether or not anything exists here, so nothing on this surface reveals what it cannot show.</p>
          </>
        ),
      };
    case "partial-coverage":
      return {
        icon: <TriangleAlertIcon aria-hidden="true" />,
        body: (
          <>
            <CoverageSummary coverage={coverage} />
            {description === undefined ? null : <p>{description}</p>}
          </>
        ),
      };
    case "language-unavailable":
      return {
        icon: <LanguagesIcon aria-hidden="true" />,
        body: (
          <>
            <p>No edition this reader is permitted to read exists in the requested language, so nothing is shown in its place.</p>
            {description === undefined ? null : <p>{description}</p>}
            <p>A fallback the reader may not read is neither offered nor named here, so this surface reports the missing language instead of substituting one.</p>
          </>
        ),
      };
  }
}
/** The one empty, busy, unavailable, unknown, denied, partial-coverage or language-unavailable surface in the application. */
export function StateNotice({
  kind,
  title,
  description,
  action,
  source,
  retry,
  operationId,
  coverage,
  reasonCode,
  headingLevel = 3,
  loadingLines = DEFAULT_LOADING_LINES,
  className,
}: StateNoticeProps): ReactElement {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const run = (handler: NoticeHandler, returnFocusToNotice: boolean): void => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const settle = (): void => {
      pendingRef.current = false;
      setPending(false);
      if (returnFocusToNotice) {
        regionRef.current?.focus();
      }
    };
    let result: void | Promise<void>;
    try {
      result = handler();
    } catch {
      settle();
      return;
    }
    void Promise.resolve(result).then(settle, settle);
  };
  const actionOnClick = action?.onClick;
  const runAction =
    actionOnClick === undefined
      ? undefined
      : (): void => {
          run(actionOnClick, false);
        };
  const retryOnClick = retry?.onClick;
  const runRetry =
    retryOnClick === undefined
      ? undefined
      : (): void => {
          run(retryOnClick, true);
        };
  const busy = pending ? true : undefined;
  if (kind === "empty") {
    return (
      <Empty
        ref={regionRef}
        role="alert"
        aria-busy={busy}
        tabIndex={-1}
        // A phone width cannot spare the design system's large empty-state padding: at 320 CSS px
        // it would leave a text column narrower than a word. The padding steps down on narrow
        // surfaces and is unchanged from the small breakpoint upwards.
        className={cn("p-6 sm:p-12", className)}
      >
        <EmptyHeader>
          <EmptyTitle>
            <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
          </EmptyTitle>
          {description === undefined ? null : <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {action === undefined ? null : (
          <EmptyContent>
            <NoticeButton action={action} variant="default" size="default" pending={pending} onRun={runAction} />
          </EmptyContent>
        )}
      </Empty>
    );
  }
  if (kind === "loading") {
    const lines = Math.min(Math.max(Math.trunc(loadingLines), 1), MAX_LOADING_LINES);
    return (
      <div ref={regionRef} aria-busy={true} tabIndex={-1} className={cn("flex w-full flex-col gap-3 rounded-lg border border-dashed border-border p-6", className)}>
        {/*
          The status line is deliberately not a heading. It exists only while the region is busy,
          so a heading here would add a heading to the page's outline and remove it again on every
          load; `aria-busy` and this visible line state the condition without that churn.
        */}
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Spinner />
          <span>{title}</span>
        </p>
        {description === undefined ? null : <p className="text-sm text-muted-foreground">{description}</p>}
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: lines }, (_, line) => (
            <Skeleton key={line} className={cn("h-4 rounded-md", LOADING_LINE_WIDTHS[line % LOADING_LINE_WIDTHS.length])} />
          ))}
        </div>
      </div>
    );
  }
  const { icon, body } = renderAlertContent({
    kind,
    description,
    source,
    retry,
    operationId,
    coverage,
    reasonCode,
  });
  const buttons: ReactElement[] = [];
  if (action !== undefined) {
    const actionButton = <NoticeButton key="action" action={action} variant="default" size="sm" pending={pending} onRun={runAction} />;
    if (actionButton !== null) {
      buttons.push(actionButton);
    }
  }
  if (retry !== undefined) {
    buttons.push(<NoticeButton key="retry" action={retry} variant="outline" size="sm" pending={pending} onRun={runRetry} />);
  }
  return (
    <Alert ref={regionRef} role={kind === "unavailable" ? "alert" : "status"} aria-busy={busy} tabIndex={-1} className={className}>
      {icon}
      <AlertTitle>
        <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
      </AlertTitle>
      <AlertDescription>
        {body}
        {buttons.length === 0 ? null : <div className="flex flex-wrap items-center gap-2">{buttons}</div>}
      </AlertDescription>
    </Alert>
  );
}
export default StateNotice;

"use client";
import Link from "next/link";
import { CircleAlertIcon, CloudOffIcon, LanguagesIcon, ShieldAlertIcon, SquarePenIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { EmptyIllustration, type EmptyIllustrationVariant } from "@/components/ui/empty-illustration";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { Coverage, CoverageState } from "@/modules/data-service/envelope";
import type { DenialReason } from "@/modules/data-service/outcome";
import { NOTICE_HEADING_TAG, nestedNoticeHeadingLevel, type NoticeHeadingLevel } from "@/lib/notice-heading";

export { NOTICE_HEADING_TAG, nestedNoticeHeadingLevel };
export type { NoticeHeadingLevel };
/** Every state this component renders, listed once so the closed set has a runtime form as well as a type. */ export const NOTICE_KINDS = ["empty", "loading", "unavailable", "unknown", "denied", "refused", "partial-coverage", "language-unavailable"] as const;
/** One state a surface can be in instead of showing a result. */ export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** An in-page command a notice may run. */ export type NoticeHandler = () => void | Promise<void>;
/** The one call to action a notice offers. */ export type NoticeAction = { readonly label: string; readonly href?: string; readonly onClick?: NoticeHandler };
/** A re-request of the work that produced the notice. */ export type NoticeRetry = { readonly label: string; readonly onClick: NoticeHandler };
export type StateNoticeProps = {
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
  readonly illustration?: EmptyIllustrationVariant;
  readonly className?: string;
};

function inferEmptyIllustration(title: string): EmptyIllustrationVariant {
  const lower = title.toLowerCase();
  if (lower.includes("filter") || lower.includes("match") || lower.includes("search")) return "filter";
  if (lower.includes("gift") || lower.includes("ledger") || lower.includes("commitment") || lower.includes("support")) return "ledger";
  if (lower.includes("edition") || lower.includes("page") || lower.includes("draft") || lower.includes("update") || lower.includes("section")) return "document";
  return "inbox";
}
const LOADING_LINE_WIDTHS = ["w-full", "w-2/3", "w-4/5", "w-1/2"] as const;
const MAX_LOADING_LINES = 12;
const DEFAULT_LOADING_LINES = 3;
type AlertNoticeKind = Exclude<NoticeKind, "empty" | "loading">;
type AlertContentInput = { readonly kind: AlertNoticeKind; readonly description: string | undefined; readonly source: SourceReference | undefined; readonly retry: NoticeRetry | undefined; readonly operationId: string | undefined; readonly coverage: Coverage | undefined; readonly reasonCode: DenialReason | undefined };
/** The scale each notice heading takes, so a notice states the document outline it lands in: a notice that is the page's own heading reads at the page-title scale, and one beneath a page title or inside a section reads at its level's scale. */
const NOTICE_HEADING_CLASS: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
function NoticeHeading({ level, children }: { readonly level: NoticeHeadingLevel; readonly children: ReactNode }): ReactElement {
  const Tag = NOTICE_HEADING_TAG[level];
  return <Tag className={NOTICE_HEADING_CLASS[level]}>{children}</Tag>;
}
type NoticeButtonProps = { readonly action: NoticeAction; readonly variant: "default" | "outline"; readonly size: "default" | "sm"; readonly pending: boolean; readonly onRun: (() => void) | undefined };
function NoticeButton({ action, variant, size, pending, onRun }: NoticeButtonProps): ReactElement | null {
  if (action.href !== undefined) {
    return (
      <Link href={action.href} data-slot="button" className={cn(buttonVariants({ variant, size }), BUTTON_WRAP_CLASS)}>
        {action.label}
      </Link>
    );
  }
  if (onRun === undefined) return null;
  return (
    <Button type="button" variant={variant} size={size} disabled={pending} onClick={onRun} className={BUTTON_WRAP_CLASS}>
      {pending ? <Spinner /> : null}
      {action.label}
    </Button>
  );
}
const COVERAGE_DATE_CLASS = "whitespace-nowrap";
function CoverageGapSentence({ coverage }: { readonly coverage: Coverage }): ReactNode {
  const { from, to } = coverage;
  if (from === null && to === null) return "The data source didn’t specify a start or end date for its records.";
  if (to === null) {
    return (
      <>
        Records cover from <bdi className={COVERAGE_DATE_CLASS}>{from}</bdi> onwards; earlier dates aren’t included.
      </>
    );
  }
  if (from === null) {
    return (
      <>
        Records cover up to <bdi className={COVERAGE_DATE_CLASS}>{to}</bdi>; later dates aren’t included.
      </>
    );
  }
  return (
    <>
      Records cover <bdi className={COVERAGE_DATE_CLASS}>{from}</bdi> to <bdi className={COVERAGE_DATE_CLASS}>{to}</bdi>; dates outside this range aren’t included.
    </>
  );
}
const COVERAGE_COMPLETENESS: Readonly<Record<CoverageState, string>> = {
  complete: "This period is fully covered.",
  partial: "This period is only partly covered, so totals shown here are incomplete subtotals.",
  unknown: "Coverage for this period isn’t confirmed, so totals shown here are incomplete subtotals.",
};
function CoverageSummary({ coverage }: { readonly coverage: Coverage | undefined }): ReactElement {
  if (coverage === undefined) {
    return (
      <>
        <p>The data source didn’t specify the date range it covers.</p>
        <p>Totals shown here are treated as incomplete subtotals rather than full-period totals.</p>
      </>
    );
  }
  return (
    <>
      <p>
        <CoverageGapSentence coverage={coverage} />
      </p>
      <p>{COVERAGE_COMPLETENESS[coverage.state]}</p>
    </>
  );
}
function renderAlertContent(input: AlertContentInput): { readonly icon: ReactElement; readonly body: ReactNode } {
  const { kind, description, source, retry, operationId, coverage, reasonCode } = input;
  switch (kind) {
    case "unavailable":
      return {
        icon: <CloudOffIcon aria-hidden="true" />,
        body: (
          <>
            <p>We couldn’t reach the data source for this section, so nothing is replaced with zero or an empty list.</p>
            {source === undefined ? null : (
              <p>
                Source: <bdi className="mono-identifier">{formatSourceReference(source)}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            {retry === undefined ? null : <p>Try again to request this data once the source is reachable.</p>}
          </>
        ),
      };
    case "unknown":
      return {
        icon: <CircleAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>This change may have gone through, but we didn’t receive confirmation.</p>
            {operationId === undefined ? null : (
              <p>
                Operation <bdi className="mono-identifier">{operationId}</bdi>. Checking shows whether it succeeded without creating a duplicate.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>Checking inspects what happened safely, and retrying replays the original request rather than applying it twice.</p>
          </>
        ),
      };
    case "denied":
      return {
        icon: <ShieldAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>Your current session doesn’t have access to this view.</p>
            {reasonCode === undefined ? null : (
              <p>
                Reason: <bdi className="mono-identifier">{reasonCode}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>This message is the same whether or not a record exists here.</p>
          </>
        ),
      };
    case "refused":
      return {
        icon: <SquarePenIcon aria-hidden="true" />,
        body: (
          <>
            <p>This request couldn’t be run as entered, so nothing was loaded.</p>
            {description === undefined ? null : <p>{description}</p>}
            <p>Adjust the request parameters and try again.</p>
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
            <p>No edition you have access to is available in this language.</p>
            {description === undefined ? null : <p>{description}</p>}
            <p>Other restricted versions aren’t substituted or listed here.</p>
          </>
        ),
      };
  }
}
/** The one empty, busy, unavailable, unknown, denied, refused, partial-coverage or language-unavailable surface in the application. */
export function StateNotice({ kind, title, description, action, source, retry, operationId, coverage, reasonCode, headingLevel = 3, loadingLines = DEFAULT_LOADING_LINES, illustration, className }: StateNoticeProps): ReactElement {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const run = (handler: NoticeHandler, returnFocusToNotice: boolean): void => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const settle = (): void => {
      pendingRef.current = false;
      setPending(false);
      if (returnFocusToNotice) regionRef.current?.focus();
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
  const runAction = actionOnClick === undefined ? undefined : (): void => run(actionOnClick, false);
  const retryOnClick = retry?.onClick;
  const runRetry = retryOnClick === undefined ? undefined : (): void => run(retryOnClick, true);
  const busy = pending ? true : undefined;
  if (kind === "empty") {
    return (
      // `jsx-a11y/prefer-tag-over-role` is suppressed for this region and only this region: the frame is the design-system `Empty` element, whose tag this component does not own, and the tag the rule prefers (`output`) admits only phrasing content, which the notice's heading and description are not.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      <Empty ref={regionRef} role="status" aria-busy={busy} tabIndex={-1} className={cn("p-6 sm:p-10", className)}>
        <EmptyHeader>
          <EmptyMedia variant="default">
            <EmptyIllustration variant={illustration ?? inferEmptyIllustration(title)} />
          </EmptyMedia>
          <EmptyTitle>
            <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
          </EmptyTitle>
          {/* The one body measure at this composition point: the design system's empty-state description states a relaxed leading of its own, and every 14px paragraph in the product reads at the body measure instead. */}
          {description === undefined ? null : <EmptyDescription className="text-sm font-normal">{description}</EmptyDescription>}
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
    return (
      <Frame spacing="sm" className={className}>
        <FramePanel ref={regionRef} aria-busy={true} tabIndex={-1} className="flex w-full flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Spinner />
            <span>{title}</span>
          </p>
          {description === undefined ? null : <p className="type-supporting">{description}</p>}
          <div aria-hidden="true" className="flex flex-col gap-2">
            {Array.from({ length: Math.min(Math.max(Math.trunc(loadingLines), 1), MAX_LOADING_LINES) }, (_, line) => (
              <Skeleton key={line} className={cn("h-4 rounded-md", LOADING_LINE_WIDTHS[line % LOADING_LINE_WIDTHS.length])} />
            ))}
          </div>
        </FramePanel>
      </Frame>
    );
  }
  const { icon, body } = renderAlertContent({ kind, description, source, retry, operationId, coverage, reasonCode });
  const alertVariant = kind === "unavailable" || kind === "denied" ? "destructive" : kind === "partial-coverage" || kind === "unknown" ? "warning" : "info";
  const actionButton = action === undefined ? null : <NoticeButton key="action" action={action} variant="default" size="sm" pending={pending} onRun={runAction} />;
  const buttons = [actionButton, retry === undefined ? null : <NoticeButton key="retry" action={retry} variant="outline" size="sm" pending={pending} onRun={runRetry} />].filter((button) => button !== null);
  return (
    <Alert ref={regionRef} variant={alertVariant} role={kind === "unavailable" ? "alert" : "status"} aria-busy={busy} tabIndex={-1} className={className}>
      {icon}
      <AlertTitle>
        <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
      </AlertTitle>
      <AlertDescription>
        {body}
        {buttons.length === 0 ? null : <div className="mt-2 flex flex-wrap items-center gap-2">{buttons}</div>}
      </AlertDescription>
    </Alert>
  );
}
export default StateNotice;

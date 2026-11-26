"use client";
import * as React from "react";
import { MonitorIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedTabs, type SegmentedOption } from "@/components/ui/segmented-tabs";
import { cn } from "@/lib/cn";

export type PreviewViewportMode = "desktop" | "tablet" | "mobile";

const VIEWPORT_OPTIONS: readonly SegmentedOption<PreviewViewportMode>[] = [
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "mobile", label: "Mobile" },
];

const VIEWPORT_FRAME_CLASS: Readonly<Record<PreviewViewportMode, string>> = {
  desktop: "w-full max-w-full",
  tablet: "mx-auto w-full max-w-[40rem]",
  mobile: "mx-auto w-full max-w-[23rem]",
};

const VIEWPORT_ICON: Readonly<Record<PreviewViewportMode, React.ReactElement>> = {
  desktop: <MonitorIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />,
  tablet: <TabletIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />,
  mobile: <SmartphoneIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />,
};

export type ViewportPreviewStageProps = {
  readonly revisionId?: string;
  readonly localeLabel?: string;
  readonly label?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
};

/**
 * Shadcn Studio-inspired responsive viewport stage for inert Page Builder previews.
 * Lets workers visually check how a composed draft flows at Desktop, Tablet, or Mobile width without altering the rendered revision.
 */
export function ViewportPreviewStage({ revisionId, localeLabel, label = "Preview viewport width", children, className }: ViewportPreviewStageProps) {
  const [viewport, setViewport] = React.useState<PreviewViewportMode>("desktop");

  return (
    <div data-slot="viewport-preview-stage" data-viewport-mode={viewport} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-subtle px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {VIEWPORT_ICON[viewport]}
          <span className="text-xs font-medium text-muted-foreground">Viewport frame</span>
          {localeLabel === undefined || localeLabel === "" ? null : (
            <span className="rounded-4xl border border-border/80 bg-card px-2 py-0.5 text-xs text-foreground">
              <bdi>{localeLabel}</bdi>
            </span>
          )}
          {revisionId === undefined || revisionId === "" ? null : (
            <CopyButton value={revisionId} label="Copy preview revision ID" className="h-6 min-h-6 px-2 text-xs" />
          )}
        </div>
        <SegmentedTabs label={label} value={viewport} onValueChange={setViewport} options={VIEWPORT_OPTIONS} />
      </div>
      <div
        className={cn(
          "min-w-0",
          VIEWPORT_FRAME_CLASS[viewport],
          viewport !== "desktop" && "rounded-2xl border border-border/90 bg-card p-3.5 shadow-sm sm:p-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export default ViewportPreviewStage;

"use client";
import Link from "next/link";
import { useState, type ReactElement } from "react";
import { AlertTriangleIcon, ArrowUpRightIcon, Clock3Icon, InfoIcon } from "lucide-react";
import StateNotice from "@/components/state-notice";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/ui/count-up";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { type IconTileProps } from "@/components/ui/icon-tile";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { SegmentedMeter, type MeterSegmentTone } from "@/components/ui/segmented-meter";
import { SegmentedTabs, type SegmentedOption } from "@/components/ui/segmented-tabs";
import { assertNever } from "@/lib/result";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import { NOTICE_COPY, SECTION_COPY } from "../copy";
import type { HomeSectionKey } from "../home-schema";
import { homeSectionGroupsOf, type HomeData, type HomeSectionGroupView } from "../home-view";
import { useHome } from "../use-home";
import HomeItemRow from "./home-item-row";
import SectionHeading from "./section-heading";

export type HomeSectionsProps = { readonly initial: ReadResult<ReadEnvelope<HomeData>>; readonly scope: Scope };
type SectionFilter = "all" | HomeSectionKey;

const KPI_STYLE: Readonly<Record<HomeSectionKey, { readonly iconVariant: IconTileProps["variant"]; readonly icon: ReactElement; readonly badgeVariant: "warning-light" | "info-light" | "secondary"; readonly meterTone: MeterSegmentTone }>> = {
  attention: { iconVariant: "warning", icon: <AlertTriangleIcon />, badgeVariant: "warning-light", meterTone: "warning" },
  information: { iconVariant: "info", icon: <InfoIcon />, badgeVariant: "info-light", meterTone: "info" },
  "unfinished-work": { iconVariant: "soft", icon: <Clock3Icon />, badgeVariant: "secondary", meterTone: "muted" },
};

const QUICK_DESTINATIONS = [
  { href: "/partners", label: "Partners" },
  { href: "/work", label: "Tasks" },
  { href: "/communication", label: "Updates" },
  { href: "/support", label: "Support" },
  { href: "/pages", label: "Ministry pages" },
] as const;

function HomeSection({ group }: { readonly group: HomeSectionGroupView }): ReactElement {
  const headingId = `home-${group.sectionKey}`;
  const copy = SECTION_COPY[group.sectionKey];
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Frame spacing="sm">
        <FrameHeader>
          <SectionHeading id={headingId} sectionKey={group.sectionKey} count={group.items.length} />
        </FrameHeader>
        <FramePanel className="bg-surface-subtle p-3 sm:p-4">
          {group.items.length === 0 ? (
            <StateNotice kind="empty" headingLevel={3} title={copy.emptyTitle} description={copy.emptyBody} action={{ label: copy.firstAction.label, href: copy.firstAction.href }} />
          ) : (
            <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
              {group.items.map((item, index) => (
                <HomeItemRow key={item.id} item={item} variant={group.sectionKey} index={index} />
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>
    </section>
  );
}

function HomeOverview({ data }: { readonly data: HomeData }): ReactElement {
  const [filter, setFilter] = useState<SectionFilter>("all");
  const groups = homeSectionGroupsOf(data);
  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const filterOptions: readonly SegmentedOption<SectionFilter>[] = [{ value: "all", label: "Everything", count: totalCount }, ...groups.map((group) => ({ value: group.sectionKey as SectionFilter, label: SECTION_COPY[group.sectionKey].heading, count: group.items.length }))];
  const visibleGroups = filter === "all" ? groups : groups.filter((group) => group.sectionKey === filter);
  const pulseSegments = groups.map((group) => ({
    key: group.sectionKey,
    label: SECTION_COPY[group.sectionKey].heading,
    count: group.items.length,
    tone: KPI_STYLE[group.sectionKey].meterTone,
  }));
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <section aria-label="Today at a glance" data-slot="home-pulse-banner" className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs sm:p-5">
        <div aria-hidden="true" className="bg-dot-grid bg-dot-grid-fade pointer-events-none absolute inset-0 opacity-75" />
        <div className="relative flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today at a glance</p>
              <p className="text-sm text-foreground">
                <span className="font-semibold tabular-figures">
                  <CountUp value={totalCount} />
                </span>
                {totalCount === 1 ? " item on your dashboard." : " items on your dashboard."}
              </p>
            </div>
            <nav aria-label="Quick links" className="flex flex-wrap items-center gap-1.5">
              {QUICK_DESTINATIONS.map((dest) => (
                <Link
                  key={dest.href}
                  href={dest.href}
                  aria-label={`Open ${dest.label}`}
                  className="inline-flex min-h-7 items-center gap-1 rounded-4xl border border-border/80 bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs transition-colors hover:border-foreground/30 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
                >
                  <span>{dest.label}</span>
                  <ArrowUpRightIcon aria-hidden="true" className="size-3 text-muted-foreground rtl:-scale-x-100" />
                </Link>
              ))}
            </nav>
          </div>
          {totalCount > 0 ? <SegmentedMeter segments={pulseSegments} label="Home items breakdown" /> : null}
        </div>
      </section>
      <KpiGrid columns={3}>
        {groups.map((group, index) => {
          const copy = SECTION_COPY[group.sectionKey];
          const style = KPI_STYLE[group.sectionKey];
          return (
            <AnimatedListItem key={group.sectionKey} index={index} className="h-full">
              <KpiCard
                label={copy.heading}
                value={<CountUp value={group.items.length} />}
                detail={copy.description}
                icon={style.icon}
                iconVariant={style.iconVariant}
                badge={<Badge variant={style.badgeVariant}>{group.items.length === 1 ? "1 item" : `${String(group.items.length)} items`}</Badge>}
                href={`#home-${group.sectionKey}`}
                actionLabel={`Jump to ${copy.heading}`}
              />
            </AnimatedListItem>
          );
        })}
      </KpiGrid>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label="Filter home queues" value={filter} onValueChange={setFilter} options={filterOptions} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {visibleGroups.map((group) => (
          <HomeSection key={group.sectionKey} group={group} />
        ))}
      </div>
    </div>
  );
}

export default function HomeSections(props: HomeSectionsProps): ReactElement {
  const { result } = useHome({ initial: props.initial, scope: props.scope });
  // Every arm heads at level two, because the page's `h1` stands above this surface and no other heading sits between them.
  switch (result.kind) {
    case "envelope":
      return <HomeOverview data={result.envelope.data} />;
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={NOTICE_COPY.denied.title} description={NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />; // A denial states no item, count or existence hint, so it reads the same whether or not work exists in the context this session may not read.
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={NOTICE_COPY.unavailable.title} description={NOTICE_COPY.unavailable.body} source={result.unavailable.source} />; // The source that did not answer is named, so an outage is never drawn as an empty Home and never as a zero.
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={NOTICE_COPY.refused.title} description={NOTICE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled Home read result");
  }
}

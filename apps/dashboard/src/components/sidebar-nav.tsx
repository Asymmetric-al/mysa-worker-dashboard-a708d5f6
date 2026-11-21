"use client";

/**
 * The one primary navigation: the route model, the current-location rule and the fixed position
 * of Help, in a single component that the shell renders on the desktop rail and — through this
 * same model — inside the phone sheet.
 *
 * The entries answer the questions the workspace exists to answer (who needs my attention, what
 * do I know about this relationship, how is support going, what should I share, what do people
 * see, what help do I want) rather than mirroring the data model. Each entry is a real route in
 * `src/app`, and there is deliberately no entry for anything the release defers: a disabled,
 * "coming soon" or speculative destination is scaffolding for a capability that does not exist,
 * and it would present a promise the application cannot keep.
 *
 * Reachability this model has to satisfy (`e2e/reachability`, success criterion 21). Starting at
 * `/`, every retained route is reached by operating these entries and the pages they lead to —
 * the rail names the seven everyday destinations and the two quiet ones, and each list page
 * carries the in-page entries to its own sub-surfaces and details:
 *
 * - `/` Home.
 * - `/partners` Partners — this entry's sub-list names `/partners/import`,
 *   `/partners/initiatives` and `/partners/referrals`; the roster leads to
 *   `/partners/[partnerId]`, and the record body to `/partners/[partnerId]/edit` and
 *   `/partners/[partnerId]/interactions/new`; each list leads to its own `[id]` route.
 * - `/work` Work — sub-list `/work/agenda`; a series task leads to `/work/series/[seriesId]`.
 * - `/support` Support — sub-list `/support/gifts` and `/support/commitments`; the lists lead
 *   to `/support/gifts/[giftId]` and `/support/commitments/[commitmentId]`, and the overview's
 *   four fixed reports to `/support/reports/[reportId]`.
 * - `/communication` Communication — sub-list `/communication/audience`,
 *   `/communication/delivery`, `/communication/inbox` and the receiving preview at `/preview`;
 *   the Updates list leads to `/communication/[updateId]`, its variant editor and preview, and
 *   `/communication/review/[candidateId]`; the receiving list leads to `/preview/[updateId]`,
 *   `/preview/pages`, `/preview/pages/[pageId]/[locale]` and `/preview/preferences`.
 * - `/pages` Pages — the list leads to `/pages/[pageId]`, its locale preview and
 *   `/pages/review/[candidateId]`.
 * - `/coaching` Coaching — sub-list `/coaching/targets`, `/coaching/check-ins`,
 *   `/coaching/sharing` and `/coaching/coach`; the portfolio leads to
 *   `/coaching/coach/[subjectId]`.
 * - `/settings` Settings and `/help` Help, in this order, on every page.
 *
 * `/feed` is the single route with no entry here: it is the declared legacy alias, a request to
 * it resolves to `/communication`, and the reachability sweep carries it as its only exception.
 * There is no other unreferenced route, and this comment is the traversal the sweep is checked
 * against.
 *
 * What this component is responsible for, and what it is not: it owns the model, the active-state
 * rule and the Help position, and it composes the installed `Sidebar` parts rather than restyling
 * them. The collapsible rail, its collapse control, the provider that holds the collapsed state,
 * the active organization and ministry indicator, and the persistent Development data label all
 * belong to the shell (`app-shell`, `context-indicator`, `dev-banner`); none of them grows a
 * second implementation here, and there is no context switcher, no persona control and no
 * development control in this file.
 *
 * Accessibility and direction are structural, not decorative. The rail is a labelled `nav`
 * landmark; every entry is a real link with a text label, so no destination is icon-only and the
 * icons are hidden from assistive technology; the section holding the current page is marked as
 * the current branch while exactly one destination is ever the current page; every control is
 * reachable by Tab and Enter and by a single pointer, with no drag, long press or hover needed;
 * focus is drawn from `--ring` by the design system's own `focus-visible` classes. Direction is a
 * property of the content: this file sets no CSS base direction and adds only logical spacing
 * utilities, so the rail follows the `dir` the shell's direction provider puts on the document,
 * and the disclosure chevron points to the inline end rather than being blindly mirrored.
 */

import Link from "next/link";
import { useId, useState, type MouseEvent } from "react";
import {
  ChevronDownIcon,
  CircleHelpIcon,
  CompassIcon,
  HandCoinsIcon,
  HomeIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  MegaphoneIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/cn";

/**
 * A sub-surface of a section: a page that belongs to a destination rather than being one.
 *
 * Sub-surfaces are reached from their section's list page as well as from the expanded section,
 * which is why the rail does not enumerate every route while every route stays reachable.
 */
export interface NavSubItem {
  /** The route this sub-surface serves, exactly as its folder in `src/app` spells it. */
  readonly href: string;
  /** The link's text and accessible name; no sub-surface is icon-only. */
  readonly label: string;
}

/** The band of the rail an entry belongs to. An omitted `section` means `"primary"`. */
export type NavSection = "primary" | "secondary";

/** One destination of the rail. */
export interface NavItem {
  /** The destination's route, exactly as its folder in `src/app` spells it. */
  readonly href: string;
  /** The link's text and accessible name. Required, so no entry can compile as icon-only. */
  readonly label: string;
  /**
   * A decorative `lucide-react` glyph. It repeats what the label already says, so it is hidden
   * from assistive technology and never carries meaning on its own.
   */
  readonly icon?: LucideIcon;
  /** The band this entry renders in. Omitted means the everyday band. */
  readonly section?: NavSection;
  /** The sub-surfaces listed beneath this entry, one level deep by design. */
  readonly children?: readonly NavSubItem[];
}

/**
 * The navigation model: the seven everyday destinations in the order the questions are asked,
 * then Settings and Help.
 *
 * Order is meaning here. The everyday band follows a working day — attention first, then the
 * relationships behind it, the work that follows, the support they give, what is shared, what
 * the public sees, and the help the worker may want — and the quiet band holds the two surfaces a
 * worker visits to configure the workspace or look something up. Help is the last entry, in the
 * same place on every page, because a help destination that moves costs a reader more than it
 * saves (WCAG 3.2.6 Consistent Help).
 *
 * Every `href` here is a route the release builds. Nothing deferred appears, and the one legacy
 * alias the release keeps deliberately has no entry: an alias redirects, so it is not a place to
 * send a reader.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  {
    href: "/partners",
    label: "Partners",
    icon: UsersIcon,
    children: [
      { href: "/partners/import", label: "Import contacts" },
      { href: "/partners/initiatives", label: "Initiatives" },
      { href: "/partners/referrals", label: "Referrals" },
    ],
  },
  {
    href: "/work",
    label: "Work",
    icon: ListChecksIcon,
    children: [{ href: "/work/agenda", label: "Agenda" }],
  },
  {
    href: "/support",
    label: "Support",
    icon: HandCoinsIcon,
    children: [
      { href: "/support/gifts", label: "Gifts" },
      { href: "/support/commitments", label: "Commitments" },
    ],
  },
  {
    href: "/communication",
    label: "Communication",
    icon: MegaphoneIcon,
    children: [
      { href: "/communication/audience", label: "Audience" },
      { href: "/communication/delivery", label: "Delivery" },
      { href: "/communication/inbox", label: "Inbox" },
      { href: "/preview", label: "Receiving preview" },
    ],
  },
  { href: "/pages", label: "Pages", icon: LayoutTemplateIcon },
  {
    href: "/coaching",
    label: "Coaching",
    icon: CompassIcon,
    children: [
      { href: "/coaching/targets", label: "Targets" },
      { href: "/coaching/check-ins", label: "Check-ins" },
      { href: "/coaching/sharing", label: "Sharing" },
      { href: "/coaching/coach", label: "Coach view" },
    ],
  },
  { href: "/settings", label: "Settings", icon: SettingsIcon, section: "secondary" },
  { href: "/help", label: "Help", icon: CircleHelpIcon, section: "secondary" },
];

/**
 * Whether `currentPath` is the destination `href`: an exact match for the root, and otherwise the
 * destination itself or anything beneath it.
 *
 * The comparison is path-segment aware, so `/partners/ada` and `/partners/ada/edit` stay on
 * Partners while `/partners-archive` does not, and a trailing slash or a query string on either
 * side changes nothing. One rule decides every "where am I" question in the rail: the visible
 * active state and `aria-current` are two renderings of this single comparison, never two
 * calculations that can disagree.
 */
export function isCurrent(currentPath: string, href: string): boolean {
  const path = normalisePath(currentPath);
  const destination = normalisePath(href);
  if (destination === "/") {
    return path === "/";
  }
  return path === destination || path.startsWith(`${destination}/`);
}

/** The destination the current path resolves to, with the section that contains it. */
interface CurrentDestination {
  /** The route of the deepest entry the path belongs to. */
  readonly href: string;
  /** The section whose sub-surface is that route, when it is a sub-surface at all. */
  readonly sectionHref?: string;
}

/**
 * The navigation surface itself.
 *
 * `currentPath` is supplied by the router, so the rail never guesses where the reader is, and the
 * only state this component holds is which sections the worker opened or closed by hand. Nothing
 * is fetched, nothing is cached and no permission is inferred: an entry's presence says the
 * destination exists for this application, never that the current context may read it — the
 * destination itself decides that and answers with a notice when it cannot.
 */
export interface SidebarNavProps {
  /** The model to render. Defaults to {@link PRIMARY_NAV}. */
  readonly items?: readonly NavItem[];
  /** The route currently open, as the router reports it. */
  readonly currentPath: string;
  /**
   * Called when the reader navigates by plain left click, so the shell can close the phone sheet
   * it rendered this rail inside. A modified click that opens another tab or window is not a
   * navigation of the page in front of the reader and is deliberately not reported.
   */
  readonly onNavigate?: (href: string) => void;
  /** Merged onto the landmark's own classes, for placement inside the shell's chrome. */
  readonly className?: string;
}

/**
 * The primary navigation: a labelled `nav` landmark holding the everyday destinations and, below
 * a separator, the quiet ones — Settings and, always last, Help.
 *
 * Render it inside the shell's `SidebarProvider`: the design system's `Sidebar` re-renders the
 * same children inside its phone `Sheet` at the compact breakpoint, so this one model serves the
 * desktop rail and the phone without a second copy, and no destination is lost on a small screen.
 */
export function SidebarNav({
  items = PRIMARY_NAV,
  currentPath,
  onNavigate,
  className,
}: SidebarNavProps) {
  // Only the worker's own open and close decisions are held here; everything else about the
  // active destination is derived from `currentPath` on every render, so a navigation cannot
  // leave the rail describing the page it used to be on.
  const [sectionOverrides, setSectionOverrides] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
  const current = resolveCurrent(items, currentPath);

  const primaryItems = items.filter((item) => (item.section ?? "primary") === "primary");
  const secondaryItems = items.filter((item) => item.section === "secondary");

  function toggleSection(href: string): void {
    setSectionOverrides((previous) => ({
      ...previous,
      // Recorded as the inverse of what is on screen, so the decision survives navigation: a
      // section the worker closed stays closed on the next page they open.
      [href]: !(previous[href] ?? href === current?.sectionHref),
    }));
  }

  return (
    <nav aria-label="Primary" className={cn("flex min-w-0 flex-col", className)}>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {primaryItems.map((item) => (
              <NavEntry
                key={item.href}
                item={item}
                current={current}
                sectionOverrides={sectionOverrides}
                onToggleSection={toggleSection}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {secondaryItems.length === 0 ? null : (
        <>
          {/* A rule, not a heading: the two quiet destinations are the same kind of thing as the
              rest of the rail, and adding a group label would name a category the product does
              not have. The Help entry keeps its fixed position below this rule on every page. */}
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {secondaryItems.map((item) => (
                  <NavEntry
                    key={item.href}
                    item={item}
                    current={current}
                    sectionOverrides={sectionOverrides}
                    onToggleSection={toggleSection}
                    onNavigate={onNavigate}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </>
      )}
    </nav>
  );
}

/** Props of the internal {@link NavEntry}: one destination and the state the rail holds for it. */
interface NavEntryProps {
  readonly item: NavItem;
  readonly current: CurrentDestination | undefined;
  readonly sectionOverrides: Readonly<Record<string, boolean>>;
  readonly onToggleSection: (href: string) => void;
  readonly onNavigate: ((href: string) => void) | undefined;
}

/**
 * One destination: its link, the disclosure that opens its sub-surfaces, and the sub-links.
 *
 * The link is always present and always the destination itself, so a section is reachable even
 * while its sub-list is closed, on a phone, or with the rail collapsed to icons. `aria-current`
 * is set on exactly one element — `"page"` for the destination the reader is on, `"true"` for the
 * section that contains it — so a screen-reader user hears which section they are in and which
 * page they are on without hearing two pages at once.
 */
function NavEntry({
  item,
  current,
  sectionOverrides,
  onToggleSection,
  onNavigate,
}: NavEntryProps) {
  const subListId = useId();
  const Icon = item.icon;
  const subItems = item.children ?? [];
  const hasSubItems = subItems.length > 0;
  const isPage = current?.href === item.href;
  const isSection = isPage || current?.sectionHref === item.href;
  // A section opens itself when the reader is on one of its sub-surfaces, so the current page is
  // never hidden behind a collapsed section. An explicit open or close overrides that default and
  // keeps overriding it as the reader moves, which is what makes the decision the worker's.
  const isExpanded = sectionOverrides[item.href] ?? current?.sectionHref === item.href;
  const ariaCurrent: "page" | "true" | undefined = isPage
    ? "page"
    : isSection
      ? "true"
      : undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            href={item.href}
            onClick={(event) => {
              notifyNavigation(event, item.href, onNavigate);
            }}
          />
        }
        isActive={isSection}
        aria-current={ariaCurrent}
        // The text label is the accessible name in every state; the tooltip only restores the
        // words when the rail is collapsed to icons and the label is clipped visually.
        tooltip={item.label}
      >
        {Icon === undefined ? null : <Icon aria-hidden="true" data-icon="inline-start" />}
        <span>{item.label}</span>
      </SidebarMenuButton>

      {hasSubItems ? (
        <SidebarMenuAction
          // A 24x24 CSS px target (WCAG 2.5.8 Target Size Minimum), enlarged from the design
          // system's default row action so it is comfortable for a thumb and for a switch device.
          className="size-6"
          aria-expanded={isExpanded}
          // The sub-list is not rendered while closed, so the relationship is stated only when
          // there is an element for it to point at.
          aria-controls={isExpanded ? subListId : undefined}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label}`}
          onClick={() => {
            onToggleSection(item.href);
          }}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              // Restrained motion, and none at all when the reader has asked for less.
              "motion-safe:transition-transform",
              // Closed points to the inline end of the current direction, so the glyph reflects
              // meaning in right-to-left authoring instead of being blindly mirrored.
              isExpanded ? undefined : "-rotate-90 rtl:rotate-90",
            )}
          />
        </SidebarMenuAction>
      ) : null}

      {hasSubItems && isExpanded ? (
        <SidebarMenuSub id={subListId}>
          {subItems.map((subItem) => {
            const subItemIsPage = current?.href === subItem.href;
            return (
              <SidebarMenuSubItem key={subItem.href}>
                <SidebarMenuSubButton
                  render={
                    <Link
                      href={subItem.href}
                      onClick={(event) => {
                        notifyNavigation(event, subItem.href, onNavigate);
                      }}
                    />
                  }
                  isActive={subItemIsPage}
                  aria-current={subItemIsPage ? "page" : undefined}
                >
                  <span>{subItem.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * Reports a navigation to the shell, and only a real one.
 *
 * The shell uses this to dismiss the phone sheet it rendered the rail inside. A modified or
 * non-primary click opens the destination somewhere else and leaves the page in front of the
 * reader untouched, so it is not a navigation and closing the sheet for it would hide the page
 * the reader is still on. A link a caller has already intercepted is likewise not reported.
 */
function notifyNavigation(
  event: MouseEvent<HTMLElement>,
  href: string,
  onNavigate: ((href: string) => void) | undefined,
): void {
  if (onNavigate === undefined || event.defaultPrevented) {
    return;
  }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  onNavigate(href);
}

/**
 * The deepest destination the current path belongs to.
 *
 * The longest matching entry wins, so `/support/gifts` is Gifts inside Support rather than a
 * second reading of Support, while `/support` stays Support itself. Scanning sub-surfaces before
 * their section is what keeps a section from claiming the page its sub-surface owns.
 */
function resolveCurrent(
  items: readonly NavItem[],
  currentPath: string,
): CurrentDestination | undefined {
  let found: CurrentDestination | undefined;
  for (const item of items) {
    for (const subItem of item.children ?? []) {
      if (isCurrent(currentPath, subItem.href) && isMoreSpecific(subItem.href, found?.href)) {
        found = { href: subItem.href, sectionHref: item.href };
      }
    }
    if (isCurrent(currentPath, item.href) && isMoreSpecific(item.href, found?.href)) {
      found = { href: item.href };
    }
  }
  return found;
}

/**
 * Whether `href` is deeper than the destination already matched.
 *
 * Both candidates have matched the same path by segment prefix, so the longer route is the more
 * specific one and the only one that may be called the current page.
 */
function isMoreSpecific(href: string, matched: string | undefined): boolean {
  return matched === undefined || normalisePath(href).length > normalisePath(matched).length;
}

/** The comparable form of a route: no query, no fragment, no trailing slash, one leading slash. */
function normalisePath(value: string): string {
  const path = value.split(/[?#]/)[0]?.trim() ?? "";
  if (path === "") {
    return "/";
  }
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const trimmed = absolute.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export default SidebarNav;

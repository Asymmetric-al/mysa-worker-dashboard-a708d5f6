"use client";
import Link from "next/link";
import { useId, useState, type MouseEvent } from "react";
import { ChevronDownIcon, CircleHelpIcon, CompassIcon, HandCoinsIcon, HomeIcon, LayoutTemplateIcon, ListChecksIcon, MegaphoneIcon, SettingsIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarSeparator } from "@/components/ui/sidebar";
import { cn } from "@/lib/cn";
/** A sub-surface of a section: a page that belongs to a destination rather than being one. */ export type NavSubItem = { readonly href: string; readonly label: string };
export type NavSection = "primary" | "secondary";
export type NavItem = { readonly href: string; readonly label: string; readonly icon?: LucideIcon; readonly section?: NavSection; readonly children?: readonly NavSubItem[] };
/** The navigation model: the seven everyday destinations in the order the questions are asked, then Settings and Help. */ export const PRIMARY_NAV: readonly NavItem[] = [
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
  { href: "/work", label: "Work", icon: ListChecksIcon, children: [{ href: "/work/agenda", label: "Agenda" }] },
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
      { href: "/preview/pages", label: "Published pages" },
      { href: "/preview/preferences", label: "Your preferences" },
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
/** Whether `currentPath` is the destination `href`: an exact match for the root, and otherwise the destination itself or anything beneath it. */ export function isCurrent(currentPath: string, href: string): boolean {
  const path = normalisePath(currentPath);
  const destination = normalisePath(href);
  return destination === "/" ? path === "/" : path === destination || path.startsWith(`${destination}/`);
}
type CurrentDestination = { readonly href: string; readonly sectionHref?: string };
export type SidebarNavProps = { readonly items?: readonly NavItem[]; readonly currentPath: string; readonly onNavigate?: (href: string) => void; readonly className?: string };
/** The primary navigation: a labelled `nav` landmark holding the everyday destinations and, below a separator, the quiet ones — Settings and, always last, Help. */ export function SidebarNav({ items = PRIMARY_NAV, currentPath, onNavigate, className }: SidebarNavProps) {
  const [sectionOverrides, setSectionOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const current = resolveCurrent(items, currentPath);
  const primaryItems = items.filter((item) => (item.section ?? "primary") === "primary");
  const secondaryItems = items.filter((item) => item.section === "secondary");
  const toggleSection = (href: string): void => setSectionOverrides((previous) => ({ ...previous, [href]: !(previous[href] ?? href === current?.sectionHref) }));
  return (
    <nav aria-label="Primary" className={cn("flex min-w-0 flex-col", className)}>
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {primaryItems.map((item) => (
              <NavEntry key={item.href} item={item} current={current} sectionOverrides={sectionOverrides} onToggleSection={toggleSection} onNavigate={onNavigate} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {secondaryItems.length === 0 ? null : (
        <>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {secondaryItems.map((item) => (
                  <NavEntry key={item.href} item={item} current={current} sectionOverrides={sectionOverrides} onToggleSection={toggleSection} onNavigate={onNavigate} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </>
      )}
    </nav>
  );
}
type NavEntryProps = { readonly item: NavItem; readonly current: CurrentDestination | undefined; readonly sectionOverrides: Readonly<Record<string, boolean>>; readonly onToggleSection: (href: string) => void; readonly onNavigate: ((href: string) => void) | undefined };
function NavEntry({ item, current, sectionOverrides, onToggleSection, onNavigate }: NavEntryProps) {
  const subListId = useId();
  const Icon = item.icon;
  const subItems = item.children ?? [];
  const hasSubItems = subItems.length > 0;
  const isPage = current?.href === item.href;
  const isSection = isPage || current?.sectionHref === item.href;
  const isExpanded = sectionOverrides[item.href] ?? current?.sectionHref === item.href;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link href={item.href} onClick={(event) => notifyNavigation(event, item.href, onNavigate)} />} isActive={isSection} aria-current={isPage ? "page" : isSection ? "true" : undefined} tooltip={item.label}>
        {Icon === undefined ? null : <Icon aria-hidden="true" data-icon="inline-start" />}
        <span>{item.label}</span>
      </SidebarMenuButton>
      {hasSubItems ? (
        <SidebarMenuAction className="size-6" aria-expanded={isExpanded} aria-controls={isExpanded ? subListId : undefined} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label}`} onClick={() => onToggleSection(item.href)}>
          <ChevronDownIcon aria-hidden="true" className={cn("motion-safe:transition-transform", isExpanded ? undefined : "-rotate-90 rtl:rotate-90")} />
        </SidebarMenuAction>
      ) : null}
      {hasSubItems && isExpanded ? (
        <SidebarMenuSub id={subListId}>
          {subItems.map((subItem) => {
            const subItemIsPage = current?.href === subItem.href;
            return (
              <SidebarMenuSubItem key={subItem.href}>
                <SidebarMenuSubButton render={<Link href={subItem.href} onClick={(event) => notifyNavigation(event, subItem.href, onNavigate)} />} isActive={subItemIsPage} aria-current={subItemIsPage ? "page" : undefined}>
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
function notifyNavigation(event: MouseEvent<HTMLElement>, href: string, onNavigate: ((href: string) => void) | undefined): void {
  if (onNavigate === undefined || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  onNavigate(href);
}
function resolveCurrent(items: readonly NavItem[], currentPath: string): CurrentDestination | undefined {
  let found: CurrentDestination | undefined;
  for (const item of items) {
    for (const subItem of item.children ?? []) if (isCurrent(currentPath, subItem.href) && isMoreSpecific(subItem.href, found?.href)) found = { href: subItem.href, sectionHref: item.href };
    if (isCurrent(currentPath, item.href) && isMoreSpecific(item.href, found?.href)) found = { href: item.href };
  }
  return found;
}
const isMoreSpecific = (href: string, matched: string | undefined): boolean => matched === undefined || normalisePath(href).length > normalisePath(matched).length;
function normalisePath(value: string): string {
  const path = value.split(/[?#]/)[0]?.trim() ?? "";
  if (path === "") return "/";
  const trimmed = (path.startsWith("/") ? path : `/${path}`).replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

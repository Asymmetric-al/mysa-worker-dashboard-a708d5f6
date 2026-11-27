"use client";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, KeyboardIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { PRIMARY_NAV } from "@/components/sidebar-nav";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { filterAndRankItems, type SearchableCommandItem } from "@/lib/command-search";
import { cn } from "@/lib/cn";
import { useShortcut, useShortcutHint } from "@/lib/ui-sdk";

type CommandActionItem = SearchableCommandItem & {
  readonly kind: "route" | "action";
  readonly actionId?: "open-shortcuts" | "toggle-theme";
};

function buildCommandCatalog(): readonly CommandActionItem[] {
  const items: CommandActionItem[] = [];
  for (const nav of PRIMARY_NAV) {
    const group = nav.section === "secondary" ? "Account" : nav.group === "growth" ? "Support & growth" : "Ministry";
    items.push({
      id: `route:${nav.href}`,
      kind: "route",
      label: nav.label,
      group,
      href: nav.href,
      keywords: [nav.href.replace(/\//gu, " "), group],
    });
    for (const child of nav.children ?? []) {
      items.push({
        id: `route:${child.href}`,
        kind: "route",
        label: `${nav.label} — ${child.label}`,
        group: nav.label,
        href: child.href,
        keywords: [child.label, nav.label, child.href.replace(/\//gu, " ")],
      });
    }
  }
  items.push(
    {
      id: "action:open-shortcuts",
      kind: "action",
      actionId: "open-shortcuts",
      label: "View keyboard shortcuts",
      group: "Quick actions",
      description: "See navigation, table, and writing editor shortcuts.",
      keywords: ["shortcuts", "keys", "help", "keyboard", "?"],
    },
    {
      id: "action:toggle-theme",
      kind: "action",
      actionId: "toggle-theme",
      label: "Switch light / dark theme",
      group: "Quick actions",
      description: "Change this browser’s appearance right away.",
      keywords: ["theme", "dark", "light", "appearance", "mode"],
    },
  );
  return items;
}

const COMMAND_CATALOG: readonly CommandActionItem[] = buildCommandCatalog();

export type CommandPaletteProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenShortcuts: () => void;
  readonly onToggleTheme?: () => void;
  readonly currentPath: string;
};

/**
 * Global Command Palette (`⌘K` / `Ctrl+K`) built strictly on MYSA's Base UI `Dialog`
 * and UI SDK `useShortcut`, styled with Maia Zinc tokens.
 */
export function CommandPalette({ open, onOpenChange, onOpenShortcuts, onToggleTheme, currentPath }: CommandPaletteProps): ReactElement {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDark, setIsDark] = useState(false);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setQuery("");
        setActiveIndex(0);
        setIsDark(typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const toggleShortcut = useCallback(() => {
    handleOpenChange(!open);
  }, [handleOpenChange, open]);

  useShortcut("mod+k", toggleShortcut);

  const results = useMemo(() => filterAndRankItems(COMMAND_CATALOG, query), [query]);
  const safeIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  // Keep the keyboard-highlighted command row scrolled cleanly inside the results viewport.
  useEffect(() => {
    if (!open || safeIndex < 0) return;
    const activeButton = listRef.current?.querySelector<HTMLButtonElement>('button[data-highlighted="true"]');
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [open, safeIndex]);

  const grouped = useMemo(() => {
    const map = new Map<string, { readonly item: CommandActionItem; readonly flatIndex: number }[]>();
    results.forEach((item, flatIndex) => {
      const bucket = map.get(item.group);
      if (bucket === undefined) map.set(item.group, [{ item, flatIndex }]);
      else bucket.push({ item, flatIndex });
    });
    return [...map.entries()];
  }, [results]);

  const executeItem = useCallback(
    (item: CommandActionItem): void => {
      handleOpenChange(false);
      if (item.kind === "route" && item.href !== undefined) {
        router.push(item.href);
        return;
      }
      if (item.actionId === "open-shortcuts") {
        onOpenShortcuts();
        return;
      }
      if (item.actionId === "toggle-theme") {
        const nextDark = !document.documentElement.classList.contains("dark");
        if (onToggleTheme !== undefined) {
          onToggleTheme();
        } else {
          document.documentElement.classList.toggle("dark", nextDark);
        }
        setIsDark(nextDark);
      }
    },
    [handleOpenChange, onOpenShortcuts, onToggleTheme, router],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && safeIndex >= 0) {
      event.preventDefault();
      const target = results[safeIndex];
      if (target !== undefined) executeItem(target);
    }
  };

  const hint = useShortcutHint("mod+k");
  const resolveInitialFocus = useCallback((): HTMLElement | null => {
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return null;
    return inputRef.current;
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent initialFocus={resolveInitialFocus} className="gap-0 overflow-hidden p-0 sm:max-w-lg" data-slot="command-palette">
        <DialogHeader className="sr-only">
          <DialogTitle>Go to a page or action</DialogTitle>
          <DialogDescription>Search pages, sub-pages, and quick actions across your missionary workspace.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2.5 border-b border-border/80 px-4 py-3 pe-12">
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <label htmlFor={inputId} className="sr-only">
            Search pages and actions
          </label>
          <Input
            ref={inputRef}
            id={inputId}
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-controls={listId}
            placeholder="Search pages, reports, or actions…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="h-8 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm"
          />
        </div>

        <nav ref={listRef} id={listId} aria-label="Matching pages and actions" className="flex max-h-80 flex-col gap-3 overflow-y-auto overscroll-contain p-2.5">
          {grouped.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching pages or actions found.</p>
          ) : (
            grouped.map(([groupName, entries]) => (
              <div key={groupName} className="flex flex-col gap-1">
                <p className="px-2.5 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{groupName}</p>
                <ul className="flex flex-col gap-0.5">
                  {entries.map(({ item, flatIndex }) => {
                    const selected = flatIndex === safeIndex;
                    const isCurrentRoute = item.href !== undefined && item.href === currentPath;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-highlighted={selected ? "true" : "false"}
                          aria-current={isCurrentRoute ? "page" : undefined}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => executeItem(item)}
                          className={cn(
                            "flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
                            selected ? "bg-secondary text-foreground" : "text-foreground/90 hover:bg-muted/70",
                          )}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2.5">
                            {item.actionId === "open-shortcuts" ? (
                              <KeyboardIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                            ) : item.actionId === "toggle-theme" ? (
                              isDark ? (
                                <SunIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <MoonIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                              )
                            ) : (
                              <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                            )}
                            <span className="truncate font-medium">{item.label}</span>
                          </span>
                          {isCurrentRoute ? (
                            <span className="shrink-0 rounded-4xl border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground">Current</span>
                          ) : item.href !== undefined ? (
                            <span className="mono-identifier hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.href}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-surface-subtle px-4 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>Navigate</span>
            <Kbd>Enter</Kbd>
            <span>Open</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span>Palette</span>
            <Kbd>{hint.text}</Kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;

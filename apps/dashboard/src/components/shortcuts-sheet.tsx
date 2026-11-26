"use client";
import { useCallback, type ReactElement } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useShortcut, useShortcutHint } from "@/lib/ui-sdk";

export type ShortcutsSheetProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

type ShortcutRow = {
  readonly action: string;
  readonly keys: readonly string[];
};

/**
 * ReUI `sheet-3`-inspired keyboard shortcuts reference sheet built on MYSA's Base UI `Sheet`.
 * Opens via `?` (outside text inputs) or from the sidebar footer / Command Palette.
 */
export function ShortcutsSheet({ open, onOpenChange }: ShortcutsSheetProps): ReactElement {
  const paletteHint = useShortcutHint("mod+k");
  const railHint = useShortcutHint("mod+b");
  const submitHint = useShortcutHint("mod+enter");
  const boldHint = useShortcutHint("mod+b");
  const italicHint = useShortcutHint("mod+i");
  const underlineHint = useShortcutHint("mod+u");
  const undoHint = useShortcutHint("mod+z");

  const toggle = useCallback(() => {
    onOpenChange(!open);
  }, [onOpenChange, open]);

  useShortcut("shift+/", toggle);

  const groups: readonly { readonly heading: string; readonly rows: readonly ShortcutRow[] }[] = [
    {
      heading: "Navigation",
      rows: [
        { action: "Open quick search", keys: [paletteHint.text] },
        { action: "Toggle sidebar", keys: [railHint.text] },
        { action: "Open keyboard shortcuts", keys: ["?"] },
        { action: "Close dialog or menu", keys: ["Esc"] },
      ],
    },
    {
      heading: "Tables, forms & panes",
      rows: [
        { action: "Submit form from a text area", keys: [submitHint.text] },
        { action: "Move across table controls", keys: ["Tab", "Shift+Tab"] },
        { action: "Expand or collapse row details", keys: ["Enter", "Space"] },
        { action: "Next / previous inbox message", keys: ["j", "k"] },
        { action: "Resize split pane", keys: ["←", "→"] },
        { action: "Jump split pane to start / end", keys: ["Home", "End"] },
      ],
    },
    {
      heading: "Writing editor",
      rows: [
        { action: "Bold", keys: [boldHint.text] },
        { action: "Italic", keys: [italicHint.text] },
        { action: "Underline", keys: [underlineHint.text] },
        { action: "Undo last edit", keys: [undoHint.text] },
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 sm:max-w-md" data-slot="shortcuts-sheet">
        <SheetHeader className="border-b border-border/80">
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>Every keyboard shortcut also has a visible button or control on screen.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-6">
          {groups.map((group, groupIndex) => (
            <section key={group.heading} className="flex flex-col gap-2.5">
              {groupIndex === 0 ? null : <Separator className="mb-2" />}
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.heading}</h3>
              <dl className="flex flex-col gap-2">
                {group.rows.map((row) => (
                  <div key={row.action} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface-subtle px-3 py-2 text-sm">
                    <dt className="min-w-0 text-foreground">{row.action}</dt>
                    <dd className="shrink-0">
                      <KbdGroup>
                        {row.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ShortcutsSheet;

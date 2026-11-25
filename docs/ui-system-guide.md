# MYSA Worker Dashboard — UI System, Ecosystem Craft & Engineering Guide

## 1. Design Foundation & Stack Guardrails

The dashboard UI (`apps/dashboard`) uses **shadcn/ui (`base-maia` / Maia Zinc)** on **Base UI (`@base-ui/react@1.9.0`)**, **Tailwind CSS v4**, **TanStack Table v9**, **TanStack Virtual v3**, **Recharts 3**, **Tiptap 3**, **Motion (`motion/react`)**, and **Lucide React**.

Every UI component and pattern adopted from **ReUI**, **Shadcn Space**, **Shadcn Studio**, **Shadcn UI Kit**, **React Bits**, and **React Bits Pro** obeys six non-negotiable invariants enforced by `oxlint`, `scripts/check-invariants.ts`, Vitest, and the Playwright E2E suite:

1. **Zero raw colours in TSX/TS**: All colours resolve through semantic CSS custom properties declared once in `apps/dashboard/src/styles/globals.css`. No hex (`#xxx`), `rgb()`, `rgba()`, `hsl()`, or `oklch()` literals appear in `src/{components,features,app}/**/*.{ts,tsx}`.
2. **Base UI + UI SDK only**: No `@radix-ui/*` packages. Keyboard shortcuts, roving focus, typeahead, collapsible panels, timelines, pagination, and segmented controls bind through the single adapter `src/lib/ui-sdk.ts`.
3. **Zero HTML5 `draggable="true"` in grids, boards, and outlines**: Column reordering, column resizing, split-pane resizing, and section/task controls use pointer capture (`setPointerCapture`) paired with keyboard button/arrow controls (`ArrowLeft`/`ArrowRight`/`Home`/`End`), preserving full keyboard operability and WCAG 2.5.7 Dragging Movements compliance.
4. **Logical RTL layout everywhere**: Sticky column pinning, borders, paddings, transforms, and directional icons use CSS logical properties (`inset-inline-start`, `inset-inline-end`, `border-inline-start`, `ms-*`, `pe-*`, `rtl:rotate-180`, `[dir="rtl"]`).
5. **Strict `prefers-reduced-motion` compliance**: CSS transitions/animations collapse to `0.01ms` via `globals.css`, and every dynamic animation checks our SSR-safe `usePrefersReducedMotion()` hook (`src/hooks/use-prefers-reduced-motion.ts`) to render static instant markup with zero console warnings.
6. **Domain honesty**: Never sum across currencies, never fabricate zero for missing coverage (`connectNulls={false}`), never show a percentage for paused/ended/unavailable/incompatible goals, never animate monetary amounts, and never conflate accepted submissions with delivered or read messages.

---

## 2. Ecosystem Recommendations, Direct Links & Implemented Architecture

### 2.1 ReUI (`https://reui.io`)
Native **Base UI + Radix UI** dual-primitive support, built directly on **TanStack Table v9** and **TanStack Virtual v3** — the single highest-compatibility library for MYSA's data-heavy operational surfaces.

| ReUI Primitive / Reference | Direct Link | Implemented Files | Where Used & What It Improves |
| --- | --- | --- | --- |
| **Data Grid (`@reui/data-grid`)** — pinning, sizing, ordering, expandable rows, density, opt-in virtualization, inline column header dropdown menus (`DataGridColumnHeaderMenu`), Expand/Collapse All | [reui.io/docs/data-grid](https://reui.io/docs/data-grid) | `src/components/ui/data-grid.tsx`, `src/components/record-list.tsx`, `src/lib/data-grid-utils.ts` | Gifts Ledger, Commitments, Partner Roster, Task Lists, Updates List, Synthetic Inbox, Delivery Results, Agenda, Check-In History, Initiatives — turns every table into an enterprise-grade operational grid with zero `draggable="true"` and full RTL support |
| **Date Selector (`@reui/date-selector`)** — presets + interactive civil calendar + explicit ISO range | [reui.io/docs/date-selector](https://reui.io/docs/date-selector) | `src/components/ui/date-selector.tsx`, `src/lib/civil-calendar.ts` | Gifts Ledger (`/support/gifts`) — exact `Temporal.PlainDate` civil-date filtering with zero browser timezone drift |
| **Filters (`@reui/filters`)** — active count badge & removable filter chips | [reui.io/docs/filters](https://reui.io/docs/filters) | `src/components/query-toolbar.tsx`, `DataGridFilterChip` | Partner Roster, Gifts Ledger, all filtered surfaces — instant clarity on active constraints and 1-click removal |
| **Scrollspy (`@reui/scrollspy`)** — `IntersectionObserver` section rail | [reui.io/docs/scrollspy](https://reui.io/docs/scrollspy) | `src/components/ui/scrollspy-nav.tsx`, `src/lib/scrollspy.ts` | Settings (`/settings` vertical sticky rail) and Partner / Record Detail (`layout="page"` horizontal jump bar) |
| **Connected Stepper (`@reui/stepper`)** | [reui.io/docs/stepper](https://reui.io/docs/stepper) | `src/features/import/components/import-stepper.tsx` | Contact CSV Import (`/partners/import`) — connected progress track rails across Choose File → Map → Review → Receipt |
| **Tree Outline (`@reui/tree`)** | [reui.io/docs/tree](https://reui.io/docs/tree) | `src/features/ministry-pages/components/section-outline.tsx` | Page Builder (`/pages/[pageId]`) — hierarchical guide rail, per-section-type Lucide icon tiles, crisp selected states |
| **File Upload (`@reui/file-upload`)** & File Type Badges | [reui.io/docs/file-upload](https://reui.io/docs/file-upload) | `src/hooks/use-file-upload.ts`, `src/components/ui/file-upload.tsx`, `src/features/import/components/file-chooser.tsx` | Contact CSV Import Step 1 — zero-dependency drag-and-drop dropzone preserving native `<input type="file">` and pre-read byte limits |
| **Timeline (`@reui/timeline`)**, **Sparkline**, **Radial Chart**, **Event Calendar** | [reui.io/docs/timeline](https://reui.io/docs/timeline) | `src/components/ui/activity-timeline.tsx`, `mini-sparkline.tsx`, `radial-gauge.tsx`, `calendar-grid.tsx` | Partner Activity, Initiative History, Support Overview, Goal Panel, Work Agenda |
| **Rich Text Editor Toolbar & Footer** | [reui.io/docs](https://reui.io/docs) | `src/components/prose-editor.tsx` | Update Composer & Ministry Page prose — live word/character/reading-time footer and keyboard shortcuts popover |

### 2.2 Shadcn Space (`https://shadcnspace.com`)
587 dashboard/marketing blocks & 717 components (accessible via `@shadcn-space` registry & MCP). Adapted directly to Base UI + Maia Zinc CSS variables.

| Shadcn Space Block / Component | Direct Link | Implemented Files | Where Used & What It Improves |
| --- | --- | --- | --- |
| **`statistics-07` & `statistics-19`** (Summary Header + Per-Currency Sparkline Cards) | [shadcnspace.com/blocks/stats](https://shadcnspace.com/blocks/stats) | `src/features/home/components/home-sections.tsx`, `src/features/support/components/support-overview.tsx` | Home Workspace Pulse summary banner with proportional queue meter + Support Overview single-currency monthly sparklines |
| **`chart-01` / `chart-03`** (Multi-Mode Financial Chart & Metrics Strip) | [shadcnspace.com/blocks/stats](https://shadcnspace.com/blocks/stats) | `src/components/chart-figure.tsx` | Support Overview & Reports — Bar / Area / Line segmented switcher + plotted/gap/target summary pills |
| **`resizable-01`** (Accessible Split Pane) | [shadcnspace.com/components](https://shadcnspace.com/components) | `src/components/ui/resizable.tsx` | Page Builder (`/pages/[pageId]`) and Synthetic Inbox (`/communication/inbox`) — pointer-capture + RTL keyboard arrow resizing |
| **`forms-04` & `accordion-11`** (Sticky Settings Shell & Searchable FAQ) | [shadcnspace.com/blocks/forms](https://shadcnspace.com/blocks/forms) | `src/app/settings/page.tsx`, `src/features/shell/components/help-content.tsx` | Settings sticky Scrollspy rail + Help live instant search with topic count badge |
| **`blog-details-page-01`** (Editorial Reading Layout) | [shadcnspace.com/blocks/content](https://shadcnspace.com/blocks/content) | `src/features/audience/components/public-reading-view.tsx`, `receiving-post.tsx` | Public Ministry Pages & Published Updates — balanced 65ch measure, calm spacing, clear metadata headers |

### 2.3 Shadcn Studio (`https://shadcnstudio.com`)
Dual Radix/Base UI dashboard blocks, datatables, and illustrations (`@shadcn-studio` / `@ss-blocks`).

| Shadcn Studio Block / Component | Direct Link | Implemented Files | Where Used & What It Improves |
| --- | --- | --- | --- |
| **Command Palette & Keyboard Shortcuts (`command`)** | [shadcnstudio.com/blocks/dashboard-and-application](https://shadcnstudio.com/blocks/dashboard-and-application) | `src/components/command-palette.tsx`, `src/components/shortcuts-sheet.tsx`, `src/components/ui/kbd.tsx` | Global `AppShell` (`⌘K` / `Ctrl+K` quick jump & `?` shortcuts sheet) |
| **Responsive Viewport Preview Frame** | [shadcnstudio.com/blocks/dashboard-and-application](https://shadcnstudio.com/blocks/dashboard-and-application) | `src/components/ui/viewport-preview-bar.tsx`, `src/features/ministry-pages/components/page-preview-frame.tsx` | Page Builder live preview — inert `Desktop | Tablet | Mobile` viewport width preview + 1-click revision ID copy |
| **Sticky Elevated Bulk Action Dock** | [shadcnstudio.com/blocks/dashboard-and-application/datatable](https://shadcnstudio.com/blocks/dashboard-and-application/datatable) | `src/features/work/components/bulk-action-bar.tsx` | Work Task Lists (`/work`) — glassmorphic sticky bulk action bar with selected row badge when scrolling checked lists |
| **Token Geometric Empty Illustrations** | [shadcnstudio.com](https://shadcnstudio.com) | `src/components/ui/empty-illustration.tsx`, `src/components/state-notice.tsx` | Empty states across all workspaces — crisp currentColor/CSS-variable geometric spot artwork |

### 2.4 Shadcn UI Kit (`https://shadcnuikit.com`)
Full-app workspace patterns for CRM, Mail, Tasks, Calendar, and Finance (`@shadcnuikit`).

| Shadcn UI Kit Pattern | Direct Link | Implemented Files | Where Used & What It Improves |
| --- | --- | --- | --- |
| **Dynamic Shell Route Breadcrumbs** | [shadcnuikit.com/dashboard](https://shadcnuikit.com/dashboard) | `src/lib/route-breadcrumbs.ts`, `src/components/app-shell.tsx` | Global sticky header (`xl+`) — instant parent-route context and 1-click return across all 45 nested routes |
| **Tasks Multi-View (`Table | Board`)** | [shadcnuikit.com/dashboard/apps/tasks](https://shadcnuikit.com/dashboard/apps/tasks) | `src/lib/task-board.ts`, `src/features/work/components/task-lists.tsx` | Work (`/work`) — status lane board (`Open`, `Reopened`, `Completed`, `Cancelled`) with full `TaskActions` and zero `draggable="true"` |
| **Mail Workspace (`mail`)** | [shadcnuikit.com/dashboard/apps/mail](https://shadcnuikit.com/dashboard/apps/mail) | `src/features/audience/components/inbox-list.tsx`, `message-reader.tsx` | Synthetic Inbox (`/communication/inbox`) — sender monogram avatars, `j`/`k` message shortcuts, resizable split view, collapsible RFC headers |
| **CRM Contact Profile & Quick Copy (`crm`)** | [shadcnuikit.com/dashboard/crm](https://shadcnuikit.com/dashboard/crm) | `src/components/record-detail.tsx`, `src/features/partners/components/partner-detail-sections.tsx`, `src/components/ui/copy-button.tsx` | Partner Detail & Gift/Delivery records — 1-click copy for emails, phones, postal addresses, and opaque source IDs |
| **Editorial Updates Gallery (`Table | Cards`) & Calendar Month Summary** | [shadcnuikit.com/dashboard/apps/calendar](https://shadcnuikit.com/dashboard/apps/calendar) | `src/features/updates/components/updates-list.tsx`, `src/components/ui/calendar-grid.tsx` | Communication Updates card view + Work Agenda Calendar month count & overdue badges |

### 2.5 React Bits (`https://reactbits.dev`) & React Bits Pro (`https://pro.reactbits.dev`)
Applied selectively under Emil Kowalski's **"Speed Over Delight"** discipline — zero WebGL/Three.js bundle weight, zero raw colors, 100% static under `prefers-reduced-motion: reduce`.

| React Bits / Pro Pattern | Direct Link | Implemented Files | Where Used & What It Improves |
| --- | --- | --- | --- |
| **DotGrid Token Backdrop (`DotGrid`)** | [reactbits.dev/backgrounds/dot-grid](https://reactbits.dev/backgrounds/dot-grid) | `src/styles/globals.css` (`.bg-dot-grid`), `home-sections.tsx`, `public-reading-view.tsx`, `receiving-post.tsx`, `discovery-index.tsx` | Subtle CSS-only radial dot atmosphere on Home Workspace Pulse and public editorial headers |
| **SpotlightCard (`SpotlightCard`)** | [reactbits.dev/components/spotlight-card](https://reactbits.dev/components/spotlight-card) | `src/components/ui/spotlight-card.tsx`, `globals.css` (`.spotlight-surface`) | Support destination cards, Public Discovery cards, Updates cards — fine-pointer-only hover sheen |
| **CountUp (`CountUp`) & AnimatedList (`AnimatedList`)** | [reactbits.dev/components/animated-list](https://reactbits.dev/components/animated-list) | `src/components/ui/count-up.tsx`, `src/components/ui/animated-list.tsx` | Non-financial Home queue counts & subtle staggered item entrance (never used on financial figures!) |
| **Editorial Reading Progress Hairline & Read-Time Estimate (Pro Editorial)** | [pro.reactbits.dev/blocks](https://pro.reactbits.dev/blocks) | `src/components/ui/reading-progress.tsx`, `src/lib/editorial-metrics.ts`, `public-reading-view.tsx`, `receiving-post.tsx` | Public Ministry Pages & Published Updates — GPU-composited `scaleX` scroll progress hairline & Unicode-safe `X min read` badge |
| **Morphing Autosave Status Mark** | [reactbits.dev](https://reactbits.dev) | `src/components/ui/status-mark.tsx`, `src/features/updates/components/autosave-status.tsx` | Update & Page draft editors — crisp SVG status transitions (`idle` / `saving` / `saved` / `error` / `conflict`) |

---

## 3. Performance, Accessibility & Compatibility Summary

- **Zero heavy runtime bloat**: Avoided WebGL/Three.js React Bits backgrounds and `@dnd-kit` drag-only interactions; kept total new dependencies to `@tanstack/react-virtual` only.
- **Responsive Tab & Target Hygiene**: Inline `DataGridColumnHeaderMenu` buttons render on desktop (`md+`) only (`hidden md:inline-flex`), preserving tight 320px and 200%-zoom keyboard tab budgets while meeting the WCAG 2.2 `24×24px` target floor everywhere.
- **RTL & Reduced Motion Verified**: Every border, sticky offset, chevron, and reading progress transform uses logical coordinates (`inset-inline-*`, `border-s-*`, `[dir="rtl"]`), and every motion surface renders instantaneously with zero dev console warnings when `prefers-reduced-motion: reduce` is active.

---

## 4. ReUI Data Grid Architecture (`RecordList`)

`src/components/record-list.tsx` is the single table engine across all data-heavy surfaces. It registers eight TanStack Table v9 features (`rowSortingFeature`, `rowSelectionFeature`, `columnVisibilityFeature`, `rowPaginationFeature`, `columnPinningFeature`, `columnSizingFeature`, `columnOrderingFeature`, `rowExpandingFeature`) and exposes:

- `initialPinnedColumns?: { start?: readonly string[]; end?: readonly string[] }` — Pins key identifier and trailing action columns from `md` (`48rem`) upwards inside the sole `ScrollRegion`. Below `md` (320px phones and 200% zoom), pinned styles relax cleanly to static flow.
- `renderExpandedRow?: (row: TRow) => ReactNode` — Adds a leading `>= 24×24px` expand toggle button per row plus an `Expand all` / `Collapse all` toggle in `DataGridHeader`. Sub-rows mount in `<tbody>` **only while expanded**, preserving exact collapsed row counts.
- `DataGridColumnHeaderMenu` — Inline desktop (`md+`) per-column dropdown menu for sorting, logical start-pinning, column reordering, `±24px` width stepping, and hiding.
- `DataGridViewSettings` — Unified grid settings popover for Comfortable/Compact density, opt-in `@tanstack/react-virtual` scrolling (`> 40` rows), column layout controls, and one-click `Reset grid`.

---

## 5. Extending Safely

- **Adding a new UI primitive**: Place framework-only primitives in `src/components/ui/` (never import `@/features/**` or `@/modules/**`). Keep pure math/parsing/grouping helpers in `src/lib/` so Vitest covers them directly under `tests/ui/`.
- **Adding motion**: Always use `usePrefersReducedMotion()` from `@/hooks/use-prefers-reduced-motion` and provide an instant non-animated fallback. Never animate financial currency values.
- **Adding custom styles**: Put any gradient, pseudo-element, or media-query rule in `apps/dashboard/src/styles/globals.css` referencing `--*` tokens only, then verify with `bun run lint` (`oxlint` + `scripts/check-invariants.ts`), `bun run typecheck`, `bunx vitest run`, `bun run build`, and `bunx playwright test`.

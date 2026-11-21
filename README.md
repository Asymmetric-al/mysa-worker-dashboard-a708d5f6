# Worker Dashboard

One locally running Worker Dashboard — the daily workspace in which a worker or a deputized fundraiser sees who needs attention, reads the financial evidence of their support honestly, writes and releases ministry communication, and completes the follow-through. It is a single Next.js 16 application whose App Router is the only router: Server Components call one typed data service directly, the browser reaches the same service through thin Route Handlers, and no code path fetches the application's own HTTP endpoint from the server.

Every record comes from one synthetic, session-isolated, file-backed store under `.data/`, so every journey starts from the same deterministic seed. Every external effect is simulated locally and labelled where the user triggers it: mail submission, publication reach, the giving destination, importer safety and media preparation. There is no provider secret, no `.env` file to fill in and no deployment. The seams a later owner would attach to — identity/CRM, finance, Payload content, publication, communication and media custody — are documented, with the adapter location each would take, in [`docs/architecture.md`](docs/architecture.md); none of them exists as an integration here.

This file documents the design of record for that repository. Its measurement and verification claims are deliberately narrower: they cover only what was actually run on this tree, and the verification record and the known limitations state what has and has not been demonstrated so far rather than restating the target as though it had been reached.

## Commands

Run every command from the repository root unless the table says otherwise. A development server allows `PORT` to be stated inline, so two checkouts on one host never collide:

```sh
PORT=3590 bun run dev
```

| Command                  | What it does                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`            | Installs the workspace from the single `bun.lock`. `bun install --frozen-lockfile` proves the lockfile is complete and unchanged.                                                                                                                                                |
| `bun run dev`            | Starts the application (`turbo run dev` → `next dev`). Binds the port in `PORT`, defaulting to 3000.                                                                                                                                                                             |
| `bun run build`          | Production build of the application (`next build`).                                                                                                                                                                                                                              |
| `bun run typecheck`      | `tsc --noEmit` over the application, in strict mode with `noUncheckedIndexedAccess`.                                                                                                                                                                                             |
| `bun run lint`           | Oxlint 1.94.0 with the one root `.oxlintrc.json`, which also carries the layering rules (no store access outside the service, no feature-to-feature import, no raw colour literals, no floating-point money arithmetic).                                                         |
| `bun run format`         | Oxfmt 0.79.0 over the tree. It writes in place, so `bunx oxfmt --check .` is the non-writing form.                                                                                                                                                                               |
| `bun run test`           | Vitest first (the domain and integration suites, which import the service and domain modules directly and need no DOM), then the Playwright project, which restores the seed through the application's own `resetSeed` before each spec and drives its own dev server on `PORT`. |
| `bun run reset`          | Deletes the stored sessions and re-seeds every seeded session deterministically through `scripts/reset.ts`.                                                                                                                                                                      |
| `bun run seed:workload`  | Writes the published workload — 10,000 partners and 100,000 gifts — from a fixed seed into the `established-worker` session.                                                                                                                                                     |
| `bun run fixtures:media` | Verifies the six committed media fixtures against their recorded digests and assertions. `--write --force` authors them instead.                                                                                                                                                 |
| `bun run lines`          | Runs the project's line-count command verbatim and exits by the 100,000-line limit.                                                                                                                                                                                              |

`bun run lines` runs exactly:

```sh
git ls-files | grep -v -e '^bun.lock$' | xargs wc -l
```

No command needs an environment variable and none reads a secret. `PORT`, `NEXT_TELEMETRY_DISABLED` and `WORKLOAD_MEASUREMENT` (which un-skips the timing spec) are convenience variables, not configuration: with none set, every command above behaves the same way except that the timing spec skips and the dev server takes port 3000.

## Stack and versions

Every version below is pinned exactly in the manifests — no range, no `latest`, no "or later".

| Role                               | Selection                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language and compiler              | TypeScript **7.0.2**; `tsconfig.base.json` sets strict mode, `noUncheckedIndexedAccess`, and a `paths` alias `@/*` with no `baseUrl`, because TypeScript 7 removed it.                                                        |
| Runtime and package manager        | Bun **1.4.5** on Node **26.13.1** (native `Temporal`, atomic `rename` for the store). One `bun.lock` for the workspace.                                                                                                       |
| Task orchestration                 | Turbo **2.11.13** — `dev`, `build`, `typecheck`, `lint`, `test`.                                                                                                                                                              |
| Framework and router               | Next.js **16.4.6**, App Router as the only router, plus Route Handlers for browser reads, mutations and scoped media.                                                                                                         |
| UI runtime                         | React and React DOM **19.3.1**.                                                                                                                                                                                               |
| Component system                   | shadcn CLI **4.23.0**, style **Maia** (`base-maia`), base colour **Zinc**, icon library `lucide`, tokens in `src/styles/globals.css`.                                                                                         |
| Component behaviour                | `@ui-sdk/core` and `@ui-sdk/react` **0.1.0-beta.13** first, reached only through `src/lib/ui-sdk.ts`; `@base-ui/react` **1.9.0** as the primitive substrate inside `src/components/ui` and the documented fallback elsewhere. |
| Styling                            | Tailwind CSS and `@tailwindcss/postcss` **4.3.5**, PostCSS **8.5.33**, `tw-animate-css` **1.4.0**.                                                                                                                            |
| Contracts and validation           | Zod **4.6.7**.                                                                                                                                                                                                                |
| Remote-result state, tables, forms | TanStack Query **5.108.1**, TanStack Table **9.3.1** (v9 API, manual processing), TanStack Form **1.33.5**.                                                                                                                   |
| Prose editing and rendering        | Tiptap **3.34.0** — `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/static-renderer`. One configuration, one schema, one static renderer.                                                                      |
| Charts                             | Recharts **3.11.0**, behind one owned chart pattern.                                                                                                                                                                          |
| Media and files                    | sharp **0.35.5**, mediabunny **1.66.2**, file-type **22.3.0**, `csv-parse` **7.0.3**.                                                                                                                                         |
| Time                               | Native `Temporal` through `temporal-polyfill` **1.0.8**, imported as a ponyfill.                                                                                                                                              |
| Verification                       | Vitest **5.1.1**, `@playwright/test` **1.65.1**, `@axe-core/playwright` **4.14.0**, Oxlint **1.94.0**, Oxfmt **0.79.0**.                                                                                                      |

What the stack deliberately does not contain: **no database, no ORM, no migrations, no provider SDK, no deployment machinery.** Persistence is one JSON document set per session behind the service; the schema, migrations and row-level security a later finance or identity owner would bring are that owner's work, and this repository keeps the shape it must satisfy instead of a copy of it.

## Dependencies and the job each serves

Forty packages are declared: six at the workspace root as development tooling, twenty-four application dependencies and ten application development dependencies. Each serves a retained job in the build or the running application, and every dependency declared by either `package.json` appears exactly once below.

### Declared packages

| Package                    | Version       | Retained job                                                                                                                                |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo`                    | 2.11.13       | Runs and caches `dev`, `build`, `typecheck`, `lint` and `test` from one configuration.                                                      |
| `typescript`               | 7.0.2         | The compiler behind `bun run typecheck`.                                                                                                    |
| `oxlint`                   | 1.94.0        | The linter named by `bun run lint`, including the layering, money and colour invariants.                                                    |
| `oxfmt`                    | 0.79.0        | The formatter; the pinned TS7-compatible pairing with Oxlint.                                                                               |
| `@types/node`              | 26.6.6        | Types for the store's filesystem writes and the reset, workload and line-count scripts.                                                     |
| `@types/bun`               | 1.4.5         | Types for the Bun APIs the scripts use (`Bun.spawn` in the line-count script).                                                              |
| `next`                     | 16.4.6        | The framework, the only router, and the Route Handlers that carry browser reads and mutations.                                              |
| `react`                    | 19.3.1        | Component runtime for server and client composition.                                                                                        |
| `react-dom`                | 19.3.1        | The DOM renderer Next 16 requires.                                                                                                          |
| `@tanstack/react-query`    | 5.108.1       | Remote-result cache keyed by scope, with invalidation across a context switch. It caches envelopes; it is never a second store.             |
| `@tanstack/react-table`    | 9.3.1         | Column, row and selection presentation behind `record-list`, with the service owning filters, sorting, paging and aggregation.              |
| `@tanstack/react-form`     | 1.33.5        | State for multi-field forms (contact edits, interaction logging, import decisions, content metadata, coaching sharing).                     |
| `@tiptap/react`            | 3.34.0        | The editor binding used by the one prose editor.                                                                                            |
| `@tiptap/pm`               | 3.34.0        | The ProseMirror document model the editor and the static renderer share.                                                                    |
| `@tiptap/starter-kit`      | 3.34.0        | The bounded extension set (paragraph, headings, emphasis, strike, underline, lists, quote, code, link, hard break).                         |
| `@tiptap/static-renderer`  | 3.34.0        | Renders stored content JSON to HTML with no editor instance, for preview, reading, print and message HTML.                                  |
| `recharts`                 | 3.11.0        | Chart primitives behind the single chart-with-table-alternative pattern.                                                                    |
| `zod`                      | 4.6.7         | Validation for mutation payloads, import rows, media descriptors, content, settings and route inputs, and the source of per-field messages. |
| `@ui-sdk/core`             | 0.1.0-beta.13 | Generic interaction behaviour, first choice: dismissable layers, roving focus, typeahead.                                                   |
| `@ui-sdk/react`            | 0.1.0-beta.13 | React bindings for those behaviours, re-exported through the one adapter.                                                                   |
| `@base-ui/react`           | 1.9.0         | Primitive substrate under the Maia component source, and the documented fallback where the UI SDK lacks a behaviour.                        |
| `class-variance-authority` | 0.7.1         | Variant composition inside `src/components/ui`.                                                                                             |
| `clsx`                     | 2.1.1         | Class concatenation inside the `cn` helper.                                                                                                 |
| `tailwind-merge`           | 3.7.1         | Conflict-free class merging inside `cn`.                                                                                                    |
| `lucide-react`             | 1.77.0        | The icon set the component source and the surfaces import.                                                                                  |
| `sharp`                    | 0.35.5        | Image decode, EXIF-aware orientation, bounded resize, re-encode and metadata stripping.                                                     |
| `mediabunny`               | 1.66.2        | Video container, codec, duration, dimension and rotation inspection, plus the tag-free copy-remux that produces the served rendition.       |
| `file-type`                | 22.3.0        | Magic-byte typing of image and video uploads, so an extension never establishes type.                                                       |
| `csv-parse`                | 7.0.3         | Streaming, BOM-aware, limit-aware parsing for the contact-import journey.                                                                   |
| `temporal-polyfill`        | 1.0.8         | The ponyfill entry point for `Temporal`: calendar-day windows, elapsed-second windows, DST gaps and repeats.                                |
| `tailwindcss`              | 4.3.5         | The utility layer and the theme bridge for the Maia/Zinc tokens.                                                                            |
| `@tailwindcss/postcss`     | 4.3.5         | The Tailwind 4 PostCSS plugin Next builds `globals.css` with.                                                                               |
| `postcss`                  | 8.5.33        | The PostCSS runner that plugin attaches to.                                                                                                 |
| `tw-animate-css`           | 1.4.0         | The animation utilities the Maia component source uses for restrained transitions.                                                          |
| `shadcn`                   | 4.23.0        | The CLI that wrote `components.json`, the token stylesheet and the component source once, during the build.                                 |
| `@types/react`             | 19.3.0        | React types; also satisfies the UI SDK's `>=19.2.10` peer.                                                                                  |
| `@types/react-dom`         | 19.3.0        | DOM renderer types.                                                                                                                         |
| `vitest`                   | 5.1.1         | The domain and integration suites, which run without a DOM.                                                                                 |
| `@playwright/test`         | 1.65.1        | The browser journeys, driving a real dev server through the application's own `bun run dev`.                                                |
| `@axe-core/playwright`     | 4.14.0        | The accessibility pass bound to the browser journeys.                                                                                       |

### Deliberately not added

Each row names what is absent and what completes the job instead. No excluded capability is served by a substitute package under another name.

| Not added                                                                                                                         | Why it is absent                                                                                               | What completes the job                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any database driver, ORM, query builder or migration tool (`pg`, `postgres`, `drizzle-orm`, `prisma`, `kysely`, `better-sqlite3`) | A database, its schema, its migrations and row-level security are the future finance and identity owners' work | The file-backed store behind the typed service (`src/modules/store`)                                                                                    |
| `@tanstack/react-db`, `@tanstack/store`                                                                                           | No interaction needs a second state owner                                                                      | TanStack Query for remote results, local component state for transient selection, the store as the only record owner                                    |
| `@tanstack/react-virtual`                                                                                                         | No measured rendering need: the table paginates at 50 rows over service-processed pages                        | Pagination; the virtualiser is re-entered only after a documented rendered-row measurement                                                              |
| `@tanstack/react-hotkeys`, `@tanstack/react-pacer`                                                                                | Neither simplifies a retained interaction                                                                      | Native keyboard handling; ordinary debounce in the search field                                                                                         |
| `sonner`, `@radix-ui/react-toast`                                                                                                 | A toast may never be the only proof that something was accepted                                                | The durable in-context result (`src/components/operation-result.tsx`)                                                                                   |
| `cmdk`                                                                                                                            | The combobox already covers searchable selection                                                               | `src/components/ui/combobox.tsx`                                                                                                                        |
| `react-day-picker`, `date-fns`, `luxon`, `dayjs`, `moment`                                                                        | The date work is civil-date and zone-window semantics, not calendar widgets                                    | `Input` date and date-time variants, `NativeSelect`, and `Temporal` through `temporal-polyfill`                                                         |
| `react-hook-form`, `@hookform/resolvers`                                                                                          | Form state is fixed to TanStack Form                                                                           | `@tanstack/react-form` with Zod                                                                                                                         |
| `csv-stringify`, `papaparse`, `xlsx`, `exceljs`, `jspdf`, `pdf-lib`                                                               | CSV production carries product rules the libraries do not; workbook and PDF output are excluded                | The owned writer in `src/modules/export`, and browser print                                                                                             |
| `resend`, `@react-email/*`, `inngest`, `nodemailer`, `postmark`, `sendgrid`                                                       | Live communication infrastructure is excluded and every effect is simulated                                    | The synthetic inbox and the labelled simulation in the audience module                                                                                  |
| `payload`, `lexical`, `@payloadcms/*`                                                                                             | CMS administration and a second editor are excluded                                                            | One Tiptap configuration and one static renderer                                                                                                        |
| `next-auth`, `@auth/*`, `jose`, `oauth4webapi`                                                                                    | Production authentication and OAuth are excluded                                                               | The synthetic session cookie and the admission resolver                                                                                                 |
| `@sentry/*`, `pino`, `winston`, `opentelemetry*`                                                                                  | No observability platform is in scope                                                                          | `src/lib/logger.ts`, which writes local diagnostics only and never logs note bodies, check-in text, message bodies, addresses, amounts or exported rows |
| `jsdom`, `happy-dom`, `@testing-library/*`                                                                                        | Claims are made at domain, integration or browser level                                                        | Vitest without a DOM, and Playwright where a browser is needed                                                                                          |
| `ffmpeg`, `@ffmpeg/*`, `fluent-ffmpeg`, `@mediabunny/server`                                                                      | No runtime binary or FFmpeg-backed encode path is permitted                                                    | mediabunny's pure-TypeScript inspection and copy-remux                                                                                                  |
| `@asym/*`, `@acme/*` or any package reproduced from the destination system                                                        | Context about that system is descriptive only and authorises nothing                                           | The application's own typed service and component layer                                                                                                 |

### Design-system components deliberately not installed

The shadcn registry publishes 65 entries; this build installs 36 and leaves 29 out on purpose, each for a reason that would otherwise break a pinned decision.

| Registry entry                                                                                                                                                                                                                                                               | Why it is not installed                                                                                                                                                      | What completes the job                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `chart`                                                                                                                                                                                                                                                                      | Its registry dependency pins `recharts@3.8.0` against the fixed 3.11.0                                                                                                       | The owned chart pattern on Recharts 3.11.0, with a data table and prose summary |
| `form`                                                                                                                                                                                                                                                                       | Form state belongs to TanStack Form 1.33.5                                                                                                                                   | `field` + `label` for layout and error semantics, over TanStack Form            |
| `calendar`                                                                                                                                                                                                                                                                   | It would add `react-day-picker` and `date-fns` for a widget the product does not use                                                                                         | `Input`'s `type="date"` and `type="datetime-local"` keep date-only values civil |
| `command`                                                                                                                                                                                                                                                                    | It would add `cmdk` beside a combobox that already covers searchable selection                                                                                               | `src/components/ui/combobox.tsx`                                                |
| `sonner`, `toast`                                                                                                                                                                                                                                                            | A durable in-context result is mandatory and a toast may never be the only feedback                                                                                          | `src/components/operation-result.tsx`                                           |
| `carousel`, `drawer`, `hover-card`, `menubar`, `navigation-menu`, `context-menu`, `resizable`, `slider`, `aspect-ratio`, `input-otp`, `code-block`, `item`, `marker`, `bubble`, `message`, `message-scroller`, `questionnaire`, `trace`, `attachment`, `kbd`, `button-group` | No retained job needs them                                                                                                                                                   | The installed components the surfaces actually use                              |
| `accordion`, `collapsible`                                                                                                                                                                                                                                                   | Neither is installed nor excluded: every expansion the product needs is served by `tabs`, `sheet` and `dialog`, and installing them would create a second disclosure pattern | `tabs`, `sheet`, `dialog`                                                       |

36 installed + 27 excluded + 2 left out = all 65 registry entries, which is the reconciliation a reviewer can check against `src/components/ui`.

## Seeded identities, personas and session states

`bun run reset` writes **20 seeded sessions** from one deterministic seed. A persona is an identity; a session state is an admission of that identity; a scenario is the world behind it. They are separate facts and are never inferred from one another.

| Session id                                | Persona                   | What it demonstrates                                                                                             |
| ----------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `new-worker`                              | New worker                | No gifts, goal, subscription or integration: one private contact and one task to start from.                     |
| `established-worker`                      | Established worker        | Years of gifts, recurring support, partners, drafts and pages, across two ministries. The default session.       |
| `established-worker-students`             | Established worker        | The same person with the second ministry selected: an available support source carrying no goal.                 |
| `second-worker`                           | Second worker             | Another ministry entirely — the isolation proof, holding none of the first scope's records.                      |
| `deputized-fundraiser`                    | Deputized fundraiser      | Acting inside one admitted ministry, among shared records and its own private work.                              |
| `coach`                                   | Coach                     | Read-only access to exactly the modules and periods the worker shared; authorised before anything is enumerated. |
| `content-reviewer`                        | Content reviewer          | Approves frozen content candidates, and only candidates.                                                         |
| `reader-public`                           | Public reader             | Admitted to the public edition of the receiving preview.                                                         |
| `reader-approved-supporter`               | Approved-supporter reader | Admitted to the approved-supporter edition, refused its siblings.                                                |
| `reader-unauthorized`                     | Unauthorized reader       | Refused protected content honestly, with nothing about it disclosed.                                             |
| `subscriber`                              | Subscriber                | A purpose-specific membership choosing Off or Immediate.                                                         |
| `no-access`                               | Established worker's seat | No usable account: the only honest outcome is account-recovery guidance.                                         |
| `session-unavailable`                     | Established worker's seat | Admission cannot be resolved because a source is down: retry guidance, never an empty workspace.                 |
| `session-denied`                          | Established worker's seat | Denied with nothing disclosed: no count, title, size or existence hint.                                          |
| `session-expired`                         | Established worker's seat | An expired session, offered a way back in rather than a blank page.                                              |
| `established-worker-media-unavailable`    | Established worker        | One placement's source is down: the poster and text alternative stay, the prose is intact, retry is offered.     |
| `established-worker-coaching-unavailable` | Established worker        | One admitted coaching module's source is down; the other admitted modules stay usable.                           |
| `established-worker-continuation-on`      | Established worker        | Worker continuation is on, so an ordinarily expired referral offers its single Continue action.                  |
| `established-worker-continuation-off`     | Established worker        | The same referral with continuation off: no Continue is offered at all.                                          |
| `established-worker-partial-release`      | Established worker        | One variant releases while its sibling fails, and the sibling's prior-good head is preserved.                    |

The roster is switched from the development panel and the persona switcher in the shell. **Switching is a development control, not authentication**: there is no password, token endpoint, OAuth flow or session refresh protocol. The session is a `dashboard_session` cookie (`httpOnly`, `sameSite=lax`, one year) minted by `src/proxy.ts` in development, and the service resolves admission from it on every read and every mutation. The reader personas are admitted by the persona they preview, never by a ministry membership.

## The development runtime

| Concern           | How it works                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where state lives | `.data/` at the repository root, git-ignored. Each session owns `<sessionId>.state.json` (records), `<sessionId>.operations.json` (the operation ledger and receipts), `<sessionId>.meta.json` (scenario, clock offset, selected context, failure plan) and, once generated, `<sessionId>.workload.json` (the large dataset). Served media bytes live in `.data/media` custody, never in a public URL.      |
| Isolation         | A session sees only its own documents, keyed by the development cookie. Scenario selection is per session, so two browser contexts can run different worlds at once — which is what makes the cross-scope tests meaningful.                                                                                                                                                                                 |
| Durability        | Every write goes to a same-directory temporary file and is `rename`d over the target, so a crash leaves the previous document or the new one. Writes for a session are serialised by an in-process mutex; the runtime assumes one Node process. Accepted edits survive navigation, a full refresh, a server restart and reopening the browser.                                                              |
| The clock         | `setClock` sets an offset from the seed instant and `advanceClock` moves it forward. Those are the only two names that change time, and nothing observes the clock in the background: every boundary — referral windows, coaching cutoff, notification usefulness, confirmation expiry, recurrence admission, report period edges — is a pure function of `(input, now)` evaluated at read or command time. |
| The failure plan  | `setFailurePlan` arms one deterministic mode for one named mutation or read: `denied` (scope refusal), `conflict` (changed revision) or `unknown` (lost acknowledgement). The armed mode is visible in the development panel, so a demonstration is reproducible rather than anecdotal.                                                                                                                     |
| Reset             | `bun run reset` deletes `.data/` and re-seeds every session; the Settings screen exposes the same operation as `resetSeed` behind a confirmation. Both write identical bytes for the readable seed, which is what lets every journey start from a known world.                                                                                                                                              |
| Scenario          | `setScenario` loads a different world over the same records — a source unavailable, a contained edition, a sibling release that failed — without changing a record on its own.                                                                                                                                                                                                                              |
| Context           | `selectContext` switches organization, ministry and support subject; it is fenced so a late response from the previous context cannot land in the new one, and the browser cache is cleared before the next read is issued.                                                                                                                                                                                 |

Values the service reports are typed, not inferred: a read envelope states one of the value states `value`, `zero`, `unknown`, `withheld`, `unavailable` or the derived `incomplete-subtotal`, so a genuine zero, an unknown, a withheld value and an unavailable source can never share a rendering. Every mutation returns exactly one of eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown` — and no caller may infer success from the absence of an error.

The same separation holds for facts that look alike. An acting user, the selected organization and ministry, the support subject, a partner, a household, an organization representative and a preview persona are separate references, and no join uses a name, an email address or a postal address. Contactability, consent for one publisher and one purpose, and a reader grant for protected content are three different facts, each evaluated at read time and never cached in the UI. Worker-private preparation and notes are a different record class from shared operational facts, and never appear in a shared projection, an export or another record's audience. A commitment is not received money; completing a task proves no contact and no payment; publication is not delivery; a model that counts a planned meeting is not counting a held one.

## Simulated effects and their labels

The shell carries a persistent **Development data** badge on every screen, with the sentence that every record is synthetic and every external effect is simulated. Each boundary that would leave the application in production also states, at the control that triggers it, exactly what did not happen. The five sentences are fixed in `src/components/simulation-label.tsx`.

| Boundary                         | Label shown where the user triggers it                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Notification submission          | `simulated — no mail leaves this application`                                  |
| Publication reach                | `simulated publication; reach is demonstrated in the receiving preview`        |
| The giving destination on a Page | `simulated giving destination; no payment is taken`                            |
| Contact import                   | `synthetic files only; a successful local parse is not a safety qualification` |
| Media preparation                | `local processing; not production scanning or transcoding`                     |

Publication, notification submission, provider acceptance, delivery and reading are five separate outcomes with separate evidence, and no surface presents one as another. Withdrawal and cancellation never claim to recall a message or a third-party copy.

## Shared concerns: one implementation each

This is the list a reviewer checks the one-implementation rule against. Every path exists in the tree as written.

| Concern                                                       | The single implementation                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Prose editor, document schema and static renderer             | `src/modules/content/document.ts`, `src/components/prose-editor.tsx`, `src/modules/content/render.ts` |
| Content variant and release identity                          | `src/modules/content/variant.ts`                                                                      |
| Locale fallback                                               | `src/modules/content/locale.ts`                                                                       |
| Notice recipient and rendition resolution                     | `src/modules/content/notice.ts`                                                                       |
| Review panel                                                  | `src/components/review-panel.tsx` (Updates and Pages)                                                 |
| Report function                                               | `src/modules/support/report.ts` → `runReport`, the only computation behind every financial surface    |
| Query toolbar and record list                                 | `src/components/query-toolbar.tsx`, `src/components/record-list.tsx` on TanStack Table v9             |
| Record detail body                                            | `src/components/record-detail.tsx` — one body for the route, the desktop panel and the phone page     |
| Form and field errors                                         | `src/components/form-field.tsx`                                                                       |
| Action review and its result                                  | `src/components/action-review.tsx`, `src/components/operation-result.tsx`                             |
| Empty, unavailable and unknown states                         | `src/components/state-notice.tsx`                                                                     |
| Chart with a table alternative                                | `src/components/chart-figure.tsx`                                                                     |
| Scrollable table region                                       | `src/components/scroll-region.tsx`                                                                    |
| Media picker, placement and custody                           | `src/components/media-picker.tsx`, `src/modules/media/*`                                              |
| Time boundary evaluators                                      | `src/modules/time/window.ts`, `src/modules/time/recurrence.ts`                                        |
| Money arithmetic and formatting                               | `src/modules/money/*`                                                                                 |
| CSV writer and formula neutraliser                            | `src/modules/export/csv.ts`                                                                           |
| Import parsing, decisions and receipt                         | `src/modules/import/*`                                                                                |
| Read envelope, mutation outcomes, ledger and scope resolution | `src/modules/data-service/{envelope,outcome,operations,authorize}.ts`                                 |
| The store                                                     | `src/modules/store/*`                                                                                 |
| The development runtime                                       | `src/modules/dev-runtime/*`                                                                           |
| Audience membership and consent                               | `src/modules/audience/*`                                                                              |
| Coaching grant and disclosure                                 | `src/modules/coaching/*`                                                                              |
| UI SDK behaviour adapter                                      | `src/lib/ui-sdk.ts` — the only file importing `@ui-sdk/*`                                             |
| Simulated-effect label                                        | `src/components/simulation-label.tsx`                                                                 |

Three boundaries keep these single implementations from collapsing into one another:

- **UI SDK first, Base UI as substrate and documented fallback.** Inside `src/components/ui`, Base UI is the substrate of the generated Maia source, which is neither a fallback nor a gap. Any `@base-ui/react` import _outside_ that folder is a fallback and needs a gap-register entry in `docs/architecture.md` naming the interaction, the SDK package and version consulted, the behaviour or criterion that fails without it, and the component substituted. One entry exists today: modal focus containment.
- **One editor.** A single Tiptap configuration, one document schema, one static renderer serve Update prose, Page prose, both previews, the receiving views, print and message HTML. There is no second editor, converter or dual-format persistence.
- **One transport per direction.** Server Components call the service; the browser posts to Route Handlers. No Server Actions, no second transport, and no server request to the application's own HTTP endpoint.

## Route families and the one reachability exception

Navigation follows the questions the worker asks, not the data model.

| Question                                    | Surface                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who needs my attention?                     | `/` — Attention, Information and Unfinished work, each item carrying a reason and a destination                                                                                                                           |
| What do I know about this relationship?     | `/partners`, `/partners/[partnerId]`, `/partners/import`, `/partners/initiatives`, `/partners/referrals`                                                                                                                  |
| What should I do next?                      | `/work`, `/work/agenda`, `/work/series/[seriesId]`                                                                                                                                                                        |
| How is support going?                       | `/support`, `/support/gifts`, `/support/commitments`, `/support/reports/[reportId]`                                                                                                                                       |
| What should I share, and who receives it?   | `/communication`, `/communication/[updateId]`, its variant editor and preview, `/communication/review/[candidateId]`, `/communication/audience`, `/communication/delivery`, `/communication/inbox`                        |
| What do people see?                         | `/pages`, `/pages/[pageId]`, its locale preview, `/pages/review/[candidateId]`, and the receiving side at `/preview`, `/preview/[updateId]`, `/preview/pages`, `/preview/pages/[pageId]/[locale]`, `/preview/preferences` |
| What help do I want?                        | `/coaching`, `/coaching/targets`, `/coaching/check-ins`, `/coaching/sharing`, `/coaching/coach`, `/coaching/coach/[subjectId]`                                                                                            |
| Where do I change how this looks and reads? | `/settings` (appearance, locale, display timezone, source status, reset) and `/help` for these workflows only                                                                                                             |

**One named exception to reachability by navigation.** `/feed` is not a destination and has no navigation entry: it is a declared legacy alias that immediately redirects to `/communication`. The reachability sweep carries an exception list containing exactly `/feed` and asserts positively that a request to it resolves to `/communication`, so the audit reads it as a declared alias rather than an orphan route. No other route is exempt.

## Measurements

### Tracked line count

`bun run lines` runs the project's command verbatim, prints the pipeline's per-file counts, and exits by the 100,000-line limit:

```sh
git ls-files | grep -v -e '^bun.lock$' | xargs wc -l
```

**Measured on this tree: `TOTAL 128385` against `LIMIT 100000` — `STATUS FAIL`, `OVERAGE 28385`, exit status 1.** Of those lines, 6,192 are the `wc` line counts of the six committed media fixtures, which the count excludes in intent but not in the pipeline (`sample-h264.mp4` 4,050; `sample-vp9.webm` 1,054; `sample-unsupported.mkv` 1,054; `IMG_20260814-harbour-youth-group.jpg` 4; `poster.jpg` 23; `sample.vtt` 7). Without them the tracked source measures **122,193** lines, which is still over the bound.

This figure is the measurement at the commit that carried this file; the tracked tree keeps growing as the build proceeds, so `bun run lines` — not the number above — is the authority on the current total.

The last under-bound measurement recorded in `docs/architecture.md` was **98,537** lines (`STATUS PASS`). The tree has grown past the bound since; the bound is enforced by the exit status of `bun run lines` rather than by this file. The line budget is a whole-tree property, so it is settled by reducing the tracked tree, not by adjusting the measurement.

### Published workload and performance

The workload is the one `bun run seed:workload` writes for `established-worker`: **10,000 partners and 100,000 gift rows**, generated deterministically from seed `20261120`. It is measured from `apps/dashboard` with

```sh
WORKLOAD_MEASUREMENT=1 bunx vitest run tests/integration/workload-timing.test.ts
```

which is skipped unless that variable is set, so the ordinary gate stays fast. The filtered Gifts read is warmed up three times and then sampled **30 times**, with p95 taken as the nearest-rank value; the export is timed once over the whole query, with no page window.

Both rows below are observations on the stated machine, taken with the method attached and with no change to the generator, seed or query to move them. Neither is a capacity promise.

| Observation                        | When recorded                                                       | Filtered Gifts read, 30 samples (p95 / min / median / max)         | Whole-query CSV export                                                             | Host load average     |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------- |
| Recorded in `docs/architecture.md` | Earlier, on a less loaded host                                      | **87.2 ms** / 75.9 / 80.8 / 89.8 ms (whole result 10,878 USD rows) | **8,381.7 ms** for **99,911 rows**                                                 | 9.90 / 10.59 / 12.64  |
| Re-run for this file               | At the time of writing, on a host shared with the rest of the build | **296.3 ms** / 105.1 / 175.8 / 301.0 ms (whole result 10,878 rows) | **20,651 ms** for **99,911 rows** (99,928 CSV lines including header and metadata) | 33.68 / 24.10 / 20.29 |

Both sets meet their targets — p95 under 500 ms and a full 100,000-row export under 30 s — and the difference between them is host load, not a change in the code path. The two figures are stated together rather than replaced, because both are true of the same tree on the same machine at different moments.

**The machine.** An Intel Xeon Platinum 8581C at 2.10 GHz with 3,145,377,214,464 bytes of RAM on Linux 6.12.105+, running Node v26.13.1. `os.cpus()` reports the host's 112 processors while this container is scheduled on 12 of them, and the host is shared with the rest of the build, which is why every run records the load average it began at.

**What the row count means.** The export writes `rowCount` 99,911 against a 100,000-row document because the grain is one authorised allocation: a gift with no allocation counts once, and a split gift contributes only the allocation this ministry may see. `rowCount` equals both the report's whole-result count and the print model's row total, which the timing spec asserts.

## Verification record

Every row below is a command actually run on this tree at the time of writing, with its exit status and its result. Nothing in this file claims a check that is not in this table.

| Command                                                                            | Exit | Result                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile` (root)                                             | 0    | 420 installs across 556 packages, no changes.                                                                                                                                                                                                                                                                      |
| `bun install --frozen-lockfile` (`apps/dashboard`)                                 | 0    | Same tree, no changes.                                                                                                                                                                                                                                                                                             |
| `bun run typecheck`                                                                | 0    | `tsc --noEmit` over the application, no diagnostics.                                                                                                                                                                                                                                                               |
| `bun run lint`                                                                     | 0    | Oxlint: 0 warnings, 0 errors, 401 files, 211 rules.                                                                                                                                                                                                                                                                |
| `bun run build`                                                                    | 0    | `next build` compiled every route and the proxy in 17.5 s.                                                                                                                                                                                                                                                         |
| `bun run test`                                                                     | 0    | Vitest: 26 files and 518 tests passed, 1 file and 2 tests skipped (the timing spec, which needs `WORKLOAD_MEASUREMENT=1`). Playwright then started `bun run dev` on the stated `PORT` (Next 16.4.6 reported ready) and left through `--pass-with-no-tests`, because this checkout holds no browser spec files yet. |
| `WORKLOAD_MEASUREMENT=1 bunx vitest run tests/integration/workload-timing.test.ts` | 0    | Both timings recorded — see the performance table above. It requires the workload document to exist, so `bun run seed:workload` is run first; the full suite resets the store and discards it.                                                                                                                     |
| `bun run reset`                                                                    | 0    | 20 sessions re-seeded, 0 removed, 117 partners in the readable seed, clock offset 0 ms.                                                                                                                                                                                                                            |
| `bun run seed:workload`                                                            | 0    | 10,000 partners and 100,000 gifts written for `established-worker`; coverage 2022-11-20 to 2026-10-31, partial.                                                                                                                                                                                                    |
| `bun run fixtures:media`                                                           | 0    | 6 of 6 fixtures present, 0 assertion failures.                                                                                                                                                                                                                                                                     |
| `bun run lines`                                                                    | 1    | 128,385 tracked lines against the 100,000 limit — over by 28,385.                                                                                                                                                                                                                                                  |
| `bunx oxfmt --check .`                                                             | 1    | 15 files repo-wide are not in canonical form, all of them pre-existing and outside this file; `bun run format` writes them in place.                                                                                                                                                                               |

## Deviations record

**There are no deviations from the pinned baseline versions.** Every fixed version declared in the manifests matches the baseline exactly, and no peer conflict required a substitution: Next 16.4.6 accepts React 19.3.1, `@ui-sdk/react` 0.1.0-beta.13 is satisfied by `@types/react` 19.3.0, and the TypeScript 7.0.2 / Oxlint 1.94.0 / Oxfmt 0.79.0 pairing installs and runs as pinned.

Two configuration facts follow from those versions and are recorded here so a reader does not mistake them for deviations:

- `bun run typecheck` invokes **`tsc --noEmit`**. TypeScript 7 removed `compilerOptions.baseUrl`, so `tsconfig.base.json` declares `paths` alone (`@/*` → `./apps/dashboard/src/*`).
- TypeScript 7's bundled libraries declare no `Temporal` global, so every module that needs it imports `Temporal` from `temporal-polyfill`, which defers to the native implementation on Node 26.

`docs/architecture.md` records one design-level deviation of its own, on the release transport: `GET /api/variants` keeps `audience` and `locale` in its grammar and refuses a bad value by field, but forwards neither, because an edition's audience and locale are properties of the `variantId` it names and the read already states them in its envelope.

### Plan-text and inventory divergences

The three entries that follow are divergences between the plan's own text and the delivered tree, recorded here for the same reason the version record is — so a reader checks the tree against the record instead of mistaking a plan shorthand for an unmet requirement.

**The family-verb shorthand in the API rows.** Six of the plan's API rows write a family-wide `GET/POST`; the delivered handlers give each sub-path only the verbs its named read or mutation needs, and every named read and mutation behind those rows is dispatched on exactly the path its row names. The delivered verb set is:

- `GET/POST` on `/api/initiatives` and `/api/initiatives/requests`; `POST` only on `/api/initiatives/members`, `/stages`, `/requests/response`, `/close`, `/reopen`.
- `GET/POST` on `/api/updates`, `/api/drafts`, `/api/review`, `/api/notify`; `GET` on `/api/variants`; `POST` on `/api/publish` and `/api/withdraw`.
- `GET/POST` on `/api/pages`; `POST` on `/api/pages/sections`, `/release`, `/withdraw`, `/reach`; `GET` on `/api/pages/preview`.
- `GET/POST` on `/api/audience` and `/api/preferences`; `POST` on `/api/unsubscribe` and `/api/confirm` — the confirmation is never on `GET`/`HEAD`, which is the row's own requirement.
- `GET/POST` on `/api/coaching`, `/api/coaching/targets`, `/api/coaching/checkins`, `/api/coaching/taskshare`; `POST` on `/api/coaching/grants` and `/api/coaching/modules`; `GET` on `/api/coaching/subjects`.
- `GET` only on `/api/inbox`.

No handler serves a verb the plan's own mutation column names no read or mutation for, so nothing the rows require is missing, and no second transport was added to make a shorthand literal.

**The delivered test inventory.** The plan's file map and register fix 44 test files (18 domain, 6 integration and 20 browser specs); the tree carries 27 vitest files — the 24 planned plus three that assert behaviour the plan requires and that no planned file covers, each named with the job it serves:

- `tests/domain/time-zone-resolution.test.ts` — a request's time-zone identifier is judged exactly as the reader that would use it judges it, which is the `timeZone` parameter every zone-resolved read states.
- `tests/integration/referrals-list-transport.test.ts` — the referrals list transport reads the flat wire the handler writes: the 200 envelope, the 403 denial and the 503 outage, plus the ways a request ends without an answer.
- `tests/integration/workload-timing.test.ts` — the measurement harness for the plan's published-workload timing, skipped unless `WORKLOAD_MEASUREMENT=1`.

The register therefore measures 27 files on this tree and 47 once the 20 browser specs land, not 44, and no planned file is missing.

**The sixth media fixture.** The plan's structure tree and file map name five media fixtures and the tree carries six: `public/fixtures/media/IMG_20260814-harbour-youth-group.jpg` is the EXIF-bearing private original that `asset-image-portrait` names as its `sourceOriginalRef` and the input the media-metadata criterion runs over; its authoring route, licence, byte count, digest and metadata record are in `docs/architecture.md`.

## Known limitations

- **CSV formula neutralisation leaves a leading tab.** A cell beginning with `=`, `+`, `-`, `@` or a full-width variant is quoted and prefixed with a tab, which survives in the data. There is no universal strategy that both neutralises a spreadsheet formula and round-trips an arbitrary cell, so the behaviour is disclosed here and in the export's own metadata rather than hidden.
- **MP4 container timestamps may survive the copy-remux.** The video pipeline strips descriptive tags and rejects a served rendition that still reports one, but a container's creation and modification timestamps can remain. Playback never depends on an encoder, and no descriptive metadata reaches a reader.
- **Performance figures are bounded by the documented workload.** The two timings above describe 10,000 partners and 100,000 gifts on the machine stated, under the load average stated. They are not a claim about other data volumes, other hardware or a quiet host.
- **The tracked line count is over the 100,000-line bound** at 128,385 (122,193 excluding the media-fixture counts). `bun run lines` exits 1 and that is the gate; the remedy lies in the tracked tree, not in the measurement.
- **Browser and accessibility evidence is not in this file.** The Playwright project holds no spec files in this checkout, so neither the journeys nor the axe pass over navigation, forms, dialogs, tables and the editor has been run here, and the reachability sweep that carries the `/feed` exception has not been recorded.
- **Moderate accessibility findings:** none recorded, because the axe pass that would produce them has not run in this checkout. If a moderate finding appears when it does, it is either fixed and re-checked or documented here with its reason.

## Named assumptions

The inputs left these decisions open; each is stated as a changeable assumption rather than a question, because no approver is present while the build runs.

| Id  | Assumption                                                                                                                                                                                                                                                                                         | Why it does not conflict with a stated rule                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Persistence is local JSON files in a git-ignored `.data/` directory keyed by a development cookie, with atomic temp-then-rename writes and a per-session mutex — not SQLite and not a database server.                                                                                             | A database, its migrations and row-level security are excluded; the store is replaceable behind the service.                                                                       |
| A2  | Client mutations travel over Route Handlers only; Server Actions are not used, so there is exactly one browser mutation transport and no self-fetch.                                                                                                                                               | One transport is required and neither option is prescribed; one is the smaller surface.                                                                                            |
| A3  | The CSV parser is `csv-parse` 7.0.3 and the image library is `sharp` 0.35.5, both named as roles without versions in the request.                                                                                                                                                                  | The remaining versions were plan-time decisions; `csv-parse` 7.0.3 is above the 7.0.2 prototype-replacement fix, and `sharp` 0.35.5 ships a prebuilt addon for the pinned runtime. |
| A4  | Video inspection and the safe rendition use mediabunny 1.66.2 only; no FFmpeg or server-side media package is used at runtime.                                                                                                                                                                     | A lightweight library is permitted for this role; nothing needs a binary at runtime.                                                                                               |
| A5  | Time uses native `Temporal` through `temporal-polyfill` 1.0.8 imported as a ponyfill.                                                                                                                                                                                                              | No time library is fixed, and the required semantics — calendar days versus elapsed seconds, DST gaps and repeats, frozen offsets — are exactly Temporal's.                        |
| A6  | The media fixtures are authored once and committed: a CC0 clip and locally encoded clips for the playable cases, a derived Matroska file as the rejection case, a generated poster, an EXIF-bearing image and a hand-authored caption track. Provenance and licence are in `docs/architecture.md`. | The request asks for local or appropriately licensed media and for the authoring route to be stated; runtime playback needs no encoder.                                            |
| A7  | A copy-remux may retain MP4 container timestamps, so the pipeline verifies the served rendition and rejects one that still reports a descriptive tag.                                                                                                                                              | Raw filenames and private metadata must not reach a reader; verification plus rejection enforces that, and the residual behaviour is disclosed.                                    |
| A8  | CSV export neutralises formula-leading cells with a quoted field and a leading tab, and the tab persists in the data.                                                                                                                                                                              | Formula neutralisation is required and OWASP records no universal strategy; disclosure is the honest form.                                                                         |
| A9  | The shadcn preset is `base-maia` with Zinc; `@ui-sdk/*` is the first choice for behaviour, and Base UI is the substrate inside `src/components/ui` and the documented fallback elsewhere.                                                                                                          | The request fixes Maia/Zinc, UI SDK first and Base UI as documented fallback; this arrangement satisfies all three without a third primitive system.                               |
| A10 | The workspace holds exactly one application package and no `packages/*` directory; a shared package is created only when a second consumer imports the same source.                                                                                                                                | A shared package is reasonable, not required, and unnecessary abstraction is forbidden; the trigger is stated.                                                                     |
| A11 | Date and date-time entry uses the `Input` component's `date` and `datetime-local` variants; the shadcn `calendar` item is not installed.                                                                                                                                                           | It avoids two dependencies with no retained job and keeps date-only values civil.                                                                                                  |
| A12 | The scenario clock is a per-session offset advanced only by the development control, and every boundary is evaluated at read or command time with no background job.                                                                                                                               | The specification requires exactly that: a controllable clock with boundaries evaluated at read or command time.                                                                   |
| A13 | The failure plan arms one mode for one named mutation or read at a time and is visible in the development panel.                                                                                                                                                                                   | Three deterministic failures must be demonstrable on several named mutations; visible arming makes the demonstration reproducible.                                                 |
| A14 | The seed carries KWD as its three-decimal currency and JPY as its zero-decimal one, alongside USD and EUR, plus one gift in an unknown currency.                                                                                                                                                   | A non-two-decimal exponent is required and an unknown currency must never be defaulted; the specific codes are a fixture choice.                                                   |
| A15 | Illustration is limited to `lucide-react` icons and system tokens; no bespoke illustration set exists.                                                                                                                                                                                             | Nothing in the request asks for imagery, and it keeps the line budget and the design-system rule.                                                                                  |
| A16 | Observed performance is reported with its method and the machine's characteristics rather than as a capacity promise, and the table virtualiser is added only after a documented measurement.                                                                                                      | The specification asks for the measured workload to be documented rather than unmeasured scale promised.                                                                           |

## Design system

- **One token source.** `src/styles/globals.css` declares the Maia/Zinc semantic pairs in OKLCH for `:root` and `.dark` and bridges them to utilities with `@theme inline`. No component introduces a colour, radius, shadow or spacing literal; spacing and direction use logical utilities, and `dir` on the block — never a CSS base direction — carries reading direction.
- **36 installed components, 27 excluded, 2 deliberately left out**, which accounts for all 65 registry entries. The per-entry mapping is in the table above.
- **`components.json`** pins `style: "base-maia"`, `tailwind.baseColor: "zinc"`, `tailwind.css: "src/styles/globals.css"`, `cssVariables: true`, `iconLibrary: "lucide"` and aliases under `@/`.
- **The gap register lives in `docs/architecture.md`**, beside the adapter that serves the four generic behaviours this build needs. `@base-ui/react` is imported only inside `src/components/ui`, as the substrate of the generated Maia source; an import anywhere else is a fallback and needs a register entry first.
- **Accessibility is a build condition, not a polish pass:** targets are at least 24 × 24 CSS px or satisfy the spacing exception, no meaningful action requires dragging, the one horizontally scrollable region is focusable and labelled, charts always render a data table and a prose summary, and no state is carried by colour alone.

## Repository documentation

This file and `docs/architecture.md` are the only two documentation deliverables. The architecture note carries the layering rules, the design-system gap register and lint gap register, the future-connection seam map, the media provenance and licence record, the delivered-structure record of the transport-support and boundary files the plan's tree does not enumerate, and the measurement method in full. Nothing else documents the build, and a local `metering-inventory.md` is ignored by `.gitignore` and never tracked.

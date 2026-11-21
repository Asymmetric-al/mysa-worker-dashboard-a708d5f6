# mysa-worker-dashboard-a708d5f6

Created by Blitzy

## Measured outcomes

- **Tracked line count.** `bun run lines` runs the request's command verbatim, `git ls-files | grep -v -e '^bun.lock$' | xargs wc -l`, and prints the measured total: **98,537** tracked lines against the 100,000 limit — `STATUS PASS`, exit 0 (92,345 excluding the six binary media fixtures, which the request excludes from the count).
- **Published workload.** The 10,000-partner / 100,000-gift workload (`bun run seed:workload`) is measured with its method, sample size, machine characteristics and both results — the filtered Gifts p95 and the whole-query CSV export duration — in `docs/architecture.md` under _Measured workload and performance_, which `WORKLOAD_MEASUREMENT=1 bunx vitest run tests/integration/workload-timing.test.ts` reproduces from `apps/dashboard`.

"use client";
/** Shared browser read helper for searching and paging eligible shared partner records through `/api/partners?job=roster&facet=preparation-state:shared` without cross-feature imports. */
import { useCallback, useEffect, useRef, useState } from "react";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import { sameScope, type Scope } from "@/modules/data-service/envelope";
import type { UnavailableOutcome } from "@/modules/data-service/outcome";

export type SharedPartnerOption = {
  readonly partnerId: string;
  readonly displayName: string;
};

export type SharedPartnerSearchState = {
  readonly items: readonly SharedPartnerOption[];
  readonly total: number | null;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: { readonly message: string; readonly source?: UnavailableOutcome["source"] } | null;
  readonly loadMore: () => void;
  readonly retry: () => void;
};

const PARTNERS_ENDPOINT = "/api/partners";
const SHARED_FACET_ID = "preparation-state";
const SHARED_FACET_VALUE = "shared";
const SHARED_FACET_EXPR = `${SHARED_FACET_ID}:${SHARED_FACET_VALUE}`;
const DEFAULT_PAGE_SIZE = 50;
const DEBOUNCE_MS = 180;

type ParsedPage = {
  readonly items: readonly SharedPartnerOption[];
  readonly total: number;
  readonly rawCount: number;
};

function isRosterPayload(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value["rows"]) && typeof value["total"] === "number" && Number.isFinite(value["total"]);
}

function classFilterUnapplied(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => isRecord(entry) && entry["facet"] === SHARED_FACET_ID);
}

function parseSharedPage(data: Record<string, unknown>): ParsedPage {
  const rows = Array.isArray(data["rows"]) ? data["rows"] : [];
  const total = typeof data["total"] === "number" && Number.isFinite(data["total"]) ? data["total"] : 0;
  const classApplied = !classFilterUnapplied(data["unappliedFacets"]);
  const items: SharedPartnerOption[] = [];
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row["partner"])) continue;
    const partner = row["partner"];
    const partnerId = partner["partnerId"];
    const displayName = partner["displayName"];
    const audience = partner["audience"];
    if (typeof partnerId !== "string" || partnerId.trim() === "") continue;
    if (typeof displayName !== "string" || displayName.trim() === "") continue;
    if (audience !== SHARED_FACET_VALUE) continue;
    items.push({ partnerId, displayName });
  }
  return { items, total: classApplied ? total : items.length, rawCount: rows.length };
}

function buildSharedPartnersUrl(search: string, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  params.set("job", "roster");
  params.append("facet", SHARED_FACET_EXPR);
  const trimmed = search.trim();
  if (trimmed !== "") params.set("search", trimmed);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `${PARTNERS_ENDPOINT}?${params.toString()}`;
}

function mergeDistinct(existing: readonly SharedPartnerOption[], incoming: readonly SharedPartnerOption[]): readonly SharedPartnerOption[] {
  const seen = new Set(existing.map((entry) => entry.partnerId));
  const merged = [...existing];
  for (const entry of incoming) {
    if (seen.has(entry.partnerId)) continue;
    seen.add(entry.partnerId);
    merged.push(entry);
  }
  return merged;
}

export function useSharedPartnerSearch(input: {
  readonly scope: Scope;
  readonly search: string;
  readonly enabled: boolean;
  readonly initialItems?: readonly SharedPartnerOption[];
  readonly initialTotal?: number;
  readonly pageSize?: number;
}): SharedPartnerSearchState {
  const { scope, search, enabled, initialItems = [], initialTotal, pageSize = DEFAULT_PAGE_SIZE } = input;
  const [settledSearch, setSettledSearch] = useState(search);
  const [items, setItems] = useState<readonly SharedPartnerOption[]>(initialItems);
  const [total, setTotal] = useState<number | null>(initialTotal ?? null);
  const [nextPage, setNextPage] = useState(initialItems.length === 0 ? 0 : Math.max(1, Math.floor(initialItems.length / pageSize)));
  const [loadedRawCount, setLoadedRawCount] = useState(initialItems.length);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ readonly message: string; readonly source?: UnavailableOutcome["source"] } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeq = useRef(0);
  const hasUsedServer = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    async (term: string, pageIndex: number, append: boolean): Promise<void> => {
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await fetchRead<Record<string, unknown>>({ url: buildSharedPartnersUrl(term, pageIndex, pageSize), admits: isRosterPayload });
        if (requestSeq.current !== seq) return;
        if (result.kind === "envelope") {
          if (!sameScope(result.envelope.scope, scope)) {
            setError({ message: "Results came from a different ministry. Reload and try again." });
            return;
          }
          const parsed = parseSharedPage(result.envelope.data);
          hasUsedServer.current = true;
          setItems((current) => (append ? mergeDistinct(current, parsed.items) : parsed.items));
          setTotal(parsed.total);
          setLoadedRawCount((current) => (append ? current + parsed.rawCount : parsed.rawCount));
          setNextPage(pageIndex + 1);
          return;
        }
        if (result.kind === "unavailable") {
          setError({ message: result.unavailable.guidance, source: result.unavailable.source });
          return;
        }
        if (result.kind === "denied") {
          setError({ message: "Your session doesn’t have permission to search shared partners here." });
          return;
        }
        setError({ message: "Couldn’t run that partner search. Try a shorter search term." });
      } catch {
        if (requestSeq.current !== seq) return;
        setError({ message: "Couldn’t reach the partner service right now. Try again in a moment." });
      } finally {
        if (requestSeq.current === seq) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [pageSize, scope],
  );

  useEffect(() => {
    if (!enabled) return;
    const trimmed = settledSearch.trim();
    // When search is empty and we have seeded initial items (and haven't yet replaced them or asked to reload), keep the server-rendered initial page.
    if (trimmed === "" && reloadToken === 0 && !hasUsedServer.current && initialItems.length > 0) return;
    void fetchPage(trimmed, 0, false);
  }, [enabled, settledSearch, reloadToken, fetchPage, initialItems.length]);

  const loadMore = useCallback((): void => {
    if (!enabled || loading || loadingMore) return;
    if (total !== null && loadedRawCount >= total) return;
    void fetchPage(settledSearch.trim(), nextPage, true);
  }, [enabled, loading, loadingMore, total, loadedRawCount, fetchPage, settledSearch, nextPage]);

  const retry = useCallback((): void => {
    setReloadToken((count) => count + 1);
  }, []);

  const hasMore = total !== null && loadedRawCount < total;
  return { items, total, hasMore, loading, loadingMore, error, loadMore, retry };
}

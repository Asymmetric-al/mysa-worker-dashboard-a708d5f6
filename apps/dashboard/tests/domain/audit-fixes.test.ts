/** Regression tests for the confirmed bugs, streaming byte bounds, whole-query print grammar, bidi controls, and UI domain helpers fixed during the workspace review. */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as postDrafts } from "@/app/api/drafts/route";
import { POST as postWithdraw } from "@/app/api/withdraw/route";
import { reportRequestSchema, supportQueryOf } from "@/app/api/support/query";
import { mergeRosterQuery, type RosterQueryState } from "@/features/partners/query/roster-query";
import { INTERACTION_KINDS, INTERACTION_KIND_LABELS, interactionKindLabel } from "@/features/partners/schemas/interaction";
import { admittedPasteDecision, CONTENT_PROFILE_VERSION, parseDocument } from "@/modules/content/document";
import { printModel, WHOLE_QUERY_PRINT_MAX_ROWS } from "@/modules/export/print";
import { mediaStateReason } from "@/modules/media/profile";
import { DEFAULT_SESSION_ID, seed } from "@/modules/dev-runtime/seed";
import { buildReportQuery, runReport } from "@/modules/support/report";
import { Temporal } from "temporal-polyfill";
import { firstWhere } from "../helpers/answers";

function chunkedOverflowRequest(url: string, chunkBytes: number, maxChunks: number): { readonly request: NextRequest; readonly stats: { pulls: number; cancelled: boolean } } {
  const stats = { pulls: 0, cancelled: false };
  const chunk = new Uint8Array(chunkBytes);
  chunk.fill(0x61); // 'a'
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stats.pulls >= maxChunks) {
        controller.close();
        return;
      }
      stats.pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  const request = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  return { request, stats };
}

describe("Streaming request byte bounds on /api/withdraw and /api/drafts", () => {
  it("cancels chunked oversized streams on POST /api/withdraw without content-length", async () => {
    const { request, stats } = chunkedOverflowRequest("http://localhost:3000/api/withdraw", 8_192, 50);
    const response = await postWithdraw(request, undefined);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { outcome?: string; fields?: Record<string, string[]> };
    expect(body.outcome).toBe("invalid");
    expect(body.fields?.body?.[0]).toMatch(/at most 16384 bytes/u);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulls).toBeLessThanOrEqual(3);
  });

  it("cancels chunked oversized streams on POST /api/drafts without content-length", async () => {
    const { request, stats } = chunkedOverflowRequest("http://localhost:3000/api/drafts", 262_144, 50);
    const response = await postDrafts(request, undefined);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { outcome?: string; fields?: Record<string, string[]> };
    expect(body.outcome).toBe("invalid");
    const messages = Object.values(body.fields ?? {}).flat().join(" ");
    expect(messages).toMatch(/1048576 bytes/u);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulls).toBeLessThanOrEqual(5);
  });

  it("refuses non-JSON content-type on /api/withdraw and /api/drafts before reading body chunks", async () => {
    const makePlain = (url: string): NextRequest =>
      new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      });
    const withdrawReq = makePlain("http://localhost:3000/api/withdraw");
    const draftsReq = makePlain("http://localhost:3000/api/drafts");
    const withdrawRes = await postWithdraw(withdrawReq, undefined);
    const draftsRes = await postDrafts(draftsReq, undefined);
    expect(withdrawRes.status).toBe(422);
    expect(draftsRes.status).toBe(422);
    expect(withdrawReq.bodyUsed).toBe(false);
    expect(draftsReq.bodyUsed).toBe(false);
  });
});

describe("Content bidi control guard (including U+061C Arabic Letter Mark)", () => {
  it("rejects all Unicode bidi controls on parseDocument and strips them on paste", () => {
    const controls = ["\u061C", "\u200E", "\u200F", "\u202E", "\u2066"] as const;
    for (const control of controls) {
      const parsed = parseDocument({
        type: "doc",
        profileVersion: CONTENT_PROFILE_VERSION,
        direction: "rtl",
        content: [{ type: "paragraph", content: [{ type: "text", text: `مرحبا${control}بالعالم` }] }],
        sections: [],
      });
      expect(parsed.status).toBe("invalid");
      const issues = parsed.status === "invalid" ? parsed.issues : [];
      expect(issues.some((issue) => issue.message.includes("bidi control character"))).toBe(true);

      const plain = admittedPasteDecision("plain-text", { text: `Hello${control}world` });
      expect(plain.status).toBe("plain-text");
      expect(plain.status === "plain-text" ? plain.content.text : "").toBe("Helloworld");
    }
  });
});

describe("Partner interaction kind labels", () => {
  it("maps every canonical interaction kind enum to its human label and preserves seeded free-text kinds", () => {
    for (const kind of INTERACTION_KINDS) {
      expect(interactionKindLabel(kind)).toBe(INTERACTION_KIND_LABELS[kind]);
    }
    expect(interactionKindLabel("call")).toBe("Phone call");
    expect(interactionKindLabel("written-exchange")).toBe("Written message");
    expect(interactionKindLabel("Coffee catch-up")).toBe("Coffee catch-up");
  });
});

describe("Whole-query report print contract", () => {
  it("accepts wholeQuery without page and refuses wholeQuery combined with page", () => {
    const accepted = reportRequestSchema.safeParse({
      query: { reportId: "received-period-and-year-to-date", wholeQuery: true },
    });
    expect(accepted.success).toBe(true);
    expect(accepted.success ? supportQueryOf(accepted.data.query).wholeQuery : undefined).toBe(true);

    const combined = reportRequestSchema.safeParse({
      query: { reportId: "received-period-and-year-to-date", wholeQuery: true, page: { index: 0, size: 50 } },
    });
    expect(combined.success).toBe(false);
    expect(WHOLE_QUERY_PRINT_MAX_ROWS).toBe(2_000);
  });

  it("marks printModel completeness as whole-query when unpaged and page-only when paged", async () => {
    const state = firstWhere(await seed(), "sessionId", DEFAULT_SESSION_ID, "established seed").documents.state;
    const projection = state.supportProjection;
    if (projection === null) throw new Error("Expected seeded support projection");
    const scope = {
      organizationId: state.context.selectedOrganizationId ?? "",
      ministryId: state.context.selectedMinistryId ?? "",
      supportSubjectId: state.context.selectedSupportSubjectId ?? "",
      principalId: state.context.principalId,
    };
    const domainProjection = {
      supportSubjectId: projection.supportSubjectId,
      basis: projection.basis,
      coverage: projection.coverage,
      currencyExponents: projection.currencyExponents,
      source: projection.source,
      asOf: projection.asOf,
      lastSourceUpdate: projection.lastSourceUpdate,
      commitments: [],
      gifts: state.gifts.map((record) => ({
        giftRowId: record.giftRowId,
        giftId: record.giftId,
        ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
        amount: record.amount,
        ...(record.originalGiftOn === null ? {} : { originalGiftOn: Temporal.PlainDate.from(record.originalGiftOn) }),
        datePrecision: record.datePrecision,
        ...(record.designation === null ? {} : { designation: record.designation }),
        attribution: record.attribution,
        ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
        provenance: record.provenance,
        entryOn: Temporal.PlainDate.from(record.entryOn),
      })),
    };
    const unpagedQuery = buildReportQuery({
      reportId: "received-period-and-year-to-date",
      scope,
      period: { kind: "explicit", from: Temporal.PlainDate.from("2026-01-01"), to: Temporal.PlainDate.from("2026-12-31") },
      currency: { kind: "all" },
    });
    if (!unpagedQuery.ok) throw new Error("Expected valid unpaged query");
    const unpagedResult = runReport(unpagedQuery.query, domainProjection);
    expect(unpagedResult.total).toBeGreaterThan(1);
    expect(printModel(unpagedResult, { locale: "en-GB" }).completeness).toBe("whole-query");

    const pagedQuery = buildReportQuery({
      reportId: "received-period-and-year-to-date",
      scope,
      period: { kind: "explicit", from: Temporal.PlainDate.from("2026-01-01"), to: Temporal.PlainDate.from("2026-12-31") },
      currency: { kind: "all" },
      page: { index: 0, size: 1 },
    });
    if (!pagedQuery.ok) throw new Error("Expected valid paged query");
    const pagedResult = runReport(pagedQuery.query, domainProjection);
    expect(printModel(pagedResult, { locale: "en-GB" }).completeness).toBe("page-only");
  });
});

describe("Roster query clearing and media picker selected state", () => {
  it("clears both search and facets atomically and resets page to 1", () => {
    const filtered: RosterQueryState = {
      search: "Marcus",
      facets: { "contact-type": ["person"] },
      sort: null,
      page: 3,
      pageSize: 50,
      columnVisibility: {},
      currency: null,
      period: null,
      timeZone: null,
    };
    const cleared = mergeRosterQuery(filtered, { search: "", facets: {} });
    expect(cleared.search).toBe("");
    expect(cleared.facets).toEqual({});
    expect(cleared.page).toBe(1);
  });

  it("declares canonical wording for the media picker selected preparation state", () => {
    const reason = mediaStateReason("selected");
    expect(reason.label).toContain("Selected");
  });
});

/** Pure, framework-free route breadcrumb builder for `AppShell` covering all 45 application routes. */

export type ShellBreadcrumbItem = {
  readonly label: string;
  readonly href?: string;
};

type StaticTrail = readonly ShellBreadcrumbItem[];

const EXACT_TRAILS: Readonly<Record<string, StaticTrail>> = {
  "/partners/import": [{ label: "Partners", href: "/partners" }, { label: "Import contacts" }],
  "/partners/initiatives": [{ label: "Partners", href: "/partners" }, { label: "Initiatives" }],
  "/partners/referrals": [{ label: "Partners", href: "/partners" }, { label: "Referrals" }],
  "/work/agenda": [{ label: "Tasks", href: "/work" }, { label: "Agenda" }],
  "/support/gifts": [{ label: "Support", href: "/support" }, { label: "Gifts" }],
  "/support/commitments": [{ label: "Support", href: "/support" }, { label: "Commitments" }],
  "/communication/audience": [{ label: "Updates", href: "/communication" }, { label: "Email audience" }],
  "/communication/delivery": [{ label: "Updates", href: "/communication" }, { label: "Send history" }],
  "/communication/inbox": [{ label: "Updates", href: "/communication" }, { label: "Test inbox" }],
  "/preview": [{ label: "Updates", href: "/communication" }, { label: "Reader preview" }],
  "/preview/pages": [{ label: "Updates", href: "/communication" }, { label: "Public pages" }],
  "/preview/preferences": [{ label: "Updates", href: "/communication" }, { label: "Reader preferences" }],
  "/coaching/targets": [{ label: "Coaching", href: "/coaching" }, { label: "Targets" }],
  "/coaching/check-ins": [{ label: "Coaching", href: "/coaching" }, { label: "Check-ins" }],
  "/coaching/sharing": [{ label: "Coaching", href: "/coaching" }, { label: "Sharing" }],
  "/coaching/coach": [{ label: "Coaching", href: "/coaching" }, { label: "Coach view" }],
};

function normalisePathname(rawPath: string): string {
  const withoutQuery = rawPath.split(/[?#]/)[0]?.trim() ?? "";
  if (withoutQuery === "" || withoutQuery === "/") return "/";
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const trimmed = prefixed.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Returns a concise hierarchical breadcrumb trail for nested routes, or an empty array on top-level
 * primary destinations (`/`, `/partners`, `/work`, `/support`, `/communication`, `/pages`, `/coaching`, `/settings`, `/help`)
 * where the active sidebar entry and `<h1>` already anchor the page cleanly.
 */
export function buildRouteBreadcrumbs(rawPath: string): readonly ShellBreadcrumbItem[] {
  const path = normalisePathname(rawPath);
  const exact = EXACT_TRAILS[path];
  if (exact !== undefined) return exact;

  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const [root, second, third, fourth] = segments;

  if (root === "partners") {
    if (second === "initiatives" && third !== undefined) {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Initiatives", href: "/partners/initiatives" },
        { label: "Initiative details" },
      ];
    }
    if (second === "referrals" && third !== undefined) {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Referrals", href: "/partners/referrals" },
        { label: "Referral details" },
      ];
    }
    if (second !== undefined && third === "edit") {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Partner profile", href: `/partners/${encodeURIComponent(second)}` },
        { label: "Edit contact" },
      ];
    }
    if (second !== undefined && third === "interactions" && fourth === "new") {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Partner profile", href: `/partners/${encodeURIComponent(second)}` },
        { label: "Log activity" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Partners", href: "/partners" }, { label: "Partner profile" }];
    }
  }

  if (root === "work" && second === "series" && third !== undefined) {
    return [{ label: "Tasks", href: "/work" }, { label: "Repeating plan" }];
  }

  if (root === "support") {
    if (second === "gifts" && third !== undefined) {
      return [
        { label: "Support", href: "/support" },
        { label: "Gifts", href: "/support/gifts" },
        { label: "Gift details" },
      ];
    }
    if (second === "commitments" && third !== undefined) {
      return [
        { label: "Support", href: "/support" },
        { label: "Commitments", href: "/support/commitments" },
        { label: "Commitment details" },
      ];
    }
    if (second === "reports" && third !== undefined) {
      return [{ label: "Support", href: "/support" }, { label: "Report" }];
    }
  }

  if (root === "communication") {
    if (second === "review" && third !== undefined) {
      return [{ label: "Updates", href: "/communication" }, { label: "Review update" }];
    }
    if (second !== undefined && third !== undefined && fourth === "preview") {
      return [
        { label: "Updates", href: "/communication" },
        { label: "Update", href: `/communication/${encodeURIComponent(second)}` },
        { label: "Edition preview" },
      ];
    }
    if (second !== undefined && third !== undefined) {
      return [
        { label: "Updates", href: "/communication" },
        { label: "Update", href: `/communication/${encodeURIComponent(second)}` },
        { label: "Edit edition" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Updates", href: "/communication" }, { label: "Update" }];
    }
  }

  if (root === "pages") {
    if (second === "review" && third !== undefined) {
      return [{ label: "Ministry pages", href: "/pages" }, { label: "Page review" }];
    }
    if (second !== undefined && third !== undefined && fourth === "preview") {
      return [
        { label: "Ministry pages", href: "/pages" },
        { label: "Page builder", href: `/pages/${encodeURIComponent(second)}` },
        { label: "Preview" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Ministry pages", href: "/pages" }, { label: "Page builder" }];
    }
  }

  if (root === "coaching" && second === "coach" && third !== undefined) {
    return [
      { label: "Coaching", href: "/coaching" },
      { label: "Coach view", href: "/coaching/coach" },
      { label: "Shared workspace" },
    ];
  }

  if (root === "preview") {
    if (second === "pages" && third !== undefined) {
      return [
        { label: "Updates", href: "/communication" },
        { label: "Public pages", href: "/preview/pages" },
        { label: "Public page" },
      ];
    }
    if (second !== undefined) {
      return [
        { label: "Updates", href: "/communication" },
        { label: "Reader preview", href: "/preview" },
        { label: "Published update" },
      ];
    }
  }

  return [];
}

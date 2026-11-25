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
  "/work/agenda": [{ label: "Work", href: "/work" }, { label: "Agenda" }],
  "/support/gifts": [{ label: "Support", href: "/support" }, { label: "Gifts" }],
  "/support/commitments": [{ label: "Support", href: "/support" }, { label: "Commitments" }],
  "/communication/audience": [{ label: "Communication", href: "/communication" }, { label: "Audience" }],
  "/communication/delivery": [{ label: "Communication", href: "/communication" }, { label: "Delivery" }],
  "/communication/inbox": [{ label: "Communication", href: "/communication" }, { label: "Inbox" }],
  "/preview": [{ label: "Communication", href: "/communication" }, { label: "Receiving preview" }],
  "/preview/pages": [{ label: "Communication", href: "/communication" }, { label: "Published pages" }],
  "/preview/preferences": [{ label: "Communication", href: "/communication" }, { label: "Your preferences" }],
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
        { label: "Initiative detail" },
      ];
    }
    if (second === "referrals" && third !== undefined) {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Referrals", href: "/partners/referrals" },
        { label: "Referral detail" },
      ];
    }
    if (second !== undefined && third === "edit") {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Partner record", href: `/partners/${encodeURIComponent(second)}` },
        { label: "Edit contact" },
      ];
    }
    if (second !== undefined && third === "interactions" && fourth === "new") {
      return [
        { label: "Partners", href: "/partners" },
        { label: "Partner record", href: `/partners/${encodeURIComponent(second)}` },
        { label: "Log interaction" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Partners", href: "/partners" }, { label: "Partner record" }];
    }
  }

  if (root === "work" && second === "series" && third !== undefined) {
    return [{ label: "Work", href: "/work" }, { label: "Repeating series" }];
  }

  if (root === "support") {
    if (second === "gifts" && third !== undefined) {
      return [
        { label: "Support", href: "/support" },
        { label: "Gifts", href: "/support/gifts" },
        { label: "Gift detail" },
      ];
    }
    if (second === "commitments" && third !== undefined) {
      return [
        { label: "Support", href: "/support" },
        { label: "Commitments", href: "/support/commitments" },
        { label: "Commitment detail" },
      ];
    }
    if (second === "reports" && third !== undefined) {
      return [{ label: "Support", href: "/support" }, { label: "Report" }];
    }
  }

  if (root === "communication") {
    if (second === "review" && third !== undefined) {
      return [{ label: "Communication", href: "/communication" }, { label: "Review candidate" }];
    }
    if (second !== undefined && third !== undefined && fourth === "preview") {
      return [
        { label: "Communication", href: "/communication" },
        { label: "Update", href: `/communication/${encodeURIComponent(second)}` },
        { label: "Edition preview" },
      ];
    }
    if (second !== undefined && third !== undefined) {
      return [
        { label: "Communication", href: "/communication" },
        { label: "Update", href: `/communication/${encodeURIComponent(second)}` },
        { label: "Edition editor" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Communication", href: "/communication" }, { label: "Update" }];
    }
  }

  if (root === "pages") {
    if (second === "review" && third !== undefined) {
      return [{ label: "Pages", href: "/pages" }, { label: "Page review" }];
    }
    if (second !== undefined && third !== undefined && fourth === "preview") {
      return [
        { label: "Pages", href: "/pages" },
        { label: "Page builder", href: `/pages/${encodeURIComponent(second)}` },
        { label: "Preview" },
      ];
    }
    if (second !== undefined) {
      return [{ label: "Pages", href: "/pages" }, { label: "Page builder" }];
    }
  }

  if (root === "coaching" && second === "coach" && third !== undefined) {
    return [
      { label: "Coaching", href: "/coaching" },
      { label: "Coach view", href: "/coaching/coach" },
      { label: "Shared subject" },
    ];
  }

  if (root === "preview") {
    if (second === "pages" && third !== undefined) {
      return [
        { label: "Communication", href: "/communication" },
        { label: "Published pages", href: "/preview/pages" },
        { label: "Public reading" },
      ];
    }
    if (second !== undefined) {
      return [
        { label: "Communication", href: "/communication" },
        { label: "Receiving preview", href: "/preview" },
        { label: "Published update" },
      ];
    }
  }

  return [];
}

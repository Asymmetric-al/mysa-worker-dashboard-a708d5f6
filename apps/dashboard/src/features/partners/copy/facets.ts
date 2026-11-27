export const FACET_KEYS = ["contact-type", "preparation-state", "tag", "favourite", "relationship-label", "initiative-membership", "referral-status", "contact-method-availability", "geography", "recent-activity", "task-state", "last-received-gift-date", "giving-total", "commitment-status"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export const FACET_LABELS: Readonly<Record<FacetKey, string>> = {
  "contact-type": "Type",
  "preparation-state": "Visibility",
  tag: "Tag",
  favourite: "Favourite",
  "relationship-label": "Relationship",
  "initiative-membership": "Initiative",
  "referral-status": "Referral status",
  "contact-method-availability": "Contact details",
  geography: "Location",
  "recent-activity": "Recent activity",
  "task-state": "Tasks",
  "last-received-gift-date": "Last gift",
  "giving-total": "Giving in period",
  "commitment-status": "Recurring commitment",
};
export const FACET_VALUE_LABELS: Readonly<Record<FacetKey, Readonly<Partial<Record<string, string>>>>> = {
  "contact-type": { person: "Person", household: "Household", church: "Church", organization: "Organization", "private-preparation": "Private contact" },
  "preparation-state": { private: "Private contact", shared: "Shared", archived: "Archived" },
  tag: {},
  favourite: { favourite: "Favourites only", "not-favourite": "Not a favourite" },
  "relationship-label": {},
  "initiative-membership": {},
  "referral-status": { active: "Active", "incomplete-date": "Date incomplete", expired: "Expired" },
  "contact-method-availability": { "any-permitted": "Has permitted contact", "none-permitted": "No permitted contact" },
  geography: {},
  "recent-activity": { recorded: "Has activity", "none-recorded": "No activity yet" },
  "task-state": { open: "Open task", overdue: "Overdue task", "no-date": "Undated task" },
  "last-received-gift-date": {},
  "giving-total": {},
  "commitment-status": {},
};
export const FACET_GROUPING_COPY = { acrossFacets: "All selected filters must match.", withinFacet: "Within one filter, any checked option matches.", activeFilters: "Active filters", clearAll: "Clear all", removeFilter: "Remove filter", clearFacet: "Clear filter" } as const satisfies Record<
  "acrossFacets" | "withinFacet" | "activeFilters" | "clearAll" | "removeFilter" | "clearFacet",
  string
>;
export const PERMISSION_FACTS = ["contactability", "communicationConsent", "protectedReaderGrant"] as const;
export type PermissionFactKey = (typeof PERMISSION_FACTS)[number];
export const PERMISSION_FACT_COPY: Readonly<Record<PermissionFactKey, { readonly label: string; readonly explanation: string; readonly whenAbsent: string }>> = {
  contactability: { label: "Contact details", explanation: "Contact methods you’re permitted to use to reach this partner.", whenAbsent: "No permitted contact details on file." },
  communicationConsent: { label: "Email update consent", explanation: "Consent applies only to one ministry and purpose, and doesn’t carry over automatically.", whenAbsent: "No email consent recorded for this ministry." },
  protectedReaderGrant: { label: "Protected update access", explanation: "Grants access to protected updates only, and nothing else.", whenAbsent: "No protected-reader access recorded." },
};

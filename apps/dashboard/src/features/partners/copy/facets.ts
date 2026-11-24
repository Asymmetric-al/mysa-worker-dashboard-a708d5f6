export const FACET_KEYS = ["contact-type", "preparation-state", "tag", "favourite", "relationship-label", "initiative-membership", "referral-status", "contact-method-availability", "geography", "recent-activity", "task-state", "last-received-gift-date", "giving-total", "commitment-status"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export const FACET_LABELS: Readonly<Record<FacetKey, string>> = {
  "contact-type": "Contact type",
  "preparation-state": "Private or shared",
  tag: "Tag",
  favourite: "Favourite",
  "relationship-label": "Relationship",
  "initiative-membership": "Initiative",
  "referral-status": "Referral status",
  "contact-method-availability": "Contact methods",
  geography: "Geography",
  "recent-activity": "Recent activity",
  "task-state": "Tasks",
  "last-received-gift-date": "Last gift received",
  "giving-total": "Giving in the selected period",
  "commitment-status": "Recurring support status",
};
export const FACET_VALUE_LABELS: Readonly<Record<FacetKey, Readonly<Partial<Record<string, string>>>>> = {
  "contact-type": { person: "Person", household: "Household", church: "Church", organization: "Organization", "private-preparation": "Private preparation" },
  "preparation-state": { private: "Private record", shared: "Shared record", archived: "Archived record" },
  tag: {},
  favourite: { favourite: "Favourites only", "not-favourite": "Not a favourite" },
  "relationship-label": {},
  "initiative-membership": {},
  "referral-status": { active: "Active", "incomplete-date": "Date incomplete", expired: "Expired" },
  "contact-method-availability": { "any-permitted": "Has a permitted contact method", "none-permitted": "No permitted contact method" },
  geography: {},
  "recent-activity": { recorded: "Activity recorded", "none-recorded": "No activity recorded" },
  "task-state": { open: "Open task", overdue: "Overdue task", "no-date": "Task without a due date" },
  "last-received-gift-date": {},
  "giving-total": {},
  "commitment-status": {},
};
export const FACET_GROUPING_COPY = { acrossFacets: "Every selected filter must match.", withinFacet: "Within one filter, any selected value may match.", activeFilters: "Selected filters", clearAll: "Clear all filters", removeFilter: "Remove this filter", clearFacet: "Clear this filter" } as const satisfies Record<
  "acrossFacets" | "withinFacet" | "activeFilters" | "clearAll" | "removeFilter" | "clearFacet",
  string
>;
export const PERMISSION_FACTS = ["contactability", "communicationConsent", "protectedReaderGrant"] as const;
export type PermissionFactKey = (typeof PERMISSION_FACTS)[number];
export const PERMISSION_FACT_COPY: Readonly<Record<PermissionFactKey, { readonly label: string; readonly explanation: string; readonly whenAbsent: string }>> = {
  contactability: { label: "Contact details you may use", explanation: "Contactability is the set of contact methods this record permits you to use.", whenAbsent: "No contact method on this record is permitted." },
  communicationConsent: { label: "Consent to hear from this ministry", explanation: "Consent applies to one publisher and one purpose and does not carry to another.", whenAbsent: "No consent is recorded for this ministry and purpose." },
  protectedReaderGrant: { label: "Access to protected content", explanation: "A reader grant admits protected content and grants nothing else.", whenAbsent: "No reader grant admits this protected content." },
};

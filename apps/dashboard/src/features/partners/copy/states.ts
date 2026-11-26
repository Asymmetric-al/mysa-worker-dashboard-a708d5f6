import type { NoticeKind } from "@/components/state-notice";
import type { ValueState } from "@/modules/data-service/envelope";
import { FACET_GROUPING_COPY } from "./facets";
import { SAVED_VIEW_COPY } from "./privacy";
export type SurfaceNoticeState = Exclude<NoticeKind, "loading" | "language-unavailable">;
export type WithheldSurfaceState = "withheld";
export type SurfaceState = SurfaceNoticeState | WithheldSurfaceState;
export const PARTNERS_SURFACES = ["roster", "saved-view", "partner-detail", "private-preparation", "interactions", "open-tasks", "support-history"] as const;
export type PartnersSurface = (typeof PARTNERS_SURFACES)[number];
export type StateCopy = { readonly title: string; readonly body: string; readonly actionLabel?: string; readonly secondaryActionLabel?: string };
export const PARTNER_ACTION_LABELS = {
  addPrivateContact: "Add private contact",
  logInteraction: "Log activity",
  createFollowUpTask: "Add follow-up task",
  retry: "Try again",
  switchContext: "Switch ministry",
  backToRoster: "Back to Partners",
  clearFilters: FACET_GROUPING_COPY.clearAll,
  repairSavedView: SAVED_VIEW_COPY.repair.title,
} as const;
export const SURFACE_STATE_COPY: Readonly<Record<PartnersSurface, Readonly<Record<SurfaceState, StateCopy>>>> = {
  roster: {
    empty: {
      title: "No partners match these filters",
      body: "Try clearing your filters to see everyone, or add a private contact to get started.",
      actionLabel: PARTNER_ACTION_LABELS.clearFilters,
      secondaryActionLabel: PARTNER_ACTION_LABELS.addPrivateContact,
    },
    unavailable: { title: "Couldn’t load partners", body: "The partner service didn’t respond. Your data is safe — try again in a moment.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm partner list", body: "The response wasn’t confirmed, so the list isn’t shown as empty. Try loading again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some columns are hidden in this ministry", body: "Giving totals, referral status, or protected fields aren’t visible here." },
    denied: { title: "Partners aren’t available here", body: "This ministry doesn’t allow access to partners. Switch ministries to view them.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial history", body: "Activity from before data coverage started isn’t included here and isn’t counted as zero." },
    refused: { title: "Invalid filter or page", body: "One of the filters or page settings wasn’t accepted. Clear your filters to reset the list.", actionLabel: PARTNER_ACTION_LABELS.clearFilters },
  },
  "saved-view": {
    empty: { title: "No partners match this view right now", body: "Your saved view is unchanged. Clear filters to search everyone.", actionLabel: PARTNER_ACTION_LABELS.clearFilters },
    unavailable: { title: "Couldn’t load saved views", body: "Your saved views couldn’t be loaded right now. Try again in a moment.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm saved view", body: "The response for this view didn’t arrive. Try opening it again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some columns hidden", body: "Hidden columns stay saved in this view even though they aren’t visible in this ministry." },
    denied: { title: "Saved views aren’t available here", body: "Switch to a ministry that allows saved views.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial history", body: "Results reflect only the period covered by your ministry’s data." },
    refused: { title: "Couldn’t open saved view", body: "That view ID wasn’t recognized. Return to Partners to pick another view.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "partner-detail": {
    empty: { title: "No shared details yet", body: "This profile has a name and type. Log a call, visit, or message to build their history.", actionLabel: PARTNER_ACTION_LABELS.logInteraction },
    unavailable: { title: "Couldn’t load partner profile", body: "The partner service didn’t respond. Nothing was deleted — try again in a moment.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm partner profile", body: "The response wasn’t confirmed, so partial details aren’t shown. Try loading again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some sections hidden in this ministry", body: "Giving history or protected details aren’t shown here." },
    denied: { title: "Partner profile unavailable", body: "You don’t have permission to view this partner in the current ministry.", actionLabel: PARTNER_ACTION_LABELS.switchContext, secondaryActionLabel: PARTNER_ACTION_LABELS.backToRoster },
    "partial-coverage": { title: "Partial history", body: "This profile is complete from the start of data coverage onward. Earlier gaps aren’t counted as zero." },
    refused: { title: "Partner not found", body: "That partner link isn’t valid in this ministry. Return to Partners to find them.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "private-preparation": {
    empty: { title: "No private notes yet", body: "Your notes stay private to you. Add a note above whenever you want to remember context or next steps.", actionLabel: PARTNER_ACTION_LABELS.addPrivateContact },
    unavailable: { title: "Couldn’t load private notes", body: "Your notes couldn’t be loaded right now. Nothing was deleted — try again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm private notes", body: "The response wasn’t confirmed. Try loading again to see your notes.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some private details hidden", body: "This session can’t display all private entries here. Your saved notes are unchanged." },
    denied: { title: "Private notes unavailable here", body: "Switch to a ministry where private notes are enabled.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial note history", body: "Notes from before data coverage started aren’t shown here." },
    refused: { title: "Couldn’t load private notes", body: "The request wasn’t accepted, and your notes are unchanged.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  interactions: {
    empty: { title: "No activity logged yet", body: "Calls, visits, and messages you log will appear here. Gifts and tasks are tracked separately.", actionLabel: PARTNER_ACTION_LABELS.logInteraction },
    unavailable: { title: "Couldn’t load activity", body: "The activity service didn’t respond. Try again in a moment.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm activity", body: "The response wasn’t confirmed, so this list isn’t shown as empty. Try again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some activity hidden", body: "Only activity permitted in this ministry is shown here." },
    denied: { title: "Activity unavailable here", body: "Switch to a ministry with access to partner activity.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial activity history", body: "Activity from before data coverage began isn’t listed here." },
    refused: { title: "Couldn’t load activity", body: "The request wasn’t accepted by the activity service.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "open-tasks": {
    empty: { title: "No open tasks for this partner", body: "Add a follow-up task when you want a reminder to call, write, or say thank you.", actionLabel: PARTNER_ACTION_LABELS.createFollowUpTask },
    unavailable: { title: "Couldn’t load tasks", body: "The task service didn’t respond. Try again in a moment.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm tasks", body: "The response wasn’t confirmed, so tasks aren’t shown as empty. Try again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Other teammates’ tasks hidden", body: "Only your own tasks are shown here." },
    denied: { title: "Tasks unavailable here", body: "Switch to a ministry where tasks are enabled.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial task history", body: "Older tasks from before coverage began aren’t shown here." },
    refused: { title: "Couldn’t load tasks", body: "The request wasn’t accepted by the task service.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "support-history": {
    empty: { title: "No gifts recorded yet", body: "No received gifts are on file for this partner (shown separately from a recorded zero)." },
    unavailable: { title: "Support amounts unavailable", body: "The giving service didn’t respond, so amounts are hidden rather than shown as zero.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Couldn’t confirm support amounts", body: "The response wasn’t confirmed. Try loading again.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some amounts hidden", body: "Amounts your current ministry doesn’t show are omitted." },
    denied: { title: "Giving history unavailable here", body: "Switch to a ministry with access to giving history.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Partial period coverage", body: "Totals below are incomplete subtotals covering only the available data period." },
    refused: { title: "Couldn’t load giving history", body: "The request wasn’t accepted by the giving service.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
};
export type ValueStateCopy = { readonly phrase: string; readonly accessibleLabel: string; readonly explanation?: string };
export const VALUE_STATE_COPY: Readonly<Record<ValueState, ValueStateCopy>> = {
  value: { phrase: "Recorded", accessibleLabel: "Recorded value from the source.", explanation: "Recorded directly from your ministry’s data for the stated period." },
  zero: { phrase: "Zero recorded", accessibleLabel: "Recorded zero (a known zero, not missing data).", explanation: "Confirmed as zero — not missing or unavailable." },
  unknown: { phrase: "Unknown", accessibleLabel: "Unknown value — not provided by the source.", explanation: "Not provided by the source, so nothing is guessed." },
  withheld: { phrase: "Hidden", accessibleLabel: "Hidden in this ministry.", explanation: "Recorded in the source, but not shown in this ministry." },
  unavailable: { phrase: "Unavailable", accessibleLabel: "Unavailable because the source didn’t respond.", explanation: "The source couldn’t be reached — not treated as missing or zero." },
  "incomplete-subtotal": { phrase: "Incomplete subtotal", accessibleLabel: "Incomplete subtotal due to partial coverage.", explanation: "Only part of the period is covered, so this subtotal is incomplete." },
};
export const FORM_OUTCOME_COPY: Readonly<Record<"conflict" | "unchanged" | "unavailable" | "unknown", StateCopy>> = {
  conflict: { title: "Updated elsewhere", body: "This record changed while you were editing. Compare both versions below before deciding whether to apply yours.", actionLabel: "Review and apply" },
  unchanged: { title: "No changes needed", body: "Your entry matched what’s already saved, so nothing was changed." },
  unavailable: { title: "Couldn’t save right now", body: "The service couldn’t be reached. Your input is still here so you can try again without retyping.", actionLabel: PARTNER_ACTION_LABELS.retry },
  unknown: { title: "Couldn’t confirm save", body: "We didn’t get a confirmation back, so check the result before submitting again to avoid duplicates.", actionLabel: "Check result" },
};

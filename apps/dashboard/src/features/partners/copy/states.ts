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
  addPrivateContact: "Add a private contact",
  logInteraction: "Log an interaction",
  createFollowUpTask: "Create a follow-up task",
  retry: "Try again",
  switchContext: "Switch ministry",
  backToRoster: "Go to the Partner roster",
  clearFilters: FACET_GROUPING_COPY.clearAll,
  repairSavedView: SAVED_VIEW_COPY.repair.title,
} as const;
export const SURFACE_STATE_COPY: Readonly<Record<PartnersSurface, Readonly<Record<SurfaceState, StateCopy>>>> = {
  roster: {
    empty: {
      title: "No partner matches the filters in effect",
      body: "A roster with no contacts added yet is a different situation from filters that select nothing: clear the filters to search the whole roster, or add a private contact and begin.",
      actionLabel: PARTNER_ACTION_LABELS.clearFilters,
      secondaryActionLabel: PARTNER_ACTION_LABELS.addPrivateContact,
    },
    unavailable: { title: "The roster could not be read", body: "The partner source did not answer for this read, so the list is not shown. A failed read is not an empty roster, and the source is left as it was.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "The roster result was not confirmed", body: "The read came back without a confirmation, so the result is offered as neither empty nor complete. Reading it again returns the roster the source confirms.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Columns are withheld in this context", body: "The records are listed. Giving totals, referral status and protected facts are not shown here, and a hidden column is not a blank field." },
    denied: { title: "Partner roster is unavailable here", body: "Reaching the partner roster needs a ministry that admits it, and the ministry you are working in does not.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Activity before coverage is absent", body: "Facts recorded before the source's coverage began do not appear in this roster. A gap in coverage is never counted as a zero." },
    refused: { title: "The roster request was refused", body: "A filter or a page this roster sent is not one its read admits, so the list was not read and the partner source did not fail. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.clearFilters },
  },
  "saved-view": {
    empty: { title: "This view selects nothing right now", body: "The view is stored exactly as you saved it, and the filters it carries match no partner at the moment. Clearing the filters widens the search without changing the view.", actionLabel: PARTNER_ACTION_LABELS.clearFilters },
    unavailable: { title: "The saved view could not be read", body: "Its stored choices did not come back, so the view was not applied and no filter is guessed in its place.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "The saved view was not confirmed", body: "The reply carrying this view's stored choices never arrived, so it is neither restored nor forgotten here. Opening it again settles which it is.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some view columns are withheld", body: "The view opens with the columns this context admits. A column withheld here stays stored in the view instead of being dropped from it." },
    denied: { title: "Saved views are unavailable here", body: "Views belong to the ministry that stored them, and the ministry in view does not admit them.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "The view reaches past coverage", body: "Part of the history this view was built from sits before the source's coverage, so its results are complete for the covered period only." },
    refused: { title: "The saved-view request was refused", body: "The identifier this view was opened with is not one the saved-view read admits, so no view was applied and the stored view is untouched.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "partner-detail": {
    empty: { title: "No shared facts recorded yet", body: "This record carries its name and its identity kind. A private preparation looks this way from the shared side, so recording an interaction that actually happened is the useful next step.", actionLabel: PARTNER_ACTION_LABELS.logInteraction },
    unavailable: { title: "This record could not be read", body: "Its sections are unavailable rather than bare, because the read behind them did not complete. Nothing was deleted, and the record keeps its place in the source.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "This record's read was not confirmed", body: "The reply for this record was lost on the way back, so what appears here is not offered as the whole record. Reading it again returns the latest confirmed form.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Sections are withheld in this context", body: "Identity, permitted contact methods and open work are shown. Support history and protected facts are omitted here instead of appearing as empty sections." },
    denied: { title: "Partner details are unavailable here", body: "This ministry does not admit partner details, so the detail view stays closed.", actionLabel: PARTNER_ACTION_LABELS.switchContext, secondaryActionLabel: PARTNER_ACTION_LABELS.backToRoster },
    "partial-coverage": { title: "Part of this history predates coverage", body: "What this record shows is complete from the start of the source's coverage onward. Earlier activity is a gap, and a gap is not counted as a zero." },
    refused: { title: "This record's request was refused", body: "The address this record was opened at is not one the partner read admits, so nothing was read and the source did not fail. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "private-preparation": {
    empty: { title: "No private preparation recorded", body: "Preparation is yours alone, and you have not written any for this context yet. Adding a private contact begins one without creating a record anyone else can see.", actionLabel: PARTNER_ACTION_LABELS.addPrivateContact },
    unavailable: { title: "Your preparation could not be read", body: "The preparation records could not be fetched, so this section is unavailable. Failing to read your text does not delete it.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Your preparation was not confirmed", body: "Your preparation could not be confirmed, so this section is shown as neither present nor absent. Reading it again shows what the source holds.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Part of this preparation is withheld", body: "Preparation is visible to the worker who wrote it, and this context still withholds the lines it does not admit. The stored text is unchanged." },
    denied: { title: "Private preparation is unavailable here", body: "Preparation belongs to the ministry where you write it, and the selected ministry does not admit it.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Preparation before coverage is absent", body: "Preparation written before the source's coverage began does not appear here. Its absence is a gap in coverage rather than a deleted record." },
    refused: { title: "This preparation's request was refused", body: "The request for this preparation is not one its read admits, so your text was not read and it is not lost. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  interactions: {
    empty: { title: "No interaction recorded for this partner", body: "A gift, a scheduled task or an app launch never appears in this list. Only something that actually happened is recorded here, and logging it is how the list begins.", actionLabel: PARTNER_ACTION_LABELS.logInteraction },
    unavailable: { title: "Interactions could not be read", body: "The interaction list could not be fetched, so it is unavailable rather than quiet. A read that failed proves nothing about contact.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "The interaction list was not confirmed", body: "The list arrived without a confirmation, so it is not presented as empty. Reading it again shows which interactions the source holds.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some interactions are withheld here", body: "Interactions this context does not admit are left out of the list. The section is narrower than the record, not a complete history." },
    denied: { title: "Interaction history is unavailable here", body: "Interaction history is read inside the ministry that admits it, and that is not the context in view.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Earlier interactions fall outside coverage", body: "Interactions recorded before the source's coverage are not listed. An early event that is missing is a coverage gap, not evidence that contact never happened." },
    refused: { title: "The interaction request was refused", body: "A parameter this list sent is not one its read admits, so the list was not read and the interaction source did not fail. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "open-tasks": {
    empty: { title: "No open task for this partner", body: "Completing a task proves nothing about contact or fulfilment, so a follow-up task is a reminder rather than evidence. Creating one is how this section begins.", actionLabel: PARTNER_ACTION_LABELS.createFollowUpTask },
    unavailable: { title: "Tasks could not be read", body: "The task source could not be reached, so this section is unavailable. Work that failed to load is not work that is done.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "The task list was not confirmed", body: "The task source gave no confirmation of this read, so the list is not shown as clear. Reading it again returns what is actually open.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Tasks owned elsewhere are withheld", body: "Tasks another worker owns are not shown in this section. It is narrower than the team's work, and a task missing here is still somebody's obligation." },
    denied: { title: "Tasks are unavailable here", body: "Task work sits with the ministry that owns it, and the ministry this screen is opened in does not admit task work.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Older tasks fall outside coverage", body: "Tasks created before the source's coverage are not listed. Their absence is a gap in coverage rather than a completed obligation." },
    refused: { title: "The task request was refused", body: "A parameter this section sent is not one the task read admits, so no task was read and the task source did not fail. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
  "support-history": {
    empty: { title: "No received support recorded for this partner", body: "An empty list is not a zero total. The source holds no received support for this partner, which is a different fact from a recorded amount of zero." },
    unavailable: { title: "Support amounts are unavailable", body: "The support source is down, so amounts here are unavailable rather than absent. An empty figure is never shown in place of a failed read.", actionLabel: PARTNER_ACTION_LABELS.retry },
    unknown: { title: "Support amounts were not confirmed", body: "This read came back unconfirmed, so the result is offered as neither success nor failure. Reading it again is how you learn whether it stands.", actionLabel: PARTNER_ACTION_LABELS.retry },
    withheld: { title: "Some amounts are withheld here", body: "Recorded amounts this context does not admit are left out, and what remains cannot be used to work a hidden amount out by subtraction." },
    denied: { title: "Support history is unavailable here", body: "Amounts and support facts are admitted only by the ministry that holds them, and the ministry active here does not admit them.", actionLabel: PARTNER_ACTION_LABELS.switchContext },
    "partial-coverage": { title: "Coverage is partial for this period", body: "The period's coverage is partial, so totals in this section are incomplete subtotals, and each one states the coverage it was computed over." },
    refused: { title: "The support request was refused", body: "A parameter this section sent is not one the support read admits, so no amount was read and the support source did not fail. The refusal names the field to correct.", actionLabel: PARTNER_ACTION_LABELS.backToRoster },
  },
};
export type ValueStateCopy = { readonly phrase: string; readonly accessibleLabel: string; readonly explanation?: string };
export const VALUE_STATE_COPY: Readonly<Record<ValueState, ValueStateCopy>> = {
  value: { phrase: "Recorded", accessibleLabel: "A recorded value, taken from the source as it stands.", explanation: "The figure is a recorded value rather than an estimate, and it carries the coverage stated beside it." },
  zero: { phrase: "Zero recorded", accessibleLabel: "A recorded zero, which is a known value and not a missing one.", explanation: "The source established a zero. It is not unknown, not withheld and not unavailable." },
  unknown: { phrase: "Unknown", accessibleLabel: "Unknown, because the source did not supply this value.", explanation: "The source did not supply the value, so nothing is assumed and nothing is filled in to stand for it." },
  withheld: { phrase: "Not shown", accessibleLabel: "Withheld, because this context does not show the recorded value.", explanation: "A value is recorded and this context does not show it, so it stays out of sight rather than becoming absent." },
  unavailable: { phrase: "Unavailable", accessibleLabel: "Unavailable, because the source behind the value could not be read.", explanation: "The source behind this figure is down, so the figure is unavailable; a failed read is neither a missing value nor a zero." },
  "incomplete-subtotal": { phrase: "Incomplete subtotal", accessibleLabel: "An incomplete subtotal, because the coverage for the period is partial.", explanation: "Coverage for the period is partial, so this subtotal covers only the part the source holds, and the coverage statement says which part." },
};
export const FORM_OUTCOME_COPY: Readonly<Record<"conflict" | "unchanged" | "unavailable" | "unknown", StateCopy>> = {
  conflict: { title: "This changed while you were editing", body: "The current value is shown beside what you entered, and nothing was replaced. Applying your version again is a deliberate choice you make after comparing the two.", actionLabel: "Review and apply" },
  unchanged: { title: "Nothing differed", body: "Your entry matched what was already saved, so nothing was written and no activity was recorded." },
  unavailable: { title: "The save did not happen", body: "The save request did not reach the source, so nothing was saved. The text you entered is still here, so trying again does not mean retyping it.", actionLabel: PARTNER_ACTION_LABELS.retry },
  unknown: { title: "The save result is unconfirmed", body: "The acknowledgement was lost, so the save may or may not exist. Checking the result is the honest next step, and submitting the same work again is not offered, because a duplicate record is worse than a repeated look.", actionLabel: "Check the result" },
};

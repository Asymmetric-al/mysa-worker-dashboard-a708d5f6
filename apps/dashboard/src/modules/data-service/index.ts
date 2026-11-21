/**
 * The whole data surface, grouped by visible job.
 *
 * Every Server Component and every thin Route Handler imports this module and nothing deeper inside
 * `modules/data-service`: `reads.<job>.<name>` for one scoped read, `mutations.<job>.<name>` for one
 * named change. Every method re-derives scope from the development session inside the service, so a
 * caller passes only its own query or payload and receives exactly one `ReadEnvelope` or exactly one
 * of the eight mutation outcomes — never a bare value, a bare boolean or a thrown error.
 *
 * A method is imported once above and referenced from each job group that needs it, which is why
 * `readPreview` appears under both `updates` and `pages` and why the seven shared content mutations
 * appear under both as well: one definition, two job-shaped ways to reach it. Nothing in this file
 * validates, authorises, computes or stores anything.
 *
 * The contract types are re-exported here by name rather than with `export *`, so the Zod schemas
 * declared beside them stay inside the service while a handler can still name `MutationInput`, build
 * one at the boundary and answer with `toResponse`.
 */

import {
  readAudience,
  readDiscoveryIndex,
  readInbox,
  readPreferences,
  readReceivingList,
  readReceivingPage,
  readReceivingPost,
  readSendResult,
} from "./reads/audience";
import {
  readCheckIns,
  readCoachPortfolio,
  readCoachSubject,
  readCoachingOverview,
  readTargets,
  readTaskShares,
} from "./reads/coaching";
import {
  readCandidate,
  readDraft,
  readGivingBinding,
  readPage,
  readPageCatalogues,
  readPageLocales,
  readPreview,
  readRelease,
  readSharePresentation,
  readVariantOverview,
} from "./reads/content";
import { readDevState } from "./reads/dev";
import { readImportProposal, readImportReceipt } from "./reads/import";
import { readMediaAsset } from "./reads/media";
import {
  readInitiative,
  readInitiativeResults,
  readInitiatives,
  readReferral,
  readReferrals,
} from "./reads/outreach";
import {
  findPartners,
  readFacets,
  readInteractions,
  readPartner,
  readPrivatePreparation,
  readSavedViews,
} from "./reads/partners";
import { readAdmissionState, readContextChooser, readHome } from "./reads/shell";
import {
  readCommitments,
  readExport,
  readGifts,
  readGoal,
  readReport,
  readSupportOverview,
} from "./reads/support";
import { listTasks, readAgenda, readSeries } from "./reads/tasks";
import {
  confirmMembership,
  setPreference,
  signupForPurpose,
  unsubscribe,
} from "./mutations/audience";
import {
  acceptInvitation,
  editTarget,
  endCoaching,
  endTarget,
  inviteCoach,
  leaveCoaching,
  pauseTarget,
  revokeGrant,
  saveCheckIn,
  saveTarget,
  setModule,
  shareCheckIn,
  shareTaskSummary,
  stopTaskShare,
  updateSharedCheckIn,
  withdrawCheckIn,
} from "./mutations/coaching";
import {
  addSection,
  applyPreset,
  approveCandidate,
  createVariant,
  duplicateSection,
  moveSection,
  publishVariants,
  registerMediaAsset,
  rejectCandidate,
  removePlacement,
  removeSection,
  replacePlacement,
  requestChanges,
  requestNotification,
  restoreRevisionAsDraft,
  saveDraft,
  saveSectionFields,
  setReach,
  stopShowingPublicly,
  submitForReview,
  withdrawLocale,
  withdrawPage,
  withdrawUpdate,
} from "./mutations/content";
import {
  advanceClock,
  resetSeed,
  selectContext,
  setClock,
  setFailurePlan,
  setScenario,
} from "./mutations/dev";
import { acceptImportRows, cancelImport, proposeImport, setRowDecision } from "./mutations/import";
import {
  addMembers,
  closeInitiative,
  continueReferral,
  createInitiative,
  draftRequest,
  presentRequest,
  recordIntroduction,
  recordRequestResponse,
  removeMember,
  reopenInitiative,
  returnMember,
  setStage,
} from "./mutations/outreach";
import {
  archivePreparation,
  createPrivatePreparation,
  deleteView,
  logInteraction,
  renameView,
  restorePreparation,
  saveContactEdits,
  savePrivateNote,
  saveView,
  setFavourite,
  setTag,
} from "./mutations/partners";
import { saveGoal } from "./mutations/support";
import {
  bulkApplyTag,
  bulkCompleteTasks,
  bulkCreateTasks,
  bulkRemoveTag,
  cancelTask,
  completeTask,
  createSeries,
  createTask,
  editOccurrence,
  editTask,
  editThisAndFuture,
  pauseSeries,
  reopenTask,
  resolveMissedPlan,
  resumeSeries,
  skipOccurrence,
  stopSeries,
} from "./mutations/tasks";

export type {
  CoachingCheckInRecord,
  CoachingGrantRecord,
  CoachingTargetRecord,
  CommitmentRowRecord,
  ContentDocumentRecord,
  ContentRevisionRecord,
  ContentVariantRecord,
  Coverage,
  GiftRowRecord,
  ImportProposalRecord,
  InitiativeMemberRecord,
  InitiativeRecord,
  InteractionRecord,
  MediaAssetRecord,
  MediaAssetRenditionRecord,
  MembershipRecord,
  MutationInput,
  NotificationIntentRecord,
  NotificationSendResultRecord,
  OperationRecord,
  PartnerRecord,
  PrivateNoteRecord,
  ReadAction,
  ReadEnvelope,
  ReferralCycleRecord,
  ReleaseRecord,
  RequestRecord,
  Scope,
  SupportProjectionRecord,
  TaskRecord,
  TaskSeriesRecord,
  ValueState,
} from "./envelope";
export { mutationInputSchema } from "./envelope";
export type { DenialReason, MutationOutcome, PerItemResult, ReadResult } from "./outcome";
export { isOutcome, isReadResult, outcomeFromError, toResponse } from "./outcome";

/**
 * The named reads, grouped by the job a caller is doing. Each member re-derives scope from the
 * development session and answers with one `ReadResult<ReadEnvelope<…>>`: an envelope, a denial, or
 * an unavailable source behind it.
 */
export const reads = {
  context: { readAdmissionState, readContextChooser, readHome },
  partners: { findPartners, readPartner, readFacets, readSavedViews, readPrivatePreparation },
  interactions: { readInteractions },
  work: { listTasks, readAgenda },
  series: { readSeries },
  import: { readImportProposal, readImportReceipt },
  outreach: { readInitiatives, readInitiative, readInitiativeResults },
  referrals: { readReferrals, readReferral },
  support: { readSupportOverview, readGifts, readCommitments, readGoal, readReport },
  export: { readExport },
  updates: {
    readVariantOverview,
    readDraft,
    readCandidate,
    readRelease,
    readPreview,
    readSharePresentation,
  },
  // `readPreview` is the same read the Update job uses: one preview authorisation, reachable from
  // either family's job, never a second implementation of it.
  pages: { readPageCatalogues, readPage, readPageLocales, readGivingBinding, readPreview },
  media: { readMediaAsset },
  audience: {
    readAudience,
    readPreferences,
    readInbox,
    readReceivingList,
    readReceivingPost,
    readDiscoveryIndex,
    readReceivingPage,
    readSendResult,
  },
  coaching: { readCoachingOverview, readTargets, readCheckIns, readTaskShares },
  coach: { readCoachPortfolio, readCoachSubject },
  dev: { readDevState },
};

/**
 * The named mutations, grouped by the job a caller is doing. Each member validates its own payload,
 * re-checks scope, honours `expectedRevision` through the operation ledger, and answers with exactly
 * one of the eight mutation outcomes.
 */
export const mutations = {
  /**
   * `selectContext` is defined in `./mutations/dev` because it shares that module's session and
   * clock handling, but it is grouped here: `/api/session/context` dispatches to it and it is not
   * development-gated, unlike the five controls under `dev`.
   */
  context: { selectContext },
  partners: { saveView, renameView, deleteView, setTag, setFavourite },
  partnerPreparation: {
    createPrivatePreparation,
    saveContactEdits,
    archivePreparation,
    restorePreparation,
    savePrivateNote,
  },
  interactions: { logInteraction },
  work: {
    createTask,
    editTask,
    completeTask,
    reopenTask,
    cancelTask,
    bulkApplyTag,
    bulkRemoveTag,
    bulkCreateTasks,
    bulkCompleteTasks,
  },
  series: {
    createSeries,
    editOccurrence,
    editThisAndFuture,
    skipOccurrence,
    pauseSeries,
    resumeSeries,
    stopSeries,
    resolveMissedPlan,
  },
  import: { proposeImport, setRowDecision, acceptImportRows, cancelImport },
  outreach: {
    createInitiative,
    addMembers,
    removeMember,
    returnMember,
    setStage,
    draftRequest,
    presentRequest,
    recordRequestResponse,
    closeInitiative,
    reopenInitiative,
  },
  referrals: { recordIntroduction, continueReferral },
  // The one financial write in the application: gated by `canEditGoal` and never touching a gift.
  support: { saveGoal },
  updates: {
    createVariant,
    saveDraft,
    submitForReview,
    approveCandidate,
    requestChanges,
    rejectCandidate,
    publishVariants,
    requestNotification,
    withdrawUpdate,
    withdrawLocale,
    restoreRevisionAsDraft,
  },
  // The seven variant, draft, review, publish and locale mutations above are the same bindings the
  // Page family uses; the Page job adds its section, reach and withdrawal writes to them.
  pages: {
    createVariant,
    saveDraft,
    submitForReview,
    approveCandidate,
    requestChanges,
    publishVariants,
    withdrawLocale,
    addSection,
    moveSection,
    duplicateSection,
    removeSection,
    saveSectionFields,
    applyPreset,
    setReach,
    stopShowingPublicly,
    withdrawPage,
  },
  media: { registerMediaAsset, replacePlacement, removePlacement },
  audience: { signupForPurpose, confirmMembership, setPreference, unsubscribe },
  coaching: {
    inviteCoach,
    revokeGrant,
    endCoaching,
    setModule,
    saveTarget,
    editTarget,
    pauseTarget,
    endTarget,
    saveCheckIn,
    shareCheckIn,
    updateSharedCheckIn,
    withdrawCheckIn,
    shareTaskSummary,
    stopTaskShare,
  },
  coach: { acceptInvitation, leaveCoaching },
  dev: { setScenario, setClock, advanceClock, setFailurePlan, resetSeed },
};

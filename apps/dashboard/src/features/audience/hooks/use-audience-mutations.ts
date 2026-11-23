"use client";
import { type UseMutationResult } from "@tanstack/react-query";
import { useOutcomeMutation, type OutcomeMutationOptions } from "@/lib/read-transport";
import type { MutationInput } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { ConfirmPayload, SignupPayload } from "../schemas/confirmation";
import type { SetPreferencePayload } from "../schemas/preference";
import type { UnsubscribePayload } from "../schemas/unsubscribe";
import { AUDIENCE_JOB_SEGMENTS } from "./use-audience-reads";
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same step again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
const REFRESHING_OUTCOMES = ["accepted", "alreadyAccepted", "unchanged"] as const;
const REFRESHED_JOBS = AUDIENCE_JOB_SEGMENTS;
const changeAt = (url: string): OutcomeMutationOptions => ({ url, jobs: REFRESHED_JOBS, offlineGuidance: OFFLINE_GUIDANCE, refreshing: REFRESHING_OUTCOMES });
const SIGNUP = changeAt("/api/audience");
const CONFIRM = changeAt("/api/confirm");
const PREFERENCE = changeAt("/api/preferences");
const UNSUBSCRIBE = changeAt("/api/unsubscribe");
/** Opens one purpose-specific membership for a deliberate signup and leaves it awaiting proof, over `POST /api/audience` (`signupForPurpose`). Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`, unchanged. */
export const useSignupForPurpose = (): UseMutationResult<MutationOutcome, Error, MutationInput<SignupPayload>> => useOutcomeMutation<SignupPayload>(SIGNUP);
/** Confirms one membership inside its 168-elapsed-hour confirmation window, over `POST /api/confirm` (`confirmMembership`): */ export const useConfirmMembership = (): UseMutationResult<MutationOutcome, Error, MutationInput<ConfirmPayload>> => useOutcomeMutation<ConfirmPayload>(CONFIRM);
/** Records the reader's Off or Immediate choice, and a reading language when the payload states one, over `POST /api/preferences` (`setPreference`). */
export const useSetPreference = (): UseMutationResult<MutationOutcome, Error, MutationInput<SetPreferencePayload>> => useOutcomeMutation<SetPreferencePayload>(PREFERENCE);
/** Turns off the acting reader's Update email from one publisher for one purpose, over `POST /api/unsubscribe` (`unsubscribe`), leaving every other membership untouched and claiming no recall of a message already received. */
export const useUnsubscribe = (): UseMutationResult<MutationOutcome, Error, MutationInput<UnsubscribePayload>> => useOutcomeMutation<UnsubscribePayload>(UNSUBSCRIBE);

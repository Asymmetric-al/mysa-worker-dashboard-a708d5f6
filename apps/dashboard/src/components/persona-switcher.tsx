"use client";
import type { StatusBadgeSpec } from "@/components/status-badge";
import type { SessionState } from "@/modules/data-service/envelope";
/** The seeded identity kinds the development preview labels. */ export type PersonaKind = "reader" | "worker" | "reviewer" | "coach";
/** The five session states the development preview labels and explains. */ export type PersonaSessionState = SessionState;
export const PERSONA_SESSION_STATE_LABELS: Readonly<Record<PersonaSessionState, StatusBadgeSpec>> = {
  "signed-in": { label: "Signed in", tone: "neutral" },
  unavailable: { label: "Session unavailable", tone: "danger" },
  denied: { label: "Access denied", tone: "danger" },
  expired: { label: "Session expired", tone: "caution" },
  "no-access": { label: "No account access", tone: "caution" },
};
/** Plain summary of what each session state shows. */ export const PERSONA_SESSION_STATE_OUTCOMES: Readonly<Record<PersonaSessionState, string>> = {
  "signed-in": "Shows the workspace for the selected persona.",
  unavailable: "Session couldn’t be loaded, so a recovery notice is shown instead of data.",
  denied: "Access is denied without revealing whether any records exist.",
  expired: "Session has expired, so the workspace is closed until refreshed.",
  "no-access": "No ministry access is linked, so only access guidance is shown.",
};
export const PERSONA_KIND_LABELS: Readonly<Record<PersonaKind, StatusBadgeSpec>> = { reader: { label: "Reader", tone: "muted" }, worker: { label: "Missionary", tone: "neutral" }, reviewer: { label: "Reviewer", tone: "neutral" }, coach: { label: "Coach", tone: "neutral" } };

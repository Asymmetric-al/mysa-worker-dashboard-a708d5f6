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
/** What each session state produces, stated beside the state so the scenario is legible without running it (AAP 0.10.1 shell row, criterion 19). */
export const PERSONA_SESSION_STATE_OUTCOMES: Readonly<Record<PersonaSessionState, string>> = {
  "signed-in": "The workspace renders for the selected persona.",
  unavailable: "The session cannot be read, so the surface offers its recovery path instead of any data.",
  denied: "The persona is refused, and no count, title, size or existence of a hidden record is revealed.",
  expired: "The session has expired, so the surface offers the recovery path and shows no data.",
  "no-access": "No admitted identity exists, so only account-recovery guidance is shown.",
};
export const PERSONA_KIND_LABELS: Readonly<Record<PersonaKind, StatusBadgeSpec>> = { reader: { label: "Receiving reader", tone: "muted" }, worker: { label: "Worker", tone: "neutral" }, reviewer: { label: "Reviewer", tone: "neutral" }, coach: { label: "Coach", tone: "neutral" } };

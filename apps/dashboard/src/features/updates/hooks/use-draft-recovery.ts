"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ContentDocumentJson as ContentDocument } from "@/modules/content/document";
import type { Scope } from "@/modules/data-service";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { SaveDraftPayload } from "../schemas";
import { useSaveDraft } from "./use-update-mutations";
export const AUTOSAVE_STATES = ["idle", "unsaved", "saving", "saved", "failed-local-kept", "conflict", "unknown"] as const;
export type AutosaveState = (typeof AUTOSAVE_STATES)[number];
const MIRROR_DISPOSITION = { idle: "empty", unsaved: "holds-unacknowledged-text", saving: "holds-unacknowledged-text", saved: "empty", "failed-local-kept": "holds-unacknowledged-text", conflict: "holds-unacknowledged-text", unknown: "holds-unacknowledged-text" } as const satisfies Readonly<
  Record<AutosaveState, "empty" | "holds-unacknowledged-text">
>;
const keepsUnacknowledgedText = (state: AutosaveState): boolean => MIRROR_DISPOSITION[state] === "holds-unacknowledged-text";
const MIRROR_KEY = "mysa.updates.draft-recovery.v1";
const MIRROR_VERSION = 1;
type MirrorEntry = { readonly version: typeof MIRROR_VERSION; readonly scopeKey: string; readonly variantId: string; readonly body: ContentDocument; readonly expectedRevision: Revision };
type RecoveryContext = { readonly scopeKeyText: string; readonly variantId: string };
type HeldDraft = { readonly body: ContentDocument; readonly scopeKeyText: string; readonly variantId: string };
const belongsHere = (held: HeldDraft, context: RecoveryContext): boolean => held.scopeKeyText === context.scopeKeyText && held.variantId === context.variantId;
function withStorage<R>(use: (storage: Storage) => R, fallback: R): R {
  if (typeof window === "undefined" || !("sessionStorage" in window)) return fallback;
  try {
    return use(window.sessionStorage);
  } catch {
    return fallback;
  }
}
function mirrorEntryOf(value: unknown): MirrorEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const { body, expectedRevision, scopeKey: entryScopeKey, variantId: entryVariantId, version } = record;
  if (version !== MIRROR_VERSION || typeof entryScopeKey !== "string" || typeof entryVariantId !== "string" || typeof expectedRevision !== "string") return null;
  if (typeof body !== "object" || body === null) return null;
  return { version: MIRROR_VERSION, scopeKey: entryScopeKey, variantId: entryVariantId, body: body as ContentDocument, expectedRevision };
}
function readMirrorEntry(): MirrorEntry | null {
  const raw = withStorage((storage) => storage.getItem(MIRROR_KEY), null);
  if (raw === null) return null;
  let entry: MirrorEntry | null = null;
  try {
    entry = mirrorEntryOf(JSON.parse(raw));
  } catch {
    entry = null;
  }
  if (entry !== null) return entry;
  removeMirrorEntry();
  return null;
}
const writeMirrorEntry = (entry: MirrorEntry): void => withStorage((storage) => storage.setItem(MIRROR_KEY, JSON.stringify(entry)), undefined);
const removeMirrorEntry = (): void => withStorage((storage) => storage.removeItem(MIRROR_KEY), undefined);
function entryFor(context: RecoveryContext): MirrorEntry | null {
  const entry = readMirrorEntry();
  return entry !== null && entry.scopeKey === context.scopeKeyText && entry.variantId === context.variantId ? entry : null;
}
const sameBody = (left: ContentDocument, right: ContentDocument): boolean => JSON.stringify(left) === JSON.stringify(right);
export type Revision = string;
export type DraftPlacementRef = NonNullable<SaveDraftPayload["mediaPlacements"]>[number];
export type DraftRecoveryOptions = { readonly scope: Scope; readonly variantId: string; readonly initialRevision: Revision; readonly initialBody?: ContentDocument; readonly placements?: readonly DraftPlacementRef[]; readonly debounceMs?: number };
export type DraftRecovery = {
  readonly state: AutosaveState;
  readonly outcome: MutationOutcome | null;
  readonly acknowledgedRevision: Revision | null;
  readonly keptBody: ContentDocument | null;
  readonly localRecovery: { readonly present: boolean; readonly body: ContentDocument | null };
  notifyChange: (body: ContentDocument, placements?: readonly DraftPlacementRef[]) => Promise<MutationOutcome>;
  adoptConfirmedRevision: (revision: Revision) => void;
  retrySameWork: () => void;
  discardLocalRecovery: () => void;
};
const DEFAULT_DEBOUNCE_MS = 800;
type Settlement = { readonly state: AutosaveState; readonly confirmedRevision: Revision | null };
const SETTLEMENT_STATE = { accepted: "saved", alreadyAccepted: "saved", unchanged: "saved", conflict: "conflict", invalid: "failed-local-kept", unavailable: "failed-local-kept", denied: "failed-local-kept", unknown: "unknown" } as const satisfies Readonly<Record<MutationOutcome["outcome"], AutosaveState>>;
const settlementOf = (outcome: MutationOutcome): Settlement => ({ state: SETTLEMENT_STATE[outcome.outcome], confirmedRevision: "revision" in outcome ? outcome.revision : null });
type SaveContext = RecoveryContext & { readonly scope: Scope; readonly initialRevision: Revision; readonly placements: readonly DraftPlacementRef[] | undefined; readonly debounceMs: number };
type Snapshot = { readonly state: AutosaveState; readonly outcome: MutationOutcome | null; readonly acknowledgedRevision: Revision | null; readonly heldBody: ContentDocument | null; readonly mirrorBody: ContentDocument | null };
export function useDraftRecovery({ scope, variantId, initialRevision, initialBody, placements, debounceMs = DEFAULT_DEBOUNCE_MS }: DraftRecoveryOptions): DraftRecovery {
  const { submit: submitDraft } = useSaveDraft();
  const scopeKeyText = JSON.stringify(scopeKey(scope));
  const context: SaveContext = { scope, variantId, scopeKeyText, initialRevision, placements, debounceMs };
  const contextRef = useRef<SaveContext>(context);
  const initialBodyRef = useRef<ContentDocument | undefined>(initialBody);
  const acknowledgedRef = useRef<Revision>(initialRevision);
  const heldRef = useRef<HeldDraft | null>(null);
  const lastSettledRef = useRef<MutationOutcome | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const placementsOverrideRef = useRef<readonly DraftPlacementRef[] | null>(null);
  const waitersRef = useRef<Array<(outcome: MutationOutcome) => void>>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: "idle", outcome: null, acknowledgedRevision: initialRevision, heldBody: null, mirrorBody: null });
  const patch = useCallback((changes: Partial<Snapshot>): void => {
    if (mountedRef.current) setSnapshot((previous) => ({ ...previous, ...changes }));
  }, []);
  const settleWaiters = useCallback((outcome: MutationOutcome): void => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) resolve(outcome);
  }, []);
  const referenceRevision = useCallback((): Revision => acknowledgedRef.current, []);
  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => {
    contextRef.current = { scope, variantId, scopeKeyText, initialRevision, placements, debounceMs };
    initialBodyRef.current = initialBody;
  }, [scope, variantId, scopeKeyText, initialRevision, placements, debounceMs, initialBody]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const timer = timerRef.current;
      if (timer !== null) clearTimeout(timer);
      timerRef.current = null;
    };
  }, []);
  useEffect(() => {
    const entry = entryFor({ scopeKeyText, variantId });
    const startedFrom = initialBodyRef.current;
    patch({ mirrorBody: entry === null || (startedFrom !== undefined && sameBody(entry.body, startedFrom)) ? null : entry.body });
  }, [patch, scopeKeyText, variantId]);
  const send = useCallback(
    async (reference?: Revision): Promise<void> => {
      clearTimer();
      let expectedRevision = reference ?? referenceRevision();
      for (;;) {
        const held = heldRef.current;
        if (held === null || !belongsHere(held, contextRef.current)) {
          if (lastSettledRef.current !== null) settleWaiters(lastSettledRef.current);
          return;
        }
        if (inFlightRef.current) return;
        const { body } = held;
        const statedPlacements = placementsOverrideRef.current ?? contextRef.current.placements;
        placementsOverrideRef.current = null;
        inFlightRef.current = true;
        patch({ state: "saving", outcome: null, heldBody: body, mirrorBody: null });
        const outcome = await submitDraft({ scope: contextRef.current.scope, expectedRevision, payload: { variantId: held.variantId, body, ...(statedPlacements === undefined ? {} : { mediaPlacements: [...statedPlacements] }) } }).finally(() => {
          inFlightRef.current = false;
        });
        lastSettledRef.current = outcome;
        const settlement = settlementOf(outcome);
        if (settlement.confirmedRevision !== null) {
          acknowledgedRef.current = settlement.confirmedRevision;
          expectedRevision = settlement.confirmedRevision;
        }
        const newest = heldRef.current;
        const keptBody = newest === null ? null : newest.body;
        if (settlement.state === "saved" && (newest === null || newest.body === body)) {
          heldRef.current = null;
          removeMirrorEntry();
          patch({ state: "saved", outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: null, mirrorBody: null });
          settleWaiters(outcome);
          return;
        }
        if (settlement.state === "saved") {
          patch({ state: "saving", outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: keptBody, mirrorBody: null });
          continue;
        }
        patch({ state: settlement.state, outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: keptBody, mirrorBody: null });
        settleWaiters(outcome);
        return;
      }
    },
    [clearTimer, patch, referenceRevision, settleWaiters, submitDraft],
  );
  const notifyChange = useCallback(
    (body: ContentDocument, placedAs?: readonly DraftPlacementRef[]): Promise<MutationOutcome> => {
      const { scopeKeyText: currentScopeKey, variantId: currentVariantId, debounceMs: currentDebounceMs } = contextRef.current;
      if (placedAs !== undefined) placementsOverrideRef.current = placedAs;
      heldRef.current = { body, scopeKeyText: currentScopeKey, variantId: currentVariantId };
      writeMirrorEntry({ version: MIRROR_VERSION, scopeKey: currentScopeKey, variantId: currentVariantId, body, expectedRevision: referenceRevision() });
      patch({ state: "unsaved", outcome: null, heldBody: body, mirrorBody: null });
      clearTimer();
      const settled = new Promise<MutationOutcome>((resolve) => {
        waitersRef.current.push(resolve);
      });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void send();
      }, currentDebounceMs);
      return settled;
    },
    [clearTimer, patch, referenceRevision, send],
  );
  const adoptConfirmedRevision = useCallback(
    (revision: Revision): void => {
      if (inFlightRef.current) return;
      acknowledgedRef.current = revision;
      patch({ acknowledgedRevision: revision });
    },
    [patch],
  );
  const retrySameWork = useCallback((): void => {
    const held = heldRef.current;
    if (held === null || inFlightRef.current) return;
    const last = lastSettledRef.current;
    void send(last !== null && last.outcome === "conflict" ? last.currentRevision : referenceRevision());
  }, [referenceRevision, send]);
  const discardLocalRecovery = useCallback((): void => {
    if (entryFor(contextRef.current) !== null) removeMirrorEntry();
    patch({ mirrorBody: null });
  }, [patch]);
  return {
    state: snapshot.state,
    outcome: snapshot.outcome,
    acknowledgedRevision: snapshot.acknowledgedRevision,
    keptBody: keepsUnacknowledgedText(snapshot.state) ? snapshot.heldBody : null,
    localRecovery: { present: snapshot.mirrorBody !== null, body: snapshot.mirrorBody },
    notifyChange,
    adoptConfirmedRevision,
    retrySameWork,
    discardLocalRecovery,
  };
}

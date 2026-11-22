"use client";
/**
 * The autosave and readable-local-recovery hook behind the Update editor's status line.
 *
 * One named write — `saveDraft` — is debounced from the prose the worker types. Every attempt states the revision the
 * service last confirmed, so an editor holding an older view cannot overwrite a newer draft, and every answer is
 * presented as exactly the one outcome the service gave: `accepted`, `alreadyAccepted` and `unchanged` are the only
 * answers that count as acknowledgement; `conflict`, `invalid`, `unavailable` and `denied` keep the typed text beside
 * the reason; and `unknown` keeps it while offering recovery under the attempt's own identity rather than a fresh send.
 *
 * Readable local recovery — the decision this module owns, recorded once here so no second copy of it exists:
 *
 * The only carrier for text the service has not acknowledged is one single-slot, versioned, scope-keyed
 * `sessionStorage` entry, whose key and version are declared together in one constant below. `sessionStorage` is
 * chosen because the recovery has to survive the page reload that loses in-memory editor state, and because it ends
 * with the tab: text cannot leak into a later browser session, two tabs never merge their drafts, and no expiry policy
 * is needed. There is one slot and the newest unacknowledged text overwrites it, which keeps the offer unambiguous —
 * the surface labels the entry as text that exists only in this browser, and nothing here adopts, merges or re-sends it
 * on the worker's behalf. The entry is written only while text is unacknowledged and removed the instant a save is
 * acknowledged. It is read only inside a post-mount effect, so the first render is the same on the server and in the
 * browser, and every access is feature-detected and caught, so storage that is unavailable degrades to no recovery
 * offer rather than a broken editor.
 *
 * This hook is not a second owner of record state. The file-backed synthetic store stays the only owner of records,
 * the query cache holds read envelopes, and the editor's text is transient state that the entry mirrors so that a save
 * the service did not acknowledge is never a silent loss. It is also the only thing that debounces a draft save: an
 * editor surface reports every change through `notifyChange` and lets this hook decide when a save is due, because two
 * timers would make one pause produce two attempts under two identities.
 *
 * What every attempt states, and why it is stated here rather than by the caller: a draft save replaces the draft's
 * media placements with the list it carries, so an attempt that carried prose alone would erase every image and video
 * the worker had placed. The hook therefore states the list it was rendered with on every attempt, and a placement the
 * surface has just added is passed to `notifyChange`, which is also how that surface learns the outcome of the attempt
 * that placed it. A write this hook did not make — a placement it removed itself — is recorded through
 * `adoptConfirmedRevision`, so the next attempt compares against the revision the service now holds instead of a
 * superseded one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import { assertNever } from "@/lib/result";
import type { ContentDocumentJson as ContentDocument } from "@/modules/content/document";
import type { Scope } from "@/modules/data-service";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { SaveDraftPayload } from "../schemas/draft";
import { useSaveDraft } from "./use-update-mutations";

// ---------------------------------------------------------------------------------------------
// The closed status of one autosave
// ---------------------------------------------------------------------------------------------

/** The seven states this hook reports, listed once so the closed set has a runtime form beside its type. A surface that seems to need an eighth is describing one of these more precisely rather than adding a state. */
export const AUTOSAVE_STATES = ["idle", "unsaved", "saving", "saved", "failed-local-kept", "conflict", "unknown"] as const;

/**
 * One status, never a pair of flags: `idle` before anything is typed, `unsaved` for text the service has not been asked
 * about yet, `saving` while one attempt is in flight, `saved` once an attempt was acknowledged, `failed-local-kept` when
 * the answer was a refusal or an outage, `conflict` when the record moved under the editor, and `unknown` when the
 * effect may or may not have been applied. The last three all keep the text; none of them is the same answer as another.
 */
export type AutosaveState = (typeof AUTOSAVE_STATES)[number];

/** Which states mean the browser copy holds text the service has not acknowledged. Reading it is the only way a caller learns that, so `keptBody` and the recovery offer derive from this one table rather than from a flag kept beside the state. */
const MIRROR_DISPOSITION = {
  idle: "empty",
  unsaved: "holds-unacknowledged-text",
  saving: "holds-unacknowledged-text",
  saved: "empty",
  "failed-local-kept": "holds-unacknowledged-text",
  conflict: "holds-unacknowledged-text",
  unknown: "holds-unacknowledged-text",
} as const satisfies Readonly<Record<AutosaveState, "empty" | "holds-unacknowledged-text">>;

/** Whether the text on screen is text the service has not acknowledged, in which case it is kept and shown. */
function keepsUnacknowledgedText(state: AutosaveState): boolean {
  return MIRROR_DISPOSITION[state] === "holds-unacknowledged-text";
}

// ---------------------------------------------------------------------------------------------
// The browser entry that carries unacknowledged text
// ---------------------------------------------------------------------------------------------

/** The one storage key this module uses, versioned in the key so an entry written by an older shape is never mistaken for one of these. */
const MIRROR_KEY = "mysa.updates.draft-recovery.v1";

/** The shape version the entry itself states, checked on every read: a key can be copied, a version cannot be mistaken. */
const MIRROR_VERSION = 1;

/** The entry one browser tab holds: the text, the context and edition it belongs to, and the revision the next save compares against. No timestamp, because this hook reads no clock and an entry needs none. */
interface MirrorEntry {
  readonly version: typeof MIRROR_VERSION;
  readonly scopeKey: string;
  readonly variantId: string;
  readonly body: ContentDocument;
  readonly expectedRevision: Revision;
}

/** The context and edition an entry, or a held body, belongs to: the services' own scope key as text, and the edition's identity. */
type RecoveryContext = { readonly scopeKeyText: string; readonly variantId: string };

/** A body the service has not acknowledged, with the context and edition it was typed in, so a later attempt can never carry one edition's prose into another. */
type HeldDraft = { readonly body: ContentDocument; readonly scopeKeyText: string; readonly variantId: string };

/** Whether a held body belongs to the context and edition this hook is currently editing. */
function belongsHere(held: HeldDraft, context: RecoveryContext): boolean {
  return held.scopeKeyText === context.scopeKeyText && held.variantId === context.variantId;
}

/** The tab's storage, or `null` when this runtime has none or the browser refuses access to it. */
function mirrorStorage(): Storage | null {
  if (typeof window === "undefined" || !("sessionStorage" in window)) {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    // A browser that blocks storage for this origin throws on the property itself; the editor works without recovery.
    return null;
  }
}

/** The entry as this tab stored it, or `null` when there is none. An entry that cannot be read or does not state this shape is removed rather than left to be offered again. */
function readMirrorEntry(): MirrorEntry | null {
  const storage = mirrorStorage();
  if (storage === null) {
    return null;
  }
  let raw: string | null;
  try {
    raw = storage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeMirrorEntry();
    return null;
  }
  const entry = mirrorEntryOf(parsed);
  if (entry === null) {
    removeMirrorEntry();
    return null;
  }
  return entry;
}

/** Reads a parsed value as an entry of this shape, or answers `null`. The prose itself is not re-validated here: it is handed back to the editor as the text it wrote, and the save it triggers is validated before anything leaves the browser. */
function mirrorEntryOf(value: unknown): MirrorEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record["version"] !== MIRROR_VERSION) {
    return null;
  }
  const entryScopeKey = record["scopeKey"];
  const entryVariantId = record["variantId"];
  const entryRevision = record["expectedRevision"];
  const entryBody = record["body"];
  if (typeof entryScopeKey !== "string" || typeof entryVariantId !== "string" || typeof entryRevision !== "string") {
    return null;
  }
  if (typeof entryBody !== "object" || entryBody === null) {
    return null;
  }
  return { version: MIRROR_VERSION, scopeKey: entryScopeKey, variantId: entryVariantId, body: entryBody as ContentDocument, expectedRevision: entryRevision };
}

/** Writes the single slot. A full or blocked store leaves the text on screen untouched and simply offers no recovery later. */
function writeMirrorEntry(entry: MirrorEntry): void {
  const storage = mirrorStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(MIRROR_KEY, JSON.stringify(entry));
  } catch {
    return;
  }
}

/** Removes the slot, so an acknowledged save leaves nothing behind to be offered as lost work. */
function removeMirrorEntry(): void {
  const storage = mirrorStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(MIRROR_KEY);
  } catch {
    return;
  }
}

/** The entry this context and edition may recover, or `null`: an entry for another context or edition is left in place, so returning to it can still recover that text. */
function entryFor(context: RecoveryContext): MirrorEntry | null {
  const entry = readMirrorEntry();
  if (entry === null || entry.scopeKey !== context.scopeKeyText || entry.variantId !== context.variantId) {
    return null;
  }
  return entry;
}

/** Whether two documents say the same thing. Both are this application's own canonical JSON, so the comparison is exact and neither value is rewritten. */
function sameBody(left: ContentDocument, right: ContentDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------------------------
// The contract this hook answers with
// ---------------------------------------------------------------------------------------------

/** A record revision as a write states it and as the service confirms it: the edition record's revision, never a number derived here. */
export type Revision = string;

/**
 * One media placement as a save states it: the registered asset and the rendition this draft places it for. It is taken
 * from the payload the write validates, so a change to that schema reaches every caller of this option as a compile
 * error rather than as a save the service silently reads differently.
 */
export type DraftPlacementRef = NonNullable<SaveDraftPayload["mediaPlacements"]>[number];

/** What this hook needs from the editor that owns the prose. */
export type DraftRecoveryOptions = {
  readonly scope: Scope;
  readonly variantId: string;
  /** The revision the draft read returned, which is the reference the first save compares against. */
  readonly initialRevision: Revision;
  /** The text the editor started from: acknowledged by the read, so it is never mirrored and never sent until the worker changes it. */
  readonly initialBody?: ContentDocument;
  /**
   * The placements this draft holds, as its last read reported them.
   *
   * A save replaces what the draft holds with the list it states, so an attempt that stated prose alone would erase
   * every image and video the worker had placed. Every attempt therefore carries the current list, and a placement the
   * worker has just added is passed to `notifyChange` because the read that would report it has not answered yet.
   */
  readonly placements?: readonly DraftPlacementRef[];
  readonly debounceMs?: number;
};

/** The one status of an autosave, the service's last answer unchanged, the text kept, and the three actions recovery needs. */
export interface DraftRecovery {
  readonly state: AutosaveState;
  readonly outcome: MutationOutcome | null;
  /** The last revision the service confirmed, which every later attempt states as the one it saw; the read's own revision until the first acknowledgement. */
  readonly acknowledgedRevision: Revision | null;
  /** The text the service has not acknowledged, kept and shown for as long as that is true. */
  readonly keptBody: ContentDocument | null;
  /** Text this browser still holds from an attempt this editor is not showing — what a surface offers after a reload, labelled as existing only in this browser. Adopting it is that surface's own action, and it begins a normal change. */
  readonly localRecovery: { readonly present: boolean; readonly body: ContentDocument | null };
  /**
   * Reports one change: it is held, mirrored, shown as unsaved, and scheduled for the next pause.
   *
   * Answers with the one outcome the attempt carrying this text settles on, so the surface that reported the change
   * states the service's own answer instead of guessing one. A refusal resolves with that refusal and changes nothing
   * further, so the text stays exactly as typed and the worker decides what happens next.
   */
  notifyChange: (body: ContentDocument, placements?: readonly DraftPlacementRef[]) => Promise<MutationOutcome>;
  /**
   * Records a revision a write outside this hook confirmed, such as a placement this surface removed itself, so the
   * next attempt compares against the record as it now stands rather than against a revision already superseded. It is
   * ignored while an attempt is in flight, because that attempt's own answer decides the chain.
   */
  adoptConfirmedRevision: (revision: Revision) => void;
  /** Resubmits the text that was kept: against the revision the service said the record now stands at when the answer was a conflict, and otherwise under the attempt's own identity so a replay returns its stored result. */
  retrySameWork: () => void;
  /** Removes this browser's copy of unacknowledged text. It touches no record and never removes the text on screen. */
  discardLocalRecovery: () => void;
}

// ---------------------------------------------------------------------------------------------
// What a settled attempt means
// ---------------------------------------------------------------------------------------------

/** How long the editor waits after the last change before saving. Long enough that typing a sentence is one save, short enough that a pause is worth a save. */
const DEFAULT_DEBOUNCE_MS = 800;

/** The status an answer produces, and the revision it confirms when it confirms one. This is the whole of the mapping: no answer is re-labelled, and a state this switch does not name fails to compile at the `assertNever` call. */
type Settlement = { readonly state: AutosaveState; readonly confirmedRevision: Revision | null };

/** Maps the service's answer onto the one status it means, exhaustively. */
function settlementOf(outcome: MutationOutcome): Settlement {
  switch (outcome.outcome) {
    case "accepted":
      return { state: "saved", confirmedRevision: outcome.revision };
    case "alreadyAccepted":
      // The stored result of a replay is the original attempt's: it acknowledges the same text once, not twice.
      return { state: "saved", confirmedRevision: outcome.revision };
    case "unchanged":
      return { state: "saved", confirmedRevision: outcome.revision };
    case "conflict":
      return { state: "conflict", confirmedRevision: null };
    case "invalid":
      return { state: "failed-local-kept", confirmedRevision: null };
    case "unavailable":
      return { state: "failed-local-kept", confirmedRevision: null };
    case "denied":
      return { state: "failed-local-kept", confirmedRevision: null };
    case "unknown":
      return { state: "unknown", confirmedRevision: null };
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/** The latest options this hook was rendered with, read by the timer and the settled answer rather than captured when they were created. */
type SaveContext = RecoveryContext & { readonly scope: Scope; readonly initialRevision: Revision; readonly placements: readonly DraftPlacementRef[] | undefined; readonly debounceMs: number };

/** Everything this hook reports, held as one value so a status, its answer, the kept text and the browser copy always change together. */
type Snapshot = {
  readonly state: AutosaveState;
  readonly outcome: MutationOutcome | null;
  readonly acknowledgedRevision: Revision | null;
  readonly heldBody: ContentDocument | null;
  readonly mirrorBody: ContentDocument | null;
};

/**
 * Debounces `saveDraft` for one edition of an Update, carries the last acknowledged revision on every attempt, and keeps
 * the worker's text whenever the service did not acknowledge it — surfacing `accepted`, `alreadyAccepted`, `unchanged`,
 * `conflict`, `invalid`, `unavailable`, `denied` or `unknown` exactly as the service stated it.
 */
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
  // The placements one caller-reported change must state, so a placement the worker has just added travels with the save
  // that reports it rather than waiting for a read that has not answered yet. Consumed by the attempt that follows it.
  const placementsOverrideRef = useRef<readonly DraftPlacementRef[] | null>(null);
  // The surfaces waiting on the attempt that carries their change, resolved with the one outcome the service stated.
  const waitersRef = useRef<Array<(outcome: MutationOutcome) => void>>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: "idle", outcome: null, acknowledgedRevision: initialRevision, heldBody: null, mirrorBody: null });

  /** Applies one change to the reported value, and does nothing once the editor has gone: a late answer never repaints an unmounted surface. */
  const patch = useCallback((changes: Partial<Snapshot>): void => {
    if (!mountedRef.current) return;
    setSnapshot((previous) => ({ ...previous, ...changes }));
  }, []);

  /** Hands the settled answer to every surface waiting on it, once: a resumed attempt notifies the callers of the change it actually carries. */
  const settleWaiters = useCallback((outcome: MutationOutcome): void => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) resolve(outcome);
  }, []);

  /** The revision the next attempt compares against: the last one the service confirmed. */
  const referenceRevision = useCallback((): Revision => acknowledgedRef.current, []);

  /** Stops the pending pause, so one change produces one attempt. */
  const clearTimer = useCallback((): void => {
    const timer = timerRef.current;
    if (timer === null) return;
    clearTimeout(timer);
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
      // The pause is abandoned with the editor; the browser entry stays, because text the service never acknowledged
      // must still be recoverable after the reload that follows.
      const timer = timerRef.current;
      if (timer !== null) clearTimeout(timer);
      timerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Read once the component is mounted, never during render: the server render and the first browser render must
    // agree, and an entry holding the text this editor already started from would recover nothing.
    const entry = entryFor({ scopeKeyText, variantId });
    const startedFrom = initialBodyRef.current;
    const recovered = entry === null || (startedFrom !== undefined && sameBody(entry.body, startedFrom)) ? null : entry.body;
    patch({ mirrorBody: recovered });
  }, [patch, scopeKeyText, variantId]);

  /**
   * Sends the held text, then sends whatever arrived while that attempt was in flight, so one acknowledgement can admit
   * the next attempt without a second pause. Never two attempts at once: a call made while one is running returns.
   */
  const send = useCallback(
    async (reference?: Revision): Promise<void> => {
      clearTimer();
      let expectedRevision = reference ?? referenceRevision();
      for (;;) {
        const held = heldRef.current;
        // Nothing left to send: an edition this editor has left is answered by whatever carries its text next, and a body
        // this hook already sent is answered by the answer that cleared it, so no surface waits on a settled attempt.
        if (held === null || !belongsHere(held, contextRef.current)) {
          if (lastSettledRef.current !== null) settleWaiters(lastSettledRef.current);
          return;
        }
        // A second attempt never starts while one is in flight: that attempt settles the callers who arrived meanwhile.
        if (inFlightRef.current) return;
        const { body } = held;
        // The placements one caller reported travel with the attempt that reports them. Every other attempt states the list
        // the surface rendered from, so a save never erases an image or a video the worker placed.
        const statedPlacements = placementsOverrideRef.current ?? contextRef.current.placements;
        placementsOverrideRef.current = null;
        inFlightRef.current = true;
        patch({ state: "saving", outcome: null, heldBody: body, mirrorBody: null });
        // The reviewed step answers every attempt with one of the eight outcomes and never rejects, so this loop has no
        // catch: a rejection here would be a defect in that step rather than a result to present. The reset below runs
        // either way, so a fault can never leave the editor unable to save again.
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
        if (settlement.state === "saved" && (newest === null || newest.body === body)) {
          heldRef.current = null;
          removeMirrorEntry();
          patch({ state: "saved", outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: null, mirrorBody: null });
          settleWaiters(outcome);
          return;
        }
        if (settlement.state === "saved") {
          // Text arrived while this attempt was in flight: it is still unacknowledged, so it stays held and mirrored and
          // goes now, against the revision just confirmed, rather than waiting for another pause.
          patch({ state: "saving", outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: newest === null ? null : newest.body, mirrorBody: null });
          continue;
        }
        // A refusal, an outage, a conflict or an uncertain answer keeps the text exactly as typed and stops here: what
        // happens next is the worker's decision, which is why nothing below offers to re-send on its own.
        patch({ state: settlement.state, outcome, acknowledgedRevision: acknowledgedRef.current, heldBody: newest === null ? null : newest.body, mirrorBody: null });
        settleWaiters(outcome);
        return;
      }
    },
    [clearTimer, patch, referenceRevision, settleWaiters, submitDraft],
  );

  /**
   * Reports one change: it is held, mirrored, shown as unsaved, and scheduled for the next pause.
   *
   * `placements` states the media this change asks the draft to hold, for a caller that has just placed or removed
   * something the read has not reported yet; omitted, the attempt states the list this hook was rendered with.
   */
  const notifyChange = useCallback(
    (body: ContentDocument, placedAs?: readonly DraftPlacementRef[]): Promise<MutationOutcome> => {
      const { scopeKeyText: currentScopeKey, variantId: currentVariantId, debounceMs: currentDebounceMs } = contextRef.current;
      if (placedAs !== undefined) placementsOverrideRef.current = placedAs;
      heldRef.current = { body, scopeKeyText: currentScopeKey, variantId: currentVariantId };
      writeMirrorEntry({ version: MIRROR_VERSION, scopeKey: currentScopeKey, variantId: currentVariantId, body, expectedRevision: referenceRevision() });
      // The last answer described the text it answered, so it stops describing what is now on screen. The conflict
      // comparison still names the revision the service reported, because that is what makes a deliberate re-apply
      // possible. The browser entry now holds this text, but the editor is showing it: there is nothing to offer back
      // until a later page life reads the entry with this text nowhere on screen.
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

  /** Records a revision a write outside this hook confirmed, so the next attempt compares against the record as it now stands. */
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
    // A conflict is resolved against the revision the service said the record now stands at, which is the one deliberate
    // re-apply the worker asks for; every other answer is retried against the revision this editor had confirmed, so the
    // same text is the same intent and the reviewed step replays the original attempt instead of making a new one.
    void send(last !== null && last.outcome === "conflict" ? last.currentRevision : referenceRevision());
  }, [referenceRevision, send]);

  const discardLocalRecovery = useCallback((): void => {
    if (entryFor(contextRef.current) === null) {
      patch({ mirrorBody: null });
      return;
    }
    removeMirrorEntry();
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

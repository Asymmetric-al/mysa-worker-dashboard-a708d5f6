"use client";

/**
 * The private check-in editor: it fixes the question set once, states the four check-in limits before any
 * writing begins, and submits the four named check-in mutations — `saveCheckIn` (the private autosave),
 * `shareCheckIn`, `updateSharedCheckIn` and `withdrawCheckIn` — while keeping the private draft revision and
 * the shared revision visibly apart and refusing an over-limit value with the count it reached instead of
 * shortening it.
 */
import { useId, useRef, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { FormField } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import {
  CHECKIN_MAX_ANSWER_SCALARS,
  CHECKIN_MAX_QUESTION_SCALARS,
  CHECKIN_MAX_QUESTIONS,
  CHECKIN_MAX_REQUEST_BYTES,
  validateCheckInRequest,
  type CheckInPayload,
  type CheckInViolation,
} from "@/modules/coaching/checkin";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { CHECK_IN_STATE_COPY, COACHING_COPY, LIMIT_COPY, STOP_EFFECT_COPY } from "../copy";
import { useSaveCheckIn, useShareCheckIn, useUpdateSharedCheckIn, useWithdrawCheckIn } from "../hooks/use-coaching-mutations";
import type { CheckInSavePayload, CheckInSharePayload, CheckInUpdateSharedPayload, CheckInWithdrawPayload } from "../schemas/checkin";

// ---------------------------------------------------------------------------------------------
// What this surface works with: the check-in's own text, and the two revision kinds it keeps apart
// ---------------------------------------------------------------------------------------------

/** One check-in body as the family's schemas state it: the questions in the order the check-in asks them, and one answer per question, paired by position. */
export type CheckInBody = { readonly questions: readonly string[]; readonly answers: readonly string[] };

/** One question the editor is writing, with the row identity it keeps while its wording is refined. */
type EditorQuestion = { readonly id: string; readonly wording: string };

/**
 * The editor's own text for one check-in, tagged with the identity it was seeded from: a different check-in
 * re-seeds rather than inheriting the previous one's words, which is what keeps two records' writing apart
 * without an effect and without a stale draft surviving a switch.
 */
type EditorText = { readonly identity: string; readonly questions: readonly EditorQuestion[]; readonly answers: readonly string[] };

/** Which limit counter is being read: the wording of a question, or the answer written against it. */
type FocusTarget = { readonly field: "question" | "answer"; readonly position: number };

/** The state this editor shows: the check-in's own state as the two revision kinds make it. */
type EditorState = "private-draft" | "shared" | "withdrawn" | "unavailable";

export interface CheckInEditorProps {
  /** The question set frozen when the check-in started, as the record captured it; `null` while the check-in has no capture of its own yet. */
  readonly captured: { readonly questions: readonly { readonly id: string; readonly wording: string; readonly order: number }[]; readonly capturedAt: string } | null;
  /** The questions the surrounding route offers; they seed a fresh check-in and remain addable later, but a change to this list never rewrites a started one. */
  readonly questionBank?: readonly { readonly id: string; readonly wording: string }[];
  /** The private autosave and the shared revision, always two distinct objects: a coach reads the shared one and nothing else. */
  readonly revisions: {
    readonly draft: { readonly revisionId: string; readonly body: CheckInBody } | null;
    readonly shared: { readonly revisionId: string; readonly body: CheckInBody; readonly sharedAt: string; readonly withdrawnAt?: string | null } | null;
  };
  /** The check-in the three disclosure mutations name; `null` while no check-in has been saved yet, when `saveCheckIn` creates one. */
  readonly checkInId: string | null;
  /** The exact authority the mutations are submitted under; the service re-derives scope from it rather than trusting the records. */
  readonly scope: Scope;
  /** The revision the surrounding read supplied; every mutation carries it, and a save this editor completes supplies the newer one after it. */
  readonly expectedRevision: string;
  /** The interface language the surrounding document resolved, recorded on this region so nothing stored is re-rendered in another. */
  readonly locale: string;
  /** The source behind the check-in, when it cannot be read: a refusal to read is never an empty check-in. */
  readonly unavailable?: { readonly source: SourceReference } | null;
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Copy: every sentence this surface states, written once
// ---------------------------------------------------------------------------------------------

const EDITOR_HEADING = "Write a check-in";
const LIMITS_HEADING = "The limits this check-in works within";
const NO_SHORTENING_SENTENCE = "A value that crosses one of these limits is refused with the count it reached, and it is never shortened: nothing you wrote is cut down to fit, and no question leaves the set without you removing it yourself.";
const CAPTURE_SENTENCE = "The questions were fixed when this check-in started, so a change to the offered list cannot rewrite what you are already writing.";
const CAPTURED_ON_LABEL = "Captured";
const DRAFT_HEADING = "Your private draft";
const DRAFT_ONLY_SENTENCE = "Only you can read this draft: saving it writes a private revision and reaches no coach. Sharing is a separate action you take deliberately.";
const SAVE_LABEL = "Save private draft";
const SAVING_LABEL = "Saving the private draft";
const DRAFT_SAVING_SENTENCE = "Saving the private draft. Nothing you wrote is cleared while it saves.";
const DRAFT_UNSAVED_SENTENCE = "Not saved yet: this draft holds changes the saved private revision does not.";
const DRAFT_SAVED_SENTENCE = "Saved: this draft matches the private revision the source holds.";
const NO_QUESTIONS_SENTENCE = "No questions yet. Add one below or take one from the offered list; a check-in with no questions is still a private note to yourself.";
const QUESTION_LABEL = "Question";
const ANSWER_LABEL = "Answer";
const REMOVE_LABEL = "Remove this question";
const ADD_HEADING = "Add a question";
const ADD_FIELD_LABEL = "The question you want to answer";
const ADD_FIELD_DESCRIPTION = "Write it in your own words, or take one of the offered questions below.";
const ADD_BUTTON = "Add question";
const ADD_BLANK_SENTENCE = "A question needs words before it joins the set: write it above and add it again.";
const OFFERED_HEADING = "Offered questions";
const OFFERED_ADD_PREFIX = "Add";
const OFFERED_EMPTY_SENTENCE = "No offered questions came with this check-in, so every question is one you write yourself.";
const REFUSAL_TITLE = "Nothing will be sent yet";
const COMPLETION_LABEL = "Draft completion";
const FOCUS_LABEL = "Where you are";
const SHARED_HEADING = "The shared revision";
const NOT_SHARED_LABEL = "Not shared";
const SHARED_NONE_SENTENCE = "No revision is shared, so a coach can read nothing from this check-in yet.";
const SHARED_ON_LABEL = "Shared on";
const SHARED_DIFFERS_SENTENCE = "Your private draft and the shared revision hold different text, and the shared revision changes only through Update shared check-in.";
const SHARED_SAME_SENTENCE = "Your private draft and the shared revision hold the same text.";
const WITHDRAWN_NOTE = "A withdrawn revision cannot be shared again, so a new check-in would carry anything you want a coach to read next.";
const SHARE_TITLE = "Share this check-in with your coach";
const SHARE_CONFIRM = "Share with coach";
const SHARE_DESCRIPTION = "Sharing makes the saved private revision readable by the named coach, for the duration this relationship was accepted with. It sends no notification, records no interaction and creates no task.";
const SHARE_SHOWS_LABEL = "The revision that will be shared";
const SHARE_DIRTY_SENTENCE = "This shares the saved private revision, so the changes still unsaved above are not part of it.";
const SHARE_UNCLEAR_SENTENCE = "The check-in's own identity is not known here yet, so sharing has to start from its list rather than from this view.";
const UPDATE_TITLE = "Update the shared check-in";
const UPDATE_CONFIRM = "Update shared check-in";
const UPDATE_DESCRIPTION = "The answers below become the shared revision, which is the only way a shared check-in changes. This step does not save your private draft.";
const UPDATE_BLOCKED_TITLE = "This draft asks different questions from the shared revision";
const UPDATE_BLOCKED_SENTENCE = "Update shared check-in changes answers only, on the question set the shared revision captured. Answer those questions here, or share a new check-in that carries the questions you now want to ask.";
const WITHDRAW_CONFIRM = "Withdraw shared check-in";
const UNAVAILABLE_TITLE = "This check-in cannot be read right now";
const UNAVAILABLE_CONTROL_SENTENCE = "Nothing can be saved, shared, updated or withdrawn while the source cannot be read, and nothing you wrote has been lost.";
const NO_ANSWER_SENTENCE = "No answer yet.";
const UNSAVED_IDENTITY = "no-revision";
const EMPTY_ANSWERS: readonly string[] = [];

// ---------------------------------------------------------------------------------------------
// Pure readings: counts, paths and the one sentence a refusal is stated by
// ---------------------------------------------------------------------------------------------

/**
 * Unicode scalar values, which is what each check-in limit counts. `text.length` counts UTF-16 units and would
 * measure an astral character as two, refusing a question the source itself accepts.
 */
function scalarCount(text: string): number {
  return Array.from(text).length;
}

/** The calendar day a stored instant falls on, kept as the record wrote it: this surface reads no clock and assumes no zone. */
const STORED_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/u;
function storedDayText(instant: string): string {
  const written = STORED_DAY.exec(instant);
  const day = written?.[1];
  return day === undefined ? instant : day;
}

const PATH_POSITION = /\[(\d+)\]/u;
const FIELD_IN_PATH = /^(questions|answers)\[(\d+)\]/u;

/** The position a violation names, so a refusal quotes the question or answer it belongs to. */
function positionFromPath(path: string): number | null {
  const written = PATH_POSITION.exec(path);
  const digits = written?.[1];
  if (digits === undefined) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The field a violation belongs to, keyed as a form field is, so its sentence sits under the control that has to change. */
function fieldKeyOf(path: string): string | null {
  const written = FIELD_IN_PATH.exec(path);
  const family = written?.[1];
  const position = written?.[2];
  return family === undefined || position === undefined ? null : `${family}.${position}`;
}

/**
 * The one sentence a limit violation is refused with, taken from the family's limit copy so the count the value
 * reached and the limit it crossed are both named. The domain's own message answers for a reason this surface
 * cannot name better, which is why the switch keeps a default rather than inventing a sentence for it.
 */
function refusalTextOf(violation: CheckInViolation): string {
  switch (violation.reason) {
    case "too-many-questions":
      return LIMIT_COPY.questionSetExceeded(violation.measured);
    case "question-too-long": {
      const position = positionFromPath(violation.path);
      // The copy counts a question from one, which is the number the form shows beside it.
      return position === null ? violation.message : LIMIT_COPY.questionTextExceeded(position + 1, violation.measured);
    }
    case "answer-too-long": {
      const position = positionFromPath(violation.path);
      return position === null ? violation.message : LIMIT_COPY.answerTextExceeded(position + 1, violation.measured);
    }
    case "request-too-large":
      return LIMIT_COPY.requestSizeExceeded(violation.measured);
    default:
      return violation.message;
  }
}

/** The first refusal each field carries, so a control shows one sentence rather than the same one twice. */
function refusalMessagesByField(violations: readonly CheckInViolation[]): ReadonlyMap<string, string> {
  const byField = new Map<string, string>();
  for (const violation of violations) {
    const key = fieldKeyOf(violation.path);
    if (key !== null && !byField.has(key)) byField.set(key, refusalTextOf(violation));
  }
  return byField;
}

/** How long one value is against its own limit, stated in the words the refusal uses. */
function countSentence(noun: string, position: number, scalars: number, limit: number): string {
  return `${noun} ${position} is ${scalars} of ${limit} characters.`;
}

function completionSentence(answered: number, total: number): string {
  return total === 0 ? "No question has been captured yet, so there is nothing to complete." : `${answered} of ${total} questions answered.`;
}

/** How large the question set is against its own limit, stated beside the control that adds to it. */
function questionSetCountSentence(count: number): string {
  return `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions.`;
}

/** The refusal an addition earns once the set is full: the measured count and the limit, with no silent removal. */
function questionSetFullSentence(count: number): string {
  return `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions, so a further question is refused rather than added. Take one out first, and nothing here was dropped.`;
}

/** How many values stand outside a limit, so the refusal region states the fault without repeating every sentence. */
function refusalCountSentence(count: number): string {
  return count === 1
    ? "One value is outside a limit: it is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped."
    : `${count} values are outside a limit: each is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped.`;
}

/** The labels a refusal's field paths are read against, so a per-field message lands on the question or answer it names. */
function fieldLabelsOf(count: number): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (let position = 0; position < count; position += 1) {
    labels[`questions.${position}`] = `${QUESTION_LABEL} ${position + 1}`;
    labels[`answers.${position}`] = `${ANSWER_LABEL} ${position + 1}`;
  }
  return labels;
}

function focusSentence(target: FocusTarget, scalars: number): string {
  const noun = target.field === "question" ? QUESTION_LABEL : ANSWER_LABEL;
  const limit = target.field === "question" ? CHECKIN_MAX_QUESTION_SCALARS : CHECKIN_MAX_ANSWER_SCALARS;
  return `${noun} ${target.position + 1} is ${scalars} of ${limit} characters.`;
}

/** The text as one comparable value: two drafts are the same draft when their questions and answers are, in order. */
function signatureOf(questions: readonly string[], answers: readonly string[]): string {
  return JSON.stringify([questions, answers]);
}

function sameWordings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((wording, index) => wording === right[index]);
}

/**
 * The request the limits are measured on, as the domain states it: a question's order is its position in the
 * set, which is exactly the order the save stores, so the count measured here is the count the service enforces.
 * This is the surface's only limit check: the feature's own payload schemas validate the same request again
 * inside the hooks on submit, so no third rule is written here.
 */
function requestOf(questions: readonly EditorQuestion[], answers: readonly string[]): CheckInPayload {
  return {
    questions: questions.map((question, index) => ({ wording: question.wording, order: index })),
    answers: questions.map((_, index) => ({ questionOrder: index, text: answers[index] ?? "" })),
  };
}

/** The body the schemas and the payloads take: the questions in order, and one answer per question by position. */
function bodyOf(questions: readonly EditorQuestion[], answers: readonly string[]): Pick<CheckInSavePayload, "questions" | "answers"> {
  return { questions: questions.map((question) => question.wording), answers: questions.map((_, index) => answers[index] ?? "") };
}

function savedBodyOf(revisions: CheckInEditorProps["revisions"]): CheckInBody | null {
  return revisions.draft?.body ?? revisions.shared?.body ?? null;
}

/**
 * The questions the editor opens with, frozen at mount: the captured set when the record has one, then the saved
 * body, then the offered list. A change to the offered list afterwards is an addition to choose from, never a
 * rewrite of what is already being written. The capture instant is the save's to stamp — this surface reads no
 * clock and casts no value — so the wording and the order are frozen here and `saveCheckIn` captures them with the
 * record's own instant.
 */
function seededQuestions(props: CheckInEditorProps): readonly EditorQuestion[] {
  const frozen = props.captured?.questions;
  if (frozen !== undefined && frozen.length > 0) {
    return [...frozen].sort((one, two) => one.order - two.order).map((question) => ({ id: question.id, wording: question.wording }));
  }
  const saved = savedBodyOf(props.revisions);
  if (saved !== null && saved.questions.length > 0) {
    return saved.questions.map((wording, index) => ({ id: `saved-question-${index}`, wording }));
  }
  return (props.questionBank ?? []).map((question) => ({ id: question.id, wording: question.wording }));
}

function seededAnswers(props: CheckInEditorProps): readonly string[] {
  const saved = savedBodyOf(props.revisions);
  return saved === null ? EMPTY_ANSWERS : [...saved.answers];
}

function editorStateOf(unavailable: { readonly source: SourceReference } | null, hasShared: boolean, withdrawn: boolean): EditorState {
  if (unavailable !== null) return "unavailable";
  if (!hasShared) return "private-draft";
  return withdrawn ? "withdrawn" : "shared";
}

// ---------------------------------------------------------------------------------------------
// One question row
// ---------------------------------------------------------------------------------------------

type QuestionRowProps = {
  readonly position: number;
  readonly wording: string;
  readonly answer: string;
  readonly wordingRefusal: string | undefined;
  readonly answerRefusal: string | undefined;
  readonly onWording: (next: string) => void;
  readonly onAnswer: (next: string) => void;
  readonly onRemove: () => void;
  readonly onFocus: (target: FocusTarget) => void;
};

/**
 * One question and the answer written against it. The answer's label is the question's own wording, so a
 * screen-reader user hears what is being answered, and each control is described by the count it is measured by.
 */
function QuestionRow({ position, wording, answer, wordingRefusal, answerRefusal, onWording, onAnswer, onRemove, onFocus }: QuestionRowProps): ReactElement {
  const number = position + 1;
  const asked = wording.trim();
  return (
    <div data-slot="check-in-question" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <FormField label={`${QUESTION_LABEL} ${number} wording`} name={`checkin-question-${position}`} description={countSentence(QUESTION_LABEL, number, scalarCount(wording), CHECKIN_MAX_QUESTION_SCALARS)} error={wordingRefusal}>
        {(field) => (
          <Input
            id={field.id}
            name={`checkin-question-${position}`}
            value={wording}
            autoComplete="off"
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid || undefined}
            onChange={(event) => onWording(event.target.value)}
            onFocus={() => onFocus({ field: "question", position })}
          />
        )}
      </FormField>
      <FormField label={asked === "" ? `${ANSWER_LABEL} ${number}` : asked} name={`checkin-answer-${position}`} description={countSentence(ANSWER_LABEL, number, scalarCount(answer), CHECKIN_MAX_ANSWER_SCALARS)} error={answerRefusal}>
        {(field) => (
          <Textarea
            id={field.id}
            name={`checkin-answer-${position}`}
            value={answer}
            rows={4}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid || undefined}
            onChange={(event) => onAnswer(event.target.value)}
            onFocus={() => onFocus({ field: "answer", position })}
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          {REMOVE_LABEL}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------

/**
 * What withdrawal does and what it does not undo, stated in the review card and again inside the confirmation
 * dialog: a dialog that left its own consequence behind the overlay would ask someone to confirm an effect it
 * never showed them.
 */
function WithdrawEffects(): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].consequence}</p>
      <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].assurance}</p>
    </div>
  );
}

/**
 * Default export: the private check-in surface, composing the four check-in mutations (`saveCheckIn`,
 * `shareCheckIn`, `updateSharedCheckIn`, `withdrawCheckIn`) over one frozen question set, with the limits
 * stated before the first keystroke and the private draft and the shared revision held visibly apart.
 */
export default function CheckInEditor(props: CheckInEditorProps): ReactElement {
  const { revisions, checkInId, scope, expectedRevision, locale, unavailable = null, questionBank, className } = props;
  const headingId = useId();
  const limitsId = useId();
  const completionId = useId();
  const refusalId = useId();
  const identity = revisions.draft?.revisionId ?? revisions.shared?.revisionId ?? UNSAVED_IDENTITY;
  const [text, setText] = useState<EditorText>(() => ({ identity, questions: seededQuestions(props), answers: seededAnswers(props) }));
  const [draftQuestion, setDraftQuestion] = useState("");
  const [addRefusal, setAddRefusal] = useState<string | null>(null);
  const [focused, setFocused] = useState<FocusTarget | null>(null);
  const [saved, setSaved] = useState<{ readonly identity: string; readonly signature: string } | null>(null);
  const [known, setKnown] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [withdrawnHere, setWithdrawnHere] = useState(false);
  const writtenQuestions = useRef(0);
  const save = useSaveCheckIn();
  const share = useShareCheckIn();
  const updateShared = useUpdateSharedCheckIn();
  const withdraw = useWithdrawCheckIn();

  // A different check-in re-seeds the editor instead of inheriting the previous one's words: the identity is the
  // revision the route supplied, so switching records is visible without an effect and no stale draft survives it.
  const active: EditorText = text.identity === identity ? text : { identity, questions: seededQuestions(props), answers: seededAnswers(props) };
  const { questions, answers } = active;
  const violations = validateCheckInRequest(requestOf(questions, answers));
  const refusalByField = refusalMessagesByField(violations);
  const formRefusals = violations.filter((violation) => fieldKeyOf(violation.path) === null).map(refusalTextOf);
  const body = bodyOf(questions, answers);
  const signature = signatureOf(body.questions, body.answers);
  const savedBody = savedBodyOf(revisions);
  const savedSignature = saved !== null && saved.identity === identity ? saved.signature : savedBody === null ? null : signatureOf(savedBody.questions, savedBody.answers);
  const dirty = signature !== savedSignature;
  const answered = questions.filter((_, index) => (answers[index] ?? "").trim() !== "").length;
  // The revision this editor knows last: the one the read supplied, replaced by the one its own accepted save
  // created, so saving and then sharing is one continuous piece of work rather than a stale write.
  const effectiveRevision = known !== null && known.from === expectedRevision ? known.revision : expectedRevision;
  const effectiveCheckInId = checkInId ?? createdId;
  const shared = revisions.shared;
  const sharedWithdrawn = shared !== null && ((shared.withdrawnAt ?? null) !== null || withdrawnHere);
  const sharedCopy = shared === null ? null : CHECK_IN_STATE_COPY[sharedWithdrawn ? "withdrawn" : "shared"];
  const sharedDiffers = shared !== null && signatureOf(shared.body.questions, shared.body.answers) !== signature;
  const state = editorStateOf(unavailable, shared !== null, sharedWithdrawn);
  const readable = unavailable === null;
  const canSave = readable && violations.length === 0;
  const focusedScalars = focused === null ? 0 : focused.field === "question" ? scalarCount(questions[focused.position]?.wording ?? "") : scalarCount(answers[focused.position] ?? "");
  const offered = (questionBank ?? []).filter((question) => !questions.some((captured) => captured.id === question.id));

  const updateText = (next: { readonly questions?: readonly EditorQuestion[]; readonly answers?: readonly string[] }): void => {
    setText({ identity, questions: next.questions ?? questions, answers: next.answers ?? answers });
  };
  const changeWording = (position: number, wording: string): void => {
    updateText({ questions: questions.map((question, index) => (index === position ? { id: question.id, wording } : question)) });
  };
  const changeAnswer = (position: number, answer: string): void => {
    updateText({ answers: questions.map((_, index) => (index === position ? answer : answers[index] ?? "")) });
  };
  const removeQuestion = (position: number): void => {
    setAddRefusal(null);
    updateText({
      questions: questions.filter((_, index) => index !== position),
      answers: questions.map((_, index) => answers[index] ?? "").filter((_, index) => index !== position),
    });
  };
  const addQuestion = (id: string, wording: string): void => {
    if (questions.length >= CHECKIN_MAX_QUESTIONS) {
      setAddRefusal(questionSetFullSentence(questions.length));
      return;
    }
    setAddRefusal(null);
    updateText({ questions: [...questions, { id, wording }], answers: [...questions.map((_, index) => answers[index] ?? ""), ""] });
  };
  const addWrittenQuestion = (): void => {
    const wording = draftQuestion.trim();
    if (wording === "") {
      setAddRefusal(ADD_BLANK_SENTENCE);
      return;
    }
    const id = `written-question-${writtenQuestions.current}`;
    writtenQuestions.current += 1;
    addQuestion(id, wording);
    // The typed wording is cleared only once it joined the set, so a refusal leaves every word where it was.
    if (questions.length < CHECKIN_MAX_QUESTIONS) setDraftQuestion("");
  };

  /**
   * What a settled outcome means for the text on screen: only an outcome that testifies an effect updates the
   * revision this editor writes against, and only a save updates the saved-draft baseline. A refusal, a conflict
   * or an unconfirmed result leaves the editor's own words exactly as they are.
   */
  const adoptOutcome = (outcome: MutationOutcome, submittedSignature: string | null): void => {
    if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted" && outcome.outcome !== "unchanged") return;
    setKnown({ from: expectedRevision, revision: outcome.revision });
    if (outcome.outcome !== "unchanged") {
      const created = outcome.created?.[0];
      if (created !== undefined) setCreatedId(created);
    }
    if (submittedSignature !== null) setSaved({ identity, signature: submittedSignature });
  };

  const savePayload: CheckInSavePayload = { ...(effectiveCheckInId === null ? {} : { checkInId: effectiveCheckInId }), questions: body.questions, answers: body.answers };
  const sharePayload: CheckInSharePayload | null =
    readable && shared === null && effectiveCheckInId !== null && savedBody !== null ? { checkInId: effectiveCheckInId, questions: [...savedBody.questions], answers: [...savedBody.answers] } : null;
  const sharedWordings = shared?.body.questions ?? [];
  const questionsMatchShared = shared !== null && sameWordings(questions.map((question) => question.wording), sharedWordings);
  const updatePayload: CheckInUpdateSharedPayload | null =
    readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null && questionsMatchShared && violations.length === 0
      ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId, questions: [...sharedWordings], answers: questions.map((_, index) => answers[index] ?? "") }
      : null;
  const withdrawPayload: CheckInWithdrawPayload | null =
    readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId } : null;

  // The private save is this check-in's autosave path: it writes only the private revision and carries the revision
  // the editor read. It runs when the worker saves rather than on a background timer, so nothing is submitted while
  // they are still writing and no intent is ever submitted twice by two paths.
  const submitSave = (): void => {
    if (!canSave || save.isPending) return;
    const submitted = signature;
    save.mutate({ scope, expectedRevision: effectiveRevision, payload: savePayload }, { onSuccess: (outcome) => adoptOutcome(outcome, submitted) });
  };
  const saveReplayable = save.data !== undefined && (save.data.outcome === "unavailable" || save.data.outcome === "unknown");

  const blockedReason =
    unavailable !== null ? (
      <p className="text-sm text-pretty text-destructive wrap-anywhere">{UNAVAILABLE_CONTROL_SENTENCE}</p>
    ) : violations.length === 0 ? null : (
      <Alert variant="destructive">
        <AlertTitle>{REFUSAL_TITLE}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{refusalCountSentence(violations.length)}</p>
          {formRefusals.length === 0 ? null : (
            <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4">
              {formRefusals.map((sentence) => (
                <li key={sentence} className="min-w-0 wrap-anywhere">
                  {sentence}
                </li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    );

  return (
    <section aria-labelledby={headingId} data-slot="check-in-editor" data-interface-locale={locale} data-check-in-state={state} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h2 id={headingId}>{EDITOR_HEADING}</h2>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{COACHING_COPY.checkIns.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2" aria-labelledby={limitsId}>
            <h3 id={limitsId} className="text-sm font-medium">
              {LIMITS_HEADING}
            </h3>
            <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4 text-sm text-pretty text-muted-foreground">
              <li className="wrap-anywhere">
                At most <bdi className="tabular-figures">{CHECKIN_MAX_QUESTIONS}</bdi> questions in one check-in.
              </li>
              <li className="wrap-anywhere">
                At most <bdi className="tabular-figures">{CHECKIN_MAX_QUESTION_SCALARS}</bdi> characters in a question, counted one per Unicode character, so a character outside the basic plane counts once.
              </li>
              <li className="wrap-anywhere">
                At most <bdi className="tabular-figures">{CHECKIN_MAX_ANSWER_SCALARS}</bdi> characters in an answer, counted the same way.
              </li>
              <li className="wrap-anywhere">
                At most <bdi className="tabular-figures">{CHECKIN_MAX_REQUEST_BYTES}</bdi> bytes once the whole check-in is sent.
              </li>
            </ul>
            <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{NO_SHORTENING_SENTENCE}</p>
          </div>
          {focused === null ? null : (
            <p className="text-sm text-muted-foreground wrap-anywhere">
              {FOCUS_LABEL}: {focusSentence(focused, focusedScalars)}
            </p>
          )}
        </CardContent>
      </Card>

      {unavailable === null ? null : <StateNotice kind="unavailable" title={UNAVAILABLE_TITLE} description={COACHING_COPY.checkIns.unavailable} source={unavailable.source} headingLevel={3} />}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="flex min-w-0 flex-wrap items-center gap-2">
              {DRAFT_HEADING}
              <Badge variant="secondary">{CHECK_IN_STATE_COPY["private-draft"].label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{CHECK_IN_STATE_COPY["private-draft"].description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{DRAFT_ONLY_SENTENCE}</p>
          <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">
            {CAPTURE_SENTENCE}
            {props.captured === null ? null : (
              <>
                {" "}
                {CAPTURED_ON_LABEL} <bdi className="mono-identifier">{storedDayText(props.captured.capturedAt)}</bdi>.
              </>
            )}
          </p>
          <div className="flex min-w-0 flex-col gap-2">
            <p id={completionId} className="text-sm text-pretty">
              <span className="font-medium">{COMPLETION_LABEL}</span> {completionSentence(answered, questions.length)}
            </p>
            {questions.length === 0 ? null : <Progress value={answered} max={questions.length} aria-label={COMPLETION_LABEL} aria-describedby={completionId} />}
          </div>
          <div id={refusalId} aria-live="polite" aria-atomic="true" data-slot="check-in-refusal" className="flex min-w-0 flex-col gap-2">
            {blockedReason}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {questions.map((question, position) => (
              <QuestionRow
                key={question.id}
                position={position}
                wording={question.wording}
                answer={answers[position] ?? ""}
                wordingRefusal={refusalByField.get(`questions.${position}`)}
                answerRefusal={refusalByField.get(`answers.${position}`)}
                onWording={(next) => changeWording(position, next)}
                onAnswer={(next) => changeAnswer(position, next)}
                onRemove={() => removeQuestion(position)}
                onFocus={setFocused}
              />
            ))}
            {questions.length === 0 ? <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{NO_QUESTIONS_SENTENCE}</p> : null}
          </div>
          <Separator />
          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="text-sm font-medium">{ADD_HEADING}</h4>
            <FormField label={ADD_FIELD_LABEL} name="checkin-new-question" description={ADD_FIELD_DESCRIPTION}>
              {(field) => (
                <Input id={field.id} name="checkin-new-question" value={draftQuestion} autoComplete="off" aria-describedby={field.describedBy} onChange={(event) => setDraftQuestion(event.target.value)} />
              )}
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={addWrittenQuestion}>
                {ADD_BUTTON}
              </Button>
              <p className="text-sm text-muted-foreground">{questionSetCountSentence(questions.length)}</p>
            </div>
            {addRefusal === null ? null : <output className="block text-sm text-pretty text-destructive wrap-anywhere">{addRefusal}</output>}
            <div className="flex min-w-0 flex-col gap-2">
              <h5 className="text-sm font-medium">{OFFERED_HEADING}</h5>
              {offered.length === 0 ? (
                <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{OFFERED_EMPTY_SENTENCE}</p>
              ) : (
                <ul className="flex min-w-0 flex-col items-start gap-2">
                  {offered.map((question) => (
                    <li key={question.id} className="min-w-0 max-w-full">
                      <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-2 whitespace-normal text-start" onClick={() => addQuestion(question.id, question.wording)}>
                        {`${OFFERED_ADD_PREFIX}: `}
                        <bdi className="wrap-anywhere">{question.wording}</bdi>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Separator />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={submitSave} disabled={!canSave || save.isPending} aria-describedby={canSave ? undefined : refusalId}>
                {save.isPending ? SAVING_LABEL : SAVE_LABEL}
              </Button>
              <output className="text-sm text-pretty text-muted-foreground wrap-anywhere">{save.isPending ? DRAFT_SAVING_SENTENCE : dirty ? DRAFT_UNSAVED_SENTENCE : DRAFT_SAVED_SENTENCE}</output>
            </div>
            {save.data === undefined ? null : (
              <OperationResult outcome={save.data} headingLevel={4} fieldLabels={fieldLabelsOf(questions.length)} {...(saveReplayable ? { onRetrySameWork: submitSave } : {})} />
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="flex min-w-0 flex-wrap items-center gap-2">
              {SHARED_HEADING}
              <Badge variant={sharedWithdrawn ? "outline" : "secondary"}>{sharedCopy === null ? NOT_SHARED_LABEL : sharedCopy.label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{sharedCopy === null ? SHARED_NONE_SENTENCE : sharedCopy.description}</CardDescription>
        </CardHeader>
        {shared === null ? null : (
          <CardContent className="flex min-w-0 flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {SHARED_ON_LABEL} <bdi className="mono-identifier">{storedDayText(shared.sharedAt)}</bdi>.
            </p>
            <ol className="flex min-w-0 list-decimal flex-col gap-3 ps-4">
              {shared.body.questions.map((question, position) => {
                const answer = shared.body.answers[position] ?? "";
                return (
                  <li key={`shared-${position}`} className="min-w-0 text-pretty">
                    <span className="block font-medium wrap-anywhere">
                      <bdi>{question}</bdi>
                    </span>
                    <span className="block text-muted-foreground wrap-anywhere">{answer.trim() === "" ? NO_ANSWER_SENTENCE : <bdi>{answer}</bdi>}</span>
                  </li>
                );
              })}
            </ol>
            <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{sharedDiffers ? SHARED_DIFFERS_SENTENCE : SHARED_SAME_SENTENCE}</p>
            {sharedWithdrawn ? <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{WITHDRAWN_NOTE}</p> : null}
          </CardContent>
        )}
      </Card>

      {savedBody === null || shared !== null || effectiveCheckInId !== null ? null : <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{SHARE_UNCLEAR_SENTENCE}</p>}

      {sharePayload === null ? null : (
        <ActionReview<CheckInSharePayload>
          title={SHARE_TITLE}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-pretty">{SHARE_SHOWS_LABEL}</p>
              {savedBody === null ? null : (
                <ol className="flex min-w-0 list-decimal flex-col gap-2 ps-4">
                  {savedBody.questions.map((question, position) => {
                    const answer = savedBody.answers[position] ?? "";
                    return (
                      <li key={`share-${position}`} className="min-w-0">
                        <span className="block font-medium wrap-anywhere">
                          <bdi>{question}</bdi>
                        </span>
                        <span className="block wrap-anywhere">{answer.trim() === "" ? NO_ANSWER_SENTENCE : <bdi>{answer}</bdi>}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {dirty ? <p className="text-pretty">{SHARE_DIRTY_SENTENCE}</p> : null}
            </div>
          }
          consequence={<p className="text-sm text-pretty wrap-anywhere">{SHARE_DESCRIPTION}</p>}
          confirmLabel={SHARE_CONFIRM}
          headingLevel={3}
          input={{ scope, expectedRevision: effectiveRevision, payload: sharePayload }}
          submit={async (input) => share.mutateAsync({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId })}
          onSettled={(outcome) => adoptOutcome(outcome, null)}
        />
      )}

      {shared === null || sharedWithdrawn || questionsMatchShared ? null : (
        <Alert>
          <AlertTitle>{UPDATE_BLOCKED_TITLE}</AlertTitle>
          <AlertDescription>
            <p className="text-pretty wrap-anywhere">{UPDATE_BLOCKED_SENTENCE}</p>
          </AlertDescription>
        </Alert>
      )}

      {updatePayload === null ? null : (
        <ActionReview<CheckInUpdateSharedPayload>
          title={UPDATE_TITLE}
          description={
            <ol className="flex min-w-0 list-decimal flex-col gap-2 ps-4">
              {questions.map((question, position) => {
                const answer = answers[position] ?? "";
                return (
                  <li key={`update-${position}`} className="min-w-0">
                    <span className="block font-medium wrap-anywhere">
                      <bdi>{question.wording}</bdi>
                    </span>
                    <span className="block wrap-anywhere">{answer.trim() === "" ? NO_ANSWER_SENTENCE : <bdi>{answer}</bdi>}</span>
                  </li>
                );
              })}
            </ol>
          }
          consequence={<p className="text-sm text-pretty wrap-anywhere">{UPDATE_DESCRIPTION}</p>}
          confirmLabel={UPDATE_CONFIRM}
          headingLevel={3}
          input={{ scope, expectedRevision: effectiveRevision, payload: updatePayload }}
          submit={async (input) => updateShared.mutateAsync({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId })}
          onSettled={(outcome) => adoptOutcome(outcome, null)}
        />
      )}

      {withdrawPayload === null ? null : (
        <ActionReview<CheckInWithdrawPayload>
          title={STOP_EFFECT_COPY["withdraw-check-in"].title}
          description={<WithdrawEffects />}
          consequence={<WithdrawEffects />}
          confirmLabel={WITHDRAW_CONFIRM}
          consequential
          headingLevel={3}
          input={{ scope, expectedRevision: effectiveRevision, payload: withdrawPayload }}
          submit={async (input) => withdraw.mutateAsync({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId })}
          onSettled={(outcome) => {
            adoptOutcome(outcome, null);
            if (outcome.outcome === "accepted" || outcome.outcome === "unchanged") setWithdrawnHere(true);
          }}
        />
      )}
    </section>
  );
}


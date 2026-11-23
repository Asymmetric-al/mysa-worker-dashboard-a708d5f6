"use client";
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
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES, validateCheckInRequest, type CheckInPayload, type CheckInViolation } from "@/modules/coaching/checkin";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { CHECK_IN_STATE_COPY, COACHING_COPY, LIMIT_COPY, STOP_EFFECT_COPY } from "../copy";
import { useSaveCheckIn, useShareCheckIn, useUpdateSharedCheckIn, useWithdrawCheckIn } from "../hooks/use-coaching";
import { storedDayText } from "./sharing-summary";
import type { CheckInSavePayload, CheckInSharePayload, CheckInUpdateSharedPayload, CheckInWithdrawPayload } from "../schemas";
import { Panel } from "./panel";
export type CheckInBody = { readonly questions: readonly string[]; readonly answers: readonly string[] };
type EditorQuestion = { readonly id: string; readonly wording: string };
type EditorText = { readonly identity: string; readonly questions: readonly EditorQuestion[]; readonly answers: readonly string[] };
type FocusTarget = { readonly field: "question" | "answer"; readonly position: number };
type EditorState = "private-draft" | "shared" | "withdrawn" | "unavailable";
export interface CheckInEditorProps {
  readonly captured: { readonly questions: readonly { readonly id: string; readonly wording: string; readonly order: number }[]; readonly capturedAt: string } | null;
  readonly questionBank?: readonly { readonly id: string; readonly wording: string }[];
  readonly revisions: { readonly draft: { readonly revisionId: string; readonly body: CheckInBody } | null; readonly shared: { readonly revisionId: string; readonly body: CheckInBody; readonly sharedAt: string; readonly withdrawnAt?: string | null } | null };
  readonly checkInId: string | null;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly locale: string;
  readonly unavailable?: { readonly source: SourceReference } | null;
  readonly className?: string;
}
const SAVE_LABEL = "Save private draft";
const SAVING_LABEL = "Saving the private draft";
const DRAFT_SAVING_SENTENCE = "Saving the private draft. Nothing you wrote is cleared while it saves.";
const DRAFT_UNSAVED_SENTENCE = "Not saved yet: this draft holds changes the saved private revision does not.";
const DRAFT_SAVED_SENTENCE = "Saved: this draft matches the private revision the source holds.";
const QUESTION_LABEL = "Question";
const ANSWER_LABEL = "Answer";
const ADD_BLANK_SENTENCE = "A question needs words before it joins the set: write it above and add it again.";
const COMPLETION_LABEL = "Draft completion";
const NOT_SHARED_LABEL = "Not shared";
const SHARED_NONE_SENTENCE = "No revision is shared, so a coach can read nothing from this check-in yet.";
const SHARED_DIFFERS_SENTENCE = "Your private draft and the shared revision hold different text, and the shared revision changes only through Update shared check-in.";
const SHARED_SAME_SENTENCE = "Your private draft and the shared revision hold the same text.";
const NO_ANSWER_SENTENCE = "No answer yet.";
const UNSAVED_IDENTITY = "no-revision";
const EMPTY_ANSWERS: readonly string[] = [];
const scalarCount = (text: string): number => Array.from(text).length;
const PATH_POSITION = /\[(\d+)\]/u;
const FIELD_IN_PATH = /^(questions|answers)\[(\d+)\]/u;
const positionFromPath = (path: string): number | null => {
  const digits = PATH_POSITION.exec(path)?.[1];
  return digits === undefined || !Number.isFinite(Number.parseInt(digits, 10)) ? null : Number.parseInt(digits, 10);
};
const fieldKeyOf = (path: string): string | null => {
  const [, family, position] = FIELD_IN_PATH.exec(path) ?? [];
  return family === undefined || position === undefined ? null : `${family}.${position}`;
};
function refusalTextOf(violation: CheckInViolation): string {
  switch (violation.reason) {
    case "too-many-questions":
      return LIMIT_COPY.questionSetExceeded(violation.measured);
    case "question-too-long": {
      const position = positionFromPath(violation.path);
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
function refusalMessagesByField(violations: readonly CheckInViolation[]): ReadonlyMap<string, string> {
  const byField = new Map<string, string>();
  for (const violation of violations) {
    const key = fieldKeyOf(violation.path);
    if (key !== null && !byField.has(key)) byField.set(key, refusalTextOf(violation));
  }
  return byField;
}
const countSentence = (noun: string, position: number, scalars: number, limit: number): string => `${noun} ${position} is ${scalars} of ${limit} characters.`;
const completionSentence = (answered: number, total: number): string => (total === 0 ? "No question has been captured yet, so there is nothing to complete." : `${answered} of ${total} questions answered.`);
const questionSetCountSentence = (count: number): string => `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions.`;
const questionSetFullSentence = (count: number): string => `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions, so a further question is refused rather than added. Take one out first, and nothing here was dropped.`;
const refusalCountSentence = (count: number): string =>
  count === 1
    ? "One value is outside a limit: it is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped."
    : `${count} values are outside a limit: each is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped.`;
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
const signatureOf = (questions: readonly string[], answers: readonly string[]): string => JSON.stringify([questions, answers]);
const sameWordings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((wording, index) => wording === right[index]);
const requestOf = (questions: readonly EditorQuestion[], answers: readonly string[]): CheckInPayload => ({ questions: questions.map((question, index) => ({ wording: question.wording, order: index })), answers: questions.map((_, index) => ({ questionOrder: index, text: answers[index] ?? "" })) });
const bodyOf = (questions: readonly EditorQuestion[], answers: readonly string[]): Pick<CheckInSavePayload, "questions" | "answers"> => ({ questions: questions.map((question) => question.wording), answers: questions.map((_, index) => answers[index] ?? "") });
const savedBodyOf = (revisions: CheckInEditorProps["revisions"]): CheckInBody | null => revisions.draft?.body ?? revisions.shared?.body ?? null;
function seededQuestions(props: CheckInEditorProps): readonly EditorQuestion[] {
  const frozen = props.captured?.questions;
  if (frozen !== undefined && frozen.length > 0) return [...frozen].sort((one, two) => one.order - two.order).map((question) => ({ id: question.id, wording: question.wording }));
  const saved = savedBodyOf(props.revisions);
  if (saved !== null && saved.questions.length > 0) return saved.questions.map((wording, index) => ({ id: `saved-question-${index}`, wording }));
  return (props.questionBank ?? []).map((question) => ({ id: question.id, wording: question.wording }));
}
const seededAnswers = (props: CheckInEditorProps): readonly string[] => savedBodyOf(props.revisions)?.answers.slice() ?? EMPTY_ANSWERS;
const editorStateOf = (unavailable: { readonly source: SourceReference } | null, hasShared: boolean, withdrawn: boolean): EditorState => (unavailable !== null ? "unavailable" : !hasShared ? "private-draft" : withdrawn ? "withdrawn" : "shared");
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
function QuestionRow({ position, wording, answer, wordingRefusal, answerRefusal, onWording, onAnswer, onRemove, onFocus }: QuestionRowProps): ReactElement {
  const number = position + 1;
  const asked = wording.trim();
  return (
    <div data-slot="check-in-question" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <FormField label={`${QUESTION_LABEL} ${number} wording`} name={`checkin-question-${position}`} description={countSentence(QUESTION_LABEL, number, scalarCount(wording), CHECKIN_MAX_QUESTION_SCALARS)} error={wordingRefusal}>
        {(field) => <Input id={field.id} name={`checkin-question-${position}`} value={wording} autoComplete="off" aria-describedby={field.describedBy} aria-invalid={field.invalid || undefined} onChange={(event) => onWording(event.target.value)} onFocus={() => onFocus({ field: "question", position })} />}
      </FormField>
      <FormField label={asked === "" ? `${ANSWER_LABEL} ${number}` : asked} name={`checkin-answer-${position}`} description={countSentence(ANSWER_LABEL, number, scalarCount(answer), CHECKIN_MAX_ANSWER_SCALARS)} error={answerRefusal}>
        {(field) => <Textarea id={field.id} name={`checkin-answer-${position}`} value={answer} rows={4} aria-describedby={field.describedBy} aria-invalid={field.invalid || undefined} onChange={(event) => onAnswer(event.target.value)} onFocus={() => onFocus({ field: "answer", position })} />}
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button {...{ type: "button", variant: "ghost", size: "sm", onClick: onRemove }}>{"Remove this question"}</Button>
      </div>
    </div>
  );
}
const ANSWER_LIST_CLASS = "flex min-w-0 list-decimal flex-col gap-2 ps-4";
const SHARED_REVISION_LIST_CLASS = "flex min-w-0 list-decimal flex-col gap-3 ps-4";
type AnswerListProps = { readonly questions: readonly string[]; readonly answers: readonly string[]; readonly keyPrefix: string; readonly listClassName?: string; readonly muted?: boolean };
/** One ordered read of a question set, written once: the shared revision, the review of what sharing makes readable and the review of an update state the same pairs, so all three render this list. */
const AnswerList = ({ questions, answers, keyPrefix, listClassName = ANSWER_LIST_CLASS, muted = false }: AnswerListProps): ReactElement => (
  <ol className={listClassName}>
    {questions.map((question, position) => {
      const answer = answers[position] ?? "";
      return (
        <li key={`${keyPrefix}-${String(position)}`} className="min-w-0 text-pretty">
          <span className="block font-medium wrap-anywhere">
            <bdi>{question}</bdi>
          </span>
          <span className={cn("block wrap-anywhere", muted && "text-muted-foreground")}>{answer.trim() === "" ? NO_ANSWER_SENTENCE : <bdi>{answer}</bdi>}</span>
        </li>
      );
    })}
  </ol>
);
const WithdrawEffects = (): ReactElement => (
  <div className="flex min-w-0 flex-col gap-2">
    <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].consequence}</p>
    <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].assurance}</p>
  </div>
);
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
    updateText({ answers: questions.map((_, index) => (index === position ? answer : (answers[index] ?? ""))) });
  };
  const removeQuestion = (position: number): void => {
    setAddRefusal(null);
    updateText({ questions: questions.filter((_, index) => index !== position), answers: questions.map((_, index) => answers[index] ?? "").filter((_, index) => index !== position) });
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
    if (questions.length < CHECKIN_MAX_QUESTIONS) setDraftQuestion("");
  };
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
  const sharePayload: CheckInSharePayload | null = readable && shared === null && effectiveCheckInId !== null && savedBody !== null ? { checkInId: effectiveCheckInId, questions: [...savedBody.questions], answers: [...savedBody.answers] } : null;
  const sharedWordings = shared?.body.questions ?? [];
  const questionsMatchShared =
    shared !== null &&
    sameWordings(
      questions.map((question) => question.wording),
      sharedWordings,
    );
  const updatePayload: CheckInUpdateSharedPayload | null =
    readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null && questionsMatchShared && violations.length === 0 ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId, questions: [...sharedWordings], answers: questions.map((_, index) => answers[index] ?? "") } : null;
  const withdrawPayload: CheckInWithdrawPayload | null = readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId } : null;
  const submitSave = (): void => {
    if (!canSave || save.isPending) return;
    const submitted = signature;
    save.mutate({ scope, expectedRevision: effectiveRevision, payload: savePayload }, { onSuccess: (outcome) => adoptOutcome(outcome, submitted) });
  };
  const saveReplayable = save.data !== undefined && (save.data.outcome === "unavailable" || save.data.outcome === "unknown");
  const blockedReason =
    unavailable !== null ? (
      <p className="text-sm text-pretty text-destructive wrap-anywhere">{"Nothing can be saved, shared, updated or withdrawn while the source cannot be read, and nothing you wrote has been lost."}</p>
    ) : violations.length === 0 ? null : (
      <Alert variant="destructive">
        <AlertTitle>{"Nothing will be sent yet"}</AlertTitle>
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
      <Panel titleId={headingId} headingLevel={2} title={"Write a check-in"} description={COACHING_COPY.checkIns.purpose} descriptionClassName="text-pretty wrap-anywhere" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2" aria-labelledby={limitsId}>
          <h3 {...{ id: limitsId, className: "text-sm font-medium" }}>{"The limits this check-in works within"}</h3>
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
          <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"A value that crosses one of these limits is refused with the count it reached, and it is never shortened: nothing you wrote is cut down to fit, and no question leaves the set without you removing it yourself."}</p>
        </div>
        {focused === null ? null : (
          <p className="text-sm text-muted-foreground wrap-anywhere">
            {"Where you are"}: {focusSentence(focused, focusedScalars)}
          </p>
        )}
      </Panel>
      {unavailable === null ? null : <StateNotice kind="unavailable" title={"This check-in cannot be read right now"} description={COACHING_COPY.checkIns.unavailable} source={unavailable.source} headingLevel={3} />}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="flex min-w-0 flex-wrap items-center gap-2">
              {"Your private draft"}
              <Badge variant="secondary">{CHECK_IN_STATE_COPY["private-draft"].label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{CHECK_IN_STATE_COPY["private-draft"].description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"Only you can read this draft: saving it writes a private revision and reaches no coach. Sharing is a separate action you take deliberately."}</p>
          <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">
            {"The questions were fixed when this check-in started, so a change to the offered list cannot rewrite what you are already writing."}
            {props.captured === null ? null : (
              <>
                {" "}
                {"Captured"} <bdi className="mono-identifier">{storedDayText(props.captured.capturedAt)}</bdi>.
              </>
            )}
          </p>
          <div className="flex min-w-0 flex-col gap-2">
            <p id={completionId} className="text-sm text-pretty">
              <span className="font-medium">{COMPLETION_LABEL}</span> {completionSentence(answered, questions.length)}{" "}
            </p>
            {questions.length === 0 ? null : <Progress value={answered} max={questions.length} aria-label={COMPLETION_LABEL} aria-describedby={completionId} />}
          </div>
          <div {...{ id: refusalId, "aria-live": "polite", "aria-atomic": "true", "data-slot": "check-in-refusal", className: "flex min-w-0 flex-col gap-2" }}>{blockedReason}</div>
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
            {questions.length === 0 ? <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"No questions yet. Add one below or take one from the offered list; a check-in with no questions is still a private note to yourself."}</p> : null}
          </div>
          <Separator />
          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="text-sm font-medium">{"Add a question"}</h4>
            <FormField label={"The question you want to answer"} name="checkin-new-question" description={"Write it in your own words, or take one of the offered questions below."}>
              {(field) => <Input id={field.id} name="checkin-new-question" value={draftQuestion} autoComplete="off" aria-describedby={field.describedBy} onChange={(event) => setDraftQuestion(event.target.value)} />}
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "secondary", onClick: addWrittenQuestion }}>{"Add question"}</Button>
              <p className="text-sm text-muted-foreground">{questionSetCountSentence(questions.length)}</p>
            </div>
            {addRefusal === null ? null : <output className="block text-sm text-pretty text-destructive wrap-anywhere">{addRefusal}</output>}
            <div className="flex min-w-0 flex-col gap-2">
              <h5 className="text-sm font-medium">{"Offered questions"}</h5>
              {offered.length === 0 ? (
                <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"No offered questions came with this check-in, so every question is one you write yourself."}</p>
              ) : (
                <ul className="flex min-w-0 flex-col items-start gap-2">
                  {offered.map((question) => (
                    <li key={question.id} className="min-w-0 max-w-full">
                      <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-2 whitespace-normal text-start" onClick={() => addQuestion(question.id, question.wording)}>
                        {`Add: `}
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
              <Button {...{ type: "button", onClick: submitSave, disabled: !canSave || save.isPending, "aria-describedby": canSave ? undefined : refusalId }}>{save.isPending ? SAVING_LABEL : SAVE_LABEL}</Button>
              <output className="text-sm text-pretty text-muted-foreground wrap-anywhere">{save.isPending ? DRAFT_SAVING_SENTENCE : dirty ? DRAFT_UNSAVED_SENTENCE : DRAFT_SAVED_SENTENCE}</output>
            </div>
            {save.data === undefined ? null : <OperationResult outcome={save.data} headingLevel={4} fieldLabels={fieldLabelsOf(questions.length)} {...(saveReplayable ? { onRetrySameWork: submitSave } : {})} />}
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="flex min-w-0 flex-wrap items-center gap-2">
              {"The shared revision"}
              <Badge variant={sharedWithdrawn ? "outline" : "secondary"}>{sharedCopy === null ? NOT_SHARED_LABEL : sharedCopy.label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{sharedCopy === null ? SHARED_NONE_SENTENCE : sharedCopy.description}</CardDescription>
        </CardHeader>
        {shared === null ? null : (
          <CardContent className="flex min-w-0 flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {"Shared on"} <bdi className="mono-identifier">{storedDayText(shared.sharedAt)}</bdi>.
            </p>
            <AnswerList questions={shared.body.questions} answers={shared.body.answers} keyPrefix="shared" listClassName={SHARED_REVISION_LIST_CLASS} muted />
            <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{sharedDiffers ? SHARED_DIFFERS_SENTENCE : SHARED_SAME_SENTENCE}</p>
            {sharedWithdrawn ? <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"A withdrawn revision cannot be shared again, so a new check-in would carry anything you want a coach to read next."}</p> : null}
          </CardContent>
        )}
      </Card>
      {savedBody === null || shared !== null || effectiveCheckInId !== null ? null : <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{"The check-in's own identity is not known here yet, so sharing has to start from its list rather than from this view."}</p>}
      {sharePayload === null ? null : (
        <ActionReview<CheckInSharePayload>
          title={"Share this check-in with your coach"}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-pretty">{"The revision that will be shared"}</p>
              {savedBody === null ? null : <AnswerList questions={savedBody.questions} answers={savedBody.answers} keyPrefix="share" />}
              {dirty ? <p className="text-pretty">{"This shares the saved private revision, so the changes still unsaved above are not part of it."}</p> : null}
            </div>
          }
          consequence={<p className="text-sm text-pretty wrap-anywhere">{"Sharing makes the saved private revision readable by the named coach, for the duration this relationship was accepted with. It sends no notification, records no interaction and creates no task."}</p>}
          confirmLabel={"Share with coach"}
          headingLevel={3}
          input={{ scope, expectedRevision: effectiveRevision, payload: sharePayload }}
          submit={async (input) => share.mutateAsync({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId })}
          onSettled={(outcome) => adoptOutcome(outcome, null)}
        />
      )}
      {shared === null || sharedWithdrawn || questionsMatchShared ? null : (
        <Alert>
          <AlertTitle>{"This draft asks different questions from the shared revision"}</AlertTitle>
          <AlertDescription>
            <p className="text-pretty wrap-anywhere">{"Update shared check-in changes answers only, on the question set the shared revision captured. Answer those questions here, or share a new check-in that carries the questions you now want to ask."}</p>
          </AlertDescription>
        </Alert>
      )}
      {updatePayload === null ? null : (
        <ActionReview<CheckInUpdateSharedPayload>
          title={"Update the shared check-in"}
          description={<AnswerList questions={questions.map((question) => question.wording)} answers={answers} keyPrefix="update" />}
          consequence={<p className="text-sm text-pretty wrap-anywhere">{"The answers below become the shared revision, which is the only way a shared check-in changes. This step does not save your private draft."}</p>}
          confirmLabel={"Update shared check-in"}
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
          confirmLabel={"Withdraw shared check-in"}
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

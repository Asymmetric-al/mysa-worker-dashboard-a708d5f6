"use client";

/**
 * Contact import, step one — Choose file: the file the journey will import, the four limits it will be
 * measured against, and the disclosure that this import is simulated.
 *
 * Scope: AAP 0.10.1 family "Contact import" ("a five-step journey (Choose file → Map → Validate and
 * review → Selectively accept → Results) over UTF-8 CSV within displayed limits") and criterion 4;
 * 0.8.7's four fixed import limits, which must be *displayed* as well as enforced and are stated here
 * before a file is chosen; 0.7.2 ("each simulated effect is labelled at the point the user triggers
 * it"), which is why the importer's own sentence is rendered beside this control; 0.11.1's
 * `features/import/**` row. Step one only: this surface chooses a file and opens step two. It parses
 * nothing, maps nothing, decides no row and imports nothing.
 *
 * What it hands back, and why that is all it hands back. `ImportFileSelection` is
 * `{ fileName, byteLength, contentBase64 }` from the journey hook: the file's own name, its own byte
 * count as the browser reports it, and its bytes as base64 for the service to decode. Nothing here
 * inspects those bytes, types the file by its extension or its name, or measures it against a limit —
 * a second opinion about what a file is would be an authority the importer would then have to
 * contradict, and every one of those judgements belongs to `@/modules/import/parse`, which the service
 * runs. The control carries no `accept` filter for the same reason: narrowing the system dialog by
 * extension would say a file is one thing because its name ends in it.
 *
 * Where the limits and the disclosure sit. The four limits are rendered above the control, because a
 * limit shown after a file is chosen is a warning and a limit shown before it is a promise; each row's
 * label, number and sentence come from `LIMIT_ROWS`, which builds them from the descriptors the
 * importer measures against. The simulation label sits immediately after the control, in the compact
 * inline form `simulation-label` renders by default, so the sentence that this import is synthetic is
 * read before anything is parsed — the same placement the media picker gives its own effect.
 *
 * State, deliberately thin. The only state is what the browser is doing with the file right now: it is
 * being read, or the browser failed to read it. Which file was chosen is the journey's state, not this
 * surface's, so re-entering the step shows the file the worker already chose instead of an empty
 * control. No clock, no parsing, no fingerprinting and no storage: nothing here writes a value the
 * journey could not have given it, so a reload restarts the journey at this step rather than
 * resurrecting half of it.
 *
 * Direction and size. Only logical utilities are used (`ps-*`, `text-start`), so a right-to-left block
 * mirrors itself; every filename, size and limit value is isolated in `<bdi>`, so a mixed-direction
 * filename cannot reorder the number beside it. Nothing here has a fixed width and the long sentences
 * wrap, so the step completes at 320 CSS px without the page scrolling sideways, and every control
 * keeps a target of at least 24x24 CSS px (WCAG 2.5.8).
 *
 * It renders on the server as well as in the browser: `FileReader` is constructed inside the change
 * handler and nowhere else, so no browser API runs at module scope or during a render.
 */

import { useId, useState, type ChangeEvent, type ReactElement } from "react";

import { FormField } from "@/components/form-field";
import SimulationLabel from "@/components/simulation-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CHOOSE_FILE_COPY, IMPORT_SIMULATION_EFFECT, LIMIT_ROWS, chosenFileSize } from "../copy";
import type { ImportFileSelection } from "../hooks/use-import-journey";

/**
 * Reads one chosen file's bytes as base64.
 *
 * `readAsDataURL` answers `<media type>;base64,<payload>`, so the payload after the first comma is the
 * file's own bytes in the encoding the service decodes; an empty file answers an empty payload, which
 * is a real case the importer refuses with its own reason rather than a case this surface hides. The
 * read is a browser operation, which is why it lives here and is called from the change handler only.
 */
function readContentBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("The browser could not read the chosen file."));
    };

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("The browser read the chosen file as something other than a data URL."));
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator === -1 ? "" : result.slice(separator + 1));
    };

    reader.readAsDataURL(file);
  });
}

/** Props of {@link FileChooser}. */
export interface FileChooserProps {
  /** The file the journey holds, so returning to this step shows what was chosen; absent before that. */
  readonly selection: ImportFileSelection | undefined;
  /**
   * Hands the chosen file back to the journey, which mints the proposal's operation identity for it:
   * choosing a different file is a changed intent, and only the journey may decide that.
   */
  readonly onChoose: (selection: ImportFileSelection) => void;
  /** Moves the journey to step two, which the journey decides is open once a file is held. */
  readonly onContinue: () => void;
}

/**
 * Step one of the contact import: choose one UTF-8 CSV file, read the limits it will be held to, and
 * open step two.
 *
 * The limits and the chosen file's facts are read from the copy module and the journey's own selection;
 * the bytes travel unchanged to whichever surface submits the proposal, so this file states no rule the
 * importer enforces and no fact about the file's contents.
 */
export default function FileChooser({
  selection,
  onChoose,
  onContinue,
}: FileChooserProps): ReactElement {
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const limitsHeadingId = useId();
  const chosenFileHeadingId = useId();
  const continueHintId = useId();

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    /* The control is cleared first, so choosing the same file again after a failed read still fires a
     * change: a file input reports nothing for a value it already holds. */
    event.target.value = "";

    if (chosen === null) {
      return;
    }

    setReadError(null);
    setReading(true);

    void readContentBase64(chosen).then(
      (contentBase64) => {
        setReading(false);
        onChoose({ fileName: chosen.name, byteLength: chosen.size, contentBase64 });
      },
      () => {
        setReading(false);
        setReadError(CHOOSE_FILE_COPY.readFailed);
      },
    );
  };

  const continueUnavailable = selection === undefined || reading;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* The limits come first: a limit read before a file is chosen is a rule the worker can meet. */}
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p id={limitsHeadingId} className="font-medium">
          {CHOOSE_FILE_COPY.limitsHeading}
        </p>
        <p className="text-pretty text-muted-foreground">{CHOOSE_FILE_COPY.limitsLead}</p>
        <ul
          aria-labelledby={limitsHeadingId}
          className="flex list-disc flex-col gap-1 ps-5 text-pretty text-muted-foreground"
        >
          {LIMIT_ROWS.map((limit) => (
            <li key={limit.key}>
              <span className="font-medium text-foreground">{limit.label}: </span>
              <bdi>{limit.value}</bdi>
              <span className="block">{limit.message}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <FormField
          label={CHOOSE_FILE_COPY.fileLabel}
          name="file"
          description={CHOOSE_FILE_COPY.fileHint}
          error={readError ?? undefined}
          required
        >
          {({ id, describedBy, invalid, required }) => (
            <Input
              id={id}
              type="file"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required={required}
              className="h-auto cursor-pointer py-2"
              disabled={reading}
              onChange={handleFileInputChange}
            />
          )}
        </FormField>
        {/* Beside the control that triggers the effect, and before anything is parsed. */}
        <SimulationLabel effect={IMPORT_SIMULATION_EFFECT} />
        {reading ? (
          <output className="text-sm text-muted-foreground">
            {CHOOSE_FILE_COPY.readingLabel}
          </output>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p id={chosenFileHeadingId} className="font-medium">
          {CHOOSE_FILE_COPY.chosenFileHeading}
        </p>
        {selection === undefined ? (
          <p className="text-pretty text-muted-foreground">{CHOOSE_FILE_COPY.noFileChosen}</p>
        ) : (
          <dl aria-labelledby={chosenFileHeadingId} className="flex flex-col gap-1">
            <div className="flex min-w-0 flex-wrap gap-x-1">
              <dt className="text-muted-foreground">{CHOOSE_FILE_COPY.fileNameLabel}:</dt>
              <dd className="min-w-0 wrap-anywhere">
                <bdi>{selection.fileName}</bdi>
              </dd>
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-1">
              <dt className="text-muted-foreground">{CHOOSE_FILE_COPY.fileSizeLabel}:</dt>
              <dd className="min-w-0">
                <bdi>{chosenFileSize(selection.byteLength)}</bdi>
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          disabled={continueUnavailable}
          aria-describedby={selection === undefined ? continueHintId : undefined}
          onClick={onContinue}
        >
          {CHOOSE_FILE_COPY.continueLabel}
        </Button>
        {selection === undefined ? (
          <p id={continueHintId} className="text-sm text-pretty text-muted-foreground">
            {CHOOSE_FILE_COPY.continueBlocked}
          </p>
        ) : null}
      </div>
    </div>
  );
}

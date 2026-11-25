"use client";
import { useCallback, useId, useState, type ChangeEvent, type ReactElement } from "react";
import { FormField } from "@/components/form-field";
import SimulationLabel from "@/components/simulation-label";
import { Button } from "@/components/ui/button";
import { FileTypeBadge, FileUploadDropzone } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { useFileUpload } from "@/hooks/use-file-upload";
import { fileSizeRefusal } from "@/modules/import/parse";
import { CHOOSE_FILE_COPY, IMPORT_SIMULATION_EFFECT, LIMIT_ROWS, chosenFileSize } from "../copy";
import type { ImportFileSelection } from "../hooks/use-import-journey";
import FactRow from "./fact-row";
/** The committed example file, served from this application's own public directory: a plain download rather than a route, so a worker with no file in hand can read what this step accepts and choosing the downloaded copy opens the same review any other file does. */
const readContentBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The browser could not read the chosen file."));
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
export type FileChooserProps = { readonly selection: ImportFileSelection | undefined; readonly onChoose: (selection: ImportFileSelection) => void; readonly onContinue: () => void };
export default function FileChooser({ selection, onChoose, onContinue }: FileChooserProps): ReactElement {
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const limitsHeadingId = useId();
  const chosenFileHeadingId = useId();
  const continueHintId = useId();

  const processChosenFile = useCallback(
    (chosen: File): void => {
      // The displayed file-size limit is judged on the file's own size before a byte of it is read, so a file the importer could never accept is not read in this browser and never becomes a request: the sentence is the importer's own, and the clause beside it states that nothing was read and nothing was sent.
      const refusal = fileSizeRefusal(chosen.size);
      if (refusal !== null) {
        setReadError(CHOOSE_FILE_COPY.sizeLimitRefused(refusal.message));
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
    },
    [onChoose],
  );

  const { isDragging, dropHandlers } = useFileUpload({ disabled: reading, onFile: processChosenFile });

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (chosen === null) return;
    processChosenFile(chosen);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/80 bg-surface-subtle p-4 text-sm">
        <p id={limitsHeadingId} className="font-medium text-foreground">
          {CHOOSE_FILE_COPY.limitsHeading}
        </p>
        <p className="type-supporting text-pretty">{CHOOSE_FILE_COPY.limitsLead}</p>
        <ul aria-labelledby={limitsHeadingId} className="flex list-disc flex-col gap-1.5 ps-5 text-pretty text-muted-foreground">
          {LIMIT_ROWS.map((limit) => (
            <li key={limit.key}>
              <span className="font-medium text-foreground">{limit.label}: </span> <bdi>{limit.value}</bdi> <span className="block">{limit.message}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Offered before the control, for the worker who has no file in hand: the example is a download, and choosing it is the same review as any other file. */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/80 bg-card p-4 text-sm shadow-2xs">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="font-medium text-foreground">{CHOOSE_FILE_COPY.exampleHeading}</p>
          <p className="type-supporting text-pretty">{CHOOSE_FILE_COPY.exampleLead}</p>
          <a href="/fixtures/contacts-example.csv" download className="inline-flex min-h-6 w-fit items-center font-medium text-primary inline-link">
            {CHOOSE_FILE_COPY.exampleLinkLabel}
          </a>
        </div>
        <FileTypeBadge kind="csv" />
      </div>
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <FileUploadDropzone
          isDragging={isDragging}
          disabled={reading}
          heading={isDragging ? "Drop your CSV file here" : "Drop a CSV file here or choose from your device"}
          description="Your file is checked against the size limit before a single byte is read."
          {...dropHandlers}
        >
          <FormField label={CHOOSE_FILE_COPY.fileLabel} name="file" description={CHOOSE_FILE_COPY.fileHint} error={readError ?? undefined} required>
            {({ id, describedBy, invalid, required }) => <Input id={id} type="file" aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} className="h-auto cursor-pointer bg-card py-2" disabled={reading} onChange={handleFileInputChange} />}
          </FormField>
        </FileUploadDropzone>
        <SimulationLabel effect={IMPORT_SIMULATION_EFFECT} />
        {reading ? <output className="text-sm text-muted-foreground">{CHOOSE_FILE_COPY.readingLabel}</output> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border/80 bg-surface-subtle p-4 text-sm">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p id={chosenFileHeadingId} className="font-medium text-foreground">
            {CHOOSE_FILE_COPY.chosenFileHeading}
          </p>
          {selection === undefined ? null : <FileTypeBadge fileName={selection.fileName} />}
        </div>
        {selection === undefined ? (
          <p className="type-supporting text-pretty">{CHOOSE_FILE_COPY.noFileChosen}</p>
        ) : (
          <dl aria-labelledby={chosenFileHeadingId} className="flex flex-col gap-1.5">
            <FactRow label={CHOOSE_FILE_COPY.fileNameLabel} value={selection.fileName} />
            <FactRow label={CHOOSE_FILE_COPY.fileSizeLabel} value={chosenFileSize(selection.byteLength)} wrap={false} />
          </dl>
        )}
      </div>
      <div className="flex flex-col items-start gap-2">
        <Button type="button" disabled={selection === undefined || reading} aria-describedby={selection === undefined ? continueHintId : undefined} onClick={onContinue}>
          {CHOOSE_FILE_COPY.continueLabel}
        </Button>
        {selection === undefined ? (
          <p id={continueHintId} className="type-supporting text-pretty">
            {CHOOSE_FILE_COPY.continueBlocked}
          </p>
        ) : null}
      </div>
    </div>
  );
}

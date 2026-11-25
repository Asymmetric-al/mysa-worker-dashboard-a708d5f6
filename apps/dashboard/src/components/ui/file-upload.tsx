"use client";
import * as React from "react";
import { CaptionsIcon, FileIcon, FileSpreadsheetIcon, FileUpIcon, FilmIcon, ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { inferFileTypeKind, type FileTypeKind } from "@/hooks/use-file-upload";

const FILE_TYPE_META: Readonly<Record<FileTypeKind, { readonly label: string; readonly icon: React.ComponentType<{ readonly className?: string }> }>> = {
  csv: { label: "CSV", icon: FileSpreadsheetIcon },
  image: { label: "IMG", icon: ImageIcon },
  video: { label: "VID", icon: FilmIcon },
  captions: { label: "VTT", icon: CaptionsIcon },
  document: { label: "FILE", icon: FileIcon },
};

export type FileTypeBadgeProps = {
  readonly fileName?: string;
  readonly kind?: FileTypeKind;
  readonly className?: string;
};

/** ReUI-inspired document type badge (`@reui/file-type`) rendered strictly with Maia Zinc tokens. */
export function FileTypeBadge({ fileName, kind, className }: FileTypeBadgeProps) {
  const resolved = kind ?? (fileName === undefined ? "document" : inferFileTypeKind(fileName));
  const meta = FILE_TYPE_META[resolved];
  const Icon = meta.icon;
  return (
    <span
      data-slot="file-type-badge"
      data-file-kind={resolved}
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/80 bg-surface-subtle px-2 py-1 text-xs font-medium text-foreground shadow-2xs", className)}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="mono-identifier">{meta.label}</span>
    </span>
  );
}

export type FileUploadDropzoneProps = React.ComponentProps<"div"> & {
  readonly isDragging?: boolean;
  readonly disabled?: boolean;
  readonly heading?: string;
  readonly description?: string;
};

/** ReUI-inspired dropzone surface (`@reui/file-upload`) wrapping a native file input while keeping the input directly accessible by label. */
export function FileUploadDropzone({ isDragging = false, disabled = false, heading, description, className, children, ...props }: FileUploadDropzoneProps) {
  return (
    <div
      data-slot="file-upload-dropzone"
      data-dragging={isDragging ? "true" : "false"}
      aria-disabled={disabled ? true : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed p-4 transition-colors sm:p-5",
        isDragging ? "border-foreground bg-secondary/70 ring-2 ring-ring/40" : "border-input/70 bg-surface-subtle/70 hover:border-foreground/50",
        disabled && "opacity-70",
        className,
      )}
      {...props}
    >
      {heading === undefined && description === undefined ? null : (
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-card text-foreground shadow-2xs", isDragging && "bg-primary text-primary-foreground")}>
            <FileUpIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {heading === undefined ? null : <p className="text-sm font-medium text-foreground">{heading}</p>}
            {description === undefined ? null : <p className="text-xs text-muted-foreground text-pretty">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

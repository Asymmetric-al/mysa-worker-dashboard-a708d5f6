"use client";
import { useCallback, useRef, useState, type DragEvent } from "react";

/** Pure helper: resolves the first file from a file list or drop event, optionally enforcing an extension/MIME filter. */
export function pickSingleFile(files: ArrayLike<File> | null | undefined): File | null {
  if (files === null || files === undefined || files.length === 0) return null;
  return files[0] ?? null;
}

/** Pure helper: human-readable file type key inferred strictly for UI iconography (never authoritative for ingestion). */
export type FileTypeKind = "csv" | "image" | "video" | "captions" | "document";

export function inferFileTypeKind(fileName: string): FileTypeKind {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp") || lower.endsWith(".gif")) return "image";
  if (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov")) return "video";
  if (lower.endsWith(".vtt") || lower.endsWith(".srt")) return "captions";
  return "document";
}

export type UseFileUploadOptions = {
  readonly disabled?: boolean;
  readonly onFile: (file: File) => void;
};

export type UseFileUploadApi = {
  readonly isDragging: boolean;
  readonly dropHandlers: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
};

/** ReUI-inspired zero-dependency drag-and-drop hook (`use-file-upload`) using depth counting so child elements never flicker drag state. */
export function useFileUpload({ disabled = false, onFile }: UseFileUploadOptions): UseFileUploadApi {
  const depthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (disabled) return;
      depthRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (disabled) return;
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      depthRef.current = 0;
      setIsDragging(false);
      if (disabled) return;
      const dropped = pickSingleFile(event.dataTransfer?.files);
      if (dropped !== null) onFile(dropped);
    },
    [disabled, onFile],
  );

  return { isDragging, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

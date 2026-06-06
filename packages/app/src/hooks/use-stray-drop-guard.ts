import { useEffect } from "react";

/**
 * Window-level safety net against the webview navigating to a file when
 * one is dropped outside a handled drop target. Tauri runs with
 * `dragDropEnabled: false`, so an unhandled file drop is treated like a
 * browser drop and opens the file.
 *
 * Scoped to file drags ("Files" in dataTransfer.types) so the category
 * reorder drag (a non-file dnd-kit drag) is untouched. Only preventDefault
 * — never stopPropagation, never reads the files — so legitimate targets
 * (Capy overlay, import zone) still receive their own React drop events.
 */
export function useStrayDropGuard(): void {
  useEffect(() => {
    const carriesFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

    const onDragOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}

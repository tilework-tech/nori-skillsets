/**
 * Per-file change list formatting helpers.
 *
 * Used by the upload flow to display skill/subagent collision `fileChanges`
 * (path-level added/modified/removed entries) in clack notes and in the
 * "Use Existing" discard-count hint.
 */

import type { FileChange } from "@/api/registrar.js";

/**
 * Render a flat, uncolored per-file change list for display in a clack note.
 *
 * One line per file, sorted by path (ASCII). Each line contains the path, the
 * status word, and a `(binary)` marker for binary files. The `existingContent`
 * field is never rendered; callers only see the path-level summary.
 *
 * @param args - The function arguments
 * @param args.fileChanges - Per-file change entries from the collision payload
 *
 * @returns Multi-line string, or empty string if the list is empty
 */
export const formatFileChangesForNote = (args: {
  fileChanges: ReadonlyArray<FileChange>;
}): string => {
  const { fileChanges } = args;
  if (fileChanges.length === 0) return "";

  const sorted = [...fileChanges].sort((a, b) => a.path.localeCompare(b.path));
  const lines: Array<string> = [];
  for (const change of sorted) {
    const binaryMarker = change.isBinary ? " (binary)" : "";
    lines.push(`  ${change.path} - ${change.status}${binaryMarker}`);
  }
  return lines.join("\n");
};

/**
 * Build the "Use Existing" discard-clause hint. When `count` is > 0 the clause
 * is pluralized against the count; otherwise falls back to generic messaging
 * used for older registrars that did not return `fileChanges`.
 *
 * @param args - The function arguments
 * @param args.count - Number of file changes that would be discarded
 *
 * @returns Discard hint string
 */
export const formatDiscardHint = (args: { count: number }): string => {
  const { count } = args;
  if (count <= 0) {
    return "Note that this will discard any local changes.";
  }
  const noun = count === 1 ? "file change" : "file changes";
  return `Note that this will discard ${count} ${noun}.`;
};

/**
 * Count the number of entries in an optional fileChanges list.
 *
 * Returns 0 when the list is null, undefined, or empty. Used to pluralize the
 * "Use Existing" discard-count hint and to decide whether to render a note.
 *
 * @param args - The function arguments
 * @param args.fileChanges - Optional per-file change entries
 *
 * @returns The number of changed files (0 when absent or empty)
 */
export const countFileChanges = (args: {
  fileChanges?: ReadonlyArray<FileChange> | null;
}): number => {
  const { fileChanges } = args;
  if (fileChanges == null) return 0;
  return fileChanges.length;
};

/**
 * Produce a compact tally string grouped by status for non-interactive output.
 *
 * Example: `"2 added, 1 modified, 1 removed"`. Status groups with zero count
 * are omitted. Returns empty string when there are no changes.
 *
 * @param args - The function arguments
 * @param args.fileChanges - Optional per-file change entries
 *
 * @returns A tally string, or empty string when list is empty/missing
 */
export const summarizeFileChangeCounts = (args: {
  fileChanges?: ReadonlyArray<FileChange> | null;
}): string => {
  const { fileChanges } = args;
  if (fileChanges == null || fileChanges.length === 0) return "";

  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const change of fileChanges) {
    if (change.status === "added") added++;
    else if (change.status === "modified") modified++;
    else if (change.status === "removed") removed++;
  }

  const parts: Array<string> = [];
  if (added > 0) parts.push(`${added} added`);
  if (modified > 0) parts.push(`${modified} modified`);
  if (removed > 0) parts.push(`${removed} removed`);
  return parts.join(", ");
};

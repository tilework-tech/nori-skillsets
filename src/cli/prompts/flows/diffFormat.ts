/**
 * Shared diff formatting utility
 *
 * Provides colored unified diff output for terminal display.
 * Used by both the upload flow (skill conflict resolution) and
 * the switch flow (local change viewing).
 */

import { diffLines } from "diff";

import { green, red } from "@/cli/logger.js";

/**
 * Format a diff for terminal display with colored +/- lines
 *
 * @param args - The function arguments
 * @param args.existingContent - The original/existing content
 * @param args.localContent - The current/local content
 *
 * @returns Formatted diff string for display in a note
 */
export const formatDiffForNote = (args: {
  existingContent: string;
  localContent: string;
}): string => {
  const { existingContent, localContent } = args;
  const changes = diffLines(existingContent, localContent);
  const lines: Array<string> = [];

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, "").split("\n");
    for (const line of changeLines) {
      if (change.added) {
        lines.push(green({ text: `+ ${line}` }));
      } else if (change.removed) {
        lines.push(red({ text: `- ${line}` }));
      } else {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join("\n");
};

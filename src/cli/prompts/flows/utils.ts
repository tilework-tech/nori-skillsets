/**
 * Flow utility functions
 *
 * Shared helpers for clack prompt flows.
 */

import { isCancel, cancel } from "@clack/prompts";

/**
 * Unwrap a clack prompt result, handling cancellation.
 *
 * Returns the value if not cancelled, or null if the user cancelled.
 * Displays a cancel message via clack's cancel() when cancelled.
 *
 * @param args - Unwrap arguments
 * @param args.value - The raw prompt result (may be a cancel symbol)
 * @param args.cancelMessage - Optional message to display on cancel
 *
 * @returns The unwrapped value, or null if cancelled
 */
export const unwrapPrompt = <T>(args: {
  value: T | symbol;
  cancelMessage?: string | null;
}): T | null => {
  const { value, cancelMessage } = args;
  if (isCancel(value)) {
    cancel(cancelMessage ?? "Operation cancelled.");
    return null;
  }
  return value as T;
};

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

/**
 * Wrap a download-flow callback so failures it reports are also surfaced to
 * the caller.
 *
 * Download flows resolve to null for BOTH a user cancel and a
 * callback-reported failure (search `status: "error"` or download
 * `success: false`). Commands wrap their callbacks with this so they can
 * tell a real failure (exit nonzero) apart from a cancel (exit zero).
 *
 * @param args - Wrap arguments
 * @param args.fn - The flow callback to wrap
 * @param args.onFailure - Called with the error message when the callback reports one
 *
 * @returns The wrapped callback
 */
export const recordFlowFailure = <T extends object>(args: {
  fn: () => Promise<T>;
  onFailure: (error: string) => void;
}): (() => Promise<T>) => {
  const { fn, onFailure } = args;
  return async () => {
    const result = await fn();
    if ("error" in result && typeof result.error === "string") {
      onFailure(result.error);
    }
    return result;
  };
};

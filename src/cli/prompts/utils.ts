/**
 * Prompts cancel handling utilities
 *
 * Provides wrappers around clack/prompts cancel handling functions
 * for consistent cancel behavior across the CLI.
 */

import { cancel, isCancel as clackIsCancel } from "@clack/prompts";

/**
 * Check if a value represents a cancelled operation
 *
 * @param args - Check arguments
 * @param args.value - The value to check
 *
 * @returns True if the value represents a cancellation
 */
export const isCancel = (args: { value: unknown }): boolean => {
  const { value } = args;
  return clackIsCancel(value);
};

/**
 * Handle a cancelled operation by displaying a message and exiting
 *
 * This function never returns - it always calls process.exit(0).
 *
 * @param args - Handler arguments
 * @param args.message - Optional custom cancellation message
 */
export const handleCancel = (args?: { message?: string | null }): never => {
  const message = args?.message ?? "Operation cancelled.";
  cancel(message);
  process.exit(0);
};

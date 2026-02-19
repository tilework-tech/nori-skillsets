/**
 * Prompts cancel handling utilities
 *
 * Provides wrappers around clack/prompts cancel handling functions
 * for consistent cancel behavior across the CLI.
 */

import { cancel } from "@clack/prompts";

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

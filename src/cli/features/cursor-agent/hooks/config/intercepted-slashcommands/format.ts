/**
 * Formatting utilities for cursor-agent intercepted slash command output
 *
 * NOTE: Cursor IDE does not render ANSI escape codes in its UI chat interface.
 * Unlike Claude Code which runs in a terminal, Cursor's hook output is displayed
 * in a web-based UI that shows raw escape sequences as text.
 *
 * Therefore, this module uses plain text with Unicode symbols for visual distinction.
 */

// Unicode symbols for visual distinction (no ANSI codes)
const SUCCESS_SYMBOL = "\u2713"; // ✓
const ERROR_SYMBOL = "\u2717"; // ✗

/**
 * Format a success message with a checkmark symbol
 *
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message prefixed with a success symbol
 */
export const formatSuccess = (args: { message: string }): string => {
  const { message } = args;
  return `${SUCCESS_SYMBOL} ${message}`;
};

/**
 * Format an error message with an X symbol
 *
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message prefixed with an error symbol
 */
export const formatError = (args: { message: string }): string => {
  const { message } = args;
  return `${ERROR_SYMBOL} ${message}`;
};

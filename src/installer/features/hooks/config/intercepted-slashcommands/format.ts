/**
 * Formatting utilities for intercepted slash command output
 */

import wrapAnsi from "wrap-ansi";

// ANSI color codes
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

// Default terminal width for pre-wrapping
// Using 80 as a conservative default that works for most terminals
const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Get the terminal width for text wrapping
 * Uses process.stdout.columns if available, otherwise falls back to default
 *
 * @returns The terminal width in columns
 */
const getTerminalWidth = (): number => {
  return process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
};

/**
 * Format a message with color, handling both explicit newlines and soft terminal wraps
 * 1. Pre-wraps text at terminal width (converting soft wraps to hard newlines)
 * 2. Wraps each resulting line with color codes
 * This ensures colors persist across all line breaks
 * @param args - The function arguments
 * @param args.message - The message to format
 * @param args.color - The ANSI color code to apply
 *
 * @returns The message with colors that persist across line wraps
 */
const formatWithColor = (args: { message: string; color: string }): string => {
  const { message, color } = args;
  const terminalWidth = getTerminalWidth();

  // First, pre-wrap the plain text at terminal width
  // This converts soft wraps into explicit newlines
  const wrappedText = wrapAnsi(message, terminalWidth, { hard: true });

  // Then wrap each line with color codes
  // This ensures colors persist across both explicit and soft-wrapped lines
  return wrappedText
    .split("\n")
    .map((line) => `${color}${line}${NC}`)
    .join("\n");
};

/**
 * Format a success message with green color
 * Pre-wraps text at terminal width and applies color per line to ensure
 * colors persist across both explicit newlines and soft terminal wraps
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message formatted with green color
 */
export const formatSuccess = (args: { message: string }): string => {
  const { message } = args;
  return formatWithColor({ message, color: GREEN });
};

/**
 * Format an error message with red color
 * Pre-wraps text at terminal width and applies color per line to ensure
 * colors persist across both explicit newlines and soft terminal wraps
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message formatted with red color
 */
export const formatError = (args: { message: string }): string => {
  const { message } = args;
  return formatWithColor({ message, color: RED });
};

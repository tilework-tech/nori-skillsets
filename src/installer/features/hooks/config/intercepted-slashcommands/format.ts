/**
 * Formatting utilities for intercepted slash command output
 */

// ANSI color codes
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

/**
 * Wrap each line of a message with color codes
 * This ensures colors persist across terminal line wraps
 * @param args - The function arguments
 * @param args.message - The message to format
 * @param args.color - The ANSI color code to apply
 *
 * @returns The message with each line wrapped in color codes
 */
const wrapLinesWithColor = (args: {
  message: string;
  color: string;
}): string => {
  const { message, color } = args;
  return message
    .split("\n")
    .map((line) => `${color}${line}${NC}`)
    .join("\n");
};

/**
 * Format a success message with green color
 * Wraps each line separately to ensure colors persist across terminal line wraps
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message with each line wrapped in green ANSI codes
 */
export const formatSuccess = (args: { message: string }): string => {
  const { message } = args;
  return wrapLinesWithColor({ message, color: GREEN });
};

/**
 * Format an error message with red color
 * Wraps each line separately to ensure colors persist across terminal line wraps
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message with each line wrapped in red ANSI codes
 */
export const formatError = (args: { message: string }): string => {
  const { message } = args;
  return wrapLinesWithColor({ message, color: RED });
};

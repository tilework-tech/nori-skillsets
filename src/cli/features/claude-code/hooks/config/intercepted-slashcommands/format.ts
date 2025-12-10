/**
 * Formatting utilities for intercepted slash command output
 */

// ANSI color codes
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

/**
 * Color each word in a line individually
 * This ensures colors persist when the terminal re-wraps at any width
 *
 * @param args - The function arguments
 * @param args.line - The line to color
 * @param args.color - The ANSI color code to apply
 *
 * @returns The line with each word colored individually
 */
const colorLineWords = (args: { line: string; color: string }): string => {
  const { line, color } = args;

  if (line.length === 0) {
    return "";
  }

  // Use regex to split while preserving whitespace structure
  // This matches sequences of non-space characters (words) or sequences of spaces
  const tokens = line.match(/\S+|\s+/g) ?? [];

  return tokens
    .map((token) => {
      // Only color non-whitespace tokens (words)
      if (/^\s+$/.test(token)) {
        return token;
      }
      return `${color}${token}${NC}`;
    })
    .join("");
};

/**
 * Format a message with color, coloring each word individually
 * This approach ensures colors persist regardless of terminal width,
 * since each word has its own color codes that survive re-wrapping
 *
 * @param args - The function arguments
 * @param args.message - The message to format
 * @param args.color - The ANSI color code to apply
 *
 * @returns The message with colors that persist across any terminal width
 */
const formatWithColor = (args: { message: string; color: string }): string => {
  const { message, color } = args;

  // Split by explicit newlines, color each line's words, rejoin
  return message
    .split("\n")
    .map((line) => colorLineWords({ line, color }))
    .join("\n");
};

/**
 * Format a success message with green color
 * Colors each word individually to ensure colors persist across terminal re-wrapping
 *
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
 * Colors each word individually to ensure colors persist across terminal re-wrapping
 *
 * @param args - The function arguments
 * @param args.message - The message to format
 *
 * @returns The message formatted with red color
 */
export const formatError = (args: { message: string }): string => {
  const { message } = args;
  return formatWithColor({ message, color: RED });
};

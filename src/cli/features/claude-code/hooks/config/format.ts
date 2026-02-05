/**
 * Formatting utilities for hook output
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

/**
 * Calculate the number of terminal lines the Claude Code hook failure prefix takes
 *
 * Claude Code displays hook failures with this prefix format:
 * "SessionEnd hook [node {hookPath}] failed: "
 *
 * @param args - The function arguments
 * @param args.hookPath - The path to the hook script
 * @param args.terminalWidth - Terminal width in columns (defaults to process.stdout.columns or 80)
 *
 * @returns The number of lines the prefix will occupy
 */
export const calculatePrefixLines = (args: {
  hookPath: string;
  terminalWidth?: number | null;
}): number => {
  const { hookPath } = args;
  const terminalWidth = args.terminalWidth || process.stdout.columns || 80;

  // Claude Code prefix format: "SessionEnd hook [node {hookPath}] failed: "
  const prefix = `SessionEnd hook [node ${hookPath}] failed: `;

  return Math.ceil(prefix.length / terminalWidth);
};

/**
 * Format a message with ANSI codes to clear the Claude Code hook failure prefix
 *
 * This function prepends ANSI escape codes that:
 * 1. Move the cursor up by the number of lines the prefix occupies
 * 2. Clear from cursor to end of screen
 * 3. Apply success (green) or error (red) coloring to the message
 *
 * @param args - The function arguments
 * @param args.message - The message to format
 * @param args.hookPath - The path to the hook script (used to calculate prefix lines)
 * @param args.isSuccess - Whether this is a success message (green) or error (red)
 * @param args.terminalWidth - Terminal width in columns (optional, defaults to process.stdout.columns or 80)
 *
 * @returns The message with ANSI line-clearing codes prepended and color applied
 */
export const formatWithLineClear = (args: {
  message: string;
  hookPath: string;
  isSuccess: boolean;
  terminalWidth?: number | null;
}): string => {
  const { message, hookPath, isSuccess, terminalWidth } = args;

  // Calculate how many lines to clear
  const linesToClear = calculatePrefixLines({ hookPath, terminalWidth });

  // ANSI codes:
  // \r = carriage return (move to column 0)
  // \x1b[{n}A = cursor up n lines
  // \x1b[J = clear from cursor to end of screen
  const clearCodes = `\r\x1b[${linesToClear}A\x1b[J`;

  // Apply color formatting
  const coloredMessage = isSuccess
    ? formatSuccess({ message })
    : formatError({ message });

  return clearCodes + coloredMessage;
};

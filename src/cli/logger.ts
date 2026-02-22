/**
 * Shared logging utilities for installer
 * Provides file logging using Winston and ANSI color helpers
 *
 * Console output (error, success, info, warn, raw, newline) has been migrated
 * to @clack/prompts. This module retains:
 *   - File-only debug logging via Winston
 *   - Silent mode flag (used by install/asciiArt to guard output)
 *   - ANSI color helper functions
 *   - Text wrapping utility
 */

import winston from "winston";

// Log file path - exported for testing
export const LOG_FILE = "/tmp/nori.log";

// Custom log levels matching current behavior
const levels = {
  error: 0,
  warn: 1,
  success: 2,
  info: 3,
  debug: 4,
};

// ANSI color codes for console output
const colors = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  CYAN: "\x1b[36m",
  NC: "\x1b[0m", // No Color
};

// Additional formatting colors for enhanced output
const formatColors = {
  BRIGHT_CYAN: "\x1b[96m",
  BOLD_WHITE: "\x1b[1;37m",
  GRAY: "\x1b[90m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
};

// File format with timestamp and level
const fileFormat = winston.format.printf((logInfo) => {
  const { level, message } = logInfo;
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
});

// Create file transport
const fileTransport = new winston.transports.File({
  filename: LOG_FILE,
  format: fileFormat,
  level: "debug", // Log everything to file
});

// Create the logger (file transport only)
const logger = winston.createLogger({
  levels,
  transports: [fileTransport],
});

// ── Silent mode ──────────────────────────────────────────────────────────

let silentMode = false;

/**
 * Enable or disable silent mode
 * When silent mode is enabled, callers should suppress visible output.
 * Clack `log.*` methods do not respect this flag automatically — callers
 * must check `isSilentMode()` before emitting output.
 *
 * @param args - Configuration arguments
 * @param args.silent - Whether to enable silent mode
 */
export const setSilentMode = (args: { silent: boolean }): void => {
  silentMode = args.silent;
};

/**
 * Check if silent mode is enabled
 *
 * @returns Whether silent mode is currently enabled
 */
export const isSilentMode = (): boolean => {
  return silentMode;
};

// ── File-only logging ────────────────────────────────────────────────────

/**
 * Log debug message to file only (no console output)
 * @param args - Configuration arguments
 * @param args.message - Debug message to log
 */
export const debug = (args: { message: string }): void => {
  const { message } = args;
  logger.debug(message);
};

// ── Color helpers ────────────────────────────────────────────────────────

/**
 * Wrap text in green (for positive/new values)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in green ANSI color codes
 */
export const green = (args: { text: string }): string => {
  const { text } = args;
  return `${colors.GREEN}${text}${colors.NC}`;
};

/**
 * Wrap text in red (for errors/negative values)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in red ANSI color codes
 */
export const red = (args: { text: string }): string => {
  const { text } = args;
  return `${colors.RED}${text}${colors.NC}`;
};

/**
 * Wrap text in yellow (for warnings/caution)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in yellow ANSI color codes
 */
export const yellow = (args: { text: string }): string => {
  const { text } = args;
  return `${colors.YELLOW}${text}${colors.NC}`;
};

/**
 * Wrap text in bold (for emphasis)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in bold ANSI color codes
 */
export const bold = (args: { text: string }): string => {
  const { text } = args;
  return `${formatColors.BOLD}${text}\x1b[22m`;
};

/**
 * Print text in bright cyan (for numbers/indices)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in bright cyan ANSI color codes
 */
export const brightCyan = (args: { text: string }): string => {
  const { text } = args;
  return `${formatColors.BRIGHT_CYAN}${text}${colors.NC}`;
};

/**
 * Print text in bold white (for option names)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in bold white ANSI color codes
 */
export const boldWhite = (args: { text: string }): string => {
  const { text } = args;
  return `${formatColors.BOLD_WHITE}${text}${colors.NC}`;
};

/**
 * Print text in gray (for descriptions)
 * @param args - Configuration arguments
 * @param args.text - Text to display
 *
 * @returns Text wrapped in gray ANSI color codes
 */
export const gray = (args: { text: string }): string => {
  const { text } = args;
  return `${formatColors.GRAY}${text}${colors.NC}`;
};

/**
 * Wrap text to fit terminal width
 * @param args - Configuration arguments
 * @param args.text - Text to wrap
 * @param args.maxWidth - Maximum width (defaults to terminal width or 80)
 *
 * @returns Wrapped text with newlines
 */
export const wrapText = (args: {
  text: string;
  maxWidth?: number | null;
}): string => {
  const { text } = args;
  const maxWidth = args.maxWidth ?? process.stdout.columns ?? 80;

  const words = text.split(" ");
  const lines: Array<string> = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
};

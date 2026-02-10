/**
 * Shared logging utilities for installer
 * Provides colorized console output functions and file logging using Winston
 */

import winston from "winston";
import Transport from "winston-transport";

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

/**
 * Custom console transport that uses console.log/console.error
 * This maintains compatibility with code that spies on console methods
 */
class ConsoleTransport extends Transport {
  log(logInfo: { level: string; message: string }, callback: () => void): void {
    const { level, message } = logInfo;

    // Check silent mode (inherited from Transport)
    if (this.silent) {
      callback();
      return;
    }

    // Don't output debug to console
    if (level === "debug") {
      callback();
      return;
    }

    // Format message with colors and prefixes
    let formattedMessage: string;
    switch (level) {
      case "error":
        formattedMessage = `${colors.RED}Error: ${message}${colors.NC}`;
        console.error(formattedMessage);
        break;
      case "warn":
        formattedMessage = `${colors.YELLOW}Warning: ${message}${colors.NC}`;
        console.log(formattedMessage);
        break;
      case "success":
        formattedMessage = `${colors.GREEN}${message}${colors.NC}`;
        console.log(formattedMessage);
        break;
      case "info":
        formattedMessage = `${colors.CYAN}${message}${colors.NC}`;
        console.log(formattedMessage);
        break;
      default:
        console.log(String(message));
    }

    callback();
  }
}

// File format with timestamp and level
const fileFormat = winston.format.printf((logInfo) => {
  const { level, message } = logInfo;
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
});

// Create custom console transport
const consoleTransport = new ConsoleTransport({
  level: "info", // Don't output debug to console
});

// Create file transport
const fileTransport = new winston.transports.File({
  filename: LOG_FILE,
  format: fileFormat,
  level: "debug", // Log everything to file
});

// Create the logger
const logger = winston.createLogger({
  levels,
  transports: [consoleTransport, fileTransport],
});

/**
 * Enable or disable silent mode
 * When silent mode is enabled, all console output is suppressed
 * but file logging continues
 *
 * @param args - Configuration arguments
 * @param args.silent - Whether to enable silent mode
 */
export const setSilentMode = (args: { silent: boolean }): void => {
  consoleTransport.silent = args.silent;
};

/**
 * Check if silent mode is enabled
 *
 * @returns Whether silent mode is currently enabled
 */
export const isSilentMode = (): boolean => {
  return consoleTransport.silent ?? false;
};

/**
 * Print error message in red with "Error: " prefix
 * @param args - Configuration arguments
 * @param args.message - Error message to display
 */
export const error = (args: { message: string }): void => {
  const { message } = args;
  logger.error(message);
};

/**
 * Print success message in green
 * @param args - Configuration arguments
 * @param args.message - Success message to display
 */
export const success = (args: { message: string }): void => {
  const { message } = args;
  logger.log("success", message);
};

/**
 * Print info message in cyan
 * @param args - Configuration arguments
 * @param args.message - Info message to display
 */
export const info = (args: { message: string }): void => {
  const { message } = args;
  logger.info(message);
};

/**
 * Print warning message in yellow with "Warning: " prefix
 * @param args - Configuration arguments
 * @param args.message - Warning message to display
 */
export const warn = (args: { message: string }): void => {
  const { message } = args;
  logger.warn(message);
};

/**
 * Log debug message to file only (no console output)
 * @param args - Configuration arguments
 * @param args.message - Debug message to log
 */
export const debug = (args: { message: string }): void => {
  const { message } = args;
  logger.debug(message);
};

/**
 * Output a blank line to console for spacing
 * File logging is skipped for blank lines
 */
export const newline = (): void => {
  if (!consoleTransport.silent) {
    console.log();
  }
};

/**
 * Output raw text without any color formatting
 * Used for pre-formatted output like ASCII art
 * @param args - Configuration arguments
 * @param args.message - Raw message to display
 */
export const raw = (args: { message: string }): void => {
  const { message } = args;
  // Log to file as info level
  fileTransport.log?.(
    { level: "info", message, [Symbol.for("level")]: "info" },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    () => {},
  );
  // Output to console without formatting
  if (!consoleTransport.silent) {
    console.log(message);
  }
};

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

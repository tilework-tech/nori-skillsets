/**
 * Shared logging utilities for installer
 * Provides colorized console output functions and file logging
 */

// Silent mode flag - when true, all console output is suppressed
let silentMode = false;

/**
 * Enable or disable silent mode
 * When silent mode is enabled, all console output is suppressed
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

// ANSI color codes for output
const colors = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  BLUE: "\x1b[36m",
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

// Log file path for installer debugging
const LOG_FILE = "/tmp/nori-installer.log";

/**
 * Append message to log file
 * @param args - Configuration arguments
 * @param args.message - Message to log
 * @param args.level - Log level (error, success, info, warn, debug)
 */
const appendToLogFile = async (args: {
  message: string;
  level: string;
}): Promise<void> => {
  const { message, level } = args;
  try {
    const fs = await import("fs/promises");
    const timestamp = new Date().toISOString();
    await fs.appendFile(LOG_FILE, `[${timestamp}] [${level}] ${message}\n`);
  } catch {
    // Silently fail on logging errors - don't break installer
  }
};

/**
 * Print error message in red
 * @param args - Configuration arguments
 * @param args.message - Error message to display
 */
export const error = (args: { message: string }): void => {
  const { message } = args;
  if (!silentMode) {
    console.error(`${colors.RED}Error: ${message}${colors.NC}`);
  }
  // Log to file asynchronously (don't await)
  appendToLogFile({ message, level: "ERROR" });
};

/**
 * Print success message in green
 * @param args - Configuration arguments
 * @param args.message - Success message to display
 */
export const success = (args: { message: string }): void => {
  const { message } = args;
  if (!silentMode) {
    console.log(`${colors.GREEN}${message}${colors.NC}`);
  }
  // Log to file asynchronously (don't await)
  appendToLogFile({ message, level: "SUCCESS" });
};

/**
 * Print info message in blue
 * @param args - Configuration arguments
 * @param args.message - Info message to display
 */
export const info = (args: { message: string }): void => {
  const { message } = args;
  if (!silentMode) {
    console.log(`${colors.BLUE}${message}${colors.NC}`);
  }
  // Log to file asynchronously (don't await)
  appendToLogFile({ message, level: "INFO" });
};

/**
 * Print warning message in yellow
 * @param args - Configuration arguments
 * @param args.message - Warning message to display
 */
export const warn = (args: { message: string }): void => {
  const { message } = args;
  if (!silentMode) {
    console.log(`${colors.YELLOW}Warning: ${message}${colors.NC}`);
  }
  // Log to file asynchronously (don't await)
  appendToLogFile({ message, level: "WARN" });
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
 * Log debug message to file only (no console output)
 * @param args - Configuration arguments
 * @param args.message - Debug message to log
 */
export const debug = (args: { message: string }): void => {
  const { message } = args;
  // Only log to file, no console output
  appendToLogFile({ message, level: "DEBUG" });
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

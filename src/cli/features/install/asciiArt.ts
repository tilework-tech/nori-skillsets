/**
 * ASCII art utilities for installer branding
 */

import { isSilentMode } from "@/cli/logger.js";

// ANSI color codes
const NC = "\x1b[0m"; // No Color

/**
 * Write a line to stdout (raw, no formatting prefix)
 * @param args - Output arguments
 * @param args.message - The line to write
 */
const writeLine = (args: { message: string }): void => {
  process.stdout.write(args.message + "\n");
};

/**
 * Display "Welcome to Nori" completion banner
 * @param args - Configuration arguments
 * @param args.color - ANSI color code to use (defaults to blue)
 */
export const displayWelcomeBanner = (args?: {
  color?: string | null;
}): void => {
  if (isSilentMode()) return;
  const GREEN = "\x1b[0;32m";
  const color = args?.color ?? GREEN;
  const colorPrefix = color ?? "";
  const colorSuffix = color ? NC : "";

  writeLine({ message: "" });
  writeLine({
    message: `${colorPrefix}██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  ${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  ${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix} ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝${colorSuffix}`,
  });
  writeLine({ message: "" });
  writeLine({
    message: `${colorPrefix}████████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ██╗${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}╚══██╔══╝██╔═══██╗    ████╗  ██║██╔═══██╗██╔══██╗██║${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}   ██║   ██║   ██║    ██╔██╗ ██║██║   ██║██████╔╝██║${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}   ██║   ██║   ██║    ██║╚██╗██║██║   ██║██╔══██╗██║${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}   ██║   ╚██████╔╝    ██║ ╚████║╚██████╔╝██║  ██║██║${colorSuffix}`,
  });
  writeLine({
    message: `${colorPrefix}   ╚═╝    ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝${colorSuffix}`,
  });
  writeLine({ message: "" });
};

/**
 * Display seaweed bed that spans terminal width
 * @param args - Configuration arguments
 * @param args.color - ANSI color code to use (defaults to dark green)
 */
export const displaySeaweedBed = (args?: { color?: string | null }): void => {
  if (isSilentMode()) return;
  const DARK_GREEN = "\x1b[0;32m";
  const color = args?.color ?? DARK_GREEN;
  const colorPrefix = color ?? "";
  const colorSuffix = color ? NC : "";

  const terminalWidth = process.stdout.columns ?? 80;

  // Different seaweed patterns for variety
  const patterns = [
    "~ ~  ~ ~  ",
    " ~ ~  ~  ~",
    "~  ~ ~  ~ ",
    " ~  ~ ~ ~ ",
    "~ ~ ~  ~  ",
  ];

  patterns.forEach((pattern) => {
    const seaweedLine = pattern.repeat(
      Math.ceil(terminalWidth / pattern.length),
    );
    writeLine({
      message: `${colorPrefix}${seaweedLine.substring(0, terminalWidth)}${colorSuffix}`,
    });
  });
};

/**
 * ASCII art utilities for installer branding
 */

// ANSI color codes
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m"; // No Color

/**
 * Display NORI ASCII art banner
 * @param args - Configuration arguments
 * @param args.color - ANSI color code to use (defaults to blue)
 */
export const displayNoriBanner = (args?: { color?: string | null }): void => {
  const color = args?.color ?? BLUE;
  const colorPrefix = color ?? "";
  const colorSuffix = color ? NC : "";

  console.log("\n");
  console.log(`${colorPrefix}███╗   ██╗ ██████╗ ██████╗ ██╗${colorSuffix}`);
  console.log(`${colorPrefix}████╗  ██║██╔═══██╗██╔══██╗██║${colorSuffix}`);
  console.log(`${colorPrefix}██╔██╗ ██║██║   ██║██████╔╝██║${colorSuffix}`);
  console.log(`${colorPrefix}██║╚██╗██║██║   ██║██╔══██╗██║${colorSuffix}`);
  console.log(`${colorPrefix}██║ ╚████║╚██████╔╝██║  ██║██║${colorSuffix}`);
  console.log(`${colorPrefix}╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝${colorSuffix}`);
  console.log("\n");
};

/**
 * Display "Welcome to Nori" completion banner
 * @param args - Configuration arguments
 * @param args.color - ANSI color code to use (defaults to blue)
 */
export const displayWelcomeBanner = (args?: {
  color?: string | null;
}): void => {
  const GREEN = "\x1b[0;32m";
  const color = args?.color ?? GREEN;
  const colorPrefix = color ?? "";
  const colorSuffix = color ? NC : "";

  console.log("\n");
  console.log(
    `${colorPrefix}██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  ${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  ${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗${colorSuffix}`,
  );
  console.log(
    `${colorPrefix} ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝${colorSuffix}`,
  );
  console.log("\n");
  console.log(
    `${colorPrefix}████████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ██╗${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}╚══██╔══╝██╔═══██╗    ████╗  ██║██╔═══██╗██╔══██╗██║${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}   ██║   ██║   ██║    ██╔██╗ ██║██║   ██║██████╔╝██║${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}   ██║   ██║   ██║    ██║╚██╗██║██║   ██║██╔══██╗██║${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}   ██║   ╚██████╔╝    ██║ ╚████║╚██████╔╝██║  ██║██║${colorSuffix}`,
  );
  console.log(
    `${colorPrefix}   ╚═╝    ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝${colorSuffix}`,
  );
  console.log("\n");
};

/**
 * Display seaweed bed that spans terminal width
 * @param args - Configuration arguments
 * @param args.color - ANSI color code to use (defaults to dark green)
 */
export const displaySeaweedBed = (args?: { color?: string | null }): void => {
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
    console.log(
      `${colorPrefix}${seaweedLine.substring(0, terminalWidth)}${colorSuffix}`,
    );
  });
};

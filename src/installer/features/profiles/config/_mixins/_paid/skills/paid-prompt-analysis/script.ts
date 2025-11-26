#!/usr/bin/env node

/**
 * Prompt Analysis script - Analyze prompts for quality and best practices
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * Build Process:
 * 1. TypeScript compiles this file to build/src/installer/features/skills/config/paid-prompt-analysis/script.js
 * 2. tsc-alias converts @ imports to relative paths
 * 3. scripts/bundle-skills.ts uses esbuild to create a standalone bundle
 * 4. The bundle REPLACES the compiled output at the same location
 * 5. Installation copies the bundled script to ~/.claude/skills/prompt-analysis/script.js
 *
 * Why Bundling:
 * The @ imports below (e.g., @/api/index.js) get converted to relative paths
 * like '../../../../../api/index.js'. When installed to ~/.claude/skills/,
 * those paths don't exist. Bundling inlines all dependencies into a single
 * standalone executable.
 *
 * @see scripts/bundle-skills.ts - The bundler that processes this file
 * @see plugin/src/installer/features/skills/loader.ts - Installation to ~/.claude/skills/
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import {
  loadConfig,
  getDefaultProfile,
  isPaidInstall,
} from "@/installer/config.js";
import { getInstallDirs } from "@/utils/path.js";

import type { FeedbackItem } from "@/api/promptAnalysis.js";

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`${COLORS.bold}Prompt Analysis Tool${COLORS.reset}

${COLORS.bold}Usage:${COLORS.reset}
  node script.js --prompt="Your prompt text here"

${COLORS.bold}What it does:${COLORS.reset}
  Analyzes your prompt using AI to provide feedback on quality and best practices.
  Returns structured feedback categorized as:
    ${COLORS.green}✓ good${COLORS.reset}     - Things you're doing well
    ${COLORS.yellow}⚠ warning${COLORS.reset}  - Areas that could be improved
    ${COLORS.red}✗ critical${COLORS.reset} - Issues that should be addressed

${COLORS.bold}When to use:${COLORS.reset}
  - Before sending an important prompt to Claude
  - When refining prompts for better results
  - To learn prompt engineering best practices
  - When you're unsure if your prompt is clear enough

  ${COLORS.bold}Skip when:${COLORS.reset}
  - Your prompt is straightforward and simple
  - You've already tested and refined the prompt
  - You're confident in your prompt quality

${COLORS.bold}How to use:${COLORS.reset}
  1. Write your prompt as you normally would
  2. Run this script with your prompt in quotes
  3. Review the feedback to identify improvements
  4. Refine your prompt based on suggestions
  5. The output is plain text - Claude will explain it to you

${COLORS.bold}Parameters:${COLORS.reset}
  --prompt    (required) The prompt text to analyze

${COLORS.bold}Example:${COLORS.reset}
  node script.js --prompt="Write a function to sort an array"

  node script.js --prompt="I need help with my code. Can you fix it?"

${COLORS.bold}Requirements:${COLORS.reset}
  - Paid Nori subscription
  - Configured credentials in ~/nori-config.json
`);
};

/**
 * Format feedback item with color
 * @param args - Formatting arguments
 * @param args.item - Feedback item to format
 *
 * @returns Formatted string with ANSI colors
 */
const formatFeedbackItem = (args: { item: FeedbackItem }): string => {
  const { item } = args;

  let symbol = "";
  let color = COLORS.reset;

  if (item.category === "good") {
    symbol = "✓";
    color = COLORS.green;
  } else if (item.category === "warning") {
    symbol = "⚠";
    color = COLORS.yellow;
  } else if (item.category === "critical") {
    symbol = "✗";
    color = COLORS.red;
  }

  return `${color}${symbol} ${item.message}${COLORS.reset}`;
};

/**
 * Main execution function
 */
export const main = async (): Promise<void> => {
  // 1. Find installation directory
  // ALWAYS use getInstallDirs to find installation directory
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Fail loudly - no silent fallback
    console.error("Error: No Nori installation found.");
    process.exit(1);
  }

  const installDir = allInstallations[0]; // Use closest installation

  // 2. Check tier
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  if (!isPaidInstall({ config })) {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 3. Parse and validate arguments
  const args = minimist(process.argv.slice(2));

  if (args.prompt == null) {
    console.error("Error: --prompt parameter is required");
    console.error("");
    showUsage();
    process.exit(1);
  }

  const prompt = args.prompt as string;

  if (prompt.trim() === "") {
    console.error("Error: --prompt cannot be empty");
    console.error("");
    showUsage();
    process.exit(1);
  }

  // 4. Execute API call
  const result = await apiClient.promptAnalysis.analyze({
    prompt,
  });

  // 5. Format and display output
  if (!result.feedback || result.feedback.length === 0) {
    console.log("No feedback available for this prompt.");
    return;
  }

  // Group feedback by category
  const good = result.feedback.filter((item) => item.category === "good");
  const warnings = result.feedback.filter(
    (item) => item.category === "warning",
  );
  const critical = result.feedback.filter(
    (item) => item.category === "critical",
  );

  console.log(`${COLORS.bold}Prompt Analysis Results:${COLORS.reset}\n`);

  if (good.length > 0) {
    console.log(
      `${COLORS.bold}${COLORS.green}What's working well:${COLORS.reset}`,
    );
    good.forEach((item) => {
      console.log(`  ${formatFeedbackItem({ item })}`);
    });
    console.log("");
  }

  if (warnings.length > 0) {
    console.log(
      `${COLORS.bold}${COLORS.yellow}Suggestions for improvement:${COLORS.reset}`,
    );
    warnings.forEach((item) => {
      console.log(`  ${formatFeedbackItem({ item })}`);
    });
    console.log("");
  }

  if (critical.length > 0) {
    console.log(
      `${COLORS.bold}${COLORS.red}Critical issues to address:${COLORS.reset}`,
    );
    critical.forEach((item) => {
      console.log(`  ${formatFeedbackItem({ item })}`);
    });
    console.log("");
  }

  console.log(
    `${COLORS.bold}Note:${COLORS.reset} This is automated feedback. Ask Claude to explain the suggestions in detail.`,
  );
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

#!/usr/bin/env node

/**
 * Memorize script - Save information to Nori knowledge base
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * @see scripts/bundle-skills.ts - Bundler that creates standalone executables
 * @see mcp/src/installer/features/skills/config/paid-recall/script.ts - Full bundling documentation
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadDiskConfig, generateConfig } from "@/installer/config.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js --name="Title" --content="Content"

Parameters:
  --name      (required) Clear, searchable title for the memory
  --content   (required) Markdown content with context, decisions, code snippets

Example:
  node script.js --name="TDD workflow" --content="# Process\\n\\n1. Write test\\n2. Implement"

Description:
  Saves information to a shared knowledge base for future reference.

  Memorize for:
  - Accomplishments and implementation approaches
  - Key decisions and rationale
  - Non-obvious solutions and workarounds
  - Project-specific patterns and conventions
  - User preferences

  Skip memorizing:
  - Trivial changes with no decisions
  - Generic knowledge
  - Temporary debugging output`);
};

/**
 * Format artifact for display
 * @param args - Formatting arguments
 * @param args.id - Artifact ID
 * @param args.name - Artifact name
 * @param args.createdAt - Creation timestamp
 * @param args.updatedAt - Update timestamp
 * @param args.content - Artifact content
 *
 * @returns Formatted string
 */
const formatArtifact = (args: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  content: string;
}): string => {
  const { id, name, createdAt, updatedAt, content } = args;

  return `Successfully created artifact:

${name}
   ID: ${id}
   Created: ${new Date(createdAt).toLocaleString()}
   Updated: ${new Date(updatedAt).toLocaleString()}
   Content: ${
     content.length > 200 ? content.substring(0, 200) + "..." : content
   }`;
};

/**
 * Main execution function
 */
export const main = async (): Promise<void> => {
  // 1. Check tier
  // Use cwd as installDir since skill scripts run from project directory
  const installDir = process.cwd();
  const diskConfig = await loadDiskConfig({ installDir });
  const config = generateConfig({ diskConfig, installDir });

  if (config.installType !== "paid") {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 2. Parse and validate arguments
  const args = minimist(process.argv.slice(2));

  if (args.name == null || args.content == null) {
    if (args.name == null) {
      console.error("Error: --name parameter is required");
    }
    if (args.content == null) {
      console.error("Error: --content parameter is required");
    }
    console.error("");
    showUsage();
    process.exit(1);
  }

  // 3. Execute API call
  const result = await apiClient.artifacts.create({
    name: args.name,
    content: args.content,
    type: "memory",
  });

  // 4. Format and display output
  console.log(
    formatArtifact({
      id: result.id,
      name: result.name,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      content: result.content,
    }),
  );
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

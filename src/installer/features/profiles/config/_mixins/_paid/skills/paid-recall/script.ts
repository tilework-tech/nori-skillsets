#!/usr/bin/env node

/**
 * Recall script - Search Nori knowledge base
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * Build Process:
 * 1. TypeScript compiles this file to build/src/installer/features/skills/config/paid-recall/script.js
 * 2. tsc-alias converts @ imports to relative paths
 * 3. scripts/bundle-skills.ts uses esbuild to create a standalone bundle
 * 4. The bundle REPLACES the compiled output at the same location
 * 5. Installation copies the bundled script to ~/.claude/skills/recall/script.js
 *
 * Why Bundling:
 * The @ imports below (e.g., @/api/index.js) get converted to relative paths
 * like '../../../../../api/index.js'. When installed to ~/.claude/skills/,
 * those paths don't exist. Bundling inlines all dependencies into a single
 * standalone executable.
 *
 * @see scripts/bundle-skills.ts - The bundler that processes this file
 * @see mcp/src/installer/features/skills/loader.ts - Installation to ~/.claude/skills/
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadDiskConfig, generateConfig } from "@/installer/config.js";

import type { Artifact } from "@/api/index.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage: node script.js --query="Search query" [--limit=10]

Parameters:
  --query      (required) Describe what you're trying to do or problem you're solving
  --limit      (optional) Maximum results (default: 10)

Example:
  node script.js --query="implementing authentication endpoints" --limit=5

Description:
  Searches the shared knowledge base for relevant context.

  The knowledge base contains:
  - Previous solutions and debugging sessions
  - User-provided docs and project context
  - Code patterns and architectural decisions
  - Bug reports and conventions

  Search modes:
  - Full text, fuzzy matching, and vector search all enabled
  - Returns best matches across all modes`);
};

/**
 * Format artifact for display
 * @param args - Formatting arguments
 * @param args.artifact - Artifact to format
 * @param args.index - Zero-based index for numbered display
 *
 * @returns Formatted string
 */
const formatArtifact = (args: {
  artifact: Artifact;
  index: number;
}): string => {
  const { artifact, index } = args;

  return `${index + 1}. ${artifact.name}
   ID: ${artifact.id}
   Created: ${new Date(artifact.createdAt).toLocaleString()}
   Updated: ${new Date(artifact.updatedAt).toLocaleString()}
   Content: ${
     artifact.content.length > 200
       ? artifact.content.substring(0, 200) + "..."
       : artifact.content
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

  if (args.query == null) {
    console.error("Error: --query parameter is required");
    console.error("");
    showUsage();
    process.exit(1);
  }

  const query = args.query as string;
  const limit = (args.limit as number | null) ?? 10;

  // 3. Execute API call
  const result = await apiClient.query.search({
    query,
    limit,
    fuzzySearch: true,
    vectorSearch: true,
  });

  // 4. Format and display output
  if (!result.results || result.results.length === 0) {
    console.log(`No artifacts found matching query: "${query}"`);
    return;
  }

  const formattedResults = result.results
    .map((artifact, index) => formatArtifact({ artifact, index }))
    .join("\n\n");

  let sourcesInfo = "";
  if (result.sources) {
    const sources = [];
    if (result.sources.keywordSearch.length > 0) {
      sources.push(`Keyword: ${result.sources.keywordSearch.length}`);
    }
    if (result.sources.fuzzySearch.length > 0) {
      sources.push(`Fuzzy: ${result.sources.fuzzySearch.length}`);
    }
    if (result.sources.vectorSearch.length > 0) {
      sources.push(`Vector: ${result.sources.vectorSearch.length}`);
    }
    if (sources.length > 0) {
      sourcesInfo = `\n\nSearch sources: ${sources.join(", ")}`;
    }
  }

  console.log(
    `Found ${result.results.length} artifacts matching "${query}":\n\n${formattedResults}${sourcesInfo}`,
  );
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

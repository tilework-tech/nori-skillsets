#!/usr/bin/env node

/**
 * Recall script - Search Nori knowledge base
 *
 * IMPORTANT: This file is BUNDLED during the build process.
 *
 * Build Process:
 * 1. TypeScript compiles this file to build/src/cli/features/claude-code/profiles/config/senior-swe/skills/paid-recall/script.js
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
 * @see src/cli/features/claude-code/profiles/skills/loader.ts - Installation to ~/.claude/skills/
 */

import minimist from "minimist";

import { apiClient } from "@/api/index.js";
import { loadConfig, isPaidInstall } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Artifact } from "@/api/index.js";

/**
 * Show usage information
 */
const showUsage = (): void => {
  console.error(`Usage:
  node script.js --query="Search query" [--limit=10]
  node script.js --id="artifact_id"

Parameters:
  --query      Search for artifacts (mutually exclusive with --id)
  --id         Fetch a specific artifact by ID (mutually exclusive with --query)
  --limit      Maximum search results (default: 10, only applies to --query)

Examples:
  # Search for artifacts
  node script.js --query="implementing authentication endpoints" --limit=5

  # Fetch specific artifact by ID
  node script.js --id="nori_abc123def456"

Description:
  Search mode (--query):
    Searches the shared knowledge base for relevant context.
    Returns snippets from matching artifacts.

  Fetch mode (--id):
    Retrieves the complete content of a specific artifact.
    Displays full artifact without truncation.

  The knowledge base contains:
  - Previous solutions and debugging sessions
  - User-provided docs and project context
  - Code patterns and architectural decisions
  - Bug reports and conventions`);
};

/**
 * Format artifact for display in search results (truncated)
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
     artifact.content.length > 500
       ? artifact.content.substring(0, 500) + "..."
       : artifact.content
   }`;
};

/**
 * Format full artifact for display (no truncation)
 * @param args - Formatting arguments
 * @param args.artifact - Artifact to format
 *
 * @returns Formatted string
 */
const formatFullArtifact = (args: { artifact: Artifact }): string => {
  const { artifact } = args;

  return `Artifact: ${artifact.name}
ID: ${artifact.id}
Type: ${artifact.type}
Repository: ${artifact.repository}
Created: ${new Date(artifact.createdAt).toLocaleString()}
Updated: ${new Date(artifact.updatedAt).toLocaleString()}

${artifact.content}`;
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
  const config = await loadConfig({ installDir });
  if (config == null || !isPaidInstall({ config })) {
    console.error("Error: This feature requires a paid Nori subscription.");
    console.error("Please configure your credentials in ~/nori-config.json");
    process.exit(1);
  }

  // 3. Parse and validate arguments
  const args = minimist(process.argv.slice(2));

  // Check for mutual exclusivity
  if (args.id != null && args.query != null) {
    console.error(
      "Error: --id and --query are mutually exclusive. Provide one or the other.",
    );
    process.exit(1);
  }

  // Check that at least one is provided
  if (args.id == null && args.query == null) {
    console.error("Error: Either --query or --id parameter is required");
    console.error("");
    showUsage();
    process.exit(1);
  }

  // 4. Execute API call based on mode
  if (args.id != null) {
    // Fetch mode - get single artifact by ID
    const id = args.id as string;
    const artifact = await apiClient.artifacts.get({ id });

    // 5. Format and display full artifact
    const formatted = formatFullArtifact({ artifact });
    console.log(formatted);
  } else {
    // Search mode - search for artifacts
    const query = args.query as string;
    const limit = (args.limit as number | null) ?? 10;

    const result = await apiClient.query.search({
      query,
      limit,
      fuzzySearch: true,
      vectorSearch: true,
    });

    // 5. Format and display output
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
  }
};

// Run main function if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

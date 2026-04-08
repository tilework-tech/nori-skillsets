/**
 * Registry search flow module
 *
 * Provides a flow for searching skillsets, skills, and subagents in the Nori registry.
 * This flow handles:
 * - Intro message
 * - Spinner while searching
 * - Note display with search results
 * - Download hints
 * - Outro message
 */

import { spinner, note, log } from "@clack/prompts";

/**
 * Result from the search callback
 */
export type SearchFlowResult =
  | {
      success: true;
      hasResults: true;
      formattedResults: string;
      downloadHints: string;
      skillsetCount: number;
      skillCount: number;
      subagentCount: number;
    }
  | { success: true; hasResults: false; query: string }
  | { success: false; error: string };

/**
 * Callbacks for the registry search flow
 */
export type RegistrySearchFlowCallbacks = {
  onSearch: () => Promise<SearchFlowResult>;
};

/**
 * Result of the registry search flow
 */
export type RegistrySearchFlowResult = {
  found: boolean;
  statusMessage: string;
};

/**
 * Execute the registry search flow
 *
 * This function handles the complete search UX:
 * 1. Shows spinner while searching registries
 * 2. Displays results in a note or shows no-results message
 * 3. Shows download hints if results were found
 *
 * @param args - Flow configuration
 * @param args.callbacks - Callback functions for searching
 *
 * @returns Search result on success, null on failure
 */
export const registrySearchFlow = async (args: {
  callbacks: RegistrySearchFlowCallbacks;
}): Promise<RegistrySearchFlowResult | null> => {
  const { callbacks } = args;

  const s = spinner();
  s.start("Searching...");

  const searchResult = await callbacks.onSearch();

  if (!searchResult.success) {
    s.stop("Search failed");
    log.error(searchResult.error);
    return null;
  }

  s.stop("Search complete");

  if (!searchResult.hasResults) {
    log.info(
      `No skillsets, skills, or subagents found matching "${searchResult.query}".`,
    );
    return { found: false, statusMessage: "Search returned no results" };
  }

  note(searchResult.formattedResults, "Results");

  if (searchResult.downloadHints.length > 0) {
    log.info(searchResult.downloadHints);
  }

  const { skillsetCount, skillCount, subagentCount } = searchResult;
  const parts: Array<string> = [];
  if (skillsetCount > 0) {
    parts.push(
      `${skillsetCount} ${skillsetCount === 1 ? "skillset" : "skillsets"}`,
    );
  }
  if (skillCount > 0) {
    parts.push(`${skillCount} ${skillCount === 1 ? "skill" : "skills"}`);
  }
  if (subagentCount > 0) {
    parts.push(
      `${subagentCount} ${subagentCount === 1 ? "subagent" : "subagents"}`,
    );
  }
  return {
    found: true,
    statusMessage: `Search returned ${
      parts.length <= 2
        ? parts.join(" and ")
        : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
    }`,
  };
};

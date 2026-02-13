/**
 * Registry search flow module
 *
 * Provides a flow for searching skillsets and skills in the Nori registry.
 * This flow handles:
 * - Intro message
 * - Spinner while searching
 * - Note display with search results
 * - Download hints
 * - Outro message
 */

import { intro, outro, spinner, note, log } from "@clack/prompts";

/**
 * Result from the search callback
 */
export type SearchFlowResult =
  | {
      success: true;
      hasResults: true;
      formattedResults: string;
      downloadHints: string;
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
};

/**
 * Execute the registry search flow
 *
 * This function handles the complete search UX:
 * 1. Shows intro message
 * 2. Shows spinner while searching registries
 * 3. Displays results in a note or shows no-results message
 * 4. Shows download hints if results were found
 * 5. Shows outro
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

  intro("Search Nori Registry");

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
    log.info(`No skillsets or skills found matching "${searchResult.query}".`);
    outro("Search complete");
    return { found: false };
  }

  note(searchResult.formattedResults, "Results");

  if (searchResult.downloadHints.length > 0) {
    log.info(searchResult.downloadHints);
  }

  outro("Search complete");
  return { found: true };
};

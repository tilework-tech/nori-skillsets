/**
 * Factory reset flow module
 *
 * Provides the complete interactive factory reset experience using @clack/prompts.
 * This flow handles:
 * - Artifact discovery via callback
 * - Artifact listing in a note
 * - Type-confirm safety prompt
 * - Artifact deletion via callback
 * - Intro/outro framing with agent name
 */

import { intro, outro, text, spinner, note, log } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

export type FactoryResetArtifact = {
  path: string;
  type: "directory" | "file";
};

export type FindArtifactsResult = {
  artifacts: Array<FactoryResetArtifact>;
};

export type FactoryResetFlowCallbacks = {
  onFindArtifacts: (args: { path: string }) => Promise<FindArtifactsResult>;
  onDeleteArtifacts: (args: {
    artifacts: Array<FactoryResetArtifact>;
  }) => Promise<void>;
};

export type FactoryResetFlowResult = {
  deletedCount: number;
};

const buildArtifactListing = (args: {
  artifacts: Array<FactoryResetArtifact>;
}): string => {
  const { artifacts } = args;
  return artifacts
    .map((artifact) => {
      const label = artifact.type === "directory" ? "[dir] " : "[file]";
      return `${label} ${artifact.path}`;
    })
    .join("\n");
};

/**
 * Execute the interactive factory reset flow
 *
 * @param args - Flow configuration
 * @param args.agentName - Display name of the agent being reset
 * @param args.path - Directory to search from
 * @param args.callbacks - Callback functions for side-effectful operations
 *
 * @returns Result on success, null on cancel/decline
 */
export const factoryResetFlow = async (args: {
  agentName: string;
  path: string;
  callbacks: FactoryResetFlowCallbacks;
}): Promise<FactoryResetFlowResult | null> => {
  const { agentName, path, callbacks } = args;
  const cancelMsg = "Factory reset cancelled.";

  intro(`Factory Reset ${agentName}`);

  // Step 1: Discover artifacts
  const s = spinner();
  s.start("Searching for configuration...");

  const { artifacts } = await callbacks.onFindArtifacts({ path });

  s.stop("Search complete");

  // Step 2: Handle no artifacts
  if (artifacts.length === 0) {
    log.info("No configuration found.");
    outro("Nothing to reset");
    return { deletedCount: 0 };
  }

  // Step 3: Display artifacts and confirm
  const listing = buildArtifactListing({ artifacts });
  note(listing, "The following will be deleted");

  const answer = unwrapPrompt({
    value: await text({
      message: "Type 'confirm' to proceed with factory reset",
    }),
    cancelMessage: cancelMsg,
  });

  if (answer == null) return null;

  if (answer !== "confirm") {
    log.info(cancelMsg);
    return null;
  }

  // Step 4: Delete artifacts
  const deleteSpinner = spinner();
  deleteSpinner.start("Deleting configuration...");

  await callbacks.onDeleteArtifacts({ artifacts });

  deleteSpinner.stop("Deleted");

  outro("Factory reset complete. All configuration has been removed.");

  return { deletedCount: artifacts.length };
};

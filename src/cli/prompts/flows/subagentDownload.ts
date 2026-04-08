/**
 * Subagent download flow module
 *
 * Provides a flow for downloading subagent packages from the Nori registry.
 * This flow handles:
 * - Intro message
 * - Spinner while searching registries
 * - Version comparison and already-current detection
 * - Version list display
 * - Spinner while downloading
 * - Success note with install location and skillset update status
 * - Outro message
 */

import { spinner, note, log, confirm } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

/**
 * Result from the search callback
 */
export type SubagentSearchResult =
  | {
      status: "ready";
      targetVersion: string;
      isUpdate: boolean;
      currentVersion?: string | null;
    }
  | { status: "already-current"; version: string }
  | {
      status: "list-versions";
      formattedVersionList: string;
      versionCount: number;
    }
  | { status: "error"; error: string; hint?: string | null };

/**
 * Result from the download callback
 */
export type SubagentDownloadActionResult =
  | {
      success: true;
      version: string;
      isUpdate: boolean;
      installedTo: string;
      subagentDisplayName: string;
      profileUpdateMessage?: string | null;
      warnings: Array<string>;
    }
  | { success: false; error: string };

/**
 * Callbacks for the subagent download flow
 */
export type SubagentDownloadFlowCallbacks = {
  onSearch: () => Promise<SubagentSearchResult>;
  onDownload: () => Promise<SubagentDownloadActionResult>;
};

/**
 * Result of the subagent download flow
 */
export type SubagentDownloadFlowResult = {
  version: string;
  isUpdate: boolean;
  statusMessage: string;
};

/**
 * Execute the subagent download flow
 *
 * This function handles the complete subagent download UX:
 * 1. Shows spinner while searching registries
 * 2. Handles search outcomes (error, already-current, list-versions, ready)
 * 3. Shows spinner while downloading
 * 4. Displays success note with install location and skillset status
 *
 * @param args - Flow configuration
 * @param args.subagentDisplayName - Display name of the subagent being downloaded
 * @param args.callbacks - Callback functions for searching and downloading
 * @param args.nonInteractive - If true, skip interactive prompts and use defaults
 *
 * @returns Download result on success, null on failure
 */
export const subagentDownloadFlow = async (args: {
  subagentDisplayName: string;
  nonInteractive?: boolean | null;
  callbacks: SubagentDownloadFlowCallbacks;
}): Promise<SubagentDownloadFlowResult | null> => {
  const { subagentDisplayName, nonInteractive, callbacks } = args;

  const s = spinner();

  // Phase 1: Search
  s.start("Searching registries...");
  const searchResult = await callbacks.onSearch();

  if (searchResult.status === "error") {
    s.stop("Not found");
    log.error(searchResult.error);
    if (searchResult.hint != null) {
      note(searchResult.hint, "Hint");
    }
    return null;
  }

  s.stop("Found");

  if (searchResult.status === "already-current") {
    log.success(
      `Subagent "${subagentDisplayName}" is already at version ${searchResult.version}.`,
    );

    if (nonInteractive) {
      return {
        version: searchResult.version,
        isUpdate: false,
        statusMessage: "Already up to date",
      };
    }

    const redownload = unwrapPrompt({
      value: await confirm({
        message:
          "Re-download from registry? This will update all subagent dependencies.",
        initialValue: false,
      }),
      cancelMessage: "Download cancelled.",
    });

    if (redownload == null) {
      return null;
    }

    if (!redownload) {
      return {
        version: searchResult.version,
        isUpdate: false,
        statusMessage: "Already up to date",
      };
    }
  }

  if (searchResult.status === "list-versions") {
    note(searchResult.formattedVersionList, "Available Versions");
    const versionLabel =
      searchResult.versionCount === 1
        ? "1 version"
        : `${searchResult.versionCount} versions`;
    return {
      version: "",
      isUpdate: false,
      statusMessage: `${versionLabel} available`,
    };
  }

  // Phase 2: Download
  let downloadMsg: string;
  if (searchResult.status === "already-current") {
    downloadMsg = `Re-downloading "${subagentDisplayName}"...`;
  } else if (searchResult.isUpdate && searchResult.currentVersion != null) {
    downloadMsg = `Updating "${subagentDisplayName}" from ${searchResult.currentVersion} to ${searchResult.targetVersion}...`;
  } else {
    downloadMsg = `Downloading "${subagentDisplayName}"...`;
  }

  s.start(downloadMsg);
  const downloadResult = await callbacks.onDownload();

  if (!downloadResult.success) {
    s.stop("Failed");
    log.error(downloadResult.error);
    return null;
  }

  s.stop("Installed");

  // Phase 3: Report
  if (downloadResult.warnings.length > 0) {
    note(downloadResult.warnings.join("\n"), "Warnings");
  }

  const nextStepsLines = [`Installed to: ${downloadResult.installedTo}`];
  if (downloadResult.profileUpdateMessage != null) {
    nextStepsLines.push(downloadResult.profileUpdateMessage);
  }
  note(nextStepsLines.join("\n"), "Next Steps");

  const statusMessage = downloadResult.isUpdate
    ? `Updated "${subagentDisplayName}" to ${downloadResult.version}`
    : `Downloaded "${subagentDisplayName}" ${downloadResult.version}`;

  return {
    version: downloadResult.version,
    isUpdate: downloadResult.isUpdate,
    statusMessage,
  };
};

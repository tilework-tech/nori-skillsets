/**
 * Registry download flow module
 *
 * Provides a flow for downloading skillset packages from the Nori registry.
 * This flow handles:
 * - Intro message
 * - Spinner while searching registries
 * - Version comparison and already-current detection
 * - Version list display
 * - Spinner while downloading
 * - Success note with install location and switch hint
 * - Outro message
 */

import { spinner, note, log, confirm } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

/**
 * Result from the search callback
 */
export type DownloadSearchResult =
  | {
      status: "ready";
      targetVersion: string;
      isUpdate: boolean;
      currentVersion?: string | null;
    }
  | {
      status: "already-current";
      version: string;
      warnings?: Array<string> | null;
    }
  | {
      status: "list-versions";
      formattedVersionList: string;
      versionCount: number;
    }
  | { status: "error"; error: string; hint?: string | null };

/**
 * Result from the download callback
 */
export type DownloadActionResult =
  | {
      success: true;
      version: string;
      isUpdate: boolean;
      installedTo: string;
      switchHint: string;
      profileDisplayName: string;
      warnings: Array<string>;
    }
  | { success: false; error: string };

/**
 * Callbacks for the registry download flow
 */
export type RegistryDownloadFlowCallbacks = {
  onSearch: () => Promise<DownloadSearchResult>;
  onDownload: () => Promise<DownloadActionResult>;
};

/**
 * Result of the registry download flow
 */
export type RegistryDownloadFlowResult = {
  version: string;
  isUpdate: boolean;
  statusMessage: string;
};

/**
 * Execute the registry download flow
 *
 * This function handles the complete download UX:
 * 1. Shows spinner while searching registries
 * 2. Handles search outcomes (error, already-current, list-versions, ready)
 * 3. Shows spinner while downloading
 * 4. Displays success note with install location and switch hint
 *
 * @param args - Flow configuration
 * @param args.packageDisplayName - Display name of the package being downloaded
 * @param args.callbacks - Callback functions for searching and downloading
 *
 * @returns Download result on success, null on failure
 */
export const registryDownloadFlow = async (args: {
  packageDisplayName: string;
  callbacks: RegistryDownloadFlowCallbacks;
}): Promise<RegistryDownloadFlowResult | null> => {
  const { packageDisplayName, callbacks } = args;

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
    if (searchResult.warnings != null && searchResult.warnings.length > 0) {
      note(searchResult.warnings.join("\n"), "Skill Dependency Warnings");
    }
    log.success(
      `Skillset "${packageDisplayName}" is already at version ${searchResult.version}.`,
    );

    const redownload = unwrapPrompt({
      value: await confirm({
        message:
          "Re-download from registry? This will update all skill dependencies.",
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
    downloadMsg = `Re-downloading "${packageDisplayName}"...`;
  } else if (searchResult.isUpdate && searchResult.currentVersion != null) {
    downloadMsg = `Updating "${packageDisplayName}" from ${searchResult.currentVersion} to ${searchResult.targetVersion}...`;
  } else {
    downloadMsg = `Downloading "${packageDisplayName}"...`;
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
    note(downloadResult.warnings.join("\n"), "Skill Dependency Warnings");
  }

  const nextSteps = [
    `Installed to: ${downloadResult.installedTo}`,
    `To use: ${downloadResult.switchHint}`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  const statusMessage = downloadResult.isUpdate
    ? `Updated "${packageDisplayName}" to ${downloadResult.version}`
    : `Downloaded "${packageDisplayName}" ${downloadResult.version}`;

  return {
    version: downloadResult.version,
    isUpdate: downloadResult.isUpdate,
    statusMessage,
  };
};

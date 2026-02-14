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

import { intro, outro, spinner, note, log } from "@clack/prompts";

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
};

/**
 * Execute the registry download flow
 *
 * This function handles the complete download UX:
 * 1. Shows intro message
 * 2. Shows spinner while searching registries
 * 3. Handles search outcomes (error, already-current, list-versions, ready)
 * 4. Shows spinner while downloading
 * 5. Displays success note with install location and switch hint
 * 6. Shows outro
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

  intro("Download Skillset");

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
    outro("Already up to date");
    return { version: searchResult.version, isUpdate: false };
  }

  if (searchResult.status === "list-versions") {
    note(searchResult.formattedVersionList, "Available Versions");
    const versionLabel =
      searchResult.versionCount === 1
        ? "1 version"
        : `${searchResult.versionCount} versions`;
    outro(`${versionLabel} available`);
    return { version: "", isUpdate: false };
  }

  // Phase 2: Download
  const downloadMsg =
    searchResult.isUpdate && searchResult.currentVersion != null
      ? `Updating "${packageDisplayName}" from ${searchResult.currentVersion} to ${searchResult.targetVersion}...`
      : `Downloading "${packageDisplayName}"...`;

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

  const outroMsg = downloadResult.isUpdate
    ? `Updated "${packageDisplayName}" to ${downloadResult.version}`
    : `Downloaded "${packageDisplayName}" ${downloadResult.version}`;
  outro(outroMsg);

  return {
    version: downloadResult.version,
    isUpdate: downloadResult.isUpdate,
  };
};

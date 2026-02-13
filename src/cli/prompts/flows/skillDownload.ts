/**
 * Skill download flow module
 *
 * Provides a flow for downloading skill packages from the Nori registry.
 * This flow handles:
 * - Intro message
 * - Spinner while searching registries
 * - Version comparison and already-current detection
 * - Version list display
 * - Spinner while downloading
 * - Success note with install location and profile update status
 * - Outro message
 */

import { intro, outro, spinner, note, log } from "@clack/prompts";

/**
 * Result from the search callback
 */
export type SkillSearchResult =
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
export type SkillDownloadActionResult =
  | {
      success: true;
      version: string;
      isUpdate: boolean;
      installedTo: string;
      skillDisplayName: string;
      profileUpdateMessage?: string | null;
      warnings: Array<string>;
    }
  | { success: false; error: string };

/**
 * Callbacks for the skill download flow
 */
export type SkillDownloadFlowCallbacks = {
  onSearch: () => Promise<SkillSearchResult>;
  onDownload: () => Promise<SkillDownloadActionResult>;
};

/**
 * Result of the skill download flow
 */
export type SkillDownloadFlowResult = {
  version: string;
  isUpdate: boolean;
};

/**
 * Execute the skill download flow
 *
 * This function handles the complete skill download UX:
 * 1. Shows intro message
 * 2. Shows spinner while searching registries
 * 3. Handles search outcomes (error, already-current, list-versions, ready)
 * 4. Shows spinner while downloading
 * 5. Displays success note with install location and profile status
 * 6. Shows outro
 *
 * @param args - Flow configuration
 * @param args.skillDisplayName - Display name of the skill being downloaded
 * @param args.callbacks - Callback functions for searching and downloading
 *
 * @returns Download result on success, null on failure
 */
export const skillDownloadFlow = async (args: {
  skillDisplayName: string;
  callbacks: SkillDownloadFlowCallbacks;
}): Promise<SkillDownloadFlowResult | null> => {
  const { skillDisplayName, callbacks } = args;

  intro("Download Skill");

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
      `Skill "${skillDisplayName}" is already at version ${searchResult.version}.`,
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
      ? `Updating "${skillDisplayName}" from ${searchResult.currentVersion} to ${searchResult.targetVersion}...`
      : `Downloading "${skillDisplayName}"...`;

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

  const outroMsg = downloadResult.isUpdate
    ? `Updated "${skillDisplayName}" to ${downloadResult.version}`
    : `Downloaded "${skillDisplayName}" ${downloadResult.version}`;
  outro(outroMsg);

  return {
    version: downloadResult.version,
    isUpdate: downloadResult.isUpdate,
  };
};

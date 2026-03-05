/**
 * List versions flow module
 *
 * Provides a simple flow for displaying available versions of a package.
 * This flow handles:
 * - Intro message
 * - Spinner while fetching versions
 * - Note display with version information
 * - Outro message
 */

import { spinner, note, log } from "@clack/prompts";

import { bold, brightCyan } from "@/cli/logger.js";

import type { Packument } from "@/api/registrar.js";

/**
 * Callbacks for the list versions flow
 */
export type ListVersionsFlowCallbacks = {
  onFetchPackument: () => Promise<Packument | null>;
};

/**
 * Result of the list versions flow
 */
export type ListVersionsFlowResult = {
  versions: Array<string>;
  latestVersion: string | null;
  statusMessage: string;
} | null;

/**
 * Format version list for display in a note
 * @param args - The function arguments
 * @param args.packument - The package metadata
 *
 * @returns Formatted version list string
 */
const formatVersionsForNote = (args: { packument: Packument }): string => {
  const { packument } = args;
  const distTags = packument["dist-tags"];
  const versions = Object.keys(packument.versions);
  const timeInfo = packument.time ?? {};

  // Sort versions in descending order (newest first)
  const sortedVersions = versions.sort((a, b) => {
    const timeA = timeInfo[a] ? new Date(timeInfo[a]).getTime() : 0;
    const timeB = timeInfo[b] ? new Date(timeInfo[b]).getTime() : 0;
    return timeB - timeA;
  });

  const lines: Array<string> = [];

  // Dist-tags section
  lines.push(bold({ text: "Dist-tags:" }));
  for (const [tag, version] of Object.entries(distTags)) {
    lines.push(`  ${brightCyan({ text: tag })}: ${version}`);
  }

  lines.push("");

  // Versions section
  lines.push(bold({ text: "Versions:" }));
  for (const version of sortedVersions) {
    const timestamp = timeInfo[version]
      ? new Date(timeInfo[version]).toLocaleDateString()
      : "";
    const tags = Object.entries(distTags)
      .filter(([, v]) => v === version)
      .map(([t]) => t);
    const tagStr =
      tags.length > 0 ? ` (${brightCyan({ text: tags.join(", ") })})` : "";
    const timeStr = timestamp ? ` - ${timestamp}` : "";
    lines.push(`  ${version}${tagStr}${timeStr}`);
  }

  return lines.join("\n");
};

/**
 * Execute the list versions flow
 *
 * This function handles the complete list versions UX:
 * 1. Shows spinner while fetching package info
 * 2. Displays version info in a note
 *
 * @param args - Flow configuration
 * @param args.profileDisplayName - Display name for the skillset
 * @param args.registryUrl - The registry URL
 * @param args.callbacks - Callback functions for fetching packument
 *
 * @returns Version info on success, null on failure
 */
export const listVersionsFlow = async (args: {
  profileDisplayName: string;
  registryUrl: string;
  callbacks: ListVersionsFlowCallbacks;
}): Promise<ListVersionsFlowResult> => {
  const { profileDisplayName, registryUrl, callbacks } = args;

  // profileDisplayName available for use by caller

  const s = spinner();
  s.start(`Fetching from ${registryUrl}...`);

  const packument = await callbacks.onFetchPackument();

  if (packument == null) {
    s.stop("Not found");
    log.error(`Skillset "${profileDisplayName}" not found in ${registryUrl}`);
    return null;
  }

  const versions = Object.keys(packument.versions);

  if (versions.length === 0) {
    s.stop("No versions");
    log.warn(`Skillset "${profileDisplayName}" has no published versions`);
    return null;
  }

  s.stop(`Found ${versions.length} version(s)`);

  note(formatVersionsForNote({ packument }), profileDisplayName);

  return {
    versions,
    latestVersion: packument["dist-tags"].latest ?? null,
    statusMessage: `Upload with: nori-skillsets upload ${profileDisplayName}@<version>`,
  };
};

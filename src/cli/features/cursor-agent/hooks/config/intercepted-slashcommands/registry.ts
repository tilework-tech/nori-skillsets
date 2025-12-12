/**
 * Registry of intercepted slash commands for cursor-agent
 */

import type { InterceptedSlashCommand } from "./types.js";

import { noriInstallLocation } from "./nori-install-location.js";
import { noriRegistryDownload } from "./nori-registry-download.js";
import { noriRegistrySearch } from "./nori-registry-search.js";
import { noriRegistryUpdate } from "./nori-registry-update.js";
import { noriRegistryUpload } from "./nori-registry-upload.js";
import { noriSwitchProfile } from "./nori-switch-profile.js";
import { noriToggleAutoupdate } from "./nori-toggle-autoupdate.js";
import { noriToggleSessionTranscripts } from "./nori-toggle-session-transcripts.js";

/**
 * List of all intercepted slash commands for cursor-agent
 * Commands are checked in order; first matching command wins
 */
export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriInstallLocation,
  noriRegistryDownload,
  noriRegistrySearch,
  noriRegistryUpdate,
  noriRegistryUpload,
  noriSwitchProfile,
  noriToggleAutoupdate,
  noriToggleSessionTranscripts,
];

/**
 * Registry of intercepted slash commands
 *
 * Each command is checked in order, and the first matching command is executed.
 * All matchers should be unique across commands.
 */

import type { InterceptedSlashCommand } from "./types.js";

import { noriDownloadProfile } from "./nori-download-profile.js";
import { noriInstallLocation } from "./nori-install-location.js";
import { noriSearchProfiles } from "./nori-search-profiles.js";
import { noriSwitchProfile } from "./nori-switch-profile.js";
import { noriToggleAutoupdate } from "./nori-toggle-autoupdate.js";
import { noriToggleSessionTranscripts } from "./nori-toggle-session-transcripts.js";

/**
 * Registry of all intercepted slash commands
 */
export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriDownloadProfile,
  noriInstallLocation,
  noriSearchProfiles,
  noriSwitchProfile,
  noriToggleAutoupdate,
  noriToggleSessionTranscripts,
];

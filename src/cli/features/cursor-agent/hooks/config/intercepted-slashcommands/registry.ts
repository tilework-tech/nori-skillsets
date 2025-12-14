/**
 * Registry of intercepted slash commands for cursor-agent
 */

import type { InterceptedSlashCommand } from "./types.js";

import { noriInstallLocation } from "./nori-install-location.js";
import { noriSwitchProfile } from "./nori-switch-profile.js";
import { noriToggleAutoupdate } from "./nori-toggle-autoupdate.js";
import { noriToggleSessionTranscripts } from "./nori-toggle-session-transcripts.js";

/**
 * List of all intercepted slash commands for cursor-agent
 * Commands are checked in order; first matching command wins
 */
export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriInstallLocation,
  noriSwitchProfile,
  noriToggleAutoupdate,
  noriToggleSessionTranscripts,
];

/**
 * Registry of intercepted slash commands
 *
 * Each command is checked in order, and the first matching command is executed.
 * All matchers should be unique across commands.
 */

import type { InterceptedSlashCommand } from "./types.js";

import { noriInstallLocation } from "./nori-install-location.js";
import { noriPruneContext } from "./nori-prune-context.js";
import { noriRegistryDownload } from "./nori-registry-download.js";
import { noriRegistrySearch } from "./nori-registry-search.js";
import { noriRegistryUpdate } from "./nori-registry-update.js";
import { noriRegistryUpload } from "./nori-registry-upload.js";
import { noriSkillDownload } from "./nori-skill-download.js";
import { noriSkillSearch } from "./nori-skill-search.js";
import { noriSkillUpload } from "./nori-skill-upload.js";
import { noriSwitchProfile } from "./nori-switch-profile.js";
import { noriToggleAutoupdate } from "./nori-toggle-autoupdate.js";
import { noriToggleSessionTranscripts } from "./nori-toggle-session-transcripts.js";

/**
 * Registry of all intercepted slash commands
 */
export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriInstallLocation,
  noriPruneContext,
  noriRegistryUpload,
  noriRegistryDownload,
  noriRegistryUpdate,
  noriRegistrySearch,
  noriSkillUpload,
  noriSkillDownload,
  noriSkillSearch,
  noriSwitchProfile,
  noriToggleAutoupdate,
  noriToggleSessionTranscripts,
];

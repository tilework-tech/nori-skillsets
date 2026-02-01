/**
 * Onboard Command
 *
 * Handles profile selection and authentication configuration.
 * This is the second step in the installation process (after init).
 *
 * Responsibilities:
 * - Prompt for Nori Web authentication credentials
 * - Prompt for profile selection
 * - Update config with auth and selected profile
 */

import { loadConfig, saveConfig, getAgentProfile } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  error,
  info,
  newline,
  raw,
  wrapText,
  brightCyan,
  boldWhite,
  gray,
} from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeInstallDir } from "@/utils/path.js";
import {
  isValidOrgId,
  buildWatchtowerUrl,
  normalizeUrl,
  isValidUrl,
} from "@/utils/url.js";

import type { Command } from "commander";

/**
 * Get available profiles from installed location
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agent - AI agent implementation
 *
 * @returns Array of available profiles with names and descriptions
 */
const getAvailableProfiles = async (args: {
  installDir: string;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<Array<{ name: string; description: string }>> => {
  const { installDir, agent } = args;

  const installedProfileNames = await agent.listProfiles({ installDir });

  return installedProfileNames.map((name) => ({
    name,
    description: "Installed profile",
  }));
};

/**
 * Prompt for authentication credentials
 *
 * @returns Auth credentials or null if user skips
 */
const promptForAuth = async (): Promise<{
  username: string;
  password: string;
  organizationUrl: string;
} | null> => {
  info({
    message: "If you have access to Nori Web, enter your email address below.",
  });
  newline();
  info({
    message: wrapText({
      text: "Nori Web provides a context engine for enhancing your coding agent with additional knowledge and enables sharing custom profiles across your team.",
    }),
  });
  newline();
  info({
    message: "Learn more at usenori.ai",
  });
  newline();

  const username = await promptUser({
    prompt: "Email address or hit enter to skip: ",
  });

  if (!username || username.trim() === "") {
    info({ message: "Great. Let's move on to selecting your profile." });
    newline();
    return null;
  }

  const password = await promptUser({
    prompt: "Enter your password: ",
    hidden: true,
  });

  // Prompt for org ID or URL with validation
  let organizationUrl: string | null = null;
  while (organizationUrl == null) {
    const orgInput = await promptUser({
      prompt:
        "Organization ID (the prefix to your URL, e.g., 'mycompany' for https://mycompany.tilework.tech): ",
    });

    if (!orgInput) {
      error({
        message: "Organization ID is required for backend installation",
      });
      continue;
    }

    // Check if it's a valid URL (fallback for local dev)
    if (isValidUrl({ input: orgInput })) {
      organizationUrl = normalizeUrl({ baseUrl: orgInput });
    } else if (isValidOrgId({ orgId: orgInput })) {
      // Not a URL, check if it's a valid org ID
      organizationUrl = buildWatchtowerUrl({ orgId: orgInput });
    } else {
      error({
        message: `Invalid input: "${orgInput}". Enter a lowercase org ID (letters, numbers, hyphens) or a full URL.`,
      });
    }
  }

  if (!password) {
    error({
      message: "Password is required for backend installation",
    });
    process.exit(1);
  }

  info({ message: "Installing with backend support..." });
  newline();

  return {
    username: username.trim(),
    password: password.trim(),
    organizationUrl,
  };
};

/**
 * Prompt for profile selection
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agent - AI agent implementation
 *
 * @returns Selected profile
 */
const promptForProfile = async (args: {
  installDir: string;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<{ baseProfile: string }> => {
  const { installDir, agent } = args;

  // Get available profiles from both source and installed locations
  const profiles = await getAvailableProfiles({ installDir, agent });

  if (profiles.length === 0) {
    error({
      message:
        "No profiles found. Download a profile from the registry first using 'nori-ai download'.",
    });
    process.exit(1);
  }

  // Display available profiles
  info({
    message: wrapText({
      text: "Nori profiles contain a complete configuration for customizing your coding agent, including a CLAUDE/AGENT.md, skills, subagents, and commands.",
    }),
  });
  newline();

  // Display all profiles in a simple numbered list
  profiles.forEach((p, index) => {
    const number = brightCyan({ text: `${index + 1}.` });
    const name = boldWhite({ text: p.name });
    const description = gray({ text: p.description });
    raw({ message: `${number} ${name}` });
    raw({ message: `   ${description}` });
    newline();
  });

  info({
    message: wrapText({
      text: "If you would like to customize a profile, you can prompt your coding agent to do so in session or use the slash command /nori-create-profile.",
    }),
  });
  newline();

  // Loop until valid selection
  let selectedProfileName: string;
  while (true) {
    const response = await promptUser({
      prompt: `Select a profile (1-${profiles.length}): `,
    });

    const selectedIndex = parseInt(response) - 1;
    if (selectedIndex >= 0 && selectedIndex < profiles.length) {
      const selected = profiles[selectedIndex];
      info({ message: `Loading "${selected.name}" profile...` });
      selectedProfileName = selected.name;
      break;
    }

    // Invalid selection - show error and loop
    error({
      message: `Invalid selection "${response}". Please enter a number between 1 and ${profiles.length}.`,
    });
    newline();
  }

  return { baseProfile: selectedProfileName };
};

/**
 * Main onboard function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.profile - Profile to use (required for non-interactive mode without existing profile)
 * @param args.agent - Agent to configure (defaults to claude-code)
 */
export const onboardMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  profile?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { installDir, nonInteractive, profile, agent } = args ?? {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Load existing config - init must have been run first
  const existingConfig = await loadConfig({ installDir: normalizedInstallDir });

  if (existingConfig == null) {
    error({
      message: "No Nori configuration found. Please run 'nori-ai init' first.",
    });
    process.exit(1);
  }

  // Determine if this agent already has a profile
  const existingProfile = getAgentProfile({
    config: existingConfig,
    agentName: agentImpl.name,
  });

  let auth: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null = null;
  let selectedProfile: { baseProfile: string };

  if (nonInteractive) {
    // Non-interactive mode: require profile flag if no existing profile
    if (profile == null && existingProfile == null) {
      error({
        message:
          "Non-interactive onboard requires --profile flag when no existing profile is set",
      });
      info({
        message:
          "Example: nori-ai onboard --non-interactive --profile <profile-name>",
      });
      process.exit(1);
    }

    selectedProfile = profile ? { baseProfile: profile } : existingProfile!;

    // Keep existing auth if present
    if (existingConfig.auth != null) {
      auth = {
        username: existingConfig.auth.username,
        password: existingConfig.auth.password ?? "",
        organizationUrl: existingConfig.auth.organizationUrl,
      };
    }
  } else if (existingConfig.auth != null) {
    // Interactive mode with existing auth: check if user wants to reuse config
    info({
      message:
        "I found an existing Nori configuration file. Do you want to keep it?",
    });
    newline();
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    if (existingProfile != null) {
      info({
        message: `  Profile: ${existingProfile.baseProfile}`,
      });
    }
    newline();

    const useExisting = await promptUser({
      prompt: "Keep existing configuration? (y/n): ",
    });

    if (useExisting.match(/^[Yy]$/)) {
      info({ message: "Using existing configuration..." });
      // Keep existing auth and profile
      auth = {
        username: existingConfig.auth.username,
        password: existingConfig.auth.password ?? "",
        organizationUrl: existingConfig.auth.organizationUrl,
      };
      selectedProfile =
        existingProfile ??
        (await promptForProfile({
          installDir: normalizedInstallDir,
          agent: agentImpl,
        }));
    } else {
      newline();
      auth = await promptForAuth();
      selectedProfile = await promptForProfile({
        installDir: normalizedInstallDir,
        agent: agentImpl,
      });
    }
  } else {
    // Interactive mode without existing auth: prompt for new auth and profile
    auth = await promptForAuth();
    selectedProfile = await promptForProfile({
      installDir: normalizedInstallDir,
      agent: agentImpl,
    });
  }

  // Build updated agents map
  const agents = {
    ...(existingConfig.agents ?? {}),
    [agentImpl.name]: { profile: selectedProfile },
  };

  // Save updated config
  await saveConfig({
    username: auth?.username ?? existingConfig.auth?.username ?? null,
    password: auth?.password ?? existingConfig.auth?.password ?? null,
    refreshToken: existingConfig.auth?.refreshToken ?? null,
    organizationUrl:
      auth?.organizationUrl ?? existingConfig.auth?.organizationUrl ?? null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    agents,
    version: existingConfig.version ?? null,
    installDir: normalizedInstallDir,
  });
};

/**
 * Register the 'onboard' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerOnboardCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("onboard")
    .description("Select a profile and configure authentication")
    .option(
      "-p, --profile <name>",
      "Profile to use (required for non-interactive mode without existing profile)",
    )
    .action(async (options) => {
      // Get global options from parent
      const globalOpts = program.opts();

      await onboardMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
        profile: options.profile || null,
        agent: globalOpts.agent || null,
      });
    });
};

/**
 * Configuration management for Nori Profiles installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as path from "path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { warn } from "@/cli/logger.js";
import { normalizeUrl } from "@/utils/url.js";

/**
 * Registry authentication credentials
 */
export type RegistryAuth = {
  username: string;
  password: string;
  registryUrl: string;
};

/**
 * Authentication credentials - supports both legacy password and new refresh token
 */
export type AuthCredentials = {
  username: string;
  organizationUrl: string;
  // Token-based auth (preferred)
  refreshToken?: string | null;
  // Legacy password-based auth (deprecated, will be removed)
  password?: string | null;
};

/**
 * Agent-specific configuration
 */
export type AgentConfig = {
  profile?: { baseProfile: string } | null;
};

/**
 * Unified configuration type for Nori Profiles
 * Contains all persisted fields from disk plus required installDir
 *
 * Note: Installed agents are derived from the keys of the `agents` object.
 * Use `getInstalledAgents({ config })` to get the list of installed agents.
 */
export type Config = {
  auth?: AuthCredentials | null;
  /** @deprecated Use agents.claude-code.profile instead */
  profile?: {
    baseProfile: string;
  } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
  registryAuths?: Array<RegistryAuth> | null;
  /** Per-agent configuration settings. Keys indicate which agents are installed. */
  agents?: Record<string, AgentConfig> | null;
  /** Installed version of Nori */
  version?: string | null;
};

/**
 * Raw disk config type - represents the JSON structure on disk before transformation
 * This is what JSON schema validates against
 * Includes both legacy flat format (username/password at root) and new nested format (auth: {...})
 */
type RawDiskConfig = {
  // Legacy flat format (pre-v19.0.0)
  username?: string | null;
  password?: string | null;
  refreshToken?: string | null;
  organizationUrl?: string | null;
  // New nested format (v19.0.0+)
  auth?: {
    username?: string | null;
    password?: string | null;
    refreshToken?: string | null;
    organizationUrl?: string | null;
  } | null;
  // Common fields
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  profile?: { baseProfile?: string | null } | null;
  installDir?: string | null;
  registryAuths?: Array<RegistryAuth> | null;
  agents?: Record<string, AgentConfig> | null;
  version?: string | null;
};

/**
 * Get the path to the config file
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The absolute path to .nori-config.json
 */
export const getConfigPath = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".nori-config.json");
};

/**
 * Get default profile
 * @returns Default profile (senior-swe)
 */
export const getDefaultProfile = (): { baseProfile: string } => {
  return {
    baseProfile: "senior-swe",
  };
};

/**
 * Check if config represents a paid installation
 * @param args - Configuration arguments
 * @param args.config - The config to check
 *
 * @returns True if the config has valid auth credentials (paid install)
 */
export const isPaidInstall = (args: { config: Config }): boolean => {
  return args.config.auth != null;
};

/**
 * Check if config uses legacy password-based authentication
 * @param args - Configuration arguments
 * @param args.config - The config to check
 *
 * @returns True if the config has password but no refreshToken (needs migration)
 */
export const isLegacyPasswordConfig = (args: { config: Config }): boolean => {
  const { config } = args;
  if (config.auth == null) {
    return false;
  }
  // Legacy if has password but no refreshToken
  return config.auth.password != null && config.auth.refreshToken == null;
};

/**
 * Get registry authentication for a specific registry URL
 * @param args - Configuration arguments
 * @param args.config - The config to search
 * @param args.registryUrl - The registry URL to find auth for
 *
 * @returns The matching RegistryAuth or null if not found
 */
export const getRegistryAuth = (args: {
  config: Config;
  registryUrl: string;
}): RegistryAuth | null => {
  const { config, registryUrl } = args;
  if (config.registryAuths == null) {
    return null;
  }
  const normalizedSearchUrl = normalizeUrl({ baseUrl: registryUrl });
  return (
    config.registryAuths.find(
      (auth) =>
        normalizeUrl({ baseUrl: auth.registryUrl }) === normalizedSearchUrl,
    ) ?? null
  );
};

/**
 * Get list of installed agents from config
 * Derives installed agents from the keys of the agents object
 * Returns ['claude-code'] by default for backwards compatibility with older configs
 * @param args - Configuration arguments
 * @param args.config - The config to check
 *
 * @returns Array of installed agent names
 */
export const getInstalledAgents = (args: { config: Config }): Array<string> => {
  const { config } = args;
  const agents = Object.keys(config.agents ?? {});
  return agents.length > 0 ? agents : ["claude-code"];
};

/**
 * Get the profile for a specific agent
 * @param args - Configuration arguments
 * @param args.config - The config to search
 * @param args.agentName - The agent name to get profile for
 *
 * @returns The agent's profile or null if not found
 */
export const getAgentProfile = (args: {
  config: Config;
  agentName: string;
}): { baseProfile: string } | null => {
  const { config, agentName } = args;

  // First check the agents field (new format)
  if (config.agents != null) {
    const agentConfig = config.agents[agentName];
    if (agentConfig?.profile != null) {
      return agentConfig.profile;
    }
    return null;
  }

  // Fallback to legacy profile field for claude-code only
  if (agentName === "claude-code" && config.profile != null) {
    return config.profile;
  }

  return null;
};

/**
 * Filter invalid registryAuths entries and warn if any were filtered
 * @param rawAuths - Raw registryAuths array from config file
 *
 * @returns Filtered array of valid registryAuths or undefined if empty
 */
const filterRegistryAuths = (
  rawAuths: unknown,
): Array<RegistryAuth> | undefined => {
  if (!Array.isArray(rawAuths)) {
    return undefined;
  }

  const originalCount = rawAuths.length;
  const validAuths = rawAuths.filter(
    (auth: unknown): auth is RegistryAuth =>
      auth != null &&
      typeof auth === "object" &&
      typeof (auth as Record<string, unknown>).username === "string" &&
      typeof (auth as Record<string, unknown>).password === "string" &&
      typeof (auth as Record<string, unknown>).registryUrl === "string",
  );

  const filteredCount = originalCount - validAuths.length;
  if (filteredCount > 0) {
    warn({
      message: `Filtered ${filteredCount} invalid registryAuths entries (missing required fields)`,
    });
  }

  return validAuths.length > 0 ? validAuths : undefined;
};

/**
 * Load existing configuration from disk
 * Uses JSON schema validation for strict type checking.
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The config if valid, null otherwise
 */
export const loadConfig = async (args: {
  installDir: string;
}): Promise<Config | null> => {
  const { installDir } = args;
  const configPath = getConfigPath({ installDir });

  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, "utf-8");
    const rawConfig = JSON.parse(content);

    if (rawConfig == null || typeof rawConfig !== "object") {
      return null;
    }

    // Filter invalid registryAuths entries before schema validation (with warning)
    // Schema validation would reject entire config for invalid items, but we want
    // lenient behavior: filter invalid entries and warn
    const filteredRegistryAuths = filterRegistryAuths(rawConfig.registryAuths);
    const configToValidate = {
      ...rawConfig,
      registryAuths: filteredRegistryAuths,
    };

    // Deep clone to avoid mutating the original during validation
    const configClone = JSON.parse(JSON.stringify(configToValidate)) as Record<
      string,
      unknown
    >;

    // Validate with schema - this applies defaults and removes unknown properties
    const isValid = validateConfigSchema(configClone);
    if (!isValid) {
      // Schema validation failed (e.g., invalid enum values)
      return null;
    }

    // After validation, configClone conforms to RawDiskConfig
    const validated = configClone as unknown as RawDiskConfig;

    // Build the Config result from validated data
    // After schema validation, types are guaranteed - only need null checks
    const result: Config = {
      auth: null,
      profile: null,
      installDir: validated.installDir ?? installDir,
      sendSessionTranscript: validated.sendSessionTranscript,
      autoupdate: validated.autoupdate,
      registryAuths: filteredRegistryAuths,
      version: validated.version,
    };

    // Build auth - handle both nested format (v19+) and flat format (legacy)
    if (
      validated.auth != null &&
      validated.auth.username != null &&
      validated.auth.organizationUrl != null
    ) {
      // New nested format: auth: { username, organizationUrl, refreshToken, password }
      result.auth = {
        username: validated.auth.username,
        organizationUrl: validated.auth.organizationUrl,
        refreshToken: validated.auth.refreshToken ?? null,
        password: validated.auth.password ?? null,
      };
    } else if (
      validated.username != null &&
      validated.organizationUrl != null &&
      (validated.refreshToken != null || validated.password != null)
    ) {
      // Legacy flat format: username, organizationUrl, refreshToken, password at top level
      result.auth = {
        username: validated.username,
        organizationUrl: validated.organizationUrl,
        refreshToken: validated.refreshToken ?? null,
        password: validated.password ?? null,
      };
    }

    // Set profile if it has a baseProfile
    if (validated.profile?.baseProfile != null) {
      result.profile = { baseProfile: validated.profile.baseProfile };
    }

    // Set agents, or mirror legacy profile to agents.claude-code for backwards compat
    if (validated.agents != null) {
      result.agents = validated.agents;
    } else if (result.profile != null) {
      result.agents = { "claude-code": { profile: result.profile } };
    }

    // Return result if we have meaningful config data
    if (
      result.auth != null ||
      result.profile != null ||
      result.agents != null ||
      result.sendSessionTranscript != null
    ) {
      return result;
    }
  } catch {
    // File doesn't exist or is invalid JSON
  }

  return null;
};

/**
 * Save configuration to disk
 * @param args - Configuration arguments
 * @param args.username - User's username (null to skip auth)
 * @param args.password - User's password (deprecated, use refreshToken instead)
 * @param args.refreshToken - Firebase refresh token (preferred over password)
 * @param args.organizationUrl - Organization URL (null to skip auth)
 * @param args.profile - Profile selection (null to skip profile) - deprecated, use agents instead
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.autoupdate - Autoupdate setting (null to skip)
 * @param args.installDir - Installation directory
 * @param args.registryAuths - Array of registry authentication credentials (null to skip)
 * @param args.agents - Per-agent configuration settings (null to skip). Keys indicate installed agents.
 * @param args.version - Installed version of Nori (null to skip)
 */
export const saveConfig = async (args: {
  username: string | null;
  password?: string | null;
  refreshToken?: string | null;
  organizationUrl: string | null;
  profile?: { baseProfile: string } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  registryAuths?: Array<RegistryAuth> | null;
  agents?: Record<string, AgentConfig> | null;
  version?: string | null;
  installDir: string;
}): Promise<void> => {
  const {
    username,
    password,
    refreshToken,
    organizationUrl,
    profile,
    sendSessionTranscript,
    autoupdate,
    registryAuths,
    agents,
    version,
    installDir,
  } = args;
  const configPath = getConfigPath({ installDir });

  const config: any = {};

  // Add auth credentials in nested format if provided
  // Prefer refreshToken over password (token-based auth is more secure)
  if (username != null && organizationUrl != null) {
    // Normalize organization URL to remove trailing slashes
    const normalizedUrl = normalizeUrl({ baseUrl: organizationUrl });

    config.auth = {
      username,
      organizationUrl: normalizedUrl,
      // If refreshToken is provided, use it and don't store password
      refreshToken: refreshToken ?? null,
      // Only save password if no refreshToken (legacy support)
      password: refreshToken != null ? null : (password ?? null),
    };
  }

  // Add agents if provided (new multi-agent format)
  if (agents != null) {
    config.agents = agents;

    // For backwards compatibility, also write legacy profile field if claude-code has a profile
    const claudeCodeProfile = agents["claude-code"]?.profile;
    if (claudeCodeProfile != null) {
      config.profile = claudeCodeProfile;
    }
  } else if (profile != null) {
    // Legacy: Add profile if provided (when agents is not used)
    config.profile = profile;
  }

  // Add sendSessionTranscript if provided
  if (sendSessionTranscript != null) {
    config.sendSessionTranscript = sendSessionTranscript;
  }

  // Add autoupdate if provided
  if (autoupdate != null) {
    config.autoupdate = autoupdate;
  }

  // Add registryAuths if provided and not empty
  if (registryAuths != null && registryAuths.length > 0) {
    config.registryAuths = registryAuths;
  }

  // Add version if provided
  if (version != null) {
    config.version = version;
  }

  // Always save installDir
  config.installDir = installDir;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
};

/**
 * Validation result type
 */
export type ConfigValidationResult = {
  valid: boolean;
  message: string;
  errors?: Array<string> | null;
};

// JSON schema for nori-config.json - single source of truth for validation
const configSchema = {
  type: "object",
  properties: {
    // New nested auth format (v19+)
    auth: {
      type: ["object", "null"],
      properties: {
        username: { type: "string" },
        password: { type: ["string", "null"] },
        refreshToken: { type: ["string", "null"] },
        organizationUrl: { type: "string", format: "uri" },
      },
      required: ["username", "organizationUrl"],
    },
    // Legacy flat auth fields (deprecated, kept for backwards compatibility)
    username: { type: "string" },
    password: { type: "string" },
    refreshToken: { type: "string" },
    organizationUrl: { type: "string", format: "uri" },
    sendSessionTranscript: {
      type: "string",
      enum: ["enabled", "disabled"],
      default: "enabled",
    },
    autoupdate: {
      type: "string",
      enum: ["enabled", "disabled"],
      default: "disabled",
    },
    profile: {
      type: ["object", "null"],
      properties: {
        baseProfile: { type: "string" },
      },
    },
    installDir: { type: "string" },
    registryAuths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          username: { type: "string" },
          password: { type: "string" },
          registryUrl: { type: "string" },
        },
        required: ["username", "password", "registryUrl"],
      },
    },
    agents: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          profile: {
            type: ["object", "null"],
            properties: {
              baseProfile: { type: "string" },
            },
          },
        },
      },
    },
    version: { type: "string" },
  },
  additionalProperties: false,
};

// Configured Ajv instance for schema validation
const ajv = new Ajv({
  allErrors: true,
  useDefaults: true,
  removeAdditional: true,
});
addFormats(ajv);

// Compiled validator for config schema
const validateConfigSchema = ajv.compile(configSchema);

/**
 * Validate configuration file
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Validation result with details
 */
export const validateConfig = async (args: {
  installDir: string;
}): Promise<ConfigValidationResult> => {
  const { installDir } = args;
  const configPath = getConfigPath({ installDir });
  const errors: Array<string> = [];

  // Check if config file exists
  try {
    await fs.access(configPath);
  } catch {
    return {
      valid: false,
      message: "No nori-config.json found",
      errors: [
        `Config file not found at ${configPath}`,
        'Run "nori-ai install" to create configuration',
      ],
    };
  }

  // Try to load config
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    return {
      valid: false,
      message: "Unable to read nori-config.json",
      errors: [`Failed to read config file: ${err}`],
    };
  }

  // Try to parse JSON
  let config: any;
  try {
    config = JSON.parse(content);
  } catch (err) {
    return {
      valid: false,
      message: "Invalid JSON in nori-config.json",
      errors: [`Config file contains invalid JSON: ${err}`],
    };
  }

  // Check if credentials are present (schema validation will check types)
  const hasUsername = config.username != null;
  const hasPassword = config.password != null;
  const hasOrgUrl = config.organizationUrl != null;

  const credentialsProvided = [hasUsername, hasPassword, hasOrgUrl];
  const someProvided = credentialsProvided.some((v) => v);
  const allProvided = credentialsProvided.every((v) => v);

  // If some credentials are provided but not all, that's an error
  if (someProvided && !allProvided) {
    if (!hasUsername) {
      errors.push(
        'Missing "username" field (required when credentials are provided)',
      );
    }
    if (!hasPassword) {
      errors.push(
        'Missing "password" field (required when credentials are provided)',
      );
    }
    if (!hasOrgUrl) {
      errors.push(
        'Missing "organizationUrl" field (required when credentials are provided)',
      );
    }
    return {
      valid: false,
      message: "Partial credentials provided - all fields are required",
      errors,
    };
  }

  // If no credentials provided, it's free mode
  if (!someProvided) {
    return {
      valid: true,
      message: "Config is valid for free mode (no credentials provided)",
      errors: null,
    };
  }

  // All credentials provided - validate with JSON schema
  // Use shared validator with formats support (format: "uri" validates organizationUrl)
  const configClone = JSON.parse(JSON.stringify(config));
  const valid = validateConfigSchema(configClone);

  // If schema validation failed, collect errors
  if (!valid && validateConfigSchema.errors) {
    for (const error of validateConfigSchema.errors) {
      const path = error.instancePath || "(root)";
      const message = error.message || "unknown error";
      errors.push(`Config validation error at ${path}: ${message}`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: "Config has validation errors",
      errors,
    };
  }

  return {
    valid: true,
    message: "Config is valid for paid mode",
    errors: null,
  };
};

/**
 * Configuration management for Nori Profiles installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { normalizeUrl, extractOrgId, buildRegistryUrl } from "@/utils/url.js";

/**
 * Registry authentication credentials
 * Supports both legacy password auth and new refresh token auth
 */
export type RegistryAuth = {
  username: string;
  registryUrl: string;
  refreshToken?: string | null;
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
  // Organizations the user has access to
  organizations?: Array<string> | null;
  // Whether the user is an admin for their organization
  isAdmin?: boolean | null;
};

/**
 * Agent-specific configuration
 */
export type AgentConfig = {
  profile?: { baseProfile: string } | null;
};

/**
 * Valid agent names for configuration.
 * Only "claude-code" is currently supported.
 */
export type ConfigAgentName = "claude-code";

/**
 * Unified configuration type for Nori Profiles
 * Contains all persisted fields from disk plus required installDir
 *
 * Note: Installed agents are derived from the keys of the `agents` object.
 * Use `getInstalledAgents({ config })` to get the list of installed agents.
 */
export type Config = {
  auth?: AuthCredentials | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
  /**
   * Per-agent configuration settings. Keys indicate which agents are installed.
   * Note: Only "claude-code" is currently a valid agent name.
   */
  agents?: { [key in ConfigAgentName]?: AgentConfig } | null;
  /** Installed version of Nori */
  version?: string | null;
  /** Organization ID for transcript uploads (e.g., "myorg" -> https://myorg.noriskillsets.dev) */
  transcriptDestination?: string | null;
  /** Manually enable the experimental UI (clack-based TUI flows) */
  experimentalUi?: boolean | null;
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
    organizations?: Array<string> | null;
    isAdmin?: boolean | null;
  } | null;
  // Common fields
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  // Legacy profile field - kept for reading old configs (not written anymore)
  profile?: { baseProfile?: string | null } | null;
  installDir?: string | null;
  agents?: { [key in ConfigAgentName]?: AgentConfig } | null;
  version?: string | null;
  // Transcript upload destination org ID
  transcriptDestination?: string | null;
  // Manually enable experimental UI
  experimentalUi?: boolean | null;
};

/**
 * Get the path to the config file for a given install directory
 * Returns ~/.nori-config.json when no installDir provided (user-global config)
 * Returns $installDir/.nori-config.json when installDir provided (project-local config)
 *
 * @param args - Optional configuration arguments
 * @param args.installDir - Installation directory (null/undefined for user-global config)
 *
 * @returns The absolute path to the config file
 */
export const getConfigPath = (args?: {
  installDir?: string | null;
}): string => {
  const baseDir = args?.installDir ?? os.homedir();
  return path.join(baseDir, ".nori-config.json");
};

/**
 * Find the config file by searching upward from a starting directory
 * Searches current directory, then ancestors, falling back to ~/.nori-config.json
 *
 * @param args - Optional configuration arguments
 * @param args.startDir - Directory to start searching from (defaults to process.cwd())
 *
 * @returns The path to the found config file, or ~/.nori-config.json if none found
 */
export const findConfigPath = async (args?: {
  startDir?: string | null;
}): Promise<string> => {
  const startDir = args?.startDir ?? process.cwd();
  const homeDir = os.homedir();

  let currentDir = startDir;
  let previousDir = "";

  // Search upward from startDir
  while (currentDir !== previousDir) {
    const configPath = path.join(currentDir, ".nori-config.json");
    try {
      await fs.access(configPath);
      return configPath;
    } catch {
      // Config doesn't exist here, continue searching
    }

    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  // Fall back to user-global config
  return path.join(homeDir, ".nori-config.json");
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
 * Uses unified Nori auth (config.auth) to derive registry credentials
 *
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
  const normalizedSearchUrl = normalizeUrl({ baseUrl: registryUrl });

  // Use unified Nori auth if available
  if (config.auth != null && config.auth.organizationUrl != null) {
    const orgId = extractOrgId({ url: config.auth.organizationUrl });

    if (orgId != null) {
      // Derive registry URL from org ID
      const derivedRegistryUrl = buildRegistryUrl({ orgId });

      // Check if requested URL matches derived registry URL
      if (
        normalizeUrl({ baseUrl: derivedRegistryUrl }) === normalizedSearchUrl
      ) {
        return {
          registryUrl: derivedRegistryUrl,
          username: config.auth.username,
          refreshToken: config.auth.refreshToken ?? null,
        };
      }
    }

    // For local dev URLs (localhost), check if auth URL is also local dev
    // If organizationUrl is localhost, use those credentials for any registry request
    const authOrgId = extractOrgId({ url: config.auth.organizationUrl });
    if (authOrgId == null) {
      // Auth URL is local dev (e.g., localhost) - use these credentials
      return {
        registryUrl: normalizedSearchUrl,
        username: config.auth.username,
        refreshToken: config.auth.refreshToken ?? null,
      };
    }
  }

  return null;
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
  agentName: ConfigAgentName;
}): { baseProfile: string } | null => {
  const { config, agentName } = args;

  if (config.agents == null) {
    return null;
  }

  const agentConfig = config.agents[agentName];
  if (agentConfig?.profile != null) {
    return agentConfig.profile;
  }

  return null;
};

/**
 * Load existing configuration from disk
 * Uses JSON schema validation for strict type checking.
 * Searches upward from startDir to find the nearest config file,
 * falling back to ~/.nori-config.json if none found.
 *
 * @param args - Optional configuration arguments
 * @param args.startDir - Directory to start searching from (defaults to process.cwd())
 *
 * @returns The config if valid, null otherwise
 */
export const loadConfig = async (args?: {
  startDir?: string | null;
}): Promise<Config | null> => {
  const configPath = await findConfigPath({ startDir: args?.startDir });

  try {
    await fs.access(configPath);
  } catch {
    return null;
  }

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const rawConfig = JSON.parse(content);

    if (rawConfig == null || typeof rawConfig !== "object") {
      return null;
    }

    // Deep clone to avoid mutating the original during validation
    const configClone = JSON.parse(JSON.stringify(rawConfig)) as Record<
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
      installDir: validated.installDir ?? os.homedir(),
      sendSessionTranscript: validated.sendSessionTranscript,
      autoupdate: validated.autoupdate,
      version: validated.version,
      transcriptDestination: validated.transcriptDestination,
      experimentalUi: validated.experimentalUi,
    };

    // Build auth - handle both nested format (v19+) and flat format (legacy)
    if (
      validated.auth != null &&
      validated.auth.username != null &&
      validated.auth.organizationUrl != null
    ) {
      // New nested format: auth: { username, organizationUrl, refreshToken, password, organizations, isAdmin }
      result.auth = {
        username: validated.auth.username,
        organizationUrl: validated.auth.organizationUrl,
        refreshToken: validated.auth.refreshToken ?? null,
        password: validated.auth.password ?? null,
        organizations: validated.auth.organizations ?? null,
        isAdmin: validated.auth.isAdmin ?? null,
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

    // Set agents if present, or convert legacy profile to agents.claude-code
    if (validated.agents != null) {
      result.agents = validated.agents;
    } else if (validated.profile?.baseProfile != null) {
      // Convert legacy profile to agents.claude-code for backwards compat
      result.agents = {
        "claude-code": {
          profile: { baseProfile: validated.profile.baseProfile },
        },
      };
    }

    // Return result if we have meaningful config data
    if (
      result.auth != null ||
      result.agents != null ||
      result.sendSessionTranscript != null ||
      result.experimentalUi != null
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
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.autoupdate - Autoupdate setting (null to skip)
 * @param args.installDir - Installation directory
 * @param args.agents - Per-agent configuration settings (null to skip). Keys indicate installed agents.
 * @param args.version - Installed version of Nori (null to skip)
 * @param args.organizations - List of organizations the user has access to (null to skip)
 * @param args.isAdmin - Whether the user is an admin for their organization (null to skip)
 * @param args.transcriptDestination - Organization ID for transcript uploads (null to skip)
 * @param args.experimentalUi - Manually enable the experimental UI (null to skip)
 */
export const saveConfig = async (args: {
  username: string | null;
  password?: string | null;
  refreshToken?: string | null;
  organizationUrl: string | null;
  organizations?: Array<string> | null;
  isAdmin?: boolean | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  agents?: { [key in ConfigAgentName]?: AgentConfig } | null;
  version?: string | null;
  transcriptDestination?: string | null;
  experimentalUi?: boolean | null;
  installDir: string;
}): Promise<void> => {
  const {
    username,
    password,
    refreshToken,
    organizationUrl,
    organizations,
    isAdmin,
    sendSessionTranscript,
    autoupdate,
    agents,
    version,
    transcriptDestination,
    experimentalUi,
    installDir,
  } = args;
  const configPath = getConfigPath();

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
      // Organizations the user has access to
      organizations: organizations ?? null,
      // Admin status
      isAdmin: isAdmin ?? null,
    };
  }

  // Add agents if provided
  if (agents != null) {
    config.agents = agents;
  }

  // Add sendSessionTranscript if provided
  if (sendSessionTranscript != null) {
    config.sendSessionTranscript = sendSessionTranscript;
  }

  // Add autoupdate if provided
  if (autoupdate != null) {
    config.autoupdate = autoupdate;
  }

  // Add version if provided
  if (version != null) {
    config.version = version;
  }

  // Add transcriptDestination if provided
  if (transcriptDestination != null) {
    config.transcriptDestination = transcriptDestination;
  }

  // Add experimentalUi if provided
  if (experimentalUi != null) {
    config.experimentalUi = experimentalUi;
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
        organizations: {
          type: ["array", "null"],
          items: { type: "string" },
        },
        isAdmin: { type: ["boolean", "null"] },
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
    // Legacy profile field - kept for reading old configs (not written anymore)
    profile: {
      type: ["object", "null"],
      properties: {
        baseProfile: { type: "string" },
      },
    },
    installDir: { type: "string" },
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
    transcriptDestination: { type: "string" },
    experimentalUi: { type: ["boolean", "null"] },
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
 * Always validates ~/.nori-config.json
 *
 * @returns Validation result with details
 */
export const validateConfig = async (): Promise<ConfigValidationResult> => {
  const configPath = getConfigPath();
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
        'Run "nori-skillsets init" to create configuration',
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

  // If no credentials provided, config is still valid
  if (!someProvided) {
    return {
      valid: true,
      message: "Config is valid (no credentials provided)",
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
    message: "Config is valid",
    errors: null,
  };
};

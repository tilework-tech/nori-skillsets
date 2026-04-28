/**
 * Configuration management for Nori Skillsets installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as path from "path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { extractOrgIdFromApiToken } from "@/utils/apiToken.js";
import { getHomeDir } from "@/utils/home.js";
import { normalizeUrl, extractOrgId, buildRegistryUrl } from "@/utils/url.js";

/**
 * Registry authentication credentials
 * Supports both legacy password auth and new refresh token auth.
 * If `apiToken` is set, the orgId is parsed from the token itself (see `extractOrgIdFromApiToken`).
 */
export type RegistryAuth = {
  username: string | null;
  registryUrl: string;
  refreshToken?: string | null;
  apiToken?: string | null;
};

/**
 * Authentication credentials - supports legacy password, refresh token, and API token auth.
 * API tokens are self-describing: the orgId is embedded in the token format `nori_<orgId>_<64hex>`.
 */
export type AuthCredentials = {
  // Username is optional (null) for API-token-only configs where no Firebase identity is tied
  username?: string | null;
  organizationUrl: string;
  // Token-based auth (preferred for user accounts)
  refreshToken?: string | null;
  // Legacy password-based auth (deprecated, will be removed)
  password?: string | null;
  // API token for non-interactive / programmatic access. Format: nori_<orgId>_<64hex>.
  apiToken?: string | null;
  // Organizations the user has access to
  organizations?: Array<string> | null;
  // Whether the user is an admin for their organization
  isAdmin?: boolean | null;
};

/**
 * Unified configuration type for Nori Skillsets
 * Contains all persisted fields from disk plus required installDir
 */
export type Config = {
  auth?: AuthCredentials | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
  /** Default agents for CLI operations (set via `nori-skillsets config`) */
  defaultAgents?: Array<string> | null;
  /** The currently active skillset, shared across all agents */
  activeSkillset?: string | null;
  /** Organization ID for transcript uploads (e.g., "myorg" -> https://myorg.noriskillsets.dev) */
  transcriptDestination?: string | null;
  /** Whether to delete transcript files after successful upload */
  garbageCollectTranscripts?: "enabled" | "disabled" | null;
  /** Whether to prompt to re-download skillsets from registry on switch */
  redownloadOnSwitch?: "enabled" | "disabled" | null;
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
    apiToken?: string | null;
  } | null;
  // Common fields
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir?: string | null;
  defaultAgents?: Array<string> | null;
  // Current format
  activeSkillset?: string | null;
  // Transcript upload destination org ID
  transcriptDestination?: string | null;
  // Garbage collect transcripts after upload
  garbageCollectTranscripts?: "enabled" | "disabled" | null;
  // Prompt to re-download from registry on switch
  redownloadOnSwitch?: "enabled" | "disabled" | null;
};

/**
 * Get the path to the config file
 * Always returns ~/.nori-config.json
 *
 * @returns The absolute path to the config file
 */
export const getConfigPath = (): string => {
  return path.join(getHomeDir(), ".nori-config.json");
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
    const targetOrgId = extractOrgId({ url: registryUrl });
    const tokenOrgId =
      config.auth.apiToken != null
        ? extractOrgIdFromApiToken({ token: config.auth.apiToken })
        : null;
    const apiTokenMatch =
      tokenOrgId != null && targetOrgId != null && tokenOrgId === targetOrgId;

    if (orgId != null) {
      // Derive registry URL from org ID
      const derivedRegistryUrl = buildRegistryUrl({ orgId });

      // Check if requested URL matches derived registry URL
      if (
        normalizeUrl({ baseUrl: derivedRegistryUrl }) === normalizedSearchUrl
      ) {
        return {
          registryUrl: derivedRegistryUrl,
          username: config.auth.username ?? null,
          refreshToken: config.auth.refreshToken ?? null,
          apiToken: apiTokenMatch ? (config.auth.apiToken ?? null) : null,
        };
      }

      // Also check the noriskillsets.dev subdomain pattern for org registrars
      const orgRegistrarUrl = `https://${orgId}.noriskillsets.dev`;
      if (normalizeUrl({ baseUrl: orgRegistrarUrl }) === normalizedSearchUrl) {
        return {
          registryUrl: orgRegistrarUrl,
          username: config.auth.username ?? null,
          refreshToken: config.auth.refreshToken ?? null,
          apiToken: apiTokenMatch ? (config.auth.apiToken ?? null) : null,
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
        username: config.auth.username ?? null,
        refreshToken: config.auth.refreshToken ?? null,
      };
    }
  }

  return null;
};

/**
 * Get the currently active skillset from config
 * @param args - Configuration arguments
 * @param args.config - The config to read
 *
 * @returns The active skillset name or null if not set
 */
export const getActiveSkillset = (args: { config: Config }): string | null => {
  const { config } = args;
  return config.activeSkillset ?? null;
};

/**
 * Get all default agent names for CLI operations
 * Resolution order: agentOverride as single-element array > config.defaultAgents > ["claude-code"]
 *
 * @param args - Configuration arguments
 * @param args.config - The config to read defaultAgents from
 * @param args.agentOverride - Explicit agent name override (e.g., from --agent CLI flag)
 *
 * @returns Array of resolved agent names
 */
export const getDefaultAgents = (args: {
  config?: Config | null;
  agentOverride?: string | null;
}): Array<string> => {
  const { config, agentOverride } = args;

  if (agentOverride != null && agentOverride !== "") {
    return [agentOverride];
  }

  if (config?.defaultAgents != null && config.defaultAgents.length > 0) {
    return config.defaultAgents;
  }

  return [AgentRegistry.getInstance().getDefaultAgentName()];
};

/**
 * Load existing configuration from disk
 * Uses JSON schema validation for strict type checking.
 * Always reads from ~/.nori-config.json.
 *
 * @returns The config if valid, null otherwise
 */
export const loadConfig = async (): Promise<Config | null> => {
  const configPath = getConfigPath();

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
      installDir: validated.installDir ?? getHomeDir(),
      defaultAgents: validated.defaultAgents,
      sendSessionTranscript: validated.sendSessionTranscript,
      autoupdate: validated.autoupdate,
      transcriptDestination: validated.transcriptDestination,
      garbageCollectTranscripts: validated.garbageCollectTranscripts,
      redownloadOnSwitch: validated.redownloadOnSwitch,
    };

    // Build auth - handle both nested format (v19+) and flat format (legacy)
    if (
      validated.auth != null &&
      validated.auth.organizationUrl != null &&
      (validated.auth.username != null || validated.auth.apiToken != null)
    ) {
      // New nested format: auth: { username, organizationUrl, refreshToken, password, organizations, isAdmin, apiToken }
      result.auth = {
        username: validated.auth.username ?? null,
        organizationUrl: validated.auth.organizationUrl,
        refreshToken: validated.auth.refreshToken ?? null,
        password: validated.auth.password ?? null,
        organizations: validated.auth.organizations ?? null,
        isAdmin: validated.auth.isAdmin ?? null,
        apiToken: validated.auth.apiToken ?? null,
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

    if (validated.activeSkillset != null) {
      result.activeSkillset = validated.activeSkillset;
    }

    // Return result if we have meaningful config data
    if (
      result.auth != null ||
      result.activeSkillset != null ||
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
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.autoupdate - Autoupdate setting (null to skip)
 * @param args.installDir - Installation directory
 * @param args.activeSkillset - The currently active skillset name (null to skip)
 * @param args.organizations - List of organizations the user has access to (null to skip)
 * @param args.isAdmin - Whether the user is an admin for their organization (null to skip)
 * @param args.transcriptDestination - Organization ID for transcript uploads (null to skip)
 * @param args.defaultAgents - Default agent names for CLI operations (null to skip)
 * @param args.garbageCollectTranscripts - Whether to delete transcripts after upload (null to skip)
 * @param args.redownloadOnSwitch - Whether to prompt to re-download from registry on switch (null to skip)
 * @param args.apiToken - Raw API token (format `nori_<orgId>_<64hex>`) for non-interactive private-org auth (null to skip)
 */
export const saveConfig = async (args: {
  username: string | null;
  password?: string | null;
  refreshToken?: string | null;
  apiToken?: string | null;
  organizationUrl: string | null;
  organizations?: Array<string> | null;
  isAdmin?: boolean | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  activeSkillset?: string | null;
  defaultAgents?: Array<string> | null;
  transcriptDestination?: string | null;
  garbageCollectTranscripts?: "enabled" | "disabled" | null;
  redownloadOnSwitch?: "enabled" | "disabled" | null;
  installDir: string;
}): Promise<void> => {
  const {
    username,
    password,
    refreshToken,
    apiToken,
    organizationUrl,
    organizations,
    isAdmin,
    sendSessionTranscript,
    autoupdate,
    activeSkillset,
    defaultAgents,
    transcriptDestination,
    garbageCollectTranscripts,
    redownloadOnSwitch,
    installDir,
  } = args;
  const configPath = getConfigPath();

  const config: any = {};

  // Add auth credentials in nested format if provided.
  // Supports three modes: username+refreshToken (preferred), username+password (legacy),
  // and apiToken (non-interactive / CI access).
  const hasUsernameAuth = username != null && organizationUrl != null;
  const hasApiTokenAuth = apiToken != null && organizationUrl != null;
  if (hasUsernameAuth || hasApiTokenAuth) {
    // Normalize organization URL to remove trailing slashes
    const normalizedUrl = normalizeUrl({ baseUrl: organizationUrl! });

    config.auth = {
      username: username ?? null,
      organizationUrl: normalizedUrl,
      // If refreshToken is provided, use it and don't store password
      refreshToken: refreshToken ?? null,
      // Only save password if no refreshToken (legacy support)
      password: refreshToken != null ? null : (password ?? null),
      // API token for private-org programmatic access (orgId is embedded in the token itself)
      apiToken: apiToken ?? null,
      // Organizations the user has access to
      organizations: organizations ?? null,
      // Admin status
      isAdmin: isAdmin ?? null,
    };
  }

  // Add activeSkillset if provided
  if (activeSkillset != null) {
    config.activeSkillset = activeSkillset;
  }

  // Add sendSessionTranscript if provided
  if (sendSessionTranscript != null) {
    config.sendSessionTranscript = sendSessionTranscript;
  }

  // Add autoupdate if provided
  if (autoupdate != null) {
    config.autoupdate = autoupdate;
  }

  // Add transcriptDestination if provided
  if (transcriptDestination != null) {
    config.transcriptDestination = transcriptDestination;
  }

  // Add defaultAgents if provided
  if (defaultAgents != null) {
    config.defaultAgents = defaultAgents;
  }

  // Add garbageCollectTranscripts if provided
  if (garbageCollectTranscripts != null) {
    config.garbageCollectTranscripts = garbageCollectTranscripts;
  }

  // Add redownloadOnSwitch if provided
  if (redownloadOnSwitch != null) {
    config.redownloadOnSwitch = redownloadOnSwitch;
  }

  // Always save installDir
  config.installDir = installDir;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
};

/**
 * Update configuration on disk using read-merge-write.
 * Loads existing config, merges caller-provided fields on top, and writes the result.
 * Fields not included in the update are preserved from the existing config.
 * Fields explicitly set to null are cleared.
 *
 * @param updates - Partial config fields to merge on top of existing config
 */
export const updateConfig = async (updates: Partial<Config>): Promise<void> => {
  const existing = await loadConfig();

  // Determine auth: if 'auth' key is present in updates, use the provided value;
  // otherwise preserve existing auth.
  const auth = "auth" in updates ? updates.auth : existing?.auth;

  await saveConfig({
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    refreshToken: auth?.refreshToken ?? null,
    apiToken: auth?.apiToken ?? null,
    organizationUrl: auth?.organizationUrl ?? null,
    organizations: auth?.organizations ?? null,
    isAdmin: auth?.isAdmin ?? null,
    sendSessionTranscript:
      "sendSessionTranscript" in updates
        ? (updates.sendSessionTranscript ?? null)
        : (existing?.sendSessionTranscript ?? null),
    autoupdate:
      "autoupdate" in updates
        ? (updates.autoupdate ?? null)
        : (existing?.autoupdate ?? null),
    activeSkillset:
      "activeSkillset" in updates
        ? (updates.activeSkillset ?? null)
        : (existing?.activeSkillset ?? null),
    defaultAgents:
      "defaultAgents" in updates
        ? (updates.defaultAgents ?? null)
        : (existing?.defaultAgents ?? null),
    transcriptDestination:
      "transcriptDestination" in updates
        ? (updates.transcriptDestination ?? null)
        : (existing?.transcriptDestination ?? null),
    garbageCollectTranscripts:
      "garbageCollectTranscripts" in updates
        ? (updates.garbageCollectTranscripts ?? null)
        : (existing?.garbageCollectTranscripts ?? null),
    redownloadOnSwitch:
      "redownloadOnSwitch" in updates
        ? (updates.redownloadOnSwitch ?? null)
        : (existing?.redownloadOnSwitch ?? null),
    installDir:
      "installDir" in updates
        ? updates.installDir!
        : (existing?.installDir ?? getHomeDir()),
  });
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
        username: { type: ["string", "null"] },
        password: { type: ["string", "null"] },
        refreshToken: { type: ["string", "null"] },
        organizationUrl: { type: "string", format: "uri" },
        organizations: {
          type: ["array", "null"],
          items: { type: "string" },
        },
        isAdmin: { type: ["boolean", "null"] },
        apiToken: { type: ["string", "null"] },
      },
      required: ["organizationUrl"],
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
    installDir: { type: "string" },
    defaultAgents: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    // Current active skillset field
    activeSkillset: { type: "string" },
    transcriptDestination: { type: "string" },
    garbageCollectTranscripts: {
      type: "string",
      enum: ["enabled", "disabled"],
    },
    redownloadOnSwitch: {
      type: "string",
      enum: ["enabled", "disabled"],
      default: "enabled",
    },
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

  // If config uses the new nested auth format with apiToken + organizationUrl,
  // that's a valid API-token-only config — validate via schema only.
  const nestedAuth = config.auth;
  const hasNestedApiToken =
    nestedAuth != null &&
    typeof nestedAuth === "object" &&
    nestedAuth.apiToken != null &&
    nestedAuth.organizationUrl != null;

  if (hasNestedApiToken) {
    const configClone = JSON.parse(JSON.stringify(config));
    const valid = validateConfigSchema(configClone);
    if (!valid && validateConfigSchema.errors) {
      for (const error of validateConfigSchema.errors) {
        const path = error.instancePath || "(root)";
        const message = error.message || "unknown error";
        errors.push(`Config validation error at ${path}: ${message}`);
      }
      return {
        valid: false,
        message: "Config has validation errors",
        errors,
      };
    }
    return {
      valid: true,
      message: "Config is valid (API-token auth)",
      errors: null,
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

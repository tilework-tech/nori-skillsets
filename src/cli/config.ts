/**
 * Configuration management for Nori Profiles installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as path from "path";

import Ajv from "ajv";

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
  /** Per-agent configuration settings */
  agents?: Record<string, AgentConfig> | null;
  /** List of AI agents installed at this installDir */
  installedAgents?: Array<string> | null;
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
 * Load existing configuration from disk
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
    const config = JSON.parse(content);

    // Validate that the config has the expected structure
    if (config && typeof config === "object") {
      const result: Config = {
        auth: null,
        profile: null,
        // Use installDir from config file if present, otherwise use parameter
        installDir:
          typeof config.installDir === "string"
            ? config.installDir
            : installDir,
      };

      // Check if auth credentials exist and are valid
      // Support both token-based auth (refreshToken) and legacy password-based auth
      if (
        config.username &&
        config.organizationUrl &&
        typeof config.username === "string" &&
        typeof config.organizationUrl === "string"
      ) {
        const hasRefreshToken =
          config.refreshToken && typeof config.refreshToken === "string";
        const hasPassword =
          config.password && typeof config.password === "string";

        // Require either refreshToken or password
        if (hasRefreshToken || hasPassword) {
          result.auth = {
            username: config.username,
            organizationUrl: config.organizationUrl,
            refreshToken: hasRefreshToken ? config.refreshToken : null,
            password: hasPassword ? config.password : null,
          };
        }
      }

      // Check if profile exists
      if (config.profile && typeof config.profile === "object") {
        if (
          config.profile.baseProfile &&
          typeof config.profile.baseProfile === "string"
        ) {
          result.profile = {
            baseProfile: config.profile.baseProfile,
          };
        }
      }

      // Check if sendSessionTranscript exists, default to 'enabled'
      if (
        config.sendSessionTranscript === "enabled" ||
        config.sendSessionTranscript === "disabled"
      ) {
        result.sendSessionTranscript = config.sendSessionTranscript;
      } else {
        result.sendSessionTranscript = "enabled"; // Default value
      }

      // Check if autoupdate exists, default to 'enabled'
      if (config.autoupdate === "enabled" || config.autoupdate === "disabled") {
        result.autoupdate = config.autoupdate;
      } else {
        result.autoupdate = "enabled"; // Default value
      }

      // Check if registryAuths exists and is valid array
      if (Array.isArray(config.registryAuths)) {
        const validAuths = config.registryAuths.filter(
          (auth: any) =>
            auth &&
            typeof auth === "object" &&
            typeof auth.username === "string" &&
            typeof auth.password === "string" &&
            typeof auth.registryUrl === "string",
        );
        if (validAuths.length > 0) {
          result.registryAuths = validAuths;
        }
      }

      // Return result if we have at least auth, profile, or sendSessionTranscript
      if (
        result.auth != null ||
        result.profile != null ||
        result.sendSessionTranscript != null
      ) {
        return result;
      }
    }
  } catch {
    // File doesn't exist or is invalid
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
 * @param args.profile - Profile selection (null to skip profile)
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.autoupdate - Autoupdate setting (null to skip)
 * @param args.installDir - Installation directory
 * @param args.registryAuths - Array of registry authentication credentials (null to skip)
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
    installDir,
  } = args;
  const configPath = getConfigPath({ installDir });

  const config: any = {};

  // Add auth credentials if provided
  // Prefer refreshToken over password (token-based auth is more secure)
  if (username != null && organizationUrl != null) {
    // Normalize organization URL to remove trailing slashes
    const normalizedUrl = normalizeUrl({ baseUrl: organizationUrl });

    config.username = username;
    config.organizationUrl = normalizedUrl;

    // If refreshToken is provided, use it and don't store password
    if (refreshToken != null) {
      config.refreshToken = refreshToken;
      // Explicitly do NOT save password when refreshToken is present
    } else if (password != null) {
      // Legacy: only save password if no refreshToken provided
      config.password = password;
    }
  }

  // Add profile if provided
  if (profile != null) {
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

// JSON schema for nori-config.json
const configSchema = {
  type: "object",
  properties: {
    username: { type: "string" },
    password: { type: "string" },
    refreshToken: { type: "string" },
    organizationUrl: { type: "string" },
    sendSessionTranscript: {
      type: "string",
      enum: ["enabled", "disabled"],
    },
    autoupdate: {
      type: "string",
      enum: ["enabled", "disabled"],
    },
    profile: {
      type: "object",
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
  },
  additionalProperties: false,
};

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

  // Check if all required fields are present for paid mode
  const hasUsername = config.username && typeof config.username === "string";
  const hasPassword = config.password && typeof config.password === "string";
  const hasRefreshToken =
    config.refreshToken && typeof config.refreshToken === "string";
  const hasOrgUrl =
    config.organizationUrl && typeof config.organizationUrl === "string";

  // Need either password OR refreshToken (not both required)
  const hasAuth = hasPassword || hasRefreshToken;

  const coreCredentialsProvided = [hasUsername, hasOrgUrl];
  const someCoreProvided = coreCredentialsProvided.some((v) => v);
  const allCoreProvided = coreCredentialsProvided.every((v) => v);

  // If some credentials are provided but not all required ones, that's an error
  if (someCoreProvided && (!allCoreProvided || !hasAuth)) {
    if (!hasUsername) {
      errors.push(
        'Missing "username" field (required when credentials are provided)',
      );
    }
    if (!hasAuth) {
      errors.push(
        'Missing "refreshToken" or "password" field (one is required when credentials are provided)',
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
  if (!someCoreProvided && !hasAuth) {
    return {
      valid: true,
      message: "Config is valid for free mode (no credentials provided)",
      errors: null,
    };
  }

  // All credentials provided - validate with JSON schema
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(configSchema);
  const valid = validate(config);

  // If schema validation failed, collect errors
  if (!valid && validate.errors) {
    errors.push(
      `~/nori-config.json Validation Error: ${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  // Additional URL format validation
  try {
    new URL(config.organizationUrl);
  } catch {
    errors.push(
      `Invalid URL format for organizationUrl: ${config.organizationUrl}`,
    );
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

/**
 * Configuration management for Nori Profiles installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as path from "path";

import Ajv from "ajv";

import { normalizeUrl } from "@/utils/url.js";

/**
 * Unified configuration type for Nori Profiles
 * Contains all persisted fields from disk plus required installDir
 */
export type Config = {
  auth?: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  profile?: {
    baseProfile: string;
  } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
};

/**
 * @deprecated Use Config instead - types have been unified
 */
export type DiskConfig = Config;

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
      if (
        config.username &&
        config.password &&
        config.organizationUrl &&
        typeof config.username === "string" &&
        typeof config.password === "string" &&
        typeof config.organizationUrl === "string"
      ) {
        result.auth = {
          username: config.username,
          password: config.password,
          organizationUrl: config.organizationUrl,
        };
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
 * @deprecated Use loadConfig instead
 */
export const loadDiskConfig = loadConfig;

/**
 * Save configuration to disk
 * @param args - Configuration arguments
 * @param args.username - User's username (null to skip auth)
 * @param args.password - User's password (null to skip auth)
 * @param args.organizationUrl - Organization URL (null to skip auth)
 * @param args.profile - Profile selection (null to skip profile)
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.autoupdate - Autoupdate setting (null to skip)
 * @param args.installDir - Installation directory
 */
export const saveConfig = async (args: {
  username: string | null;
  password: string | null;
  organizationUrl: string | null;
  profile?: { baseProfile: string } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
}): Promise<void> => {
  const {
    username,
    password,
    organizationUrl,
    profile,
    sendSessionTranscript,
    autoupdate,
    installDir,
  } = args;
  const configPath = getConfigPath({ installDir });

  const config: any = {};

  // Add auth credentials if provided
  if (username != null && password != null && organizationUrl != null) {
    // Normalize organization URL to remove trailing slashes
    const normalizedUrl = normalizeUrl({ baseUrl: organizationUrl });

    config.username = username;
    config.password = password;
    config.organizationUrl = normalizedUrl;
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

  // Always save installDir
  config.installDir = installDir;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
};

/**
 * @deprecated Use saveConfig instead
 */
export const saveDiskConfig = saveConfig;

/**
 * Generate a config object from disk config with defaults applied
 *
 * @param args - Function arguments
 * @param args.diskConfig - Config loaded from disk (or null if not found)
 * @param args.installDir - Installation directory
 *
 * @returns Config object with defaults applied
 *
 * @deprecated No longer needed - use loadConfig directly and apply defaults manually if needed
 * This function is kept for backwards compatibility during migration.
 */
export const generateConfig = (args: {
  diskConfig: Config | null;
  installDir: string;
}): Config => {
  const { diskConfig, installDir } = args;

  // Use profile from diskConfig, or default if not present
  const profile = diskConfig?.profile || getDefaultProfile();

  return {
    auth: diskConfig?.auth || null,
    profile,
    sendSessionTranscript: diskConfig?.sendSessionTranscript ?? null,
    autoupdate: diskConfig?.autoupdate ?? null,
    installDir,
  };
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
    organizationUrl: { type: "string" },
    sendSessionTranscript: {
      type: "string",
      enum: ["enabled", "disabled"],
    },
    autoupdate: {
      type: "string",
      enum: ["enabled", "disabled"],
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
  const hasOrgUrl =
    config.organizationUrl && typeof config.organizationUrl === "string";

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

/**
 * @deprecated Use validateConfig instead
 */
export const validateDiskConfig = validateConfig;

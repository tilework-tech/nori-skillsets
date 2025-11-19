/**
 * Configuration management for Nori Profiles installer
 * Functional library for loading and managing disk-based configuration
 */

import * as fs from "fs/promises";
import * as path from "path";

import Ajv from "ajv";

import { normalizeUrl } from "@/utils/url.js";

/**
 * Configuration stored on disk containing authentication credentials and profile selection
 */
export type DiskConfig = {
  auth?: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  profile?: {
    baseProfile: string;
  } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  installDir?: string | null;
};

/**
 * Runtime configuration derived from disk config
 */
export type Config = {
  installType: "free" | "paid";
  nonInteractive?: boolean | null;
  auth?: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  profile?: {
    baseProfile: string;
  } | null;
  installDir?: string | null;
};

/**
 * Get the path to the config file
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 *
 * @returns The absolute path to .nori-config.json
 */
export const getConfigPath = (args?: {
  installDir?: string | null;
}): string => {
  const { installDir } = args || {};

  if (installDir != null && installDir !== "") {
    // Use custom install directory with dotfile name
    return path.join(installDir, ".nori-config.json");
  }

  // Legacy behavior: use HOME directory with non-dotfile name
  return path.join(process.env.HOME || "~", "nori-config.json");
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
 * Load existing configuration from disk
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 *
 * @returns The disk config if valid, null otherwise
 */
export const loadDiskConfig = async (args?: {
  installDir?: string | null;
}): Promise<DiskConfig | null> => {
  const { installDir } = args || {};
  const configPath = getConfigPath({ installDir });

  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);

    // Validate that the config has the expected structure
    if (config && typeof config === "object") {
      const result: DiskConfig = {
        auth: null,
        profile: null,
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

      // Check if installDir exists
      if (config.installDir && typeof config.installDir === "string") {
        result.installDir = config.installDir;
      }

      // Return result if we have at least auth, profile, sendSessionTranscript, or installDir
      if (
        result.auth != null ||
        result.profile != null ||
        result.sendSessionTranscript != null ||
        result.installDir != null
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
 * Save authentication credentials and profile to disk
 * @param args - Configuration arguments
 * @param args.username - User's username (null to skip auth)
 * @param args.password - User's password (null to skip auth)
 * @param args.organizationUrl - Organization URL (null to skip auth)
 * @param args.profile - Profile selection (null to skip profile)
 * @param args.sendSessionTranscript - Session transcript setting (null to skip)
 * @param args.installDir - Custom installation directory (null to use default)
 */
export const saveDiskConfig = async (args: {
  username: string | null;
  password: string | null;
  organizationUrl: string | null;
  profile?: { baseProfile: string } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  installDir?: string | null;
}): Promise<void> => {
  const {
    username,
    password,
    organizationUrl,
    profile,
    sendSessionTranscript,
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

  // Add installDir if provided
  if (installDir != null) {
    config.installDir = installDir;
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
};

/**
 * Generate runtime config from disk config
 * @param args - Configuration arguments
 * @param args.diskConfig - The disk config to convert
 *
 * @returns Runtime configuration
 */
export const generateConfig = (args: {
  diskConfig: DiskConfig | null;
}): Config => {
  const { diskConfig } = args;

  // If we have valid auth credentials, use paid installation
  const installType = diskConfig?.auth ? "paid" : "free";

  // Use profile from diskConfig, or default if not present
  const profile = diskConfig?.profile || getDefaultProfile();

  return {
    installType,
    auth: diskConfig?.auth || null,
    profile,
    installDir: diskConfig?.installDir || null,
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
  },
  additionalProperties: false,
};

/**
 * Validate disk configuration
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 *
 * @returns Validation result with details
 */
export const validateDiskConfig = async (args?: {
  installDir?: string | null;
}): Promise<ConfigValidationResult> => {
  const { installDir } = args || {};
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

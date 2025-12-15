/**
 * Registry authentication prompt for installation
 * Collects private registry credentials during install
 */

import { info, error, gray, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import {
  normalizeUrl,
  isValidOrgId,
  buildRegistryUrl,
  isValidUrl,
} from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";

/**
 * Parse org ID or URL input and return the registry URL
 * @param args - Configuration arguments
 * @param args.input - User input (org ID or full URL)
 *
 * @returns Object with registryUrl and isValid flag, or null if invalid
 */
const parseOrgIdOrUrl = (args: {
  input: string;
}): { registryUrl: string; isValid: boolean } => {
  const { input } = args;

  // First check if it's a valid URL (fallback for local dev)
  if (isValidUrl({ input })) {
    return { registryUrl: normalizeUrl({ baseUrl: input }), isValid: true };
  }

  // Otherwise check if it's a valid org ID
  if (isValidOrgId({ orgId: input })) {
    return { registryUrl: buildRegistryUrl({ orgId: input }), isValid: true };
  }

  return { registryUrl: "", isValid: false };
};

/**
 * Prompt user for private registry authentication credentials
 * @param args - Configuration arguments
 * @param args.existingRegistryAuths - Existing registry auths from config (if any)
 *
 * @returns Array of RegistryAuth objects, or null if user declines
 */
export const promptRegistryAuths = async (args: {
  existingRegistryAuths?: Array<RegistryAuth> | null;
}): Promise<Array<RegistryAuth> | null> => {
  const { existingRegistryAuths } = args;

  // If existing registryAuths exist, ask if user wants to keep them
  if (existingRegistryAuths != null && existingRegistryAuths.length > 0) {
    info({
      message: "I found existing private registry authentication:",
    });
    newline();
    for (const auth of existingRegistryAuths) {
      info({ message: `  Registry: ${auth.registryUrl}` });
      info({ message: `  Username: ${auth.username}` });
    }
    newline();

    const keepExisting = await promptUser({
      prompt: "Keep existing registry configuration? (y/n): ",
    });

    if (keepExisting.match(/^[Yy]$/)) {
      return existingRegistryAuths;
    }
  }

  // Ask if user wants to add registry auth
  info({
    message:
      "Nori can download profiles and skills from private registries. If your organization hosts a private Nori registry, you can configure authentication now.",
  });
  newline();

  const addRegistry = await promptUser({
    prompt: "Configure private registry authentication? (y/n): ",
  });

  if (!addRegistry.match(/^[Yy]$/)) {
    return null;
  }

  const registryAuths: Array<RegistryAuth> = [];

  // Loop to collect registry entries
  let addMore = true;
  while (addMore) {
    newline();

    // Collect organization ID or URL with validation
    let registryUrl: string;
    while (true) {
      const input = await promptUser({
        prompt:
          "Organization ID (e.g., 'mycompany') or full URL for local dev: ",
      });

      const result = parseOrgIdOrUrl({ input });
      if (result.isValid) {
        registryUrl = result.registryUrl;
        break;
      }

      error({
        message: `Invalid input: "${input}". Enter a lowercase org ID (letters, numbers, hyphens) or a full URL.`,
      });
    }

    // Collect username
    const username = await promptUser({
      prompt: "Username: ",
    });

    // Collect password (hidden)
    const password = await promptUser({
      prompt: "Password: ",
      hidden: true,
    });

    registryAuths.push({
      registryUrl,
      username: username.trim(),
      password: password.trim(),
    });

    info({ message: gray({ text: `Added registry: ${registryUrl}` }) });
    newline();

    // Ask if user wants to add another
    const another = await promptUser({
      prompt: "Add another registry? (y/n): ",
    });

    addMore = another.match(/^[Yy]$/) != null;
  }

  return registryAuths.length > 0 ? registryAuths : null;
};

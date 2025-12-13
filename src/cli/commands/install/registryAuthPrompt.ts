/**
 * Registry authentication prompt for installation
 * Collects private registry credentials during install
 */

import { info, error, gray, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeUrl } from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";

/**
 * Validate that a string is a valid URL
 * @param args - Configuration arguments
 * @param args.url - URL string to validate
 *
 * @returns True if valid URL, false otherwise
 */
const isValidUrl = (args: { url: string }): boolean => {
  const { url } = args;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
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

    // Collect registry URL with validation
    let registryUrl: string;
    while (true) {
      const urlInput = await promptUser({
        prompt: "Registry URL (e.g., https://registry.example.com): ",
      });

      if (isValidUrl({ url: urlInput })) {
        registryUrl = normalizeUrl({ baseUrl: urlInput });
        break;
      }

      error({
        message: `Invalid URL format: "${urlInput}". Please enter a valid URL.`,
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

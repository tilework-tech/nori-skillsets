/**
 * Register skillset flow module
 *
 * Provides the complete interactive registration experience for existing skillsets using @clack/prompts.
 * This flow handles:
 * - Collecting skillset metadata (description, license, keywords, version, repository)
 * - Parsing keywords from comma-separated string to array
 *
 * Note: Unlike newSkillsetFlow, this does NOT collect the name field since it's derived from the folder path.
 */

import { text } from "@clack/prompts";

import { unwrapPrompt } from "@/cli/prompts/flows/utils.js";

/**
 * Result of the register skillset flow
 */
export type RegisterSkillsetFlowResult = {
  description: string | null;
  license: string | null;
  keywords: Array<string> | null;
  version: string | null;
  repository: string | null;
  statusMessage: string;
};

/**
 * Parse keywords from comma-separated string to array
 *
 * @param args - Parse arguments
 * @param args.value - Comma-separated keyword string
 *
 * @returns Array of trimmed keywords, or null if empty
 */
const parseKeywords = (args: { value: string }): Array<string> | null => {
  const { value } = args;

  if (!value || value.trim() === "") {
    return null;
  }

  const keywords = value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  return keywords.length > 0 ? keywords : null;
};

const CANCEL_MESSAGE = "Skillset registration cancelled.";

/**
 * Execute the interactive register skillset flow
 *
 * @returns Result on success, null on cancel
 */
export const registerSkillsetFlow =
  async (): Promise<RegisterSkillsetFlowResult | null> => {
    const description = unwrapPrompt({
      value: await text({
        message: "Description (optional)",
        placeholder: "My awesome skillset",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (description == null) return null;

    const license = unwrapPrompt({
      value: await text({
        message: "License (optional)",
        placeholder: "MIT",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (license == null) return null;

    const keywordsStr = unwrapPrompt({
      value: await text({
        message: "Keywords (optional, comma-separated)",
        placeholder: "testing, automation, cli",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (keywordsStr == null) return null;

    const version = unwrapPrompt({
      value: await text({
        message: "Version (optional)",
        placeholder: "1.0.0",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (version == null) return null;

    const repository = unwrapPrompt({
      value: await text({
        message: "Repository URL (optional)",
        placeholder: "https://github.com/user/repo",
      }),
      cancelMessage: CANCEL_MESSAGE,
    });
    if (repository == null) return null;

    return {
      description: description.trim() || null,
      license: license.trim() || null,
      keywords: parseKeywords({ value: keywordsStr.trim() }),
      version: version.trim() || null,
      repository: repository.trim() || null,
      statusMessage: "Skillset metadata collected",
    };
  };

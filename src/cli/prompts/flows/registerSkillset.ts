/**
 * Register skillset flow module
 *
 * Provides the complete interactive registration experience for existing skillsets using @clack/prompts.
 * This flow handles:
 * - Collecting skillset metadata (description, license, keywords, version, repository)
 * - Parsing keywords from comma-separated string to array
 * - Intro/outro framing
 *
 * Note: Unlike newSkillsetFlow, this does NOT collect the name field since it's derived from the folder path.
 */

import { intro, outro, group, text, isCancel, cancel } from "@clack/prompts";

/**
 * Result of the register skillset flow
 */
export type RegisterSkillsetFlowResult = {
  description: string | null;
  license: string | null;
  keywords: Array<string> | null;
  version: string | null;
  repository: string | null;
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

/**
 * Execute the interactive register skillset flow
 *
 * @returns Result on success, null on cancel
 */
export const registerSkillsetFlow =
  async (): Promise<RegisterSkillsetFlowResult | null> => {
    intro("Register Skillset");

    const result = await group(
      {
        description: () =>
          text({
            message: "Description (optional)",
            placeholder: "My awesome skillset",
          }),
        license: () =>
          text({
            message: "License (optional)",
            placeholder: "MIT",
          }),
        keywords: () =>
          text({
            message: "Keywords (optional, comma-separated)",
            placeholder: "testing, automation, cli",
          }),
        version: () =>
          text({
            message: "Version (optional)",
            placeholder: "1.0.0",
          }),
        repository: () =>
          text({
            message: "Repository URL (optional)",
            placeholder: "https://github.com/user/repo",
          }),
      },
      {
        onCancel: () => {
          // cancel() is called automatically by group
        },
      },
    );

    if (isCancel(result)) {
      cancel("Skillset registration cancelled.");
      return null;
    }

    // Transform the result
    const description = (result.description as string)?.trim() || null;
    const license = (result.license as string)?.trim() || null;
    const keywordsStr = (result.keywords as string)?.trim() || "";
    const keywords = parseKeywords({ value: keywordsStr });
    const version = (result.version as string)?.trim() || null;
    const repository = (result.repository as string)?.trim() || null;

    outro("Skillset metadata collected");

    return {
      description,
      license,
      keywords,
      version,
      repository,
    };
  };

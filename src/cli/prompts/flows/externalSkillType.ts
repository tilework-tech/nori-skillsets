/**
 * External skill type prompt flow
 *
 * Prompts users to choose whether each discovered skill should be
 * inlined (bundled in the skillset tarball) or extracted (published
 * as an independent skill package).
 *
 * Follows the same two-tier pattern as the upload flow:
 * - Single skill: prompt inline/extract directly
 * - Multiple skills: "all same" vs "one-by-one", then the actual choice
 */

import { select } from "@clack/prompts";

import type { NoriJsonType } from "@/norijson/nori.js";

import { unwrapPrompt } from "./utils.js";

/**
 * Prompt the user to choose inline or extract for each discovered skill.
 *
 * @param args - The function arguments
 * @param args.candidates - Array of skill candidates with name field
 *
 * @returns Map of skill name to NoriJsonType, or null if cancelled
 */
export const promptSkillTypes = async (args: {
  candidates: Array<{ name: string }>;
}): Promise<Record<string, NoriJsonType> | null> => {
  const { candidates } = args;
  const cancelMsg = "Installation cancelled.";

  if (candidates.length === 0) {
    return {};
  }

  const result: Record<string, NoriJsonType> = {};

  if (candidates.length === 1) {
    const candidate = candidates[0];
    const action = unwrapPrompt({
      value: await select({
        message: `"${candidate.name}" — keep inline or extract as package?`,
        options: [
          {
            value: "inline" as const,
            label: "Keep inline",
            hint: "Skill stays bundled in the skillset tarball",
          },
          {
            value: "extract" as const,
            label: "Extract as package",
            hint: "Publish as an independent skill package",
          },
        ],
        initialValue: "inline" as const,
      }),
      cancelMessage: cancelMsg,
    });

    if (action == null) return null;

    result[candidate.name] = action === "inline" ? "inlined-skill" : "skill";
    return result;
  }

  // Multiple candidates: batch vs one-by-one
  const batchChoice = unwrapPrompt({
    value: await select({
      message: `Found ${candidates.length} skills. How would you like to set their type?`,
      options: [
        {
          value: "all-same" as const,
          label: "Resolve all the same way",
          hint: "Apply a single choice to all skills",
        },
        {
          value: "one-by-one" as const,
          label: "Choose one-by-one",
          hint: "Decide for each skill individually",
        },
      ],
    }),
    cancelMessage: cancelMsg,
  });

  if (batchChoice == null) return null;

  if (batchChoice === "all-same") {
    const action = unwrapPrompt({
      value: await select({
        message: "Keep all skills inline or extract all as packages?",
        options: [
          {
            value: "inline" as const,
            label: "Keep all inline",
            hint: "Skills stay bundled in the skillset tarball",
          },
          {
            value: "extract" as const,
            label: "Extract all as packages",
            hint: "Publish each as an independent skill package",
          },
        ],
        initialValue: "inline" as const,
      }),
      cancelMessage: cancelMsg,
    });

    if (action == null) return null;

    const type: NoriJsonType = action === "inline" ? "inlined-skill" : "skill";
    for (const candidate of candidates) {
      result[candidate.name] = type;
    }
    return result;
  }

  // One-by-one
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    const action = unwrapPrompt({
      value: await select({
        message: `[${i + 1}/${candidates.length}] "${candidate.name}" — keep inline or extract as package?`,
        options: [
          {
            value: "inline" as const,
            label: "Keep inline",
            hint: "Skill stays bundled in the skillset tarball",
          },
          {
            value: "extract" as const,
            label: "Extract as package",
            hint: "Publish as an independent skill package",
          },
        ],
        initialValue: "inline" as const,
      }),
      cancelMessage: cancelMsg,
    });

    if (action == null) return null;

    result[candidate.name] = action === "inline" ? "inlined-skill" : "skill";
  }

  return result;
};

/**
 * ContentCompiler - translates markdown content from canonical (Claude-dialect)
 * format into agent-specific formats by swapping tool names in prose sections.
 */

import { claudeCodeVocabulary } from "@/cli/features/compiler/vocabularies/claude-code.js";
import { codexVocabulary } from "@/cli/features/compiler/vocabularies/codex.js";

export type TranslationStrategy = "minimal" | "full";

const vocabularies: Record<string, Record<string, string>> = {
  "claude-code": claudeCodeVocabulary,
  codex: codexVocabulary,
};

/**
 * Apply vocabulary substitutions to a prose string using word boundary matching.
 *
 * @param args - Substitution arguments
 * @param args.text - The prose text to apply substitutions to
 * @param args.vocabulary - Map of tool names to their replacements
 *
 * @returns The text with all vocabulary terms replaced
 */
const applySubstitutions = (args: {
  text: string;
  vocabulary: Record<string, string>;
}): string => {
  const { text, vocabulary } = args;

  let result = text;
  for (const [from, to] of Object.entries(vocabulary)) {
    const pattern = new RegExp(`\\b${from}\\b`, "g");
    result = result.replace(pattern, to);
  }
  return result;
};

/**
 * Compile content by translating tool names from canonical (Claude) format
 * into the target agent's vocabulary.
 *
 * Code blocks (fenced and inline) are preserved without substitution.
 *
 * @param args - Compilation arguments
 * @param args.content - The markdown content to compile
 * @param args.agentName - The target agent (e.g., "claude-code", "codex")
 * @param args.strategy - The translation strategy to use
 *
 * @returns The compiled content with tool names translated for the target agent
 */
export const compileContent = (args: {
  content: string;
  agentName: string;
  strategy: TranslationStrategy;
}): string => {
  const { content, agentName } = args;

  if (content === "") {
    return "";
  }

  const vocabulary = vocabularies[agentName];
  if (vocabulary == null || Object.keys(vocabulary).length === 0) {
    return content;
  }

  // Split content into segments: fenced code blocks, inline code, and prose.
  // Fenced code blocks: ```...```  (may span multiple lines)
  // Inline code: `...`
  // We capture both types and leave them untouched; only prose gets substituted.
  const segmentPattern = /(```[\s\S]*?```|`[^`]+`)/g;

  const segments = content.split(segmentPattern);

  const result = segments.map((segment) => {
    // If the segment matches a code block or inline code, preserve it
    if (
      segment.startsWith("```") ||
      (segment.startsWith("`") && segment.endsWith("`"))
    ) {
      return segment;
    }
    // Otherwise it's prose -- apply substitutions
    return applySubstitutions({ text: segment, vocabulary });
  });

  return result.join("");
};

/**
 * Subagent discovery and frontmatter parsing
 *
 * Parses YAML frontmatter from SUBAGENT.md files to extract name and description.
 * Mirrors the skill discovery pattern in skillDiscovery.ts.
 */

/**
 * Parsed frontmatter from a SUBAGENT.md file
 */
type ParsedSubagentFrontmatter = {
  name: string;
  description: string;
};

/**
 * Parse YAML frontmatter from a SUBAGENT.md file to extract name and description.
 *
 * Uses regex parsing to avoid adding a gray-matter dependency.
 * Handles both quoted and unquoted values.
 *
 * @param args - The function arguments
 * @param args.content - The raw SUBAGENT.md content
 *
 * @returns Parsed name and description, or null if invalid
 */
export const parseSubagentFrontmatter = (args: {
  content: string;
}): ParsedSubagentFrontmatter | null => {
  const { content } = args;

  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch == null) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];

  const nameMatch = frontmatter.match(
    /^name:\s*(?:"([^"]*?)"|'([^']*?)'|(.+?))\s*$/m,
  );
  if (nameMatch == null) {
    return null;
  }
  const name = nameMatch[1] ?? nameMatch[2] ?? nameMatch[3];

  const descMatch = frontmatter.match(
    /^description:\s*(?:"([^"]*?)"|'([^']*?)'|(.+?))\s*$/m,
  );
  if (descMatch == null) {
    return null;
  }
  const description = descMatch[1] ?? descMatch[2] ?? descMatch[3];

  if (name == null || description == null) {
    return null;
  }

  return { name: name.trim(), description: description.trim() };
};

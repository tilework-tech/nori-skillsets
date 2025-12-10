#!/usr/bin/env node

/**
 * Hook handler for calculating and displaying session statistics
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It parses the transcript to calculate usage statistics and displays them.
 */

import { debug, error } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

type TranscriptMessage = {
  type: string;
  message?: {
    role?: string;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          name?: string;
          input?: Record<string, unknown>;
          [key: string]: unknown;
        }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Parse newline-delimited JSON transcript
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Array of parsed transcript messages
 */
const parseTranscript = (args: {
  content: string;
}): Array<TranscriptMessage> => {
  const { content } = args;
  const lines = content.trim().split("\n");
  const messages: Array<TranscriptMessage> = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as TranscriptMessage;
      messages.push(parsed);
    } catch (parseError) {
      // Skip invalid JSON lines
      debug({
        message: `Failed to parse transcript line: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`,
      });
    }
  }

  return messages;
};

/**
 * Extract skill usage from Read tool invocations targeting SKILL.md files
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Record mapping skill names to usage counts
 */
export const parseSkillUsage = (args: {
  content: string;
}): Record<string, number> => {
  const { content } = args;
  const messages = parseTranscript({ content });
  const skillCounts: Record<string, number> = {};

  // Regex to match skill paths like ~/.claude/skills/skill-name/SKILL.md
  // or /home/user/.claude/skills/skill-name/SKILL.md
  const skillPathRegex = /[/~]\.claude\/skills\/([^/]+)\/SKILL\.md$/;

  for (const msg of messages) {
    if (msg.type !== "assistant" || !msg.message?.content) continue;

    const contentArray = Array.isArray(msg.message.content)
      ? msg.message.content
      : [];

    for (const item of contentArray) {
      if (item.type === "tool_use" && item.name === "Read" && item.input) {
        const filePath = item.input.file_path as string | undefined;
        if (filePath) {
          const match = filePath.match(skillPathRegex);
          if (match) {
            const skillName = match[1];
            skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
          }
        }
      }
    }
  }

  return skillCounts;
};

/**
 * Extract subagent usage from Task tool invocations
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Record mapping subagent types to usage counts
 */
export const parseSubagentUsage = (args: {
  content: string;
}): Record<string, number> => {
  const { content } = args;
  const messages = parseTranscript({ content });
  const subagentCounts: Record<string, number> = {};

  for (const msg of messages) {
    if (msg.type !== "assistant" || !msg.message?.content) continue;

    const contentArray = Array.isArray(msg.message.content)
      ? msg.message.content
      : [];

    for (const item of contentArray) {
      if (item.type === "tool_use" && item.name === "Task" && item.input) {
        const subagentType = item.input.subagent_type as string | undefined;
        if (subagentType) {
          subagentCounts[subagentType] =
            (subagentCounts[subagentType] || 0) + 1;
        }
      }
    }
  }

  return subagentCounts;
};

/**
 * Detect if Nori CLAUDE.md was active in the session
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns True if Nori CLAUDE.md markers are detected
 */
export const detectNoriClaudeMd = (args: { content: string }): boolean => {
  const { content } = args;

  // Check for Nori CLAUDE.md markers in transcript content
  const indicators = [
    "NORI-AI MANAGED BLOCK",
    "BEGIN NORI-AI MANAGED BLOCK",
    "Following Nori workflow",
  ];

  for (const indicator of indicators) {
    if (content.includes(indicator)) {
      return true;
    }
  }

  return false;
};

/**
 * Count user and assistant messages
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Object with user and assistant message counts
 */
export const countMessages = (args: {
  content: string;
}): { user: number; assistant: number } => {
  const { content } = args;
  const messages = parseTranscript({ content });

  let user = 0;
  let assistant = 0;

  for (const msg of messages) {
    if (msg.type === "user") {
      user++;
    } else if (msg.type === "assistant") {
      assistant++;
    }
  }

  return { user, assistant };
};

/**
 * Count tool usage by tool name
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Record mapping tool names to usage counts
 */
export const countToolUsage = (args: {
  content: string;
}): Record<string, number> => {
  const { content } = args;
  const messages = parseTranscript({ content });
  const toolCounts: Record<string, number> = {};

  for (const msg of messages) {
    if (msg.type !== "assistant" || !msg.message?.content) continue;

    const contentArray = Array.isArray(msg.message.content)
      ? msg.message.content
      : [];

    for (const item of contentArray) {
      if (item.type === "tool_use" && item.name) {
        toolCounts[item.name] = (toolCounts[item.name] || 0) + 1;
      }
    }
  }

  return toolCounts;
};

/**
 * Format statistics as ASCII table
 * @param args - Configuration arguments
 * @param args.messages - Message counts object
 * @param args.messages.user - Count of user messages
 * @param args.messages.assistant - Count of assistant messages
 * @param args.tools - Record of tool name to usage count
 * @param args.skills - Record of skill name to usage count
 * @param args.subagents - Record of subagent type to usage count
 * @param args.noriClaudeMdUsed - Whether Nori CLAUDE.md was detected
 *
 * @returns Formatted ASCII table string
 */
export const formatStatistics = (args: {
  messages: { user: number; assistant: number };
  tools: Record<string, number>;
  skills: Record<string, number>;
  subagents: Record<string, number>;
  noriClaudeMdUsed: boolean;
}): string => {
  const { messages, tools, skills, subagents, noriClaudeMdUsed } = args;

  const TABLE_WIDTH = 55;
  const TOP_BORDER = `┌${"─".repeat(TABLE_WIDTH)}┐`;
  const MID_BORDER = `├${"─".repeat(TABLE_WIDTH)}┤`;
  const BOTTOM_BORDER = `└${"─".repeat(TABLE_WIDTH)}┘`;

  const padLine = (text: string): string => {
    const padding = TABLE_WIDTH - text.length;
    return `│ ${text}${" ".repeat(Math.max(0, padding - 1))}│`;
  };

  const centerLine = (text: string): string => {
    const totalPadding = TABLE_WIDTH - text.length;
    const leftPad = Math.floor(totalPadding / 2);
    const rightPad = totalPadding - leftPad;
    return `│${" ".repeat(leftPad)}${text}${" ".repeat(rightPad)}│`;
  };

  const lines: Array<string> = [];

  // Header
  lines.push(TOP_BORDER);
  lines.push(centerLine("Session Statistics"));
  lines.push(MID_BORDER);

  // Messages section
  lines.push(
    padLine(
      `Messages          User: ${messages.user}    Assistant: ${messages.assistant}`,
    ),
  );

  // Tool calls section (top 5 by usage)
  const sortedTools = Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sortedTools.length > 0) {
    const toolSummary = sortedTools
      .map(([name, count]) => `${name}: ${count}`)
      .join("  ");
    lines.push(padLine(`Tool Calls        ${toolSummary}`));
  } else {
    lines.push(padLine("Tool Calls        (none)"));
  }

  lines.push(MID_BORDER);

  // Skills section
  lines.push(padLine("Skills Used"));
  const skillEntries = Object.entries(skills).sort((a, b) => b[1] - a[1]);
  if (skillEntries.length > 0) {
    for (const [name, count] of skillEntries) {
      const countStr = `${count}x`;
      const padding = TABLE_WIDTH - 4 - name.length - countStr.length;
      lines.push(
        padLine(`  ${name}${" ".repeat(Math.max(1, padding))}${countStr}`),
      );
    }
  } else {
    lines.push(padLine("  (none)"));
  }

  lines.push(MID_BORDER);

  // Subagents section
  lines.push(padLine("Subagents Used"));
  const subagentEntries = Object.entries(subagents).sort((a, b) => b[1] - a[1]);
  if (subagentEntries.length > 0) {
    for (const [name, count] of subagentEntries) {
      const countStr = `${count}x`;
      const padding = TABLE_WIDTH - 4 - name.length - countStr.length;
      lines.push(
        padLine(`  ${name}${" ".repeat(Math.max(1, padding))}${countStr}`),
      );
    }
  } else {
    lines.push(padLine("  (none)"));
  }

  lines.push(MID_BORDER);

  // CLAUDE.md status
  const claudeMdStatus = noriClaudeMdUsed
    ? "Nori CLAUDE.md: active"
    : "Nori CLAUDE.md: not detected";
  lines.push(padLine(claudeMdStatus));

  lines.push(BOTTOM_BORDER);

  return lines.join("\n");
};

/**
 * Read transcript file
 * @param args - Configuration arguments
 * @param args.transcriptPath - Path to the transcript file
 *
 * @returns Transcript content as string
 */
const readTranscript = async (args: {
  transcriptPath: string;
}): Promise<string> => {
  const { transcriptPath } = args;
  const fs = await import("fs/promises");
  const content = await fs.readFile(transcriptPath, "utf-8");
  return content;
};

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  debug({ message: "=== Statistics hook execution started ===" });

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    debug({ message: "No Nori installation found, skipping statistics" });
    return;
  }

  // Read conversation data from stdin
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const conversationData = Buffer.concat(chunks).toString("utf-8");

  if (!conversationData.trim()) {
    debug({ message: "No conversation data provided, skipping statistics" });
    return;
  }

  // Parse transcript path from stdin JSON
  let transcriptContent: string | null = null;

  try {
    const data = JSON.parse(conversationData);
    if (data.transcript_path) {
      transcriptContent = await readTranscript({
        transcriptPath: data.transcript_path,
      });
    }
  } catch (err) {
    debug({
      message: `Failed to read transcript (non-fatal): ${err}`,
    });
    // Fall back to using raw conversation data
    transcriptContent = conversationData;
  }

  if (!transcriptContent) {
    debug({ message: "No transcript content available" });
    return;
  }

  // Calculate statistics
  const messages = countMessages({ content: transcriptContent });

  // Skip statistics for empty sessions (no user messages)
  if (messages.user === 0) {
    debug({ message: "No user messages found, skipping statistics" });
    return;
  }

  const tools = countToolUsage({ content: transcriptContent });
  const skills = parseSkillUsage({ content: transcriptContent });
  const subagents = parseSubagentUsage({ content: transcriptContent });
  const noriClaudeMdUsed = detectNoriClaudeMd({ content: transcriptContent });

  // Format and output statistics
  const formattedStats = formatStatistics({
    messages,
    tools,
    skills,
    subagents,
    noriClaudeMdUsed,
  });

  // Output as systemMessage so it displays to user
  console.log(JSON.stringify({ systemMessage: `\n${formattedStats}\n` }));

  debug({ message: "=== Statistics hook execution completed ===" });
};

// Run if executed directly
// Note: This hook runs synchronously (no { async: true }) so that the
// systemMessage output is seen by Claude Code before it processes the result.
// Unlike summarize.ts which makes API calls and needs async, statistics
// calculation is purely local and fast.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({ message: "Statistics hook: Unhandled error (non-fatal):" });
    error({ message: `Error: ${err?.message || err}` });
    // Exit with 0 to avoid crashing the session
    process.exit(0);
  });
}

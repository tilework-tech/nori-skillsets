type FrontmatterValue = string | Array<string>;

type ParsedMarkdownSubagent = {
  body: string;
  description: string | null;
  model: string | null;
  modelReasoningEffort: string | null;
  name: string | null;
  sandboxMode: string | null;
  tools: Array<string>;
};

type ParsedTomlSubagent = {
  description: string | null;
  developerInstructions: string | null;
  model: string | null;
  modelReasoningEffort: string | null;
  name: string | null;
  sandboxMode: string | null;
};

type ResolvedSubagent = {
  body: string | null;
  description: string;
  markdownModel: string | null;
  markdownTools: Array<string>;
  name: string;
  tomlDescription: string | null;
  tomlDeveloperInstructions: string | null;
  tomlModel: string | null;
  tomlModelReasoningEffort: string | null;
  tomlSandboxMode: string | null;
};

export type SubagentTargetFormat = "markdown" | "codex-toml" | "pi-markdown";

const FRONTMATTER_DELIMITER = "---";

const parseFrontmatter = (args: {
  content: string;
}): { body: string; frontmatter: Record<string, FrontmatterValue> } => {
  const { content } = args;
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return {
      body: content.trim(),
      frontmatter: {},
    };
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    return {
      body: content.trim(),
      frontmatter: {},
    };
  }

  const frontmatter: Record<string, FrontmatterValue> = {};
  const frontmatterLines = lines.slice(1, endIndex);

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (match == null) {
      continue;
    }

    const [, rawKey, rawValue] = match;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue?.trim() ?? "";

    if (value.length > 0) {
      frontmatter[key] = stripQuotes({ value });
      continue;
    }

    const items: Array<string> = [];
    let nextIndex = index + 1;
    while (nextIndex < frontmatterLines.length) {
      const nextLine = frontmatterLines[nextIndex] ?? "";
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed.startsWith("- ")) {
        break;
      }

      items.push(stripQuotes({ value: nextTrimmed.slice(2) }));
      nextIndex += 1;
    }

    if (items.length > 0) {
      frontmatter[key] = items;
      index = nextIndex - 1;
      continue;
    }

    frontmatter[key] = "";
  }

  return {
    body: lines
      .slice(endIndex + 1)
      .join("\n")
      .trim(),
    frontmatter,
  };
};

const stripQuotes = (args: { value: string }): string => {
  const { value } = args;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const toList = (args: { value?: FrontmatterValue | null }): Array<string> => {
  const { value } = args;
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter((item) => item.length > 0);
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const getFrontmatterString = (args: {
  frontmatter: Record<string, FrontmatterValue>;
  key: string;
}): string | null => {
  const { frontmatter, key } = args;
  const value = frontmatter[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseMarkdownSubagent = (args: {
  content: string;
}): ParsedMarkdownSubagent => {
  const { content } = args;
  const { body, frontmatter } = parseFrontmatter({ content });

  return {
    body,
    description: getFrontmatterString({
      frontmatter,
      key: "description",
    }),
    model: getFrontmatterString({ frontmatter, key: "model" }),
    modelReasoningEffort: getFrontmatterString({
      frontmatter,
      key: "model_reasoning_effort",
    }),
    name: getFrontmatterString({ frontmatter, key: "name" }),
    sandboxMode: getFrontmatterString({ frontmatter, key: "sandbox_mode" }),
    tools: toList({ value: frontmatter.tools }),
  };
};

const parseTomlSubagent = (args: { content: string }): ParsedTomlSubagent => {
  const { content } = args;

  return {
    description: parseTomlStringField({ content, key: "description" }),
    developerInstructions: parseTomlMultilineField({
      content,
      key: "developer_instructions",
    }),
    model: parseTomlStringField({ content, key: "model" }),
    modelReasoningEffort: parseTomlStringField({
      content,
      key: "model_reasoning_effort",
    }),
    name: parseTomlStringField({ content, key: "name" }),
    sandboxMode: parseTomlStringField({ content, key: "sandbox_mode" }),
  };
};

const parseTomlStringField = (args: {
  content: string;
  key: string;
}): string | null => {
  const { content, key } = args;
  const match = content.match(
    new RegExp(`^${escapeRegExp({ value: key })}\\s*=\\s*(".*")\\s*$`, "m"),
  );
  if (match == null) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === "string" && parsed.trim().length > 0
      ? parsed
      : null;
  } catch {
    return stripQuotes({ value: match[1] });
  }
};

const parseTomlMultilineField = (args: {
  content: string;
  key: string;
}): string | null => {
  const { content, key } = args;
  const multilineMatch = content.match(
    new RegExp(
      `^${escapeRegExp({ value: key })}\\s*=\\s*"""\\n?([\\s\\S]*?)"""`,
      "m",
    ),
  );
  if (multilineMatch != null) {
    const trimmed = multilineMatch[1].trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return parseTomlStringField({ content, key });
};

const escapeRegExp = (args: { value: string }): string => {
  const { value } = args;
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const resolveSubagent = (args: {
  fallbackName: string;
  markdownContent?: string | null;
  tomlContent?: string | null;
}): ResolvedSubagent | null => {
  const { fallbackName, markdownContent, tomlContent } = args;
  if (markdownContent == null && tomlContent == null) {
    return null;
  }

  const markdown = markdownContent
    ? parseMarkdownSubagent({ content: markdownContent })
    : null;
  const toml = tomlContent ? parseTomlSubagent({ content: tomlContent }) : null;

  return {
    body: markdown?.body?.trim() ? markdown.body.trim() : null,
    description: markdown?.description ?? toml?.description ?? fallbackName,
    markdownModel: markdown?.model ?? null,
    markdownTools: markdown?.tools ?? [],
    name: markdown?.name ?? toml?.name ?? fallbackName,
    tomlDescription: toml?.description ?? null,
    tomlDeveloperInstructions: toml?.developerInstructions ?? null,
    tomlModel: toml?.model ?? null,
    tomlModelReasoningEffort:
      toml?.modelReasoningEffort ?? markdown?.modelReasoningEffort ?? null,
    tomlSandboxMode: toml?.sandboxMode ?? markdown?.sandboxMode ?? null,
  };
};

const normalizeMarkdownToolsForPi = (args: {
  tools: Array<string>;
}): Array<string> => {
  const { tools } = args;
  const normalized = tools
    .map((tool) => normalizeMarkdownToolForPi({ tool }))
    .filter((tool): tool is string => tool != null);

  return Array.from(new Set(normalized));
};

const normalizeMarkdownToolForPi = (args: { tool: string }): string | null => {
  const { tool } = args;
  const normalized = tool.trim().toLowerCase();

  switch (normalized) {
    case "read":
    case "view":
      return "read";
    case "grep":
    case "rg":
      return "grep";
    case "glob":
    case "find":
      return "find";
    case "ls":
    case "list":
      return "ls";
    case "bash":
    case "shell":
      return "bash";
    case "edit":
      return "edit";
    case "write":
      return "write";
    default:
      return null;
  }
};

const deriveSandboxMode = (args: {
  markdownTools: Array<string>;
  tomlSandboxMode?: string | null;
}): string => {
  const { markdownTools, tomlSandboxMode } = args;
  if (tomlSandboxMode != null) {
    return tomlSandboxMode;
  }

  const normalizedTools = normalizeMarkdownToolsForPi({ tools: markdownTools });
  if (normalizedTools.includes("edit") || normalizedTools.includes("write")) {
    return "workspace-write";
  }

  return "read-only";
};

const sandboxModeToPiTools = (args: { sandboxMode: string }): Array<string> => {
  const { sandboxMode } = args;
  switch (sandboxMode) {
    case "workspace-write":
    case "danger-full-access":
      return ["read", "grep", "find", "ls", "bash", "edit", "write"];
    case "read-only":
    default:
      return ["read", "grep", "find", "ls"];
  }
};

const getPiTools = (args: {
  markdownTools: Array<string>;
  sandboxMode: string;
}): Array<string> => {
  const { markdownTools, sandboxMode } = args;
  const normalizedTools = normalizeMarkdownToolsForPi({ tools: markdownTools });
  if (normalizedTools.length > 0) {
    return normalizedTools;
  }

  return sandboxModeToPiTools({ sandboxMode });
};

const getCodexModel = (args: {
  markdownModel?: string | null;
  tomlModel?: string | null;
}): string | null => {
  const { markdownModel, tomlModel } = args;
  if (tomlModel != null) {
    return tomlModel;
  }

  if (markdownModel == null || markdownModel === "inherit") {
    return null;
  }

  return markdownModel;
};

const getPiModel = (args: { markdownModel?: string | null }): string | null => {
  const { markdownModel } = args;
  if (markdownModel == null || markdownModel === "inherit") {
    return null;
  }

  return markdownModel;
};

const getBody = (args: {
  body?: string | null;
  developerInstructions?: string | null;
}): string => {
  const { body, developerInstructions } = args;
  return body ?? developerInstructions ?? "";
};

const escapeTomlString = (args: { value: string }): string => {
  const { value } = args;
  return JSON.stringify(value);
};

export const emitSubagentContent = (args: {
  fallbackName: string;
  markdownContent?: string | null;
  targetFormat: Exclude<SubagentTargetFormat, "markdown">;
  tomlContent?: string | null;
}): { content: string; extension: ".md" | ".toml" } | null => {
  const { fallbackName, markdownContent, targetFormat, tomlContent } = args;
  const resolved = resolveSubagent({
    fallbackName,
    markdownContent,
    tomlContent,
  });
  if (resolved == null) {
    return null;
  }

  const sandboxMode = deriveSandboxMode({
    markdownTools: resolved.markdownTools,
    tomlSandboxMode: resolved.tomlSandboxMode,
  });
  const body = getBody({
    body: resolved.body,
    developerInstructions: resolved.tomlDeveloperInstructions,
  });

  if (targetFormat === "codex-toml") {
    const lines = [
      `name = ${escapeTomlString({ value: resolved.name })}`,
      `description = ${escapeTomlString({ value: resolved.description })}`,
      `sandbox_mode = ${escapeTomlString({ value: sandboxMode })}`,
    ];

    const model = getCodexModel({
      markdownModel: resolved.markdownModel,
      tomlModel: resolved.tomlModel,
    });
    if (model != null) {
      lines.push(`model = ${escapeTomlString({ value: model })}`);
    }

    const reasoningEffort = resolved.tomlModelReasoningEffort ?? "high";
    lines.push(
      `model_reasoning_effort = ${escapeTomlString({
        value: reasoningEffort,
      })}`,
    );
    lines.push(`developer_instructions = ${escapeTomlString({ value: body })}`);

    return {
      content: `${lines.join("\n")}\n`,
      extension: ".toml",
    };
  }

  const piLines = [
    FRONTMATTER_DELIMITER,
    `name: ${resolved.name}`,
    `description: ${resolved.description}`,
  ];

  const model = getPiModel({ markdownModel: resolved.markdownModel });
  if (model != null) {
    piLines.push(`model: ${model}`);
  }

  if (resolved.tomlModelReasoningEffort != null) {
    piLines.push(`thinking: ${resolved.tomlModelReasoningEffort}`);
  }

  const piTools = getPiTools({
    markdownTools: resolved.markdownTools,
    sandboxMode,
  });
  if (piTools.length > 0) {
    piLines.push(`tools: ${piTools.join(", ")}`);
  }

  piLines.push(FRONTMATTER_DELIMITER);

  return {
    content: `${piLines.join("\n")}\n\n${body.trim()}\n`,
    extension: ".md",
  };
};

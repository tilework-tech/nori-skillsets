import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentName } from "./agentRegistry.js";

import { AgentRegistry } from "./agentRegistry.js";
import {
  AGENT_DEFINITIONS,
  DEFAULT_AGENT_NAME,
  buildAgentConfig,
} from "./agentTable.js";

// Mock @clack/prompts to suppress output during tests
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
}));

const ALL_AGENT_NAMES: Array<AgentName> = [
  "claude-code",
  "cline",
  "codex",
  "cursor-agent",
  "droid",
  "gemini-cli",
  "github-copilot",
  "goose",
  "kilo",
  "kimi-cli",
  "opencode",
  "openclaw",
  "pi",
];

const SUPPORTED_AGENT_NAMES: Array<AgentName> = [
  "claude-code",
  "codex",
  "cursor-agent",
  "gemini-cli",
  "github-copilot",
  "goose",
  "pi",
];

const buildByName = (args: { name: AgentName }) => {
  const { name } = args;
  const definition = AGENT_DEFINITIONS.find((d) => d.name === name);
  if (definition == null) {
    throw new Error(`No agent definition for ${name}`);
  }
  return buildAgentConfig({ definition });
};

describe("AGENT_DEFINITIONS", () => {
  it("defines every agent exactly once", () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name).sort();
    expect(names).toEqual([...ALL_AGENT_NAMES].sort());
  });

  it("marks exactly the well-tested agents as supported", () => {
    const supported = AGENT_DEFINITIONS.filter(
      (d) => d.supportTier === "supported",
    )
      .map((d) => d.name)
      .sort();
    expect(supported).toEqual([...SUPPORTED_AGENT_NAMES].sort());
  });

  it("marks all remaining agents as experimental", () => {
    for (const definition of AGENT_DEFINITIONS) {
      expect(["supported", "experimental"]).toContain(definition.supportTier);
    }
  });

  it("uses claude-code as the default agent", () => {
    expect(DEFAULT_AGENT_NAME).toBe("claude-code");
  });
});

type ExpectedPaths = {
  agentDir: string;
  skillsDir: string;
  subagentsDir: string;
  slashcommandsDir: string;
  instructionsFilePath: string;
};

const PROJECT_PATH_EXPECTATIONS: Record<AgentName, ExpectedPaths> = {
  "claude-code": {
    agentDir: "/project/.claude",
    skillsDir: "/project/.claude/skills",
    subagentsDir: "/project/.claude/agents",
    slashcommandsDir: "/project/.claude/commands",
    instructionsFilePath: "/project/.claude/CLAUDE.md",
  },
  cline: {
    agentDir: "/project/.cline",
    skillsDir: "/project/.cline/skills",
    subagentsDir: "/project/.cline/agents",
    slashcommandsDir: "/project/.cline/commands",
    instructionsFilePath: "/project/.cline/rules/AGENTS.md",
  },
  codex: {
    agentDir: "/project/.codex",
    skillsDir: "/project/.codex/skills",
    subagentsDir: "/project/.codex/agents",
    slashcommandsDir: "/project/.codex/prompts",
    instructionsFilePath: "/project/AGENTS.md",
  },
  "cursor-agent": {
    agentDir: "/project/.cursor",
    skillsDir: "/project/.cursor/skills",
    subagentsDir: "/project/.cursor/agents",
    slashcommandsDir: "/project/.cursor/commands",
    instructionsFilePath: "/project/.cursor/rules/AGENTS.md",
  },
  droid: {
    agentDir: "/project/.factory",
    skillsDir: "/project/.factory/skills",
    subagentsDir: "/project/.factory/droids",
    slashcommandsDir: "/project/.factory/commands",
    instructionsFilePath: "/project/.factory/AGENTS.md",
  },
  "gemini-cli": {
    agentDir: "/project/.gemini",
    skillsDir: "/project/.gemini/skills",
    subagentsDir: "/project/.gemini/agents",
    slashcommandsDir: "/project/.gemini/commands",
    instructionsFilePath: "/project/.gemini/GEMINI.md",
  },
  "github-copilot": {
    agentDir: "/project/.github",
    skillsDir: "/project/.github/skills",
    subagentsDir: "/project/.github/agents",
    slashcommandsDir: "/project/.github/prompts",
    instructionsFilePath: "/project/.github/copilot-instructions.md",
  },
  goose: {
    agentDir: "/project/.goose",
    skillsDir: "/project/.goose/skills",
    subagentsDir: "/project/.goose/agents",
    slashcommandsDir: "/project/.goose/commands",
    instructionsFilePath: "/project/AGENTS.md",
  },
  kilo: {
    agentDir: "/project/.kilocode",
    skillsDir: "/project/.kilocode/skills",
    subagentsDir: "/project/.kilocode/agents",
    slashcommandsDir: "/project/.kilocode/commands",
    instructionsFilePath: "/project/.kilocode/rules/AGENTS.md",
  },
  "kimi-cli": {
    agentDir: "/project/.kimi",
    skillsDir: "/project/.kimi/skills",
    subagentsDir: "/project/.kimi/agents",
    slashcommandsDir: "/project/.kimi/commands",
    instructionsFilePath: "/project/.kimi/AGENTS.md",
  },
  opencode: {
    agentDir: "/project/.opencode",
    skillsDir: "/project/.opencode/skills",
    subagentsDir: "/project/.opencode/agents",
    slashcommandsDir: "/project/.opencode/commands",
    instructionsFilePath: "/project/AGENTS.md",
  },
  openclaw: {
    agentDir: "/project/.openclaw",
    skillsDir: "/project/.openclaw/skills",
    subagentsDir: "/project/.openclaw/agents",
    slashcommandsDir: "/project/.openclaw/commands",
    instructionsFilePath: "/project/.openclaw/AGENTS.md",
  },
  pi: {
    agentDir: "/project/.pi/agent",
    skillsDir: "/project/.pi/agent/skills",
    subagentsDir: "/project/.pi/agent/subagents",
    slashcommandsDir: "/project/.pi/agent/prompts",
    instructionsFilePath: "/project/.pi/agent/AGENTS.md",
  },
};

describe("buildAgentConfig project-install paths", () => {
  it.each(ALL_AGENT_NAMES)("%s resolves expected paths", (name) => {
    const agent = buildByName({ name });
    const expected = PROJECT_PATH_EXPECTATIONS[name];
    const installDir = "/project";

    expect(agent.getAgentDir({ installDir })).toBe(expected.agentDir);
    expect(agent.getSkillsDir({ installDir })).toBe(expected.skillsDir);
    expect(agent.getSubagentsDir({ installDir })).toBe(expected.subagentsDir);
    expect(agent.getSlashcommandsDir({ installDir })).toBe(
      expected.slashcommandsDir,
    );
    expect(agent.getInstructionsFilePath({ installDir })).toBe(
      expected.instructionsFilePath,
    );
  });
});

describe("buildAgentConfig global-install paths", () => {
  const ORIGINAL_ENV = process.env.NORI_GLOBAL_CONFIG;

  beforeEach(() => {
    process.env.NORI_GLOBAL_CONFIG = "/home/user";
  });

  afterEach(() => {
    if (ORIGINAL_ENV == null) {
      delete process.env.NORI_GLOBAL_CONFIG;
    } else {
      process.env.NORI_GLOBAL_CONFIG = ORIGINAL_ENV;
    }
  });

  it("codex places AGENTS.md inside .codex for global installs", () => {
    const agent = buildByName({ name: "codex" });
    expect(agent.getInstructionsFilePath({ installDir: "/home/user" })).toBe(
      "/home/user/.codex/AGENTS.md",
    );
  });

  it("codex treats trailing-slash home dir as a global install", () => {
    const agent = buildByName({ name: "codex" });
    expect(agent.getInstructionsFilePath({ installDir: "/home/user/" })).toBe(
      "/home/user/.codex/AGENTS.md",
    );
  });

  it("opencode places AGENTS.md inside .opencode for global installs", () => {
    const agent = buildByName({ name: "opencode" });
    expect(agent.getInstructionsFilePath({ installDir: "/home/user" })).toBe(
      "/home/user/.opencode/AGENTS.md",
    );
  });

  it("goose uses ~/.config/goose for global installs", () => {
    const agent = buildByName({ name: "goose" });
    const installDir = "/home/user";
    expect(agent.getAgentDir({ installDir })).toBe("/home/user/.config/goose");
    expect(agent.getSkillsDir({ installDir })).toBe(
      "/home/user/.config/goose/skills",
    );
    expect(agent.getInstructionsFilePath({ installDir })).toBe(
      "/home/user/.config/goose/AGENTS.md",
    );
  });

  it("claude-code paths are identical for global and project installs", () => {
    const agent = buildByName({ name: "claude-code" });
    expect(agent.getInstructionsFilePath({ installDir: "/home/user" })).toBe(
      "/home/user/.claude/CLAUDE.md",
    );
  });
});

describe("buildAgentConfig loaders", () => {
  const SHARED_LOADERS = [
    "config",
    "skills",
    "instructions",
    "slashcommands",
    "subagents",
  ];

  it.each(ALL_AGENT_NAMES)("%s includes the shared loader set", (name) => {
    const loaderNames = buildByName({ name })
      .getLoaders()
      .map((l) => l.name);
    for (const shared of SHARED_LOADERS) {
      expect(loaderNames).toContain(shared);
    }
  });

  it("only mcp-capable agents include the mcp loader", () => {
    const mcpAgents = ALL_AGENT_NAMES.filter((name) =>
      buildByName({ name })
        .getLoaders()
        .some((l) => l.name === "mcp"),
    ).sort();
    expect(mcpAgents).toEqual([
      "claude-code",
      "codex",
      "cursor-agent",
      "gemini-cli",
    ]);
  });

  it("claude-code includes hooks, statusline, and announcements loaders", () => {
    const loaderNames = buildByName({ name: "claude-code" })
      .getLoaders()
      .map((l) => l.name);
    expect(loaderNames).toContain("hooks");
    expect(loaderNames).toContain("statusline");
    expect(loaderNames).toContain("announcements");
  });

  it("no other agent includes claude-only loaders", () => {
    for (const name of ALL_AGENT_NAMES.filter((n) => n !== "claude-code")) {
      const loaderNames = buildByName({ name })
        .getLoaders()
        .map((l) => l.name);
      expect(loaderNames).not.toContain("hooks");
      expect(loaderNames).not.toContain("statusline");
      expect(loaderNames).not.toContain("announcements");
    }
  });
});

describe("buildAgentConfig capabilities and description", () => {
  it("derives claude-code capabilities", () => {
    const agent = buildByName({ name: "claude-code" });
    expect(agent.capabilities).toEqual({
      mcp: true,
      hooks: true,
      statusline: true,
      transcripts: true,
    });
    expect(agent.supportTier).toBe("supported");
  });

  it("derives codex capabilities", () => {
    const agent = buildByName({ name: "codex" });
    expect(agent.capabilities).toEqual({
      mcp: true,
      hooks: false,
      statusline: false,
      transcripts: false,
    });
  });

  it("derives plain-agent capabilities", () => {
    const agent = buildByName({ name: "kimi-cli" });
    expect(agent.capabilities).toEqual({
      mcp: false,
      hooks: false,
      statusline: false,
      transcripts: false,
    });
    expect(agent.supportTier).toBe("experimental");
  });

  it("derives description from capabilities", () => {
    expect(buildByName({ name: "kimi-cli" }).description).toBe(
      "Instructions, skills, subagents, commands",
    );
    expect(buildByName({ name: "codex" }).description).toBe(
      "Instructions, skills, subagents, commands, MCP",
    );
    expect(buildByName({ name: "claude-code" }).description).toBe(
      "Instructions, skills, subagents, commands, MCP, hooks, statusline, watch",
    );
  });

  it("only claude-code carries a legacy manifest path", () => {
    const claude = buildByName({ name: "claude-code" });
    expect(claude.getLegacyManifestPath).toBeDefined();
    expect(claude.getLegacyManifestPath!()).toMatch(
      /installed-manifest\.json$/,
    );
    for (const name of ALL_AGENT_NAMES.filter((n) => n !== "claude-code")) {
      expect(buildByName({ name }).getLegacyManifestPath).toBeUndefined();
    }
  });

  it("only claude-code declares optional integration hooks", () => {
    for (const name of ALL_AGENT_NAMES.filter((n) => n !== "claude-code")) {
      const agent = buildByName({ name });
      expect(agent.getExternalSettingsFiles).toBeUndefined();
      expect(agent.getTranscriptDirectory).toBeUndefined();
      expect(agent.getArtifactPatterns).toBeUndefined();
    }
    const claude = buildByName({ name: "claude-code" });
    expect(claude.getExternalSettingsFiles).toBeDefined();
    expect(claude.getTranscriptDirectory!()).toMatch(/\.claude\/projects$/);
    expect(claude.getArtifactPatterns!()).toEqual({
      dirs: [".claude"],
      files: ["CLAUDE.md"],
    });
  });
});

describe("AgentRegistry integration", () => {
  it("registers every table entry", () => {
    AgentRegistry.resetInstance();
    const registry = AgentRegistry.getInstance();
    expect(registry.list().sort()).toEqual([...ALL_AGENT_NAMES].sort());
    expect(registry.getDefaultAgentName()).toBe(DEFAULT_AGENT_NAME);
    expect(registry.get({ name: "claude-code" }).supportTier).toBe("supported");
  });
});

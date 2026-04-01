import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const AGENTS_MD = path.join(REPO_ROOT, "AGENTS.md");
const CLAUDE_MD = path.join(REPO_ROOT, "CLAUDE.md");

describe("AGENTS.md file structure", () => {
  test("AGENTS.md exists and is a regular file", () => {
    const stat = fs.lstatSync(AGENTS_MD);
    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  });

  test("CLAUDE.md is a symlink pointing to AGENTS.md", () => {
    const stat = fs.lstatSync(CLAUDE_MD);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = fs.readlinkSync(CLAUDE_MD);
    expect(target).toBe("AGENTS.md");
  });

  test("CLAUDE.md and AGENTS.md resolve to identical content", () => {
    const agentsContent = fs.readFileSync(AGENTS_MD, "utf-8");
    const claudeContent = fs.readFileSync(CLAUDE_MD, "utf-8");
    expect(claudeContent).toBe(agentsContent);
  });
});

describe("Close-the-loop section format", () => {
  const content = () => fs.readFileSync(AGENTS_MD, "utf-8");

  test('"## Critical: How to Close the Loop" is the last H2 section', () => {
    const text = content();
    const h2Headings = [...text.matchAll(/^## .+$/gm)].map((m) => m[0]);

    expect(h2Headings.length).toBeGreaterThan(0);
    expect(h2Headings[h2Headings.length - 1]).toBe(
      "## Critical: How to Close the Loop",
    );
  });

  test('each option has a "When to use:" field', () => {
    const text = content();
    const closeTheLoopSection = text.split(
      "## Critical: How to Close the Loop",
    )[1];
    expect(closeTheLoopSection).toBeDefined();

    const optionHeadings = [
      ...closeTheLoopSection.matchAll(/^### Option \d+:.+$/gm),
    ];
    expect(optionHeadings.length).toBeGreaterThan(0);

    for (const heading of optionHeadings) {
      const optionStart = closeTheLoopSection.indexOf(heading[0]);
      const nextOptionMatch = closeTheLoopSection
        .slice(optionStart + heading[0].length)
        .match(/^### Option \d+:/m);
      const optionEnd = nextOptionMatch
        ? optionStart +
          heading[0].length +
          closeTheLoopSection
            .slice(optionStart + heading[0].length)
            .indexOf(nextOptionMatch[0])
        : closeTheLoopSection.length;
      const optionText = closeTheLoopSection.slice(optionStart, optionEnd);

      expect(optionText).toMatch(/\*\*When to use:\*\*/);
    }
  });

  test('each option has a "Steps:" section with numbered steps', () => {
    const text = content();
    const closeTheLoopSection = text.split(
      "## Critical: How to Close the Loop",
    )[1];

    const optionHeadings = [
      ...closeTheLoopSection.matchAll(/^### Option \d+:.+$/gm),
    ];

    for (const heading of optionHeadings) {
      const optionStart = closeTheLoopSection.indexOf(heading[0]);
      const nextOptionMatch = closeTheLoopSection
        .slice(optionStart + heading[0].length)
        .match(/^### Option \d+:/m);
      const optionEnd = nextOptionMatch
        ? optionStart +
          heading[0].length +
          closeTheLoopSection
            .slice(optionStart + heading[0].length)
            .indexOf(nextOptionMatch[0])
        : closeTheLoopSection.length;
      const optionText = closeTheLoopSection.slice(optionStart, optionEnd);

      expect(optionText).toMatch(/\*\*Steps:\*\*/);
      expect(optionText).toMatch(/^\d+\./m);
    }
  });

  test('each option has a "You know it works when:" field', () => {
    const text = content();
    const closeTheLoopSection = text.split(
      "## Critical: How to Close the Loop",
    )[1];

    const optionHeadings = [
      ...closeTheLoopSection.matchAll(/^### Option \d+:.+$/gm),
    ];

    for (const heading of optionHeadings) {
      const optionStart = closeTheLoopSection.indexOf(heading[0]);
      const nextOptionMatch = closeTheLoopSection
        .slice(optionStart + heading[0].length)
        .match(/^### Option \d+:/m);
      const optionEnd = nextOptionMatch
        ? optionStart +
          heading[0].length +
          closeTheLoopSection
            .slice(optionStart + heading[0].length)
            .indexOf(nextOptionMatch[0])
        : closeTheLoopSection.length;
      const optionText = closeTheLoopSection.slice(optionStart, optionEnd);

      expect(optionText).toMatch(/\*\*You know it works when:\*\*/);
    }
  });
});

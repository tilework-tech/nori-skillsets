/**
 * Tests for subagent frontmatter parsing
 * Verifies that parseSubagentFrontmatter extracts name and description
 * from SUBAGENT.md YAML frontmatter, handling quoted and unquoted values.
 */

import { describe, it, expect } from "vitest";

import { parseSubagentFrontmatter } from "@/cli/commands/external/subagentDiscovery.js";

describe("parseSubagentFrontmatter", () => {
  it("should parse name and description from valid frontmatter", () => {
    const content = `---
name: My Subagent
description: A helpful subagent
---

# My Subagent

Instructions here.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toEqual({
      name: "My Subagent",
      description: "A helpful subagent",
    });
  });

  it("should return null for missing frontmatter", () => {
    const content = "# No frontmatter here\n\nJust content.\n";
    const result = parseSubagentFrontmatter({ content });
    expect(result).toBeNull();
  });

  it("should return null when name is missing", () => {
    const content = `---
description: Only description
---

Content.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toBeNull();
  });

  it("should return null when description is missing", () => {
    const content = `---
name: Only name
---

Content.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toBeNull();
  });

  it("should handle double-quoted values", () => {
    const content = `---
name: "Quoted Agent"
description: "A quoted description"
---

Content.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toEqual({
      name: "Quoted Agent",
      description: "A quoted description",
    });
  });

  it("should handle single-quoted values", () => {
    const content = `---
name: 'Single Quoted'
description: 'Single quoted desc'
---

Content.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toEqual({
      name: "Single Quoted",
      description: "Single quoted desc",
    });
  });

  it("should trim whitespace from values", () => {
    const content = `---
name:   Spaced Name
description:   Spaced Description
---

Content.
`;
    const result = parseSubagentFrontmatter({ content });
    expect(result).toEqual({
      name: "Spaced Name",
      description: "Spaced Description",
    });
  });
});

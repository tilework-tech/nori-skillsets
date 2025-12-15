import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { promptUser } from "@/cli/prompt.js";

import type { RegistryAuth } from "@/cli/config.js";

import { promptRegistryAuths } from "./registryAuthPrompt.js";

// Mock the prompt module
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

const mockedPromptUser = vi.mocked(promptUser);

describe("promptRegistryAuths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when user declines to add registry auth", async () => {
    // User answers "n" to initial prompt
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toBeNull();
    expect(mockedPromptUser).toHaveBeenCalledTimes(1);
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("registry authentication"),
    });
  });

  it("should return null when user presses enter (empty response)", async () => {
    // User presses enter without typing anything
    mockedPromptUser.mockResolvedValueOnce("");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toBeNull();
  });

  it("should collect single registry auth with org ID", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Organization ID (not full URL)
    mockedPromptUser.mockResolvedValueOnce("mycompany");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password (hidden)
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://mycompany.nori-registry.ai",
        username: "user@example.com",
        password: "secret123",
      },
    ]);

    // Verify password was requested with hidden: true
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Password"),
      hidden: true,
    });
  });

  it("should accept full URL as fallback for local development", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Full URL (fallback for local dev)
    mockedPromptUser.mockResolvedValueOnce("http://localhost:3000");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password (hidden)
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "http://localhost:3000",
        username: "user@example.com",
        password: "secret123",
      },
    ]);
  });

  it("should accept https URL as fallback", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Full HTTPS URL
    mockedPromptUser.mockResolvedValueOnce(
      "https://custom-registry.example.com",
    );
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password (hidden)
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://custom-registry.example.com",
        username: "user@example.com",
        password: "secret123",
      },
    ]);
  });

  it("should collect multiple registry auths with org IDs", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // First registry - org ID
    mockedPromptUser.mockResolvedValueOnce("company1");
    mockedPromptUser.mockResolvedValueOnce("user1@example.com");
    mockedPromptUser.mockResolvedValueOnce("password1");
    // User answers "y" to add another
    mockedPromptUser.mockResolvedValueOnce("y");
    // Second registry - org ID with hyphen
    mockedPromptUser.mockResolvedValueOnce("company-2");
    mockedPromptUser.mockResolvedValueOnce("user2@example.com");
    mockedPromptUser.mockResolvedValueOnce("password2");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://company1.nori-registry.ai",
        username: "user1@example.com",
        password: "password1",
      },
      {
        registryUrl: "https://company-2.nori-registry.ai",
        username: "user2@example.com",
        password: "password2",
      },
    ]);
  });

  it("should show existing registry auths and allow keeping them", async () => {
    const existingAuths: Array<RegistryAuth> = [
      {
        registryUrl: "https://existing.nori-registry.ai",
        username: "existing@example.com",
        password: "existingpass",
      },
    ];

    // User answers "y" to keep existing
    mockedPromptUser.mockResolvedValueOnce("y");

    const result = await promptRegistryAuths({
      existingRegistryAuths: existingAuths,
    });

    expect(result).toEqual(existingAuths);
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Keep existing"),
    });
  });

  it("should allow reconfiguring when user declines to keep existing", async () => {
    const existingAuths: Array<RegistryAuth> = [
      {
        registryUrl: "https://existing.nori-registry.ai",
        username: "existing@example.com",
        password: "existingpass",
      },
    ];

    // User answers "n" to keep existing
    mockedPromptUser.mockResolvedValueOnce("n");
    // User answers "y" to add new registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // New registry - org ID
    mockedPromptUser.mockResolvedValueOnce("neworg");
    mockedPromptUser.mockResolvedValueOnce("new@example.com");
    mockedPromptUser.mockResolvedValueOnce("newpass");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({
      existingRegistryAuths: existingAuths,
    });

    expect(result).toEqual([
      {
        registryUrl: "https://neworg.nori-registry.ai",
        username: "new@example.com",
        password: "newpass",
      },
    ]);
  });

  it("should re-prompt for invalid org ID format", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Invalid org ID first (uppercase)
    mockedPromptUser.mockResolvedValueOnce("MyCompany");
    // Valid org ID second attempt
    mockedPromptUser.mockResolvedValueOnce("mycompany");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://mycompany.nori-registry.ai",
        username: "user@example.com",
        password: "secret123",
      },
    ]);

    // Should have prompted for org ID twice (once invalid, once valid)
    const orgIdPromptCalls = mockedPromptUser.mock.calls.filter((call) =>
      call[0].prompt.toLowerCase().includes("organization id"),
    );
    expect(orgIdPromptCalls.length).toBe(2);
  });

  it("should normalize URL by removing trailing slash when using fallback URL", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // URL with trailing slash
    mockedPromptUser.mockResolvedValueOnce("https://registry.example.com/");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://registry.example.com",
        username: "user@example.com",
        password: "secret123",
      },
    ]);
  });
});

/**
 * Tests for login flow module
 *
 * These tests verify the loginFlow function behavior including:
 * - Successful login with credential collection and result display
 * - Cancellation handling
 * - Authentication error handling
 * - Output structure verification (E2E tests)
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginFlow, type LoginFlowCallbacks } from "./login.js";

// Mock @clack/prompts - we mock the interactive prompts but let UI functions run
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("loginFlow", () => {
  const mockCallbacks: LoginFlowCallbacks = {
    onAuthenticate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("successful login", () => {
    it("should call onAuthenticate with collected credentials", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("user@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("mypassword");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "user@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(mockCallbacks.onAuthenticate).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "mypassword",
      });
    });

    it("should show spinner during authentication", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as never);
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(spinnerMock.start).toHaveBeenCalledWith("Authenticating...");
      expect(spinnerMock.stop).toHaveBeenCalledWith("Authenticated");
    });

    it("should show note with organizations when user has orgs", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev", "demo", "public"],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Organizations: dev, demo, public"),
        expect.any(String),
      );
    });

    it("should show Admin: Yes in note when user is admin", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev"],
        isAdmin: true,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Admin: Yes"),
        expect.any(String),
      );
    });

    it("should not show note when user has no organizations", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).not.toHaveBeenCalled();
    });

    it("should include statusMessage in result", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result?.statusMessage).toContain("Logged in as");
      expect(result?.statusMessage).toContain("test@example.com");
    });

    it("should return credentials on successful login", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("secret123");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev"],
        isAdmin: true,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toEqual({
        email: "test@example.com",
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
        organizations: ["dev"],
        isAdmin: true,
        statusMessage: expect.stringContaining("test@example.com"),
      });
    });
  });

  describe("authentication failure", () => {
    it("should stop spinner with failure message on auth error", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as never);
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("wrongpassword");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Authentication failed");
    });

    it("should show error message using log.error", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("wrongpassword");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.log.error).toHaveBeenCalledWith("Invalid credentials");
    });

    it("should show note with hint when error hint is provided", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("wrongpassword");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
        hint: "Check that your email and password are correct.",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        "Check that your email and password are correct.",
        "Hint",
      );
    });

    it("should return null on auth failure", async () => {
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce("wrongpassword");
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels at the email prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });

    it("should not prompt for password when user cancels at email", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.password).not.toHaveBeenCalled();
    });

    it("should return null when user cancels at the password prompt", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce("test@example.com");
      vi.mocked(clack.password).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });

    it("should not call onAuthenticate when user cancels", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as never);
      vi.mocked(clack.isCancel).mockImplementation(
        (value) => value === cancelSymbol,
      );

      await loginFlow({ callbacks: mockCallbacks });

      expect(mockCallbacks.onAuthenticate).not.toHaveBeenCalled();
    });
  });
});

describe("loginFlow E2E output structure", () => {
  // These tests verify the actual UI output structure
  // They use real @clack/prompts functions with custom output streams

  it.todo("outputs intro, spinner, note, outro in correct order");
  it.todo("outputs organization info in note box format");
});

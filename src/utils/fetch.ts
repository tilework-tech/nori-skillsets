/**
 * Network utilities for proxy support and error handling
 *
 * This module provides:
 * - Proxy initialization using undici's EnvHttpProxyAgent
 * - Custom error classes for distinguishing network vs API errors
 * - Error formatting utilities for helpful user-facing messages
 */

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Custom error class for network-related failures
 * Distinguishes between network connectivity issues and API errors
 */
export class NetworkError extends Error {
  readonly code: string;
  readonly isNetworkError = true;

  constructor(message: string, code: string) {
    super(message);
    this.name = "NetworkError";
    this.code = code;
  }
}

/**
 * Custom error class for API-related failures (HTTP errors)
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly isApiError = true;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

/**
 * Get the proxy URL from environment variables (for error messages)
 *
 * @returns The proxy URL or null if no proxy is configured
 */
export const getProxyUrl = (): string | null => {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
};

/**
 * Initialize proxy support for all fetch requests
 *
 * This sets up a global dispatcher using undici's EnvHttpProxyAgent which
 * automatically handles:
 * - HTTPS_PROXY / https_proxy
 * - HTTP_PROXY / http_proxy
 * - NO_PROXY / no_proxy
 *
 * Should be called once at application startup.
 */
export const initializeProxySupport = (): void => {
  const agent = new EnvHttpProxyAgent();
  setGlobalDispatcher(agent);
};

/**
 * Format a network error with helpful context
 *
 * @param args - The function arguments
 * @param args.error - The original error
 * @param args.url - The URL that was being fetched
 *
 * @returns A NetworkError with helpful message
 */
export const formatNetworkError = (args: {
  error: Error;
  url: string;
}): NetworkError => {
  const { error, url } = args;
  const proxyUrl = getProxyUrl();

  const errorCode =
    (error as NodeJS.ErrnoException).code ||
    (error.cause as NodeJS.ErrnoException | undefined)?.code ||
    "UNKNOWN";

  let message: string;
  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  switch (errorCode) {
    case "ECONNREFUSED":
      if (proxyUrl != null) {
        message = `Connection refused by proxy server at ${proxyUrl}. Please check your HTTPS_PROXY settings.`;
      } else {
        message = `Connection refused when connecting to ${hostname}. The server may be down.`;
      }
      break;

    case "ECONNRESET":
      message = `Connection was reset. This may indicate a network issue or firewall blocking the request.`;
      break;

    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      if (proxyUrl != null) {
        message = `Connection timed out through proxy ${proxyUrl}. The proxy may be unreachable.`;
      } else {
        message = `Connection timed out when connecting to ${hostname}. Please check your network connection.`;
      }
      break;

    case "ENOTFOUND":
    case "EAI_AGAIN":
      if (proxyUrl != null) {
        message = `DNS lookup failed for proxy ${proxyUrl}. Please check your HTTPS_PROXY settings.`;
      } else {
        message = `DNS lookup failed for ${hostname}. Please check your network connection.`;
      }
      break;

    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      message = `SSL/TLS certificate error for ${hostname}. This may be a security issue.`;
      break;

    case "ERR_TLS_CERT_ALTNAME_INVALID":
      message = `SSL/TLS certificate hostname mismatch for ${hostname}.`;
      break;

    default:
      if (proxyUrl != null) {
        message = `Network error while connecting through proxy ${proxyUrl}: ${error.message}`;
      } else {
        message = `Network error while connecting to ${hostname}: ${error.message}`;
      }
  }

  return new NetworkError(message, errorCode);
};

/**
 * Check if an error is a network-related error
 *
 * @param error - The error to check
 *
 * @returns True if the error is a network error
 */
export const isNetworkError = (error: unknown): error is NetworkError => {
  return (
    error instanceof NetworkError ||
    (error as NetworkError)?.isNetworkError === true
  );
};

/**
 * Check if an error is an API error
 *
 * @param error - The error to check
 *
 * @returns True if the error is an API error
 */
export const isApiError = (error: unknown): error is ApiError => {
  return error instanceof ApiError || (error as ApiError)?.isApiError === true;
};

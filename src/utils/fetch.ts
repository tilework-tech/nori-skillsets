/**
 * Centralized fetch utility with HTTPS proxy support
 *
 * This module provides a wrapper around fetch that:
 * - Respects HTTPS_PROXY/https_proxy/HTTP_PROXY/http_proxy environment variables
 * - Uses undici's ProxyAgent for proper proxy support
 * - Provides clear error messages distinguishing network errors from API errors
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchInit = Record<string, any>;

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
 * Get the proxy URL from environment variables
 * Checks HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy in order
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
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 *
 * @param args - The function arguments
 * @param args.url - The URL to check
 *
 * @returns True if the URL should bypass the proxy
 */
const shouldBypassProxy = (args: { url: string }): boolean => {
  const { url } = args;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;

  if (noProxy == null || noProxy === "") {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const noProxyHosts = noProxy.split(",").map((h) => h.trim().toLowerCase());

    for (const pattern of noProxyHosts) {
      if (pattern === "*") {
        return true;
      }
      if (pattern.startsWith(".")) {
        // Wildcard domain (e.g., .example.com)
        if (hostname === pattern.slice(1) || hostname.endsWith(pattern)) {
          return true;
        }
      } else if (hostname === pattern || hostname.endsWith(`.${pattern}`)) {
        return true;
      }
    }
  } catch {
    // Invalid URL, don't bypass proxy
  }

  return false;
};

// Cached proxy agent for reuse across requests
let cachedProxyAgent: ProxyAgent | null = null;
let cachedProxyUrl: string | null = null;

/**
 * Get or create a ProxyAgent for the given proxy URL
 *
 * @param args - The function arguments
 * @param args.proxyUrl - The proxy URL
 *
 * @returns The ProxyAgent instance
 */
const getProxyAgent = (args: { proxyUrl: string }): ProxyAgent => {
  const { proxyUrl } = args;

  if (cachedProxyAgent != null && cachedProxyUrl === proxyUrl) {
    return cachedProxyAgent;
  }

  cachedProxyAgent = new ProxyAgent(proxyUrl);
  cachedProxyUrl = proxyUrl;
  return cachedProxyAgent;
};

/**
 * Format a network error with helpful context
 *
 * @param args - The function arguments
 * @param args.error - The original error
 * @param args.url - The URL that was being fetched
 * @param args.proxyUrl - The proxy URL if one was used
 *
 * @returns A NetworkError with helpful message
 */
const formatNetworkError = (args: {
  error: Error;
  url: string;
  proxyUrl: string | null;
}): NetworkError => {
  const { error, url, proxyUrl } = args;
  const errorCode =
    (error as NodeJS.ErrnoException).code ||
    (error.cause as NodeJS.ErrnoException | undefined)?.code ||
    "UNKNOWN";

  let message: string;

  switch (errorCode) {
    case "ECONNREFUSED":
      if (proxyUrl != null) {
        message = `Connection refused by proxy server at ${proxyUrl}. Please check your HTTPS_PROXY settings.`;
      } else {
        message = `Connection refused when connecting to ${new URL(url).hostname}. The server may be down.`;
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
        message = `Connection timed out when connecting to ${new URL(url).hostname}. Please check your network connection.`;
      }
      break;

    case "ENOTFOUND":
    case "EAI_AGAIN":
      if (proxyUrl != null) {
        message = `DNS lookup failed for proxy ${proxyUrl}. Please check your HTTPS_PROXY settings.`;
      } else {
        message = `DNS lookup failed for ${new URL(url).hostname}. Please check your network connection.`;
      }
      break;

    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      message = `SSL/TLS certificate error for ${new URL(url).hostname}. This may be a security issue.`;
      break;

    case "ERR_TLS_CERT_ALTNAME_INVALID":
      message = `SSL/TLS certificate hostname mismatch for ${new URL(url).hostname}.`;
      break;

    default:
      if (proxyUrl != null) {
        message = `Network error while connecting through proxy ${proxyUrl}: ${error.message}`;
      } else {
        message = `Network error while connecting to ${new URL(url).hostname}: ${error.message}`;
      }
  }

  return new NetworkError(message, errorCode);
};

/**
 * Fetch with automatic proxy support based on environment variables
 *
 * This function respects HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy
 * environment variables and uses undici's ProxyAgent for proper proxy support.
 *
 * @param url - The URL to fetch
 * @param init - Optional fetch options (same as standard fetch)
 *
 * @throws NetworkError for connectivity issues
 *
 * @returns The Response object from the fetch
 */
export const proxyFetch = async (
  url: string,
  init?: FetchInit,
): Promise<Response> => {
  const proxyUrl = getProxyUrl();

  // Determine if we should use a proxy
  const useProxy = proxyUrl != null && !shouldBypassProxy({ url });

  try {
    const fetchOptions: FetchInit = {
      ...init,
    };

    if (useProxy) {
      const dispatcher = getProxyAgent({ proxyUrl: proxyUrl! });
      fetchOptions.dispatcher = dispatcher;
    }

    // Use undici's fetch which properly supports the dispatcher option
    const response = await undiciFetch(url, fetchOptions);

    // Return the Response as-is (caller can check response.ok)
    return response as unknown as Response;
  } catch (err) {
    // Handle network errors with helpful messages
    if (err instanceof Error) {
      throw formatNetworkError({
        error: err,
        url,
        proxyUrl: useProxy ? proxyUrl : null,
      });
    }

    throw new NetworkError(`Unknown network error: ${String(err)}`, "UNKNOWN");
  }
};

/**
 * Google Analytics tracking for plugin installer
 * Proxies events through the backend to keep GA4 secrets secure
 */

import { analyticsApi } from "@/api/analytics.js";
import { loadConfig } from "@/installer/config.js";
import { getInstallDirs } from "@/utils/path.js";

/**
 * Track analytics event
 * @param args - Event arguments
 * @param args.eventName - Name of the event to track
 * @param args.eventParams - Optional parameters to include with the event
 */
export const trackEvent = async (args: {
  eventName: string;
  eventParams?: Record<string, any> | null;
}): Promise<void> => {
  const { eventName, eventParams } = args;

  try {
    // Load user email from config
    // Find installation directory using getInstallDirs
    const allInstallations = getInstallDirs({ currentDir: process.cwd() });

    if (allInstallations.length === 0) {
      // Silent failure - no installation found
      return;
    }

    const installDir = allInstallations[0]; // Use closest installation
    const diskConfig = await loadConfig({ installDir });
    const currentUserEmail = diskConfig?.auth?.username || null;

    // Send to backend analytics proxy (fire and forget)
    await analyticsApi.trackEvent({
      clientId: "plugin-installer",
      userId: currentUserEmail,
      eventName,
      eventParams: {
        ...eventParams,
        tilework_event_user_id: currentUserEmail,
        tilework_user_id: currentUserEmail,
      },
    });
  } catch (error) {
    // Silent failure - analytics should never block installation
  }
};

/**
 * Registry authentication module
 * Handles Firebase authentication for registry operations
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";

import type { RegistryAuth } from "@/installer/config.js";

// Firebase config (same as main app)
const firebaseConfig = {
  apiKey: "AIzaSyC54HqlGrkyANVFKGDQi3LobO5moDOuafk",
  authDomain: "tilework-e18c5.firebaseapp.com",
  projectId: "tilework-e18c5",
  storageBucket: "tilework-e18c5.firebasestorage.app",
  messagingSenderId: "199991289749",
  appId: "1:199991289749:web:d7ac38af24e1f29251f89c",
  measurementId: "G-3YXYKJK38T",
};

// Cache for auth tokens per registry URL
const tokenCache = new Map<string, { token: string; expiry: number }>();

// Cache for Firebase app instances per registry URL
const appCache = new Map<string, { app: FirebaseApp; auth: Auth }>();

/**
 * Get Firebase auth token for a registry
 * @param args - The authentication parameters
 * @param args.registryAuth - Registry authentication credentials
 *
 * @returns The Firebase ID token
 */
export const getRegistryAuthToken = async (args: {
  registryAuth: RegistryAuth;
}): Promise<string> => {
  const { registryAuth } = args;
  const cacheKey = registryAuth.registryUrl;

  // Check token cache
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  // Get or create Firebase app instance for this registry
  let firebase = appCache.get(cacheKey);
  if (firebase == null) {
    const app = initializeApp(firebaseConfig, `registry-${cacheKey}`);
    const auth = getAuth(app);
    firebase = { app, auth };
    appCache.set(cacheKey, firebase);
  }

  // Sign in with Firebase Auth
  const userCredential = await signInWithEmailAndPassword(
    firebase.auth,
    registryAuth.username,
    registryAuth.password,
  );

  // Get the ID token
  const token = await userCredential.user.getIdToken();

  // Cache with 55 minute expiry (Firebase tokens last 1 hour)
  tokenCache.set(cacheKey, {
    token,
    expiry: Date.now() + 55 * 60 * 1000,
  });

  return token;
};

/**
 * Clear the registry auth cache
 * Useful for testing
 */
export const clearRegistryAuthCache = (): void => {
  tokenCache.clear();
  appCache.clear();
};

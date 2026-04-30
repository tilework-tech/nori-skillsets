# Noridoc: providers

Path: @/src/providers

### Overview

External service provider singletons. Contains the Firebase initialization used for authentication throughout the application.

### How it fits into the larger codebase

The Firebase provider is consumed by `@/src/api/base.ts` for legacy password-based authentication (signing in with `signInWithEmailAndPassword`). The newer refresh-token auth path in `@/src/api/refreshToken.ts` bypasses the Firebase SDK entirely and calls the Firebase REST API directly, so this provider is only needed for the legacy auth flow.

### Core Implementation

**`firebase.ts`** implements `FirebaseProvider` as a singleton class. `configureFirebase()` initializes the Firebase app and auth instances on first call; `getFirebase()` returns the singleton. The provider throws if `app` or `auth` are accessed before `configure()` is called. The Firebase project is `tilework-e18c5`, and browser SDK auth uses `login.noriskillsets.dev` as the Firebase `authDomain` so Google SSO displays a Nori-controlled continuation domain.

### Things to Know

This provider is lazily initialized -- it is only configured when legacy password auth is actually used. The refresh-token auth path (preferred for CLI tools) never touches the Firebase SDK, using the REST API at `securetoken.googleapis.com` instead. If the Firebase SDK path is used, `login.noriskillsets.dev` must remain configured as a Firebase Hosting custom domain, Firebase Auth authorized domain, and Google OAuth redirect URI at `https://login.noriskillsets.dev/__/auth/handler`.

Created and maintained by Nori.

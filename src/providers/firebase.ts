import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC54HqlGrkyANVFKGDQi3LobO5moDOuafk",
  authDomain: "login.noriskillsets.dev",
  projectId: "tilework-e18c5",
  storageBucket: "tilework-e18c5.firebasestorage.app",
  messagingSenderId: "199991289749",
  appId: "1:199991289749:web:d7ac38af24e1f29251f89c",
  measurementId: "G-3YXYKJK38T",
};

export class FirebaseProvider {
  private static instance: FirebaseProvider;
  private _app: FirebaseApp | null = null;
  private _auth: Auth | null = null;

  public static getInstance(): FirebaseProvider {
    if (!FirebaseProvider.instance) {
      FirebaseProvider.instance = new FirebaseProvider();
    }
    return FirebaseProvider.instance;
  }

  public get app(): FirebaseApp {
    if (!this._app) {
      throw new Error("Firebase app not initialized. Call configure() first.");
    }
    return this._app;
  }

  public get auth(): Auth {
    if (!this._auth) {
      throw new Error("Firebase auth not initialized. Call configure() first.");
    }
    return this._auth;
  }

  public configure(): void {
    if (!this._app) {
      this._app = initializeApp(firebaseConfig);
      this._auth = getAuth(this._app);
    }
  }
}

export const configureFirebase = (): void => {
  FirebaseProvider.getInstance().configure();
};

export const getFirebase = (): FirebaseProvider => {
  return FirebaseProvider.getInstance();
};

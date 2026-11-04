import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate configuration
const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value || !String(value).trim())
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(
    `Firebase configuration is incomplete. Missing: ${missing.join(", ")}`
  );
}

// Initialize Firebase
const app = getApps().length > 0
  ? getApp()
  : initializeApp(firebaseConfig);

// Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBMQYHq8sqI9eiDEqiImNAjiRrCuLJoTMQ",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "solarithm-master.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "solarithm-master",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "solarithm-master.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "560851710395",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:560851710395:web:14f29e7ab994666870d49e"
};

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
} catch (initErr) {
  console.warn("Firebase primary initialization error, instantiating fallback instance:", initErr);
  try {
    app = initializeApp(firebaseConfig, "solarithm-fallback");
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (secondErr) {
    console.error("Critical: Firebase failed to initialize:", secondErr);
    app = getApp();
    db = getFirestore(app);
    auth = getAuth(app);
  }
}

export { app, db, auth };

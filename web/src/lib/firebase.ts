/**
 * Firebase access for sync. Loaded lazily (dynamic import from sync.ts) so the app starts
 * fast and fully offline without it.
 *
 * Identity: every device signs in anonymously and silently (no account, no login screen) and
 * writes only under devices/{its uid}. The owner signs in once with Google; the owner's
 * devices share one uid, and firestore.rules lets that uid read every device's data.
 * The config below is public by design (it ships in the web page); access is enforced by the
 * security rules, not by hiding these values.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore/lite';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAsJ5SZl6SaZR8VWBei6XTHkGkNV2U3WKY',
  authDomain: 'kinokopiyoko-d9e68.firebaseapp.com',
  projectId: 'kinokopiyoko-d9e68',
  storageBucket: 'kinokopiyoko-d9e68.firebasestorage.app',
  messagingSenderId: '995250322749',
  appId: '1:995250322749:web:da0ab9745fd75de4241954',
};

/**
 * The owner's Firebase uid (Google sign-in). Empty until the owner signs in for the first
 * time; then it is copied here and into firestore.rules (same value) and redeployed.
 */
export const OWNER_UID = 'Oqnz2I7pJwdZFcTcxbDVzVFCECl2';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init(): { auth: Auth; db: Firestore } {
  app ??= initializeApp(FIREBASE_CONFIG);
  auth ??= getAuth(app);
  db ??= getFirestore(app);
  return { auth, db };
}

export function firestore(): Firestore {
  return init().db;
}

/** Wait for the persisted session, then sign in anonymously if there is none. */
export async function ensureUser(): Promise<User> {
  const { auth: a } = init();
  const restored = await new Promise<User | null>((resolve) => {
    const stop = onAuthStateChanged(a, (u) => {
      stop();
      resolve(u);
    });
  });
  if (restored) return restored;
  return (await signInAnonymously(a)).user;
}

/** Owner only: Google sign-in (a popup; must be called from a tap). */
export async function signInAsOwner(): Promise<User> {
  const { auth: a } = init();
  return (await signInWithPopup(a, new GoogleAuthProvider())).user;
}

export function isOwner(user: User): boolean {
  return !user.isAnonymous && OWNER_UID !== '' && user.uid === OWNER_UID;
}

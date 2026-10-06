/**
 * Automatic sync (no button): run at start-up, when coming back online or to the foreground,
 * and a few seconds after any change. Each run pulls this device's own documents, merges them
 * with local data using the backup merge rules (newer copy wins, tombstones win over older
 * copies) and pushes whatever the cloud is missing or has older. The owner additionally reads
 * every other device's memos (shown as a separate layer, never merged into the owner's own).
 *
 * Firestore layout: devices/{uid} { label, lastSeen, owner }
 *                   devices/{uid}/memos/{id}, /groups/{id}, /tombstones/{id}
 */
import {
  memoStamp,
  mergeMemos,
  mergeSelection,
  toSharedGroups,
  type SharedGroup,
} from './backup';
import type { GroupTombstone, SelectionState } from './groups';
import type { Memo } from './types';

// ---------------------------------------------------------------- pure planning (tested)

export interface MemoPlan {
  push: Memo[]; // local copies the cloud lacks or has older
}

/** Which local memos must be uploaded after merging with the cloud copies. */
export function planMemos(local: Memo[], remote: Memo[]): MemoPlan {
  const remoteById = new Map(remote.map((m) => [m.id, m]));
  const merged = mergeMemos(local, remote);
  return {
    push: merged.filter((m) => {
      const r = remoteById.get(m.id);
      return !r || memoStamp(m) > memoStamp(r);
    }),
  };
}

export interface GroupPlan {
  pushGroups: SharedGroup[];
  pushTombstones: GroupTombstone[];
}

/** Which groups/tombstones must be uploaded after merging local state with the cloud. */
export function planGroups(
  local: SelectionState,
  remoteGroups: SharedGroup[],
  remoteTombstones: GroupTombstone[],
): GroupPlan {
  const merged = mergeSelection(local, remoteGroups, remoteTombstones);
  const rg = new Map(remoteGroups.map((g) => [g.id, g]));
  const rt = new Map(remoteTombstones.map((t) => [t.id, t]));
  return {
    pushGroups: toSharedGroups(merged).filter((g) => {
      const r = rg.get(g.id);
      return !r || (g.updatedAt ?? 0) > (r.updatedAt ?? 0);
    }),
    pushTombstones: (merged.tombstones ?? []).filter((t) => {
      const r = rt.get(t.id);
      return !r || t.updatedAt > r.updatedAt;
    }),
  };
}

/** Short human label for a device, shown to the owner next to its memos. */
export function deviceLabel(userAgent: string): string {
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iPhone'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : '端末';
  return os;
}

/** Firestore rejects `undefined`; strip it (and anything non-JSON) before writing. */
export function toDoc<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

// ---------------------------------------------------------------- engine (Firebase)

/** A memo registered on another device, visible to the owner only. */
export interface OtherMemo extends Memo {
  device: string; // device uid
  deviceLabel: string;
}

export interface SyncOutcome {
  // Cloud data to merge into local state (applied by the caller onto its *latest* state, so
  // edits made while syncing are not lost; they are pushed by the next run).
  remoteMemos: Memo[];
  remoteGroups: SharedGroup[];
  remoteTombstones: GroupTombstone[];
  pushed: number;
  uid: string;
  anonymous: boolean;
  owner: boolean;
  others: OtherMemo[] | null; // null when not the owner (or rules not yet set for the owner)
  ownerReadError?: string;
}

const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch

export async function syncOnce(memos: Memo[], sel: SelectionState): Promise<SyncOutcome> {
  const fb = await import('./firebase');
  const fs = await import('firebase/firestore/lite');
  const user = await fb.ensureUser();
  const db = fb.firestore();
  const base = `devices/${user.uid}`;

  const [memoSnap, groupSnap, tombSnap] = await Promise.all([
    fs.getDocs(fs.collection(db, base, 'memos')),
    fs.getDocs(fs.collection(db, base, 'groups')),
    fs.getDocs(fs.collection(db, base, 'tombstones')),
  ]);
  const remoteMemos = memoSnap.docs.map((d) => ({ ...(d.data() as Memo), id: d.id }));
  const remoteGroups = groupSnap.docs.map((d) => ({ ...(d.data() as SharedGroup), id: d.id }));
  const remoteTombstones = tombSnap.docs.map((d) => ({ ...(d.data() as GroupTombstone), id: d.id }));

  const { push } = planMemos(memos, remoteMemos);
  const { pushGroups, pushTombstones } = planGroups(sel, remoteGroups, remoteTombstones);
  const writes: [string, string, Record<string, unknown>][] = [
    ...push.map((m): [string, string, Record<string, unknown>] => ['memos', m.id, toDoc(m)]),
    ...pushGroups.map((g): [string, string, Record<string, unknown>] => ['groups', g.id, toDoc(g)]),
    ...pushTombstones.map((t): [string, string, Record<string, unknown>] => ['tombstones', t.id, toDoc(t)]),
  ];
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = fs.writeBatch(db);
    for (const [coll, id, data] of writes.slice(i, i + BATCH_LIMIT)) {
      batch.set(fs.doc(db, base, coll, id), data);
    }
    await batch.commit();
  }
  await fs.setDoc(fs.doc(db, base), {
    label: deviceLabel(navigator.userAgent),
    lastSeen: Date.now(),
    owner: !user.isAnonymous,
  });

  let others: OtherMemo[] | null = null;
  let ownerReadError: string | undefined;
  if (!user.isAnonymous) {
    // Owner: read every device. Fails with permission-denied until firestore.rules carries
    // this uid; the UI then shows the uid so it can be registered.
    try {
      const [all, devices] = await Promise.all([
        fs.getDocs(fs.collectionGroup(db, 'memos')),
        fs.getDocs(fs.collection(db, 'devices')),
      ]);
      const labels = new Map(devices.docs.map((d) => [d.id, String(d.data().label ?? '端末')]));
      others = all.docs
        .map((d) => {
          const device = d.ref.parent.parent?.id ?? '';
          return { ...(d.data() as Memo), id: d.id, device, deviceLabel: labels.get(device) ?? '端末' };
        })
        .filter((m) => m.device !== user.uid && !m.deleted);
    } catch (e) {
      ownerReadError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    remoteMemos,
    remoteGroups,
    remoteTombstones,
    pushed: writes.length,
    uid: user.uid,
    anonymous: user.isAnonymous,
    owner: fb.isOwner(user),
    others,
    ownerReadError,
  };
}

export async function ownerSignIn(): Promise<string> {
  const fb = await import('./firebase');
  return (await fb.signInAsOwner()).uid;
}

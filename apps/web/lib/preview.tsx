'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DIRECTORY_ENTRIES,
  LEARNING_RESOURCES,
  type DirectoryEntryRow,
  type LearningResourceRow,
} from './fixtures/p1';

/**
 * PREVIEW SCAFFOLDING. Two things the real portal gets from the server are
 * stubbed here so the screens can be walked through end to end:
 *
 *  1. The signed-in user's role. In production it comes from Supabase Auth and
 *     the `officer.role` row, and every route re-checks it with requireRole
 *     (B3). Here it is a switcher in the header. The switcher exists so a
 *     reviewer can see what each role sees; it grants nothing, because there
 *     is nothing behind it to grant.
 *
 *  2. The data. Fixture rows from lib/fixtures/p1.ts, held in React state so
 *     that "save" and "remove" are visible for the rest of the session. Nothing
 *     is written anywhere. When the P1 routes land (after B3 and B4, see
 *     docs/HANDOFF.md) this store is replaced by fetches and the screens do not
 *     change.
 */

export const ROLES = ['admin', 'supervisor', 'officer', 'read_only'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Programme admin',
  supervisor: 'Supervisor',
  officer: 'Field officer',
  read_only: 'Read only',
};

/** Who may create, edit and remove directory entries and resources. */
export function canEdit(role: Role): boolean {
  return role === 'admin';
}

/** Who sees inactive entries and unpublished resources at all. */
export function canSeeHidden(role: Role): boolean {
  return role === 'admin' || role === 'supervisor';
}

interface PreviewState {
  role: Role;
  setRole: (role: Role) => void;
  entries: DirectoryEntryRow[];
  resources: LearningResourceRow[];
  saveEntry: (row: DirectoryEntryRow) => void;
  removeEntry: (id: string, reason: string) => void;
  saveResource: (row: LearningResourceRow) => void;
  removeResource: (id: string, reason: string) => void;
  /** True once client state has been read, so SSR and first paint agree. */
  hydrated: boolean;
}

const PreviewContext = createContext<PreviewState | null>(null);

const ROLE_KEY = 'agri-preview-role';

function readStoredRole(): Role {
  try {
    const stored = window.localStorage.getItem(ROLE_KEY);
    return (ROLES as readonly string[]).includes(stored ?? '') ? (stored as Role) : 'admin';
  } catch {
    return 'admin';
  }
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('admin');
  const [hydrated, setHydrated] = useState(false);
  const [entries, setEntries] = useState<DirectoryEntryRow[]>(() => [...DIRECTORY_ENTRIES]);
  const [resources, setResources] = useState<LearningResourceRow[]>(() => [...LEARNING_RESOURCES]);

  useEffect(() => {
    setRoleState(readStoredRole());
    setHydrated(true);
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(ROLE_KEY, next);
    } catch {
      // Private window or storage blocked: the switch still works for this page.
    }
  }, []);

  const saveEntry = useCallback((row: DirectoryEntryRow) => {
    setEntries((list) => {
      const index = list.findIndex((e) => e.id === row.id);
      if (index === -1) return [row, ...list];
      return list.map((e) => (e.id === row.id ? row : e));
    });
  }, []);

  const removeEntry = useCallback((id: string, reason: string) => {
    const now = new Date().toISOString();
    setEntries((list) =>
      list.map((e) =>
        e.id === id ? { ...e, active: false, updated_at: now, removal_note: reason } : e,
      ),
    );
  }, []);

  const saveResource = useCallback((row: LearningResourceRow) => {
    setResources((list) => {
      const index = list.findIndex((r) => r.id === row.id);
      if (index === -1) return [row, ...list];
      return list.map((r) => (r.id === row.id ? row : r));
    });
  }, []);

  const removeResource = useCallback((id: string) => {
    // Soft delete: the row keeps existing with deleted_at set (CLAUDE.md,
    // "Soft delete only"). The list hides it; nothing is destroyed.
    const now = new Date().toISOString();
    setResources((list) => list.map((r) => (r.id === id ? { ...r, deleted_at: now } : r)));
  }, []);

  const value = useMemo<PreviewState>(
    () => ({
      role,
      setRole,
      entries,
      resources,
      saveEntry,
      removeEntry,
      saveResource,
      removeResource,
      hydrated,
    }),
    [
      role,
      setRole,
      entries,
      resources,
      saveEntry,
      removeEntry,
      saveResource,
      removeResource,
      hydrated,
    ],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewState {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error('usePreview must be used inside PreviewProvider');
  return ctx;
}

/** Client-generated UUID, the same pattern the offline officer app uses. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

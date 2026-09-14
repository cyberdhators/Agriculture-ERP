'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  LIVE_DIRECTORIES,
  listDirectoryEntries,
  removeDirectoryEntry,
  saveDirectoryEntry,
} from './directories/api';
import {
  DIRECTORY_ENTRIES,
  LEARNING_RESOURCES,
  type DirectoryEntryRow,
  type LearningResourceRow,
} from './fixtures/p1';
import {
  LIVE_LIBRARY,
  listLearningResources,
  removeLearningResource,
  saveLearningResource,
} from './library/api';
import { supabaseBrowser } from './supabase/browser';

/**
 * The signed-in principal, plus the fixture store the directories and library
 * screens still run on.
 *
 *  1. The role is real. It is read once from GET /api/me, which requireRole
 *     has already resolved from the session cookie the login page set. Until
 *     that answer arrives — or if it fails — the role is `read_only`, the
 *     narrowest one, so a screen never renders more than the server would
 *     serve. The role only decides what a screen shows; every route enforces
 *     its own.
 *
 *  2. The data. With NEXT_PUBLIC_USE_LIVE_DIRECTORIES / _LIBRARY on, the rows
 *     are read from the P1 routes (#28) once /api/me has answered, and "save"
 *     and "remove" are the routes' POST, PATCH and DELETE — the list then holds
 *     what the server returned. Off, fixture rows from lib/fixtures/p1.ts held
 *     in React state, so the screens can be walked with nothing written.
 *     The screens do not know which; they read the same hook either way.
 *
 * The hook keeps its old name so seventeen screens do not change for a rename.
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

/** What GET /api/me returns about the caller. */
export interface Me {
  id: string;
  kind: 'user' | 'officer';
  name: string;
  role: Role;
}

interface PreviewState {
  role: Role;
  /** Null until /api/me has answered, and stays null if it could not. */
  me: Me | null;
  authError?: string;
  signOut: () => Promise<void>;
  entries: DirectoryEntryRow[];
  resources: LearningResourceRow[];
  saveEntry: (row: DirectoryEntryRow) => Promise<void>;
  removeEntry: (id: string, reason: string) => Promise<void>;
  saveResource: (row: LearningResourceRow) => Promise<void>;
  removeResource: (id: string, reason: string) => Promise<void>;
  /** The live reads: loading until both lists have answered; error if one could not. */
  catalog: { loading: boolean; error?: string };
  /** True once client state has been read, so SSR and first paint agree. */
  hydrated: boolean;
}

const PreviewContext = createContext<PreviewState | null>(null);

function asRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(String(value)) ? (value as Role) : 'read_only';
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('read_only');
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | undefined>();
  const [hydrated, setHydrated] = useState(false);
  const [entries, setEntries] = useState<DirectoryEntryRow[]>(() =>
    LIVE_DIRECTORIES ? [] : [...DIRECTORY_ENTRIES],
  );
  const [resources, setResources] = useState<LearningResourceRow[]>(() =>
    LIVE_LIBRARY ? [] : [...LEARNING_RESOURCES],
  );
  const [catalog, setCatalog] = useState<{ loading: boolean; error?: string }>({
    loading: LIVE_DIRECTORIES || LIVE_LIBRARY,
  });
  // The current lists, readable inside the async mutators without a stale closure.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;

  useEffect(() => {
    let on = true;
    fetch('/api/me')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: Me;
          error?: { message?: string };
        };
        if (!on) return;
        if (res.ok && body.data) {
          const principal = { ...body.data, role: asRole(body.data.role) };
          setMe(principal);
          setRoleState(principal.role);
          setAuthError(undefined);
        } else {
          setAuthError(body.error?.message ?? `Could not load your account (${res.status}).`);
        }
      })
      .catch(() => {
        if (on) setAuthError('Could not reach the server.');
      })
      .finally(() => {
        if (on) setHydrated(true);
      });
    return () => {
      on = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    window.location.assign('/login');
  }, []);

  // The live reads. Only once /api/me has answered with a principal: this
  // provider also wraps the public marketplace, where nobody is signed in and
  // these routes would answer 401 for nothing. A failed /api/me ends the
  // loading state too, so a screen never waits on a read that will not come.
  useEffect(() => {
    if (!(LIVE_DIRECTORIES || LIVE_LIBRARY)) return;
    if (!me) {
      if (hydrated) setCatalog((c) => (c.loading ? { loading: false } : c));
      return;
    }
    let on = true;
    setCatalog({ loading: true });
    Promise.all([
      LIVE_DIRECTORIES ? listDirectoryEntries() : Promise.resolve(null),
      LIVE_LIBRARY ? listLearningResources() : Promise.resolve(null),
    ])
      .then(([e, r]) => {
        if (!on) return;
        if (e) setEntries(e);
        if (r) setResources(r);
        setCatalog({ loading: false });
      })
      .catch((err: unknown) => {
        if (on)
          setCatalog({
            loading: false,
            error: err instanceof Error ? err.message : 'Could not load the directories.',
          });
      });
    return () => {
      on = false;
    };
  }, [me, hydrated]);

  const saveEntry = useCallback(async (row: DirectoryEntryRow) => {
    // Live: the server's row replaces the form's — its id on a create, its
    // normalised fields on either. Off: the form's row is the record.
    const saved = LIVE_DIRECTORIES
      ? await saveDirectoryEntry(
          row,
          entriesRef.current.some((e) => e.id === row.id),
        )
      : row;
    setEntries((list) => {
      const index = list.findIndex((e) => e.id === saved.id);
      if (index === -1) return [saved, ...list];
      return list.map((e) => (e.id === saved.id ? saved : e));
    });
  }, []);

  const removeEntry = useCallback(async (id: string, reason: string) => {
    // Live: the route soft-deletes in one audited transaction, so the row
    // leaves the list here as it has left the _active view there. The reason
    // stays on this screen's record; the route does not take one yet.
    if (LIVE_DIRECTORIES) await removeDirectoryEntry(id);
    const now = new Date().toISOString();
    setEntries((list) =>
      list.map((e) =>
        e.id === id
          ? {
              ...e,
              active: false,
              updated_at: now,
              removal_note: reason,
              ...(LIVE_DIRECTORIES ? { deleted_at: now } : {}),
            }
          : e,
      ),
    );
  }, []);

  const saveResource = useCallback(async (row: LearningResourceRow) => {
    const saved = LIVE_LIBRARY
      ? await saveLearningResource(
          row,
          resourcesRef.current.some((r) => r.id === row.id),
        )
      : row;
    setResources((list) => {
      const index = list.findIndex((r) => r.id === saved.id);
      if (index === -1) return [saved, ...list];
      return list.map((r) => (r.id === saved.id ? saved : r));
    });
  }, []);

  const removeResource = useCallback(async (id: string) => {
    // Soft delete: the row keeps existing with deleted_at set (CLAUDE.md,
    // "Soft delete only"). The list hides it; nothing is destroyed.
    if (LIVE_LIBRARY) await removeLearningResource(id);
    const now = new Date().toISOString();
    setResources((list) => list.map((r) => (r.id === id ? { ...r, deleted_at: now } : r)));
  }, []);

  const value = useMemo<PreviewState>(
    () => ({
      role,
      me,
      authError,
      signOut,
      entries,
      resources,
      saveEntry,
      removeEntry,
      saveResource,
      removeResource,
      catalog,
      hydrated,
    }),
    [
      role,
      me,
      authError,
      signOut,
      entries,
      resources,
      saveEntry,
      removeEntry,
      saveResource,
      removeResource,
      catalog,
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

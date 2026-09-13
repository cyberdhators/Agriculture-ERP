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
 *  2. The data. Fixture rows from lib/fixtures/p1.ts, held in React state so
 *     that "save" and "remove" are visible for the rest of the session. Nothing
 *     is written anywhere. When the P1 routes land (#28) this store is replaced
 *     by fetches and the screens do not change.
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
  saveEntry: (row: DirectoryEntryRow) => void;
  removeEntry: (id: string, reason: string) => void;
  saveResource: (row: LearningResourceRow) => void;
  removeResource: (id: string, reason: string) => void;
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
  const [entries, setEntries] = useState<DirectoryEntryRow[]>(() => [...DIRECTORY_ENTRIES]);
  const [resources, setResources] = useState<LearningResourceRow[]>(() => [...LEARNING_RESOURCES]);

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
      me,
      authError,
      signOut,
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
      me,
      authError,
      signOut,
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

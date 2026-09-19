'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button, Dialog } from './index';
import { IconX } from './icons';
import styles from './feedback.module.css';

/**
 * OVERLAYS AND TRANSIENT MESSAGES.
 *
 * `Modal` is the kit's existing `Dialog` — a native <dialog>, so focus
 * trapping, Escape and the backdrop come from the browser rather than from
 * code we would have to keep correct. `ConfirmationDialog` is that with the
 * destructive-action shape the design rules already require: the consequence
 * stated in words, the confirming button outlined rather than filled, and
 * room for the reason the audit row will carry.
 *
 * No dependency is added here. A toast is a live region and a drawer is a
 * positioned panel; both are a stylesheet and thirty lines.
 */

/* ---- Drawer ----------------------------------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);

    // Remember what opened this, move focus into the panel, and put focus back
    // when it closes. A keyboard reader who opens a panel and closes it should
    // be returned to the control they pressed, not to the top of the document.
    openerRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className={styles.drawerScrim}
        aria-label="Close the panel"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`${styles.drawer} ${styles.drawerOpen}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.drawerHead}>
          <h2 id={titleId} className={styles.drawerTitle}>
            {title}
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
        {footer ? <div className={styles.drawerFoot}>{footer}</div> : null}
      </div>
    </>
  );
}

/* ---- ConfirmationDialog ----------------------------------------------- */

/**
 * A confirmation that says what will happen, not "Are you sure?".
 *
 * `consequence` is the sentence a non-programmer could read aloud — "This
 * account will lose access immediately" — because that is what the person
 * clicking needs to know. Destructive confirmations are outlined, never
 * filled: the design rule, and the reason a red button is not the default.
 */
export function ConfirmationDialog({
  open,
  onCancel,
  onConfirm,
  title,
  consequence,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
  children,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  consequence: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Room for a reason field, which the audit row will carry. */
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {/*
           * Not autofocused. Cancel comes first in the DOM, so the browser's
           * own dialog focus lands there — which is what you want when the
           * next keystroke could deactivate somebody's account.
           */}
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p>{consequence}</p>
      {children}
    </Dialog>
  );
}

/* ---- Toast ------------------------------------------------------------ */

export type ToastKind = 'success' | 'error' | 'warn';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface ToastApi {
  /** Returns the id, so a caller can dismiss early if it wants to. */
  show: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * The toast region is `aria-live="polite"`, so a screen reader announces the
 * outcome without stealing focus from whatever the reader was doing. An error
 * that only appears visually is an error a keyboard user never learns about.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((all) => [...all, { ...toast, id }]);
      // Errors stay until dismissed: an error that vanishes was not reported.
      if (toast.kind !== 'error') {
        window.setTimeout(() => dismiss(id), 6000);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.toastRegion} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${
              toast.kind === 'error'
                ? styles.toastError
                : toast.kind === 'warn'
                  ? styles.toastWarn
                  : ''
            }`}
          >
            <div className={styles.toastText}>
              <p className={styles.toastTitle}>{toast.title}</p>
              {toast.body ? <p className={styles.toastBody}>{toast.body}</p> : null}
            </div>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <IconX size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Outside a provider this is a no-op rather than a throw: a screen that shows
 * a toast should not crash because it was rendered somewhere without one.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  return api ?? { show: () => '', dismiss: () => undefined };
}

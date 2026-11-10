'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Feedback primitives: toasts for outcomes, and a confirm dialog for anything irreversible.
 * The dialog is the native <dialog> element, so focus is trapped and Escape cancels by default.
 */

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
}

interface FeedbackApi {
  toast: (tone: ToastTone, message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used inside <FeedbackProvider>.');
  }
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { id: number }) | null>(null);
  const nextId = useRef(1);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const toast = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, tone === 'error' ? 7000 : 4500);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending({ ...options, id: nextId.current++ });
      requestAnimationFrame(() => dialogRef.current?.showModal());
    });
  }, []);

  const close = (result: boolean) => {
    dialogRef.current?.close();
    resolver.current?.(result);
    resolver.current = null;
    setPending(null);
  };

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="toast__dot" aria-hidden="true" />
            <span>{t.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={() => { setToasts((current) => current.filter((x) => x.id !== t.id)); }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        className="dialog"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
        onCancel={(event) => {
          event.preventDefault();
          close(false);
        }}
      >
        {pending ? (
          <div className="dialog__inner">
            <h2 id="dialog-title">{pending.title}</h2>
            <p id="dialog-body" className="muted">
              {pending.body}
            </p>
            <div className="dialog__actions">
              <button type="button" className="button button--ghost" onClick={() => { close(false); }} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className={pending.tone === 'danger' ? 'button button--danger' : 'button'}
                onClick={() => { close(true); }}
              >
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </FeedbackContext.Provider>
  );
}

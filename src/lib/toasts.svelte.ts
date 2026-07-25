/**
 * Stack of persistent notifications shown at the bottom-right of a window.
 *
 * Nothing auto-dismisses; every toast waits for its close button. Ordering is
 * explicit rather than insertion-based, because the update check only fires 15s
 * after launch and would otherwise land below the session toast.
 */

export type ToastPayload =
  | { kind: 'update'; latest: string; current: string }
  | { kind: 'session'; count: number };

export type ToastKind = ToastPayload['kind'];

export interface ToastEntry {
  id: number;
  payload: ToastPayload;
}

/** Lower sorts higher in the stack. */
const ORDER: Record<ToastKind, number> = {
  update: 0,
  session: 1,
};

export function createToastStore() {
  let entries = $state<ToastEntry[]>([]);
  let nextId = 1;

  function sorted(list: ToastEntry[]): ToastEntry[] {
    return [...list].sort((a, b) => ORDER[a.payload.kind] - ORDER[b.payload.kind]);
  }

  return {
    get toasts(): ToastEntry[] {
      return entries;
    },

    /** Replaces any existing toast of the same kind. Returns the new id. */
    push(payload: ToastPayload): number {
      const id = nextId++;
      entries = sorted([
        ...entries.filter((e) => e.payload.kind !== payload.kind),
        { id, payload },
      ]);
      return id;
    },

    dismiss(id: number): void {
      entries = entries.filter((e) => e.id !== id);
    },

    dismissKind(kind: ToastKind): void {
      entries = entries.filter((e) => e.payload.kind !== kind);
    },
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;

import { describe, it, expect } from 'vitest';
import { createToastStore } from './toasts.svelte';

describe('createToastStore', () => {
  it('StartsEmpty', () => {
    expect(createToastStore().toasts).toEqual([]);
  });

  it('Push_AddsToast', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 3 });
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload).toEqual({ kind: 'session', count: 3 });
  });

  it('Push_ReturnsUniqueIds', () => {
    const store = createToastStore();
    const a = store.push({ kind: 'session', count: 1 });
    const b = store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    expect(a).not.toBe(b);
  });

  it('Dismiss_RemovesById', () => {
    const store = createToastStore();
    const id = store.push({ kind: 'session', count: 2 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.dismiss(id);
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload.kind).toBe('update');
  });

  it('Dismiss_UnknownId_NoOp', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 2 });
    store.dismiss(9999);
    expect(store.toasts).toHaveLength(1);
  });

  it('DismissKind_RemovesEveryToastOfThatKind', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 2 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.dismissKind('session');
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload.kind).toBe('update');
  });

  it('UpdateSortsAboveSession_RegardlessOfPushOrder', () => {
    // The update check fires 15s after launch, so insertion order would put it
    // below the session toast. Order must be explicit.
    const store = createToastStore();
    store.push({ kind: 'session', count: 4 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    expect(store.toasts.map((t) => t.payload.kind)).toEqual(['update', 'session']);
  });

  it('OnlyOneToastPerKind', () => {
    // The update checker runs hourly and must not stack duplicates.
    const store = createToastStore();
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.push({ kind: 'update', latest: 'v1.1.0', current: '0.9.0' });
    expect(store.toasts).toHaveLength(1);
    const payload = store.toasts[0].payload;
    expect(payload.kind === 'update' && payload.latest).toBe('v1.1.0');
  });
});

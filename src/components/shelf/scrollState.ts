export interface ShelfScrollDecision {
  top: number | null;
  pendingRestoreKey: string | null;
}

/** Decide whether to defer/restore a remembered view or reset a changed dataset. */
export function shelfScrollDecision(
  previousViewKey: string | null,
  currentViewKey: string,
  pendingRestoreKey: string | null,
  libraryLoading: boolean,
  storedTop: string | null,
): ShelfScrollDecision {
  const pending = previousViewKey !== currentViewKey ? currentViewKey : pendingRestoreKey;
  if (pending !== currentViewKey) return { top: 0, pendingRestoreKey: null };
  // A library switch changes the view key before its async items replace the old
  // dataset. Keep the restore pending until the target library has finished loading.
  if (libraryLoading) return { top: null, pendingRestoreKey: pending };
  const top = Number(storedTop ?? '0');
  return { top: Number.isFinite(top) ? top : 0, pendingRestoreKey: null };
}

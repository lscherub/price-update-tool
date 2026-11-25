import type { Item } from "@/components/PriceGrid";
import type { CellPatch, SaveQueueSnapshot } from "./types";

export type PatchTransport = (
  items: Record<string, unknown>[],
) => Promise<{ ok: true; items: Item[] } | { ok: false; error: string; retryable: boolean }>;

export type SaveQueueOptions = {
  transport: PatchTransport;
  onServerRowsApplied: (rows: Item[]) => void;
  onStatusChange: (snapshot: SaveQueueSnapshot) => void;
  debounceMs?: number;
  chunkSize?: number;
  maxAutoRetries?: number;
};

type QueuedRow = {
  fields: Record<string, string>;
  revision: number;
};

type FailedRow = {
  fields: Record<string, string>;
  revision: number;
  error: string;
  attempts: number;
};

/**
 * Revision-guarded, debounced, chunked persistence queue for the Spreadsheet Editor.
 *
 * Guarantees:
 *  - Edits are coalesced per row and sent in batches (<= 500 rows/request).
 *  - Every edit bumps a monotonic per-row revision so an older API response can
 *    NEVER overwrite a newer local edit (race-condition safe).
 *  - Transient network / 5xx failures automatically retry with backoff; persistent
 *    failures are retained (never silently dropped) and can be retried manually.
 */
export class SpreadsheetSaveQueue {
  private readonly transport: PatchTransport;
  private readonly onServerRowsApplied: (rows: Item[]) => void;
  private readonly onStatusChange: (snapshot: SaveQueueSnapshot) => void;
  private readonly debounceMs: number;
  private readonly chunkSize: number;
  private readonly maxAutoRetries: number;

  private rowRevision = new Map<string, number>();
  private pending = new Map<string, QueuedRow>();
  private inFlight = new Map<string, QueuedRow>();
  private failed = new Map<string, FailedRow>();

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private disposed = false;
  private lastSavedAt: number | null = null;
  private lastError: string | null = null;
  private flushWaiters: (() => void)[] = [];

  constructor(opts: SaveQueueOptions) {
    this.transport = opts.transport;
    this.onServerRowsApplied = opts.onServerRowsApplied;
    this.onStatusChange = opts.onStatusChange;
    this.debounceMs = opts.debounceMs ?? 350;
    this.chunkSize = Math.min(500, Math.max(1, opts.chunkSize ?? 500));
    this.maxAutoRetries = opts.maxAutoRetries ?? 2;
  }

  getSnapshot(): SaveQueueSnapshot {
    const pendingCount = this.pending.size;
    const inFlightCount = this.inFlight.size;
    const failedCount = this.failed.size;
    let state: SaveQueueSnapshot["state"] = "saved";
    if (failedCount > 0) state = "error";
    else if (inFlightCount > 0) state = "saving";
    else if (pendingCount > 0) state = "dirty";
    return {
      state,
      pendingCount,
      inFlightCount,
      failedCount,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError,
    };
  }

  hasUnsavedChanges(): boolean {
    return this.pending.size > 0 || this.inFlight.size > 0 || this.failed.size > 0;
  }

  private emit(): void {
    if (!this.disposed) this.onStatusChange(this.getSnapshot());
  }

  /** Enqueue one or more row field patches; coalesces with any un-sent edits for the same row. */
  enqueue(patches: readonly CellPatch[], opts?: { immediate?: boolean }): void {
    if (this.disposed || !patches.length) return;
    for (const p of patches) {
      const nextRev = (this.rowRevision.get(p.id) ?? 0) + 1;
      this.rowRevision.set(p.id, nextRev);
      // Merge with any previously failed or pending fields for this row so nothing is lost
      const prevFailed = this.failed.get(p.id);
      const prevPending = this.pending.get(p.id);
      const merged: Record<string, string> = {
        ...(prevFailed?.fields ?? {}),
        ...(prevPending?.fields ?? {}),
        ...p.fields,
      };
      this.failed.delete(p.id);
      this.pending.set(p.id, { fields: merged, revision: nextRev });
    }
    if (this.failed.size === 0) this.lastError = null;
    this.emit();

    if (opts?.immediate) {
      this.clearDebounce();
      void this.drain();
    } else {
      this.scheduleDebounce();
    }
  }

  /** Manually re-queue all failed rows and flush immediately. */
  retryFailed(): Promise<boolean> {
    if (this.failed.size === 0) return this.flushAll();
    for (const [id, entry] of this.failed.entries()) {
      const curPending = this.pending.get(id);
      const merged = { ...entry.fields, ...(curPending?.fields ?? {}) };
      const rev = curPending?.revision ?? entry.revision;
      this.pending.set(id, { fields: merged, revision: rev });
    }
    this.failed.clear();
    this.lastError = null;
    this.emit();
    return this.flushAll();
  }

  /** Flush all pending & in-flight edits now. Resolves true only if 0 unsaved/failed remain. */
  async flushAll(): Promise<boolean> {
    this.clearDebounce();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.pending.size > 0 && !this.flushing) {
      await this.drain();
    } else if (this.flushing) {
      await new Promise<void>((resolve) => this.flushWaiters.push(resolve));
      if (this.pending.size > 0) await this.drain();
    }
    return !this.hasUnsavedChanges();
  }

  dispose(): void {
    this.disposed = true;
    this.clearDebounce();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleDebounce(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.drain();
    }, this.debounceMs);
  }

  private async drain(): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      while (this.pending.size > 0 && !this.disposed) {
        const batchEntries = [...this.pending.entries()].slice(0, this.chunkSize);
        for (const [id, entry] of batchEntries) {
          this.pending.delete(id);
          this.inFlight.set(id, entry);
        }
        this.emit();

        const payload = batchEntries.map(([id, entry]) => ({ id, ...entry.fields }));
        let result: Awaited<ReturnType<PatchTransport>>;
        try {
          result = await this.transport(payload);
        } catch (err) {
          result = {
            ok: false,
            error: err instanceof Error ? err.message : "Could not reach the server.",
            retryable: true,
          };
        }

        const sentRevById = new Map(batchEntries.map(([id, entry]) => [id, entry.revision]));
        for (const [id] of batchEntries) this.inFlight.delete(id);

        if (result.ok) {
          // Only apply server rows whose local revision has NOT advanced while in flight.
          const safeRows = result.items.filter((srv) => {
            const sentRev = sentRevById.get(srv.id);
            const curRev = this.rowRevision.get(srv.id);
            return sentRev !== undefined && curRev === sentRev;
          });
          if (safeRows.length && !this.disposed) {
            this.onServerRowsApplied(safeRows);
          }
          if (this.failed.size === 0 && this.pending.size === 0) {
            this.lastSavedAt = Date.now();
            this.lastError = null;
          }
        } else {
          let scheduleAutoRetry = false;
          let maxAttemptSeen = 0;
          for (const [id, entry] of batchEntries) {
            // If user made a newer edit to this row while in flight, keep the newer pending edit
            // and merge un-saved fields underneath it.
            const newerPending = this.pending.get(id);
            if (newerPending) {
              this.pending.set(id, {
                fields: { ...entry.fields, ...newerPending.fields },
                revision: newerPending.revision,
              });
              continue;
            }
            const prevFail = this.failed.get(id);
            const attempts = (prevFail?.attempts ?? 0) + 1;
            maxAttemptSeen = Math.max(maxAttemptSeen, attempts);
            this.failed.set(id, {
              fields: entry.fields,
              revision: entry.revision,
              error: result.error,
              attempts,
            });
            if (result.retryable && attempts <= this.maxAutoRetries) {
              scheduleAutoRetry = true;
            }
          }
          this.lastError = result.error;
          if (scheduleAutoRetry && !this.disposed) {
            const delay = Math.min(4000, 800 * Math.pow(2, Math.max(0, maxAttemptSeen - 1)));
            if (this.retryTimer) clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              if (!this.disposed) void this.retryFailed();
            }, delay);
          }
        }

        this.emit();
      }
    } finally {
      this.flushing = false;
      const waiters = this.flushWaiters.splice(0, this.flushWaiters.length);
      waiters.forEach((w) => w());
    }
  }
}

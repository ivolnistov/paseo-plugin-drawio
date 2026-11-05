export interface FrameClaim {
  pinned: boolean;
  onEvict(): void;
}

/**
 * Bounds how many viewer frames are alive at once. Pinned claims (file tabs) are always granted
 * and never evicted; other claims evict the least recently used unpinned frame when needed.
 */
export class FrameBudget {
  private readonly live = new Map<string, FrameClaim & { usedAt: number }>();
  private clock = 0;

  constructor(readonly limit: number) {}

  get size(): number {
    return this.live.size;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  acquire(id: string, claim: FrameClaim): boolean {
    const existing = this.live.get(id);
    if (existing) {
      this.live.set(id, { ...claim, usedAt: ++this.clock });
      return true;
    }
    while (this.live.size >= this.limit) {
      const victim = this.oldestUnpinned(id);
      if (!victim) {
        if (!claim.pinned) return false;
        break;
      }
      const evicted = this.live.get(victim)!;
      this.live.delete(victim);
      evicted.onEvict();
    }
    this.live.set(id, { ...claim, usedAt: ++this.clock });
    return true;
  }

  touch(id: string): void {
    const claim = this.live.get(id);
    if (claim) claim.usedAt = ++this.clock;
  }

  release(id: string): void {
    this.live.delete(id);
  }

  private oldestUnpinned(except: string): string | null {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [id, claim] of this.live) {
      if (id === except || claim.pinned) continue;
      if (claim.usedAt < oldestAt) {
        oldest = id;
        oldestAt = claim.usedAt;
      }
    }
    return oldest;
  }
}

export const LIVE_FRAME_LIMIT = 4;
export const frameBudget = new FrameBudget(LIVE_FRAME_LIMIT);

export class TombstoneSafetyGuard {
  private baselineCheckpoint: string | null = null;
  private tombstonesSinceBaseline = 0;

  constructor(private readonly maxTombstonesPerBaseline = 10) {
    if (
      !Number.isInteger(maxTombstonesPerBaseline) ||
      maxTombstonesPerBaseline < 1
    ) {
      throw new Error("maxTombstonesPerBaseline must be a positive integer");
    }
  }

  confirmBaseline(checkpoint: string): void {
    if (!checkpoint) {
      throw new Error("A non-empty checkpoint is required");
    }
    this.baselineCheckpoint = checkpoint;
    this.tombstonesSinceBaseline = 0;
  }

  invalidateBaseline(): void {
    this.baselineCheckpoint = null;
    this.tombstonesSinceBaseline = 0;
  }

  allowTombstone(): boolean {
    if (!this.baselineCheckpoint) {
      return false;
    }
    if (this.tombstonesSinceBaseline >= this.maxTombstonesPerBaseline) {
      return false;
    }
    this.tombstonesSinceBaseline += 1;
    return true;
  }
}

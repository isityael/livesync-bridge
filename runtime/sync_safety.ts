export class TombstoneSafetyGuard {
  private baselineCheckpoint: string | null = null;
  private tombstonesAtCheckpoint = 0;

  constructor(private readonly maxTombstonesPerCheckpoint = 10) {
    if (
      !Number.isInteger(maxTombstonesPerCheckpoint) ||
      maxTombstonesPerCheckpoint < 1
    ) {
      throw new Error("maxTombstonesPerCheckpoint must be a positive integer");
    }
  }

  confirmBaseline(checkpoint: string): void {
    if (!checkpoint) {
      throw new Error("A non-empty checkpoint is required");
    }
    if (this.baselineCheckpoint !== checkpoint) {
      this.baselineCheckpoint = checkpoint;
      this.tombstonesAtCheckpoint = 0;
    }
  }

  advanceCheckpoint(checkpoint: string): void {
    if (!this.baselineCheckpoint) {
      return;
    }
    this.confirmBaseline(checkpoint);
  }

  invalidateBaseline(): void {
    this.baselineCheckpoint = null;
    this.tombstonesAtCheckpoint = 0;
  }

  allowTombstone(): boolean {
    if (!this.baselineCheckpoint) {
      return false;
    }
    if (this.tombstonesAtCheckpoint >= this.maxTombstonesPerCheckpoint) {
      return false;
    }
    this.tombstonesAtCheckpoint += 1;
    return true;
  }

  releaseTombstone(): void {
    this.tombstonesAtCheckpoint = Math.max(0, this.tombstonesAtCheckpoint - 1);
  }
}

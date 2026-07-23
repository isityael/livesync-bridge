export interface RetryOptions {
  failureLimit: number;
  retryDelayMs: number;
  onFailure?: (error: unknown, consecutiveFailures: number) => void;
}

export async function retryWithFailureLimit<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(options.failureLimit) || options.failureLimit < 1) {
    throw new Error("failureLimit must be a positive integer");
  }

  for (let failures = 1; failures <= options.failureLimit; failures += 1) {
    try {
      return await operation();
    } catch (error) {
      options.onFailure?.(error, failures);
      if (failures === options.failureLimit) {
        throw error;
      }
      if (options.retryDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.retryDelayMs),
        );
      }
    }
  }

  throw new Error("unreachable");
}

// ============================================================================
// Error Classes — @lpcli/core
// ============================================================================

export class NetworkError extends Error {
  retryable = true;
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TransactionError extends Error {
  retryable = false;
  constructor(
    message: string,
    public code: string,
    public raw?: unknown
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

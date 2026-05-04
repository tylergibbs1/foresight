/**
 * Typed error classes so callers can `instanceof`-check and react
 * appropriately rather than string-matching on raw exceptions.
 */

/** Base class for all foresight errors. Catch this to handle any library failure. */
export class ForesightError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'ForesightError';
  }
}

/**
 * Thrown when `gate()` receives malformed input (empty goal, missing tool
 * name, empty catalog, etc). Indicates a programming error in the caller —
 * fix the call site, don't retry.
 */
export class ForesightInputError extends ForesightError {
  constructor(message: string) {
    super(message);
    this.name = 'ForesightInputError';
  }
}

/**
 * Thrown when the predictor LLM call fails (network error, schema mismatch,
 * abort, etc). The original error is on `cause`.
 */
export class ForesightPredictError extends ForesightError {
  constructor(message: string, cause: unknown) {
    super(message, cause);
    this.name = 'ForesightPredictError';
  }
}

/**
 * Thrown when the scorer LLM call fails. The original error is on `cause`.
 * If a predict succeeded but score failed, the prediction is preserved on
 * the error for caller use.
 */
export class ForesightScoreError extends ForesightError {
  constructor(
    message: string,
    cause: unknown,
    public prediction?: import('./types.ts').Prediction,
  ) {
    super(message, cause);
    this.name = 'ForesightScoreError';
  }
}

/**
 * Thrown when the operation is aborted via AbortSignal. Use this to
 * differentiate user-cancelled work from genuine failures.
 */
export class ForesightAbortError extends ForesightError {
  constructor() {
    super('foresight: operation aborted');
    this.name = 'ForesightAbortError';
  }
}

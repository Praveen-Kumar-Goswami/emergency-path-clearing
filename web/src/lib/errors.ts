/**
 * @fileoverview Centralized error handling, typed error classes, and contract definitions
 * for the Emergency Path Clearing application.
 */

/**
 * Standard error severity classifications.
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

/**
 * Base domain error class with status code, severity, and contextual metadata.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly severity: ErrorSeverity;
  public readonly timestamp: string;
  public readonly context?: Record<string, unknown>;

  /**
   * @param message Human-readable error description
   * @param code Machine-readable error code string
   * @param severity Error severity level (default 'error')
   * @param context Additional metadata for diagnostic logging
   */
  constructor(
    message: string,
    code: string = 'UNKNOWN_APP_ERROR',
    severity: ErrorSeverity = 'error',
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.severity = severity;
    this.timestamp = new Date().toISOString();
    this.context = context;

    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when geospatial calculations, linear referencing, or coordinates fail validation.
 */
export class CorridorCalculationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CORRIDOR_CALCULATION_ERROR', 'error', context);
  }
}

/**
 * Thrown when vehicle telemetry payload is malformed or out of valid bounds.
 */
export class TelemetryValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'TELEMETRY_VALIDATION_ERROR', 'warning', context);
  }
}

/**
 * Thrown when unauthorized access is attempted or session tokens expire.
 */
export class AuthenticationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 'error', context);
  }
}

/**
 * Thrown when RPC or REST network operations exceed acceptable latency budgets.
 */
export class NetworkTimeoutError extends AppError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(message, 'NETWORK_TIMEOUT_ERROR', 'warning', { ...context, timeoutMs });
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Formats an unknown thrown error into a safe, normalized AppError instance
 * without exposing internal database connection strings or stack traces to end users.
 *
 * @param error Unknown error caught in try/catch block
 * @param fallbackMessage Safe user-facing message if error is unrecognized
 * @returns Normalized AppError instance
 */
export function normalizeError(error: unknown, fallbackMessage: string = 'An unexpected error occurred'): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 'INTERNAL_RUNTIME_ERROR', 'error', {
      originalName: error.name,
    });
  }

  return new AppError(fallbackMessage, 'UNHANDLED_EXCEPTION', 'error', {
    rawError: String(error),
  });
}

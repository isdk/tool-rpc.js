import { CommonError, ErrorCodeType, InternalErrorCode } from '@isdk/common-error';

/**
 * Custom error class for remote procedure call failures.
 * Inherits from CommonError which handles message <-> error field mapping internally.
 */
export class RemoteError extends CommonError {
  /**
   * Creates a new RemoteError instance from a JSON-like error object.
   * @param body - The JSON body containing error details.
   */
  static fromJSON(body: any): RemoteError {
    return super.fromJSON(body) as RemoteError;
  }

  /**
   * Creates a new RemoteError instance.
   * @param options - Error creation options.
   */
  static create(options: { name?: string; code?: number | string; data?: any; error: string }): RemoteError {
    const { error, name, code, data } = options;
    const err = new RemoteError(error, name, code as any);
    if (data) { err.data = data; }
    return err;
  }

  constructor(message: string, name?: string | Record<string, any>, status: ErrorCodeType = InternalErrorCode) {
    super(message, name, status);
  }
}

// One error type for servers and clients (browser, React Native). No platform imports.

/** gRPC-style status codes. */
export enum ErrorCode {
  OK = 0,
  Canceled = 1,
  Unknown = 2,
  InvalidArgument = 3,
  DeadlineExceeded = 4,
  NotFound = 5,
  AlreadyExists = 6,
  PermissionDenied = 7,
  ResourceExhausted = 8,
  FailedPrecondition = 9,
  Aborted = 10,
  OutOfRange = 11,
  Unimplemented = 12,
  Internal = 13,
  Unavailable = 14,
  DataLoss = 15,
  Unauthenticated = 16,
}

/** HTTP status for each code. */
const statuses: Record<ErrorCode, number> = {
  [ErrorCode.OK]: 200,
  [ErrorCode.Canceled]: 499,
  [ErrorCode.Unknown]: 500,
  [ErrorCode.InvalidArgument]: 400,
  [ErrorCode.DeadlineExceeded]: 504,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.AlreadyExists]: 409,
  [ErrorCode.PermissionDenied]: 403,
  [ErrorCode.ResourceExhausted]: 429,
  [ErrorCode.FailedPrecondition]: 412,
  [ErrorCode.Aborted]: 409,
  [ErrorCode.OutOfRange]: 416,
  [ErrorCode.Unimplemented]: 501,
  [ErrorCode.Internal]: 500,
  [ErrorCode.Unavailable]: 503,
  [ErrorCode.DataLoss]: 500,
  [ErrorCode.Unauthenticated]: 401,
};

export interface Details {
  [key: string]: unknown;
  message?: string;
  reason?: string;
  resource?: string;
}

/** The JSON body of an error response. */
export interface ErrorBody<D extends Details = Details> {
  name: "CodeError";
  code: ErrorCode;
  details: D;
}

/** `Details` types the error's fields, e.g. after an OpenAPI error schema. */
export class CodeError<D extends Details = Details> extends Error {
  readonly code: ErrorCode;
  readonly details: D;

  static code = ErrorCode;

  constructor(code: ErrorCode, details: D = {} as D, options?: ErrorOptions) {
    super(details.message ?? ErrorCode[code], options);
    this.name = "CodeError";
    this.code = code;
    this.details = details;
  }

  static is(error: unknown, code?: ErrorCode): error is CodeError {
    return (
      error instanceof CodeError && (code === undefined || error.code === code)
    );
  }

  static invalid(message: string, details?: Details) {
    return new CodeError(ErrorCode.InvalidArgument, { ...details, message });
  }

  static notfound(resource: string, details?: Details) {
    return new CodeError(ErrorCode.NotFound, {
      ...details,
      resource,
      message: `${resource} not found`,
    });
  }

  static exists(message: string, details?: Details) {
    return new CodeError(ErrorCode.AlreadyExists, { ...details, message });
  }

  static unauthenticated(details?: Details) {
    return new CodeError(ErrorCode.Unauthenticated, {
      message: "unauthenticated",
      ...details,
    });
  }

  static forbidden(message: string, details?: Details) {
    return new CodeError(ErrorCode.PermissionDenied, { ...details, message });
  }

  static precondition(message: string, details?: Details) {
    return new CodeError(ErrorCode.FailedPrecondition, { ...details, message });
  }

  static internal(message: string, details?: Details) {
    return new CodeError(ErrorCode.Internal, { ...details, message });
  }

  /** Any thrown value as a CodeError: CodeErrors pass through, others become Unknown. */
  static from(error: unknown): CodeError {
    if (error instanceof CodeError) {
      return error;
    }

    return new CodeError(
      ErrorCode.Unknown,
      { message: error instanceof Error ? error.message : "unknown error" },
      { cause: error },
    );
  }

  /** Rebuild an error from a {@link toJSON} body; any other body is Unknown. */
  static fromJSON<D extends Details = Details>(body: unknown): CodeError<D> {
    const value = body as Partial<ErrorBody<D>> | null;

    if (typeof value?.code === "number" && value.code in ErrorCode) {
      return new CodeError(value.code, value.details ?? ({} as D));
    }

    return new CodeError(ErrorCode.Unknown, {
      message: "unknown error",
    } as D);
  }

  get status(): number {
    return statuses[this.code];
  }

  /** The response body. The cause stays on the server. */
  toJSON(): ErrorBody<D> {
    return { name: "CodeError", code: this.code, details: this.details };
  }
}

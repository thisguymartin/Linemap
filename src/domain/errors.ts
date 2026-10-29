export class NotFoundError extends Error {
  readonly status = 404;
}

export class ValidationError extends Error {
  readonly status = 400;
}

export class ConflictError extends Error {
  readonly status = 409;
}

export class ForbiddenError extends Error {
  readonly status = 403;
}

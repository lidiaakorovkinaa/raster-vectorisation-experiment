export class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorPayload(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details || undefined };
  }
  return {
    code: 'INTERNAL',
    message: error?.message || 'Внутренняя ошибка',
  };
}

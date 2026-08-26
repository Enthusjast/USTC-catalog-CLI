export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const isCliError = (error: unknown): error is CliError =>
  error instanceof CliError;

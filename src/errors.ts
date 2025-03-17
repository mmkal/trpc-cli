/** An error thrown when the trpc procedure results in a bad request */

export class CliValidationError extends Error {}
/** An error which is only thrown when a custom \`process\` parameter is used. Under normal circumstances, this should not be used, even internally. */

export class FailedToExitError extends Error {
  readonly exitCode: number
  constructor(message: string, {exitCode, cause}: {exitCode: number; cause: unknown}) {
    const fullMessage = `${message}. The process was expected to exit with exit code ${exitCode} but did not. This may be because a custom \`process\` parameter was used. The exit reason is in the \`cause\` property.`
    super(fullMessage, {cause})
    this.exitCode = exitCode
  }
}

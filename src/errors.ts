import type {StandardSchemaV1} from './standard-schema/contract.js'
import {prettifyStandardSchemaError} from './standard-schema/errors.js'

/** An error thrown when the trpc procedure results in a bad request */

export class CliValidationError extends Error {}

/**
 * Thrown by norpc procedures (`t`/`os` from `trpc-cli/norpc`, and module-mode commands) when the input fails its
 * schema. Shaped like tRPC's/oRPC's `BAD_REQUEST` errors - `cause` is the Standard Schema failure result - so the
 * CLI can tell it apart from validation errors thrown *inside* a handler and report the issues against the
 * arguments/options they came from.
 */
export class InputValidationError extends Error {
  readonly code = 'BAD_REQUEST'
  declare cause: StandardSchemaV1.FailureResult
  constructor(failure: StandardSchemaV1.FailureResult) {
    super(`Invalid input: ${prettifyStandardSchemaError(failure)}`, {cause: failure})
  }
}
/** An error which is only thrown when a custom \`process\` parameter is used. Under normal circumstances, this should not be used, even internally. */

export class FailedToExitError extends Error {
  readonly exitCode: number
  constructor(message: string, {exitCode, cause}: {exitCode: number; cause: unknown}) {
    const fullMessage = `${message}. The process was expected to exit with exit code ${exitCode} but did not. This may be because a custom \`process\` parameter was used. The exit reason is in the \`cause\` property.`
    super(fullMessage, {cause})
    this.exitCode = exitCode
  }
}

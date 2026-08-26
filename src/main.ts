#!/usr/bin/env node
import { buildCli } from "./cli.js";
import { CliError, isCliError } from "./domain/errors.js";

const readOption = (name: string): string | undefined => {
  const args = process.argv.slice(2);
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1];
  const prefix = args.find((arg) => arg.startsWith(`${name}=`));
  return prefix?.slice(name.length + 1);
};

const exitCodeFor = (cliError: CliError): number =>
  cliError.code === "ARGUMENT_ERROR" ? 2 :
  cliError.code === "CACHE_MISS" || cliError.code === "NETWORK_ERROR" ? 3 :
  cliError.code === "RESTRICTED" ? 4 :
  cliError.code === "REMOTE_HTTP_ERROR" || cliError.code === "REMOTE_NOT_FOUND" || cliError.code === "REMOTE_INVALID_JSON" || cliError.code === "REMOTE_INVALID_DATA" ? 4 :
  cliError.code === "CACHE_ERROR" ? 5 : 1;

const reportError = (error: unknown): void => {
  const cliError = isCliError(error)
    ? error
    : new CliError("UNEXPECTED_ERROR", error instanceof Error ? error.message : String(error));
  process.stderr.write(`错误 [${cliError.code}]：${cliError.message}\n`);
  if (cliError.hint) process.stderr.write(`提示：${cliError.hint}\n`);
  if (process.env.CATALOG_DEBUG && cliError.cause) console.error(cliError.cause);
  process.exitCode = exitCodeFor(cliError);
};

let services: ReturnType<typeof buildCli>["services"] | undefined;

try {
  const timeoutValue = readOption("--timeout");
  const timeoutMs = timeoutValue === undefined ? undefined : Number(timeoutValue);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new CliError("ARGUMENT_ERROR", "--timeout 必须是正整数。");
  }
  const built = buildCli({
    cacheDir: readOption("--cache-dir"),
    timeoutMs,
  });
  services = built.services;
  const run = process.argv.length <= 2 ? Promise.resolve(built.program.outputHelp()) : built.program.parseAsync(process.argv);
  run.catch(reportError);
} catch (error) {
  reportError(error);
}

process.once("exit", () => {
  try {
    services?.repository.close();
  } catch {
    // The database may already be closed after a command error.
  }
});

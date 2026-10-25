import { exec } from "node:child_process";
import { dirname, delimiter } from "node:path";
import type { OracleSpec, DeterministicChecks } from "../types/schema.js";
import { verifyOracleLock, type OracleLockManifest } from "./oracle-lock.js";
import { scanFilesForCheats } from "./anti-cheat.js";

export interface GateExecutionOptions {
  rootDir: string;
  oracleSpec: OracleSpec;
  oracleLock: OracleLockManifest;
  modifiedFiles: string[];
}

export interface DeterministicGateResult {
  allPassed: boolean;
  checks: DeterministicChecks;
  failureReasons: string[];
  combinedLogs: string;
  durationMs: number;
}

interface CommandRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function executeShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<CommandRunResult> {
  const startTime = Date.now();
  const nodeBinDir = dirname(process.execPath);
  const currentPath = process.env.PATH ?? process.env.Path ?? "";
  const env = {
    ...process.env,
    PATH: currentPath.includes(nodeBinDir)
      ? currentPath
      : `${nodeBinDir}${delimiter}${currentPath}`,
  };

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const timedOut = Boolean(error && "killed" in error && error.killed);
        const exitCode =
          error && typeof error.code === "number"
            ? error.code
            : error
            ? 1
            : 0;
        resolve({
          exitCode,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut,
          durationMs,
        });
      }
    );
  });
}

const VACUOUS_TEST_REGEX =
  /(?:no test files found|\b0 passed\b|\b0 tests\b(?!\s*(?:failed|skipped|errored|todo)))/i;

export async function runVerificationGate(
  options: GateExecutionOptions
): Promise<DeterministicGateResult> {
  const overallStart = Date.now();
  const failureReasons: string[] = [];
  const logSections: string[] = [];

  // 1. SHA-256 Oracle Lock Check
  const oracleCheck = await verifyOracleLock(options.rootDir, options.oracleLock);
  const oracleHashValid = oracleCheck.valid;
  if (!oracleHashValid) {
    if (oracleCheck.tamperedFiles.length > 0) {
      failureReasons.push(
        `TAMPERING_DETECTED: Locked test/oracle files modified: ${oracleCheck.tamperedFiles.join(", ")}`
      );
    }
    if (oracleCheck.missingFiles.length > 0) {
      failureReasons.push(
        `TAMPERING_DETECTED: Locked test/oracle files deleted: ${oracleCheck.missingFiles.join(", ")}`
      );
    }
  }

  // 2. Static Anti-Cheat Scan
  const antiCheatReport = await scanFilesForCheats(options.rootDir, options.modifiedFiles);
  const antiCheatClean = antiCheatReport.clean;
  if (!antiCheatClean) {
    for (const v of antiCheatReport.violations) {
      failureReasons.push(`ANTI_CHEAT_VIOLATION [${v.rule}] ${v.file}:${v.line} -> ${v.snippet}`);
    }
  }

  // 3. Automated Test Execution
  const testRun = await executeShellCommand(
    options.oracleSpec.testCommand,
    options.rootDir,
    options.oracleSpec.maxExecutionMs
  );
  logSections.push(`=== TEST COMMAND (${options.oracleSpec.testCommand}) ===\n${testRun.stdout}\n${testRun.stderr}`);
  const combinedTestOut = `${testRun.stdout}\n${testRun.stderr}`;
  const isVacuous =
    combinedTestOut.trim().length === 0 || VACUOUS_TEST_REGEX.test(combinedTestOut);
  const testsPassed = testRun.exitCode === 0 && !testRun.timedOut && !isVacuous;
  if (!testsPassed) {
    if (testRun.timedOut) {
      failureReasons.push(`TEST_TIMEOUT: Exceeded ${options.oracleSpec.maxExecutionMs}ms`);
    } else if (isVacuous) {
      failureReasons.push("VACUOUS_TESTS: Test runner reported no test files or 0 passed tests");
    } else {
      failureReasons.push(`TEST_FAILURE: Command exited with code ${testRun.exitCode}`);
    }
  }

  // 4. Linter / Typecheck Execution
  const lintRun = await executeShellCommand(
    options.oracleSpec.lintCommand,
    options.rootDir,
    options.oracleSpec.maxExecutionMs
  );
  logSections.push(`=== LINT COMMAND (${options.oracleSpec.lintCommand}) ===\n${lintRun.stdout}\n${lintRun.stderr}`);
  const lintPassed = lintRun.exitCode === 0 && !lintRun.timedOut;
  if (!lintPassed) {
    failureReasons.push(
      lintRun.timedOut
        ? `LINT_TIMEOUT: Exceeded ${options.oracleSpec.maxExecutionMs}ms`
        : `LINT_FAILURE: Command exited with code ${lintRun.exitCode}`
    );
  }

  // 5. Live Runtime Smoke & Benchmark Execution
  const smokeRun = await executeShellCommand(
    options.oracleSpec.runtimeSmokeCommand,
    options.rootDir,
    options.oracleSpec.maxExecutionMs
  );
  logSections.push(
    `=== SMOKE & BENCHMARK COMMAND (${options.oracleSpec.runtimeSmokeCommand}) [${smokeRun.durationMs}ms / max ${options.oracleSpec.maxExecutionMs}ms] ===\n${smokeRun.stdout}\n${smokeRun.stderr}`
  );
  const smokeAndBenchmarkPassed =
    smokeRun.exitCode === 0 &&
    !smokeRun.timedOut &&
    smokeRun.durationMs <= options.oracleSpec.maxExecutionMs;
  if (!smokeAndBenchmarkPassed) {
    failureReasons.push(
      smokeRun.timedOut || smokeRun.durationMs > options.oracleSpec.maxExecutionMs
        ? `BENCHMARK_EXCEEDED: Runtime smoke took ${smokeRun.durationMs}ms (limit ${options.oracleSpec.maxExecutionMs}ms)`
        : `SMOKE_FAILURE: Runtime smoke exited with code ${smokeRun.exitCode}`
    );
  }

  const checks: DeterministicChecks = {
    oracleHashValid,
    antiCheatClean,
    testsPassed,
    lintPassed,
    smokeAndBenchmarkPassed,
  };

  const allPassed = Object.values(checks).every(Boolean);

  return {
    allPassed,
    checks,
    failureReasons,
    combinedLogs: logSections.join("\n\n"),
    durationMs: Date.now() - overallStart,
  };
}

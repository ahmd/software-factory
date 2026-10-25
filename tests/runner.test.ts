import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOracleLock } from "../src/core/oracle-lock.js";
import { runVerificationGate } from "../src/core/runner.js";

describe("Deterministic Verification Runner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "factory-runner-"));
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await mkdir(join(tempDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes when oracle lock, anti-cheat, tests, lint, and smoke benchmark all succeed", async () => {
    await writeFile(join(tempDir, "tests/s1.test.ts"), " locked test ", "utf8");
    await writeFile(join(tempDir, "src/app.ts"), "export const x = 1;\n", "utf8");
    const lock = await createOracleLock(tempDir, "step-1", ["tests/s1.test.ts"]);

    const result = await runVerificationGate({
      rootDir: tempDir,
      oracleLock: lock,
      modifiedFiles: ["src/app.ts"],
      oracleSpec: {
        lockedTestFiles: ["tests/s1.test.ts"],
        testCommand: 'node -e "console.log(\'1 passed\')"',
        lintCommand: 'node -e "process.exit(0)"',
        runtimeSmokeCommand: 'node -e "console.log(\'smoke ok\')"',
        maxExecutionMs: 5000,
      },
    });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toEqual({
      oracleHashValid: true,
      antiCheatClean: true,
      testsPassed: true,
      lintPassed: true,
      smokeAndBenchmarkPassed: true,
    });
  });

  it("rejects vacuous test runs that report 0 passed or no tests found (Review Focus #3)", async () => {
    await writeFile(join(tempDir, "tests/s1.test.ts"), " locked test ", "utf8");
    await writeFile(join(tempDir, "src/app.ts"), "export const x = 1;\n", "utf8");
    const lock = await createOracleLock(tempDir, "step-1", ["tests/s1.test.ts"]);

    const result = await runVerificationGate({
      rootDir: tempDir,
      oracleLock: lock,
      modifiedFiles: ["src/app.ts"],
      oracleSpec: {
        lockedTestFiles: ["tests/s1.test.ts"],
        testCommand: 'node -e "console.log(\'No test files found\'); process.exit(0)"',
        lintCommand: 'node -e "process.exit(0)"',
        runtimeSmokeCommand: 'node -e "console.log(\'smoke ok\')"',
        maxExecutionMs: 5000,
      },
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks.testsPassed).toBe(false);
    expect(result.failureReasons.some((r) => /vacuous|no test/i.test(r))).toBe(true);
  });

  it("does not false-positive on '0 tests failed' and rejects silent zero-output test commands", async () => {
    await writeFile(join(tempDir, "tests/s1.test.ts"), " locked test ", "utf8");
    await writeFile(join(tempDir, "src/app.ts"), "export const x = 1;\n", "utf8");
    const lock = await createOracleLock(tempDir, "step-1", ["tests/s1.test.ts"]);

    const okRes = await runVerificationGate({
      rootDir: tempDir,
      oracleLock: lock,
      modifiedFiles: ["src/app.ts"],
      oracleSpec: {
        lockedTestFiles: ["tests/s1.test.ts"],
        testCommand: 'node -e "console.log(\'5 passed, 0 tests failed\')"',
        lintCommand: 'node -e "process.exit(0)"',
        runtimeSmokeCommand: 'node -e "console.log(\'smoke ok\')"',
        maxExecutionMs: 5000,
      },
    });
    expect(okRes.checks.testsPassed).toBe(true);

    const silentRes = await runVerificationGate({
      rootDir: tempDir,
      oracleLock: lock,
      modifiedFiles: ["src/app.ts"],
      oracleSpec: {
        lockedTestFiles: ["tests/s1.test.ts"],
        testCommand: 'node -e "process.exit(0)"',
        lintCommand: 'node -e "process.exit(0)"',
        runtimeSmokeCommand: 'node -e "console.log(\'smoke ok\')"',
        maxExecutionMs: 5000,
      },
    });
    expect(silentRes.checks.testsPassed).toBe(false);
  });
});

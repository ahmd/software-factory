import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, unlink, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOracleLock, verifyOracleLock } from "../src/core/oracle-lock.js";
import { scanFilesForCheats } from "../src/core/anti-cheat.js";

describe("Oracle SHA-256 Lock and Anti-Cheat Scanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "factory-oracle-"));
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await mkdir(join(tempDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("verifies unmodified locked files and detects tampering or deletion", async () => {
    const testFile = "tests/step-1.test.ts";
    await writeFile(join(tempDir, testFile), "expect(add(2, 2)).toBe(4);\n", "utf8");

    const manifest = await createOracleLock(tempDir, "step-1", [testFile]);
    const okResult = await verifyOracleLock(tempDir, manifest);
    expect(okResult).toEqual({ valid: true, tamperedFiles: [], missingFiles: [] });

    // Tamper with test file
    await writeFile(join(tempDir, testFile), "expect(add(2, 2)).toBe(999);\n", "utf8");
    const tamperedResult = await verifyOracleLock(tempDir, manifest);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.tamperedFiles).toEqual([testFile]);

    // Delete locked test file (Review Focus #1)
    await unlink(join(tempDir, testFile));
    const missingResult = await verifyOracleLock(tempDir, manifest);
    expect(missingResult.valid).toBe(false);
    expect(missingResult.missingFiles).toEqual([testFile]);
  });

  it("rejects path traversal outside workspace root (Review Focus #2)", async () => {
    await expect(createOracleLock(tempDir, "step-1", ["../outside.ts"])).rejects.toThrow(
      /escapes workspace root/i
    );
    await expect(scanFilesForCheats(tempDir, ["../../etc/passwd"])).rejects.toThrow(
      /escapes workspace root/i
    );
  });

  it("detects banned cheat patterns in source files and passes clean files", async () => {
    const badFile = "src/cheater.ts";
    await writeFile(
      join(tempDir, badFile),
      [
        "// @ts-ignore",
        "// eslint-disable-next-line",
        "// TODO: implement later",
        "try { doWork(); } catch (e) { }",
        "describe.skip('suite', () => {});",
      ].join("\n"),
      "utf8"
    );

    const report = await scanFilesForCheats(tempDir, [badFile]);
    expect(report.clean).toBe(false);
    expect(report.violations.length).toBeGreaterThanOrEqual(5);

    const cleanFile = "src/clean.ts";
    await writeFile(
      join(tempDir, cleanFile),
      "export function add(a: number, b: number): number { return a + b; }\n",
      "utf8"
    );
    const cleanReport = await scanFilesForCheats(tempDir, [cleanFile]);
    expect(cleanReport.clean).toBe(true);
    expect(cleanReport.violations).toEqual([]);
  });
});

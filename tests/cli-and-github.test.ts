import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli/factory-ctl.js";

describe("factory-ctl CLI and GitHub Mirror/Sync", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "factory-cli-"));
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await mkdir(join(tempDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drives a full POC stage lifecycle via factory-ctl CLI and records GitHub mirror issues", async () => {
    const initRes = await runCli(["init", "--name", "MW2Rebuild", "--stage", "POC"], tempDir);
    expect(initRes.exitCode).toBe(0);

    const statusRes = await runCli(["status"], tempDir);
    expect(JSON.parse(statusRes.stdout).phase).toBe("STAGE_ANALYSIS");

    const analysisFile = join(tempDir, "analysis-in.json");
    await writeFile(
      analysisFile,
      JSON.stringify({
        stage: "POC",
        summary: "Core",
        functionalRequirements: [{ id: "FR-1", description: "Add", verificationMethod: "Test" }],
        technicalConstraints: [],
        edgeCases: [],
        feasibilityMetrics: { complexity: "LOW", risks: [] },
      }),
      "utf8"
    );
    expect((await runCli(["record-analysis", "--file", analysisFile], tempDir)).exitCode).toBe(0);

    const researchFile = join(tempDir, "research-in.json");
    await writeFile(
      researchFile,
      JSON.stringify({
        stage: "POC",
        existingCodebaseFindings: [],
        recommendedPatterns: [],
        dependencies: [],
        technicalRoadblocks: [],
        runtimeVerificationStrategy: { testFramework: "node", linterCommand: "node", smokeTestApproach: "node" },
      }),
      "utf8"
    );
    expect((await runCli(["record-research", "--file", researchFile], tempDir)).exitCode).toBe(0);

    await writeFile(join(tempDir, "tests/s1.test.ts"), "locked test content", "utf8");
    const planFile = join(tempDir, "plan-in.json");
    await writeFile(
      planFile,
      JSON.stringify({
        stage: "POC",
        planVersion: 1,
        architectureOverview: "Clean",
        dataFlowDiagramMermaid: "flowchart LR\nA-->B",
        steps: [
          {
            stepId: "step-1",
            title: "Implement math module",
            description: "Create math.ts",
            filesToCreateOrModify: ["src/math.ts"],
            acceptanceCriteria: ["Passes test"],
            oracleSpec: {
              lockedTestFiles: ["tests/s1.test.ts"],
              testCommand: 'node -e "console.log(\'1 passed\')"',
              lintCommand: 'node -e "process.exit(0)"',
              runtimeSmokeCommand: 'node -e "console.log(\'ok\')"',
              maxExecutionMs: 5000,
            },
          },
        ],
      }),
      "utf8"
    );
    expect((await runCli(["record-plan", "--file", planFile], tempDir)).exitCode).toBe(0);

    const mirrorRaw = await readFile(join(tempDir, ".factory/github-mirror/issues.json"), "utf8");
    expect(mirrorRaw).toContain("Implement math module");

    // Lock Oracle, Execute, Verify Step, Audit, Critic, and Approve Stage
    expect((await runCli(["lock-oracle", "--step", "step-1"], tempDir)).exitCode).toBe(0);

    await writeFile(join(tempDir, "src/math.ts"), "export const add = (a: number, b: number) => a + b;\n", "utf8");
    const execFile = join(tempDir, "exec-in.json");
    await writeFile(
      execFile,
      JSON.stringify({
        stepId: "step-1",
        attempt: 1,
        status: "READY_FOR_AUDIT",
        filesModified: ["src/math.ts"],
        implementationSummary: "Added math.ts",
      }),
      "utf8"
    );
    expect((await runCli(["record-execute", "--file", execFile], tempDir)).exitCode).toBe(0);

    const verifyRes = await runCli(["verify-step", "--step", "step-1"], tempDir);
    expect(verifyRes.exitCode).toBe(0);
    const verifyJson = JSON.parse(verifyRes.stdout);
    expect(verifyJson.allPassed).toBe(true);

    const auditFile = join(tempDir, "audit-in.json");
    await writeFile(
      auditFile,
      JSON.stringify({
        stepId: "step-1",
        attempt: 1,
        verdict: "APPROVED",
        deterministicChecks: verifyJson.checks,
        semanticAuditClean: true,
        failureReasons: [],
        rawErrorLogs: "",
        remediationInstructionsForExecute: "",
      }),
      "utf8"
    );
    expect((await runCli(["record-audit", "--file", auditFile], tempDir)).exitCode).toBe(0);

    const criticFile = join(tempDir, "critic-in.json");
    await writeFile(
      criticFile,
      JSON.stringify({
        stepId: "step-1",
        verdict: "APPROVED",
        scores: { architecturalIntegrity: 9, maintainability: 9, security: 10, scalability: 9 },
        findings: [],
        replanInstructions: "",
      }),
      "utf8"
    );
    expect((await runCli(["record-critic", "--file", criticFile], tempDir)).exitCode).toBe(0);

    const approveRes = await runCli(["approve-stage"], tempDir);
    expect(approveRes.exitCode).toBe(0);
    expect(JSON.parse(approveRes.stdout).nextStage).toBe("MVP");
  });
});

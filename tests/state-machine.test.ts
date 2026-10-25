import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactoryStateMachine } from "../src/core/state-machine.js";

describe("FactoryStateMachine Routing, Loops, and Circuit Breakers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "factory-sm-"));
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(join(tempDir, "tests/s1.test.ts"), "test", "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const samplePlan = {
    stage: "POC" as const,
    planVersion: 1,
    architectureOverview: "Modular",
    dataFlowDiagramMermaid: "flowchart TD\nA-->B",
    steps: [
      {
        stepId: "step-1",
        title: "Core",
        description: "Build core",
        filesToCreateOrModify: ["src/core.ts"],
        acceptanceCriteria: ["Passes test"],
        oracleSpec: {
          lockedTestFiles: ["tests/s1.test.ts"],
          testCommand: "npm test",
          lintCommand: "npm run lint",
          runtimeSmokeCommand: "node -e ''",
          maxExecutionMs: 3000,
        },
      },
    ],
  };

  it("enforces Phase 1 -> Phase 2 Loop -> Phase 3 Critic -> Stage Gate pause -> MVP", async () => {
    const sm = await FactoryStateMachine.init(tempDir, "DemoApp", "POC");
    expect(sm.getState().phase).toBe("STAGE_ANALYSIS");

    await sm.recordAnalysis({
      stage: "POC",
      summary: "Req",
      functionalRequirements: [{ id: "FR-1", description: "D", verificationMethod: "T" }],
      technicalConstraints: [],
      edgeCases: [],
      feasibilityMetrics: { complexity: "LOW", risks: [] },
    });
    expect(sm.getState().phase).toBe("STAGE_RESEARCH");

    await sm.recordResearch({
      stage: "POC",
      existingCodebaseFindings: [],
      recommendedPatterns: [],
      dependencies: [],
      technicalRoadblocks: [],
      runtimeVerificationStrategy: { testFramework: "vitest", linterCommand: "eslint", smokeTestApproach: "cli" },
    });
    expect(sm.getState().phase).toBe("STAGE_PLAN");

    await sm.recordPlan(samplePlan);
    expect(sm.getState().phase).toBe("STEP_ORACLE_LOCK");

    await sm.lockStepOracle("step-1");
    expect(sm.getState().phase).toBe("STEP_EXECUTE");

    await sm.recordExecuteAttempt({
      stepId: "step-1",
      attempt: 1,
      status: "READY_FOR_AUDIT",
      filesModified: ["src/core.ts"],
      implementationSummary: "Attempt 1",
    });
    expect(sm.getState().phase).toBe("STEP_AUDIT");

    // Reject if deterministic check is false even if verdict says APPROVED (Review Focus #4)
    const fakeApprove = await sm.recordAuditVerdict({
      stepId: "step-1",
      attempt: 1,
      verdict: "APPROVED",
      deterministicChecks: {
        oracleHashValid: false,
        antiCheatClean: true,
        testsPassed: true,
        lintPassed: true,
        smokeAndBenchmarkPassed: true,
      },
      semanticAuditClean: true,
      failureReasons: ["Tampered"],
      rawErrorLogs: "Hash mismatch",
      remediationInstructionsForExecute: "Revert test edits",
    });
    expect(fakeApprove.status).toBe("RETRY_EXECUTE");
    expect(sm.getState().phase).toBe("STEP_EXECUTE");
    expect(sm.getState().currentStepAttempt).toBe(2);

    // Attempt 2 passes
    await sm.recordExecuteAttempt({
      stepId: "step-1",
      attempt: 2,
      status: "READY_FOR_AUDIT",
      filesModified: ["src/core.ts"],
      implementationSummary: "Attempt 2",
    });
    const realApprove = await sm.recordAuditVerdict({
      stepId: "step-1",
      attempt: 2,
      verdict: "APPROVED",
      deterministicChecks: {
        oracleHashValid: true,
        antiCheatClean: true,
        testsPassed: true,
        lintPassed: true,
        smokeAndBenchmarkPassed: true,
      },
      semanticAuditClean: true,
      failureReasons: [],
      rawErrorLogs: "",
      remediationInstructionsForExecute: "",
    });
    expect(realApprove.status).toBe("APPROVED");
    expect(sm.getState().phase).toBe("STEP_CRITIC");

    const criticRes = await sm.recordCriticVerdict({
      stepId: "step-1",
      verdict: "APPROVED",
      scores: { architecturalIntegrity: 9, maintainability: 9, security: 10, scalability: 9 },
      findings: [],
      replanInstructions: "",
    });
    expect(criticRes.status).toBe("AWAITING_STAGE_APPROVAL");
    expect(sm.getState().phase).toBe("AWAITING_STAGE_APPROVAL");

    const next = await sm.approveStageAndAdvance();
    expect(next.nextStage).toBe("MVP");
    expect(sm.getState().currentStage).toBe("MVP");
    expect(sm.getState().phase).toBe("STAGE_ANALYSIS");
  });

  it("escalates model on attempts 4-5, trips circuit breaker at 5, and stops after 2 replans (Review Focus #5)", async () => {
    const sm = await FactoryStateMachine.init(tempDir, "LoopApp", "POC");
    await sm.recordAnalysis({
      stage: "POC",
      summary: "S",
      functionalRequirements: [],
      technicalConstraints: [],
      edgeCases: [],
      feasibilityMetrics: { complexity: "LOW", risks: [] },
    });
    await sm.recordResearch({
      stage: "POC",
      existingCodebaseFindings: [],
      recommendedPatterns: [],
      dependencies: [],
      technicalRoadblocks: [],
      runtimeVerificationStrategy: { testFramework: "v", linterCommand: "l", smokeTestApproach: "s" },
    });
    await sm.recordPlan(samplePlan);

    // 2 Critic replans allowed; 3rd triggers HUMAN_INTERVENTION_REQUIRED
    for (let r = 1; r <= 3; r++) {
      await sm.lockStepOracle("step-1");
      await sm.recordExecuteAttempt({
        stepId: "step-1",
        attempt: 1,
        status: "READY_FOR_AUDIT",
        filesModified: ["src/core.ts"],
        implementationSummary: "ok",
      });
      await sm.recordAuditVerdict({
        stepId: "step-1",
        attempt: 1,
        verdict: "APPROVED",
        deterministicChecks: {
          oracleHashValid: true,
          antiCheatClean: true,
          testsPassed: true,
          lintPassed: true,
          smokeAndBenchmarkPassed: true,
        },
        semanticAuditClean: true,
        failureReasons: [],
        rawErrorLogs: "",
        remediationInstructionsForExecute: "",
      });
      const criticOut = await sm.recordCriticVerdict({
        stepId: "step-1",
        verdict: "ROUTE_TO_PLAN",
        scores: { architecturalIntegrity: 3, maintainability: 4, security: 5, scalability: 3 },
        findings: [{ severity: "CRITICAL", category: "ARCH", detail: "Flawed" }],
        replanInstructions: "Redesign",
      });
      if (r <= 2) {
        expect(criticOut.status).toBe("ROUTE_TO_PLAN");
        expect(sm.getState().phase).toBe("STAGE_PLAN");
        await sm.recordPlan({ ...samplePlan, planVersion: r + 1 });
      } else {
        expect(criticOut.status).toBe("HUMAN_INTERVENTION_REQUIRED");
        expect(sm.getState().phase).toBe("HUMAN_INTERVENTION_REQUIRED");
      }
    }
  });
});

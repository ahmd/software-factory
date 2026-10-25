import { describe, it, expect } from "vitest";
import {
  StageNameSchema,
  STAGE_ORDER,
  AnalysisArtifactSchema,
  ResearchArtifactSchema,
  PlanArtifactSchema,
  ExecuteArtifactSchema,
  AuditArtifactSchema,
  CriticArtifactSchema,
} from "../src/types/schema.js";
import { AGENT_PERSONAS, buildSubagentDispatchPrompt } from "../src/agents/personas.js";

describe("Schemas and 6 Agent Personas", () => {
  it("enforces exact stage order POC -> MVP -> V1 -> V2 -> Vx", () => {
    expect(STAGE_ORDER).toEqual(["POC", "MVP", "V1", "V2", "Vx"]);
    expect(StageNameSchema.safeParse("POC").success).toBe(true);
    expect(StageNameSchema.safeParse("BETA").success).toBe(false);
  });

  it("defines all 6 agents with strict tool permissions and anti-cheat mandates", () => {
    const ids = Object.keys(AGENT_PERSONAS);
    expect(ids).toEqual([
      "analysis-agent",
      "research-agent",
      "plan-agent",
      "execute-agent",
      "auditor-agent",
      "critic-agent",
    ]);
    expect(AGENT_PERSONAS["analysis-agent"].enableWriteTools).toBe(false);
    expect(AGENT_PERSONAS["research-agent"].enableWriteTools).toBe(false);
    expect(AGENT_PERSONAS["plan-agent"].enableWriteTools).toBe(false);
    expect(AGENT_PERSONAS["critic-agent"].enableWriteTools).toBe(false);
    expect(AGENT_PERSONAS["execute-agent"].enableWriteTools).toBe(true);
    expect(AGENT_PERSONAS["auditor-agent"].enableWriteTools).toBe(true);

    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(persona.enableSubagentTools).toBe(false);
      expect(persona.systemPrompt.length).toBeGreaterThan(100);
    }
    expect(AGENT_PERSONAS["execute-agent"].systemPrompt).toContain("lockedTestFiles");
    expect(AGENT_PERSONAS["auditor-agent"].systemPrompt).toContain("APPROVED");
  });

  it("validates all 6 agent artifact schemas", () => {
    expect(
      AnalysisArtifactSchema.safeParse({
        stage: "POC",
        summary: "Core parser",
        functionalRequirements: [{ id: "FR-1", description: "Parse input", verificationMethod: "Unit test" }],
        technicalConstraints: ["Node 22"],
        edgeCases: [{ scenario: "Empty input", expectedBehavior: "Throw error" }],
        feasibilityMetrics: { complexity: "LOW", risks: [] },
      }).success
    ).toBe(true);

    expect(
      ResearchArtifactSchema.safeParse({
        stage: "POC",
        existingCodebaseFindings: ["Empty repo"],
        recommendedPatterns: [{ pattern: "Pipeline", rationale: "Strict gates" }],
        dependencies: [{ name: "zod", version: "^3.23.8", purpose: "Schema validation" }],
        technicalRoadblocks: [{ roadblock: "Test tampering", mitigation: "SHA-256 lock" }],
        runtimeVerificationStrategy: {
          testFramework: "vitest",
          linterCommand: "eslint",
          smokeTestApproach: "CLI healthcheck",
        },
      }).success
    ).toBe(true);

    expect(
      PlanArtifactSchema.safeParse({
        stage: "POC",
        planVersion: 1,
        architectureOverview: "Modular",
        dataFlowDiagramMermaid: "flowchart TD\nA-->B",
        steps: [
          {
            stepId: "step-1",
            title: "Core",
            description: "Desc",
            filesToCreateOrModify: ["src/index.ts"],
            acceptanceCriteria: ["Works"],
            oracleSpec: {
              lockedTestFiles: ["tests/index.test.ts"],
              testCommand: "npx vitest run",
              lintCommand: "npx tsc --noEmit",
              runtimeSmokeCommand: "node -e ''",
              maxExecutionMs: 5000,
            },
          },
        ],
      }).success
    ).toBe(true);

    expect(
      ExecuteArtifactSchema.safeParse({
        stepId: "step-1",
        attempt: 1,
        status: "READY_FOR_AUDIT",
        filesModified: ["src/index.ts"],
        implementationSummary: "Implemented core",
      }).success
    ).toBe(true);

    expect(
      AuditArtifactSchema.safeParse({
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
      }).success
    ).toBe(true);

    expect(
      CriticArtifactSchema.safeParse({
        stepId: "step-1",
        verdict: "APPROVED",
        scores: { architecturalIntegrity: 9, maintainability: 9, security: 10, scalability: 8 },
        findings: [],
        replanInstructions: "",
      }).success
    ).toBe(true);
  });

  it("builds fresh-context dispatch prompts containing input/output file paths", () => {
    const prompt = buildSubagentDispatchPrompt("execute-agent", {
      stage: "POC",
      stepId: "step-1",
      attempt: 2,
      inputArtifactPaths: [".factory/runs/POC/plan.json"],
      outputArtifactPath: ".factory/runs/POC/step-1/execute-attempt-2.json",
    });
    expect(prompt).toContain("POC");
    expect(prompt).toContain("step-1");
    expect(prompt).toContain(".factory/runs/POC/plan.json");
    expect(prompt).toContain(".factory/runs/POC/step-1/execute-attempt-2.json");
  });
});

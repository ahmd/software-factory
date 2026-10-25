# Multi-Agent Software Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 6-agent Software Factory (`Analysis`, `Research`, `Plan`, `Execute`, `Auditor`, `Critic`) with the deterministic `factory-ctl` TypeScript gatekeeper CLI, `SHA-256` Oracle test locking, static anti-cheat scanner, GitHub Issues/Milestones/PR integration, and global Antigravity plugin (`~/.gemini/config/plugins/software-factory/`).

**Architecture:** A strict TypeScript state-machine and verification engine (`src/core/` + `src/cli/factory-ctl.ts`) enforces macro stage-gates (`POC → MVP → V1 → V2 → Vx`), the 3-phase routing pipeline (`Analysis → Research → Plan → [Oracle Lock → Execute ↔ Auditor] → Critic`), `SHA-256` test-file locking, static anti-cheat scanning, live command/benchmark execution, and `gh` CLI synchronization. An Antigravity plugin (`plugin.json`, `rules/AGENTS.md`, `skills/software-factory/SKILL.md`) connects Antigravity's native subagents (`define_subagent` / `invoke_subagent`) to `factory-ctl`.

**Tech Stack:** TypeScript 5.x, Node.js (`crypto`, `child_process`, `fs/promises`), `zod` (schema validation), `tsx` (CLI execution), `vitest` (test runner), GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-10-25-software-factory-design.md`

## Global Constraints

- Platform & Shell: Windows (`powershell`), Node.js / TypeScript (`tsx`, `vitest`, `zod`), ES modules (`"type": "module"`).
- Stage progression order: `POC` → `MVP` → `V1` → `V2` → `Vx`, pausing at `AWAITING_STAGE_APPROVAL` after each completed Stage.
- Agent tool boundaries: `analysis-agent`, `research-agent`, `plan-agent`, and `critic-agent` MUST have `enableWriteTools: false` and `enableSubagentTools: false`; `execute-agent` and `auditor-agent` have `enableWriteTools: true` and `enableSubagentTools: false`.
- Circuit breakers: `Execute ↔ Auditor` max attempts per step = `5` (attempts `1..3` use model `"inherit"`, attempts `4..5` escalate to `"pro"`); max re-plans per step (`Critic → Plan` or circuit breaker → `Plan`) = `2`, after which state transitions to `HUMAN_INTERVENTION_REQUIRED`.
- Banned anti-cheat patterns in production files: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `TODO`, `FIXME`, `HACK`, `.skip(`, `.only(`, `it.todo(`, empty `catch` blocks (`catch\s*(\([^)]*\))?\s*\{\s*\}`), and inline assembly (`__asm`).
- Antigravity plugin rules file (`rules/AGENTS.md`) MUST be plain Markdown with no frontmatter and under `24,000` bytes; `plugin.json` MUST only use valid top-level fields (`name`, `displayName`, `description`, `version`, `suggestedPrompts`).

## Review Focus

- **Deleted locked test file during `Execute`:** `verifyOracleLock` must catch missing/deleted files cleanly and return `valid: false` with `missingFiles` populated instead of throwing an unhandled `ENOENT` exception (Task 2).
- **Path traversal outside workspace root:** Passing `../outside.ts` or an absolute path outside `rootDir` to `createOracleLock` or `scanFilesForCheats` must throw a path validation error (Task 2).
- **Vacuous test runs (exit code 0 with 0 tests executed):** `runVerificationGate` must mark `testsPassed: false` when the test runner exits `0` but reports `0 passed` or `No test files found` (Task 3).
- **LLM Auditor returning `"APPROVED"` despite failed deterministic checks:** `FactoryStateMachine.recordAuditVerdict` must override/reject an `"APPROVED"` verdict if any boolean in `deterministicChecks` or `semanticAuditClean` is `false` (Task 4).
- **Unbounded re-plan loops:** When a Step exceeds `maxReplansPerStep` (`2`) via either the 5-attempt `Auditor` circuit breaker or `Critic` returning `"ROUTE_TO_PLAN"`, `FactoryStateMachine` must transition to `HUMAN_INTERVENTION_REQUIRED` rather than looping back to `STAGE_PLAN` (Task 4).

---

### Task 1: Project Scaffolding, Zod Artifact Schemas, & 6 Agent Personas

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types/schema.ts`
- Create: `src/agents/personas.ts`
- Test: `tests/personas-and-schemas.test.ts`

**Interfaces:**
- Consumes: none (foundational task)
- Produces:
  - `src/types/schema.ts`:
    - `StageNameSchema` (`z.enum(["POC", "MVP", "V1", "V2", "Vx"])`), `STAGE_ORDER: readonly StageName[]`
    - `WorkflowPhaseSchema` (`z.enum(["STAGE_ANALYSIS", "STAGE_RESEARCH", "STAGE_PLAN", "STEP_ORACLE_LOCK", "STEP_EXECUTE", "STEP_AUDIT", "STEP_CRITIC", "AWAITING_STAGE_APPROVAL", "HUMAN_INTERVENTION_REQUIRED", "COMPLETED"])`)
    - `OracleSpecSchema`, `PlanStepSchema`, `AnalysisArtifactSchema`, `ResearchArtifactSchema`, `PlanArtifactSchema`, `ExecuteArtifactSchema`, `DeterministicChecksSchema`, `AuditArtifactSchema`, `CriticArtifactSchema`, `FactoryStateSchema` (and inferred TypeScript types)
  - `src/agents/personas.ts`:
    - `AgentId` (`"analysis-agent" | "research-agent" | "plan-agent" | "execute-agent" | "auditor-agent" | "critic-agent"`)
    - `AgentPersonaDefinition` (`{ id: AgentId; role: string; enableWriteTools: boolean; enableSubagentTools: boolean; systemPrompt: string; outputFileName: string }`)
    - `AGENT_PERSONAS: Record<AgentId, AgentPersonaDefinition>`
    - `buildSubagentDispatchPrompt(agentId: AgentId, context: { stage: StageName; stepId?: string; attempt?: number; inputArtifactPaths: string[]; outputArtifactPath: string; extraInstructions?: string }): string`

- [ ] **Step 1: Initialize `package.json`, `tsconfig.json`, and `vitest.config.ts`, and install dependencies**

Create `package.json` with `"name": "software-factory"`, `"type": "module"`, scripts `"test": "vitest run"`, `"factory-ctl": "tsx src/cli/factory-ctl.ts"`, dependencies `"zod": "^3.23.8"`, and devDependencies `"typescript": "^5.6.3"`, `"tsx": "^4.19.1"`, `"vitest": "^2.1.4"`, `"@types/node": "^22.7.5"`. Run `npm install`.

- [ ] **Step 2: Write the failing test in `tests/personas-and-schemas.test.ts`**

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/personas-and-schemas.test.ts`
Expected: FAIL with module not found `../src/types/schema.js`

- [ ] **Step 4: Implement `src/types/schema.ts` and `src/agents/personas.ts`**

Implement the Zod schemas matching Section 5.3 of the spec (`AnalysisArtifactSchema`, `ResearchArtifactSchema`, `PlanArtifactSchema`, `ExecuteArtifactSchema`, `AuditArtifactSchema`, `CriticArtifactSchema`, `FactoryStateSchema`) and the 6 agent personas with strict system instructions and `buildSubagentDispatchPrompt`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/personas-and-schemas.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types/schema.ts src/agents/personas.ts tests/personas-and-schemas.test.ts
git commit -m "feat: add Zod artifact schemas and 6 agent persona definitions"
```

---

### Task 2: Cryptographic Oracle Locking (`oracle-lock.ts`) & Static Anti-Cheat Scanner (`anti-cheat.ts`)

**Files:**
- Create: `src/core/oracle-lock.ts`
- Create: `src/core/anti-cheat.ts`
- Test: `tests/oracle-and-anticheat.test.ts`

**Interfaces:**
- Consumes: `src/types/schema.ts`
- Produces:
  - `src/core/oracle-lock.ts`:
    - `OracleLockManifest`: `{ stepId: string; createdAt: string; files: Record<string, string> }`
    - `OracleVerificationResult`: `{ valid: boolean; tamperedFiles: string[]; missingFiles: string[] }`
    - `resolveSafeWorkspacePath(rootDir: string, relativePath: string): string` (throws `Error` if resolved path escapes `rootDir`)
    - `createOracleLock(rootDir: string, stepId: string, relativeFiles: string[]): Promise<OracleLockManifest>`
    - `verifyOracleLock(rootDir: string, manifest: OracleLockManifest): Promise<OracleVerificationResult>`
  - `src/core/anti-cheat.ts`:
    - `AntiCheatViolation`: `{ file: string; line: number; rule: string; snippet: string }`
    - `AntiCheatReport`: `{ clean: boolean; violations: AntiCheatViolation[] }`
    - `scanFilesForCheats(rootDir: string, relativeFiles: string[]): Promise<AntiCheatReport>`

- [ ] **Step 1: Write the failing test in `tests/oracle-and-anticheat.test.ts`**

```typescript
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
    await writeFile(join(tempDir, testFile), 'expect(add(2, 2)).toBe(4);\n', "utf8");

    const manifest = await createOracleLock(tempDir, "step-1", [testFile]);
    const okResult = await verifyOracleLock(tempDir, manifest);
    expect(okResult).toEqual({ valid: true, tamperedFiles: [], missingFiles: [] });

    // Tamper with test file
    await writeFile(join(tempDir, testFile), 'expect(add(2, 2)).toBe(999);\n', "utf8");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/oracle-and-anticheat.test.ts`
Expected: FAIL with module not found `../src/core/oracle-lock.js`

- [ ] **Step 3: Implement `src/core/oracle-lock.ts` and `src/core/anti-cheat.ts`**

Use `crypto.createHash("sha256")` in `oracle-lock.ts`, validate relative paths with `path.resolve` so any path escaping `rootDir` throws `Error("Path escapes workspace root: ...")`, and scan line-by-line plus multi-line empty `catch` blocks in `anti-cheat.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/oracle-and-anticheat.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/oracle-lock.ts src/core/anti-cheat.ts tests/oracle-and-anticheat.test.ts
git commit -m "feat: add SHA-256 oracle lock and static anti-cheat scanner"
```

---

### Task 3: Deterministic Verification & Benchmark Runner (`runner.ts`)

**Files:**
- Create: `src/core/runner.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Consumes:
  - `OracleSpec` from `src/types/schema.ts`
  - `OracleLockManifest`, `verifyOracleLock` from `src/core/oracle-lock.ts`
  - `scanFilesForCheats` from `src/core/anti-cheat.ts`
- Produces:
  - `src/core/runner.ts`:
    - `GateExecutionOptions`: `{ rootDir: string; oracleSpec: OracleSpec; oracleLock: OracleLockManifest; modifiedFiles: string[] }`
    - `DeterministicGateResult`: `{ allPassed: boolean; checks: DeterministicChecks; failureReasons: string[]; combinedLogs: string; durationMs: number }`
    - `runVerificationGate(options: GateExecutionOptions): Promise<DeterministicGateResult>`

- [ ] **Step 1: Write the failing test in `tests/runner.test.ts`**

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runner.test.ts`
Expected: FAIL with module not found `../src/core/runner.js`

- [ ] **Step 3: Implement `src/core/runner.ts`**

Execute `verifyOracleLock`, `scanFilesForCheats`, and child-process shell commands (`testCommand`, `lintCommand`, `runtimeSmokeCommand`) with timeout enforcement (`maxExecutionMs`), checking for vacuous test output (`/(?:no test files found|0 passed|0 tests)/i`) even when exit code is `0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runner.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/runner.ts tests/runner.test.ts
git commit -m "feat: add deterministic test, lint, and smoke benchmark runner"
```

---

### Task 4: State Machine, Circuit Breakers, & Roadmap Ledger (`state-machine.ts`)

**Files:**
- Create: `src/core/state-machine.ts`
- Test: `tests/state-machine.test.ts`

**Interfaces:**
- Consumes: `src/types/schema.ts`, `src/core/oracle-lock.ts`
- Produces:
  - `src/core/state-machine.ts`:
    - `FactoryStateMachine`:
      - `static init(rootDir: string, projectName: string, initialStage?: StageName): Promise<FactoryStateMachine>`
      - `static load(rootDir: string): Promise<FactoryStateMachine>`
      - `getState(): FactoryState`
      - `getRecommendedModel(): "inherit" | "pro"`
      - `recordAnalysis(artifact: AnalysisArtifact): Promise<void>`
      - `recordResearch(artifact: ResearchArtifact): Promise<void>`
      - `recordPlan(artifact: PlanArtifact): Promise<void>`
      - `lockStepOracle(stepId: string): Promise<OracleLockManifest>`
      - `recordExecuteAttempt(artifact: ExecuteArtifact): Promise<void>`
      - `recordAuditVerdict(artifact: AuditArtifact): Promise<{ status: "APPROVED" | "RETRY_EXECUTE" | "CIRCUIT_BREAKER_TO_PLAN" | "HUMAN_INTERVENTION_REQUIRED"; modelTier: "inherit" | "pro" }>`
      - `recordCriticVerdict(artifact: CriticArtifact): Promise<{ status: "NEXT_STEP" | "AWAITING_STAGE_APPROVAL" | "ROUTE_TO_PLAN" | "HUMAN_INTERVENTION_REQUIRED" }>`
      - `approveStageAndAdvance(): Promise<{ nextStage: StageName | "COMPLETED" }>`

- [ ] **Step 1: Write the failing test in `tests/state-machine.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state-machine.test.ts`
Expected: FAIL with module not found `../src/core/state-machine.js`

- [ ] **Step 3: Implement `src/core/state-machine.ts`**

Persist `.factory/state.json`, artifacts under `.factory/runs/<stage>/`, and a human-readable `ROADMAP.md` table showing all Stages (`POC`, `MVP`, `V1`, `V2`, `Vx`), active Step, attempt counts, and approval status.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state-machine.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/state-machine.ts tests/state-machine.test.ts
git commit -m "feat: implement state machine, loop circuit breakers, and ROADMAP ledger"
```

---

### Task 5: GitHub Issues/Milestones/PR Sync (`github-sync.ts`) & `factory-ctl` CLI (`factory-ctl.ts`)

**Files:**
- Create: `src/core/github-sync.ts`
- Create: `src/cli/factory-ctl.ts`
- Test: `tests/cli-and-github.test.ts`

**Interfaces:**
- Consumes: `src/types/schema.ts`, `src/core/state-machine.ts`, `src/core/runner.ts`, `src/agents/personas.ts`
- Produces:
  - `src/core/github-sync.ts`:
    - `GitHubSync`:
      - `syncStagePlan(plan: PlanArtifact): Promise<{ mode: "gh-live" | "local-mirror"; milestoneTitle: string; issueMap: Record<string, number> }>`
      - `postStepComment(stepId: string, heading: string, markdownBody: string): Promise<void>`
      - `closeStepIssue(stepId: string, summary: string): Promise<void>`
      - `createStageSummaryReport(stage: StageName, summaryMarkdown: string): Promise<string>`
  - `src/cli/factory-ctl.ts`:
    - `runCli(argv: string[], rootDir?: string): Promise<{ exitCode: number; stdout: string }>`

- [ ] **Step 1: Write the failing test in `tests/cli-and-github.test.ts`**

```typescript
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

    // Write analysis, research, plan JSON files and record via CLI
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

    // Check GitHub issue mirror was created for step-1
    const mirrorRaw = await readFile(join(tempDir, ".factory/github-mirror/issues.json"), "utf8");
    expect(mirrorRaw).toContain("Implement math module");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-and-github.test.ts`
Expected: FAIL with module not found `../src/cli/factory-ctl.js`

- [ ] **Step 3: Implement `src/core/github-sync.ts` and `src/cli/factory-ctl.ts`**

Implement `GitHubSync` (calling `gh` CLI when a GitHub remote is present and `--live-gh` is enabled, while always writing `.factory/github-mirror/issues.json` and per-issue markdown comment logs) and `factory-ctl.ts` supporting `init`, `status`, `personas`, `dispatch-prompt`, `record-analysis`, `record-research`, `record-plan`, `lock-oracle`, `record-execute`, `verify-step`, `record-audit`, `record-critic`, and `approve-stage`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-and-github.test.ts`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/github-sync.ts src/cli/factory-ctl.ts tests/cli-and-github.test.ts
git commit -m "feat: add GitHub Issue/Milestone sync and factory-ctl CLI"
```

---

### Task 6: Global Antigravity Plugin (`~/.gemini/config/plugins/software-factory/`) & Workspace Customizations

**Files:**
- Create: `C:\Users\ahmd-\.gemini\config\plugins\software-factory\plugin.json`
- Create: `C:\Users\ahmd-\.gemini\config\plugins\software-factory\rules\AGENTS.md`
- Create: `C:\Users\ahmd-\.gemini\config\plugins\software-factory\skills\software-factory\SKILL.md`
- Create: `C:\Users\ahmd-\.gemini\config\plugins\software-factory\skills\software-factory\references\agent-prompts.md`
- Create: `.agents/rules/AGENTS.md`
- Create: `.agents/skills/software-factory/SKILL.md`
- Create: `.agents/skills/software-factory/references/agent-prompts.md`
- Test: `tests/plugin-validation.test.ts`

**Interfaces:**
- Consumes: `src/agents/personas.ts`, `src/cli/factory-ctl.ts`
- Produces:
  - Installed global Antigravity plugin at `C:\Users\ahmd-\.gemini\config\plugins\software-factory\` and workspace `.agents/` mirror so `/software-factory` is active immediately in this workspace and globally across all projects.

- [ ] **Step 1: Write the failing test in `tests/plugin-validation.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

describe("Antigravity Plugin and Workspace Customizations", () => {
  const globalPluginDir = join(homedir(), ".gemini", "config", "plugins", "software-factory");
  const workspaceAgentsDir = join(process.cwd(), ".agents");

  it("validates global plugin.json schema and allowed top-level keys", async () => {
    const raw = await readFile(join(globalPluginDir, "plugin.json"), "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("software-factory");
    expect(manifest.description).toBeTruthy();
    expect(manifest.suggestedPrompts?.length).toBe(3);
    const allowed = new Set(["name", "displayName", "description", "version", "logo", "suggestedPrompts", "disabled"]);
    for (const key of Object.keys(manifest)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("validates AGENTS.md rule size limit (< 24KB, no YAML frontmatter) and SKILL.md frontmatter", async () => {
    for (const rulesPath of [
      join(globalPluginDir, "rules", "AGENTS.md"),
      join(workspaceAgentsDir, "rules", "AGENTS.md"),
    ]) {
      const content = await readFile(rulesPath, "utf8");
      const info = await stat(rulesPath);
      expect(info.size).toBeLessThan(24000);
      expect(content.startsWith("---")).toBe(false);
      expect(content).toContain("POC");
      expect(content).toContain("SHA-256");
    }

    for (const skillPath of [
      join(globalPluginDir, "skills", "software-factory", "SKILL.md"),
      join(workspaceAgentsDir, "skills", "software-factory", "SKILL.md"),
    ]) {
      const skillContent = await readFile(skillPath, "utf8");
      expect(skillContent.startsWith("---")).toBe(true);
      expect(skillContent).toContain("name: software-factory");
      expect(skillContent).toContain("define_subagent");
      expect(skillContent).toContain("invoke_subagent");
      expect(skillContent).toContain("factory-ctl");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin-validation.test.ts`
Expected: FAIL with `ENOENT` on `plugin.json`

- [ ] **Step 3: Create the global plugin files in `C:\Users\ahmd-\.gemini\config\plugins\software-factory\` and workspace `.agents/` files**

Write `plugin.json`, `rules/AGENTS.md` (strictly enforcing the MW2 anti-cheat laws, `SHA-256` Oracle lock, fresh context per attempt, and `POC → MVP → V1 → V2 → Vx` stage gates), `skills/software-factory/SKILL.md` (Master Orchestrator runbook showing exact `define_subagent`, `invoke_subagent`, and `factory-ctl` commands for Phase 1, Phase 2 Loop, Phase 3 Critic, and Stage Gates), and `references/agent-prompts.md`.

- [ ] **Step 4: Run full test suite to verify everything passes**

Run: `npx vitest run`
Expected: PASS (all 6 test suites pass)

- [ ] **Step 5: Commit**

```bash
git add .agents tests/plugin-validation.test.ts
git commit -m "feat: add Antigravity software-factory skill, rules, and plugin validation"
```

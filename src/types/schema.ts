import { z } from "zod";

export const STAGE_ORDER = ["POC", "MVP", "V1", "V2", "Vx"] as const;
export const StageNameSchema = z.enum(STAGE_ORDER);
export type StageName = z.infer<typeof StageNameSchema>;

export const WorkflowPhaseSchema = z.enum([
  "STAGE_ANALYSIS",
  "STAGE_RESEARCH",
  "STAGE_PLAN",
  "STEP_ORACLE_LOCK",
  "STEP_EXECUTE",
  "STEP_AUDIT",
  "STEP_CRITIC",
  "AWAITING_STAGE_APPROVAL",
  "HUMAN_INTERVENTION_REQUIRED",
  "COMPLETED",
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const OracleSpecSchema = z.object({
  lockedTestFiles: z.array(z.string().min(1)).min(1),
  testCommand: z.string().min(1),
  lintCommand: z.string().min(1),
  runtimeSmokeCommand: z.string().min(1),
  maxExecutionMs: z.number().int().positive().default(15000),
});
export type OracleSpec = z.infer<typeof OracleSpecSchema>;

export const PlanStepSchema = z.object({
  stepId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  filesToCreateOrModify: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  oracleSpec: OracleSpecSchema,
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

// 1. Analysis Agent Output Schema
export const AnalysisArtifactSchema = z.object({
  stage: StageNameSchema,
  summary: z.string().min(1),
  functionalRequirements: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      verificationMethod: z.string().min(1),
    })
  ),
  technicalConstraints: z.array(z.string()),
  edgeCases: z.array(
    z.object({
      scenario: z.string().min(1),
      expectedBehavior: z.string().min(1),
    })
  ),
  feasibilityMetrics: z.object({
    complexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
    risks: z.array(z.string()),
  }),
});
export type AnalysisArtifact = z.infer<typeof AnalysisArtifactSchema>;

// 2. Research Agent Output Schema
export const ResearchArtifactSchema = z.object({
  stage: StageNameSchema,
  existingCodebaseFindings: z.array(z.string()),
  recommendedPatterns: z.array(
    z.object({
      pattern: z.string().min(1),
      rationale: z.string().min(1),
    })
  ),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      purpose: z.string().min(1),
    })
  ),
  technicalRoadblocks: z.array(
    z.object({
      roadblock: z.string().min(1),
      mitigation: z.string().min(1),
    })
  ),
  runtimeVerificationStrategy: z.object({
    testFramework: z.string().min(1),
    linterCommand: z.string().min(1),
    smokeTestApproach: z.string().min(1),
  }),
});
export type ResearchArtifact = z.infer<typeof ResearchArtifactSchema>;

// 3. Plan Agent Output Schema
export const PlanArtifactSchema = z.object({
  stage: StageNameSchema,
  planVersion: z.number().int().positive(),
  architectureOverview: z.string().min(1),
  dataFlowDiagramMermaid: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1),
});
export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;

// 4. Execute Agent Output Schema
export const ExecuteArtifactSchema = z.object({
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: z.enum(["READY_FOR_AUDIT", "BLOCKED"]),
  filesModified: z.array(z.string()),
  implementationSummary: z.string().min(1),
});
export type ExecuteArtifact = z.infer<typeof ExecuteArtifactSchema>;

// 5. Auditor Agent Output Schema
export const DeterministicChecksSchema = z.object({
  oracleHashValid: z.boolean(),
  antiCheatClean: z.boolean(),
  testsPassed: z.boolean(),
  lintPassed: z.boolean(),
  smokeAndBenchmarkPassed: z.boolean(),
});
export type DeterministicChecks = z.infer<typeof DeterministicChecksSchema>;

export const AuditArtifactSchema = z.object({
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  verdict: z.enum(["APPROVED", "REJECTED"]),
  deterministicChecks: DeterministicChecksSchema,
  semanticAuditClean: z.boolean(),
  failureReasons: z.array(z.string()),
  rawErrorLogs: z.string(),
  remediationInstructionsForExecute: z.string(),
});
export type AuditArtifact = z.infer<typeof AuditArtifactSchema>;

// 6. Critic Agent Output Schema
export const CriticFindingSchema = z.object({
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]),
  category: z.enum(["SECURITY", "ARCH", "SCALE", "MAINT"]),
  detail: z.string().min(1),
});
export type CriticFinding = z.infer<typeof CriticFindingSchema>;

export const CriticArtifactSchema = z.object({
  stepId: z.string().min(1),
  verdict: z.enum(["APPROVED", "ROUTE_TO_PLAN"]),
  scores: z.object({
    architecturalIntegrity: z.number().min(0).max(10),
    maintainability: z.number().min(0).max(10),
    security: z.number().min(0).max(10),
    scalability: z.number().min(0).max(10),
  }),
  findings: z.array(CriticFindingSchema),
  replanInstructions: z.string(),
});
export type CriticArtifact = z.infer<typeof CriticArtifactSchema>;

// Factory Persistent State Schema
export const StepHistorySchema = z.object({
  stepId: z.string(),
  title: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "APPROVED", "FAILED"]),
  attempts: z.number().int().nonnegative(),
  replans: z.number().int().nonnegative(),
  githubIssueNumber: z.number().int().optional(),
  lastAuditVerdict: z.enum(["APPROVED", "REJECTED"]).optional(),
  lastCriticVerdict: z.enum(["APPROVED", "ROUTE_TO_PLAN"]).optional(),
});
export type StepHistory = z.infer<typeof StepHistorySchema>;

export const FactoryStateSchema = z.object({
  projectName: z.string().min(1),
  currentStage: StageNameSchema,
  completedStages: z.array(StageNameSchema),
  phase: WorkflowPhaseSchema,
  currentStepIndex: z.number().int().nonnegative(),
  currentStepAttempt: z.number().int().positive(),
  currentStepReplans: z.number().int().nonnegative(),
  maxAttemptsPerStep: z.number().int().positive().default(5),
  maxReplansPerStep: z.number().int().positive().default(2),
  stepHistories: z.record(z.string(), StepHistorySchema),
  updatedAt: z.string(),
});
export type FactoryState = z.infer<typeof FactoryStateSchema>;

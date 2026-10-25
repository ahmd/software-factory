import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  STAGE_ORDER,
  FactoryStateSchema,
  AnalysisArtifactSchema,
  ResearchArtifactSchema,
  PlanArtifactSchema,
  ExecuteArtifactSchema,
  AuditArtifactSchema,
  CriticArtifactSchema,
  type StageName,
  type FactoryState,
  type AnalysisArtifact,
  type ResearchArtifact,
  type PlanArtifact,
  type ExecuteArtifact,
  type AuditArtifact,
  type CriticArtifact,
} from "../types/schema.js";
import { createOracleLock, type OracleLockManifest } from "./oracle-lock.js";

export class FactoryStateMachine {
  private readonly rootDir: string;
  private state: FactoryState;

  private constructor(rootDir: string, state: FactoryState) {
    this.rootDir = rootDir;
    this.state = state;
  }

  public static async init(
    rootDir: string,
    projectName: string,
    initialStage: StageName = "POC"
  ): Promise<FactoryStateMachine> {
    const initialState: FactoryState = FactoryStateSchema.parse({
      projectName,
      currentStage: initialStage,
      completedStages: [],
      phase: "STAGE_ANALYSIS",
      currentStepIndex: 0,
      currentStepAttempt: 1,
      currentStepReplans: 0,
      maxAttemptsPerStep: 5,
      maxReplansPerStep: 2,
      stepHistories: {},
      updatedAt: new Date().toISOString(),
    });
    const sm = new FactoryStateMachine(rootDir, initialState);
    await sm.saveState();
    return sm;
  }

  public static async load(rootDir: string): Promise<FactoryStateMachine> {
    const statePath = join(rootDir, ".factory", "state.json");
    const raw = await readFile(statePath, "utf8");
    const parsed = FactoryStateSchema.parse(JSON.parse(raw));
    return new FactoryStateMachine(rootDir, parsed);
  }

  public getState(): FactoryState {
    return structuredClone(this.state);
  }

  public getRecommendedModel(): "inherit" | "pro" {
    return this.state.currentStepAttempt >= 4 ? "pro" : "inherit";
  }

  private stageRunDir(stage: StageName = this.state.currentStage): string {
    return join(this.rootDir, ".factory", "runs", stage);
  }

  private stepRunDir(stepId: string, stage: StageName = this.state.currentStage): string {
    return join(this.stageRunDir(stage), stepId);
  }

  public async loadActivePlan(): Promise<PlanArtifact> {
    const raw = await readFile(join(this.stageRunDir(), "plan.json"), "utf8");
    return PlanArtifactSchema.parse(JSON.parse(raw));
  }

  public async loadStepOracleLock(stepId: string): Promise<OracleLockManifest> {
    const raw = await readFile(join(this.stepRunDir(stepId), "oracle-lock.json"), "utf8");
    return JSON.parse(raw) as OracleLockManifest;
  }

  public async recordAnalysis(artifact: AnalysisArtifact): Promise<void> {
    if (this.state.phase !== "STAGE_ANALYSIS") {
      throw new Error(`Cannot record analysis in phase ${this.state.phase}`);
    }
    const validated = AnalysisArtifactSchema.parse(artifact);
    const dir = this.stageRunDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "analysis.json"), JSON.stringify(validated, null, 2), "utf8");
    this.state.phase = "STAGE_RESEARCH";
    await this.saveState();
  }

  public async recordResearch(artifact: ResearchArtifact): Promise<void> {
    if (this.state.phase !== "STAGE_RESEARCH") {
      throw new Error(`Cannot record research in phase ${this.state.phase}`);
    }
    const validated = ResearchArtifactSchema.parse(artifact);
    const dir = this.stageRunDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "research.json"), JSON.stringify(validated, null, 2), "utf8");
    this.state.phase = "STAGE_PLAN";
    await this.saveState();
  }

  public async recordPlan(artifact: PlanArtifact): Promise<void> {
    if (this.state.phase !== "STAGE_PLAN") {
      throw new Error(`Cannot record plan in phase ${this.state.phase}`);
    }
    const validated = PlanArtifactSchema.parse(artifact);
    const dir = this.stageRunDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "plan.json"), JSON.stringify(validated, null, 2), "utf8");

    for (const step of validated.steps) {
      const existing = this.state.stepHistories[step.stepId];
      this.state.stepHistories[step.stepId] = {
        stepId: step.stepId,
        title: step.title,
        status: existing?.status === "APPROVED" ? "APPROVED" : "PENDING",
        attempts: existing?.attempts ?? 0,
        replans: existing?.replans ?? this.state.currentStepReplans,
        githubIssueNumber: existing?.githubIssueNumber,
        lastAuditVerdict: existing?.lastAuditVerdict,
        lastCriticVerdict: existing?.lastCriticVerdict,
      };
    }

    const firstUnfinishedIdx = validated.steps.findIndex(
      (s) => this.state.stepHistories[s.stepId]?.status !== "APPROVED"
    );
    this.state.currentStepIndex = firstUnfinishedIdx >= 0 ? firstUnfinishedIdx : 0;
    this.state.currentStepAttempt = 1;
    this.state.phase = "STEP_ORACLE_LOCK";
    await this.saveState();
  }

  public async lockStepOracle(stepId: string): Promise<OracleLockManifest> {
    if (this.state.phase !== "STEP_ORACLE_LOCK") {
      throw new Error(`Cannot lock oracle in phase ${this.state.phase}`);
    }
    const plan = await this.loadActivePlan();
    const step = plan.steps[this.state.currentStepIndex];
    if (!step || step.stepId !== stepId) {
      throw new Error(`Active step is ${step?.stepId ?? "none"}, cannot lock ${stepId}`);
    }

    const manifest = await createOracleLock(
      this.rootDir,
      stepId,
      step.oracleSpec.lockedTestFiles
    );
    const sDir = this.stepRunDir(stepId);
    await mkdir(sDir, { recursive: true });
    await writeFile(join(sDir, "oracle-lock.json"), JSON.stringify(manifest, null, 2), "utf8");

    if (this.state.stepHistories[stepId]) {
      this.state.stepHistories[stepId].status = "IN_PROGRESS";
    }
    this.state.phase = "STEP_EXECUTE";
    await this.saveState();
    return manifest;
  }

  public async recordExecuteAttempt(artifact: ExecuteArtifact): Promise<void> {
    if (this.state.phase !== "STEP_EXECUTE") {
      throw new Error(`Cannot record execute attempt in phase ${this.state.phase}`);
    }
    const validated = ExecuteArtifactSchema.parse(artifact);
    const sDir = this.stepRunDir(validated.stepId);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      join(sDir, `execute-attempt-${validated.attempt}.json`),
      JSON.stringify(validated, null, 2),
      "utf8"
    );
    this.state.phase = "STEP_AUDIT";
    await this.saveState();
  }

  public async recordAuditVerdict(artifact: AuditArtifact): Promise<{
    status:
      | "APPROVED"
      | "RETRY_EXECUTE"
      | "CIRCUIT_BREAKER_TO_PLAN"
      | "HUMAN_INTERVENTION_REQUIRED";
    modelTier: "inherit" | "pro";
  }> {
    if (this.state.phase !== "STEP_AUDIT") {
      throw new Error(`Cannot record audit verdict in phase ${this.state.phase}`);
    }
    const validated = AuditArtifactSchema.parse(artifact);
    const allDeterministicTrue = Object.values(validated.deterministicChecks).every(Boolean);
    const effectiveApproved =
      validated.verdict === "APPROVED" &&
      allDeterministicTrue &&
      validated.semanticAuditClean;

    const finalArtifact: AuditArtifact = {
      ...validated,
      verdict: effectiveApproved ? "APPROVED" : "REJECTED",
    };

    const sDir = this.stepRunDir(validated.stepId);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      join(sDir, `audit-attempt-${validated.attempt}.json`),
      JSON.stringify(finalArtifact, null, 2),
      "utf8"
    );

    const history = this.state.stepHistories[validated.stepId];
    if (history) {
      history.attempts = this.state.currentStepAttempt;
      history.lastAuditVerdict = finalArtifact.verdict;
    }

    if (effectiveApproved) {
      this.state.phase = "STEP_CRITIC";
      await this.saveState();
      return { status: "APPROVED", modelTier: this.getRecommendedModel() };
    }

    // Rejected: check inner loop attempt cap (5 attempts)
    if (this.state.currentStepAttempt < this.state.maxAttemptsPerStep) {
      this.state.currentStepAttempt += 1;
      this.state.phase = "STEP_EXECUTE";
      await this.saveState();
      return {
        status: "RETRY_EXECUTE",
        modelTier: this.getRecommendedModel(),
      };
    }

    // Circuit breaker tripped at attempt 5 -> check replan cap
    this.state.currentStepReplans += 1;
    if (history) {
      history.replans = this.state.currentStepReplans;
      history.status = "FAILED";
    }
    if (this.state.currentStepReplans <= this.state.maxReplansPerStep) {
      this.state.phase = "STAGE_PLAN";
      await this.saveState();
      return { status: "CIRCUIT_BREAKER_TO_PLAN", modelTier: "pro" };
    }

    this.state.phase = "HUMAN_INTERVENTION_REQUIRED";
    await this.saveState();
    return { status: "HUMAN_INTERVENTION_REQUIRED", modelTier: "pro" };
  }

  public async recordCriticVerdict(artifact: CriticArtifact): Promise<{
    status:
      | "NEXT_STEP"
      | "AWAITING_STAGE_APPROVAL"
      | "ROUTE_TO_PLAN"
      | "HUMAN_INTERVENTION_REQUIRED";
  }> {
    if (this.state.phase !== "STEP_CRITIC") {
      throw new Error(`Cannot record critic verdict in phase ${this.state.phase}`);
    }
    const validated = CriticArtifactSchema.parse(artifact);
    const sDir = this.stepRunDir(validated.stepId);
    await mkdir(sDir, { recursive: true });
    await writeFile(join(sDir, "critic-review.json"), JSON.stringify(validated, null, 2), "utf8");

    const history = this.state.stepHistories[validated.stepId];
    if (history) {
      history.lastCriticVerdict = validated.verdict;
    }

    if (validated.verdict === "ROUTE_TO_PLAN") {
      this.state.currentStepReplans += 1;
      if (history) {
        history.replans = this.state.currentStepReplans;
      }
      if (this.state.currentStepReplans <= this.state.maxReplansPerStep) {
        this.state.phase = "STAGE_PLAN";
        await this.saveState();
        return { status: "ROUTE_TO_PLAN" };
      }
      this.state.phase = "HUMAN_INTERVENTION_REQUIRED";
      await this.saveState();
      return { status: "HUMAN_INTERVENTION_REQUIRED" };
    }

    // Critic APPROVED
    if (history) {
      history.status = "APPROVED";
    }
    const plan = await this.loadActivePlan();
    if (this.state.currentStepIndex + 1 < plan.steps.length) {
      this.state.currentStepIndex += 1;
      this.state.currentStepAttempt = 1;
      this.state.currentStepReplans = 0;
      this.state.phase = "STEP_ORACLE_LOCK";
      await this.saveState();
      return { status: "NEXT_STEP" };
    }

    this.state.phase = "AWAITING_STAGE_APPROVAL";
    await this.saveState();
    return { status: "AWAITING_STAGE_APPROVAL" };
  }

  public async approveStageAndAdvance(): Promise<{ nextStage: StageName | "COMPLETED" }> {
    if (this.state.phase !== "AWAITING_STAGE_APPROVAL") {
      throw new Error(`Cannot approve stage in phase ${this.state.phase}`);
    }
    if (!this.state.completedStages.includes(this.state.currentStage)) {
      this.state.completedStages.push(this.state.currentStage);
    }

    const currentIdx = STAGE_ORDER.indexOf(this.state.currentStage);
    if (currentIdx + 1 < STAGE_ORDER.length) {
      const nextStage = STAGE_ORDER[currentIdx + 1];
      this.state.currentStage = nextStage;
      this.state.phase = "STAGE_ANALYSIS";
      this.state.currentStepIndex = 0;
      this.state.currentStepAttempt = 1;
      this.state.currentStepReplans = 0;
      this.state.stepHistories = {};
      await this.saveState();
      return { nextStage };
    }

    this.state.phase = "COMPLETED";
    await this.saveState();
    return { nextStage: "COMPLETED" };
  }

  public async saveState(): Promise<void> {
    this.state.updatedAt = new Date().toISOString();
    const factoryDir = join(this.rootDir, ".factory");
    await mkdir(factoryDir, { recursive: true });
    await writeFile(join(factoryDir, "state.json"), JSON.stringify(this.state, null, 2), "utf8");
    await writeFile(join(this.rootDir, "ROADMAP.md"), this.renderRoadmapMarkdown(), "utf8");
  }

  private renderRoadmapMarkdown(): string {
    const stageRows = STAGE_ORDER.map((st) => {
      const status = this.state.completedStages.includes(st)
        ? "✅ COMPLETED"
        : st === this.state.currentStage
        ? `🔄 ACTIVE (${this.state.phase})`
        : "⏳ PENDING";
      return `| **${st}** | ${status} |`;
    });

    const stepRows = Object.values(this.state.stepHistories).map(
      (h) =>
        `| \`${h.stepId}\` | ${h.title} | ${h.status} | ${h.attempts} | ${h.replans} | ${
          h.lastAuditVerdict ?? "-"
        } | ${h.lastCriticVerdict ?? "-"} |`
    );

    return [
      `# ${this.state.projectName} — Software Factory Roadmap`,
      "",
      `- **Active Stage:** \`${this.state.currentStage}\``,
      `- **Current Phase:** \`${this.state.phase}\``,
      `- **Updated At:** \`${this.state.updatedAt}\``,
      "",
      "## Macro Stages (`POC → MVP → V1 → V2 → Vx`)",
      "",
      "| Stage | Status |",
      "| :--- | :--- |",
      ...stageRows,
      "",
      `## Active Stage (\`${this.state.currentStage}\`) Steps`,
      "",
      "| Step ID | Title | Status | Attempts | Replans | Auditor | Critic |",
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
      ...(stepRows.length > 0 ? stepRows : ["| - | No steps planned yet | - | 0 | 0 | - | - |"]),
      "",
    ].join("\n");
  }
}

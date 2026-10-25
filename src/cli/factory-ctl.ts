#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  StageNameSchema,
  AnalysisArtifactSchema,
  ResearchArtifactSchema,
  PlanArtifactSchema,
  ExecuteArtifactSchema,
  AuditArtifactSchema,
  CriticArtifactSchema,
} from "../types/schema.js";
import { AGENT_PERSONAS, buildSubagentDispatchPrompt, type AgentId } from "../agents/personas.js";
import { FactoryStateMachine } from "../core/state-machine.js";
import { runVerificationGate } from "../core/runner.js";
import { GitHubSync } from "../core/github-sync.js";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

export async function runCli(
  argv: string[],
  rootDir: string = process.cwd()
): Promise<{ exitCode: number; stdout: string }> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const liveGh = flags["live-gh"] === "true";
  const ghSync = new GitHubSync(rootDir, liveGh);

  try {
    switch (command) {
      case "init": {
        const name = flags.name ?? "SoftwareFactoryApp";
        const stage = StageNameSchema.parse(flags.stage ?? "POC");
        const sm = await FactoryStateMachine.init(rootDir, name, stage);
        return {
          exitCode: 0,
          stdout: JSON.stringify(sm.getState(), null, 2),
        };
      }

      case "status": {
        const sm = await FactoryStateMachine.load(rootDir);
        return {
          exitCode: 0,
          stdout: JSON.stringify(sm.getState(), null, 2),
        };
      }

      case "personas": {
        return {
          exitCode: 0,
          stdout: JSON.stringify(AGENT_PERSONAS, null, 2),
        };
      }

      case "dispatch-prompt": {
        const sm = await FactoryStateMachine.load(rootDir);
        const state = sm.getState();
        const agentId = flags.agent as AgentId;
        if (!agentId || !(agentId in AGENT_PERSONAS)) {
          throw new Error(`Invalid --agent flag: ${agentId}`);
        }
        const inputs = flags.inputs ? flags.inputs.split(",") : [];
        const output =
          flags.output ??
          `.factory/runs/${state.currentStage}/${AGENT_PERSONAS[agentId].outputFileName}`;
        const prompt = buildSubagentDispatchPrompt(agentId, {
          stage: state.currentStage,
          stepId: flags.step,
          attempt: state.currentStepAttempt,
          inputArtifactPaths: inputs,
          outputArtifactPath: output,
          extraInstructions: flags.extra,
        });
        return { exitCode: 0, stdout: prompt };
      }

      case "record-analysis": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = AnalysisArtifactSchema.parse(JSON.parse(raw));
        await sm.recordAnalysis(artifact);
        return { exitCode: 0, stdout: JSON.stringify(sm.getState(), null, 2) };
      }

      case "record-research": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = ResearchArtifactSchema.parse(JSON.parse(raw));
        await sm.recordResearch(artifact);
        return { exitCode: 0, stdout: JSON.stringify(sm.getState(), null, 2) };
      }

      case "record-plan": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = PlanArtifactSchema.parse(JSON.parse(raw));
        await sm.recordPlan(artifact);
        const syncRes = await ghSync.syncStagePlan(artifact);
        return {
          exitCode: 0,
          stdout: JSON.stringify({ state: sm.getState(), githubSync: syncRes }, null, 2),
        };
      }

      case "lock-oracle": {
        if (!flags.step) throw new Error("Missing --step");
        const sm = await FactoryStateMachine.load(rootDir);
        const manifest = await sm.lockStepOracle(flags.step);
        return {
          exitCode: 0,
          stdout: JSON.stringify(manifest, null, 2),
        };
      }

      case "record-execute": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = ExecuteArtifactSchema.parse(JSON.parse(raw));
        await sm.recordExecuteAttempt(artifact);
        return { exitCode: 0, stdout: JSON.stringify(sm.getState(), null, 2) };
      }

      case "verify-step": {
        if (!flags.step) throw new Error("Missing --step");
        const sm = await FactoryStateMachine.load(rootDir);
        const plan = await sm.loadActivePlan();
        const step = plan.steps.find((s) => s.stepId === flags.step);
        if (!step) throw new Error(`Step not found in plan: ${flags.step}`);
        const oracleLock = await sm.loadStepOracleLock(flags.step);
        const gateResult = await runVerificationGate({
          rootDir,
          oracleSpec: step.oracleSpec,
          oracleLock,
          modifiedFiles: step.filesToCreateOrModify,
        });
        return {
          exitCode: gateResult.allPassed ? 0 : 2,
          stdout: JSON.stringify(gateResult, null, 2),
        };
      }

      case "record-audit": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = AuditArtifactSchema.parse(JSON.parse(raw));
        const res = await sm.recordAuditVerdict(artifact);
        await ghSync.postStepComment(
          artifact.stepId,
          `Auditor Verdict (Attempt ${artifact.attempt}): ${res.status}`,
          artifact.failureReasons.length > 0
            ? `**Failures:**\n${artifact.failureReasons.map((r) => `- ${r}`).join("\n")}\n\n**Remediation:** ${artifact.remediationInstructionsForExecute}`
            : "All 5 deterministic checks and semantic anti-fake audit passed."
        );
        return {
          exitCode: 0,
          stdout: JSON.stringify({ transition: res, state: sm.getState() }, null, 2),
        };
      }

      case "record-critic": {
        if (!flags.file) throw new Error("Missing --file");
        const sm = await FactoryStateMachine.load(rootDir);
        const raw = await readFile(resolve(rootDir, flags.file), "utf8");
        const artifact = CriticArtifactSchema.parse(JSON.parse(raw));
        const res = await sm.recordCriticVerdict(artifact);
        if (artifact.verdict === "APPROVED") {
          await ghSync.closeStepIssue(
            artifact.stepId,
            `Critic APPROVED step \`${artifact.stepId}\` (Arch: ${artifact.scores.architecturalIntegrity}/10, Sec: ${artifact.scores.security}/10).`
          );
        } else {
          await ghSync.postStepComment(
            artifact.stepId,
            `Critic Rejected Step -> Routing to Plan`,
            artifact.replanInstructions
          );
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({ transition: res, state: sm.getState() }, null, 2),
        };
      }

      case "approve-stage": {
        const sm = await FactoryStateMachine.load(rootDir);
        const completedStage = sm.getState().currentStage;
        const res = await sm.approveStageAndAdvance();
        await ghSync.createStageSummaryReport(
          completedStage,
          `# Stage ${completedStage} Approved\nAdvanced to: ${res.nextStage}\n`
        );
        return {
          exitCode: 0,
          stdout: JSON.stringify({ ...res, state: sm.getState() }, null, 2),
        };
      }

      default:
        return {
          exitCode: 1,
          stdout: JSON.stringify({
            error: `Unknown command: ${command ?? "none"}`,
            availableCommands: [
              "init",
              "status",
              "personas",
              "dispatch-prompt",
              "record-analysis",
              "record-research",
              "record-plan",
              "lock-oracle",
              "record-execute",
              "verify-step",
              "record-audit",
              "record-critic",
              "approve-stage",
            ],
          }),
        };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: JSON.stringify({ error: message }, null, 2),
    };
  }
}

const isMain =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2)).then(({ exitCode, stdout }) => {
    console.log(stdout);
    process.exit(exitCode);
  });
}

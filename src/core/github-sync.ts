import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlanArtifact, StageName } from "../types/schema.js";

export interface MirroredIssue {
  issueNumber: number;
  stepId: string;
  stage: StageName;
  title: string;
  body: string;
  status: "OPEN" | "CLOSED";
  comments: Array<{ timestamp: string; heading: string; body: string }>;
}

export interface MirrorStore {
  milestones: Record<string, { title: string; stage: StageName; createdAt: string }>;
  issues: Record<string, MirroredIssue>;
  stageReports: Record<string, string>;
}

function execGh(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, timeout: 10000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: (stdout ?? "").trim() });
    });
  });
}

export class GitHubSync {
  private readonly rootDir: string;
  private readonly liveGh: boolean;

  public constructor(rootDir: string, liveGh = false) {
    this.rootDir = rootDir;
    this.liveGh = liveGh;
  }

  private mirrorPath(): string {
    return join(this.rootDir, ".factory", "github-mirror", "issues.json");
  }

  private async loadMirror(): Promise<MirrorStore> {
    try {
      const raw = await readFile(this.mirrorPath(), "utf8");
      return JSON.parse(raw) as MirrorStore;
    } catch {
      return { milestones: {}, issues: {}, stageReports: {} };
    }
  }

  private async saveMirror(store: MirrorStore): Promise<void> {
    const dir = join(this.rootDir, ".factory", "github-mirror");
    await mkdir(dir, { recursive: true });
    await writeFile(this.mirrorPath(), JSON.stringify(store, null, 2), "utf8");
  }

  public async syncStagePlan(plan: PlanArtifact): Promise<{
    mode: "gh-live" | "local-mirror";
    milestoneTitle: string;
    issueMap: Record<string, number>;
  }> {
    const store = await this.loadMirror();
    const milestoneTitle = `Stage: ${plan.stage}`;
    store.milestones[plan.stage] = {
      title: milestoneTitle,
      stage: plan.stage,
      createdAt: new Date().toISOString(),
    };

    const issueMap: Record<string, number> = {};
    let mode: "gh-live" | "local-mirror" = "local-mirror";

    for (const step of plan.steps) {
      const existing = store.issues[step.stepId];
      const nextNum = existing?.issueNumber ?? Object.keys(store.issues).length + 1;
      const body = [
        `### Stage: \`${plan.stage}\` — Step \`${step.stepId}\``,
        step.description,
        "",
        "#### Files to Create/Modify",
        ...step.filesToCreateOrModify.map((f) => `- \`${f}\``),
        "",
        "#### Acceptance Criteria",
        ...step.acceptanceCriteria.map((c) => `- [ ] ${c}`),
        "",
        "#### Locked Verification Oracle",
        `- **Locked Tests:** ${step.oracleSpec.lockedTestFiles.map((f) => `\`${f}\``).join(", ")}`,
        `- **Test Command:** \`${step.oracleSpec.testCommand}\``,
        `- **Smoke Command:** \`${step.oracleSpec.runtimeSmokeCommand}\``,
      ].join("\n");

      let issueNumber = nextNum;
      if (this.liveGh && !existing) {
        const ghRes = await execGh(
          [
            "issue",
            "create",
            "--title",
            `[${plan.stage}] ${step.stepId}: ${step.title}`,
            "--body",
            body,
          ],
          this.rootDir
        );
        if (ghRes.ok) {
          mode = "gh-live";
          const match = ghRes.stdout.match(/\/issues\/(\d+)/);
          if (match) {
            issueNumber = Number(match[1]);
          }
        }
      }

      store.issues[step.stepId] = {
        issueNumber,
        stepId: step.stepId,
        stage: plan.stage,
        title: `[${plan.stage}] ${step.stepId}: ${step.title}`,
        body,
        status: existing?.status === "CLOSED" ? "CLOSED" : "OPEN",
        comments: existing?.comments ?? [],
      };
      issueMap[step.stepId] = issueNumber;
    }

    await this.saveMirror(store);
    return { mode, milestoneTitle, issueMap };
  }

  public async postStepComment(
    stepId: string,
    heading: string,
    markdownBody: string
  ): Promise<void> {
    const store = await this.loadMirror();
    const issue = store.issues[stepId];
    const commentText = `### ${heading}\n\n${markdownBody}`;
    if (issue) {
      issue.comments.push({
        timestamp: new Date().toISOString(),
        heading,
        body: markdownBody,
      });
      await this.saveMirror(store);
      if (this.liveGh) {
        await execGh(
          ["issue", "comment", String(issue.issueNumber), "--body", commentText],
          this.rootDir
        );
      }
    }
  }

  public async closeStepIssue(stepId: string, summary: string): Promise<void> {
    const store = await this.loadMirror();
    const issue = store.issues[stepId];
    if (issue) {
      issue.status = "CLOSED";
      issue.comments.push({
        timestamp: new Date().toISOString(),
        heading: "Step Approved by Auditor & Critic",
        body: summary,
      });
      await this.saveMirror(store);
      if (this.liveGh) {
        await execGh(
          ["issue", "close", String(issue.issueNumber), "--comment", summary],
          this.rootDir
        );
      }
    }
  }

  public async createStageSummaryReport(
    stage: StageName,
    summaryMarkdown: string
  ): Promise<string> {
    const store = await this.loadMirror();
    store.stageReports[stage] = summaryMarkdown;
    await this.saveMirror(store);

    const reportPath = join(this.rootDir, ".factory", "github-mirror", `stage-${stage}-pr.md`);
    await writeFile(reportPath, summaryMarkdown, "utf8");
    return reportPath;
  }
}

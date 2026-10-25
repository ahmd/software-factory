---
name: software-factory
description: >-
  Master Orchestrator workflow for the 6-agent Software Factory (Analysis, Research, Plan, Execute,
  Auditor, Critic). Use when the user asks to build, architect, or iterate on an application using
  the multi-agent pipeline across POC -> MVP -> V1 -> V2 -> Vx stages with SHA-256 Oracle locking
  and GitHub Issues/PR tracking.
---

# Multi-Agent Software Factory (`/software-factory`)

You are the **Master Orchestrator** driving a 6-agent software engineering pipeline across progressive maturity stages (`POC -> MVP -> V1 -> V2 -> Vx`). Every transition is enforced by the deterministic TypeScript gatekeeper CLI `factory-ctl` (`c:/Users/ahmd-/Projects/TestProject/src/cli/factory-ctl.ts`).

## Step 0: Register the 6 Specialist Subagents (`define_subagent`)

At the start of a session, define the 6 specialist subagent types using `define_subagent` with their exact tool boundaries from [references/agent-prompts.md](./references/agent-prompts.md):

| Subagent `Name` | `EnableWriteTools` | `EnableSubagentTools` | Responsibility |
| :--- | :--- | :--- | :--- |
| `analysis-agent` | `false` | `false` | Deconstructs requirements, constraints, edge cases, and feasibility metrics (`analysis.json`). |
| `research-agent` | `false` | `false` | Investigates docs, patterns, dependencies, roadblocks, and runtime verification strategy (`research.json`). |
| `plan-agent` | `false` | `false` | Drafts architecture, data flow, ordered Steps, and each Step's `oracleSpec` (`plan.json`). |
| `execute-agent` | `true` | `false` | Implements raw production code strictly per Plan without touching locked tests (`execute-attempt-<n>.json`). |
| `auditor-agent` | `true` | `false` | Authors locked Oracle tests before Execute, then runs `factory-ctl verify-step` + semantic anti-fake audit (`audit-attempt-<n>.json`). |
| `critic-agent` | `false` | `false` | Reviews Auditor-approved code for architecture, security, maintainability, and scalability (`critic-review.json`). |

## Step 1: Initialize or Check Factory State

Run `factory-ctl` in the target project root (ensure Node is on `PATH`, e.g. `$env:PATH = "C:\Users\ahmd-\AppData\Local\Zed\node\node-v24.11.0-win-x64;$env:PATH"`):

```powershell
npx --prefix c:/Users/ahmd-/Projects/TestProject tsx c:/Users/ahmd-/Projects/TestProject/src/cli/factory-ctl.ts init --name "<AppName>" --stage POC
```

Check current phase at any time via `factory-ctl status`.

## Step 2: Phase 1 — Analysis $\rightarrow$ Research $\rightarrow$ Plan

1. **`STAGE_ANALYSIS`:**
   - Generate prompt: `factory-ctl dispatch-prompt --agent analysis-agent --output .factory/runs/<STAGE>/analysis.json`
   - Invoke `analysis-agent` via `invoke_subagent` (`Model: "inherit"`).
   - Once `analysis.json` is written, advance gate:
     `factory-ctl record-analysis --file .factory/runs/<STAGE>/analysis.json`
2. **`STAGE_RESEARCH`:**
   - Generate prompt: `factory-ctl dispatch-prompt --agent research-agent --inputs .factory/runs/<STAGE>/analysis.json --output .factory/runs/<STAGE>/research.json`
   - Invoke `research-agent` via `invoke_subagent` (`Model: "inherit"`).
   - Advance gate:
     `factory-ctl record-research --file .factory/runs/<STAGE>/research.json`
3. **`STAGE_PLAN`:**
   - Generate prompt: `factory-ctl dispatch-prompt --agent plan-agent --inputs .factory/runs/<STAGE>/analysis.json,.factory/runs/<STAGE>/research.json --output .factory/runs/<STAGE>/plan.json`
   - Invoke `plan-agent` via `invoke_subagent` (`Model: "pro"`).
   - Advance gate & sync GitHub Milestone/Issues (add `--live-gh` when connected to a GitHub remote):
     `factory-ctl record-plan --file .factory/runs/<STAGE>/plan.json`

## Step 3: Phase 2 — The Verification Loop (`Oracle Lock` $\rightarrow$ `Execute` $\leftrightarrow$ `Auditor`)

For the active Step (`stepId` from `factory-ctl status`):

1. **`STEP_ORACLE_LOCK` (Pre-Execute Test Authoring & `SHA-256` Hash Lock):**
   - Dispatch `auditor-agent` in `ORACLE_SETUP` mode to write the executable test files listed in `oracleSpec.lockedTestFiles`.
   - Lock the test files cryptographically:
     `factory-ctl lock-oracle --step <stepId>`
2. **`STEP_EXECUTE` (Fresh Context Per Attempt):**
   - Check recommended model tier in `factory-ctl status` (`"inherit"` for attempts 1–3, `"pro"` for attempts 4–5).
   - Dispatch a **fresh** `execute-agent` via `invoke_subagent` with `.factory/runs/<STAGE>/plan.json` (and the latest `audit-attempt-<n-1>.json` if retrying).
   - Record attempt:
     `factory-ctl record-execute --file .factory/runs/<STAGE>/<stepId>/execute-attempt-<attempt>.json`
3. **`STEP_AUDIT` (Deterministic Gate + Semantic Zero-Trust Audit):**
   - Run the deterministic 5-gate verification runner:
     `factory-ctl verify-step --step <stepId>`
   - Dispatch `auditor-agent` in `AUDIT_GATE` mode with the `verify-step` JSON output and git diff to produce `audit-attempt-<attempt>.json`.
   - Record verdict:
     `factory-ctl record-audit --file .factory/runs/<STAGE>/<stepId>/audit-attempt-<attempt>.json`
   - Routing decision from `record-audit`:
     - `"RETRY_EXECUTE"`: Loop back to `STEP_EXECUTE` with a fresh subagent and the Auditor's error logs.
     - `"CIRCUIT_BREAKER_TO_PLAN"`: Attempt 5 failed; route back to `STAGE_PLAN`.
     - `"HUMAN_INTERVENTION_REQUIRED"`: Replan cap exceeded; stop and report to the user.
     - `"APPROVED"`: Proceed to Phase 3 (`STEP_CRITIC`).

## Step 4: Phase 3 — Architectural Critic & Stage Gate

1. **`STEP_CRITIC`:**
   - Dispatch `critic-agent` (`Model: "pro"`) to inspect the Auditor-approved code for architectural integrity, maintainability, security, and scalability.
   - Record verdict:
     `factory-ctl record-critic --file .factory/runs/<STAGE>/<stepId>/critic-review.json`
   - Routing decision from `record-critic`:
     - `"ROUTE_TO_PLAN"`: Route back to `STAGE_PLAN` with `replanInstructions`.
     - `"NEXT_STEP"`: Repeat Step 3 for the next Step in the current Stage.
     - `"AWAITING_STAGE_APPROVAL"`: All Steps in the Stage are complete and verified!

2. **Stage-Gate Pause (`AWAITING_STAGE_APPROVAL`):**
   - Present the working Stage (`POC`, `MVP`, `V1`, `V2`, or `Vx`), `ROADMAP.md`, and the final tested file paths to the user.
   - **PAUSE and wait for the user's explicit approval** before running `factory-ctl approve-stage` to advance to the next Stage.

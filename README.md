# Multi-Agent Software Factory (`POC → MVP → V1 → V2 → Vx`)

[![CI](https://github.com/ahmd/software-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmd/software-factory/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![Zero-Trust Oracle](https://img.shields.io/badge/Verification-SHA--256%20Oracle-10b981)
![Architecture](https://img.shields.io/badge/Agents-6--Agent%20Pipeline-6366f1)

A strict 6-agent software engineering system and deterministic verification gatekeeper (`factory-ctl`) inspired by the *Call of Duty: Modern Warfare 2* (`momo5502`) autonomous rebuild workflow.

- [Installation](#installation)
  - [Antigravity](#antigravity)
  - [Manual / Git Clone](#manual--git-clone)
- [Architecture](#architecture)
- [CLI Usage (`factory-ctl`)](#cli-usage-factory-ctl)
- [Running Tests](#running-tests)

---

## Installation

### Antigravity

Install **Software Factory** as a plugin directly from this repository:

```bash
agy plugin install https://github.com/ahmd/software-factory
```

Antigravity automatically discovers and loads:
- **Skill:** `/software-factory` ([`skills/software-factory/SKILL.md`](./skills/software-factory/SKILL.md))
- **6 Specialist Subagents:** `analysis-agent`, `research-agent`, `plan-agent`, `execute-agent`, `auditor-agent`, `critic-agent` ([`agents/`](./agents))
- **Always-On Rules:** MW2 Zero-Trust Verification Standard ([`rules/AGENTS.md`](./rules/AGENTS.md))

Reinstall with the same command at any time to update.

### Manual / Git Clone

```bash
git clone https://github.com/ahmd/software-factory.git ~/.gemini/config/plugins/software-factory
cd ~/.gemini/config/plugins/software-factory && npm install
```

---

## Architecture

1. **Macro Stage-Gates (`POC → MVP → V1 → V2 → Vx`):**
   Every build progresses through ordered maturity stages (`POC`, `MVP`, `V1`, `V2`, `Vx`). Within a stage, all steps run autonomously; at the end of each working stage (`AWAITING_STAGE_APPROVAL`), the pipeline updates `ROADMAP.md` and pauses for human review.

2. **The 6 Specialist Agents ([`src/agents/personas.ts`](./src/agents/personas.ts)):**
   - **`analysis-agent`** *(Read-Only)*: Deconstructs requirements into core technical constraints, edge cases, and feasibility metrics (`analysis.json`).
   - **`research-agent`** *(Read-Only + Web)*: Investigates docs, patterns, dependencies, roadblocks, and headless runtime verification strategy (`research.json`).
   - **`plan-agent`** *(Read-Only)*: Drafts architecture, Mermaid data-flow diagrams, and atomic Steps with a locked Verification Oracle spec (`plan.json`).
   - **`execute-agent`** *(Write/Terminal)*: Writes raw production code strictly per the Plan without touching locked test files (`execute-attempt-<n>.json`).
   - **`auditor-agent`** *(Write/Terminal — Zero-Trust Gatekeeper)*:
     - **`ORACLE_SETUP` Mode (Before Execute):** Writes executable acceptance tests and locks them with `SHA-256` via `factory-ctl lock-oracle`.
     - **`AUDIT_GATE` Mode (After Execute):** Runs `factory-ctl verify-step` (SHA-256 lock check, static anti-cheat scan, test execution, linter, and timed runtime smoke benchmark) + semantic anti-fake inspection (`audit-attempt-<n>.json`).
   - **`critic-agent`** *(Read-Only)*: Reviews Auditor-approved code for architectural integrity, maintainability, security, and scalability (`critic-review.json`).

---

## CLI Usage (`factory-ctl`)

```bash
# Initialize a project at POC stage
npx tsx src/cli/factory-ctl.ts init --name "MyApp" --stage POC

# Inspect current state and phase
npx tsx src/cli/factory-ctl.ts status

# Record Phase 1 artifacts (Analysis -> Research -> Plan + GitHub Issue sync)
npx tsx src/cli/factory-ctl.ts record-analysis --file .factory/runs/POC/analysis.json
npx tsx src/cli/factory-ctl.ts record-research --file .factory/runs/POC/research.json
npx tsx src/cli/factory-ctl.ts record-plan --file .factory/runs/POC/plan.json --live-gh

# Phase 2 Loop (SHA-256 Oracle Lock -> Execute <-> Auditor)
npx tsx src/cli/factory-ctl.ts lock-oracle --step step-1
npx tsx src/cli/factory-ctl.ts record-execute --file .factory/runs/POC/step-1/execute-attempt-1.json
npx tsx src/cli/factory-ctl.ts verify-step --step step-1
npx tsx src/cli/factory-ctl.ts record-audit --file .factory/runs/POC/step-1/audit-attempt-1.json

# Phase 3 Critic & Stage Gate Approval
npx tsx src/cli/factory-ctl.ts record-critic --file .factory/runs/POC/step-1/critic-review.json
npx tsx src/cli/factory-ctl.ts approve-stage
```

## Running Tests

```bash
npm test
```

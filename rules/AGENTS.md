# Software Factory Rules (MW2 Zero-Trust Verification Standard)

When operating in a Software Factory workflow (`POC -> MVP -> V1 -> V2 -> Vx`), all orchestrator and subagent actions are bound by these non-negotiable engineering laws:

## 1. Macro Stage-Gate Progression (`POC -> MVP -> V1 -> V2 -> Vx`)
- Every software build progresses through ordered maturity Stages: `POC`, `MVP`, `V1`, `V2`, `Vx`.
- Within an active Stage, execute all planned Steps autonomously through the 6-agent pipeline (`Analysis -> Research -> Plan -> [Oracle Lock -> Execute <-> Auditor] -> Critic`).
- At the end of each Stage (`phase === "AWAITING_STAGE_APPROVAL"`), update `ROADMAP.md` and the GitHub Milestone/Stage report, and **STOP for human review and sign-off** before advancing to the next Stage.

## 2. Cryptographic Verification Oracle (`SHA-256` Lock)
- Before the `Execute Agent` writes any production code for a Step, the `Auditor Agent` (in `ORACLE_SETUP` mode) writes the executable test files (`lockedTestFiles`), and `factory-ctl lock-oracle` hashes them using `SHA-256`.
- The `Execute Agent` is strictly forbidden from creating, modifying, renaming, or deleting any file in `lockedTestFiles`, linter configs, test runner scripts, or `.factory/`. Any hash mismatch triggers an automatic `TAMPERING_DETECTED` rejection.

## 3. Zero-Tolerance Anti-Cheat Policy
- Production code modified by `Execute` is scanned deterministically by `factory-ctl verify-step`.
- The following shortcuts are strictly banned in production files:
  - Type or linter suppressions: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`
  - Unfinished markers: `TODO`, `FIXME`, `HACK`
  - Test manipulation: `.skip(`, `.only(`, `.todo(`
  - Swallowed errors: empty `catch {}` blocks
  - Low-level bypasses: inline assembly (`__asm`) or hardcoded test-input branching (`if (input === 'test_case') return expected`)
- Tests must actually run (`> 0` passed tests) AND the live runtime smoke command (`runtimeSmokeCommand`) must execute with exit code `0` within `maxExecutionMs`.

## 4. Fresh Context & Circuit Breakers
- Never reuse a bloated coding agent context across multiple failed attempts. Dispatch a fresh subagent per Step and per retry (`invoke_subagent`), passing only file paths to the Step brief, locked tests, and latest Auditor remediation report.
- Respect `factory-ctl` circuit breakers: max `5` `Execute <-> Auditor` attempts per Step (escalating to `Model: "pro"` on attempts 4–5) and max `2` architectural re-plans (`Critic -> Plan` or circuit breaker -> `Plan`) before pausing at `HUMAN_INTERVENTION_REQUIRED`.

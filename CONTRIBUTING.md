# Contributing to Software Factory

Thank you for your interest in contributing to **Software Factory**!

## Development Setup

`ash
git clone https://github.com/ahmd/software-factory.git
cd software-factory
npm install
`

## Running Verification & Tests

Before opening a pull request, ensure all unit and integration tests pass:

`ash
npm test
`

## Engineering Standards

1. **Zero-Trust Compliance:** Do not use @ts-ignore, @ts-expect-error, eslint-disable, or TODO/FIXME placeholders in production source files under src/.
2. **Deterministic Tests:** Every new CLI command or state transition must include corresponding Vitest coverage in 	ests/.
3. **Schema Validation:** All agent artifacts (nalysis.json, esearch.json, plan.json, execute-attempt-n.json, udit-attempt-n.json, critic-review.json) must validate against src/types/schemas.ts.
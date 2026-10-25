# Security Policy

## Cryptographic Verification Integrity

Software Factory enforces strict separation between test authoring (Auditor Agent in ORACLE_SETUP mode) and implementation (Execute Agent):

- **SHA-256 Oracle Locking:** All verification test files are hashed and locked in .factory/state.json prior to code execution.
- **Anti-Tampering Gate:** Any unauthorized modification to locked test files, linter configs, or .factory/ state triggers an immediate TAMPERING_DETECTED failure.
- **Static Anti-Cheat Scan:** Production diffs are scanned for linter/type suppressions (@ts-ignore, @ts-expect-error, eslint-disable), skipped tests, and empty catch blocks.

## Reporting a Vulnerability

If you discover a bypass in the verification gatekeeper (src/core/verifier.ts) or anti-cheat scanner (src/core/anti-cheat.ts), please open a security advisory on GitHub or contact @ahmd.
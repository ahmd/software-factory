import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

export interface OracleLockManifest {
  stepId: string;
  createdAt: string;
  files: Record<string, string>;
}

export interface OracleVerificationResult {
  valid: boolean;
  tamperedFiles: string[];
  missingFiles: string[];
}

export function resolveSafeWorkspacePath(rootDir: string, relativePath: string): string {
  const normalizedRoot = resolve(rootDir);
  const resolvedTarget = resolve(normalizedRoot, relativePath);
  const rel = relative(normalizedRoot, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return resolvedTarget;
}

function computeSha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function createOracleLock(
  rootDir: string,
  stepId: string,
  relativeFiles: string[]
): Promise<OracleLockManifest> {
  const files: Record<string, string> = {};
  for (const relPath of relativeFiles) {
    const absPath = resolveSafeWorkspacePath(rootDir, relPath);
    const buffer = await readFile(absPath);
    files[relPath] = computeSha256(buffer);
  }
  return {
    stepId,
    createdAt: new Date().toISOString(),
    files,
  };
}

export async function verifyOracleLock(
  rootDir: string,
  manifest: OracleLockManifest
): Promise<OracleVerificationResult> {
  const tamperedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const absPath = resolveSafeWorkspacePath(rootDir, relPath);
    try {
      const buffer = await readFile(absPath);
      const actualHash = computeSha256(buffer);
      if (actualHash !== expectedHash) {
        tamperedFiles.push(relPath);
      }
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "ENOENT"
      ) {
        missingFiles.push(relPath);
      } else {
        throw err;
      }
    }
  }

  return {
    valid: tamperedFiles.length === 0 && missingFiles.length === 0,
    tamperedFiles,
    missingFiles,
  };
}

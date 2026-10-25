import { readFile } from "node:fs/promises";
import { resolveSafeWorkspacePath } from "./oracle-lock.js";

export interface AntiCheatViolation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

export interface AntiCheatReport {
  clean: boolean;
  violations: AntiCheatViolation[];
}

interface CheatPattern {
  rule: string;
  regex: RegExp;
}

const LINE_CHEAT_PATTERNS: CheatPattern[] = [
  { rule: "NO_TS_IGNORE", regex: /@ts-ignore\b/ },
  { rule: "NO_TS_EXPECT_ERROR", regex: /@ts-expect-error\b/ },
  { rule: "NO_ESLINT_DISABLE", regex: /eslint-disable(?:-next-line|-line)?\b/ },
  { rule: "NO_UNFINISHED_MARKERS", regex: /\b(?:TODO|FIXME|HACK)\b/ },
  { rule: "NO_SKIPPED_OR_FOCUSED_TESTS", regex: /\.(?:skip|only|todo)\s*\(/ },
  { rule: "NO_INLINE_ASM", regex: /\b__asm\b/ },
];

const EMPTY_CATCH_REGEX = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

export async function scanFilesForCheats(
  rootDir: string,
  relativeFiles: string[]
): Promise<AntiCheatReport> {
  const violations: AntiCheatViolation[] = [];

  for (const relPath of relativeFiles) {
    const absPath = resolveSafeWorkspacePath(rootDir, relPath);
    const content = await readFile(absPath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((lineText, idx) => {
      for (const pattern of LINE_CHEAT_PATTERNS) {
        if (pattern.regex.test(lineText)) {
          violations.push({
            file: relPath,
            line: idx + 1,
            rule: pattern.rule,
            snippet: lineText.trim(),
          });
        }
      }
    });

    let match: RegExpExecArray | null;
    EMPTY_CATCH_REGEX.lastIndex = 0;
    while ((match = EMPTY_CATCH_REGEX.exec(content)) !== null) {
      const prefix = content.slice(0, match.index);
      const lineNumber = prefix.split(/\r?\n/).length;
      violations.push({
        file: relPath,
        line: lineNumber,
        rule: "NO_EMPTY_CATCH",
        snippet: match[0].replace(/\s+/g, " ").trim(),
      });
    }
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}

import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

describe("Antigravity Plugin and Workspace Customizations", () => {
  const globalPluginDir = join(homedir(), ".gemini", "config", "plugins", "software-factory");
  const workspaceAgentsDir = join(process.cwd(), ".agents");

  it("validates global plugin.json schema and allowed top-level keys", async () => {
    const raw = await readFile(join(globalPluginDir, "plugin.json"), "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("software-factory");
    expect(manifest.description).toBeTruthy();
    expect(manifest.suggestedPrompts?.length).toBe(3);
    const allowed = new Set([
      "name",
      "displayName",
      "description",
      "version",
      "logo",
      "suggestedPrompts",
      "disabled",
    ]);
    for (const key of Object.keys(manifest)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("validates AGENTS.md rule size limit (< 24KB, no YAML frontmatter) and SKILL.md frontmatter", async () => {
    for (const rulesPath of [
      join(globalPluginDir, "rules", "AGENTS.md"),
      join(workspaceAgentsDir, "rules", "AGENTS.md"),
    ]) {
      const content = await readFile(rulesPath, "utf8");
      const info = await stat(rulesPath);
      expect(info.size).toBeLessThan(24000);
      expect(content.startsWith("---")).toBe(false);
      expect(content).toContain("POC");
      expect(content).toContain("SHA-256");
    }

    for (const skillPath of [
      join(globalPluginDir, "skills", "software-factory", "SKILL.md"),
      join(workspaceAgentsDir, "skills", "software-factory", "SKILL.md"),
    ]) {
      const skillContent = await readFile(skillPath, "utf8");
      expect(skillContent.startsWith("---")).toBe(true);
      expect(skillContent).toContain("name: software-factory");
      expect(skillContent).toContain("define_subagent");
      expect(skillContent).toContain("invoke_subagent");
      expect(skillContent).toContain("factory-ctl");
    }
  });
});

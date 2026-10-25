import { describe, it, expect } from "vitest";
import { readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

async function resolvePluginDir(): Promise<string> {
  const globalDir = join(homedir(), ".gemini", "config", "plugins", "software-factory");
  try {
    await access(join(globalDir, "plugin.json"));
    return globalDir;
  } catch {
    return process.cwd();
  }
}

describe("Antigravity Plugin and Workspace Customizations", () => {
  const workspaceAgentsDir = join(process.cwd(), ".agents");

  it("validates plugin.json schema and allowed top-level keys", async () => {
    const pluginDir = await resolvePluginDir();
    const raw = await readFile(join(pluginDir, "plugin.json"), "utf8");
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
    const rulesPath = join(workspaceAgentsDir, "rules", "AGENTS.md");
    const content = await readFile(rulesPath, "utf8");
    const info = await stat(rulesPath);
    expect(info.size).toBeLessThan(24000);
    expect(content.startsWith("---")).toBe(false);
    expect(content).toContain("POC");
    expect(content).toContain("SHA-256");

    const skillPath = join(workspaceAgentsDir, "skills", "software-factory", "SKILL.md");
    const skillContent = await readFile(skillPath, "utf8");
    expect(skillContent.startsWith("---")).toBe(true);
    expect(skillContent).toContain("name: software-factory");
    expect(skillContent).toContain("define_subagent");
    expect(skillContent).toContain("invoke_subagent");
    expect(skillContent).toContain("factory-ctl");
  });
});

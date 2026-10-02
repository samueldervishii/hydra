// Every workflow in .github/workflows, read off disk so a new file is covered
// without touching this test. GitHub refuses unpinned actions in this
// repository, and the rest keeps forks and pull requests away from secrets.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..", ".github", "workflows");
const workflows = readdirSync(dir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));

/** The script lines of every run: step, block or inline. */
function runScripts(text: string): string[] {
  const scripts: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(?:- )?run: ?(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (match[2] !== "|" && match[2] !== ">") {
      scripts.push(match[2]);
      continue;
    }
    const indent = match[1].length;
    for (i++; i < lines.length && (lines[i].trim() === "" || /^\s*/.exec(lines[i])![0].length > indent); i++) {
      scripts.push(lines[i]);
    }
    i--;
  }
  return scripts;
}

describe("GitHub workflows", () => {
  it("are found", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)("$file pins every action to a full commit SHA with its version", ({ text }) => {
    const uses = [...text.matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((m) => m[1].trim());
    for (const action of uses) {
      if (action.startsWith("./")) continue;
      expect(action, action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/);
    }
  });

  it.each(workflows)("$file never runs pull request code with secrets", ({ text }) => {
    expect(text).not.toContain("pull_request_target");
    expect(text).not.toMatch(/workflow_run/);
  });

  it.each(workflows)("$file sets read-only permissions at the top", ({ text }) => {
    const top = text.slice(0, text.indexOf("\njobs:"));
    expect(top).toMatch(/^permissions:\n  contents: read\n/m);
  });

  // ${{ }} in a run: script is pasted into the shell before it runs, so a PR
  // title or branch name there is code. Values reach scripts through env:.
  it.each(workflows)("$file keeps expressions out of run: scripts", ({ text }) => {
    const scripts = runScripts(text);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((line) => line.includes("${{"))).toEqual([]);
  });
});

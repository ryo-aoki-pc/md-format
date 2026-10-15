import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { builtinRuleNames, fixCategories, formatMarkdown } from "../format.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { lint } = await import(pathToFileURL(runtimeRequire.resolve("markdownlint/promise")));

test("project custom fixes cannot change include targets while safe prose fixes continue", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-custom-rule-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const rulePath = path.join(cwd, "include-rule.cjs");
  // 通常ルールが触らない include 内部への修正を、プロジェクトのカスタムルールで発生させる。
  await writeFile(rulePath, `module.exports = {
    names: ["test-include-filename"],
    description: "Replace a file name",
    tags: ["test"],
    parser: "none",
    function(params, onError) {
      params.lines.forEach((line, index) => {
        if (!line.includes("example.md")) return;
        const column = line.indexOf("example.md") + 1;
        onError({
          lineNumber: index + 1,
          range: [column, "example.md".length],
          fixInfo: { editColumn: column, deleteCount: "example.md".length, insertText: "replacement.md" }
        });
      });
    }
  };\n`);
  const config = { default: false, MD009: true, "test-include-filename": true };
  await writeFile(path.join(cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config, customRules: ["./include-rule.cjs"],
  }));
  // 説明リストの外に置き、その構造保護だけで誤って試験が通ることを避ける。
  const input = "Outside example.md \n\n::include{file=example.md}\n\nTerm\n: Description \n";
  const results = await lint({ strings: { fixture: input }, config, customRules: [runtimeRequire(rulePath)] });
  const customFixes = results.fixture.filter((result) => result.ruleNames.includes("test-include-filename"));
  assert.equal(customFixes.length, 2);
  const includeFixes = customFixes.filter((result) => result.lineNumber === 3);
  assert.equal(includeFixes.length, 1, "the fixture actually requests a change to the include target");
  const { lineNumber, fixInfo } = includeFixes[0];
  assert.equal(lineNumber, 3);
  assert.equal(input.split("\n")[lineNumber - 1].slice(fixInfo.editColumn - 1, fixInfo.editColumn - 1 + fixInfo.deleteCount), "example.md");
  assert.equal(fixInfo.insertText, "replacement.md");
  assert.ok(results.fixture.some((result) => result.ruleNames.includes("MD009")));

  const options = { filename: path.join(cwd, "example.md"), cwd, runtimeDir };
  const output = await formatMarkdown(input, options);
  // 同じルールの本文側の修正が適用され、カスタムルール自体が無視されていないことも確かめる。
  assert.equal(output, "Outside replacement.md\n\n::include{file=example.md}\n\nTerm\n: Description\n");
  assert.equal(await formatMarkdown(output, options), output);
  // カスタムルールも名前で止められる。
  assert.equal(await formatMarkdown(input, { ...options, fixes: { "test-include-filename": false } }),
    "Outside example.md\n\n::include{file=example.md}\n\nTerm\n: Description\n");
});

async function customRuleProject(t, name, source) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-custom-rule-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const rulePath = path.join(cwd, "custom-rule.cjs");
  await writeFile(rulePath, source);
  await writeFile(path.join(cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config: { default: false, MD009: true, [name]: true }, customRules: ["./custom-rule.cjs"],
  }));
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir };
}

test("custom fixes cannot change GitLab references, the start of an include line, or image attributes", async (t) => {
  // 参照の番号や名前を変える・include の行頭に空白を足す・画像の幅を変える修正を、カスタムルールで出す。
  const options = await customRuleProject(t, "test-gitlab-atoms", `module.exports = {
    names: ["test-gitlab-atoms"],
    description: "Rewrite GitLab syntax",
    tags: ["test"],
    parser: "none",
    function(params, onError) {
      params.lines.forEach((line, index) => {
        const edit = (column, deleteCount, insertText) => onError({ lineNumber: index + 1, fixInfo: { editColumn: column, deleteCount, insertText } });
        if (line.includes("#12")) edit(line.indexOf("#12") + 3, 1, "3");
        if (line.includes("project#7")) edit(line.indexOf("project#7") + 1, 0, "x");
        if (line.includes("project~bug")) edit(line.indexOf("~bug") + 1, 1, "B");
        if (line.startsWith("::include")) edit(1, 0, " ");
        if (line.includes("){width")) edit(line.indexOf("width=10") + 8, 1, "2");
      });
    }
  };\n`);
  const input = "Fix #12 and project#7 and group/project~bug \n\n::include{file=a.md}\n\n![x](a(b).png){width=10}\n";
  const rule = runtimeRequire(path.join(options.cwd, "custom-rule.cjs"));
  const results = await lint({ strings: { fixture: input }, config: { default: false, "test-gitlab-atoms": true }, customRules: [rule] });
  assert.deepEqual(results.fixture.map((result) => result.lineNumber), [1, 1, 1, 3, 5], "the custom rule requests every protected change");
  const output = await formatMarkdown(input, options);
  assert.equal(output, input.replace("~bug \n", "~bug\n"));
  assert.equal(await formatMarkdown(output, options), output);
});

test("a fix from a built-in rule missing from the classification table is not applied", async (t) => {
  // markdownlint を上げて増えたルールに見立て、MD と 3 桁の名前のルールが行末の空白以外を書き換える。
  const options = await customRuleProject(t, "MD099", `module.exports = {
    names: ["MD099"],
    description: "Unreviewed rule",
    tags: ["test"],
    parser: "none",
    function(params, onError) {
      params.lines.forEach((line, index) => {
        if (line.includes("old")) onError({ lineNumber: index + 1, fixInfo: { editColumn: line.indexOf("old") + 1, deleteCount: 3, insertText: "new" } });
      });
    }
  };\n`);
  const rule = runtimeRequire(path.join(options.cwd, "custom-rule.cjs"));
  const results = await lint({ strings: { fixture: "old text \n" }, config: { default: false, MD099: true }, customRules: [rule] });
  assert.ok(results.fixture.some((result) => result.fixInfo?.insertText === "new"), "the unreviewed rule requests a fix");
  assert.equal(await formatMarkdown("old text \n", options), "old text\n");
});

test("every markdownlint rule is classified so an upgrade cannot apply unreviewed fixes", async () => {
  const rulesPath = path.join(path.dirname(runtimeRequire.resolve("markdownlint/promise")), "rules.mjs");
  const { default: rules } = await import(pathToFileURL(rulesPath));
  // 組み込みルールの名前の一覧が表と一致しなければ、markdownlint を上げた後に表を見直す。
  assert.deepEqual(Object.fromEntries(rules.map((rule) => [rule.names[0], [...rule.names]])),
    Object.fromEntries(Object.entries(builtinRuleNames).map(([id, names]) => [id, [...names]])));
  const categorized = new Set(Object.values(fixCategories).flat());
  for (const rule of rules) {
    // 修正をルールの中で組み立てるルールは、どれかの分類に入っている (補助関数で組み立てるルールはここでは見分けられない)。
    if (/fixInfo|insertText|deleteCount|editColumn/u.test(rule.function.toString())) {
      assert.ok(categorized.has(rule.names[0]), `${rule.names[0]} has fixes but no category`);
    }
  }
});

test("custom rule aliases that are enabled and disabled at once are rejected", async (t) => {
  const options = await customRuleProject(t, "test-alias-rule", `module.exports = {
    names: ["test-alias-rule", "test-alias-other"],
    description: "Rule with an alias",
    tags: ["test"],
    parser: "none",
    function(params, onError) {
      params.lines.forEach((line, index) => {
        if (line.includes("old")) onError({ lineNumber: index + 1, fixInfo: { editColumn: line.indexOf("old") + 1, deleteCount: 3, insertText: "new" } });
      });
    }
  };\n`);
  assert.equal(await formatMarkdown("old\n", options), "new\n", "the custom rule is applied by default");
  assert.equal(await formatMarkdown("old\n", { ...options, fixes: { "test-alias-other": false } }), "old\n");
  await assert.rejects(formatMarkdown("old\n", { ...options, fixes: { "test-alias-rule": true, "test-alias-other": false } }), /両方/);
});

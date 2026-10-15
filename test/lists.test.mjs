import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatMarkdown, htmlInternals } from "../format.mjs";

// リストを loose にしないこと (どの修正でも) と、loose のリストを詰めること (分類 tight_lists) の試験。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const { markdownToHTML } = createRequire(path.join(runtimeDir, "package.json"))("comrak");
const renderOptions = {
  extension: {
    descriptionLists: true, table: true, strikethrough: true, autolink: true, tasklist: true, footnotes: true,
    multilineBlockQuotes: true, mathDollars: true, mathCode: true, alerts: true,
  },
  parse: { relaxedTasklistMatching: true, leaveFootnoteDefinitions: true },
  render: { unsafe: true },
};
const { normalizedHtml } = htmlInternals;
const rendered = (text) => normalizedHtml(markdownToHTML(text, renderOptions));
// 段落を包む <p> を除いた描画 (詰めて変わるのは、項目の段落の <p> だけ)。
const withoutParagraphs = (text) => normalizedHtml(markdownToHTML(text, renderOptions).replace(/<\/?p>/gu, ""));
const looseItems = (text) => (markdownToHTML(text, renderOptions).match(/<li>\s*<p>/gu) || []).length;

async function project(t, files = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "md-format-lists-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: true }));
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(cwd, name), contents);
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir };
}

// 整形の結果が expected になり、2 回目で変わらず、近道の有無で同じこと。
async function assertFormats(options, input, expected, name) {
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected, name);
  assert.equal(await formatMarkdown(output, options), output, `${name}: 2 回目で変わらない`);
  assert.equal(await formatMarkdown(input, { ...options, exhaustive: true }), output, `${name}: 近道の有無で同じ`);
  return output;
}

test("loose のリストの項目の間と、項目の中のブロックの間の空行を消して詰める", async (t) => {
  const options = await project(t);
  for (const [name, input, expected] of [
    ["項目の間", "- a\n\n- b\n", "- a\n- b\n"],
    ["続く空行", "- a\n\n\n- b\n", "- a\n- b\n"],
    ["番号付き", "1. a\n\n2. b\n\n本文\n", "1. a\n2. b\n\n本文\n"],
    ["タスク", "- [ ] a\n\n- [x] b\n", "- [ ] a\n- [x] b\n"],
    ["引用の中", "> - a\n>\n> - b\n", "> - a\n> - b\n"],
    ["段落と入れ子のリストの間", "- a\n\n  - b\n- c\n", "- a\n  - b\n- c\n"],
    ["外と中の両方", "- a\n\n  - b\n\n  - c\n\n- d\n", "- a\n  - b\n  - c\n- d\n"],
    ["中だけ", "- a\n  - b\n\n  - c\n- d\n", "- a\n  - b\n  - c\n- d\n"],
    ["段落とフェンスの間 (フェンスの中の空行は残す)", "- a\n\n  ```\n  x\n\n  y\n  ```\n- b\n", "- a\n  ```\n  x\n\n  y\n  ```\n- b\n"],
    ["CRLF", "- a\r\n\r\n- b\r\n", "- a\r\n- b\r\n"],
    ["CR だけ", "- a\r\r- b\r", "- a\r- b\r"],
    ["front matter の後", "---\ntitle: x\n---\n\n- a\n\n- b\n", "---\ntitle: x\n---\n\n- a\n- b\n"],
  ]) {
    const output = await assertFormats(options, input, expected, name);
    assert.equal(looseItems(output), 0, `${name}: 項目の段落が <p> で包まれない`);
    assert.equal(withoutParagraphs(output), withoutParagraphs(input), `${name}: 描画は <p> のほかは変わらない`);
  }
});

test("詰めると段落がつながるものや、ブロックが変わるものは loose のまま残す", async (t) => {
  const options = await project(t);
  for (const [name, input] of [
    ["項目に段落が 2 つ", "- a\n\n  b\n- c\n"],
    ["段落の後の字下げのコード", "- a\n\n      code\n- b\n"],
    ["2 から始まる入れ子の番号付きリスト", "1. a\n\n   2. b\n"],
  ]) {
    const output = await assertFormats(options, input, input, name);
    assert.ok(looseItems(output) > 0, `${name}: loose のまま`);
  }
  // 詰められないリストがあっても、ほかのリストは詰める。
  await assertFormats(options, "- a\n\n  b\n- c\n\n本文\n\n- d\n\n- e\n", "- a\n\n  b\n- c\n\n本文\n\n- d\n- e\n", "混在");
  // 当てた後の確かめで初めて落ちるリスト (先に見送れないもの) と、詰められるリストをいっしょに当てると、
  // 半分に分けて確かめ直し、詰められるものだけを詰める。
  for (const [name, input, expected] of [
    ["落ちるものが先", "1. a\n\n   2. b\n\n本文\n\n- c\n\n- d\n", "1. a\n\n   2. b\n\n本文\n\n- c\n- d\n"],
    ["落ちるものが後", "- c\n\n- d\n\n本文\n\n1. a\n\n   2. b\n", "- c\n- d\n\n本文\n\n1. a\n\n   2. b\n"],
    ["3 つ", "- c\n\n- d\n\n本文\n\n1. a\n\n   2. b\n\n本文\n\n- e\n\n- f\n",
      "- c\n- d\n\n本文\n\n1. a\n\n   2. b\n\n本文\n\n- e\n- f\n"],
  ]) {
    const stats = {};
    assert.equal(await formatMarkdown(input, { ...options, stats }), expected, name);
    await assertFormats(options, input, expected, name);
  }
});

test("tight_lists を無効にすると詰めない。名前の大文字小文字は区別しない", async (t) => {
  const options = await project(t);
  assert.equal(await formatMarkdown("- a\n\n- b\n", { ...options, fixes: { tight_lists: false } }), "- a\n\n- b\n");
  assert.equal(await formatMarkdown("- a\n\n- b\n", { ...options, fixes: { TIGHT_LISTS: false } }), "- a\n\n- b\n");
  await assert.rejects(formatMarkdown("- a\n", { ...options, fixes: { tight_list: false } }), /分類名にもルール名にも/);
});

test("範囲を指定したときは、範囲に収まるリストだけを詰める", async (t) => {
  const options = await project(t);
  const input = "- a\n\n- b\n\n本文\n\n- c\n\n- d\n";
  const output = await formatMarkdown(input, { ...options, range: { start: [7, 0], end: [9, Infinity] } });
  assert.equal(output, "- a\n\n- b\n\n本文\n\n- c\n- d\n");
  const partial = await formatMarkdown(input, { ...options, range: { start: [7, 0], end: [7, Infinity] } });
  assert.equal(partial, input, "リストの一部だけを選んだときは詰めない");
});

test("項目の中に空行を足す修正 (MD031・MD032) は、詰まったリストを loose にしないので当てない", async (t) => {
  const options = await project(t);
  for (const fixes of [{}, { tight_lists: false }]) {
    for (const [name, input] of [
      ["項目の中のフェンス", "- a\n  ```\n  x\n  ```\n- b\n"],
      ["段落の後の入れ子のリスト", "- a\n  - b\n- c\n"],
      ["タスクと番号付き", "1. a\n   - [ ] b\n   - [x] c\n2. d\n"],
    ]) {
      const output = await assertFormats({ ...options, fixes }, input, input, `${name} ${JSON.stringify(fixes)}`);
      assert.equal(looseItems(output), 0, name);
    }
  }
});

test("詰まったリストに空行を足す修正が多くても、修正ごとに文書を解析し直さない", async (t) => {
  const options = await project(t);
  // 詰めたリストの各項目に、MD031 と MD032 が空行を求める (フェンスの前後、入れ子のリストの前後)。
  const step = (index, note) => `- step\n\n  \`\`\`bash\n  echo ${index}\n  \`\`\`\n${note ? "\n  - note\n" : ""}`;
  const tight = (index, note) => `- step\n  \`\`\`bash\n  echo ${index}\n  \`\`\`\n${note ? "  - note\n" : ""}`;
  const list = (item, note, separator) => Array.from({ length: 40 }, (_, index) => item(index + 1, note)).join(separator);
  const quote = (text) => text.replace(/\n$/u, "").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n") + "\n";
  for (const [name, source, result] of [
    ["文書の直下", list(step, true, "\n"), list(tight, true, "")],
    ["引用の中", quote(list(step, false, "\n")), quote(list(tight, false, ""))],
  ]) {
    await assertFormats(options, source, result, name);
    const stats = {};
    await formatMarkdown(source, { ...options, stats });
    assert.ok(stats.parses < 10, `${name}: 解析は ${stats.parses} 回`);
  }
});

test("項目の中の HTML のブロックを整形しても、リストを loose にしない", async (t) => {
  const options = await project(t);
  const input = "- 項目\n  <table><tr><td>a</td></tr></table>\n- 次\n";
  const output = await assertFormats(options, input,
    "- 項目\n  <table>\n    <tr>\n      <td>a</td>\n    </tr>\n  </table>\n- 次\n", "HTML のブロック");
  assert.equal(looseItems(output), 0);
  assert.equal(rendered(output), rendered(input));
});

test("構文木を比べないカスタムルールの修正も、リストを loose にするものは当てない", async (t) => {
  // 2 つ目からの項目の前に空行を足すカスタムルール (緩い検査だけで当てる修正)。
  const rule = `export default {
    names: ["test-blank-before-item"], description: "項目の前に空行を足す", tags: ["test"], parser: "none",
    function(params, onError) {
      params.lines.forEach((line, index) => {
        if (index > 0 && line.startsWith("- ") && params.lines[index - 1] !== "") {
          onError({ lineNumber: index + 1, fixInfo: { editColumn: 1, insertText: "\\n" } });
        }
      });
    }
  };\n`;
  const options = await project(t, {
    "blank.mjs": rule,
    ".markdownlint-cli2.jsonc": JSON.stringify({ customRules: ["./blank.mjs"], config: { default: false, "test-blank-before-item": true } }),
  });
  await rm(path.join(options.cwd, ".markdownlint.json"));
  const input = "- a\n- b\n";
  for (const fixes of [{}, { tight_lists: false }]) {
    assert.equal(await formatMarkdown(input, { ...options, fixes }), input, JSON.stringify(fixes));
  }
  // リストを loose にしない所では、同じルールの修正を当てる (ルールが働いていることの確かめ)。
  assert.equal(await formatMarkdown("本文\n- a\n", options), "本文\n\n- a\n");
});

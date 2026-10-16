import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { builtinRuleNames, defaultDisabledCategories, fixCategories, formatMarkdown, htmlCategory, htmlCellsCategory, tightListsCategory } from "../format.mjs";

// docs/reference/rules.md と README の「整形の例」の例を、書いてあるとおりに整形できるかを確かめる (文書と動作をずらさない)。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { parseMarkdown } = runtimeRequire("comrak");
const parsed = async (file) => parseMarkdown(await readFile(file, "utf8"), { extension: { table: true } }).nodes;
const nodes = await parsed(path.join(packageDir, "docs", "reference", "rules.md"));
const readmeNodes = await parsed(path.join(packageDir, "README.md"));

const typeOf = (node) => (typeof node.data.value === "string" ? node.data.value : Object.keys(node.data.value)[0]);
// 文書の順にノードの番号を返す。
function* walk(tree, index = 0) {
  yield index;
  for (let child = tree[index].first_child; child !== undefined; child = tree[child].next_sibling) yield* walk(tree, child);
}
function textOf(tree, index) {
  return [...walk(tree, index)].map((child) => tree[child].data.value.Text ?? tree[child].data.value.Code?.literal ?? "").join("");
}
// 見えるようにした空白とタブを戻す。
const visible = (text) => text.replaceAll("␣", " ").replaceAll("⇥", "\t");

// 例のコードブロック (整形前と整形後・変わらない・markdownlint の設定) を節に足し、次の整形後が対にする整形前を返す。
function addExample(section, { info, literal }, pending) {
  const [language, kind, ...flags] = info.split(/\s+/u);
  const fixes = Object.fromEntries(flags.filter((flag) => /^(?:no)?fixes=/u.test(flag))
    .flatMap((flag) => {
      const [key, names] = flag.split("=");
      return names.split(",").map((name) => [name, key === "fixes"]);
    }));
  const flavor = flags.find((flag) => flag.startsWith("flavor="))?.slice("flavor=".length);
  assert.ok(flavor === undefined || flavor === "gfm" || flavor === "glfm", `${section.id}: 方言は gfm か glfm`);
  const input = flags.includes("末尾の改行なし") ? literal.replace(/\n$/u, "") : literal;
  if (language === "json" && kind === "markdownlint") section.config = JSON.parse(literal);
  else if (kind === "整形前") return { input, fixes, flavor, config: section.config };
  else if (kind === "整形後") {
    assert.ok(pending, `${section.id}: 整形後 follows 整形前`);
    section.examples.push({ ...pending, expected: literal });
  } else if (kind === "変わらない") section.examples.push({ input, expected: input, fixes, flavor, config: section.config });
  else assert.fail(`${section.id}: unknown code block "${info}"`);
  return undefined;
}

// ### MDxxx の節ごとに、例 (整形前と整形後・変わらない) と markdownlint の設定を集める。
// markdownlint のルールでない分類と方言の違いの節の下の ### の節は、
// html:<見出し>・cells:<見出し>・tight:<見出し>・gfm:<見出し> の名前で集める。
const categorySections = new Map([["HTML のブロック", "html"], ["HTML の表のセルを Markdown にする", "cells"], ["loose のリストを詰める", "tight"], ["GFM と GLFM の違い", "gfm"]]);
const sections = new Map();
let table;
let withoutFixes;
{
  let section;
  let pending;
  let group;
  for (const index of walk(nodes)) {
    const node = nodes[index];
    const type = typeOf(node);
    if (type === "Table" && table === undefined) table = index;
    if (type === "Paragraph" && textOf(nodes, index).startsWith("自動修正の無いルール:")) {
      withoutFixes = textOf(nodes, index).match(/MD\d{3}/gu);
    }
    if (type === "Heading" && node.data.value.Heading.level === 2) {
      group = categorySections.get(textOf(nodes, index));
      section = undefined;
      pending = undefined;
    }
    if (type === "Heading" && node.data.value.Heading.level === 3) {
      const id = textOf(nodes, index).match(/^MD\d{3}/u)?.[0] ?? (group ? `${group}:${textOf(nodes, index)}` : undefined);
      assert.ok(id && !sections.has(id), `見出し ${textOf(nodes, index)} はルール・分類・方言の節で、重ならない`);
      section = { id, config: {}, examples: [] };
      sections.set(id, section);
    }
    if (type === "CodeBlock" && section) pending = addExample(section, node.data.value.CodeBlock, pending);
  }
}

// README の ## 整形の例 の節 (次の ## 以上の見出しまで) の例。
const readme = { id: "README", config: {}, examples: [] };
{
  let inside = false;
  let pending;
  for (const index of walk(readmeNodes)) {
    const node = readmeNodes[index];
    const type = typeOf(node);
    if (type === "Heading" && node.data.value.Heading.level <= 2) {
      if (inside) break;
      inside = node.data.value.Heading.level === 2 && textOf(readmeNodes, index) === "整形の例";
    }
    if (type === "CodeBlock" && inside) pending = addExample(readme, node.data.value.CodeBlock, pending);
  }
}

// 設定ファイルの無いフォルダで整形し、利用者と同じ markdownlint の既定 (全ルール有効) にする。
async function assertExamples(t, documented) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-reference-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filename = path.join(cwd, "example.md");
  for (const [id, section] of documented) {
    for (const [number, { input, expected, fixes, flavor, config }] of section.examples.entries()) {
      const options = { filename, cwd, runtimeDir, fixes, flavor, config: { default: true, ...config } };
      const name = `${id} example ${number + 1}`;
      const output = await formatMarkdown(visible(input), options);
      assert.equal(output, visible(expected), name);
      assert.equal(await formatMarkdown(output, options), output, `${name} is idempotent`);
    }
  }
}

test("the reference table lists every fixable rule with its category and default", () => {
  assert.ok(table !== undefined, "the document has the rule table");
  const rows = new Map();
  for (let row = nodes[table].first_child; row !== undefined; row = nodes[row].next_sibling) {
    if (nodes[row].data.value.TableRow) continue;
    const cells = [];
    for (let cell = nodes[row].first_child; cell !== undefined; cell = nodes[cell].next_sibling) cells.push(textOf(nodes, cell).trim());
    const id = cells[0].match(/^MD\d{3}/u)[0];
    assert.equal(cells[0], `${id} ${builtinRuleNames[id][1]}`, `${id}: the table shows the rule alias`);
    rows.set(id, { category: cells[1], enabled: cells[2] });
  }
  const expected = new Map(Object.entries(fixCategories).flatMap(([category, ids]) => ids.map((id) => [id, {
    category, enabled: defaultDisabledCategories.includes(category) ? "無効" : "有効",
  }])));
  assert.deepEqual(rows, expected);
  const categorized = new Set(Object.values(fixCategories).flat());
  assert.deepEqual(withoutFixes, Object.keys(builtinRuleNames).filter((id) => !categorized.has(id)));
});

test("every fixable rule has a section with at least one example", () => {
  for (const id of Object.values(fixCategories).flat()) {
    assert.ok(sections.get(id)?.examples.length, `${id} has an example in docs/reference/rules.md`);
  }
});

test("the HTML block section shows the category and examples for tables, nested HTML, and Markdown inside HTML", () => {
  const html = [...sections].filter(([id]) => id.startsWith("html:"));
  assert.deepEqual(html.map(([id]) => id),
    ["html:表", "html:入れ子の表", "html:セルの中の Markdown", "html:折りたたみ", "html:入れ物の中", "html:空白をそのまま描く要素", "html:変えないもの"]);
  for (const [id, section] of html) assert.ok(section.examples.length, `${id} has an example`);
  assert.ok(html.flatMap(([, section]) => section.examples).some(({ input, expected }) => input !== expected),
    "HTML の節に、整形で変わる例がある");
  assert.equal(htmlCategory, "html");
});

test("HTML のセルの節には分類と要素ごとの置き換え・保持・無効の例がある", () => {
  const cells = [...sections].filter(([id]) => id.startsWith("cells:"));
  assert.deepEqual(cells.map(([id]) => id), [
    "cells:コードと強調", "cells:リンクと画像", "cells:改行と段落", "cells:リストとタスク", "cells:コードブロック",
    "cells:引用と説明リスト", "cells:文字のエスケープ", "cells:入れ物の中", "cells:変えないもの", "cells:止めたとき",
  ]);
  for (const [id, section] of cells) assert.ok(section.examples.length, `${id} に例がある`);
  const examples = cells.flatMap(([, section]) => section.examples);
  assert.ok(examples.some(({ input, expected }) => input !== expected), "Markdown にする例がある");
  assert.ok(examples.some(({ input, expected }) => input === expected), "変わらない例がある");
  assert.ok(examples.some(({ fixes }) => fixes.html_cells === false), "html_cells を止める例がある");
  assert.ok(examples.some(({ fixes }) => fixes.html === false), "html を止める例がある");
  assert.equal(htmlCellsCategory, "html_cells");
});

test("the tight list section shows the category and examples that tighten and that keep loose lists", () => {
  const tight = [...sections].filter(([id]) => id.startsWith("tight:"));
  assert.deepEqual(tight.map(([id]) => id), ["tight:項目の間", "tight:項目の中のブロックの間", "tight:変えないもの"]);
  const examples = tight.flatMap(([, section]) => section.examples);
  assert.ok(examples.some(({ input, expected }) => input !== expected), "詰める例がある");
  assert.ok(examples.some(({ input, expected }) => input === expected), "変わらない例がある");
  assert.equal(tightListsCategory, "tight_lists");
});

test("方言の違いの節には GFM を指定した整形と保持の例がある", () => {
  const examples = [...sections].filter(([id]) => id.startsWith("gfm:")).flatMap(([, section]) => section.examples);
  assert.ok(examples.some(({ flavor, input, expected }) => flavor === "gfm" && input !== expected), "GFM で整形する例がある");
  assert.ok(examples.some(({ flavor, input, expected }) => flavor === "gfm" && input === expected), "GFM で保持する例がある");
});

test("every example in the reference formats exactly as documented with all markdownlint rules enabled", async (t) => {
  await assertExamples(t, sections);
});

test("the README's formatting examples change and keep text exactly as shown", async (t) => {
  assert.ok(readme.examples.length >= 6, `README の整形の例は 6 つ以上: ${readme.examples.length}`);
  assert.ok(readme.examples.some(({ input, expected }) => input !== expected), "整形で変わる例がある");
  assert.ok(readme.examples.some(({ input, expected }) => input === expected), "変わらない例がある");
  await assertExamples(t, new Map([[readme.id, readme]]));
});

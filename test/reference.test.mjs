import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { builtinRuleNames, defaultDisabledCategories, fixCategories, formatMarkdown, htmlCategory, tightListsCategory } from "../format.mjs";

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
  const fixes = Object.fromEntries(flags.filter((flag) => flag.startsWith("fixes="))
    .flatMap((flag) => flag.slice("fixes=".length).split(",")).map((name) => [name, true]));
  const input = flags.includes("末尾の改行なし") ? literal.replace(/\n$/u, "") : literal;
  if (language === "json" && kind === "markdownlint") section.config = JSON.parse(literal);
  else if (kind === "整形前") return { input, fixes, config: section.config };
  else if (kind === "整形後") {
    assert.ok(pending, `${section.id}: 整形後 follows 整形前`);
    section.examples.push({ ...pending, expected: literal });
  } else if (kind === "変わらない") section.examples.push({ input, expected: input, fixes, config: section.config });
  else assert.fail(`${section.id}: unknown code block "${info}"`);
  return undefined;
}

// ### MDxxx の節ごとに、例 (整形前と整形後・変わらない) と markdownlint の設定を集める。
// markdownlint のルールでない分類の節 (## HTML のブロック・## loose のリストを詰める) の下の ### の節は、
// html:<見出し>・tight:<見出し> の名前で集める。
const categorySections = new Map([["HTML のブロック", "html"], ["loose のリストを詰める", "tight"]]);
const sections = new Map();
let table;
let withoutFixes;
{
  let section;
  let pending;
  let prefix;
  for (const index of walk(nodes)) {
    const node = nodes[index];
    const type = typeOf(node);
    if (type === "Table" && table === undefined) table = index;
    if (type === "Paragraph" && textOf(nodes, index).startsWith("自動修正の無いルール:")) {
      withoutFixes = textOf(nodes, index).match(/MD\d{3}/gu);
    }
    if (type === "Heading" && node.data.value.Heading.level === 2) prefix = categorySections.get(textOf(nodes, index));
    if (type === "Heading" && node.data.value.Heading.level === 3) {
      const id = textOf(nodes, index).match(/^MD\d{3}/u)?.[0] ?? (prefix ? `${prefix}:${textOf(nodes, index)}` : undefined);
      assert.ok(id && !sections.has(id), `見出し ${textOf(nodes, index)} はルールか分類の節で、重ならない`);
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
    for (const [number, { input, expected, fixes, config }] of section.examples.entries()) {
      const options = { filename, cwd, runtimeDir, fixes, config: { default: true, ...config } };
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
    ["html:表", "html:入れ子の表", "html:セルの中の Markdown", "html:折りたたみ", "html:入れ物の中", "html:変えないもの"]);
  for (const [id, section] of html) assert.ok(section.examples.length, `${id} has an example`);
  assert.ok(html.flatMap(([, section]) => section.examples).some(({ input, expected }) => input !== expected),
    "HTML の節に、整形で変わる例がある");
  assert.equal(htmlCategory, "html");
});

test("the tight list section shows the category and examples that tighten and that keep loose lists", () => {
  const tight = [...sections].filter(([id]) => id.startsWith("tight:"));
  assert.deepEqual(tight.map(([id]) => id), ["tight:項目の間", "tight:項目の中のブロックの間", "tight:変えないもの"]);
  const examples = tight.flatMap(([, section]) => section.examples);
  assert.ok(examples.some(({ input, expected }) => input !== expected), "詰める例がある");
  assert.ok(examples.some(({ input, expected }) => input === expected), "変わらない例がある");
  assert.equal(tightListsCategory, "tight_lists");
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

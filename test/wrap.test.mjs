import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatMarkdown, htmlInternals } from "../format.mjs";

// 長い行の折り返し (分類 line_length、MD013) の試験。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const { markdownToHTML } = createRequire(path.join(runtimeDir, "package.json"))("comrak");
const glfmRender = {
  extension: {
    descriptionLists: true, table: true, strikethrough: true, autolink: true, tasklist: true, footnotes: true,
    multilineBlockQuotes: true, mathDollars: true, mathCode: true, alerts: true,
  },
  parse: { relaxedTasklistMatching: true, leaveFootnoteDefinitions: true },
  render: { unsafe: true },
};
const rendered = (text) => htmlInternals.normalizedHtml(markdownToHTML(text, glfmRender));
const looseItems = (text) => (markdownToHTML(text, glfmRender).match(/<li>\s*<p>/gu) || []).length;

async function project(t, width = 40, extra = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "md-format-wrap-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: false, MD013: { line_length: width, ...extra } }));
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir, fixes: { line_length: true } };
}

// 整形の結果が expected になり、2 回目で変わらず、近道の有無で同じで、描画が変わらないこと。
async function assertWraps(options, input, expected, name) {
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected, name);
  assert.equal(await formatMarkdown(output, options), output, `${name}: 2 回目で変わらない`);
  assert.equal(await formatMarkdown(input, { ...options, exhaustive: true }), output, `${name}: 近道の有無で同じ`);
  if (options.flavor !== "gfm") assert.equal(rendered(output), rendered(input), `${name}: 描画が変わらない`);
  return output;
}

test("長い行を空白の位置で折り、段落の中身の桁にそろえる", async (t) => {
  const options = await project(t);
  for (const [name, input, expected] of [
    ["英語", "This is a fairly long English sentence that should be wrapped at spaces only.\n",
      "This is a fairly long English sentence\nthat should be wrapped at spaces only.\n"],
    ["日本語と英字の間の空白", "- `--check` は何も変えない。導入した版と clone の版、起動役、PATH、Node の版を比べる\n",
      "- `--check` は何も変えない。導入した版と clone\n  の版、起動役、PATH、Node の版を比べる\n"],
    ["引用", "> quoted text that is long enough to wrap inside the quote marker\n",
      "> quoted text that is long enough to\n> wrap inside the quote marker\n"],
    ["番号付き", "1. ordered item text that is long enough to wrap at the content column\n",
      "1. ordered item text that is long enough\n   to wrap at the content column\n"],
    ["引用の中のリスト", "> - nested list item in a quote that is long enough to be wrapped\n",
      "> - nested list item in a quote that is\n>   long enough to be wrapped\n"],
    ["説明 (GLFM)", "Term\n: description details that are long enough to wrap in GLFM output\n",
      "Term\n: description details that are long\n  enough to wrap in GLFM output\n"],
    ["alerts", "> [!NOTE]\n> alert body text that is long enough to be wrapped by the formatter\n",
      "> [!NOTE]\n> alert body text that is long enough to\n> be wrapped by the formatter\n"],
    ["CRLF", "This is a fairly long English sentence that should be wrapped.\r\n",
      "This is a fairly long English sentence\r\nthat should be wrapped.\r\n"],
    ["硬い改行を保つ", "Hard break at the end of this long line with words words words words  \nnext\n",
      "Hard break at the end of this long line\nwith words words words words  \nnext\n"],
  ]) {
    await assertWraps(options, input, expected, name);
  }
});

test("折らない所: 日本語どうしの間・空白の無い行・コードスパン・リンクの行き先・参照・\\ の直後・インラインの HTML", async (t) => {
  const options = await project(t);
  for (const [name, input, expected] of [
    ["日本語どうしの間", "> 引用の 中の とても 長い 行 は 引用の 頭 を 保って 折る 必要 が ある はず です ね\n", undefined],
    ["空白の無い日本語", "日本語だけの長い文で空白がありません日本語だけの長い文で空白がありません日本語だけ\n", undefined],
    ["コードスパンの中", "Text with `a long code span that must not be broken at all` and more words here.\n",
      "Text with\n`a long code span that must not be broken at all`\nand more words here.\n"],
    ["リンクの行き先と title", "A line with a [link text here](https://example.com/very/long/path \"title with spaces\") end.\n",
      "A line with a [link text\nhere](https://example.com/very/long/path \"title with spaces\")\nend.\n"],
    ["参照 (GLFM)", "#123 と @user と ~label が あります。 #123 と @user と ~\"label two\" も あります。\n",
      "#123 と @user と ~label が あります。 #123 と\n@user と ~\"label two\" も あります。\n"],
    // \ の直後の空白では折らず、\ の無い最後の空白で折る。
    ["\\ の直後", "Escaped\\ spaces\\ keep\\ together\\ when\\ wrapping\\ this\\ line here.\n",
      "Escaped\\ spaces\\ keep\\ together\\ when\\ wrapping\\ this\\ line\nhere.\n"],
    ["インラインの HTML の間", "<span style=\"white-space: pre\">keep   these   spaces   inside   the   span</span> end\n",
      "<span style=\"white-space: pre\">keep   these   spaces   inside   the   span</span>\nend\n"],
  ]) {
    await assertWraps(options, input, expected ?? input, name);
  }
});

test("折った後の行の頭がブロックの記法になる所では折らない", async (t) => {
  const options = await project(t);
  const input = "Words then - a dash and 1. number and # hash and > quote and | pipe and <b>tag</b> words.\n";
  const output = await assertWraps(options, input, undefined ?? await formatMarkdown(input, options), "記法");
  for (const line of output.split("\n").slice(1)) {
    assert.doesNotMatch(line, /^(?:[-+*] |\d+[.)] |# |>|\||<)/u, `行の頭: ${line}`);
  }
  assert.ok(output.split("\n").length > 2, "ほかの所では折る");
});

test("リストの項目を折っても、詰まったリストを loose にしない", async (t) => {
  const options = await project(t);
  const input = "- a\n- b with a long long long long long long long long line here\n- c\n";
  const output = await assertWraps(options, input, "- a\n- b with a long long long long long long\n  long long line here\n- c\n", "リスト");
  assert.equal(looseItems(output), 0);
});

test("範囲を指定したときは、範囲の中の行だけを折る", async (t) => {
  const options = await project(t);
  const input = "This is the first long line of English words to be wrapped here.\n\n" +
    "This is the second long line of English words to be wrapped here.\n";
  const output = await formatMarkdown(input, { ...options, range: { start: [3, 0], end: [3, Infinity] } });
  assert.equal(output, "This is the first long line of English words to be wrapped here.\n\n" +
    "This is the second long line of English\nwords to be wrapped here.\n");
});

test("MD013 の設定に従う: 幅・strict・無効", async (t) => {
  const input = "This is a fairly long English sentence that should be wrapped at spaces only.\n";
  const wide = await project(t, 100);
  assert.equal(await formatMarkdown(input, wide), input, "幅に収まる行は折らない");
  const options = await project(t, 40, { strict: true });
  assert.equal(await formatMarkdown("Short words then averyveryveryverylongwordthatgoesbeyondthelimit\n", options),
    "Short words then\naveryveryveryverylongwordthatgoesbeyondthelimit\n", "strict では最後の語も数える");
  const disabled = await project(t);
  await writeFile(path.join(disabled.cwd, ".markdownlint.json"), JSON.stringify({ default: false, MD013: false }));
  assert.equal(await formatMarkdown(input, disabled), input, "MD013 を無効にした設定では折らない");
});

test("既定では折らず、.md-format.json の fixes で有効にできる", async (t) => {
  const options = await project(t);
  const input = "This is a fairly long English sentence that should be wrapped at spaces only.\n";
  assert.equal(await formatMarkdown(input, { ...options, fixes: undefined }), input, "既定で無効");
  await writeFile(path.join(options.cwd, ".md-format.json"), JSON.stringify({ fixes: { line_length: true } }));
  const child = spawnSync(process.execPath, [path.join(packageDir, "format.mjs"), "--filename", options.filename],
    { cwd: options.cwd, input, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "This is a fairly long English sentence\nthat should be wrapped at spaces only.\n");
});

test("GFM でも折り、GitHub の参照の中では折らない", async (t) => {
  const options = { ...await project(t), flavor: "gfm" };
  await assertWraps(options, "Mention @octocat and the team @github/docs about owner/repo#123 now please.\n",
    "Mention @octocat and the team\n@github/docs about owner/repo#123 now please.\n", "GFM");
  // GFM では、行頭の : は説明の記法でないので、その前でも折れる。GLFM では説明になるので、その前では折らない。
  const colon = "This prefix line is exactly forty chars! : colon starts the next line here.\n";
  await assertWraps(options, colon, "This prefix line is exactly forty chars!\n: colon starts the next line here.\n", "GFM の :");
  await assertWraps({ ...options, flavor: "glfm" }, colon,
    "This prefix line is exactly forty\nchars! : colon starts the next line here.\n", "GLFM の :");
});

test("2 行目からの行は、その行の頭で続ける (怠惰な続きの行は怠惰なまま)", async (t) => {
  const options = await project(t);
  await assertWraps(options, "- first line\n  second line that is long enough to wrap at the width here\n",
    "- first line\n  second line that is long enough to\n  wrap at the width here\n", "リストの 2 行目");
  await assertWraps(options, "> first line\nlazy continuation line that is long enough to wrap here\n",
    "> first line\nlazy continuation line that is long\nenough to wrap here\n", "怠惰な続きの行");
});

test("1 行を 3 回以上折り、複数の段落の行を同じ回に折る", async (t) => {
  const options = await project(t);
  const words = (count) => Array.from({ length: count }, () => "word").join(" ");
  const paragraph = words(30);
  const wrapped = [words(8), words(8), words(8), words(6)].join("\n");
  // 引用とリストの中では、行の頭の 2 字の分だけ、1 行の語が減る。
  const nested = [words(7), words(7), words(7), words(7), words(2)];
  await assertWraps(options, `${paragraph}\n\n> ${paragraph}\n\n- ${paragraph}\n`,
    `${wrapped}\n\n> ${nested.join("\n> ")}\n\n- ${nested.join("\n  ")}\n`, "3 つの段落");
});

test("範囲が行の一部だけのときは、その行を折らない", async (t) => {
  const options = await project(t);
  const input = "This is a fairly long English sentence that should be wrapped at spaces only.\n";
  assert.equal(await formatMarkdown(input, { ...options, range: { start: [1, 0], end: [1, 10] } }), input);
  assert.equal(await formatMarkdown(input, { ...options, range: { start: [1, 0], end: [1, Infinity] } }),
    "This is a fairly long English sentence\nthat should be wrapped at spaces only.\n");
});

test("インラインの HTML は、開きタグから対の閉じタグまでで折らず、その外では折る", async (t) => {
  const options = await project(t);
  await assertWraps(options, "Press <kbd>Ctrl + Alt</kbd> and <kbd>Del</kbd> to restart the machine now.\n",
    "Press <kbd>Ctrl + Alt</kbd>\nand <kbd>Del</kbd> to restart the\nmachine now.\n", "対のタグ");
  // 閉じない開きタグの後は、段落の終わりまで折らない。
  const output = await formatMarkdown("Some words here and then <span>an unclosed span with many words inside it\n", options);
  assert.match(output, /<span>an unclosed span with many words inside it\n$/u);
  // 複数の行にまたがる、空白がそのまま描かれる要素の中でも折らない。
  const multiline = "This is a fairly long English sentence that should be wrapped at spaces only.\n\n" +
    "a <span style=\"white-space: pre\">\nkeep   these   spaces   inside   the   span   please   now\n</span>\n\n" +
    "This is another long English sentence that should be wrapped at spaces only.\n";
  await assertWraps(options, multiline, "This is a fairly long English sentence\nthat should be wrapped at spaces only.\n\n" +
    "a <span style=\"white-space: pre\">\nkeep   these   spaces   inside   the   span   please   now\n</span>\n\n" +
    "This is another long English sentence\nthat should be wrapped at spaces only.\n", "複数の行の span");
});

test("インラインの HTML のある段落の長い行が多くても、描画と解析を修正ごとに繰り返さない", async (t) => {
  const options = await project(t);
  const paragraph = "Press <kbd>Ctrl</kbd> and then type some words that make this line long.\n";
  const input = Array.from({ length: 30 }, () => paragraph).join("\n");
  const stats = {};
  const output = await formatMarkdown(input, { ...options, stats });
  assert.equal(output, Array.from({ length: 30 }, () => "Press <kbd>Ctrl</kbd> and then type some\nwords that make this line long.\n").join("\n"));
  assert.ok(stats.renders <= 4, `描画は ${stats.renders} 回`);
  assert.ok(stats.parses <= 10, `解析は ${stats.parses} 回`);
});

test("全角の文字 (補助漢字・絵文字・半角カナ・異体字セレクタ付き) の間では折らず、ハングルの間では折る", async (t) => {
  const options = await project(t);
  const repeat = (word, count) => Array.from({ length: count }, () => word).join(" ") + "\n";
  for (const word of ["𠮷", "😀", "ｱｲｳ", "葛\u{e0100}"]) {
    const input = repeat(word, 25);
    assert.equal(await formatMarkdown(input, options), input, JSON.stringify(word));
  }
  const korean = repeat("한국어 문장을", 6);
  const output = await assertWraps(options, korean, await formatMarkdown(korean, options), "ハングル");
  assert.ok(output.split("\n").length > 2, "ハングルの間では折る");
});

test("ほかの修正が当たらない回にも、長い行を折る", async (t) => {
  const options = await project(t);
  await writeFile(path.join(options.cwd, ".markdownlint.json"),
    JSON.stringify({ default: false, MD010: true, MD013: { line_length: 40 } }));
  // コードブロックの中のタブ (MD010) の修正は、コードの中身を変えるので、いつも当たらない。
  const input = "```\na\tb\n```\n\nThis is a fairly long English sentence that should be wrapped at spaces only.\n";
  await assertWraps(options, input,
    "```\na\tb\n```\n\nThis is a fairly long English sentence\nthat should be wrapped at spaces only.\n", "MD010 と共に");
});

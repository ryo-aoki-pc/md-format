import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { formatMarkdown, htmlCellsCategory, htmlInternals } from "../format.mjs";
import { flavors } from "../flavors.mjs";

// 各見本で、期待する出力・2 回目の不変・近道の有無を確かめる。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { markdownToHTML } = runtimeRequire("comrak");
const semantic = await import(pathToFileURL(runtimeRequire.resolve("entities")));
const lines = (...rows) => rows.join("\n") + "\n";
const table = (html, tag = "td") => lines("<table><tr><" + tag + ">" + html + "</" + tag + "></tr></table>");
const markdownTable = (markdown, tag = "td") => lines("<table>", "<tr>", "<" + tag + ">", "", ...markdown.split("\n"), "", "</" + tag + ">", "</tr>", "</table>");
const compactTable = (markdown) => lines("<table><tr><td>", "", ...markdown.split("\n"), "", "</td></tr></table>");

async function project(t, rules = { default: true }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "md-format-cells-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify(rules));
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir };
}

async function assertFormats(options, input, expected, name, expectedHtml) {
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected, name);
  assert.equal(await formatMarkdown(output, options), output, name + ": 2 回目で変わらない");
  assert.equal(await formatMarkdown(input, { ...options, exhaustive: true }), output, name + ": 近道の有無で同じ");
  if (expectedHtml !== undefined) {
    const flavor = flavors[options.flavor || "glfm"];
    const normalize = (html) => htmlInternals.normalizedHtml(html, flavor, 0, null, semantic);
    assert.equal(normalize(markdownToHTML(output, flavor.renderOptions)), normalize(expectedHtml),
      name + ": 許す差だけを当てた期待の HTML と同じ");
  }
  return output;
}

test("html_cells は既定で有効で、コード・強調・取り消し線を Markdown にする", async (t) => {
  const options = await project(t);
  assert.equal(htmlCellsCategory, "html_cells");
  const cases = [
    ["コードと別名", "<code>dnf</code> で <b>root</b> と <i>斜体</i> と <s>消す</s>", "`dnf` で **root** と *斜体* と ~~消す~~",
      "<p><code>dnf</code> で <strong>root</strong> と <em>斜体</em> と <del>消す</del></p>"],
    ["strong・em・del・strike", "<strong>太字</strong> と <em>斜体</em> と <del>一</del> と <strike>二</strike>", "**太字** と *斜体* と ~~一~~ と ~~二~~"],
    ["コードの実体参照", "<code>&lt;div&gt; &amp; &quot;</code>", '`<div> & "`'],
    ["バッククォート", "<code>a`b``c</code>", "```a`b``c```"],
    ["両端のバッククォート", "<code>`x`</code>", "`` `x` ``"],
    ["両端の空白", "<code> x </code>", "`  x  `"],
    ["インライン HTML", "<code>x</code> と <kbd>Ctrl</kbd>+<samp>a  b</samp>", "`x` と <kbd>Ctrl</kbd>+<samp>a  b</samp>"],
  ];
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown, expected] of cases) {
      await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name,
        expected === undefined ? undefined : table(expected));
    }
    await assertFormats({ ...options, flavor }, table("<code>x</code> を使う", "th"), markdownTable("`x` を使う", "th"), flavor + ": th");
  }
});

test("リンク・画像・裸の URL と共通の実体参照を扱う", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown, expected] of [
      ["リンク", '<a href="https://例.jp/a?x=1&amp;y=2" title="題">文字</a>', '[文字](https://例.jp/a?x=1&y=2 "題")'],
      ["画像", '<img src="a.png" alt="i" title="t">', '![i](a.png "t")'],
      ["alt 無し", '<img src="a.png">', "![](a.png)"],
      ["引用符の無い src の末尾の /", "<img src=a.png/>", "![](a.png/)", '<p><img src="a.png/" alt=""></p>'],
      ["括弧", '<a href="https://example.com/a(b)">文字</a>', "[文字](https://example.com/a\\(b\\))"],
      ["裸の URL", "<code>x</code> https://example.com/a www.example.com a@example.com", "`x` <https://example.com/a> www.example.com <a@example.com>"],
      ["実体参照", "<code>x</code> &quot; &nbsp; &#39; &amp;", "`x` &quot; &nbsp; &#39; &amp;"],
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name,
      expected === undefined ? undefined : table(expected));
  }
});

test("段落と br の改行を作り、改行した先を別のブロックにしない", async (t) => {
  const options = await project(t);
  for (const [name, html, markdown] of [
    ["段落", "<p>一</p><p>二</p>", "一\n\n二"],
    ["改行", "<b>a</b><br>b", "**a**<br>\nb"],
    ["リストに見える次行", "<code>x</code><br>- b", "`x`<br>- b"],
    ["見出しに見える次行", "<code>x</code><br># b", "`x`<br># b"],
    ["タグだけの次行", "<code>x</code><br><kbd>b</kbd>", "`x`<br><kbd>b</kbd>"],
    ["全角の間の改行", "<p>日本\n語</p>", "日本\n語"],
  ]) await assertFormats(options, table(html), markdownTable(markdown), name);
});

test("箇条書き・開始番号・入れ子・タスクと loose の項目を Markdown にする", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown] of [
      ["箇条書き", "<ul><li>一</li><li>二</li></ul>", "- 一\n- 二"],
      ["開始番号 0", '<ol start="0"><li>一</li><li>二</li></ol>', "0. 一\n1. 二"],
      ["開始番号 1", '<ol start="1"><li>一</li></ol>', "1. 一"],
      ["入れ子", "<ul><li>親<ul><li>子</li></ul></li><li>次</li></ul>", "- 親\n  - 子\n- 次"],
      ["タスク", '<ul><li><input type="checkbox">未完</li><li><input checked type="checkbox" disabled>完了</li></ul>', "- [ ] 未完\n- [x] 完了"],
      ["タスクに見える文字", "<ul><li>[注] 説明</li></ul>", "- \\[注\\] 説明"],
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name);
    await assertFormats({ ...options, flavor, fixes: { tight_lists: false } },
      table("<ul><li><p>一</p></li><li><p>二</p></li></ul>"), markdownTable("- 一\n\n- 二"), flavor + ": loose の項目");
  }
});

test("pre をフェンスにし、実体参照と末尾の改行を扱う", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown] of [
      ["code の言語", '<pre><code class="language-sh">echo &lt;x&gt;</code></pre>', "```sh\necho <x>\n```"],
      ["pre の lang", '<pre lang="text">a&amp;b\n</pre>', "```text\na&b\n```"],
      ["言語無し", "<pre>a\n  b</pre>", "```\na\n  b\n```"],
      ["長いフェンス", "<pre><code>```text\nx\n```</code></pre>", "````\n```text\nx\n```\n````"],
      ["直後の改行", "<pre>\nx</pre>", "```\nx\n```"],
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name);
  }
});

test("引用を Markdown にし、説明リストは GLFM だけ変える", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    await assertFormats({ ...options, flavor }, table("<blockquote>引用 <code>x</code></blockquote>"),
      markdownTable("> 引用 `x`"), flavor + ": 引用");
    await assertFormats({ ...options, flavor }, table("<blockquote>[!NOTE] 普通の引用</blockquote>"),
      markdownTable("> \\[!NOTE\\] 普通の引用"), flavor + ": alert にしない");
  }
  await assertFormats(options, table("<dl><dt>用語</dt><dd>説明</dd></dl>"), markdownTable("用語\n: 説明"), "GLFM の説明");
  const input = table("<dl><dt>用語</dt><dd>説明</dd></dl>");
  await assertFormats({ ...options, flavor: "gfm", fixes: { html: false } }, input, input, "GFM の説明は変えない");
});

test("Markdown の記号をエスケープし、方言の守る記法を変えない", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown] of [
      ["インライン", "<p>\\ ` * _ [ ] &lt; | ~ $</p>", "\\\\ \\` \\* \\_ \\[ \\] &lt; \\| \\~ \\$"],
      ["箇条書きの印", "<p>- 文字</p><p>+ 文字</p>", "\\- 文字\n\n\\+ 文字"],
      ["番号の印", "<p>1. 文字</p><p>1) 文字</p>", "1\\. 文字\n\n1\\) 文字"],
      ["見出しと引用", "<p># 文字</p><p>&gt; 文字</p><p>= 文字</p>", "\\# 文字\n\n&gt; 文字\n\n\\= 文字"],
      ["参照とユーザー", "<code>x</code> #123 と @user", "`x` #123 と @user"],
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name);
  }
  await assertFormats(options, table("<p>: 説明</p><p>~ 説明</p>"), markdownTable("\\: 説明\n\n\\~ 説明"), "説明の印");
});

test("先に使われたリスト・太字・斜体の記号に合わせ、セルの外を変えない", async (t) => {
  const options = await project(t);
  const prefix = lines("* 外の項目", "", "__太字__ と _斜体_", "");
  await assertFormats(options, prefix + table("<ul><li><strong>太字</strong> と <em>斜体</em></li></ul>"),
    prefix + markdownTable("* __太字__ と _斜体_"), "consistent の記号");
  const japanese = lines("_latin_", "");
  await assertFormats(options, japanese + table("日本の<em>語</em>です <code>x</code>"),
    japanese + markdownTable("日本の<em>語</em>です `x`"), "全角の間では _ にしない");
});

test("対象外のセルと描画の違うセルは HTML のまま残す", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  const cells = [
    ["文字だけ", "文字だけ"], ["br だけ", "a<br>b"], ["kbd だけ", "<kbd>Ctrl</kbd>+<kbd>C</kbd>"],
    ["見出し", "<h3>見出し!</h3><code>x</code>"], ["強調だけ", "<b>必須</b>"], ["段落の強調だけ", "<p><em>必須</em></p>"],
    ["入れ子の表", "<code>x</code><table><tr><td>内</td></tr></table>"],
    ["コメント", "<!-- 注 --><code>x</code>"], ["宣言", "<!DOCTYPE html><code>x</code>"],
    ["div", "<div><code>x</code></div>"], ["details", "<details><summary>注</summary><code>x</code></details>"],
    ["hr", "<code>x</code><hr>"], ["生の文字", "<script>x</script><code>x</code>"],
    ["未知の属性", '<code class="x">x</code>'], ["リンクの属性", '<a href="a" target="_blank">x</a>'],
    ["リンクの端の空白", '<a href="a"> x</a>'], ["URL の空白", '<a href="a b">x</a>'],
    ["alt の改行", '<img src="a" alt="一\n二">'], ["コードの片側の空白", "<code> x</code>"],
    ["コードの改行", "<code>x\ny</code>"], ["kbd の改行", "<code>x</code><kbd>a\nb</kbd>"],
    ["不完全な実体参照", "<code>x</code> &copy 2024"], ["数値参照", "<code>x</code> &#128;"],
    ["守る記法の中の記号", "<code>x</code> [[a_b]]"],
    ["同種の隣り合うリスト", "<ul><li>一</li></ul><ul><li>二</li></ul>"],
    ["0 と 1 以外の開始番号", '<ol start="3"><li>三</li><li>四</li></ol>'],
    ["行頭に出る include", "<p>::include{file=a.md}</p>"], ["引用の行頭の include", "<blockquote>::include{file=a.md} <code>x</code></blockquote>"],
    ["項目の行頭の include", "<ul><li>::include{file=a.md}</li></ul>"],
    ["段落が混ざる項目", "<ul><li>一</li><li><p>二</p></li></ul>"],
    ["説明の複数ブロック", "<dl><dt>語</dt><dd><p>一</p><p>二</p></dd></dl>"],
  ];
  for (const language of ["mermaid", "plantuml", "kroki", "kroki-mermaid", "geojson", "topojson", "stl", "suggestion", "math"]) {
    cells.push([language, '<pre><code class="language-' + language + '">x</code></pre>']);
  }
  for (const [name, html] of cells) await assertFormats(options, table(html), table(html), name);
  for (const [name, input] of [
    ["表の外の td", lines("<td><code>x</code></td>")],
    ["暗黙の閉じ", lines("<table><tr><td><code>x</code><td>二</td></tr></table>")],
    ["既に Markdown", markdownTable("`x` と **太字**")],
    ["パイプの表", lines("| 列 |", "| --- |", "| <code>x</code> |")],
  ]) await assertFormats(options, input, input, name);
});

test("CommonMark の形でないセルのタグと中のタグは、Markdown に変えない", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  for (const flavor of ["glfm", "gfm"]) {
    const settings = { ...options, flavor };
    for (const html of [
      '<a/href="u0">リンク</a><img src=a0.png>',
      '<a href="u0"/title="v">リンク</a><img src=a0.png>',
      '<a title="t0"href="u0">リンク</a><img src=a0.png>',
      '<a href="u0">リンク</a\u00a0><img src=a0.png>',
    ]) await assertFormats(settings, table(html), table(html), flavor + ": 中のタグ: " + html);
    for (const tag of ["td", "th"]) {
      const opening = lines('<table><tr><' + tag + ' title="t0"data-x=y><img src=a0.png></' + tag + '></tr></table>');
      await assertFormats(settings, opening, opening, flavor + ": " + tag + " の開きタグの属性の間の空白");
      const closing = lines("<table><tr><" + tag + "><img src=a0.png></" + tag + "/></tr></table>");
      await assertFormats(settings, closing, closing, flavor + ": " + tag + " の閉じタグの /");
    }
  }
});

test("成り立たない強調とつながる区切りは HTML のまま残す", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    await assertFormats({ ...options, flavor }, table("<strong>「重要」</strong>です <code>x</code>"),
      markdownTable("<strong>「重要」</strong>です `x`"), flavor + ": flanking");
    await assertFormats({ ...options, flavor }, table("<b>a</b><b>b</b> <code>x</code>"),
      markdownTable("<b>a</b><b>b</b> `x`"), flavor + ": 隣り合う強調");
  }
});

test("引用・loose のリストと、前の断片で開いた表でも接頭辞を保つ", async (t) => {
  const options = { ...await project(t), fixes: { tight_lists: false } };
  const source = table("<code>x</code> を使う");
  const expected = markdownTable("`x` を使う");
  const quote = (text) => text.trimEnd().split("\n").map((row) => row ? "> " + row : ">").join("\n") + "\n";
  const list = (text) => "- 項目\n\n" + text.trimEnd().split("\n").map((row) => row ? "  " + row : "").join("\n") + "\n";
  await assertFormats(options, quote(source), quote(expected), "引用");
  await assertFormats(options, list(source), list(expected), "loose のリスト");
  await assertFormats(options, quote(list(source)), quote(list(expected)), "引用の中のリスト");
  await assertFormats(options, lines(">>>", ...source.trimEnd().split("\n"), ">>>"),
    lines(">>>", ...expected.trimEnd().split("\n"), ">>>"), "複数行の引用");
  const split = lines("<table>", "<tr><td>", "", "既存の Markdown", "", "</td><td><code>x</code> を使う</td></tr>", "</table>");
  const splitExpected = lines("<table>", "<tr>", "<td>", "", "既存の Markdown", "", "</td>", "<td>", "", "`x` を使う", "", "</td>", "</tr>", "</table>");
  await assertFormats(options, split, splitExpected, "前の断片の table");
});

test("詰まったリスト・説明・脚注は変えず、tight_lists を先に適用する", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  const source = table("<code>x</code>").trimEnd();
  for (const [name, input] of [
    ["tight の項目", lines("- 項目", "  " + source, "- 次")],
    ["HTML だけの項目", lines("- " + source)],
    ["説明", lines("用語", ": " + source)],
    ["長い脚注の名前", lines("本文[^長い名前]", "", "[^長い名前]: " + source)],
  ]) await assertFormats(options, input, input, name);
  const loose = lines("- 項目", "", "  " + source, "", "- 次");
  const tight = lines("- 項目", "  " + source, "- 次");
  await assertFormats(options, loose, tight, "先に詰める");
  const frontMatter = lines("---", 'title: "<table><tr><td><code>x</code></td></tr></table>"', "---", "");
  await assertFormats(options, frontMatter + table("<code>y</code>"), frontMatter + compactTable("`y`"), "front matter");
});

test("GFM の見出し付き alert の接頭辞と原文を保つ", async (t) => {
  const options = { ...await project(t), flavor: "gfm" };
  const input = lines("> [!NOTE] 題", ">", "> <table><tr><td><code>x</code></td></tr></table>");
  const expected = input;
  await assertFormats(options, input, expected, "見出し付き alert");
});

test("範囲整形では HTML ブロックが選択に収まるセルだけを変える", async (t) => {
  const options = await project(t);
  const first = table("<code>一</code>");
  const second = table("<code>二</code>");
  const input = first + "\n" + second;
  await assertFormats({ ...options, range: { start: [3, 0], end: [3, Infinity] } }, input,
    first + "\n" + markdownTable("`二`"), "2 つ目だけ");
  await assertFormats({ ...options, range: { start: [3, 5], end: [3, Infinity] } }, input, input, "途中から");
  const multiline = lines("<table>", "<tr><td><code>x</code></td></tr>", "</table>");
  await assertFormats({ ...options, range: { start: [2, 0], end: [2, Infinity] } }, multiline, multiline, "ブロックの一部");
});

test("html_cells の設定・CLI と html の独立した無効化", async (t) => {
  const options = await project(t);
  const input = table("<code>x</code>");
  const indented = lines("<table>", "  <tr>", "    <td><code>x</code></td>", "  </tr>", "</table>");
  for (const name of ["html_cells", "HTML_CELLS"]) {
    await assertFormats({ ...options, fixes: { [name]: false } }, input, indented, name);
  }
  await assertFormats({ ...options, fixes: { html: false } }, input, compactTable("`x`"), "html だけ無効");
  await assertFormats({ ...options, fixes: { html: false, html_cells: false } }, input, input, "両方無効");
  await assert.rejects(formatMarkdown(input, { ...options, fixes: { html_cell: false } }), /分類名にもルール名にも/u);
  await assert.rejects(formatMarkdown(input, { ...options, fixes: { html_cells: true, HTML_CELLS: false } }), /有効と無効の両方/u);
  const cli = (args) => {
    const result = spawnSync(process.execPath, [formatterPath, "--runtime-dir", runtimeDir, "--filename", options.filename, ...args],
      { cwd: options.cwd, input, encoding: "utf8", timeout: 15000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    return result.stdout;
  };
  assert.equal(cli([]), markdownTable("`x`"));
  assert.equal(cli(["--disable-fixes", "html_cells"]), indented);
  await writeFile(path.join(options.cwd, ".md-format.json"), JSON.stringify({ fixes: { html_cells: false } }));
  assert.equal(cli([]), indented);
});

test("CRLF の文書は CRLF のままセルを変える", async (t) => {
  const options = await project(t);
  await assertFormats(options, table("<code>x</code>").replaceAll("\n", "\r\n"),
    markdownTable("`x`").replaceAll("\n", "\r\n"), "CRLF");
});

test("セルの比べる正規化は、属性・実体参照・URL をそろえ、既定の比較を変えない", () => {
  const normalize = (html) => htmlInternals.normalizedHtml(html, flavors.glfm, 0, null, semantic);
  for (const [a, b] of [
    ['<a title="&quot;" href="https://例.jp/a">文字&nbsp;&#39;</a>', '<a href="https://%E4%BE%8B.jp/a" title=\'"\'>文字\u00a0\'</a>'],
    ['<input type=checkbox disabled checked>', '<input checked="" disabled="" type="checkbox" />'],
    ['<img alt="一&amp;二" src="a.png">', '<img src=a.png alt="一&二" />'],
    ['<span title="先" title="後">文字</span>', '<span title="先">文字</span>'],
  ]) {
    assert.equal(normalize(a), normalize(b), a + " と " + b);
    assert.notEqual(htmlInternals.normalizedHtml(a), htmlInternals.normalizedHtml(b), "既定の比較は緩めない");
  }
  for (const [a, b] of [
    ['<script>&amp;</script>', '<script>&</script>'],
    ['<style>&amp;</style>', '<style>&</style>'],
    ['<svg><path /></svg>', '<svg><path></svg>'],
    ['<math><mi /></math>', '<math><mi></math>'],
    ['<code>a  b</code>', '<code>a b</code>'],
    ['<span title="一">文字</span>', '<span title="二">文字</span>'],
  ]) assert.notEqual(normalize(a), normalize(b), "保つべき差: " + a + " と " + b);
});

test("文書全体の描画で落ちるセルを外して、隣のセルを変える", async (t) => {
  const options = await project(t);
  for (const rejectedFirst of [true, false]) {
    const rejected = "<td><code>x</code> [^note]</td>";
    const accepted = "<td><code>y</code></td>";
    const input = lines("<table><tr>" + (rejectedFirst ? rejected + accepted : accepted + rejected) + "</tr></table>", "", "[^note]: 脚注");
    const acceptedRows = ["<td>", "", "`y`", "", "</td>"];
    const expected = lines("<table>", "<tr>", ...(rejectedFirst ? [rejected, ...acceptedRows] : [...acceptedRows, rejected]),
      "</tr>", "</table>", "", "[^note]: 脚注");
    await assertFormats(options, input, expected, rejectedFirst ? "落ちるセルが先" : "落ちるセルが後");
  }
});

test("別のセルの変換で表の部品の字下げをそろえ、書式の無いセルを保つ", async (t) => {
  const options = await project(t);
  const input = lines('<table><tr><td>a<br>b</td><td colspan="2"><code>dnf</code> で <b>root</b> として入れる</td></tr></table>');
  const expected = lines("<table>", "<tr>", "<td>a<br>b</td>", '<td colspan="2">', "", "`dnf` で **root** として入れる", "", "</td>", "</tr>", "</table>");
  const expectedHtml = '<table><tr><td>a<br>b</td><td colspan="2"><p><code>dnf</code> で <strong>root</strong> として入れる</p></td></tr></table>';
  await assertFormats(options, input, expected, "混在するセル", expectedHtml);
});

test("元の HTML の字下げを本文に持ち込まず、タブと端の空白を整える", async (t) => {
  const options = await project(t);
  const input = lines("<table>", "  <tr>", "    <td><p>  一\t二  </p></td>", "  </tr>", "</table>");
  await assertFormats(options, input, markdownTable("一 二"), "字下げと本文の空白");
  await assertFormats(options, table('<code>x</code> と <span class="note">文字</span>'),
    markdownTable('`x` と <span class="note">文字</span>'), "通常のインライン HTML");
});

test("_ の太字と斜体は全角の間で残し、空白のある位置では文書の記号に合わせる", async (t) => {
  const options = await project(t);
  const prefix = lines("__latin__ と _latin_", "");
  const input = table("日本の<strong>強調</strong>です <em>latin</em> と <code>x</code>");
  const expected = markdownTable("日本の<strong>強調</strong>です _latin_ と `x`");
  for (const flavor of ["glfm", "gfm"]) await assertFormats({ ...options, flavor }, prefix + input, prefix + expected, flavor + ": _ の位置");
});

test("pre の言語は code と lang から読み、同じ言語だけを移す", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const html of [
      '<pre lang="text"><code>x</code></pre>',
      '<pre lang="text"><code class="language-text">x</code></pre>',
      '<pre><code class="language-text">x</code></pre>',
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable("```text\nx\n```"), flavor + ": " + html);
  }
});

test("属性の重複・未対応属性・pre の言語の食い違いはセルごと残す", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  for (const [name, html] of [
    ["href の重複", '<a href="a" HREF="b">文字</a>'],
    ["p の属性", '<p class="note">段落</p>'],
    ["img の未対応属性", '<img src="a.png" width="20">'],
    ["pre の未対応属性", '<pre id="x">x</pre>'],
    ["lang の重複", '<pre lang="text" lang="sh">x</pre>'],
    ["言語の食い違い", '<pre lang="text"><code class="language-sh">x</code></pre>'],
    ["class の混在", '<pre><code class="language-sh extra">x</code></pre>'],
    ["先頭以外のチェックボックス", '<ul><li>文字<input type="checkbox"></li></ul>'],
    ["説明の段落", '<dl><dt>用語</dt><dd><p>説明</p></dd></dl>'],
  ]) await assertFormats(options, table(html), table(html), name);
});

test("長い文書と対象の無い断片を混ぜても、2 回目と近道の有無で同じになる", async (t) => {
  const options = await project(t, { default: false });
  const plain = table("a<br>b");
  const mixed = Array.from({ length: 36 }, (_, index) => index % 4 === 0 ? table("<code>x" + index + "</code>") : plain).join("\n");
  const expected = Array.from({ length: 36 }, (_, index) => index % 4 === 0 ? markdownTable("`x" + index + "`") :
    lines("<table>", "  <tr>", "    <td>a<br>b</td>", "  </tr>", "</table>")).join("\n");
  await assertFormats(options, mixed, expected, "複数の表");
  for (const [name, input] of [
    ["閉じタグだけ", lines("</td><code>x</code>")],
    ["属性だけにタグ名", table('<span title="code">文字</span>')],
    ["表の外のタグ", lines("普通の <code>x</code> と文字。")],
    ["フェンスの中の表", lines("```html", table("<code>x</code>").trimEnd(), "```")],
    ["空行をまたぐ既存の Markdown", markdownTable('<span title="x">文字</span>')],
  ]) {
    const disabled = await formatMarkdown(input, { ...options, fixes: { html_cells: false } });
    await assertFormats(options, input, disabled, name);
  }
});

test("空の pre も空のコードフェンスにする", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const html of ["<pre></pre>", "<pre><code></code></pre>"]) {
      await assertFormats({ ...options, flavor }, table(html), markdownTable("```\n\n```"), flavor + ": " + html);
    }
  }
});

test("loose の段落内のチェックボックスは、p の外へ移るのでセルを残す", async (t) => {
  const options = { ...await project(t), fixes: { tight_lists: false, html: false } };
  const input = table('<ul><li><p><input type="checkbox">未完</p></li><li><p><input checked type="checkbox" disabled>完了</p></li></ul>');
  for (const flavor of ["glfm", "gfm"]) {
    await assertFormats({ ...options, flavor }, input, input, flavor + ": loose のタスクは移動しない");
  }
});

test("GLFM の同じ用語に続く複数の dd を説明リストにする", async (t) => {
  const options = await project(t);
  await assertFormats(options, table("<dl><dt>用語</dt><dd>説明1</dd><dd>説明2</dd></dl>"),
    markdownTable("用語\n: 説明1\n: 説明2"), "複数の説明");
});

test("共通の数値参照は保ち、HTML と意味の違う数値参照はセルを残す", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    await assertFormats({ ...options, flavor }, table("<code>x</code> &#120;"), markdownTable("`x` &#120;"), flavor + ": 同じ文字の数値参照");
    await assertFormats({ ...options, flavor }, table("<code>&#120;</code>"), markdownTable("`x`"), flavor + ": コード内の数値参照");
    const input = table("<code>x</code> &#128;");
    await assertFormats({ ...options, flavor, fixes: { html: false } }, input, input, flavor + ": 意味の違う数値参照");
  }
});


test("未引用属性の末尾の / を値として保ち、別の画像や checkbox に変えない", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    const settings = { ...options, flavor, fixes: { html: false } };
    await assertFormats(settings, table("<img src=a/>"), compactTable("![](a/)"), flavor + ": src の末尾の /",
      table('<p><img alt="" src=a/></p>'));
    await assertFormats(settings, table("<img src=a title=t/>"), compactTable('![](a "t/")'), flavor + ": title の末尾の /",
      table('<p><img alt="" src=a title=t/></p>'));
    const checkbox = table("<ul><li><input type=checkbox/>完了</li></ul>");
    await assertFormats(settings, checkbox, checkbox, flavor + ": checkbox/ はタスクにしない");
  }
});


test("セルから作った loose のリストも既定では同じ保存で詰め、2 回目で変えない", async (t) => {
  const options = await project(t);
  for (const flavor of ["glfm", "gfm"]) {
    for (const [name, html, markdown, expected] of [
      ["ul", "<ul><li><p>一</p></li><li><p>二</p></li></ul>", "- 一\n- 二", "<ul><li>一</li><li>二</li></ul>"],
      ["ol", "<ol><li><p>一</p></li><li><p>二</p></li></ol>", "1. 一\n2. 二", "<ol><li>一</li><li>二</li></ol>"],
    ]) await assertFormats({ ...options, flavor }, table(html), markdownTable(markdown), flavor + ": " + name, table(expected));
  }
});


test("全角空白と NBSP を文字として保ち、リストの間の文字を消さない", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  for (const flavor of ["glfm", "gfm"]) {
    await assertFormats({ ...options, flavor }, table("<p>　日本語 </p>"), compactTable("　日本語 "), flavor + ": 本文の全角空白");
    for (const gap of ["　", " ", "&nbsp;"]) {
      const input = table("<ul><li>一</li>" + gap + "<li>二</li></ul>");
      await assertFormats({ ...options, flavor }, input, input, flavor + ": 項目の間の文字を残す");
    }
  }
});

test("GLFM の行頭の ::include は HTML のまま残し、GFM と [TOC] は Markdown にする", async (t) => {
  const options = { ...await project(t), fixes: { html: false } };
  // ::include は、Markdown の行頭でだけ働く (HTML のブロックの中では働かない)。GFM には無い記法なので、文字として Markdown にする。
  await assertFormats({ ...options, flavor: "gfm" }, table("<p>::include{file=a.md}</p>"), compactTable("::include{file=a.md}"), "GFM の include");
  // GitLab は、HTML の <p>[TOC]</p> も Markdown の [TOC] の段落も目次にする (2026-10-16 に gitlab.com の Markdown API で確かめた)。
  await assertFormats(options, table("<p>[TOC]</p>"), compactTable("[TOC]"), "GLFM の目次");
  // 行の途中の ::include は働かないので、ほかのセルと同じく Markdown にする。
  await assertFormats(options, table("<code>x</code> と ::include{file=a.md}"), compactTable("`x` と ::include{file=a.md}"), "行の途中の include");
});

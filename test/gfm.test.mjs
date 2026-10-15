import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { formatMarkdown } from "../format.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const sparePath = path.join(packageDir, "spare.mjs");
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { markdownToHTML, parseMarkdown } = runtimeRequire("comrak");
const { lint: lintMarkdown } = await import(pathToFileURL(runtimeRequire.resolve("markdownlint/promise")));
const parserOptions = {
  extension: { table: true, strikethrough: true, autolink: true, tasklist: true, footnotes: true,
    mathDollars: true, mathCode: true, alerts: true, tagfilter: true },
  parse: { leaveFootnoteDefinitions: true },
  render: { unsafe: true },
};

async function project(t, rules = { MD009: true }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "md-format-gfm-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: false, ...rules }));
  return { cwd, filename: path.join(cwd, "文書.md"), runtimeDir, flavor: "gfm" };
}

function rendered(text) {
  return markdownToHTML(text, parserOptions);
}

async function candidateRules(input, config) {
  const results = await lintMarkdown({ strings: { fixture: input }, config: { default: false, ...config } });
  return new Set(results.fixture.filter((result) => result.fixInfo).map((result) => result.ruleNames[0]));
}

function cli(options, input, args = [], { filename = options.filename, cwd = options.cwd } = {}) {
  const argv = ["--runtime-dir", runtimeDir, ...(filename ? ["--filename", filename] : []), ...args];
  const result = spawnSync(process.execPath, [formatterPath, ...argv], { cwd, input, encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "CLI が時間切れにならない");
  return result;
}

function successful(result, expected) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
}

test("方言の既定値は GLFM で、不正な方言は日本語で拒む", async (t) => {
  const options = await project(t);
  const input = "+++\ntitle: text \n+++\n\n本文 \n";
  const { flavor, ...defaults } = options;
  assert.equal(await formatMarkdown(input, defaults), await formatMarkdown(input, { ...options, flavor: "glfm" }));
  for (const invalid of ["GFM", "commonmark", "", null, 1]) {
    await assert.rejects(formatMarkdown(input, { ...options, flavor: invalid }), /方言.*gfm.*glfm/u);
  }
});

test("GFM の Issue 参照を行頭でも見出しにせず、周囲の空白だけを直す", async (t) => {
  const rules = { MD009: true, MD018: true, MD020: true };
  const options = await project(t, rules);
  const input = "#123 の対応 \n\n#456 で修正した \n\n##1 章 \n\n#Heading \n";
  assert.ok((await candidateRules(input, rules)).has("MD018"));
  assert.equal(await formatMarkdown(input, { ...options, fixes: { heading_conversion: true } }),
    "#123 の対応\n\n#456 で修正した\n\n##1 章\n\n# Heading\n");
});

test("GFM の参照・SHA・絵文字・脚注の名前は固有名詞の修正でも保つ", async (t) => {
  const rules = { MD009: true, MD044: { names: ["GH", "Owner", "User", "Org", "Abcdef0", "Abcdef0123456789abcdef0123456789abcdef01", "Smile", "Note"] } };
  const options = await project(t, rules);
  const atoms = ["gh-123", "owner/repo#123", "@user", "@org/team", "abcdef0", "abcdef0123456789abcdef0123456789abcdef01",
    "user@abcdef0", "owner/repo@abcdef0", ":smile:", "[^note]"];
  for (const atom of atoms) {
    assert.ok((await candidateRules(atom + "\n", rules)).has("MD044"), atom);
  }
  const input = atoms.map((atom) => atom + " ").join("\n\n") + "\n\nuser は本文 \n";
  const expected = atoms.join("\n\n") + "\n\nUser は本文\n";
  assert.equal(await formatMarkdown(input, options), expected);
  assert.equal(await formatMarkdown(expected, options), expected);
});

test("GFM に無い GitLab 専用の記法は普通の文字として整形する", async (t) => {
  const options = await project(t, { MD044: { names: ["Bug"] }, MD049: { style: "asterisk" } });
  const input = "~bug と %bug と [[_手順_]]\n";
  assert.equal(await formatMarkdown(input, options), "~Bug と %Bug と [[*手順*]]\n");
  assert.equal(await formatMarkdown(input, { ...options, flavor: "glfm" }), input);
});

test("GFM のタスクは空欄と x と X だけで、通常のリストと並べても描画を保つ", async (t) => {
  const options = await project(t, { MD004: { style: "dash" }, MD009: true });
  const input = "* [ ] 未完了 \n* [x] 完了 \n* [X] 完了 \n* [~] 通常 \n";
  const html = rendered(input);
  assert.equal((html.match(/type="checkbox"/gu) || []).length, 3);
  assert.ok(html.includes("[~] 通常"));
  const output = await formatMarkdown(input, options);
  assert.equal(output, input.replace(/^\*/gmu, "-").replace(/ +$/gmu, ""));
  assert.equal(rendered(output), html);
  assert.equal(await formatMarkdown(output, options), output);
});

test("GFM では緩いタスク判定を使わず、角括弧内の通常の文字を直せる", async (t) => {
  const rules = { MD044: { names: ["A"] } };
  const options = await project(t, rules);
  const input = "- [a] 例\n";
  assert.ok((await candidateRules(input, rules)).has("MD044"));
  assert.equal(await formatMarkdown(input, options), "- [A] 例\n");
  assert.equal(await formatMarkdown(input, { ...options, flavor: "glfm" }), input);
});

test("GFM の通常と小文字の alerts は本文の安全な修正と共存する", async (t) => {
  const options = await project(t, { MD009: true, MD027: true });
  for (const kind of ["NOTE", "note", "WARNING", "warning"]) {
    const input = `> [!${kind}]\n>  本文 \n\n外の本文 \n`;
    const output = await formatMarkdown(input, options);
    assert.equal(output, `> [!${kind}]\n> 本文\n\n外の本文\n`);
    assert.equal(rendered(output), rendered(input));
  }
});

test("GFM の題付き alerts は GitHub と Comrak の差を避けて範囲全体を保つ", async (t) => {
  const options = await project(t, { MD009: true, MD027: true, MD044: { names: ["Word"] } });
  for (const kind of ["NOTE", "note"]) {
    const alert = `> [!${kind}] 題 \n>  word \n`;
    const input = "外の本文 \n\n" + alert + "\nword \n";
    assert.ok((await candidateRules(alert, { MD009: true, MD027: true })).has("MD009"));
    assert.equal(await formatMarkdown(input, options), "外の本文\n\n" + alert + "\nWord\n");
  }
});

test("GFM の入れ子の alerts (GitHub では普通の引用) と、題付き alerts の中の loose のリストには触れない", async (t) => {
  const options = await project(t, { MD009: true, MD027: true });
  for (const alert of ["> > [!NOTE]\n> >  入れ子 \n", "- > [!NOTE]\n  >  リストの中 \n", "> [!NOTE] 題\n> - a\n>\n> - b\n"]) {
    const input = alert + "\n外の本文 \n";
    assert.equal(await formatMarkdown(input, options), alert + "\n外の本文\n", JSON.stringify(alert));
  }
  // 文書の直下の題の無い alerts は、ふつうに整形する。
  assert.equal(await formatMarkdown("> [!NOTE]\n>  本文 \n", options), "> [!NOTE]\n> 本文\n");
});

test("GFM の題付き alerts の中の HTML は保ち、外の HTML だけを整形する", async (t) => {
  const options = await project(t);
  const alert = "> [!NOTE] 題\n> <div><p>中の本文</p></div>\n";
  const input = alert + "\n<div><p>外の本文</p></div>\n";
  assert.equal(parseMarkdown(input, parserOptions).nodes.filter((node) => node.data.value?.HtmlBlock).length, 2);
  const expected = alert + "\n<div>\n  <p>外の本文</p>\n</div>\n";
  assert.equal(await formatMarkdown(input, options), expected);
  assert.equal(await formatMarkdown(expected, options), expected);
});

test("GFM の脚注の定義と参照を保ち、別の本文は整形する", async (t) => {
  const options = await project(t, { MD009: true, MD044: { names: ["Note"] } });
  const input = "本文[^note] \n\n[^note]: 脚注 \n    続き \n\n外の本文 \n";
  const output = await formatMarkdown(input, options);
  assert.equal(output, "本文[^note]\n\n[^note]: 脚注\n    続き\n\n外の本文\n");
  assert.equal(rendered(output), rendered(input));
});

test("GFM の表は列の空白を揃え、セルの数式は保つ", async (t) => {
  const options = await project(t, { MD009: true, MD060: { style: "compact" } });
  const input = "|a| 数式  |\n|---|---|\n|  1|$x_y$|\n\n本文 \n";
  assert.ok((await candidateRules(input, { MD060: { style: "compact" } })).has("MD060"));
  const output = await formatMarkdown(input, options);
  assert.notEqual(output, input);
  assert.equal(rendered(output), rendered(input));
  assert.ok(output.includes("$x_y$"));
  assert.equal(await formatMarkdown(output, options), output);
});

test("GFM のドル・バッククォート付きドル・表示数式・math フェンスの中身を保つ", async (t) => {
  const options = await project(t, { MD009: true, MD010: true, MD038: true, MD044: { names: ["Word"] }, MD049: true });
  const math = "$word_x$ と $`word_y`$\n\n$$\nword_z \n$$\n\n```math\nword_w \n```\n";
  const input = math + "\nword \n";
  const output = await formatMarkdown(input, options);
  assert.equal(output, math + "\nWord\n");
  assert.ok(parseMarkdown(math, parserOptions).nodes.some((node) => node.data.value?.Math));
});

test("GFM の YAML front matter だけを本文の修正から除く", async (t) => {
  const options = await project(t);
  const yaml = "---\ntitle: text \n---\n\n本文 \n";
  assert.equal(await formatMarkdown(yaml, options), yaml.replace("本文 \n", "本文\n"));
  for (const marker of ["+++", ";;;"]) {
    const input = `${marker}\ntitle: text \n${marker}\n\n本文 \n`;
    assert.equal(await formatMarkdown(input, options), input.replace(/ +$/gmu, ""), marker);
    assert.equal(await formatMarkdown(input, { ...options, flavor: "glfm" }), input.replace("本文 \n", "本文\n"), marker);
  }
  const json = '{\n"title": "text", \n"value": true\n}\n\n本文 \n';
  assert.equal(await formatMarkdown(json, options), json.replace(/ +$/gmu, ""));
});

test("GFM は空の YAML front matter と改行の種類を保つ", async (t) => {
  const options = await project(t, { MD009: true, MD012: true, MD018: true, MD022: true });
  for (const ending of ["\n", "\r\n"]) {
    for (const body of ["", "\n"]) {
      const matter = "---\n" + body + "---\n";
      const input = (matter + "\n#Heading \n\n本文 \n").replaceAll("\n", ending);
      const expected = (matter + "\n# Heading\n\n本文\n").replaceAll("\n", ending);
      const settings = { ...options, fixes: { heading_conversion: true } };
      assert.equal(await formatMarkdown(input, settings), expected);
      assert.equal(await formatMarkdown(expected, settings), expected);
    }
  }
});

test("GFM の説明リスト風の本文に投影せず、4 スペースのコードを保つ", async (t) => {
  const options = await project(t, { MD007: true, MD009: true });
  const input = "用語\n: 説明 \n\n    - 子 \n      - 孫 \n";
  assert.equal(await formatMarkdown(input, options), input.replace(": 説明 \n", ": 説明\n"));
  assert.equal(await formatMarkdown(input, { ...options, flavor: "glfm" }), "用語\n: 説明\n\n  - 子\n    - 孫\n");
  assert.ok(!rendered(input).includes("<dl>"));
  assert.ok(rendered(input).includes("<pre><code>"));
});

test("GFM の >>> は GLFM の複数行引用として扱わない", async (t) => {
  const options = await project(t, { MD009: true, MD018: true });
  const input = ">>>\n#Heading \n>>>\n";
  const output = await formatMarkdown(input, { ...options, fixes: { heading_conversion: true } });
  assert.equal(output, ">>>\n# Heading\n>>>\n");
  assert.equal(await formatMarkdown(input, { ...options, flavor: "glfm", fixes: { heading_conversion: true } }), input.replace("#Heading \n", "#Heading\n"));
});

test("GFM でも残る HTML のブロックは整形できる", async (t) => {
  const options = await project(t);
  const input = "<div><p>本文</p><ul><li>一</li><li>二</li></ul></div>\n";
  const expected = "<div>\n  <p>本文</p>\n  <ul>\n    <li>一</li>\n    <li>二</li>\n  </ul>\n</div>\n";
  assert.equal(await formatMarkdown(input, options), expected);
  assert.equal(await formatMarkdown(expected, options), expected);
});

test("GFM の消毒で消えるタグの端に描画される空白を足さない", async (t) => {
  const options = await project(t);
  for (const tag of ["header", "article", "aside", "figure", "footer", "main", "nav", "search"]) {
    const input = `<div><${tag}><b>a</b></${tag}><i>b</i></div>\n`;
    const output = await formatMarkdown(input, options);
    assert.equal(output.replace(/^<div>\n[ \t]*/u, "<div>").replace(/\n<\/div>\n$/u, "</div>\n"), input, tag);
    const beautifyHtml = (text) => text.replace(`</${tag}><i>`, `</${tag}>\n<i>`);
    assert.equal(await formatMarkdown(input, { ...options, beautifyHtml }), input, `${tag}: 消えるタグとインライン要素の間には空白を足さない`);
  }
  const input = "<div><header><b>a</b></header><i>b</i></div>\n";
  assert.notEqual(await formatMarkdown(input, { ...options, flavor: "glfm" }), input);
  // 表の外の表の部品と、空要素の閉じタグ (HTML の解析で捨てられ、GitHub は中の文字と後ろの空白を出す)。方言によらない。
  for (const [open, close] of [["td", "td"], ["tr", "tr"], ["th", "th"], ["thead", "thead"], ["tbody", "tbody"], ["tfoot", "tfoot"], ["hr", "hr"]]) {
    const element = `<div><${open}><b>a</b></${close}><i>b</i></div>\n`;
    const beautifyHtml = (text) => text.replace(`</${close}><i>`, `</${close}>\n<i>`);
    for (const flavor of ["gfm", "glfm"]) {
      assert.equal(await formatMarkdown(element, { ...options, flavor, beautifyHtml }), element, `${open} (${flavor})`);
    }
  }
  // 本物の表の中の部品の間は、今までどおり字下げできる。
  const table = "<table><tr><td>a</td><td>b</td></tr></table>\n";
  assert.equal(await formatMarkdown(table, options),
    "<table>\n  <tr>\n    <td>a</td>\n    <td>b</td>\n  </tr>\n</table>\n");
});

test("GFM の tagfilter で文字になるタグの前後も保つ", async (t) => {
  const options = await project(t);
  for (const tag of ["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"]) {
    const input = `<div><${tag}>a</${tag}><i>b</i></div>\n`;
    assert.ok(rendered(input).includes(`&lt;${tag}>`), tag);
    const output = await formatMarkdown(input, options);
    assert.equal(output.replace(/^<div>\n[ \t]*/u, "<div>").replace(/\n<\/div>\n$/u, "</div>\n"), input, tag);
    const beautifyHtml = (text) => text.replace(`</${tag}><i>`, `</${tag}>\n<i>`);
    assert.equal(await formatMarkdown(input, { ...options, beautifyHtml }), input, `${tag}: 文字になるタグの直後の空白を変えない`);
  }
});

test("GFM の MD051 は断片の大文字小文字だけを直す", async (t) => {
  const options = await project(t, { MD051: true });
  const input = "# Title\n\n[移動](#TITLE) と [不明](#missing)\n";
  assert.equal(await formatMarkdown(input, options), "# Title\n\n[移動](#title) と [不明](#missing)\n");
});

test("修正の引数層は設定層のルール名よりも優先する", async (t) => {
  const options = await project(t, { MD009: true, MD026: true });
  const input = "## 見出し: \n\n本文 \n";
  const trimmed = "## 見出し:\n\n本文\n";
  for (const [fixes, projectFixes, expected] of [
    [{ whitespace: true }, { MD009: false, MD026: false }, trimmed],
    [{ whitespace: false }, { MD009: true, MD026: false }, input],
    [{ MD009: true }, { whitespace: false, MD026: false }, trimmed],
    [{ MD009: false }, { whitespace: true, MD026: false }, input],
    [{ whitespace: false, MD009: true }, { MD026: false }, trimmed],
  ]) assert.equal(await formatMarkdown(input, { ...options, fixes, projectFixes }), expected);
  assert.equal(await formatMarkdown(input, { ...options, projectFixes: { MD026: false } }), trimmed);
});

test("修正名の有効と無効の衝突は同じ層だけで拒む", async (t) => {
  const options = await project(t);
  const input = "本文 \n";
  for (const key of ["fixes", "projectFixes"]) {
    await assert.rejects(formatMarkdown(input, { ...options, [key]: { MD009: true, "no-trailing-spaces": false } }), /両方/u);
  }
  assert.equal(await formatMarkdown(input, { ...options, fixes: { MD009: true }, projectFixes: { "no-trailing-spaces": false } }), "本文\n");
  const warnings = [];
  assert.equal(await formatMarkdown(input, { ...options, projectFixes: { future_fix: true }, onWarning: (message) => warnings.push(message) }), "本文\n");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /future_fix/u);
  await assert.rejects(formatMarkdown(input, { ...options, fixes: { future_fix: true } }), /分類名にもルール名にも/u);
});

test("CLI は --filename の親の最初の設定を読み、無いときは GLFM にする", async (t) => {
  const options = await project(t);
  const nested = path.join(options.cwd, "docs", "nested");
  await mkdir(nested, { recursive: true });
  const filename = path.join(nested, "未保存.md");
  const input = "+++\ntitle: text \n+++\n\n本文 \n";
  const glfm = input.replace("本文 \n", "本文\n");
  successful(cli(options, input, [], { filename }), glfm);
  await writeFile(path.join(options.cwd, ".md-format.json"), JSON.stringify({ flavor: "gfm" }));
  successful(cli(options, input, [], { filename }), input.replace(/ +$/gmu, ""));
  await writeFile(path.join(options.cwd, "docs", ".md-format.json"), JSON.stringify({}));
  successful(cli(options, input, [], { filename }), glfm);
  successful(cli(options, input, ["--flavor", "gfm"], { filename }), input.replace(/ +$/gmu, ""));
});

test("CLI は --filename が無い標準入力を cwd の stdin.md として探す", async (t) => {
  const options = await project(t);
  await writeFile(path.join(options.cwd, ".md-format.json"), JSON.stringify({ flavor: "gfm" }));
  const input = "+++\ntitle: text \n+++\n";
  successful(cli(options, input, [], { filename: null }), input.replace(/ +$/gmu, ""));
});

test("CLI のフォルダ整形は文書ごとに方言の設定を探す", async (t) => {
  const options = await project(t);
  const nested = path.join(options.cwd, "gfm");
  await mkdir(nested);
  const input = "+++\ntitle: text \n+++\n\n本文 \n";
  const outer = path.join(options.cwd, "outer.md");
  const inner = path.join(nested, "inner.md");
  await writeFile(outer, input);
  await writeFile(inner, input);
  await writeFile(path.join(options.cwd, ".md-format.json"), JSON.stringify({ flavor: "glfm" }));
  await writeFile(path.join(nested, ".md-format.json"), JSON.stringify({ flavor: "gfm" }));
  const child = cli(options, "", ["--write", options.cwd], { filename: null });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.deepEqual(child.stdout.trimEnd().split("\n").sort(), [path.join("gfm", "inner.md"), "outer.md"].sort());
  assert.equal(await readFile(outer, "utf8"), input.replace("本文 \n", "本文\n"));
  assert.equal(await readFile(inner, "utf8"), input.replace(/ +$/gmu, ""));
});

test("CLI は設定の未知の修正名だけを一行で警告し、既知の指定を使う", async (t) => {
  const options = await project(t);
  const configPath = path.join(options.cwd, ".md-format.json");
  await writeFile(configPath, JSON.stringify({ flavor: "gfm", fixes: { future_fix: true, MD009: false } }));
  const child = cli(options, "本文 \n");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "本文 \n");
  assert.equal(child.stderr.trimEnd().split("\n").length, 1);
  assert.match(child.stderr, /^mdfmt: 警告: .*future_fix/u);
  assert.ok(child.stderr.includes(configPath));
});

test("CLI の修正層は引数の分類から設定のルール名へ降りない", async (t) => {
  const options = await project(t, { MD009: true, MD026: true });
  const configPath = path.join(options.cwd, ".md-format.json");
  const input = "## 見出し: \n\n本文 \n";
  for (const [fixes, args, expected] of [
    [{ MD009: false, MD026: false }, ["--enable-fixes", "whitespace"], "## 見出し:\n\n本文\n"],
    [{ MD009: true, MD026: false }, ["--disable-fixes", "whitespace"], input],
    [{ whitespace: false, MD026: false }, ["--enable-fixes", "MD009"], "## 見出し:\n\n本文\n"],
    [{ whitespace: true, MD026: false }, ["--disable-fixes", "MD009"], input],
  ]) {
    await writeFile(configPath, JSON.stringify({ flavor: "gfm", fixes }));
    successful(cli(options, input, args), expected);
  }
});

test("CLI は壊れた設定や未知のキーと不正な値をパス付きのエラーにする", async (t) => {
  const options = await project(t);
  const configPath = path.join(options.cwd, ".md-format.json");
  for (const source of ["{", "null", "[]", '{"flavour":"gfm"}', '{"flavor":"GFM"}', '{"flavor":null}',
    '{"fixes":[]}', '{"fixes":null}', '{"fixes":{"MD009":"false"}}', '{"fixes":{"future_fix":1}}',
    '{"fixes":{"MD009":true,"no-trailing-spaces":false}}']) {
    await writeFile(configPath, source);
    const child = cli(options, "本文 \n");
    assert.equal(child.status, 2, source + "\n" + child.stderr);
    assert.equal(child.stdout, "", source);
    assert.ok(child.stderr.includes(configPath), child.stderr);
  }
});

test("CLI は不正な --flavor を終了コード 2 で拒み、ヘルプに設定を載せる", async (t) => {
  const options = await project(t);
  for (const args of [["--flavor", "GFM"], ["--flavor", "commonmark"], ["--flavor"], ["--flavor", "gfm", "--flavor", "glfm"]]) {
    const child = cli(options, "本文 \n", args);
    assert.equal(child.status, 2, child.stderr);
    assert.equal(child.stdout, "");
  }
  const help = cli(options, "", ["--help"], { filename: null });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--flavor/u);
  assert.match(help.stdout, /\.md-format\.json/u);
});

function run(t, script, argv, cwd, input) {
  const child = spawn(process.execPath, [script, ...argv], { cwd, timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  child.stdin.end(input);
  return result;
}

test("GFM の設定・引数・警告・エラーでも予備と CLI のバイト列が一致する", async (t) => {
  const options = await project(t, { MD009: true, MD026: true });
  const configPath = path.join(options.cwd, ".md-format.json");
  const input = Buffer.from("+++\ntitle: text \n+++\n\n## 見出し: \n");
  const base = ["--runtime-dir", runtimeDir, "--filename", options.filename];
  const cases = [
    [{ flavor: "gfm" }, [], 0],
    [{ flavor: "glfm" }, ["--flavor", "gfm"], 0],
    [{ flavor: "gfm", fixes: { MD009: false } }, ["--enable-fixes", "whitespace"], 0],
    [{ flavor: "gfm", fixes: { future_fix: true } }, [], 0],
    [{ flavor: "invalid" }, [], 2],
    [{ flavor: "gfm" }, ["--flavor", "invalid"], 2],
  ];
  for (const [config, extra, code] of cases) {
    await writeFile(configPath, JSON.stringify(config));
    const argv = [...base, ...extra];
    const direct = await run(t, formatterPath, argv, options.cwd, input);
    const header = Buffer.from(JSON.stringify({ script: formatterPath, argv, cwd: options.cwd }) + "\n");
    const spare = await run(t, sparePath, ["--runtime-dir", runtimeDir], packageDir, Buffer.concat([header, input]));
    assert.equal(direct.signal, null);
    assert.equal(direct.code, code, direct.stderr.toString());
    assert.deepEqual(spare, direct, "標準出力・標準エラーのバイト列と終了コードが一致する");
  }
});


test("GFM の代表的な文書でも近道の有無で整形結果が変わらない", async (t) => {
  const options = await project(t, { default: true, MD010: { code_blocks: true }, MD044: { names: ["User", "Org", "Word"] } });
  const documents = [
    "# 整形済み\n\n本文です。\n",
    "本文 @user と org/repo#123 と gh-123 と abcdef0 と :smile: \n\n#123 の対応 \n\n#Heading \n",
    "$ word_x $ と $`word_y`$ と ` a` と `a `\n\n```text\n\tコード \n```\n",
    "用語\n: 説明 \n\n    - 子 \n      - 孫 \n\n>>>\n#Heading\n>>>\n",
    "> [!note]\n>  本文 \n\n> [!NOTE] 題 \n>  word \n",
    "* [ ] 未完了 \n* [x] 完了 \n* [X] 完了 \n* [~] 通常 \n\n|a| b  |\n|---|---|\n|1|2|\n",
    "---\n---\n\n+++\nword \n+++\n\n[ リンク ](https://example.com) と https://example.com \n",
    "<div><header><b>a</b></header><i>b</i></div>\n\n<div><iframe>a</iframe><i>b</i></div>\n\n<div><p>本文</p></div>\n",
  ];
  for (const [index, document] of documents.entries()) {
    const input = index % 2 ? document.replaceAll("\n", "\r\n") : document;
    const range = { start: [1, 0], end: [Math.min(5, document.split("\n").length), Infinity] };
    for (const selection of [undefined, range]) {
      const settings = { ...options, fixes: { heading_conversion: true }, range: selection };
      const expected = await formatMarkdown(input, { ...settings, exhaustive: true });
      assert.equal(await formatMarkdown(input, settings), expected, `文書 ${index + 1}、${selection ? "範囲" : "全文"}`);
    }
  }
});


test("独自ルール風の未知の設定名も警告して無視する", async (t) => {
  const options = await project(t);
  const warnings = [];
  const fixes = { "future/custom-rule": true };
  assert.equal(await formatMarkdown("本文 \n", { ...options, projectFixes: fixes, onWarning: (message) => warnings.push(message) }), "本文\n");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /future\/custom-rule.*診断にありません.*無視/u);
  const configPath = path.join(options.cwd, ".md-format.json");
  await writeFile(configPath, JSON.stringify({ flavor: "gfm", fixes }));
  const child = cli(options, "本文 \n");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "本文\n");
  assert.equal(child.stderr.trimEnd().split("\n").length, 1);
  assert.match(child.stderr, /^mdfmt: 警告: .*future\/custom-rule/u);
  assert.ok(child.stderr.includes(configPath));
});

test("診断のある独自ルールは設定の別名で無効にでき、引数の層で有効に戻せる", async (t) => {
  const options = await project(t, {});
  await rm(path.join(options.cwd, ".markdownlint.json"));
  await writeFile(path.join(options.cwd, "rule.mjs"), `export default {
  names: ["test-gfm-rule", "test-gfm-alias"],
  description: "行末の空白を直す",
  tags: ["test"],
  parser: "none",
  function(params, onError) {
    params.lines.forEach((line, index) => {
      if (line.endsWith(" ")) onError({ lineNumber: index + 1,
        fixInfo: { editColumn: line.length, deleteCount: 1 } });
    });
  }
};\n`);
  await writeFile(path.join(options.cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config: { default: false, "test-gfm-rule": true }, customRules: ["./rule.mjs"],
  }));
  const warnings = [];
  const settings = { ...options, projectFixes: { "test-gfm-alias": false }, onWarning: (message) => warnings.push(message) };
  assert.equal(await formatMarkdown("本文 \n", settings), "本文 \n");
  assert.deepEqual(warnings, []);
  assert.equal(await formatMarkdown("本文 \n", { ...settings, fixes: { "test-gfm-rule": true } }), "本文\n");
  assert.deepEqual(warnings, []);
});

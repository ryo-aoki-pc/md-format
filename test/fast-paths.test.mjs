import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { formatMarkdown, internals } from "../format.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));

async function inProject(t, rules, callback) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-fast-path-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: false, ...rules }));
  return callback({ filename: path.join(cwd, "example.md"), cwd, runtimeDir });
}

// 失敗を再現できるように、外部の乱数や時刻に依存しない。
function random(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

function result(lineNumber, fixInfo, reportedLine = lineNumber) {
  return { lineNumber: reportedLine, ruleNames: ["MD009"], fixInfo: { lineNumber, ...fixInfo } };
}

function descendingFix(a, b) {
  const row = (fix) => fix.fixInfo.lineNumber || fix.lineNumber;
  const column = (fix) => fix.fixInfo.editColumn || 1;
  return row(b) - row(a) || column(b) - column(a);
}

function outcome(callback) {
  try {
    return { value: callback() };
  } catch (error) {
    return { error: error.message };
  }
}

async function asyncOutcome(callback) {
  try {
    return { value: await callback() };
  } catch (error) {
    return { error: error.message };
  }
}

function compareFixes(source, results, context) {
  const sorted = [...results].sort(descendingFix);
  const expected = outcome(() => sorted.reduce((text, fix) => internals.applyFix(text, fix), source));
  const actual = outcome(() => internals.applyFixes(source, sorted));
  assert.deepEqual(actual, expected, `${context}\n${JSON.stringify({ source, results: sorted })}`);
  return expected;
}

const invalidFixes = (lineLength, missingRow) => [
  result(missingRow, { insertText: "x" }),
  result(-1, { insertText: "x" }),
  result(1, { editColumn: -1, insertText: "x" }),
  result(1, { editColumn: lineLength + 2, insertText: "x" }),
  result(1, { deleteCount: -2 }),
  result(1, { editColumn: 2, deleteCount: lineLength }),
];

test("applyFixes は境界の修正でも applyFix の逐次適用と一致する", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    for (const trailing of [false, true]) {
      const source = ["日本語🌸abc", "", "最後🌸"].join(ending) + (trailing ? ending : "");
      const name = JSON.stringify({ ending, trailing });
      compareFixes(source, [], `${name}: 修正なし`);
      compareFixes(source, [
        result(3, { deleteCount: -1 }),
        result(2, { insertText: "空行に挿入\n次行" }),
        result(1, { editColumn: 9, insertText: "\n末尾" }, 30),
        result(1, { editColumn: 6, deleteCount: 1, insertText: "" }),
        result(1, { editColumn: 1, insertText: "先頭" }),
      ], `${name}: 最終行の削除と同じ行の複数修正`);
      compareFixes(source, [1, 2, 3].map((row) => result(row, { deleteCount: -1 })), `${name}: 連続する行削除`);
      compareFixes(source, [{ lineNumber: 2, ruleNames: ["MD009"], fixInfo: {} }], `${name}: 省略値`);
      for (const fix of invalidFixes(8, 99)) {
        const expected = compareFixes(source, [result(2, { insertText: "先に適用" }), fix], `${name}: 不正な位置・範囲`);
        assert.equal(typeof expected.error, "string", "逐次適用が実際に例外を投げる入力を使う");
      }
    }
  }
  for (const source of ["", "\n", "\r\n", "最終行", "一\r\n二\n三\r四\n五"]) {
    compareFixes(source, [result(1, { insertText: "日本語🌸\n\r\n末尾" })], "空文書と混在改行への挿入");
  }
  // 行削除で改行の多数派が変わると、後続の挿入が選ぶ改行も変わる。
  compareFixes("一\r\n二\n三\n四", [
    result(4, { deleteCount: -1 }), result(3, { deleteCount: -1 }),
    result(1, { editColumn: 2, insertText: "\n追加" }),
  ], "混在改行の多数派の変化");
});

test("固定した種の 800 入力で applyFixes と applyFix の結果・例外が一致する", () => {
  const initialSeed = 0x5eedc0de;
  let successes = 0;
  let errors = 0;
  for (let index = 0; index < 800; index++) {
    const seed = (initialSeed + index) >>> 0;
    const next = random(seed);
    const mode = index % 4;
    const endings = mode === 0 ? ["\n"] : mode === 1 ? ["\r\n"] : mode === 2 ? ["\r"] : ["\r\n", "\n", "\r"];
    const atoms = ["日本語", "🌸", "abc", "空 白", "\t", "é"];
    const lines = Array.from({ length: 4 + next(7) }, (_, row) => row % 4 === 1 ? "" :
      "始" + Array.from({ length: 1 + next(5) }, () => atoms[next(atoms.length)]).join("") + "終");
    let source = lines[0];
    for (let row = 1; row < lines.length; row++) source += endings[(row - 1) % endings.length] + lines[row];
    if (Math.floor(index / 4) % 2) source += endings[next(endings.length)];
    const fixes = [];
    const insertions = ["", "置換", "🌸", "\n", "前\n後", "\r\n", "\r", "\n\n"];
    const insertion = () => insertions[next(insertions.length)];
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row];
      const reported = row + 1 === 1 ? lines.length + 10 : 1;
      if (next(5) === 0 || (index % 8 === 0 && row === lines.length - 1)) {
        fixes.push(result(row + 1, { deleteCount: -1 }, reported));
      } else if (line.length === 0) {
        fixes.push(result(row + 1, { insertText: insertion() }, reported));
      } else {
        // UTF-16 で数える。右端・中ほど・左端を別々にし、修正範囲を重ねない。
        fixes.push(result(row + 1, { editColumn: line.length + 1, insertText: insertion() }, reported));
        const middle = 2 + next(line.length - 1);
        fixes.push(result(row + 1, { editColumn: middle, deleteCount: 1, insertText: insertion() }, reported));
        fixes.push(result(row + 1, { editColumn: 1, insertText: insertion() }, reported));
      }
    }
    // 元の候補を外してから不正な候補を加え、修正同士の重なりを避ける。
    if (index % 10 < 2) {
      const invalid = invalidFixes(lines[0].length, lines.length + 20)[Math.floor(index / 10) % 6];
      if (invalid.fixInfo.lineNumber === 1) {
        for (let i = fixes.length - 1; i >= 0; i--) {
          if (fixes[i].fixInfo.lineNumber === 1) fixes.splice(i, 1);
        }
      }
      fixes.push(invalid);
    }
    const expected = compareFixes(source, fixes, `seed=0x${seed.toString(16)}, index=${index}, mode=${mode}`);
    if (Object.hasOwn(expected, "error")) errors++;
    else successes++;
  }
  assert.ok(successes >= 600, `成功入力も十分に比較する: ${successes}`);
  assert.ok(errors >= 80, `例外の文言も比較する: ${errors}`);
});

// 単独でも組み合わせても使い、閉じていないフェンスが後の部品を取り込む場合も試す。
const fragments = [
  "一行目 \n二行目   \n三行目",
  "内側 ` a` と `a ` と ` a ` と `日本語🌸`",
  ...[0, 1, 2, 3].map((indent) => {
    const prefix = " ".repeat(indent);
    return [`${prefix}\`\`\`text`, `${prefix}\tコード \t   `, `${prefix}\`\`\``].join("\n");
  }),
  "```text\n\t閉じていないフェンス   ",
  "   ~~~text\n   \t閉じていないフェンス ",
  "    字下げのコード\t   \n    次の行 ",
  "$ a + b $ と $日本語🌸$\n\n$$\nx\t+ y   \n$$",
  "<div>\n\tHTML   \n</div>\n\n<span title=\" a \t b \">本文</span> ",
  '#123 と !12 と ~label と ~"a b" と %v1 と @user ',
  "[[_TOC_]]\n\n::include{file=example.md}\n\n{+ 追加 +} と {- 削除 -}",
  "Term\n: 説明 \n\n  * 子 \n    - 孫 ",
  "> Term\n> : 説明 \n>\n>   * 子 \n>     - 孫 ",
  "Term\n~ 説明 \n\n  - 子 ",
  "* 親 \n  - 子 \n* 次\n\n1. 一\n20. 二 \n30. 三",
  ">  引用 \n>\n> ##  見出し:\n> 本文   ",
  "#見出し\n本文 \n\n##  次の見出し!\n本文",
  "---\ntitle: 日本語🌸\nlabels: [a, b]\n---\n\n# 見出し\n本文 ",
  "*強調* と _強調_\n\n[ リンク ](https://example.com) と https://example.com ",
  "#123 の対応 \n\n## @user.\n\n~devops::plan と [[_手順_]] と _別の強調_",
  "# 整形済み\n\n本文です。",
];

function generatedDocuments() {
  const documents = [];
  for (let index = 0; index < 72; index++) {
    const seed = (0x0c0ffee0 + index) >>> 0;
    const next = random(seed);
    const parts = index < fragments.length ? [fragments[index]] :
      Array.from({ length: 2 + next(3) }, () => fragments[next(fragments.length)]);
    let source = parts.join("\n\n") + (index % 3 ? "\n" : "");
    if (index % 2) source = source.replaceAll("\n", "\r\n");
    documents.push({ seed, source });
  }
  return documents;
}

function formattingOptions(source, index) {
  // まず各部品を既定設定で全文検査し、組み合わせ文書では範囲と修正の指定を変える。
  if (index < fragments.length) return {};
  const lastRow = source.split(/\r\n|\r|\n/u).length;
  const range = { start: [1, 0], end: [Math.min(5, lastRow), Infinity] };
  switch (index % 6) {
    case 1: return { fixes: { code: false } };
    case 2: return { fixes: { heading_conversion: true } };
    case 3: return { range };
    case 4: return { range, fixes: { code: false, heading_conversion: true } };
    case 5: return { range: { start: [1, 2], end: [lastRow, Infinity] }, fixes: { heading_conversion: true } };
    default: return {};
  }
}

test("生成した 72 文書の出力・例外は近道の有無で変わらない", async (t) => {
  const configurations = [
    { default: true },
    { MD009: true, MD010: { code_blocks: true }, MD018: true, MD022: true, MD038: true, MD044: { names: ["Label", "User", "Plan"] }, MD047: true },
    { MD004: { style: "dash" }, MD007: true, MD012: true, MD026: true, MD029: true, MD049: true },
  ];
  for (const rules of configurations) {
    await inProject(t, rules, async (project) => {
      // 依存や設定を読めない例外同士の一致だけで、試験が通ることを防ぐ。
      assert.equal(await formatMarkdown("# 確認\n\n本文\n", project), "# 確認\n\n本文\n");
      for (const [index, { seed, source }] of generatedDocuments().entries()) {
        const extra = formattingOptions(source, index);
        const expected = await asyncOutcome(() => formatMarkdown(source, { ...project, ...extra, exhaustive: true }));
        const actual = await asyncOutcome(() => formatMarkdown(source, { ...project, ...extra }));
        assert.deepEqual(actual, expected,
          `seed=0x${seed.toString(16)}, index=${index}, rules=${JSON.stringify(rules)}, ` +
          `options=${JSON.stringify(extra)}\nsource=${JSON.stringify(source)}`);
      }
    });
  }
});

async function lintResults(source, rules) {
  const { lint } = await import(pathToFileURL(runtimeRequire.resolve("markdownlint/promise")));
  return (await lint({ strings: { fixture: source }, config: { default: false, ...rules } })).fixture;
}

function assertStats(stats) {
  for (const key of ["parses", "lints"]) {
    assert.ok(Number.isInteger(stats[key]) && stats[key] >= 0, `${key} は非負の整数: ${JSON.stringify(stats)}`);
  }
  assert.ok(stats.lints >= 1, "markdownlint を実際に呼んでいる");
}

test("コードの中の MD038・MD010 が多数残っても既定の解析は 3 回以下", async (t) => {
  const rules = { MD010: { code_blocks: true }, MD038: true };
  await inProject(t, rules, async (project) => {
    // コードスパンは 1 つの段落に 1 つずつ置く (同じ段落のリテラルに掛かるまとめは、1 つずつ全文の解析で確かめる)。
    const input = [
      "# コードの保護", "",
      ...Array.from({ length: 6 }, (_, index) => [`行${index}: \` a${index}\``, "", `行${index}: \`a${index} \``, ""]).flat(),
      "```text", ...Array.from({ length: 6 }, (_, index) => `\tコード${index}`), "```", "",
    ].join("\n");
    const candidates = (await lintResults(input, rules)).filter((entry) => entry.fixInfo);
    for (const rule of ["MD038", "MD010"]) {
      assert.ok(candidates.filter((entry) => entry.ruleNames[0] === rule).length >= 5,
        `${rule} の修正候補が実際に 5 つ以上ある`);
    }
    const fast = {};
    const exhaustive = {};
    assert.equal(await formatMarkdown(input, { ...project, stats: fast }), input);
    assert.equal(await formatMarkdown(input, { ...project, exhaustive: true, stats: exhaustive }), input);
    assertStats(fast);
    assertStats(exhaustive);
    assert.ok(fast.parses <= 3, `近道ありの解析回数: ${JSON.stringify(fast)}`);
    assert.ok(exhaustive.parses >= candidates.length + 1,
      `全文検査では各修正候補の解析が必要: candidates=${candidates.length}, stats=${JSON.stringify(exhaustive)}`);
    assert.ok(exhaustive.parses > fast.parses, "近道によって解析が実際に減る");
  });
});

test("修正候補も説明リストの印もない文書は解析が 0 回か 1 回で、stats に加算する", async (t) => {
  const rules = { default: true };
  await inProject(t, rules, async (project) => {
    const input = "# 整形済み\n\n日本語と🌸の本文です。\n";
    assert.equal((await lintResults(input, rules)).filter((entry) => entry.fixInfo).length, 0);
    const stats = {};
    assert.equal(await formatMarkdown(input, { ...project, stats }), input);
    assertStats(stats);
    assert.ok(stats.parses <= 1, `修正候補なしの解析回数: ${JSON.stringify(stats)}`);
    // 同じ物をもう一度渡し、上書きせず回数を足す契約も確かめる。
    const before = { ...stats };
    assert.equal(await formatMarkdown(input, { ...project, stats }), input);
    assertStats(stats);
    const parses = stats.parses - before.parses;
    assert.ok(parses >= 0 && parses <= 1, `2 回目に増えた解析回数: ${parses}`);
    assert.ok(stats.lints > before.lints, "2 回目の lint 回数が加算される");
    // 解析 0 回の実装でも、既存の解析回数が消されないことを確かめる。
    const accumulated = { parses: 7, lints: 11 };
    assert.equal(await formatMarkdown(input, { ...project, stats: accumulated }), input);
    assert.ok(accumulated.parses >= 7 && accumulated.parses <= 8);
    assert.ok(accumulated.lints > 11);
    const exhaustive = {};
    assert.equal(await formatMarkdown(input, { ...project, exhaustive: true, stats: exhaustive }), input);
    assertStats(exhaustive);
    assert.ok(exhaustive.parses >= 1, "exhaustive は修正候補がなくても解析する");
  });
});

// レビューで見つかった反例 (Codex)。カスタムルールで修正候補を出し、近道の有無で出力が同じことを確かめる。
async function customProject(t, source) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-fast-path-custom-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "custom-rule.cjs"), source);
  await writeFile(path.join(cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config: { default: false, "test-fast-path": true }, customRules: ["./custom-rule.cjs"],
  }));
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir };
}

const customRule = (body) => `module.exports = {
  names: ["test-fast-path"],
  description: "Fast path counterexample",
  tags: ["test"],
  parser: "none",
  function(params, onError) {
    const edit = (lineNumber, editColumn, deleteCount, insertText) => onError({ lineNumber, fixInfo: { lineNumber, editColumn, deleteCount, insertText } });
    ${body}
  }
};\n`;

test("先に当たった修正が GitLab の記法を動かしても、記法の判定は今の文書で行う", async (t) => {
  const project = await customProject(t, customRule(`
    if (params.lines[0] === "@user") { edit(1, 2, 4, " @user"); edit(1, 1, 1, "x"); }`));
  const input = "@user\n";
  const expected = await formatMarkdown(input, { ...project, exhaustive: true });
  assert.equal(expected, "x @user\n", "近道なしでは、右の修正の後に左の修正も当たる");
  assert.equal(await formatMarkdown(input, project), expected);
});

test("コードブロックのフェンスの行を変える修正は、ブロックの行だけで判定しない", async (t) => {
  const project = await customProject(t, customRule(`
    if (params.lines[0] === "\`\`\`" && params.lines[1] === "x") edit(1, 1, -1, "");`));
  const input = "```\nx\n```\nx\n";
  const expected = await formatMarkdown(input, { ...project, exhaustive: true });
  assert.equal(await formatMarkdown(input, project), expected);
});

// レビューで見つかった反例 (Grok Build)。同じ段落の 2 つのコードスパンを別々のまとめが変えると、いっしょに当てたときだけ
// バッククォートの対応が変わる。右のまとめ (中身は同じ x のまま) は単独なら当たる。
test("同じ段落の 2 つのリテラルに掛かるまとめは、いっしょに当てた結果で判定しない", async (t) => {
  const project = await customProject(t, customRule(`
    if (params.lines[0] === "\`\`y\`\` \` x \` \` z") { edit(1, 7, 5, "\`x\`"); edit(1, 1, 1, ""); }`));
  const input = "``y`` ` x ` ` z\n";
  const expected = await formatMarkdown(input, { ...project, exhaustive: true });
  assert.equal(expected, "``y`` `x` ` z\n", "近道なしでは、右のまとめだけが当たる");
  assert.equal(await formatMarkdown(input, project), expected);
});

test("改行が全部消えた後の挿入は、逐次に当てたときと同じ LF になる", () => {
  compareFixes("abc\r\n ", [
    result(2, { editColumn: 1, deleteCount: -1, insertText: "" }),
    result(1, { editColumn: 4, insertText: "\n" }),
    result(1, { editColumn: 1, insertText: "\n" }),
  ], "CRLF の改行が 0 になった後の 2 つの挿入");
});

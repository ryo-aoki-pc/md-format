import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const sparePath = path.join(packageDir, "spare.mjs");
const runtimeDir = path.resolve(process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir);
const input = "#  見出し\n\n本文 \n";

async function project(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-spare-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filename = path.join(cwd, "文書 with spaces.md");
  await writeFile(filename, "保存済みの本文\n");
  await writeFile(path.join(cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config: { default: false, MD009: true, MD019: true, MD047: true },
  }));
  return { cwd, filename, argv: ["--runtime-dir", runtimeDir, "--filename", filename] };
}

function launch(t, args, cwd, ipc = false) {
  const child = spawn(process.execPath, args, {
    cwd, timeout: 15000, stdio: ipc ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
    }));
  });
  // 先読みを待つ間に起動が失敗しても、未処理の reject にしない。
  result.catch(() => {});
  return { child, result };
}

async function startSpare(t, { startupArgs = ["--runtime-dir", runtimeDir], ready = false } = {}) {
  let args = [sparePath, ...startupArgs];
  if (ready) {
    // 通信の約束に ready を足さず、試験だけで同じモジュールの先読み完了を IPC から待つ。
    const runtimeIndex = startupArgs.indexOf("--runtime-dir");
    const directory = runtimeIndex === -1 ? undefined : startupArgs[runtimeIndex + 1];
    args = ["--input-type=module", "--eval", `
      process.argv = [process.execPath, ${JSON.stringify(sparePath)}, ...${JSON.stringify(startupArgs)}];
      const { preload } = await import(${JSON.stringify(pathToFileURL(formatterPath).href)});
      await import(${JSON.stringify(pathToFileURL(sparePath).href)});
      await preload(${JSON.stringify(directory)});
      process.send("読み込み完了");
      process.disconnect();
    `];
  }
  const running = launch(t, args, packageDir, ready);
  if (ready) {
    await new Promise((resolve, reject) => {
      running.child.once("message", resolve);
      running.child.once("error", reject);
      running.child.once("exit", () => reject(new Error("先読みの完了前に終了しました。")));
    });
  }
  return running;
}

function send(running, header, body) {
  running.child.stdin.end(Buffer.concat([
    Buffer.from(JSON.stringify(header) + "\n"), Buffer.from(body),
  ]));
  return running.result;
}

async function compare(t, options, body = input, { running, argv = options.argv, script = formatterPath } = {}) {
  running ||= await startSpare(t);
  const actual = await send(running, { script, argv, cwd: options.cwd }, body);
  const direct = launch(t, [script, ...argv], options.cwd);
  direct.child.stdin.end(body);
  const expected = await direct.result;
  assert.equal(expected.signal, null, "CLI が時間切れにならない");
  assert.deepEqual(actual, expected, "標準出力・標準エラーのバイト列と終了コードが CLI と一致する");
  assert.equal(await readFile(options.filename, "utf8"), "保存済みの本文\n");
  return actual;
}

function quiet(result, code) {
  assert.equal(result.signal, null);
  assert.equal(result.code, code);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.length, 0);
}

test("基本の21通りで予備とCLIの結果が一致する", async (t) => {
  const options = await project(t);
  const badConfig = path.join(options.cwd, "invalid.json");
  await writeFile(badConfig, "{ 壊れた JSON");
  const throwingConfig = path.join(options.cwd, "throw.markdownlint-cli2.mjs");
  await writeFile(throwingConfig, `export default {
    config: { default: false, "test-throw": true },
    customRules: [{
      names: ["test-throw"], description: "例外を投げる", tags: ["test"], parser: "none",
      function() { throw new Error("ルールの例外"); }
    }]
  };\n`);
  const cases = [
    ["1行", "本文\n", [], 0],
    ["README", await readFile(new URL("../README.md", import.meta.url)), [], 0],
    ["通常の修正", input, [], 0],
    ["GLFM", "[[_TOC_]]\n\n用語\n: 説明 \n\n$x_y$ と #123 と [[wiki]]\n", [], 0],
    ["空文書", "", [], 0],
    ["CRLF", input.replaceAll("\n", "\r\n"), [], 0],
    ["末尾の改行なし", "本文", [], 0],
    ["範囲", input, ["--range-start", "3", "--range-end", "3", "--range-end-column", "5"], 0],
    ["修正の分類", input, ["--disable-fixes", "heading_spacing,whitespace"], 0],
    ["未知の引数", input, ["--unknown", "value"], 1],
    ["引数の重複", input, ["--filename", options.filename], 1],
    ["runtimeなし", input, [], 1, ["--filename", options.filename]],
    ["相対のファイル名", input, [], 1, ["--runtime-dir", runtimeDir, "--filename", "relative.md"]],
    ["未知の分類", input, ["--enable-fixes", "unknown_category"], 1],
    ["有効と無効の衝突", input, ["--enable-fixes", "MD009", "--disable-fixes", "MD009"], 1],
    ["空の分類", input, ["--enable-fixes", "whitespace,"], 1],
    ["範囲の不正", input, ["--range-start", "one", "--range-end", "2"], 1],
    ["範囲の不足", input, ["--range-start", "1"], 1],
    ["設定ファイルが無い", input, ["--config", path.join(options.cwd, "missing.json")], 1],
    ["不正なJSONの設定", input, ["--config", badConfig], 1],
    ["ルールの例外", input, ["--config", throwingConfig], 1],
  ];
  for (const [name, body, extra, code, base = options.argv] of cases) {
    await t.test(name, async (t) => {
      const result = await compare(t, options, body, { argv: [...base, ...extra] });
      assert.equal(result.code, code, result.stderr.toString());
      if (code) assert.equal(result.stdout.length, 0);
      else assert.equal(result.stderr.length, 0);
      if (name === "通常の修正") assert.equal(result.stdout.toString(), "# 見出し\n\n本文\n");
    });
  }
});

test("BOMと不正なUTF-8をバイト列のまま渡す", async (t) => {
  const options = await project(t);
  for (const [name, body] of [
    ["BOM付き", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(input)])],
    ["不正なUTF-8", Buffer.concat([Buffer.from("本文 "), Buffer.from([0xff, 0xc3, 0x28, 0xe3, 0x81]), Buffer.from(" \n")])],
  ]) {
    await t.test(name, async (t) => {
      const result = await compare(t, options, body);
      assert.equal(result.code, 0, result.stderr.toString());
    });
  }
});

test("JSの設定から見える引数・終了コード・console出力がCLIと一致する", async (t) => {
  for (const [name, source, code] of [
    ["process.argvを読む", 'console.log(JSON.stringify(process.argv));', 0],
    ["終了コードを7にする", 'process.exitCode = 7;', 7],
    ["consoleに書く", 'console.log("設定の標準出力"); console.error("設定の標準エラー");', 0],
  ]) {
    await t.test(name, async (t) => {
      const options = await project(t);
      await rm(path.join(options.cwd, ".markdownlint-cli2.jsonc"));
      await writeFile(path.join(options.cwd, ".markdownlint-cli2.mjs"),
        source + '\nexport default { config: { default: false, MD009: true } };\n');
      const result = await compare(t, options);
      assert.equal(result.code, code, result.stderr.toString());
      if (name === "process.argvを読む") {
        const argv = JSON.parse(result.stdout.toString().split("\n")[0]);
        assert.deepEqual(argv.slice(1), [formatterPath, ...options.argv]);
      }
      if (name === "consoleに書く") {
        assert.match(result.stdout.toString(), /^設定の標準出力\n/u);
        assert.equal(result.stderr.toString(), "設定の標準エラー\n");
      }
    });
  }
});

function ruleSource(value, stateful = false) {
  return `
    ${stateful ? "let calls = 0;" : 'import { replacement } from "./replacement.mjs";'}
    export default {
      names: ["test-replace"], description: "本文を置き換える", tags: ["test"], parser: "none",
      function(params, onError) {
        ${stateful ? 'const replacement = "new" + (++calls);' : ""}
        params.lines.forEach((line, index) => {
          if (line.includes("old")) onError({ lineNumber: index + 1, fixInfo: {
            editColumn: line.indexOf("old") + 1, deleteCount: 3,
            insertText: ${value === undefined ? "replacement" : JSON.stringify(value)}
          } });
        });
      }
    };\n
  `;
}

async function customProject(t) {
  const options = await project(t);
  await writeFile(path.join(options.cwd, ".markdownlint-cli2.jsonc"), JSON.stringify({
    config: { default: false, "test-replace": true }, customRules: ["./rule.mjs"],
  }));
  await writeFile(path.join(options.cwd, "replacement.mjs"), 'export const replacement = "before";\n');
  return options;
}

test("状態を持つルールでも2つの予備が毎回CLIと同じ初期状態で動く", async (t) => {
  const options = await customProject(t);
  await writeFile(path.join(options.cwd, "rule.mjs"), ruleSource(undefined, true));
  for (let index = 0; index < 2; index++) {
    const result = await compare(t, options, "old\n");
    assert.equal(result.code, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "new1\n");
  }
});

test("依存の先読み完了後に書き換えた設定とルールを要求時に読む", async (t) => {
  for (const name of ["JSONCの設定", "mjsの設定", "カスタムルール", "ルールのimport先"]) {
    await t.test(name, async (t) => {
      const custom = name === "カスタムルール" || name === "ルールのimport先";
      const options = custom ? await customProject(t) : await project(t);
      const file = path.join(options.cwd, name === "mjsの設定" ? ".markdownlint-cli2.mjs" : ".markdownlint-cli2.jsonc");
      if (custom) await writeFile(path.join(options.cwd, "rule.mjs"), ruleSource());
      else if (name === "mjsの設定") {
        await rm(path.join(options.cwd, ".markdownlint-cli2.jsonc"));
        await writeFile(file, 'export default { config: { default: false } };\n');
      } else await writeFile(file, JSON.stringify({ config: { default: false } }));
      const running = await startSpare(t, { ready: true });
      if (name === "カスタムルール") await writeFile(path.join(options.cwd, "rule.mjs"), ruleSource("after"));
      else if (name === "ルールのimport先") {
        await writeFile(path.join(options.cwd, "replacement.mjs"), 'export const replacement = "after";\n');
      } else if (name === "mjsの設定") {
        await writeFile(file, 'export default { config: { default: false, MD009: true } };\n');
      } else await writeFile(file, JSON.stringify({ config: { default: false, MD009: true } }));
      const result = await compare(t, options, custom ? "old\n" : "本文 \n", { running });
      assert.equal(result.code, 0, result.stderr.toString());
      assert.equal(result.stdout.toString(), custom ? "after\n" : "本文\n");
    });
  }
});

test("改行の無いEOFでは何も出さずに正常終了する", async (t) => {
  for (const body of ["", "使わなかった予備", '{"script":']) {
    const running = await startSpare(t, { ready: true });
    running.child.stdin.end(body);
    quiet(await running.result, 0);
  }
});

test("見出しの不正・別のscript・存在しないcwdは何も出さずに86で終わる", async (t) => {
  const options = await project(t);
  const header = { script: formatterPath, argv: options.argv, cwd: options.cwd };
  const headers = [
    "壊れたJSON", "null", "[]", "{}", JSON.stringify({ ...header, script: 1 }),
    JSON.stringify({ ...header, argv: "引数" }), JSON.stringify({ ...header, argv: [1] }),
    JSON.stringify({ ...header, cwd: 1 }), JSON.stringify({ ...header, cwd: "relative" }),
    JSON.stringify({ ...header, script: sparePath }),
    JSON.stringify({ ...header, script: path.join(options.cwd, "missing.mjs") }),
    JSON.stringify({ ...header, cwd: path.join(options.cwd, "missing") }),
  ];
  for (const line of headers) {
    const running = await startSpare(t);
    running.child.stdin.end(line + "\n" + input);
    quiet(await running.result, 86);
  }
});

test("JSONのスラッシュのエスケープと見出し・本文の分割送信を扱う", async (t) => {
  const options = await project(t);
  const running = await startSpare(t);
  const script = formatterPath.split(path.sep).join("/");
  const header = JSON.stringify({ script, argv: options.argv, cwd: options.cwd }).replaceAll("/", "\\/");
  assert.ok(header.includes("\\/"), "実際にスラッシュをエスケープした見出しを送る");
  const bytes = Buffer.from(header + "\n" + input);
  // 日本語のUTF-8の途中で区切っても、本文を復号し直して壊さない。
  for (const byte of bytes) running.child.stdin.write(Buffer.from([byte]));
  running.child.stdin.end();
  const result = await running.result;
  const direct = launch(t, [formatterPath, ...options.argv], options.cwd);
  direct.child.stdin.end(input);
  assert.deepEqual(result, await direct.result);
  assert.equal(result.code, 0, result.stderr.toString());
});

test("起動引数のruntimeが無い・存在しない場合も要求時の結果がCLIと一致する", async (t) => {
  const options = await project(t);
  const missingRuntime = path.join(options.cwd, "missing-runtime");
  for (const startupArgs of [[], ["--runtime-dir", missingRuntime]]) {
    for (const argv of [options.argv, ["--filename", options.filename],
      ["--runtime-dir", missingRuntime, "--filename", options.filename],
      ["--runtime-dir", missingRuntime, "--filename", "relative.md"],
      ["--runtime-dir", missingRuntime, "--unknown", "value"]]) {
      const running = await startSpare(t, { startupArgs, ready: true });
      const result = await compare(t, options, input, { running, argv });
      assert.equal(result.code, argv === options.argv ? 0 : 1, result.stderr.toString());
    }
    const unused = await startSpare(t, { startupArgs, ready: true });
    unused.child.stdin.end();
    quiet(await unused.result, 0);
  }
});

test("先読みで失敗したruntimeに依存が現れたら要求時に読み直す", async (t) => {
  const options = await project(t);
  const recoveredRuntime = path.join(options.cwd, "recovered-runtime");
  await mkdir(recoveredRuntime);
  const running = await startSpare(t, { startupArgs: ["--runtime-dir", recoveredRuntime], ready: true });
  await symlink(path.join(runtimeDir, "node_modules"), path.join(recoveredRuntime, "node_modules"), "junction");
  const argv = ["--runtime-dir", recoveredRuntime, "--filename", options.filename];
  const result = await compare(t, options, input, { running, argv });
  assert.equal(result.code, 0, result.stderr.toString());
});


test("同じ実体を指すジャンクションと相対のscriptを受け付ける", async (t) => {
  const options = await project(t);
  const link = path.join(options.cwd, "formatter-link");
  await symlink(packageDir, link, "junction");
  for (const script of [path.join(link, "format.mjs"), path.relative(options.cwd, formatterPath)]) {
    const result = await compare(t, options, input, { script });
    assert.equal(result.code, 0, result.stderr.toString());
  }
});

test("大きな標準出力もCLIと同じく最後まで流して自然に終了する", async (t) => {
  const options = await project(t);
  const body = ("本文 \n\n").repeat(20000);
  const result = await compare(t, options, body, { argv: [...options.argv, "--disable-fixes", "whitespace"] });
  assert.equal(result.code, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from(body));
});

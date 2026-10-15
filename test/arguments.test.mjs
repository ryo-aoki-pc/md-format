import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatMarkdown } from "../format.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const input = "#Unsaved\n\nTerm\n: Description \n";
const diskContents = "# Saved file\n\nDo not replace this with the unsaved buffer.\n";

async function project(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-arguments-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filename = path.join(cwd, "文書 with spaces.md");
  await writeFile(filename, diskContents);
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: false, MD018: true }));
  // MD018 の見出し化を例にするので、既定で無効の heading_conversion を有効にする。
  return { filename, cwd, runtimeDir, fixes: { heading_conversion: true } };
}

function cli(options, args) {
  const child = spawnSync(process.execPath, [formatterPath, ...args], {
    cwd: options.cwd, input, encoding: "utf8", timeout: 15000,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return child;
}

test("invalid API input and filenames fail before loading dependencies", async (t) => {
  const options = await project(t);
  const missingRuntime = { ...options, runtimeDir: path.join(options.cwd, "missing-runtime") };
  for (const source of [undefined, null, Buffer.from(input)]) {
    await assert.rejects(formatMarkdown(source, missingRuntime), /入力は文字列/);
  }
  for (const filename of [undefined, "", "relative.md"]) {
    await assert.rejects(formatMarkdown(input, { ...missingRuntime, filename }), /絶対ファイル名/);
  }
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

test("invalid API ranges preserve the saved file and allow a subsequent valid format", async (t) => {
  const options = await project(t);
  const ranges = [
    { start: null, end: [1, 0] },
    { start: [1, 0], end: null },
    { start: [0, 0], end: [1, 0] },
    { start: [2, 0], end: [1, 0] },
    { start: [1.5, 0], end: [2, 0] },
    { start: [1, -1], end: [1, 0] },
    { start: [1, 0], end: [1, -2] },
    { start: [1, 0], end: [1, NaN] },
    { start: [1, 0], end: [1, 0.5] },
    { start: [1, 5], end: [1, 2] },
  ];
  for (const range of ranges) {
    await assert.rejects(formatMarkdown(input, { ...options, range }), /整形範囲/);
  }
  assert.equal(await formatMarkdown(input, options), input.replace("#Unsaved", "# Unsaved"));
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

test("CLI rejects unknown, repeated, or incomplete arguments without emitting buffer text", async (t) => {
  const options = await project(t);
  const base = ["--runtime-dir", runtimeDir, "--filename", options.filename];
  for (const [args, message] of [
    [[...base, "--unknown", "value"], /引数/],
    [[...base, "--filename", options.filename], /複数回/],
    [[...base, "--config"], /引数/],
    [["--runtime-dir", runtimeDir], /絶対ファイル名/],
  ]) {
    const child = cli(options, args);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, message);
    assert.equal(child.stderr.trimEnd().split("\n").length, 1);
  }
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

test("CLI reads dependencies from its own folder when --runtime-dir is omitted", async (t) => {
  const options = await project(t);
  const child = cli(options, ["--filename", options.filename, "--enable-fixes", "heading_conversion"]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.equal(child.stdout, input.replace("#Unsaved", "# Unsaved"));
});

test("CLI rejects invalid range endpoints and recovers on the next invocation", async (t) => {
  const options = await project(t);
  const base = ["--runtime-dir", runtimeDir, "--filename", options.filename];
  for (const args of [
    ["--range-start", "1"],
    ["--range-end-column", "0"],
    ["--range-start", "one", "--range-end", "2"],
    ["--range-start", "1.5", "--range-end", "2"],
    ["--range-start", "2", "--range-end", "1"],
    ["--range-start", "1", "--range-end", "1", "--range-end-column", "-2"],
    ["--range-start", "1", "--range-end", "1", "--range-start-column", "5", "--range-end-column", "2"],
  ]) {
    const child = cli(options, [...base, ...args]);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, /範囲/);
  }
  const recovered = cli(options, [...base, "--range-start", "1", "--range-end", "1", "--enable-fixes", "heading_conversion"]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(recovered.stderr, "");
  assert.equal(recovered.stdout, input.replace("#Unsaved", "# Unsaved"));
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

test("CLI selects fixes by category and rule name and rejects invalid selections without emitting buffer text", async (t) => {
  const options = await project(t);
  const base = ["--runtime-dir", runtimeDir, "--filename", options.filename];
  // プロジェクトの設定は MD018 だけを有効にしている。見出し化は既定で無効なので、指定しなければ変わらない。
  for (const [args, expected] of [
    [[], input],
    [["--enable-fixes", "heading_conversion"], input.replace("#Unsaved", "# Unsaved")],
    [["--enable-fixes", "heading_conversion", "--disable-fixes", "MD018"], input],
    [["--enable-fixes", "no-missing-space-atx"], input.replace("#Unsaved", "# Unsaved")],
  ]) {
    const child = cli(options, [...base, ...args]);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, expected, args.join(" "));
  }
  for (const [args, message] of [
    [["--enable-fixes", "heading_conversoin"], /分類名にもルール名にも/],
    [["--enable-fixes", "heading_conversion,"], /空/],
    [["--enable-fixes", "MD026", "--disable-fixes", "MD026"], /両方/],
    [["--enable-fixes", "MD026", "--disable-fixes", "no-trailing-punctuation"], /両方/],
    [["--enable-fixes", "lists", "--enable-fixes", "code"], /複数回/],
    [["--disable-fixes"], /引数/],
  ]) {
    const child = cli(options, [...base, ...args]);
    assert.equal(child.status, 1, args.join(" "));
    assert.equal(child.stdout, "");
    assert.match(child.stderr, message);
  }
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

test("an API dependency-load failure can recover using the same runtime directory", async (t) => {
  const options = await project(t);
  const recoveredRuntime = await mkdtemp(path.join(tmpdir(), "glfm-runtime-recovery-"));
  t.after(() => rm(recoveredRuntime, { recursive: true, force: true }));
  await writeFile(path.join(recoveredRuntime, "package.json"), '{"private":true}\n');
  const recovering = { ...options, runtimeDir: recoveredRuntime };
  await assert.rejects(formatMarkdown(input, recovering), /Cannot find|module|package/i);

  // 導入前の失敗をキャッシュし続けず、同じ runtime への依存追加後に読み直す。
  await symlink(path.join(runtimeDir, "node_modules"), path.join(recoveredRuntime, "node_modules"), "junction");
  const output = await formatMarkdown(input, recovering);
  assert.equal(output, input.replace("#Unsaved", "# Unsaved"));
  assert.equal(await formatMarkdown(output, recovering), output);
  assert.equal(await readFile(options.filename, "utf8"), diskContents);
});

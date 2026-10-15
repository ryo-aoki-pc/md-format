import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// mdfmt のコマンドライン (cli.mjs) の試験。標準入力・ファイル・フォルダ・--write・--check と終了コードを確かめる。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const messy = "#  見出し\n本文 \n";
const tidy = "# 見出し\n\n本文\n";

async function project(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "md-format-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: true }));
  return cwd;
}

function mdfmt(cwd, args, input = "") {
  const child = spawnSync(process.execPath, [formatterPath, ...args], { cwd, input, encoding: "utf8", timeout: 30000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return child;
}

const lines = (text) => text.split("\n").filter(Boolean);

test("標準入力は --filename を省いても整形し、相対の --filename は cwd から解く", async (t) => {
  const cwd = await project(t);
  for (const args of [[], ["--filename", "docs/note.md"], ["--filename", path.join(cwd, "note.md")]]) {
    const child = mdfmt(cwd, args, messy);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, tidy, args.join(" "));
    assert.equal(child.stderr, "");
  }
});

test("1 つのファイルは標準出力に書き、ファイルは変えない。BOM と CRLF を保つ", async (t) => {
  const cwd = await project(t);
  const file = path.join(cwd, "文書.md");
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(messy.replaceAll("\n", "\r\n"))]);
  await writeFile(file, bytes);
  const child = spawnSync(process.execPath, [formatterPath, "文書.md"], { cwd, timeout: 30000 });
  assert.equal(child.status, 0, child.stderr.toString());
  assert.deepEqual(child.stdout, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(tidy.replaceAll("\n", "\r\n"))]));
  assert.deepEqual(await readFile(file), bytes);
});

test("--write は変わるファイルだけを書き換えて名前を出し、--check は書き換えずに 1 で終わる", async (t) => {
  const cwd = await project(t);
  await mkdir(path.join(cwd, "docs", "sub"), { recursive: true });
  await writeFile(path.join(cwd, "docs", "a.md"), messy);
  await writeFile(path.join(cwd, "docs", "sub", "b.md"), tidy);
  await writeFile(path.join(cwd, "docs", "sub", "c.MD"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(messy)]));
  const untouched = await stat(path.join(cwd, "docs", "sub", "b.md"));

  const check = mdfmt(cwd, ["--check", "docs"]);
  assert.equal(check.status, 1, check.stderr);
  assert.deepEqual(lines(check.stdout), [path.join("docs", "a.md"), path.join("docs", "sub", "c.MD")]);
  assert.equal(await readFile(path.join(cwd, "docs", "a.md"), "utf8"), messy, "--check は書き換えない");

  const write = mdfmt(cwd, ["--write", "docs"]);
  assert.equal(write.status, 0, write.stderr);
  assert.deepEqual(lines(write.stdout), [path.join("docs", "a.md"), path.join("docs", "sub", "c.MD")]);
  assert.equal(await readFile(path.join(cwd, "docs", "a.md"), "utf8"), tidy);
  assert.deepEqual(await readFile(path.join(cwd, "docs", "sub", "c.MD")),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(tidy)]), "BOM を書き戻す");
  assert.equal((await stat(path.join(cwd, "docs", "sub", "b.md"))).mtimeMs, untouched.mtimeMs, "変わらないファイルは書かない");

  const again = mdfmt(cwd, ["--check", "docs"]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "");
});

test("フォルダは名前順に *.md を集め、. で始まるフォルダと node_modules と、ほかの拡張子は除く", async (t) => {
  const cwd = await project(t);
  for (const name of ["b.md", "a.md", path.join("z", "c.md"), path.join(".hidden", "d.md"),
    path.join("node_modules", "e.md"), "notes.txt", path.join("m", "f.markdown")]) {
    await mkdir(path.dirname(path.join(cwd, "root", name)), { recursive: true });
    await writeFile(path.join(cwd, "root", name), messy);
  }
  const child = mdfmt(cwd, ["--check", "root"]);
  assert.equal(child.status, 1, child.stderr);
  assert.deepEqual(lines(child.stdout), ["a.md", "b.md", path.join("z", "c.md")].map((name) => path.join("root", name)));
});

test("1 つのファイルの誤りで止めず、残りを扱ってから 2 で終わる。UTF-8 でないファイルは変えない", async (t) => {
  const cwd = await project(t);
  const broken = Buffer.concat([Buffer.from("本文 "), Buffer.from([0xff, 0xfe]), Buffer.from(" \n")]);
  await writeFile(path.join(cwd, "a-broken.md"), broken);
  await writeFile(path.join(cwd, "b.md"), messy);
  const child = mdfmt(cwd, ["--write", "a-broken.md", "missing.md", "b.md"]);
  assert.equal(child.status, 2);
  assert.deepEqual(lines(child.stdout), ["b.md"]);
  const errors = lines(child.stderr);
  assert.equal(errors.length, 2, child.stderr);
  assert.match(errors[0], /^mdfmt: missing\.md: 開けません/u);
  assert.match(errors[1], /^mdfmt: a-broken\.md: Markdown の整形に失敗しました: UTF-8 として読めません/u);
  assert.deepEqual(await readFile(path.join(cwd, "a-broken.md")), broken);
  assert.equal(await readFile(path.join(cwd, "b.md"), "utf8"), tidy);
});

test("組み合わせられない引数は、何も書かずに 2 で終わる", async (t) => {
  const cwd = await project(t);
  await writeFile(path.join(cwd, "a.md"), messy);
  await writeFile(path.join(cwd, "b.md"), messy);
  for (const [args, message] of [
    [["a.md", "b.md"], /--write か --check/],
    [["."], /フォルダは、--write か --check/],
    [["--write", "--check", "a.md"], /一緒に指定できません/],
    [["--filename", "x.md", "a.md"], /--filename は、標準入力/],
    [["--write", "--range-start", "1", "--range-end", "1", "a.md", "b.md"], /範囲は/],
    [["--write", "--range-start", "1", "--range-end", "1", "."], /範囲は/],
    [["--unknown"], /知らない引数/],
    [["--write", "--write", "a.md"], /複数回/],
  ]) {
    const child = mdfmt(cwd, args, messy);
    assert.equal(child.status, 2, args.join(" "));
    assert.equal(child.stdout, "", args.join(" "));
    assert.match(child.stderr, message, args.join(" "));
    assert.equal(lines(child.stderr).length, 1, child.stderr);
  }
  assert.equal(await readFile(path.join(cwd, "a.md"), "utf8"), messy);
});

test("--check で誤りと整形の要るファイルが混ざると、名前を出して 2 で終わる", async (t) => {
  const cwd = await project(t);
  await writeFile(path.join(cwd, "b.md"), messy);
  const child = mdfmt(cwd, ["--check", "missing.md", "b.md"]);
  assert.equal(child.status, 2);
  assert.deepEqual(lines(child.stdout), ["b.md"]);
  assert.match(child.stderr, /^mdfmt: missing\.md: 開けません/u);
  assert.equal(await readFile(path.join(cwd, "b.md"), "utf8"), messy);
});

test("標準入力では --write と --check を使えない", async (t) => {
  const cwd = await project(t);
  for (const flag of ["--write", "--check"]) {
    const child = mdfmt(cwd, [flag], messy);
    assert.equal(child.status, 2, flag);
    assert.equal(child.stdout, "", flag);
    assert.match(child.stderr, /ファイルかフォルダと一緒に/u, flag);
  }
});

test("相対の --config は、起動したフォルダから解く (今のフォルダの外のファイルでも同じ設定)", async (t) => {
  const root = await project(t);
  const cwd = path.join(root, "here");
  const other = path.join(root, "other");
  await mkdir(cwd);
  await mkdir(other);
  // 今のフォルダの設定は MD009 (行末の空白) だけ。ほかのフォルダに同じ名前の別の設定を置く。
  await writeFile(path.join(cwd, "settings.json"), JSON.stringify({ default: false, MD009: true }));
  await writeFile(path.join(other, "settings.json"), JSON.stringify({ default: false, MD019: true }));
  await writeFile(path.join(cwd, "a.md"), "#  見出し \n");
  await writeFile(path.join(other, "b.md"), "#  見出し \n");
  const child = mdfmt(cwd, ["--write", "--config", "settings.json", "a.md", path.join("..", "other", "b.md")]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(path.join(cwd, "a.md"), "utf8"), "#  見出し\n");
  assert.equal(await readFile(path.join(other, "b.md"), "utf8"), "#  見出し\n");
});

test("読めない子フォルダがあっても、ほかのファイルを扱ってから 2 で終わる", { skip: process.platform === "win32" }, async (t) => {
  const cwd = await project(t);
  await mkdir(path.join(cwd, "docs", "private"), { recursive: true });
  await writeFile(path.join(cwd, "docs", "a.md"), messy);
  await writeFile(path.join(cwd, "docs", "z.md"), messy);
  await chmod(path.join(cwd, "docs", "private"), 0o000);
  // 一時フォルダを先に消すこともあるので、戻せなくてもよい。
  t.after(() => chmod(path.join(cwd, "docs", "private"), 0o755).catch(() => {}));
  const child = mdfmt(cwd, ["--write", "docs"]);
  assert.equal(child.status, 2);
  assert.deepEqual(lines(child.stdout), [path.join("docs", "a.md"), path.join("docs", "z.md")]);
  assert.match(child.stderr, /docs\/private: 開けません/u);
});

test(".. で始まる名前のフォルダのファイルも、今のフォルダを設定の基準にする", async (t) => {
  const cwd = await project(t);
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: false, MD009: true }));
  await mkdir(path.join(cwd, "..backup"));
  await writeFile(path.join(cwd, "..backup", "a.md"), "本文 \n");
  const child = mdfmt(cwd, ["--write", path.join("..backup", "a.md")]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(path.join(cwd, "..backup", "a.md"), "utf8"), "本文\n");
});

test("-- の後は、- で始まる名前もファイルとして扱う", async (t) => {
  const cwd = await project(t);
  await writeFile(path.join(cwd, "-dash.md"), messy);
  const child = mdfmt(cwd, ["--write", "--", "-dash.md"]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(path.join(cwd, "-dash.md"), "utf8"), tidy);
});

test("範囲は 1 つのファイルにも使える", async (t) => {
  const cwd = await project(t);
  await writeFile(path.join(cwd, "a.md"), "#  一\n\n#  二\n");
  const child = mdfmt(cwd, ["--range-start", "3", "--range-end", "3", "a.md"]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "#  一\n\n# 二\n");
});

test("--help と --version", async (t) => {
  const cwd = await project(t);
  const help = mdfmt(cwd, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^使い方: mdfmt/u);
  assert.match(help.stdout, /終了コード/u);
  for (const flag of ["--version", "-v"]) {
    const version = mdfmt(cwd, [flag]);
    assert.equal(version.status, 0);
    assert.equal(version.stdout, `mdfmt ${manifest.version}\n`);
  }
});

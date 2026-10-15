import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// 導入スクリプト (scripts/setup.mjs) の試験。本物の npm の代わりに、依存の node_modules へリンクを張る
// スクリプト (MD_FORMAT_TEST_NPM_CLI) を動かし、ネットワークを使わずに導入・入れ替え・失敗・同時の導入を確かめる。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const setupPath = path.join(packageDir, "scripts", "setup.mjs");
const windows = process.platform === "win32";
const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
const head = spawnSync("git", ["-C", packageDir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

const fakeNpm = `import fs from "node:fs";
import path from "node:path";
fs.writeFileSync(path.join(process.cwd(), "npm-args.json"), JSON.stringify(process.argv.slice(2)));
if (process.env.MD_FORMAT_TEST_NPM_FAIL) { console.error("偽の npm の失敗"); process.exit(1); }
fs.symlinkSync(process.env.MD_FORMAT_TEST_NODE_MODULES, path.join(process.cwd(), "node_modules"), "junction");
`;

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), "md-format-setup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const npm = path.join(root, "fake-npm.mjs");
  await writeFile(npm, fakeNpm);
  const installDir = path.join(root, "share", "md-format");
  const binDir = path.join(root, "bin");
  const env = {
    ...process.env,
    MD_FORMAT_TEST_NPM_CLI: npm,
    MD_FORMAT_TEST_NODE_MODULES: path.join(packageDir, "node_modules"),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    // 導入先を %LOCALAPPDATA% の外として扱う (起動役にはフルパスを書く)。
    LOCALAPPDATA: path.join(root, "local-app-data"),
  };
  delete env.MD_FORMAT_TEST_NPM_FAIL;
  return { root, installDir, binDir, env };
}

function setup({ installDir, binDir, env }, ...extra) {
  const child = spawnSync(process.execPath, [setupPath, "--install-dir", installDir, "--bin-dir", binDir, ...extra],
    { cwd: packageDir, env, encoding: "utf8", timeout: 60000 });
  assert.ifError(child.error);
  return child;
}

const leftovers = (root) => readdirSync(path.join(root, "share")).filter((name) => name !== "md-format");

test("導入: 作業用フォルダで入れて確かめてから入れ替え、起動役を置き、--check が通る", async (t) => {
  const space = await workspace(t);
  const child = setup(space);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /導入済み: mdfmt /u);
  const installed = JSON.parse(await readFile(path.join(space.installDir, "install.json"), "utf8"));
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.commit, head);
  for (const name of ["format.mjs", "cli.mjs", "spare.mjs", "package.json", "package-lock.json"]) {
    assert.ok(existsSync(path.join(space.installDir, name)), name);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(space.installDir, "npm-args.json"), "utf8")),
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.deepEqual(leftovers(space.root), [], "作業用フォルダと鍵を残さない");

  const check = setup(space, "--check");
  assert.equal(check.status, 0, check.stdout);
  assert.match(check.stdout, /導入済み/u);

  // 起動役から整形できる。
  const launcher = windows ? path.join(space.binDir, "mdfmt.cmd") : path.join(space.binDir, "mdfmt");
  const run = windows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${launcher}" --version`], { env: space.env, encoding: "utf8", windowsVerbatimArguments: true })
    : spawnSync(launcher, ["--version"], { env: space.env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), `mdfmt ${manifest.version} (${head.slice(0, 12)})`);
  if (windows) {
    const cmd = await readFile(launcher, "utf8");
    assert.ok(cmd.includes(`node "${path.join(space.installDir, "format.mjs")}" %*`), cmd);
    assert.ok(existsSync(path.join(space.binDir, "mdfmt")), "Git Bash の起動役も置く");
    // PowerShell は mdfmt.ps1 を選び、& や %名前% を含む名前のファイルも、そのまま渡す。
    const ps1 = path.join(space.binDir, "mdfmt.ps1");
    assert.ok(existsSync(ps1));
    const odd = path.join(space.root, "a&b %TEMP% x.md");
    await writeFile(odd, "#  見出し\n");
    for (const shell of ["pwsh.exe", "powershell.exe"]) {
      const viaPs = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `& { $env:PATH = '${space.binDir.replaceAll("'", "''")};' + $env:PATH; mdfmt --check '${odd.replaceAll("'", "''")}'; exit $LASTEXITCODE }`],
      { env: space.env, encoding: "utf8" });
      if (viaPs.error?.code === "ENOENT") continue;
      assert.equal(viaPs.status, 1, `${shell}: ${viaPs.stdout}${viaPs.stderr}`);
      assert.match(viaPs.stdout, /a&b %TEMP% x\.md/u, shell);
    }
  }
});

test("導入し直すと、前の導入を入れ替えて片づける", async (t) => {
  const space = await workspace(t);
  assert.equal(setup(space).status, 0);
  await writeFile(path.join(space.installDir, "stale.txt"), "前の導入");
  const again = setup(space);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(existsSync(path.join(space.installDir, "stale.txt")), false);
  assert.deepEqual(leftovers(space.root), []);
});

test("npm が失敗したら、今の導入を変えずに止める", async (t) => {
  const space = await workspace(t);
  assert.equal(setup(space).status, 0);
  const before = await readFile(path.join(space.installDir, "install.json"), "utf8");
  await writeFile(path.join(space.installDir, "marker.txt"), "今の導入");
  const failed = setup({ ...space, env: { ...space.env, MD_FORMAT_TEST_NPM_FAIL: "1" } });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /md-format の導入に失敗しました: npm ci に失敗しました/u);
  assert.equal(await readFile(path.join(space.installDir, "install.json"), "utf8"), before);
  assert.equal(await readFile(path.join(space.installDir, "marker.txt"), "utf8"), "今の導入");
  assert.deepEqual(leftovers(space.root), [], "作業用フォルダと鍵を残さない");
});

test("ほかの導入が動いている (鍵がある) ときは、何も変えずに止める", async (t) => {
  const space = await workspace(t);
  await mkdir(`${space.installDir}.lock`, { recursive: true });
  await writeFile(path.join(`${space.installDir}.lock`, "pid"), String(process.pid));
  const blocked = setup(space);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /ほかの導入が動いています（プロセス \d+）/u);
  assert.equal(existsSync(space.installDir), false);
  assert.equal(existsSync(space.binDir), false);
});

test("clone の中と、clone を含むフォルダには導入しない", async (t) => {
  const space = await workspace(t);
  const inside = setup({ ...space, installDir: path.join(packageDir, "installed") });
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /リポジトリの外/u);
  assert.equal(existsSync(path.join(packageDir, "installed")), false);
  // ".." で始まる名前のフォルダも clone の中。
  const dotted = setup({ ...space, installDir: path.join(packageDir, "..backup") });
  assert.equal(dotted.status, 1);
  assert.match(dotted.stderr, /リポジトリの外/u);
  const ancestor = setup({ ...space, installDir: path.dirname(packageDir) });
  assert.equal(ancestor.status, 1);
  assert.match(ancestor.stderr, /clone を含むフォルダ/u);
  assert.ok(existsSync(path.join(packageDir, "format.mjs")), "clone を動かさない");
});

test("途中で止まった導入の鍵 (プロセスが無い) は、退避した前の導入を戻してから導入し直す", async (t) => {
  const space = await workspace(t);
  assert.equal(setup(space).status, 0);
  // 前の導入を退避した直後に止まった形を作る (導入先が無く、.old- と、止まったプロセスの番号の鍵が残る)。
  const previous = `${space.installDir}.old-99999`;
  const { renameSync } = await import("node:fs");
  renameSync(space.installDir, previous);
  await mkdir(`${space.installDir}.lock`);
  await writeFile(path.join(`${space.installDir}.lock`, "pid"), "2147483646");
  await mkdir(`${space.installDir}.new-99999`);
  const again = setup(space);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /途中で止まった導入の鍵を片づけます/u);
  assert.ok(existsSync(path.join(space.installDir, "install.json")));
  assert.deepEqual(leftovers(space.root), []);
});

test("起動役がリンクでも、リンクの先を書き換えずに、起動役そのものを置き換える", async (t) => {
  const space = await workspace(t);
  await mkdir(space.binDir, { recursive: true });
  const target = path.join(space.root, "target.txt");
  await writeFile(target, "リンクの先");
  const launcher = path.join(space.binDir, windows ? "mdfmt.cmd" : "mdfmt");
  const { symlinkSync, lstatSync } = await import("node:fs");
  try {
    symlinkSync(target, launcher, "file");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("この環境ではシンボリックリンクを作れない");
    throw error;
  }
  assert.equal(setup(space).status, 0);
  assert.equal(await readFile(target, "utf8"), "リンクの先");
  assert.equal(lstatSync(launcher).isSymbolicLink(), false);
});

test("--check は何も変えずに、足りないものを知らせて 1 で終わる", async (t) => {
  const space = await workspace(t);
  const check = setup({ ...space, env: { ...space.env, PATH: process.env.PATH } }, "--check");
  assert.equal(check.status, 1);
  assert.match(check.stdout, /問題: 導入されていません/u);
  assert.match(check.stdout, /問題: 起動役がありません/u);
  assert.match(check.stdout, /PATH にありません/u);
  assert.equal(existsSync(path.join(space.root, "share")), false);
  assert.equal(existsSync(space.binDir), false);
});

test("Windows では、ASCII でない導入先のパスを mdfmt.cmd に書かず、PowerShell と Git Bash の起動役は置く", { skip: !windows }, async (t) => {
  const space = await workspace(t);
  const installDir = path.join(space.root, "導入先", "md-format");
  const child = setup({ ...space, installDir });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /mdfmt\.cmd は置きません/u);
  assert.equal(existsSync(path.join(space.binDir, "mdfmt.cmd")), false);
  assert.ok((await readFile(path.join(space.binDir, "mdfmt.ps1"), "utf8")).includes(path.join(installDir, "format.mjs")));
  assert.ok(existsSync(path.join(space.binDir, "mdfmt")));
});

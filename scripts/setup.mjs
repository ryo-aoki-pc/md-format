#!/usr/bin/env node
// mdfmt を導入する (Node.js 22 以降)。
//
// リポジトリの外の導入先 (Linux は ${XDG_DATA_HOME:-~/.local/share}/md-format、Windows は %LOCALAPPDATA%\md-format) に
// 整形器を写して依存を npm ci で入れ、起動役 (mdfmt) を ~/.local/bin (Windows は %USERPROFILE%\.local\bin) に置く。
// 隣の作業用フォルダで入れて確かめてから、今の導入と入れ替える (途中で失敗しても、今の導入を壊さない)。
// リポジトリを更新したら再実行する。--check は何も変えずに、導入の状態を確かめる。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const minimumNode = 22;

const usage = `使い方: node scripts/setup.mjs [--check] [--install-dir <フォルダ>] [--bin-dir <フォルダ>]

mdfmt を導入する。--check は何も変えずに、導入の状態を確かめる。
  --install-dir <フォルダ>  整形器と依存を置くフォルダ（既定: ${defaultInstallDirectory()}）
  --bin-dir <フォルダ>      起動役 mdfmt を置くフォルダ（既定: ${defaultBinDirectory()}）
`;

function defaultInstallDirectory() {
  let base;
  if (windows) {
    base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  } else if (process.platform === "darwin") {
    base = path.join(os.homedir(), "Library", "Application Support");
  } else {
    const xdg = process.env.XDG_DATA_HOME;
    base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
  }
  return path.join(base, "md-format");
}

function defaultBinDirectory() {
  return path.join(os.homedir(), ".local", "bin");
}

function parseArguments(argv) {
  const options = { installDir: defaultInstallDirectory(), binDir: defaultBinDirectory(), check: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--install-dir" || argument === "--bin-dir") {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} の値がありません`);
      options[argument === "--install-dir" ? "installDir" : "binDir"] = path.resolve(value);
    } else {
      throw new Error(`知らない引数です: ${argument}`);
    }
  }
  return options;
}

// child が parent そのものか、その下か。".." で始まる名前のフォルダ (..backup など) は下にあるとみなす。
function inside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative.split(/[\\/]/u)[0] !== ".." && !path.isAbsolute(relative));
}

function onPath(directory) {
  const target = path.resolve(directory);
  const same = (entry) => (windows ? entry.toLowerCase() === target.toLowerCase() : entry === target);
  return (process.env.PATH || "").split(path.delimiter).some((entry) => entry && same(path.resolve(entry)));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function repositoryVersion() {
  return readJson(path.join(repository, "package.json"))?.version ?? null;
}

// clone のコミット (git が無い・clone でないときは null)。
function repositoryCommit() {
  const result = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

// 導入先に写すもの。整形器の .mjs (scripts と test は除く) と、依存の定義。
function sourceFiles() {
  const files = fs.readdirSync(repository).filter((name) => name.endsWith(".mjs"));
  return [...files.sort(), "package.json", "package-lock.json"];
}

// npm は npm-cli.js を探して node で動かす (シェルを通さない。Windows の npm.cmd も Scoop の shim も避ける)。
// MD_FORMAT_TEST_NPM_CLI は試験用 (本物の npm の代わりに動かすスクリプト)。
function npmCli() {
  if (process.env.MD_FORMAT_TEST_NPM_CLI) return process.env.MD_FORMAT_TEST_NPM_CLI;
  const candidates = [];
  if (process.env.npm_execpath?.endsWith("npm-cli.js")) candidates.push(process.env.npm_execpath);
  const nodeDirectory = path.dirname(fs.realpathSync(process.execPath));
  candidates.push(path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    if (!entry) continue;
    for (const name of windows ? ["npm.cmd", "npm"] : ["npm"]) {
      let real;
      try {
        real = fs.realpathSync(path.join(entry, name));
      } catch {
        continue;
      }
      if (real.endsWith(".js")) candidates.push(real);
      candidates.push(path.join(path.dirname(real), "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(path.dirname(real), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
    }
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("npm (npm-cli.js) が見つかりません。Node.js の npm を入れてください");
  return found;
}

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

// 起動役の中身。Linux と Git Bash は sh。Windows の PowerShell は mdfmt.ps1、cmd は mdfmt.cmd。
// PowerShell は同じフォルダの .ps1 を .cmd より先に選ぶ。.cmd を通すと、cmd.exe が引数の & や %名前% を解釈してしまう
// (PowerShell から mdfmt.cmd に a&b.md を渡すと、b.md をコマンドとして動かそうとする) ので、PowerShell では .ps1 を使う。
// .ps1 は、setup-notes の手順で実行ポリシーを RemoteSigned にした PowerShell で動く。
function launchers(installDir, binDir) {
  const formatter = path.join(installDir, "format.mjs");
  const sh = (file) => `#!/bin/sh\nexec node '${file.replaceAll("'", "'\\''")}' "$@"\n`;
  if (!windows) return [{ file: path.join(binDir, "mdfmt"), text: sh(formatter), mode: 0o755 }];
  const localAppData = process.env.LOCALAPPDATA;
  const underLocalAppData = localAppData && inside(formatter, localAppData);
  const relative = underLocalAppData ? path.relative(localAppData, formatter) : "";
  // PowerShell 5.1 は BOM の無い .ps1 を ANSI で読むので、BOM を付ける。
  const psPath = underLocalAppData
    ? `(Join-Path $env:LOCALAPPDATA '${relative.replaceAll("'", "''")}')`
    : `'${formatter.replaceAll("'", "''")}'`;
  const result = [
    {
      file: path.join(binDir, "mdfmt.ps1"),
      text: "\ufeff# mdfmt の起動役 (PowerShell)。md-format の導入スクリプト (scripts/setup.mjs) が置いた。\r\n" +
        `$formatter = ${psPath}\r\n` +
        "if ($MyInvocation.ExpectingInput) { $input | & node $formatter @args } else { & node $formatter @args }\r\n" +
        "exit $LASTEXITCODE\r\n",
    },
    { file: path.join(binDir, "mdfmt"), text: sh(formatter.replaceAll("\\", "/")), mode: 0o755 },
  ];
  // cmd は .cmd を OEM のコードページで読み、% を展開するので、ASCII でないパスや % と " を含むパスは書かない
  // (そのときは .cmd を置かない。cmd からは使えないが、PowerShell と Git Bash からは使える)。
  const cmdPath = underLocalAppData ? path.join("%LOCALAPPDATA%", relative) : formatter;
  if (!/[^\x20-\x7e]|[%"]/u.test(underLocalAppData ? relative : formatter)) {
    result.push({ file: path.join(binDir, "mdfmt.cmd"), text: `@echo off\r\nnode "${cmdPath}" %*\r\nexit /b %ERRORLEVEL%\r\n` });
  }
  return result;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

// 作業用フォルダの整形器を動かして確かめる (依存が揃い、HTML の整形器も読めること)。
function selfTest(directory, version) {
  const formatter = path.join(directory, "format.mjs");
  const shown = run(process.execPath, [formatter, "--version"], { cwd: directory });
  if (shown.status !== 0 || !shown.stdout.startsWith(`mdfmt ${version}`)) {
    throw new Error(`導入した mdfmt が動きません: ${(shown.stderr || shown.stdout).trim()}`);
  }
  const input = "#  見出し\n\n<table><tr><td>a</td></tr></table>\n";
  const formatted = run(process.execPath, [formatter, "--filename", path.join(directory, "check.md")], { cwd: directory, input });
  if (formatted.status !== 0 || !formatted.stdout.startsWith("# 見出し\n") || !formatted.stdout.includes("\n  <tr>\n")) {
    throw new Error(`導入した mdfmt で整形できません: ${(formatted.stderr || formatted.stdout).trim()}`);
  }
}

function remove(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// 途中で止まった導入の後片づけ。導入先が無く、退避した前の導入 (<導入先>.old-<番号>) があれば、いちばん新しいものを戻す。
// 残った作業用フォルダ (.new-*) と退避 (.old-*) は消す。
function recover(installDir) {
  const parent = path.dirname(installDir);
  const base = path.basename(installDir);
  const leftovers = fs.readdirSync(parent).filter((name) => name.startsWith(`${base}.old-`) || name.startsWith(`${base}.new-`))
    .map((name) => path.join(parent, name));
  const previous = leftovers.filter((full) => path.basename(full).startsWith(`${base}.old-`))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!fs.existsSync(installDir) && previous.length) {
    fs.renameSync(previous[0], installDir);
    console.log(`途中で止まった導入から、前の導入を戻しました: ${installDir}`);
  }
  for (const full of leftovers) remove(full);
}

// 同時に 2 つの導入を動かさないための鍵 (<導入先>.lock)。中に導入しているプロセスの番号を書く。そのプロセスがもう無い
// (途中で止まった導入の) 鍵は、後片づけをしてから取り直す。番号を書く前に止まった鍵は、10 分たてば止まったものとみなす。
function acquireLock(installDir) {
  const lock = `${installDir}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
      return lock;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let owner = 0;
    try {
      owner = Number(fs.readFileSync(path.join(lock, "pid"), "utf8"));
    } catch {
      // 番号を書く前の鍵。
    }
    const stale = owner ? !processAlive(owner) : Date.now() - fs.statSync(lock).mtimeMs > 10 * 60 * 1000;
    if (!stale) {
      throw new Error(`ほかの導入が動いています${owner ? `（プロセス ${owner}）` : ""}。終わるのを待ってからやり直してください: ${lock}`);
    }
    console.log(`途中で止まった導入の鍵を片づけます: ${lock}`);
    recover(installDir);
    remove(lock);
  }
  throw new Error(`導入の鍵を取れません: ${lock}`);
}

// 起動役は隣の一時ファイルに書いてから置き換える (今の起動役がリンクでも、リンクの先を書き換えない。途中で止まっても、
// 起動役が欠けない)。
function writeLauncher({ file, text, mode }) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, text, { flag: "w" });
    if (mode) fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function install({ installDir, binDir }) {
  if (inside(installDir, repository) || inside(binDir, repository)) {
    throw new Error("--install-dir と --bin-dir はリポジトリの外を指定してください（clone の中に依存を置かない）");
  }
  // 導入先は入れ替えるので、clone を中に含むフォルダは使えない (clone ごと退避して消してしまう)。
  if (inside(repository, installDir)) throw new Error("--install-dir に、clone を含むフォルダは指定できません");
  if (nodeMajor() < minimumNode) throw new Error(`Node.js ${minimumNode} 以上が必要です（今は ${process.version}）`);
  const version = repositoryVersion();
  if (!version) throw new Error(`package.json を読めません: ${repository}`);
  const npm = npmCli();
  const planned = launchers(installDir, binDir);
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  // 同時に 2 つの導入を動かさない (作業用フォルダと入れ替えがぶつかる)。
  const lock = acquireLock(installDir);
  const staging = `${installDir}.new-${process.pid}`;
  const previous = `${installDir}.old-${process.pid}`;
  try {
    remove(staging);
    fs.mkdirSync(staging);
    for (const name of sourceFiles()) fs.copyFileSync(path.join(repository, name), path.join(staging, name));
    console.log(`依存を入れます: ${staging}`);
    const installed = run(process.execPath, [npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: staging, stdio: "inherit" });
    if (installed.status !== 0) throw new Error("npm ci に失敗しました（上の出力を確かめてください）");
    selfTest(staging, version);
    fs.writeFileSync(path.join(staging, "install.json"), JSON.stringify({
      version, commit: repositoryCommit(), source: repository, node: process.version,
    }, null, 2) + "\n");
    // 今の導入を脇へ移してから入れ替える。移せなければ (Windows で使われていれば) 何も変えずに止める。
    if (fs.existsSync(installDir)) {
      try {
        fs.renameSync(installDir, previous);
      } catch (error) {
        if (["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
          throw new Error(`導入先を入れ替えられません（${error.code}）。mdfmt を使っている Neovim などを閉じてからやり直してください: ${installDir}`);
        }
        throw error;
      }
    }
    try {
      fs.renameSync(staging, installDir);
    } catch (error) {
      if (fs.existsSync(previous)) fs.renameSync(previous, installDir);
      throw error;
    }
    try {
      remove(previous);
    } catch {
      console.log(`注意: 前の導入を消せませんでした。後で消してください: ${previous}`);
    }
    // 起動役も、鍵を持っている間に置く。
    fs.mkdirSync(binDir, { recursive: true });
    for (const launcher of planned) {
      writeLauncher(launcher);
      console.log(`起動役を置きました: ${launcher.file}`);
    }
    if (windows && !planned.some(({ file }) => file.endsWith(".cmd"))) {
      console.log(`注意: 導入先のパスに ASCII でない文字か % か " があるので、cmd 用の mdfmt.cmd は置きません（PowerShell と Git Bash からは使えます）`);
    }
  } finally {
    // 片づけが失敗しても、元の誤りを消さず、鍵は外す。
    try {
      remove(staging);
    } catch {
      console.log(`注意: 作業用フォルダを消せませんでした。後で消してください: ${staging}`);
    }
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function check({ installDir, binDir }) {
  const problems = [];
  const notes = [];
  if (nodeMajor() < minimumNode) problems.push(`Node.js ${minimumNode} 以上が必要です（今は ${process.version}）`);
  const installed = readJson(path.join(installDir, "install.json"));
  const expected = { version: repositoryVersion(), commit: repositoryCommit() };
  const label = (value) => `${value?.version ?? "?"}${value?.commit ? ` / ${value.commit.slice(0, 12)}` : ""}`;
  if (!installed) {
    problems.push(`導入されていません: ${installDir}`);
  } else {
    if (installed.version !== expected.version || (expected.commit && installed.commit !== expected.commit)) {
      problems.push(`導入した版（${label(installed)}）が clone（${label(expected)}）と違います。導入し直してください`);
    }
    // 整形器の .mjs は clone にあるものをすべて (方言の表 flavors.mjs など、後から増えたものも) 確かめる。
    for (const name of [...sourceFiles(), path.join("node_modules", "markdownlint-cli2"),
      path.join("node_modules", "comrak"), path.join("node_modules", "js-beautify")]) {
      if (!fs.existsSync(path.join(installDir, name))) problems.push(`導入先に ${name} がありません。導入し直してください`);
    }
  }
  let planned = [];
  try {
    planned = launchers(installDir, binDir);
  } catch (error) {
    problems.push(error.message);
  }
  for (const { file, text } of planned) {
    let actual = null;
    try {
      actual = fs.readFileSync(file, "utf8");
    } catch {
      // 無いときは下で知らせる。
    }
    if (actual === null) problems.push(`起動役がありません: ${file}`);
    else if (actual !== text) problems.push(`起動役の中身が導入先と合いません。導入し直してください: ${file}`);
  }
  if (!onPath(binDir)) problems.push(`${binDir} が PATH にありません。PATH に足すか、起動役をフルパスで動かしてください`);
  // LazyVimStarter の :GlfmFormatInstall が入れていた古い依存 (md-format に切り替えた後は使わない)。
  const old = windows
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "nvim-data", "glfm-format")
    : path.join(process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
      ? process.env.XDG_DATA_HOME : path.join(os.homedir(), ".local", "share"), "nvim", "glfm-format");
  if (fs.existsSync(old)) notes.push(`古い Neovim の整形器の依存が残っています。LazyVimStarter を md-format に切り替えた後は消してよい: ${old}`);
  for (const problem of problems) console.log(`問題: ${problem}`);
  for (const note of notes) console.log(`注意: ${note}`);
  if (!problems.length) console.log(`導入済み: mdfmt ${label(installed)}（${planned.map(({ file }) => file).join("・")}）`);
  return problems.length ? 1 : 0;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage);
      return 0;
    }
    if (options.check) return check(options);
    install(options);
    return check(options);
  } catch (error) {
    console.error(`md-format の導入に失敗しました: ${error.message}`);
    return 1;
  }
}

process.exitCode = main();

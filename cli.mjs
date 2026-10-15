// mdfmt のコマンドライン。標準入力・ファイル・フォルダの Markdown を整形する。
// 整形そのものは format.mjs の formatMarkdown が行い、ここでは引数・読み書き・終了コードだけを扱う。
import fs from "node:fs";
import { chmod, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import path from "node:path";
import { text as readText } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { formatMarkdown } from "./format.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

// 終了コード。changed は --check で変わるファイルがあったとき。
export const exitCodes = Object.freeze({ ok: 0, changed: 1, error: 2 });

const valueOptions = new Map([["--runtime-dir", "runtimeDir"], ["--filename", "filename"], ["--config", "config"],
  ["--range-start", "rangeStart"], ["--range-end", "rangeEnd"],
  ["--range-start-column", "rangeStartColumn"], ["--range-end-column", "rangeEndColumn"],
  ["--enable-fixes", "enableFixes"], ["--disable-fixes", "disableFixes"]]);
const flagOptions = new Map([["--write", "write"], ["--check", "check"],
  ["--help", "help"], ["-h", "help"], ["--version", "version"], ["-v", "version"]]);

const usage = `使い方: mdfmt [オプション] [ファイルかフォルダ …]

GFM と GLFM の Markdown を、描画を変えずに整形する。
ファイルを渡さなければ、標準入力を整形して標準出力に書く。
フォルダを渡すと、その下の *.md を扱う（.git・node_modules・. で始まるフォルダは除く）。

オプション:
  --write                    変わるファイルを書き換え、その名前を出す
  --check                    書き換えずに、変わるファイルの名前を出す（あれば終了コード 1）
  --filename <パス>          標準入力の文書のファイル名（設定を探す場所。既定は ./stdin.md）
  --config <パス>            markdownlint の設定ファイル
  --enable-fixes <名前,…>    直す対象（分類名かルール名）を有効にする
  --disable-fixes <名前,…>   直す対象を無効にする
  --range-start <行> --range-end <行> [--range-start-column <桁>] [--range-end-column <桁>]
                             その範囲だけを直す（標準入力か 1 つのファイルのとき）
  --runtime-dir <フォルダ>   依存（node_modules）の場所。既定は mdfmt の導入先
  -h, --help                 この使い方を出す
  -v, --version              版を出す

終了コード: 0 は成功、1 は --check で変わるファイルがあった、2 は誤り。
PowerShell では、パイプやリダイレクトは文字コードや改行を変えることがあるので、ファイルを渡して --write か --check で使う。
`;

// 引数を読む。誤りは投げる (呼び出し側が 1 行で知らせる)。
export function parseArguments(argv) {
  const options = {};
  const inputs = [];
  let onlyInputs = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (onlyInputs || !argument.startsWith("-")) {
      inputs.push(argument);
      continue;
    }
    if (argument === "--") {
      onlyInputs = true;
      continue;
    }
    const flag = flagOptions.get(argument);
    const name = valueOptions.get(argument);
    if (!flag && !name) throw new Error(`知らない引数です: ${argument}（mdfmt --help で使い方を出す）`);
    if (options[flag ?? name] !== undefined) throw new Error(`同じ引数を複数回指定できません: ${argument}`);
    if (flag) {
      options[flag] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`引数 ${argument} の値がありません。`);
    options[name] = value;
    index++;
  }
  if (options.write && options.check) throw new Error("--write と --check は一緒に指定できません。");
  if ((options.write || options.check) && !inputs.length && !options.help && !options.version) {
    throw new Error("--write と --check は、ファイルかフォルダと一緒に指定してください（標準入力は書き換えも確かめもしない）。");
  }
  if (options.filename !== undefined && inputs.length) throw new Error("--filename は、標準入力を整形するときだけ指定できます。");
  return { options, inputs };
}

// --enable-fixes と --disable-fixes は、カンマ区切りの分類名かルール名。同じ名前を両方に書くと、整形の API が拒む。
function fixesOf(options) {
  let fixes;
  for (const [name, enabled] of [["enableFixes", true], ["disableFixes", false]]) {
    if (options[name] === undefined) continue;
    fixes ||= {};
    for (const fix of options[name].split(",").map((value) => value.trim())) {
      if (!fix) throw new Error("整形する対象の名前が空です。");
      if (Object.hasOwn(fixes, fix) && fixes[fix] !== enabled) {
        throw new Error(`整形する対象 ${fix} を、有効と無効の両方に指定しています。`);
      }
      fixes[fix] = enabled;
    }
  }
  return fixes;
}

function rangeOf(options) {
  if (options.rangeStart === undefined && options.rangeEnd === undefined &&
      options.rangeStartColumn === undefined && options.rangeEndColumn === undefined) return undefined;
  if (!options.rangeStart || !options.rangeEnd) throw new Error("範囲の開始行と終了行を指定してください。");
  return {
    start: [Number(options.rangeStart), options.rangeStartColumn === undefined ? 0 : Number(options.rangeStartColumn)],
    end: [Number(options.rangeEnd), options.rangeEndColumn === undefined ? Infinity : Number(options.rangeEndColumn)],
  };
}

// file が directory そのものか、その下か。".." で始まる名前のフォルダ (..backup など) は下にあるとみなす。
function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative === "" || (relative.split(/[\\/]/u)[0] !== ".." && !path.isAbsolute(relative));
}

// 1 つの文書の整形の設定。conform は Neovim の作業ディレクトリで起動する。以前の markdownlint-cli2 --fix と同じく、
// ファイルがその下にあればそこを CLI2 の基準にし、上の階層のプロジェクト設定も読ませる。
function documentOptions(base, filename) {
  const options = { ...base, filename };
  if (isInside(process.cwd(), filename)) options.cwd = process.cwd();
  return options;
}

// フォルダの下の *.md を名前順に集める。. で始まるフォルダ・node_modules と、シンボリックリンクはたどらない。
// 読めない子フォルダは problems に足して、残りを集め続ける (渡したフォルダそのものが読めなければ投げる)。
async function markdownFiles(directory, problems, root = true) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (root) throw error;
    problems.push({ path: directory, error });
    return [];
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") files.push(...await markdownFiles(full, problems, false));
    } else if (entry.isFile() && /\.md$/iu.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const bom = Buffer.from([0xef, 0xbb, 0xbf]);
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ファイルはバイトで読み、UTF-8 として厳しく解く。BOM は外して覚え、書き戻すときに付け直す。
async function readDocument(file) {
  const bytes = await readFile(file);
  const hasBom = bytes.subarray(0, 3).equals(bom);
  let text;
  try {
    text = strictUtf8.decode(hasBom ? bytes.subarray(3) : bytes);
  } catch {
    throw new Error("UTF-8 として読めません（ファイルは変えていません）。");
  }
  return { text, hasBom };
}

function encodeDocument(text, hasBom) {
  const body = Buffer.from(text, "utf8");
  return hasBom ? Buffer.concat([bom, body]) : body;
}

// 一時ファイルに書いてから置き換える (途中で止まっても元のファイルを壊さない)。属性は元のファイルから写す。
// シンボリックリンクは、リンクの先のファイルを書き換える。
async function replaceFile(file, bytes) {
  const target = await realpath(file);
  const { mode } = await stat(target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.mdfmt-${process.pid}.tmp`);
  // 前に止まった実行の一時ファイル (同じ番号) が残っていれば消してから作る。
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode });
    await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`書き換えられません（ファイルは変えていません）: ${firstLine(error)}`, { cause: error });
  }
}

function displayPath(file) {
  return isInside(process.cwd(), file) ? path.relative(process.cwd(), file) : file;
}

function firstLine(error) {
  return error?.message?.split(/[\r\n]/u)[0] || "不明なエラー";
}

function version() {
  const manifest = JSON.parse(fs.readFileSync(path.join(scriptDirectory, "package.json"), "utf8"));
  let commit = "";
  try {
    // 導入スクリプトが、導入した clone のコミットを書き残す。
    const installed = JSON.parse(fs.readFileSync(path.join(scriptDirectory, "install.json"), "utf8"));
    if (typeof installed.commit === "string" && installed.commit) commit = ` (${installed.commit.slice(0, 12)})`;
  } catch {
    // clone から直接動かしたときは、install.json が無い。
  }
  return `mdfmt ${manifest.version}${commit}\n`;
}

// 標準入力の文書を整形して標準出力に書く (Neovim の保存時の整形と予備のプロセスもここを通る)。
async function formatStandardInput(base, input) {
  const filename = path.resolve(base.filename ?? path.join(process.cwd(), "stdin.md"));
  const options = documentOptions({ ...base, filename: undefined }, filename);
  try {
    // 標準入力は今までどおり、BOM を外して不正な UTF-8 を置き換える (Neovim のバッファは BOM を含まない)。
    const output = await formatMarkdown(await readText(input), options);
    process.stdout.write(output);
    return exitCodes.ok;
  } catch (error) {
    process.stderr.write(`mdfmt: Markdown の整形に失敗しました: ${firstLine(error)}\n`);
    return exitCodes.error;
  }
}

async function formatFiles(base, inputs, mode) {
  let failed = false;
  let changed = false;
  const files = [];
  const seen = new Set();
  for (const input of inputs) {
    const resolved = path.resolve(input);
    const problems = [];
    let found;
    try {
      found = (await stat(resolved)).isDirectory() ? await markdownFiles(resolved, problems) : [resolved];
    } catch (error) {
      process.stderr.write(`mdfmt: ${input}: 開けません: ${firstLine(error)}\n`);
      failed = true;
      continue;
    }
    for (const problem of problems) {
      process.stderr.write(`mdfmt: ${displayPath(problem.path)}: 開けません: ${firstLine(problem.error)}\n`);
      failed = true;
    }
    for (const file of found) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  for (const file of files) {
    try {
      const { text, hasBom } = await readDocument(file);
      const output = await formatMarkdown(text, documentOptions(base, file));
      if (mode === "stdout") {
        process.stdout.write(encodeDocument(output, hasBom));
      } else if (output !== text) {
        changed = true;
        if (mode === "write") {
          try {
            await replaceFile(file, encodeDocument(output, hasBom));
          } catch (error) {
            process.stderr.write(`mdfmt: ${displayPath(file)}: ${firstLine(error)}\n`);
            failed = true;
            continue;
          }
        }
        process.stdout.write(`${displayPath(file)}\n`);
      }
    } catch (error) {
      process.stderr.write(`mdfmt: ${displayPath(file)}: Markdown の整形に失敗しました: ${firstLine(error)}\n`);
      failed = true;
    }
  }
  if (failed) return exitCodes.error;
  return mode === "check" && changed ? exitCodes.changed : exitCodes.ok;
}

async function run(argv, input) {
  const { options, inputs } = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage);
    return exitCodes.ok;
  }
  if (options.version) {
    process.stdout.write(version());
    return exitCodes.ok;
  }
  // 依存の場所を省くと、このファイルのフォルダ (導入先) から読む。
  const runtimeDir = options.runtimeDir || scriptDirectory;
  // 保存のたびの起動の大半は、依存 (markdownlint-cli2 とその依存) の読み込み。Node が対応していれば (22.8 以上)、
  // コンパイルの結果を依存の隣に残して次の起動で使う。ファイルの中身が変われば Node が作り直す。使えなくても整形は続ける。
  try {
    nodeModule.enableCompileCache?.(path.join(path.resolve(runtimeDir), ".compile-cache"));
  } catch {
    // compile cache は速さのためだけのもの。
  }
  // --config の相対パスは、起動したフォルダから解く (ファイルごとの基準のフォルダで変わらないように)。
  const config = options.config === undefined ? undefined : path.resolve(options.config);
  const base = { runtimeDir, config, fixes: fixesOf(options), range: rangeOf(options) };
  if (!inputs.length) {
    if (input === process.stdin && process.stdin.isTTY) {
      process.stderr.write(usage);
      return exitCodes.error;
    }
    return formatStandardInput({ ...base, filename: options.filename }, input);
  }
  const mode = options.write ? "write" : options.check ? "check" : "stdout";
  if (mode === "stdout") {
    if (inputs.length > 1) throw new Error("複数のファイルやフォルダは、--write か --check と一緒に指定してください。");
    if ((await stat(path.resolve(inputs[0])).catch(() => undefined))?.isDirectory()) {
      throw new Error("フォルダは、--write か --check と一緒に指定してください。");
    }
  }
  if (base.range && (inputs.length > 1 ||
      (await stat(path.resolve(inputs[0])).catch(() => undefined))?.isDirectory())) {
    throw new Error("範囲は、標準入力か 1 つのファイルのときだけ指定できます。");
  }
  return formatFiles(base, inputs, mode);
}

// 終了コードは 0・1・2 のどれかにする (markdownlint の JS の設定が process.exitCode を変えても、結果で上書きする)。
export async function cli(argv = process.argv.slice(2), input = process.stdin) {
  process.exitCode = await run(argv, input);
}

export function cliFailure(error) {
  process.stderr.write(`mdfmt: ${firstLine(error)}\n`);
  process.exitCode = exitCodes.error;
}

export function main() {
  cli().catch(cliFailure);
}

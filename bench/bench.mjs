#!/usr/bin/env node
// 速さの測定。整形のコマンドを、同じ文書で何回か動かし、中央値と最も遅い値を出す。
// 使い方: node bench/bench.mjs [--runs 10] <名前>=<文書>=<コマンド> …
//   コマンドは JSON の配列 (例: ["node","format.mjs","--filename","x.md"])。--filename を付けたコマンドには、
//   文書を標準入力に渡す (付けないコマンドには、ファイルを引数で渡す)。
//   <名前> は表の行の名前。結果は Markdown の表で標準出力に書く。
//   はじめに全部を 1 回ずつ空回しし、その後は全部を順に 1 回ずつ動かすことを、--runs の回数だけ繰り返す
//   (時間とともに変わる負荷が、特定の行に偏らないようにする)。
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
let runs = 10;
const cases = [];
for (let index = 0; index < argv.length; index++) {
  if (argv[index] === "--runs") {
    runs = Number(argv[++index]);
    continue;
  }
  const [name, file, ...rest] = argv[index].split("=");
  cases.push({ name, file, command: JSON.parse(rest.join("=")), times: [] });
}
if (!cases.length || !(runs > 0)) {
  process.stderr.write("使い方: node bench/bench.mjs [--runs 10] <名前>=<文書>=<コマンドの JSON 配列> …\n");
  process.exit(2);
}

function once({ file, command }) {
  const input = fs.readFileSync(file);
  const started = process.hrtime.bigint();
  // 文書を標準入力に渡すのは、--filename を付けたときだけ (ファイルを引数で渡すときは、読まない子に書かない)。
  const child = spawnSync(command[0], command.slice(1), { input: command.includes("--filename") ? input : "", maxBuffer: 1 << 30 });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (child.error) throw child.error;
  // --check は、整形の要るファイルがあると 1 で終わる。
  if (child.status !== 0 && !(child.status === 1 && command.includes("--check"))) throw new Error(`${command.join(" ")}: 終了コード ${child.status}: ${String(child.stderr).trim()}`);
  return ms;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

for (const item of cases) once(item);
for (let run = 0; run < runs; run++) {
  for (const item of cases) item.times.push(once(item));
}
const format = (ms) => Math.round(ms).toLocaleString("en-US");
process.stdout.write(`| 測ったもの | 文書 | 中央値 | 最も遅い値 |\n| --- | --- | ---: | ---: |\n`);
for (const item of cases) {
  const lines = fs.readFileSync(item.file, "utf8").split("\n").length - 1;
  process.stdout.write(`| ${item.name} | ${lines.toLocaleString("en-US")} 行 | ${format(median(item.times))} ms | ` +
    `${format(Math.max(...item.times))} ms |\n`);
}

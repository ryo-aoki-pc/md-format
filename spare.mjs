#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer as readBuffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { cli, cliFailure, preload } from "./format.mjs";

const formatterPath = fileURLToPath(new URL("./format.mjs", import.meta.url));
const runtimeIndex = process.argv.indexOf("--runtime-dir", 2);
preload(runtimeIndex === -1 ? undefined : process.argv[runtimeIndex + 1]);

async function spare() {
  // 本文はデコードせず、CLI と同じ readText に BOM と不正な UTF-8 の扱いを任せる。
  const request = await readBuffer(process.stdin);
  const newline = request.indexOf(0x0a);
  if (newline === -1) return;
  let header;
  try {
    header = JSON.parse(request.subarray(0, newline).toString("utf8"));
    if (!header || typeof header !== "object" || Array.isArray(header) ||
        typeof header.script !== "string" || !Array.isArray(header.argv) ||
        !header.argv.every((argument) => typeof argument === "string") ||
        typeof header.cwd !== "string" || !path.isAbsolute(header.cwd) ||
        fs.realpathSync(path.resolve(header.cwd, header.script)) !== fs.realpathSync(formatterPath)) {
      process.exitCode = 86;
      return;
    }
    process.chdir(header.cwd);
  } catch {
    // Lua はこの終了コードだけを予備の使い方の失敗として扱い、従来の CLI でやり直す。
    process.exitCode = 86;
    return;
  }
  process.argv = [process.execPath, path.resolve(header.script), ...header.argv];
  await cli(header.argv, Readable.from([request.subarray(newline + 1)]));
}

spare().catch(cliFailure);

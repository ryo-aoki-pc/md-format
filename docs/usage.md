# md-format の使い方（AlmaLinux 10・Windows 11）

- GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド（[md-format](../README.md)）。Neovim（LazyVim）の保存のときの整形も、これを使う
- 導入と更新は [md-format の導入と更新](install.md) にある
- どの項も単独で通せる。項のリードの前提を先に満たす
- bash のブロックはブラケットペーストの効く端末に、PowerShell のブロックは PowerShell 7 に貼り、貼った後に Enter を押す。貼り方と、反転表示の「確認」から後ろの出力の読み方は、setup-notes の [AlmaLinux 10 のセットアップ](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md) と [Windows 11 のセットアップ](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md) の冒頭に従う

<details id="この文書の補足と注意点">
  <summary>この文書の補足と注意点</summary>

**参照**

- 検証記録（setup-notes-verification の `docs/verification/almalinux-setup.md`）
- 検証記録（setup-notes-verification の `docs/verification/windows-setup.md`）

</details>

## AlmaLinux 10 で使う

- GNOME にログインした自分のユーザーで行う。前提の setup-notes の項は、各項のリードのリンクから開く

### mdfmt で Markdown を整形する

- 文書を整形し、整形の要るファイルを確かめる
- 前提: [md-format を導入・更新する](install.md#md-format-を導入更新する)を通し、`mdfmt` が PATH にある
- 実行場所: GNOME にログインした自分のユーザーの端末（bash。`sudo` は使わない）の、整形する文書のあるディレクトリ
- 方言の既定は GLFM。GitHub 向けの文書のリポジトリでは、この項の手順 1 で GFM にする
- `docs` と `README.md` は、整形するフォルダーとファイルに置き換える

1. GitHub 向けの文書のリポジトリなら、そのリポジトリの直下で方言を GFM にする。

   ```bash
   printf '%s\n' '{ "flavor": "gfm" }' > .md-format.json
   ```

   - GitLab 向け（GLFM）の文書なら、この手順は行わない
   - 長い行を折りたいときは `{ "flavor": "gfm", "fixes": { "line_length": true } }` と書く（幅は markdownlint の MD013 の設定）

1. 整形の要るファイルを確かめる。

   ```bash
   mdfmt --check docs README.md
   ```

   - 整形の要るファイルの名前が出る。何も出なければ、整形は要らない
   - `mdfmt:` で始まる行は誤り。そのファイルは変えていない

1. 整形して書き換える。

   ```bash
   mdfmt --write docs README.md
   ```

   - 書き換えたファイルの名前が出る

<details id="mdfmt-で-markdown-を整形する-の補足と注意点">
  <summary>mdfmt で Markdown を整形する の補足と注意点</summary>

**[mdfmt で Markdown を整形する](#mdfmt-で-markdown-を整形する)の手順 3**

- フォルダーは、その下の `*.md` を扱う（`.git`・`node_modules`・`.` で始まるフォルダーは除く）

</details>

---

## Windows 11 で使う

- この PC のデスクトップで、自分のユーザーが行う。前提の setup-notes の項は、各項のリードのリンクから開く

### Windows 11 の mdfmt で Markdown を整形する

- 文書を整形し、整形の要るファイルを確かめる
- 前提: [Windows 11 で md-format を導入・更新する](install.md#windows-11-で-md-format-を導入更新する)を通し、`mdfmt` が PATH にある
- 実行場所: この PC のデスクトップの管理者ではない PowerShell 7。この項の手順 1 で開き、整形する文書のあるフォルダーへ移る
- 方言の既定は GLFM。GitHub 向けの文書のリポジトリでは、この項の手順 2 で GFM にする
- PowerShell では、パイプやリダイレクトで文書を渡さない（文字コードや改行が変わる）。ファイルとフォルダーを渡す
- `docs` と `README.md` は、整形するフォルダーとファイルに置き換える

1. 管理者ではない PowerShell 7 を開き、整形する文書のあるフォルダーへ移る。

   - スタートメニューで「PowerShell」を探し、クリックして開く（「Windows PowerShell」ではない。「管理者として実行」にはしない）
   - 「PowerShell」が無ければ、[アプリを入れる](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md#アプリを入れる)の手順 6〜9 を通す
   - `Set-Location` で、文書のリポジトリの直下へ移る

1. GitHub 向けの文書のリポジトリなら、そのリポジトリの直下で方言を GFM にする。

   ```powershell
   [IO.File]::WriteAllText("$PWD\.md-format.json", "{ `"flavor`": `"gfm`" }`n")
   ```

   - GitLab 向け（GLFM）の文書なら、この手順は行わない
   - 長い行を折りたいときは `{ "flavor": "gfm", "fixes": { "line_length": true } }` と書く（幅は markdownlint の MD013 の設定）

1. 整形の要るファイルを確かめる。

   ```powershell
   mdfmt --check docs README.md
   ```

   - 整形の要るファイルの名前が出る。何も出なければ、整形は要らない
   - `mdfmt:` で始まる行は誤り。そのファイルは変えていない

1. 整形して書き換える。

   ```powershell
   mdfmt --write docs README.md
   ```

   - 書き換えたファイルの名前が出る

<details id="windows-11-の-mdfmt-で-markdown-を整形する-の補足と注意点">
  <summary>Windows 11 の mdfmt で Markdown を整形する の補足と注意点</summary>

**[Windows 11 の mdfmt で Markdown を整形する](#windows-11-の-mdfmt-で-markdown-を整形する)の手順 4**

- フォルダーは、その下の `*.md` を扱う（`.git`・`node_modules`・`.` で始まるフォルダーは除く）

</details>

---

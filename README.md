# tfview

Terraform の plan 差分を、GitHub の PR の「Viewed」のように確認済みにして畳んでいけるレビュー用ツールです。
plan から静的な HTML を1枚生成し、ブラウザで開きます。

- 確認済みの状態はブラウザに保存されます。再 plan しても、内容が同じ差分は確認済みのまま引き継がれ、変わった行だけが開いた状態で出てきます。
- module / resource / line のどの階層でも確認済みにできます。上位を確認済みにすると、配下がまとめて畳まれます。
- サーバーや常駐プロセスは使いません。生成したらプロセスは終了します。

## インストール

npm には公開していません。手元でビルドして使います。必要なのは Node.js 24 以上です。

```sh
git clone git@github.com:k-kojima-yumemi/tfview-html.git
cd tfview-html
npm install
npm run build      # dist/tfview.js をビルドする
npm link           # tfview コマンドとして登録する(任意)
```

`npm link` しない場合は、`node <clone したパス>/dist/tfview.js` で直接実行できます。
`dist/tfview.js` は依存のない1ファイルなので、好きな場所にコピーして使っても構いません。

## 使い方

`terraform init` 済みのディレクトリで実行します。

```sh
terraform plan -out=tfplan
tfview tfplan      # npm link していない場合: node <clone したパス>/dist/tfview.js tfplan
```

`./tfview.html` が生成され(毎回上書き)、既定のブラウザで開きます。

`terraform show -json` の出力も渡せます。

```sh
terraform show -json tfplan > plan.json
tfview plan.json
```

### オプション

| オプション | 説明 |
|---|---|
| `<planfile>` | バイナリ plan、または `terraform show -json` の出力。先頭バイトで判別します(`PK` ならバイナリ、`{` なら JSON) |
| `-o, --out <path>` | 出力先。既定は `./tfview.html` |
| `--bin <name>` | 実行する Terraform のコマンド。既定は `terraform`(例: `--bin tofu`) |
| `--no-open` | 生成のみで、ブラウザを開かない |
| `--show-sensitive` | sensitive な値も HTML に埋め込んで表示する(既定は OFF。後述) |

バイナリ plan を渡すと、**コマンドを実行したカレントディレクトリ**で `terraform show -json <planfile>` を実行します。`terraform init` 済みのディレクトリで実行してください。

## 画面

- **チェックボックス**: module / resource / line のすべての階層にあり、階層ごとに一段ずつ右にずれています。内部の確認状態は line 単位で持っていて、module や resource のチェックは配下の line をまとめて切り替えます。
- **進捗**: 上部に「N / M line 確認済み」と出ます。resource と module の単位の進捗も、その横に小さく出します。
- **見出しの固定**: スクロールしても、いま見ている module と resource の見出しが上部に貼り付くので、上に戻らずにチェックできます。
- **チェック**: 親をチェックすると配下の全行が確認済みになって畳まれます。子を全部チェックすると、親も自動で確認済みになります。一部だけ確認済みの親は中間状態になります。
- **折りたたみ**: キャレット(›)か見出しをクリックすると開閉できます。開いても確認済みのままです。
- **前回からの引き継ぎ**: 前回確認済みで内容が同じ行は、確認済みとして畳まれます。見出しに「前回確認済み N 行」と出ます。前回確認したあとで値が変わった行には「更新あり」の印が付きます。
- **表示**: `terraform plan` に近い入れ子の形で表示します。
  - `tags = { ... }`、`ingress { ... }`、`cidr_blocks = [ ... ]` のように、まとまりごとに括ってインデントします。
  - 変わっていない属性は `# (N unchanged attributes hidden)` にまとめます。`id` と `name` は、変わっていなくても文脈として表示します。
  - チェックできるのは変更のある行だけです。括弧やコメントの行は読むためのものです。
  - plan JSON にはプロバイダーのスキーマが含まれないので、ブロックかどうかは値の形で推定しています。オブジェクトのリストをブロックとして、ネストした map の中身を elements として数えます。そのため、件数の数え方が Terraform と少し違うことがあります。
  - `import` ブロックで import されるリソースには、見出しに `import` タグを付けます。本文の先頭には、`terraform plan` と同じく `# (imported from "...")` を出します。差分のない import(actions が `no-op`)も一覧から外さず、`will be imported` として表示します。
  - `(known after apply)`、`forces replacement`、`(sensitive)` は目立つ形で表示します。長い値や複数行の値は省略され、クリックで全体を表示します。行にマウスを乗せると、属性のフルパスが出ます。

## sensitive な値

既定では、sensitive な値は HTML に**一切埋め込まず**、`(sensitive)` とだけ表示します。

- plan JSON の `before_sensitive` / `after_sensitive` で印が付いた値を隠します。
- Terraform が印を付け忘れる場合があります(例: `terraform_data` の `output` は、sensitive な `input` を印なしで繰り返す)。その対策として、plan のどこかで sensitive と印が付いた文字列(4文字以上)を含む値も隠します。
- ハッシュキーの計算には実際の値を使います。sensitive な値が変わると、その行は未確認に戻ります。

`--show-sensitive` を付けると、実際の値を埋め込んで表示します。行には `sensitive` のタグが付き、画面上部に警告が出ます。生成した HTML には秘密情報が平文で含まれるので、共有やコミットには注意してください。キーはどちらでも同じなので、ON / OFF を切り替えても確認済み状態は引き継がれます。

## 確認済み状態の保存

- ブラウザの `localStorage` に、キー名 `tfview:<projectId>` で保存します。`projectId` は、生成時のカレントディレクトリの絶対パスから計算したハッシュです。
- 保存するのはハッシュだけです。属性の値やリソース名は保存しません。
- 再生成した HTML を開くと、現在の plan に存在しないキーを保存データから削除します。
- localStorage を使えない環境では、メモリ上の状態だけで動き、画面に「状態を保存できません」と表示します。

### エクスポート / インポート

画面上部のボタンで、確認済み状態を JSON ファイルに書き出したり、読み込んだりできます。

- localStorage が消えたときの復旧や、ブラウザを変えるときに使います。
- チームで共有するときにも使えます。中身はハッシュだけなので、値は漏れません。
- 読み込みは**追加(マージ)**です。現在の plan に無いキーは無視します。
- ハッシュはアドレスと値から計算するので、別のディレクトリや別の人が生成した同じ plan にも適用できます。

### `file://` での localStorage の挙動

| ブラウザ | 同じパスに上書き再生成 | 別ディレクトリとの混在 | 確認方法 |
|---|---|---|---|
| Chrome | 引き継がれる | 混ざらない | 自動検証済み(ヘッドレス Chrome) |
| Firefox | 未検証 | 未検証 | 手動で確認してください |
| Safari | 未検証 | 未検証 | 手動で確認してください |

- Chrome では、すべての `file://` ページが同じ localStorage を共有していました。別ディレクトリの状態は `projectId` の違うキーに入るので、混ざりません。
- ファイルごとに保存領域を分けるブラウザでも、出力先が固定パス(`./tfview.html`)なら同じ領域になる前提です。この前提が成り立たないブラウザでは、エクスポート / インポートで運用してください。

手動確認の手順:

1. `tfview tfplan` で生成し、いくつかチェックする。
2. 同じディレクトリでもう一度 `tfview tfplan` を実行し、チェックが残っているか確認する。
3. 別のディレクトリで生成した HTML を開き、チェックが混ざっていないか確認する。

## 仕組み

1. plan JSON の `resource_changes` から、no-op と read を除外します。
2. `change.before` / `change.after` を再帰的に比較し、変わったリーフを1行にします。
3. 各行のハッシュキーを計算します。
   - `lineKey = sha256(address \0 attrPath \0 canonical(before) \0 canonical(after))`
   - `canonical()` は、オブジェクトのキーをソートした安定な JSON 文字列化です。
   - 行を持たないリソースは、`resourceKey = sha256(address \0 actions)` で確認状態を持ちます。
4. module → resource → line のツリーとキーを HTML に埋め込みます。CSS と JS はインラインで、外部リソースには依存しません。

### 既知の限界

- plan のたびに変わる値(タイムスタンプ、ランダム ID など)は、毎回未確認に戻ります。
- リストの順序や index が変わると、パスが変わって未確認に戻ります。
- `moved` やリファクタでアドレスが変わったリソースは、新規扱いになります。
- ネストした module は、`module.a.module.b` を1階層として表示します。

## 開発

Node.js のバージョンは [Volta](https://volta.sh/) で `24.22.1` に固定しています。

```sh
npm install        # devDependencies を入れる
npm run build      # Rolldown で dist/tfview.js を1本だけ出力
npm run format     # Biome でフォーマットと自動修正
npm run ci         # Biome のチェックと tsc の型チェック(CI と同じ)
npm test           # Vitest
node dist/tfview.js test/fixtures/plan.json --no-open
```

- `dist/tfview.js` は、CLI、UI(TSX + `hono/jsx/dom`)、CSS をすべて含んだ1ファイルです。実行時の依存はないので、このファイルだけを渡せば `node tfview.js tfplan` で動きます。
- UI は `src/client/app.tsx` を Rolldown で IIFE にまとめたものです。生成する HTML にインラインで埋め込みます。
- `build/plugins.ts` のプラグイン(`?text` 付きの import でファイルを文字列として読む、UI をまとめて文字列にする)は、Rolldown のビルドと Vitest の両方で使います。

```
bin/tfview.ts        CLI エントリ(引数解析、生成、ブラウザを開く)
src/show.ts          入力判別、terraform show -json の実行
src/tree.ts          plan JSON -> module/resource/line のツリー、行の展開と表示用の入れ子、sensitive のマスク
src/hash.ts          canonical JSON、キー計算
src/render.ts        HTML を生成する
src/document.tsx     HTML 文書(サーバー側の hono/jsx)。値のエスケープは JSX に任せ、<script> に入れる JSON だけ jsonForScript で直列化する
src/generate.ts      上記をつなぐ
src/styles.css       CSS
src/client/app.tsx   UI(hono/jsx/dom)
src/client/state.ts  確認状態の操作(チェック、折りたたみ、引き継ぎ、インポート)。DOM に依存しない純粋な関数
src/client/storage.ts localStorage の読み書き
build/plugins.ts     Rolldown / Vitest 共用のプラグイン
test/                Vitest の単体テスト
test/fixtures/       検証用の plan.json
```

`test/fixtures/plan.json` は、組み込みの `terraform_data` リソースだけを使った Terraform プロジェクトから生成したものです。create / update / delete / replace / sensitive / unknown / for_each / ネストした module を含みます。sensitive 変数の値(`hunter2-...`)はテスト用のダミーです。

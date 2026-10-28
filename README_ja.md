# tfview

[English](README.md) | 日本語

Terraform の plan 差分を、GitHub の PR の「Viewed」のように確認済みにして畳んでいけるレビュー用ツールです。
plan から静的な HTML を1枚生成し、ブラウザで開きます。

- 確認済みの状態はブラウザに保存されます。再 plan しても、内容が同じ差分は確認済みのまま引き継がれ、変わった行だけが開いた状態で出てきます。
- module / resource / line のどの階層でも確認済みにできます。上位を確認済みにすると、配下がまとめて畳まれます。
- サーバーや常駐プロセスは使いません。生成したらプロセスは終了します。
- 生成した HTML は、ブラウザの言語から英語 / 日本語を自動で選びます。URL に `?lang=en` / `?lang=ja` を付けるか、上部のセレクタで切り替えられます。CLI は英語のみです。

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

`-` を渡すと、標準入力から JSON を読みます。

```sh
terraform show -json tfplan | tfview -
```

`-o -` を付けると HTML を標準出力に書き出すので、S3 へのアップロードなど別のコマンドにそのまま渡せます。

```sh
terraform show -json tfplan | tfview - -o - | aws s3 cp - s3://my-bucket/plan.html --content-type text/html
```

### オプション

| オプション | 説明 |
|---|---|
| `<planfile>` | バイナリ plan、または `terraform show -json` の出力。先頭バイトで判別します(`PK` ならバイナリ、`{` なら JSON)。`-` なら標準入力から JSON を読みます(バイナリ plan は不可) |
| `-o, --out <path>` | 出力先。既定は `./tfview.html`。`-` なら HTML を標準出力に書き出します(パスの表示とブラウザを開く動作はしません) |
| `--bin <name>` | 実行する Terraform のコマンド。既定は `terraform`(例: `--bin tofu`) |
| `--project-id <name>` | 確認状態を保存する名前。カレントディレクトリの代わりに使います(「[確認済み状態の保存](#確認済み状態の保存)」を参照) |
| `--no-open` | 生成のみで、ブラウザを開かない |
| `--show-sensitive` | sensitive な値も HTML に埋め込んで表示する(既定は OFF。後述) |

バイナリ plan を渡すと、コマンドを実行したカレントディレクトリで `terraform show -json <planfile>` を実行します。`terraform init` 済みのディレクトリで実行してください。

## 画面

- チェックボックス: module / resource / line のすべての階層にあり、階層ごとに一段ずつ右にずれています。内部の確認状態は line 単位で持っていて、module や resource のチェックは配下の line をまとめて切り替えます。
- 進捗: 上部に「N / M line 確認済み」と出ます。resource と module の単位の進捗も、その横に小さく出します。
- 見出しの固定: スクロールしても、いま見ている module と resource の見出しが上部に貼り付くので、上に戻らずにチェックできます。
- チェック: 親をチェックすると配下の全行が確認済みになって畳まれます。子を全部チェックすると、親も自動で確認済みになります。一部だけ確認済みの親は中間状態になります。
- 折りたたみ: キャレット(›)か見出しをクリックすると開閉できます。開いても確認済みのままです。
- アドレスのコピー: resource 名の右のボタンで、アドレス(`terraform apply -target=...` に渡せる形)をコピーできます。押しても見出しは開閉しません。
- 前回からの引き継ぎ: 前回確認済みで内容が同じ行は、確認済みとして畳まれます。見出しに「前回確認済み N 行」と出ます。前回確認したあとで値が変わった行には「更新あり」の印が付きます。
- 順序を無視して比較: オブジェクトのリスト(CodeBuild の `environment_variable` など)は、既定では位置どうしで比べます。順番が入れ替わっただけの要素まで差分に出るときは、リストの上にある選択肢から `name` のようなフィールドを選ぶと、そのフィールドの値が同じ要素どうしで比較します(要素はその値の順に並び、各ブロックの先頭に比較に使ったフィールドを表示します)。選べるのは、全要素で値が重複せず、sensitive や unknown でない文字列のフィールドで、要素が入れ替わっているリストだけです。切り替えはリストごとで、保存されず、開き直すと位置の比較に戻ります。位置の比較とフィールドでの比較では行のキーが別なので、確認済みの状態は引き継がれません。
- 順序を無視して比較(値のリスト): `cidr_blocks` のような文字列や数値のリストで、並び順が変わっているときは、リストの上の選択肢で「順序を無視して比較」を選べます。追加された値は `+`、削除された値は `-` の行になり、両側にある値は `# (N unchanged elements hidden)` にまとめます。並び順が変わっただけなら、変更の行はなくなります。選べるのは、値が重複せず、sensitive や unknown を含まないリストだけです。
- 表示: `terraform plan` に近い入れ子の形で表示します。
  - `tags = { ... }`、`ingress { ... }`、`cidr_blocks = [ ... ]` のように、まとまりごとに括ってインデントします。
  - 変わっていない属性は `# (N unchanged attributes hidden)` にまとめます。`id` と `name` は、変わっていなくても文脈として表示します。
  - チェックできるのは変更のある行だけです。括弧やコメントの行は読むためのものです。
  - plan JSON にはプロバイダーのスキーマが含まれないので、ブロックかどうかは値の形で推定しています。オブジェクトのリストをブロックとして、ネストした map の中身を elements として数えます。そのため、件数の数え方が Terraform と少し違うことがあります。
  - `import` ブロックで import されるリソースには、見出しに `import` タグを付けます。本文の先頭には、`terraform plan` と同じく `# (imported from "...")` を出します。差分のない import(actions が `no-op`)も一覧から外さず、`will be imported` として表示します。
  - `moved` ブロックなどでアドレスが変わったリソースには、見出しに `moved` タグを付け、本文の先頭に `# (moved from ...)` を出します。移動だけで差分のないもの(actions が `no-op`)も一覧から外さず、`has moved` として表示します。アドレスが変わると行のキーも変わるので、移動前に確認済みにした行は引き継がれません。
  - `(known after apply)`、`forces replacement`、`(sensitive)` は目立つ形で表示します。長い値や複数行の値は省略され、クリックで全体を表示します。行にマウスを乗せると、属性のフルパスが出ます。

## sensitive な値

既定では、sensitive な値は HTML に一切埋め込まず、`(sensitive)` とだけ表示します。

- plan JSON の `before_sensitive` / `after_sensitive` で印が付いた値を隠します。
- 隠すのは、Terraform が印を付けた値だけです。印の付いていない値は、`terraform plan` と同じく、そのまま表示します(例: `terraform_data` の `output` は、sensitive な `input` を印なしで繰り返すので、`output` 側の値は表示されます)。
- ハッシュキーの計算には実際の値を使います。sensitive な値が変わると、その行は未確認に戻ります。

`--show-sensitive` を付けると、実際の値を埋め込んで表示します。行には `sensitive` のタグが付き、画面上部に警告が出ます。生成した HTML には秘密情報が平文で含まれるので、共有やコミットには注意してください。キーはどちらでも同じなので、ON / OFF を切り替えても確認済み状態は引き継がれます。

## 確認済み状態の保存

- ブラウザの `localStorage` に、キー名 `tfview:<projectId>` で保存します。`projectId` は、生成時のカレントディレクトリの絶対パスから計算したハッシュです。
- `--project-id <name>` を付けると、`projectId` はその名前から計算したハッシュになります。CI のように実行のたびにディレクトリが変わる場合に使うと、確認状態が引き継がれます。環境ごとに別の名前を付けてください(例: `app-prod`、`app-stg`)。
- localStorage はオリジンごとに分かれます。S3 に置いたページとローカルの `file://` のページでは、`--project-id` が同じでも状態は共有されません。
- 保存するのはハッシュだけです。属性の値やリソース名は保存しません。
- 再生成した HTML を開くと、現在の plan に存在しないキーを保存データから削除します。
- localStorage を使えない環境では、メモリ上の状態だけで動き、画面に「状態を保存できません」と表示します。

### `file://` での localStorage の挙動

| ブラウザ | 同じパスに上書き再生成 | 別ディレクトリとの混在 | 確認方法 |
|---|---|---|---|
| Chrome | 引き継がれる | 混ざらない | 自動検証済み(ヘッドレス Chrome) |
| Firefox | 未検証 | 未検証 | 手動で確認してください |
| Safari | 未検証 | 未検証 | 手動で確認してください |

- Chrome では、すべての `file://` ページが同じ localStorage を共有していました。別ディレクトリの状態は `projectId` の違うキーに入るので、混ざりません。
- ファイルごとに保存領域を分けるブラウザでも、出力先が固定パス(`./tfview.html`)なら同じ領域になる前提です。この前提が成り立たないブラウザでは、実行をまたいで確認済み状態は引き継がれません。

手動確認の手順:

1. `tfview tfplan` で生成し、いくつかチェックする。
2. 同じディレクトリでもう一度 `tfview tfplan` を実行し、チェックが残っているか確認する。
3. 別のディレクトリで生成した HTML を開き、チェックが混ざっていないか確認する。

## 仕組み

1. plan JSON の `resource_changes` から、no-op と read を除外します。import と move は、no-op でも残します。
2. `change.before` / `change.after` を再帰的に比較し、変わったリーフを1行にします。
3. 各行のハッシュキーを計算します。
   - `lineKey = sha256(address \0 attrPath \0 canonical(before) \0 canonical(after))`
   - `canonical()` は、オブジェクトのキーをソートした安定な JSON 文字列化です。
   - 行を持たないリソースは、`resourceKey = sha256(address \0 actions)` で確認状態を持ちます。import や move のときは、import 元や移動前のアドレスも加えます。
4. module → resource → line のツリーとキーを HTML に埋め込みます。CSS と JS はインラインで、外部リソースには依存しません。

### 既知の限界

- plan のたびに変わる値(タイムスタンプ、ランダム ID など)は、毎回未確認に戻ります。
- リストの順序や index が変わると、パスが変わって未確認に戻ります。「順序を無視して比較」で入れ替わった要素を揃えて読めますが、その選択は保存されず、行のキーも位置での比較とは別になります。
- `moved` でアドレスが変わったリソースは `moved` タグ付きで表示しますが、行のキーはアドレスとともに変わるので、移動前に確認した行は未確認に戻ります。
- ネストした module は、`module.a.module.b` を1階層として表示します。

## 開発

```sh
npm install        # devDependencies を入れる
npm run build      # Rolldown で dist/tfview.js を1本だけ出力
npm run format     # Biome でフォーマットと自動修正
npm run ci         # Biome のチェックと tsc の型チェック(CI と同じ)
npm test           # Vitest
node dist/tfview.js test/fixtures/plan.json --no-open
```

# 执行命令与回执查询

优先使用 [local-host.md](local-host.md) 的 `host.py`，统一处理私有配置、运行时、专用 profile 与稳定任务路径。以下命令在技能目录运行；路径均替换为本机实际路径。macOS/Linux 用 `python3`，Windows 用 `py -3`。

## 原创：目标与原创分开

用户说「原创」映射到 `--kind original`（CLI 也接受 `--kind 原创`）。它访问目标视频「举报」→「搬运、抄袭作品」，把对应原创作品 URL 填入独立字段，不使用 qinquan 表单、专利/商标证据、营业执照或组织身份。

```sh
# 只检查原创运行环境，不要求专利/商标材料
python3 scripts/host.py --host deepseek setup --kind original
python3 scripts/host.py --host deepseek check --kind original

# 仅在用户明确要求登录时打开专用扫码窗口
python3 scripts/host.py --host deepseek login --kind original

# 当前用户明确指定的所有目标共用一个原创作品时
python3 scripts/host.py --host deepseek prepare --kind original --links-file '/本次目标.txt' --original-link 'https://www.douyin.com/video/<原创ID>'

# 各目标有不同原创作品时
python3 scripts/host.py --host deepseek prepare --kind original --links-file '/本次目标.txt' --originals-file '/本次原创映射.json'

# 使用 prepare 返回的任务路径；不必再指定类型或原创链接
python3 scripts/host.py --host deepseek run --job '<私有目录>/jobs/<job>.json'
```

`--originals-file` 是 JSON 对象，键为规范化目标视频 URL，值为规范化原创视频 URL：

```json
{
  "https://www.douyin.com/video/<目标ID1>": "https://www.douyin.com/video/<原创ID1>",
  "https://www.douyin.com/video/<目标ID2>": "https://www.douyin.com/video/<原创ID2>"
}
```

先解析分享短链为完整视频 URL，去掉查询参数后建立映射。占位符不是可执行目标。每个目标必须有用户本次明确提供或当前已知且经用户确认的对应原创；缺失、冲突或角色不明先问。`--original-link` 只用于用户明确限定的当前目标集合，不能将旧演示原创套给新目标。不要同时提供两种原创来源。

`prepare` 永不提交；`run` 可直接带相同输入参数，也可用 `--job`，默认无头填表/核验后关闭。原创使用独立 `original-browser-profile`；登录不复用 qinquan profile。不得使用系统输入/剪贴板，不得因无头失败自动改有头；只有明确的用户登录动作允许扫码窗口。

## 专利 / 商标：运行时与材料

需要 Python 3.10+、Node.js 20+、Chrome 和 `playwright-core`。经授权安装依赖时可将 `playwright-core@1.64.1` 放在私有目录，并在配置中将 `node_path` 指向其 `node_modules`；不要装进插件包。私有 `identity.json` 示例：

```json
{"patent":{"organization":"组织名称","phone":"联系电话","email":""},"trademark":{"organization":"另一组织名称","phone":"联系电话","email":""}}
```

示例文字不是身份。核验真实组织及营业执照，空邮箱保持空白。资料格式见 [materials.md](materials.md)。

```sh
python3 scripts/host.py --host deepseek check
python3 scripts/host.py --host deepseek prepare --kind patent --links-file '/本次链接.txt'
python3 scripts/host.py --host deepseek prepare --kind trademark --links-workbook '/本次链接.xlsx'
python3 scripts/host.py --host deepseek login
python3 scripts/host.py --host deepseek run --job '<私有目录>/jobs/<job>.json'
```

专利/商标分开生成任务，不把两列工作簿自动套用于原创。仅有空模板时不创建任务，不覆盖已有输入。底层 `prepare_job.py`、`runner.mjs` 是专利/商标既有入口；原创优先经 `host.py` 分派，不沿用其 qinquan 参数。

## 提交与重试

明确粘贴本次目标并指定类型可按本批请求准备/执行；「只准备」「检查」或环境安装不授权提交。先运行 `host.py settings`：默认 `confirm_before_submit: true`，汇总范围与依据后等用户确认；false 时按本批授权执行，仍先准备核对。读取失败按 true，不得自行改开关。

```sh
# 仅在本批已授权且已满足确认设置时
python3 scripts/host.py --host deepseek run --job '<同一任务.json>' --submit
```

状态文件防重复，不得删除或更换路径绕过。部分接收不重投整批；`--retry-failed --submit` 仅用于执行器确认失败的同一任务。`submitted_unknown`、uncertain/结果不明不能自动重试；表单清空不是成功证据。

## 查询：两条通道分开

```sh
# 专利/商标 qinquan 平台历史，均只读
python3 scripts/host.py --host deepseek status
python3 scripts/host.py --host deepseek status --receipt '<实际批次编号>' --video-ids '/视频ID.txt'

# 原创只读本地状态，可选 --job 限定任务；不是平台回执查询
python3 scripts/host.py --host deepseek status --kind original
python3 scripts/host.py --host deepseek status --kind original --job '<原创任务.json>'
```

qinquan 历史与回执有分页，共享 `--max-pages` 默认 100、最大 200；`complete: false` 或 `history_partial` 表示扫描不完整。`targets[].original_status` 是专利/商标原举报记录的核对字段，**不是 `original` 原创类型的回执**；只有直接读取到的记录才能作为依据。

「24 小时内已举报过」只证明本次重复提交被拒，需按视频 ID 回查对应原记录才能报告状态。批次完成不等于每个目标成功，平台接收不代表审核通过。原创单独汇报本地状态、直接页面证据及待核验项；qinquan 查询不能确认原创举报，不编造回执号或审核结果。

## 自测与验证边界

```sh
node scripts/runner.mjs --self-test --channel chrome
```

既有自测在本地合成页面运行，不请求抖音，不证明账号已登录或平台已接收。专利/商标真实页面验证范围见 [workflow.md](workflow.md)，不自动适用于原创。平台改版或定位失败应停止，不猜测、不回退系统输入或有头执行。

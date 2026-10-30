# 本机入口与配置

私有配置位于 `~/.dsh/douyin-report/config.json`；自定义 DSH 主目录时位于 `$DSH_HOME/douyin-report/config.json`。不同电脑/宿主的 profile、任务和去重状态独立，不复制日常 Chrome 登录数据库。

## config.json

```json
{
  "host": "deepseek",
  "node": "/absolute/path/to/node",
  "node_path": "/Users/yourname/.dsh/douyin-report/node_modules",
  "identity": "/absolute/path/to/identity.json",
  "materials": "/absolute/path/to/materials",
  "channel": "chrome"
}
```

- `node` 是 Node.js 可执行文件的绝对路径；`node_path` 包含 `playwright-core`，建议私有安装而非放进插件包。
- `channel` 可为 `chrome` 或 `chromium`；`executable_path` 可指定实际 Chrome 绝对路径，优先于 channel。
- `identity`、`materials` 是专利/商标的绝对路径；原创不依赖这些身份或材料。
- 专利/商标使用既有 `browser-profile`；原创使用独立 `original-browser-profile`。正常运行无头，不使用系统鼠标/键盘/剪贴板，也不自动降级有头。

## 命令

在技能目录运行，或将脚本改为绝对路径；Windows 将 `python3` 换成 `py -3`。

```sh
python3 scripts/host.py --host deepseek init
python3 scripts/host.py --host deepseek doctor
python3 scripts/host.py --host deepseek check
python3 scripts/host.py --host deepseek login
python3 scripts/host.py --host deepseek prepare --kind patent --links-file '/本次链接.txt'
python3 scripts/host.py --host deepseek run --job '<私有目录>/jobs/<job>.json'
python3 scripts/host.py --host deepseek status

# 原创不要求专利/商标材料或身份
python3 scripts/host.py --host deepseek setup --kind original
python3 scripts/host.py --host deepseek doctor --kind original
python3 scripts/host.py --host deepseek check --kind original
python3 scripts/host.py --host deepseek login --kind original
python3 scripts/host.py --host deepseek prepare --kind original --links-file '/本次目标.txt' --original-link 'https://www.douyin.com/video/<原创ID>'
python3 scripts/host.py --host deepseek run --job '<原创任务.json>'
python3 scripts/host.py --host deepseek status --kind original --job '<原创任务.json>'
```

`init` 创建私有目录和配置/身份/资料模板并尽量找到运行时，不覆盖已有文件。`setup` 做环境检查与安全初始化；`setup --fix` 只安装 `playwright-core`，系统软件安装另行征求同意。原创用 `--kind original` 检查环境，不要求填写专利身份或材料。`check` 不开浏览器，`prepare` 只生成本地任务，永不提交。

## 执行语义

- 类型为 `patent`、`trademark`、`original`；会话中的「原创」映射 original，CLI 也接受 `--kind 原创`。专利/商标可用用户指定的 `--links-workbook`。
- 原创走目标视频「举报」→「搬运、抄袭作品」，不走 qinquan；独立填写对应原创链接。`--original-link URL` 只为用户明确限定的本批目标共享；多组改用 `--originals-file JSON`（规范化目标 URL→规范化原创 URL）。缺对应原创链接先问，不能套用旧演示关联。格式见 [execution.md](execution.md)。
- `run --job` 从任务读取类型和原创关联；默认只识别、填表、检查后关闭浏览器。明确提供本批链接和类型按请求准备/执行；单纯检查、安装、测试或「只准备」不提交。
- 最终提交前读 `host.py settings`。开关 true（或读取失败）需摘要并等确认；false 仅免去本批明确请求的额外确认，不授权未知目标或原创关联。满足授权及确认设置才加 `--submit`；agent 不得自行改开关。
- 仅在用户明确要求登录时运行对应 `login`，允许专用扫码窗口；无终端时自动等待扫码，不要求 Enter。二维码出现不代表登录成功。不得因执行失败自动打开前台或用系统输入。
- `status` 默认只读查询专利/商标 qinquan 历史；`status --kind original` 只读本地原创状态，可选 `--job`，无平台回执保证。两者不能混作成功证据。
- 相同任务复用状态文件，不能删状态或换路径绕过。仅明确失败的同一任务可按授权 `--retry-failed --submit`；部分接收不重投整批，`submitted_unknown`/uncertain 不重试。

## 安装与换机

安装、更新、setup 和登录均不授权举报，不重放演示。只有用户本次目标可用于小样本。运行资料、原创关联、登录态和任务都不随插件分发；新机器重新扫码，不迁移 profile 或去重状态。专利/商标查平台历史，原创报告可验证的本地/页面状态，未知就明确说明。

本仓库不含 Windows 迁移安装器，不声明 Windows 已实测。DeepSeek Harness 可通过 `/douyin-ip-report` 调用；新开会话确认技能来源，旧的同名本地技能可能遮蔽 bundle。复制或编辑文件本身不证明当前安装或旧会话已更新。

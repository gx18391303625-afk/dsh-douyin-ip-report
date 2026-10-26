# 本机入口与配置

私有配置位于 `~/.dsh/douyin-report/config.json`；自定义 DSH 主目录时位于 `$DSH_HOME/douyin-report/config.json`。配置读取本机运行时、驱动、资料和身份路径；不同电脑的 profile 与任务记录互相独立。

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

- `node` 是 Node.js 可执行文件的绝对路径。
- `node_path` 必须包含 `playwright-core`；建议单独装在 `~/.dsh/douyin-report/node_modules`，不要装进插件包，插件升级不会丢。
- `channel` 可为 `chrome` 或 `chromium`；也可用 `"executable_path": "/absolute/path/to/Chrome"`，优先于 `channel`。
- `identity` 和 `materials` 必须是绝对路径。

## 命令

在技能目录运行，或将脚本改为绝对路径：

```sh
python3 scripts/host.py --host deepseek doctor
python3 scripts/host.py --host deepseek check
python3 scripts/host.py --host deepseek login
python3 scripts/host.py --host deepseek prepare --kind patent --links-file '/本次链接.txt'
python3 scripts/host.py --host deepseek run --job '<私有目录>/jobs/<job>.json'
python3 scripts/host.py --host deepseek status
```

`doctor` 检查配置、Node、Playwright 和 Chrome；`check` 只检查资料，不打开浏览器；`login` 打开专用浏览器扫码；`prepare` 只生成本地任务；`run` 默认识别、填表、检查后关闭浏览器，不点击最终提交；`status` 只读查询历史。

## 执行语义

- 商标将 `patent` 换为 `trademark`；可用 `--links-workbook` 指定本次工作簿。
- 用户明确要求举报这批链接时，在 `run` 后加 `--submit`，不必重复询问同一授权。单纯检查、安装或测试环境不用该标记。
- `login` 需要可交互终端：等用户确认扫码完成后再按 Enter，不要启动后立即发送，也不要把显示二维码当作已登录。
- `status` 只读查询历史；指定 `--receipt` 和必要的 `--video-ids` 可核对批次明细。具体命令见 [execution.md](execution.md)。
- 相同任务复用同一状态文件；不能删除状态或随意换路径绕过保护。明确失败且仍需处理时才用 `--retry-failed --submit`。部分接收不重投整批；结果不明先查平台历史。

## Windows 说明

本仓库不含 Windows 迁移安装器，也不声明 Windows 已实测。Windows 用户需自行准备 Python、Node、Chrome 和可用的 `playwright-core`，命令与 macOS / Linux 相同，只是路径改为 Windows 绝对路径。

DeepSeek Harness 可使用 `/douyin-ip-report` 调用。刷新技能目录或新开对话后确认能发现技能；复制文件本身不证明打开的旧会话已经加载。

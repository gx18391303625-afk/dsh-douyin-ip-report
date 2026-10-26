# dsh-douyin-ip-report

DeepSeek Harness 的抖音专利 / 商标侵权举报技能包：用专用浏览器核对**用户本次明确提供**的链接、证明材料和本机组织身份，记录每个任务的提交状态，并只读查询平台历史回执。

> English: A DeepSeek Harness skill plugin for filing Douyin patent / trademark complaints from user-supplied links and local materials. It never discovers targets, never submits without explicit authorization, and queries platform history read-only.

## 它做什么

- **资料预检**：检查话术工作簿、6 张专利或 1 张商标证明材料、身份参考图、营业执照、链接数量与格式，不判断侵权事实。
- **专用浏览器执行**：独立 Chrome profile，不读取日常 Chrome 的 Cookie；按任务自动切到「假冒专利」或「假冒商标」，识别链接、填话术、上传材料、核验组织身份。
- **默认不提交**：只有显式加 `--submit` 才点击最终「提交」；提交前把范围重新核对一遍。
- **状态与回执**：任务状态文件防止同一任务重复点击；`status` 只读查询历史批次和视频明细，不撤销、不提交。
- **平台过滤如实记录**：重复、不可见、无法识别的链接不会被算成已举报。

## 安全边界

- 只处理用户本次提供的链接；**不自动发现**侵权对象，不认定侵权。
- 安装或更新插件本身不授权举报；用户明确要求提交本批链接时才传 `--submit`。
- 不重放演示链接，不默认读取旧链接工作簿，不对同一链接自动提交专利和商标两种类型。
- `prepared` 只代表表单已填好、提交按钮可用，**不代表平台已受理或审核通过**。
- 本项目不是法律意见；请只对你有权主张的内容使用，并自行确认符合抖音平台规则。

## 环境要求

- macOS / Linux；Windows 需自行准备 Python、Node 和 Chrome（本仓库不含 Windows 迁移安装器）
- Python 3.10+
- Node.js 20+（含 npm）
- Google Chrome
- 能访问 `www.douyin.com`

## 安装

当前先以 GitHub 方式安装（插件市场条目见 `market/`）：

```sh
dsh plugin --profile web add github:gx18391303625-afk/dsh-douyin-ip-report
```

把 `web` 换成你实际使用的 profile（桌面版可能是 `desktop`）。安装后刷新页面或重启 DSH。

安装完成后，技能注册名为 `douyin-ip-report`，在 DSH 对话里用 `/douyin-ip-report` 调用。若市场以后提供 npm 版本，可改用：

```sh
dsh plugin --profile web add dsh-douyin-ip-report
```

> 如果本机已经手动放过同名 `douyin-ip-report` 技能目录，插件注册的同名技能可能被本地目录遮蔽；测试插件前先把旧目录移开，确认技能来源。

## 快速开始（新机器 3 步）

装好插件后，在 DSH 里直接说「初始化抖音举报插件」，或者运行：

```sh
python3 <SKILL_DIR>/scripts/host.py --host deepseek init
```

`init` 会自动：

- 创建 `~/.dsh/douyin-report/`（或 `$DSH_HOME/douyin-report/`）；
- 生成 `config.json`、`identity.json` 模板和 `materials/` 目录；
- 尽量自动找到本机 Node 和已有的 `playwright-core`；
- 复制话术工作簿模板、资料说明和 `materials.json` 示例。

然后按它输出的 `next` 做三件事：填 `identity.json`、按 `materials/README.md` 放材料、运行 `check` 和 `login`。`init` 不会覆盖已有的 config、身份或资料，重复运行只补缺失文件。

## 首次配置（手动 / 排障）

`init` 已经自动完成下面第 1-3 步；只有 `init` 找不到 Node/Playwright，或你要手动改路径时，才需要看这一节。

插件只注册技能，真正的资料、身份和运行时仍放在本机私有目录，**不会进入仓库**。

### 1. 找到安装后的技能目录

```sh
find ~/.dsh/profiles -path '*/dsh-douyin-ip-report/skills/douyin-ip-report/scripts/host.py'
```

下文用 `<SKILL_DIR>` 表示 `.../skills/douyin-ip-report`。

### 2. 安装 Node 依赖

依赖放在私有目录，不要装进插件包；插件升级/重装时不会丢：

```sh
mkdir -p ~/.dsh/douyin-report
cd ~/.dsh/douyin-report
npm init -y
npm install playwright-core@1.64.1
```

### 3. 私有配置 `~/.dsh/douyin-report/config.json`

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

- `node_path` 必须包含 `playwright-core`。
- 也可用 `"executable_path": "/absolute/path/to/Google Chrome"` 代替 `channel`。
- 自定义 DSH 主目录时，配置放在 `$DSH_HOME/douyin-report/config.json`。

### 4. 私有身份 `identity.json`

```json
{
  "patent": {"organization": "专利权利组织名称", "phone": "联系电话", "email": ""},
  "trademark": {"organization": "商标权利组织名称", "phone": "联系电话", "email": ""}
}
```

空邮箱保持空字符串。组织名称必须与营业执照一致。

### 5. 资料目录

```text
materials/
├── 侵权问题话术.xlsx
├── 专利投诉材料1.jpg ... 专利投诉材料6.jpg
├── 商标投诉材料.png
├── 专利侵权的组织身份.png
├── 商标侵权的组织身份.png
├── patent-license.jpg
├── trademark-license.jpg
└── materials.json          # 可选
```

默认文件名如上；如果实际文件不同，把 `examples/materials.example.json` 复制到 `materials/materials.json` 并改成实际文件名。`materials.json` 只放文件名，不放个人信息，也不要提交到 git。

`侵权问题话术.xlsx` 的约定：单元格文本为「专利侵权话术」/「商标侵权话术」，描述放在**正下方单元格**；链接工作簿的表头为「专利侵权链接」/「商标侵权链接」。这些标签也可以在 `materials.json` 里改。

### 6. 自检与登录

```sh
python3 <SKILL_DIR>/scripts/host.py --host deepseek doctor
python3 <SKILL_DIR>/scripts/host.py --host deepseek check
python3 <SKILL_DIR>/scripts/host.py --host deepseek login
```

`login` 会打开专用浏览器。在终端里运行会等你按 Enter；在 DSH / agent 后台运行时没有终端，会自动等待登录表单出现（最多 5 分钟），扫码完成即保存，不需要再按 Enter。

## 换电脑 / 新机器

插件本身只带代码和技能说明。换一台电脑时，**资料、身份、登录态和历史任务都不会跟着走**：

| 内容 | 是否随插件 | 新机器怎么办 |
|---|---|---|
| 插件代码、技能说明 | 是 | 重新安装插件即可 |
| `config.json` | 否 | 重写，路径按新机器 |
| `identity.json` | 否 | 从旧机器复制，或按第 4 步重填 |
| `materials/`（话术、证明材料、执照、`materials.json`） | 否 | 从旧机器复制，或按第 5 步重建 |
| 浏览器登录态 / Cookie | 否 | **不要复制旧 profile**；在新机器重新扫码 |
| 本机任务状态、去重记录 | 否 | 不迁移；提交前先查平台历史 |
| 平台历史回执 | 账号侧 | 用同一个抖音账号登录后可见 |

新机器步骤：

1. 按「安装」装插件；
2. 按「首次配置」第 2 步在 `~/.dsh/douyin-report` 装 `playwright-core`；
3. 把旧的 `identity.json` 和 `materials/`（含 `materials.json`）复制过来，没有就按第 4、5 步重建；
4. 写新的 `config.json`，`node`、`node_path`、`identity`、`materials` 全部换成新机器的绝对路径；
5. 依次运行 `doctor` → `check` → `login`（在终端扫码）；
6. 运行 `status`，确认能看到同一个抖音账号的历史回执。

不要复制旧电脑的 `browser-profile/`、`jobs/`、`*.state.json`：它们含登录态和本机状态，既不安全，也不能跨机器通用。历史在平台账号侧，换机器重新扫码后仍然能查；但本机去重状态不会共享，重复提交前必须先查平台历史。

## 使用

在 DSH 对话里调用 `/douyin-ip-report`，把本次链接文件或工作簿交给它。也可以直接跑命令：

```sh
# 只准备、不提交
python3 scripts/host.py --host deepseek prepare --kind patent --links-workbook '/path/links.xlsx'
python3 scripts/host.py --host deepseek run --job '<私有目录>/jobs/<job>.json'

# 用户明确要求提交本批链接时
python3 scripts/host.py --host deepseek run --job '<...>' --submit

# 只读查询历史
python3 scripts/host.py --host deepseek status
python3 scripts/host.py --host deepseek status --receipt '<批次编号>'
```

也可以用 `--links-file` 指定每行一个链接的文本文件。`run` 默认无头运行，结束后关闭浏览器。

## 历史回执

`status` 只读查询平台历史，不点击提交、不撤销举报。历史与回执有分页；输出 `complete: false` 时不能把“没找到”推断为已通过或不存在。「24 小时内已举报过」只说明本次重复提交被拒，原举报状态要用相同视频 ID 回查。

## 隐私

- 仓库不包含任何真实组织名、电话、证照、话术、链接、Cookie、浏览器 profile 或历史任务。
- `config.json`、`identity.json`、`materials.json`、`browser-profile/`、`jobs/` 已被 `.gitignore` 排除。
- 资料只发送给抖音举报页面；插件没有遥测，也不向第三方上传。

## 验证边界

- 选择器基于 2026-10 的真实页面校准；抖音改版时执行器会停止并报出具体位置，不会猜着提交。
- 平台会过滤重复、不可见和无法识别的链接；过滤说明本身不是失败回执。
- 一个批次“已完成”不代表每个视频都成功，需看明细。
- 批量任务建议使用完整 `/video/<id>` 链接；`v.douyin.com` 短链的识别结果只能按数量校验，无法逐条核对视频 ID。
- 回执明细兼容带「补充原因」列的 5/6 列页面；平台再加列时解析会停止并报错，不会猜列。
- 自测只在本地合成页面运行，不证明你的账号已登录或平台已受理。

## 开发

```sh
cd <SKILL_DIR>/scripts
node runner.mjs --self-test --channel chrome
```

### 上架插件市场

仓库满足以下条件后：

1. `package.json` 声明 `dsh.bundle`（已包含）；
2. 仓库创建满 1 天；
3. 给仓库加 `dsh-plugin` topic；
4. 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 PR，新增 `data/plugins/<owner>__<repo>.yml`，内容参考本仓库 `market/dsh-douyin-ip-report.yml`（`category: skill`）。

## License

MIT。使用本项目即表示你自行承担账号、平台规则和法律风险；作者不提供侵权认定或法律意见。

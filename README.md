# dsh-douyin-ip-report

DeepSeek Harness 的抖音专利 / 商标 / **原创**举报插件：核对**用户本次明确提供**的目标，专利/商标使用本机证明材料和组织身份，原创使用明确对应的原创作品链接；通过专用浏览器运行并记录本地任务状态。

> English: A DeepSeek Harness skill plugin for Douyin patent, trademark and original-work complaints from explicitly supplied targets. Original-work reports require an explicit, user-confirmed source URL association; qinquan history covers patent/trademark only, not original-work receipts.

## 它做什么

- **分类预检**：专利/商标检查话术、证明材料、身份和营业执照；原创只需本次目标及对应原创 URL，不索要无关证照，不判断侵权事实。
- **专用浏览器执行**：专利/商标保留 qinquan「假冒专利」/「假冒商标」流程；原创走目标视频「举报」→「搬运、抄袭作品」，另填原创 URL，使用独立 `original-browser-profile`。不读取日常 Chrome Cookie。
- **默认不提交**：`prepare` 永不提交，`run` 默认只填表检查；只有按本批授权及确认设置加 `--submit` 才点击最终提交。
- **状态分流**：状态文件防止重复点击；`status` 查询专利/商标 qinquan 历史，`status --kind original` 仅查原创本地状态，不是假定的平台回执。
- **平台过滤如实记录**：重复、不可见、无法识别的链接不会被算成已举报。
- **左侧栏面板**：v0.3.0 起在 DSH Web 左侧栏增加「抖音举报」入口，显示本机任务数、最近任务和快捷打开举报页。
- **智能体预设**：v0.4.0 起在 Agent preset 选择器里提供「抖音侵权举报」，选中后直接粘贴分享口令/链接即可开始。
- **首次安装检查**：v0.5.0 起预设支持「开始检查」，自动检查 Python/Node/Chrome/Playwright/身份/材料/登录，缺什么列什么。

## 第一次安装：说「开始检查」（v0.5.0）

在「抖音侵权举报」预设的新会话里，第一句发 **“开始检查”**。它会运行 `host.py setup`，逐项检查：

| 检查 | 缺了怎么办 |
|---|---|
| Python 3.10+ / Node.js 20+ / Chrome | 先问你是否安装；Windows 用 winget，macOS 用 brew |
| `playwright-core` | 自动 `setup --fix` 安装，或提示 npm 命令 |
| config / identity / materials | 自动建骨架；仅专利/商标缺身份或材料时索取；原创用 `setup --kind original`，不要求这些材料 |
| 登录 | 用户明确要求登录后打开专用 Chrome 扫码；原创用 `login --kind original` |
| 环境 | 仅用你本次指定的 1–2 条链接做小样本，不提交、无演示重放 |

- 已有材料文件夹：告诉它路径，它会用 `setup --set-materials <目录>` 指过去；
- 直接发文件：它会把文件复制到材料目录并按默认名命名；
- 它**不会**在检查阶段提交，也不会替你编造材料/身份；
- Windows 上 Python 命令用 `py -3`，不是 `python3`。

## 智能体预设（v0.4.0）

安装或更新后，在新会话的 Agent preset 选择器里选「抖音侵权举报」（如果当前版本用 @/智能体菜单，也在那里）。选中后：

1. 直接把抖音分享口令、乱码文案或链接粘进对话；
2. 它会解析、去重；类型未说明才询问。写「原创」即映射内部 `original`，不再问专利还是商标；
3. 专利/商标核验材料和组织；原创核对**目标→原创链接**，缺对应原创先问，不拿旧演示原创套新目标；
4. 明确粘贴目标和类型即请求按本批 prepare/run；「只准备」不提交。最终提交遵循侧栏确认开关：默认先摘要等确认，关闭时可按本批请求直接执行，但不授权未知目标或未知原创关联。

选择器里没有它时，**重启 DSH**：preset 在 bundle 组合层注册，单纯刷新页面不一定够。宿主版本缺少 preset 子插件时，仍可用 `/douyin-ip-report` 技能。

## 左侧栏面板

安装或更新到 v0.3.0 后，刷新页面/重启 DSH，左侧栏会出现「抖音举报」：

- 点开显示本机任务数（已准备 / 已提交 / 待核验 / 准备失败 / 提交失败）和最近 8 个任务；准备失败是识别或填表阶段停止、尚未提交，提交失败是平台明确返回失败，两者不混在一起；
- 数据来自本机 DSH 与 Codex 两套 `douyin-report/jobs/*.state.json`（存在哪个读哪个），通过插件自己的 `/dsh-douyin-report/summary` 读取，只返回宿主、类型、状态、条数和更新时间；不读链接、话术、证明材料或身份；
- 「刷新」重新读取本地状态，「打开抖音举报页」打开抖音举报页；
- 顶部「提交前确认」开关：默认开启；关闭后最终提交前不再询问，但仍会先准备并核对数量，提交后报告结果。开关只写本机 `~/.dsh/douyin-report/ui-settings.json`，agent 通过 `host.py settings` 读取，不能自己改；
- 专利/商标的受理与审核以 `status` 的 qinquan 历史为准；原创的 `status --kind original` 仅展示本地状态，不能用 qinquan 查询确认原创受理，也不生成虚构回执。

宿主不支持 `sidebar.panellist` 时不会出现这一行，但技能部分仍然可用。

## 安全边界

- 只处理用户本次提供的链接；**不自动发现**侵权对象，不认定侵权。
- 安装或更新、setup 和登录本身不授权举报；本次目标+类型按请求及确认设置执行，只有已满足授权与确认条件才传 `--submit`。
- 不重放演示，不默认读旧工作簿，不自动按多种类型举报。共享原创只用于用户明确限定的本批目标；多组逐一映射，缺失先问。
- `prepared` 不代表平台受理或审核通过；`submitted_unknown`、uncertain 或结果不明不得自动重试，不删除状态绕过去重。
- 正常执行无头，不使用 OS 鼠标、键盘、剪贴板，不自动回退有头；仅用户明确发起登录时允许打开扫码窗口。
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

专利/商标按输出 `next` 填身份、放材料、运行 `check`，经用户要求再 `login`；原创改用 `setup/check --kind original`，无需专利/商标身份和材料，登录用 `login --kind original`。`init` 不覆盖已有配置，重复运行只补缺。

## 首次配置（手动 / 排障）

`init` 已经自动完成下面第 1-3 步；只有 `init` 找不到 Node/Playwright，或你要手动改路径时，才需要看这一节。

资料、身份和运行时放在本机私有目录，**不会进入仓库**。以下身份/材料步骤适用于专利与商标，原创跳过这些要求，使用独立 profile 与对应原创 URL。

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

只有你明确要求登录时才运行 `login` 打开扫码窗口；原创用 `login --kind original`，保存到独立 `original-browser-profile`。无终端时自动等待扫码完成，不需要 Enter；二维码出现不等于已登录。正常 run 无头，不自动回退有头。

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

不要复制旧电脑的 `browser-profile/`、`original-browser-profile/`、`jobs/`、`*.state.json`：它们含登录态和本机状态，不能跨机器通用。专利/商标历史在平台账号侧，可重新扫码查询；原创目前只提供本地状态查询，不能拿 qinquan 历史代替。本机去重不共享，结果不明不得重复提交。

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

### 原创：粘贴目标 +「原创」

在会话中提供本次目标分享链接并写「原创」，另提供对应原创作品链接。目标与原创是不同字段；不能只有目标就默认套用旧原创。一个原创可共享给**明确限定的本批目标**；多个对应关系用映射文件。

```sh
# 只准备，绝不提交；原创不要求专利图片/身份/材料
python3 scripts/host.py --host deepseek prepare --kind original --links-file '/本次目标.txt' --original-link 'https://www.douyin.com/video/<原创ID>'
# 或改用 --originals-file '/本次原创映射.json'
python3 scripts/host.py --host deepseek run --job '<原创任务.json>'
python3 scripts/host.py --host deepseek status --kind original --job '<原创任务.json>'
```

CLI 也接受 `--kind 原创`。JSON 映射格式为 `{ "https://www.douyin.com/video/<目标ID>": "https://www.douyin.com/video/<原创ID>" }`，键和值均为解析短链后的规范化视频 URL；占位符不能直接执行。`run` 也可直接带 `--kind original` 及本次输入参数，或通过 `--job` 保留已准备的类型与关联。

原创在目标视频「举报」→「搬运、抄袭作品」填独立原创 URL，不走专利/商标 qinquan。登录使用 `login --kind original`，正常无头运行；缺原创链接、对应关系不明或页面变化就停。确认开关不授权未知关联，`submitted_unknown`/结果不明不重试。命令细节见 [执行参考](skills/douyin-ip-report/references/execution.md)。

## 历史回执

默认 `status` 只读查询专利/商标 qinquan 历史，不提交、不撤销；分页 `complete: false` 时不能把未找到推断为已通过或不存在。「24 小时内已举报过」只证明本次被拒，须用相同视频 ID 回查原记录。`status --kind original [--job <任务>]` 仅查原创本地任务状态；qinquan 历史及其 `original_status`（原举报记录状态）不是原创类型的受理证据，不能据此编造原创批次号或审核结果。

## 隐私

- 仓库不包含任何真实组织名、电话、证照、话术、链接、Cookie、浏览器 profile 或历史任务。
- `config.json`、`identity.json`、`materials.json`、`browser-profile/`、`jobs/` 已被 `.gitignore` 排除。
- 资料只发送给抖音举报页面；插件没有遥测，也不向第三方上传。

## 验证边界

- 专利/商标既有选择器基于 2026-10 的真实页面校准，不代表原创已完成真实提交验证；页面变化时停止并指出位置，不猜着提交。
- 平台会过滤重复、不可见和无法识别的链接；过滤说明本身不是失败回执。
- 一个批次“已完成”不代表每个视频都成功，需看明细。
- 专利/商标批量任务建议使用完整 `/video/<id>` 链接；该流程对 `v.douyin.com` 短链的识别结果只能按数量校验，无法逐条核对视频 ID。原创执行器则在浏览器解析目标/原创视频 ID 后去重并检查关联。
- 回执明细兼容带「补充原因」列的 5/6 列页面；平台再加列时解析会停止并报错，不会猜列。
- **v0.7.0 原创真实站点限制**：原创执行器仅经过离线单元测试、mock 与拦截请求的合成浏览器页面验证；尚未验证真实抖音页面上的完整原创准备/提交链路，不保证当前页面选择器可用，也不宣称真实举报已受理。既有专利/商标真实页面验证不能外推到原创。
- 离线测试不证明账号已登录、平台已受理或审核通过；页面不匹配时必须停止，不得用系统输入或自动有头回退绕过。

## 开发与 v0.7.0 离线测试

从仓库根目录运行，使用已安装的 Node.js 20+ 与 Python 3.10+；测试不会安装依赖或提交真实举报：

```sh
# 保留上游 client/host smoke，再运行原创执行器与摘要测试
npm test
# 等价的 Node 命令（也可将 node 换成运行时绝对路径）
node test/smoke-client.mjs && node test/smoke-host.mjs
node --test test/original-runner.test.mjs test/summary.test.mjs
# Python 原创关联、CLI 路由与本地状态测试，不生成 pycache
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p 'test_original_host.py' -v
# 可选：需要已安装 Chrome 与 playwright-core；全请求拦截的合成页面，无提交点击
# 如模块安装在私有位置，先设置 NODE_PATH 指向已有 node_modules
npm run test:browser
```

`npm test` 包含原有 smoke 文件，不替换或弱化断言；Node 原创测试使用合成链接及 mock，不访问抖音。浏览器 fixture 使用独立临时上下文、拦截所有页面请求，不使用真实登录 profile。既有专利/商标合成页面自测仍可在技能目录运行：

```sh
node scripts/runner.mjs --self-test --channel chrome
```

v0.7.0 功能与限制见 [CHANGELOG](CHANGELOG.md)。

### 上架插件市场

仓库满足以下条件后：

1. `package.json` 声明 `dsh.bundle`（已包含）；
2. 仓库创建满 1 天；
3. 给仓库加 `dsh-plugin` topic；
4. 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 PR，新增 `data/plugins/<owner>__<repo>.yml`，内容参考本仓库 `market/dsh-douyin-ip-report.yml`（`category: skill`）。

## License

MIT。使用本项目即表示你自行承担账号、平台规则和法律风险；作者不提供侵权认定或法律意见。

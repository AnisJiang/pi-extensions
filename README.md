# Pi 扩展插件备份

这是我在 [Pi Coding Agent](https://pi.dev) 上装的 **10 个插件**的源码备份 + 版本清单 + 一键恢复脚本。

换电脑、重装系统、或者哪天 npm 上的包被下架/更新坏了，直接 `git clone` 这个仓库、跑一句 `./install.sh`，环境就回来了。

- 插件版本：与 `~/.pi/agent/npm/package.json` 锁定的一致（见 [packages.json](./packages.json)）
- 备份内容：各插件包的原样文件（**已剔除 `node_modules`**，体积从 65 MB 降到约 4 MB）

---

## 目录结构

```
pi-extensions/
├── README.md           
├── packages.json        
├── settings.snippet.json
├── install.sh           
├── scripts/
│   └── export.sh       
└── packages/            
    ├── @lokiyou/pi-web-search/
    ├── @ff-labs/pi-fff/
    ├── @juicesharp/rpiv-ask-user-question/
    ├── @fradser/pi-monitor/
    ├── @fradser/pi-memory/
    ├── @narumitw/pi-goal/
    ├── @narumitw/pi-btw/
    ├── pi-context-kit/
    ├── pi-simplify/
    └── pi-cc-extensions/
```

---

## 快速恢复

```bash
git clone https://github.com/AnisJiang/pi-extensions.git
cd pi-extensions

./install.sh --dry-run   # 先看看要装什么，不改动环境
./install.sh             # 用仓库里的源码安装（离线可用）
# 或者
./install.sh --npm       # 按锁定版本从 npm 重新下载安装（需要联网）
```

装完回到 Pi 里执行 `/reload` 生效。

只想要其中某一个：

```bash
pi install ./packages/@ff-labs/pi-fff
```

---

## 插件一览

| # | 插件 | 版本 | 干什么的 | 常用入口 |
|---|------|------|----------|----------|
| 1 | `@lokiyou/pi-web-search` | 0.2.3 | 联网搜索 + 读网页 | 直接提问 |
| 2 | `@ff-labs/pi-fff` | 0.11.0 | 用 Rust 加速的文件搜索/内容搜索 | `fffind` / `ffgrep` / `@` |
| 3 | `@juicesharp/rpiv-ask-user-question` | 2.13.9 | 让模型弹选择题问你，而不是瞎猜 | `ask_user_question` |
| 4 | `@fradser/pi-monitor` | 2.3.1 | 后台跑长命令，只在出结果时叫你 | `monitor_start` |
| 5 | `@fradser/pi-memory` | 0.2.8 | 跨会话的项目记忆，可自动整理 | `/memory`、`/consolidate` |
| 6 | `@narumitw/pi-goal` | 0.54.13 | 给一个目标，它自己一轮轮干到底 | `/goal` |
| 7 | `@narumitw/pi-btw` | 0.62.0 | 开个"顺便问一下"的侧线程，不弄脏主对话 | `/btw` |
| 8 | `pi-context-kit` | 0.2.1 | 自动瘦身上下文，剪掉的东西还能捞回来 | 自动 + `recall` |
| 9 | `pi-simplify` | 0.2.3 | 只审查你刚改的代码，顺手简化 | `/simplify` |
| 10 | `pi-cc-extensions` | 1.0.8 | Claude Code 风格的界面、状态栏、上下文查看 | `/ccstyle`、`/context` |

---

## 逐个说明

### 1. `@lokiyou/pi-web-search` — 让它能上网

**作用**：给 Pi 加联网能力。你问的东⻄超出它的训练数据，它会自己去搜、去翻网页，然后带着来源回答。

**工具**：`web_search`（搜索）、`web_fetch`（读某个链接的正文）、`search_planning`（复杂问题拆成多次搜索）、`get_sources`（补查来源列表）。附带一个 `pi-web-search` skill。

**大白话例子**：

> 你：「DeepSeek 这个月 API 降价的公告发了吗？把原文链接给我。」
>
> 它不会回你一句"我没有实时信息"，而是真的去搜、打开公告页、把关键几段摘出来，末尾附上链接。你点开一看，确实是上周发的。

**配置**：首次加载会在 `~/.pi/agent/extensions/pi-web-search/config.json` 生成配置，填 `grokApiKey` / `tavilyApiKey` / `context7ApiKey` 等你有的就行，改完 `/reload`。

---

### 2. `@ff-labs/pi-fff` — 找文件和找代码快得离谱

**作用**：用 Rust 写的搜索引擎 FFF 替换 Pi 内置的 `find` 和 `grep`。文件在会话开始就后台建好索引，所以搜索几乎不用等；而且会**记住你常打开哪些文件**（frecency），把它们排前面。

**工具**：`fffind`（找文件，支持模糊匹配、打错字也能中）、`ffgrep`（搜内容）、`fff-multi-grep`（一次搜多个关键词，命中任一即算）。`@` 文件补全也走它。

**大白话例子**：

> 你记得项目里有个文件叫 `invoice-export` 之类的，但不确定是 `.ts` 还是 `.vue`，也想不起在哪个层级。
>
> 以前：`find` 一层层翻，或者猜路径猜半天。
> 现在：`fffind invoice export` → 立刻列出 `src/billing/exports/invoiceExportDialog.vue` 和另外两个候选，按你平时打开的频率排序，第一个就是要找的。

**和内置工具的区别**：不每次起子进程、只搜 Git 关心的文件、改过/暂存的文件会被顶上来。

---

### 3. `@juicesharp/rpiv-ask-user-question` — 让它先问，别先猜

**作用**：模型遇到真需要你拍板的岔路口时，弹出一个终端里的选择题表单，最多一次问 4 题、每题 2-4 个选项，每个选项带一句"选它会怎样"的说明。你的选择以结构化数据交回给模型。

**工具**：`ask_user_question`。

**大白话例子**：

> 你说：「给商品接口加上缓存。」
>
> 它不自己挑一个方案就写，而是弹窗问：
> - 缓存放哪？ `内存（重启就没了，最简单）` / `Redis（要起服务，多实例共享）` / `本地文件（慢一点，零依赖）`
> - 失效策略？ `定时过期` / `写时更新` / `手动清理`
>
> 你按 `↑` `↓` 选、回车确认，15 秒搞定。而不是它写完 Redis 方案，你才发现"我们这台机器根本没 Redis"。
>
> 哪个选项都不合适？最后一行 `Type something.` 直接自己打字。想补一句背景，按 `n` 加备注。选方向前拿不准，选项还能带一段代码/配置预览并排比较。

**快捷键**：`Tab` 切题、`n` 加备注、`Esc` 整份放弃、`Ctrl+]` 把弹窗缩成一行腾地方。
**适用**：只在交互式终端里出现；`pi --print` 这类非交互运行会把工具收起来，不会卡住。

---

### 4. `@fradser/pi-monitor` — 长任务丢后台，出结果再叫你

**作用**：跑构建、装依赖、部署、跑测试这类"输出几千行、要等好几分钟"的命令时，把这堆日志挡在对话之外，只等一个**约定的成功/失败标志**出现，再一次性叫醒你。

**工具**：`monitor_start`，参数就是命令 + 成功标志正则 + 失败标志正则 + 超时时间。

**大白话例子**：

> 你说：「把前端构建一下再部署到测试服，好了告诉我。」
>
> 它启动一个后台监控：`npm run build && ./deploy.sh && echo DEPLOY_OK`，成功标志取 `DEPLOY_OK`，超时 15 分钟。
>
> 接下来十几分钟终端里刷的那些 webpack 进度条、scp 百分比，**一个字都不会塞进对话上下文**（省 token，也不会触发几十次无意义的模型回合）。等 `DEPLOY_OK` 出现，或者超时/报错，它才回来跟你说一句"部署完成，日志末尾是这样"。

**注意**：查个 `df -h` 这种秒回、输出又少的命令，别用监控，直接跑更快。

---

### 5. `@fradser/pi-memory` — 让它记住你的规矩

**作用**：把"这个项目的约定""我的个人偏好"存成 Markdown 记忆，下次新开会话自动带上。还会在本机起一个只读的后台小工，把零散记忆整理成条理清楚的条目。

**入口**：`/memory` 打开管理菜单，`/consolidate` 直接后台整理一次。

菜单里能做的事：

| 菜单项 | 干嘛的 |
|--------|--------|
| Auto-memory | 开关"边干活边自动记笔记"（默认开） |
| 选择记忆模型 | 指定用哪个模型做记忆整理 |
| Consolidate memory now | 现在就把记忆梳理一遍 |
| 编辑用户/项目指令 | 改 `AGENTS.md` 那类全局/项目说明 |
| 打开记忆目录 | 直接定位到记忆文件夹 |

**存储位置**：`~/.pi/agent/memory/<项目路径哈希>/` 是私人记忆；项目里 `.memory/` 是**可提交进 Git** 的公开镜像（只镜像明确标记为安全的内容，密码、私人偏好不会进去）。

**大白话例子**：

> 第一次合作你说：「这个仓库的提交信息一律用中文，别加 emoji。」
>
> 它记下来。三天后你重开一个会话让它改 bug，它写完代码提交时，commit message 自动就是「修复：分页受控对象未回写导致点击无效」，不用你再提醒一遍。
>
> 用了一个月，"记住"的条目攒了二十多条、开始互相打架，你敲一句 `/consolidate`，后台小工把它们归并成七八条干净规则，重复的删掉、过期的标注掉。

---

### 6. `@narumitw/pi-goal` — 一个目标，干到完成为止

**作用**：给 Pi 一个**会话级目标**。它每干完一轮、彻底空闲后，会自己接着往下推进，不需要你反复打字"继续"。完成、卡死、需要等你、或到达次数/预算上限时，它会明确停下来并说明原因。

**入口**：`/goal <目标描述>` 直接开始，`/goal` 打开管理器（查看进度、暂停、恢复、改目标、清空）。
**配套工具**：`goal_complete`（干完了，要附证据）、`goal_blocked`（外部阻塞，要附证据且连续 3 轮才算）、`goal_wait`（在等外部事件）。
**设置**：`~/.pi/agent/pi-goal.json`，可配最大轮次、token 预算等。需要 Pi ≥ 0.80.6。

**大白话例子**：

> 你：「`/goal` 把 `src/legacy/` 下所有 `any` 换成具体类型，不许改运行行为，最后 `npm test` 必须全绿。」
>
> 然后你去泡茶。它自己：改 5 个文件 → 跑类型检查 → 报错 12 处 → 回头修 → 再跑 → 发现某个类型得从后端接口定义推导 → 去翻 `api.ts` → 继续改 → 跑测试 → 有 1 个用例挂了 → 看断言 → 是 mock 数据没跟着改 → 修 → 全绿 → 调用 `goal_complete`，附上"200 个文件已处理、测试 137 通过"的证据。
>
> 中途如果发现"需要你先给一个 staging 数据库密码"，它会 `goal_wait` 或 `goal_blocked` 停下来找你，而不是自己瞎编一个。

---

### 7. `@narumitw/pi-btw` — 顺便问一句，不污染主任务

**作用**：开一个**临时侧线程**。你在主任务里冒出的零碎疑问，在侧线程里问，问答默认**不会进入主对话**；觉得有用时，再手动把答案带回主编辑器。

**入口**：`/btw <问题>` 直接开问，`/btw` 打开管理器（选上下文、续聊、改设置）。

**大白话例子**：

> 你正在让 Pi 改支付回调的重试逻辑，改到一半突然想确认：「这项目里分布式锁是怎么用的？会不会跟我现在改的地方冲突？」
>
> 直接在主对话问，一大段无关的解释会一直躺在上下文里，后面每轮都要为它付 token。用 `/btw`：
> - 侧线程回答完，主对话还是干干净净的支付回调上下文；
> - 你看完觉得"这段结论有用"，点"带回主编辑器"，那几行才进主对话（只填进输入框，不会自动发送）；
> - 还想追问就在侧线程继续追，它支持翻历史、搜索、全屏/左右分栏，还能把 Mermaid 图渲染成字符画。

**前提**：TUI 模式 + 模型凭据可用。`/new`、`/reload`、重启会丢弃侧线程。

---

### 8. `pi-context-kit` — 上下文快满时，自动帮你减负

**作用**：长会话最怕上下文爆掉——Pi 会把前面几百轮压成一段摘要，细节就丢了。这个插件做三件事：

1. 在窗口撑满**之前**，把"模型已经不需要了"的大块内容（过期的文件读取、旧命令输出）换成一行的占位提示；
2. 真要压缩时，提前用同一个模型写好一份**交接笔记**（handoff），比 Pi 自己临时摘要靠谱；
3. 被剪掉的东西**没有删除**，模型可以用 `recall` 工具按关键词翻回去原文。

**大白话例子**：

> 你和它排查一个线上问题，聊了三个小时：读了 40 个文件、跑了 200 条命令，上下文眼看要满。
>
> 老办法：突然触发压缩，摘要里把"第 37 步发现的那个 `timeout=3000` 才是根因"给漏了，你只能说"不对，前面提过"。
>
> 有它之后：那些早就看过、不再需要的文件正文先被换成 `[旧读取已省略]`，上下文压力一下就下来了；真要压缩时，交接笔记里明确写着"根因是 XX 第 37 步的 timeout 配置"；万一还是漏了，一句 `recall timeout=3000` 就能把那段原始输出捞回来。

**配置**（可选）：`~/.pi/agent/settings.json` 里加 `contextKit` 块可调整触发阈值，比如上下文大的模型可以设成 15 万 token 时就开始维护。

---

### 9. `pi-simplify` — 提交前，让代码先"顺一遍"

**作用**：只审查**你最近改动的那几行**（用 `git diff` 定位），在**不改功能**的前提下，优化命名、去掉重复、拆开过长逻辑。会照着 `AGENTS.md` / `CLAUDE.md` 里的项目规范来，改一个文件跑一次测试。

**入口**：

```bash
/simplify                  # 审查所有未提交的改动
/simplify --staged         # 只看已暂存的
/simplify --ref=main       # 跟 main 分支比
/simplify src/foo.ts       # 只看指定文件
```

**大白话例子**：

> 你写完了 `orderService.ts` 里 300 行新逻辑，自己看着有点乱但说不上哪不对。提交前敲 `/simplify`。
>
> 它不重写你的业务逻辑，只做这类动作：
> - 把 `const d = data.filter(x => x.status === 1).map(x => x.id)` 后面又 `filter` 一遍的写法合并成一次遍历；
> - 把 `let result = false; if (...) { result = true } return result` 改成直接返回条件；
> - 把 `handleData1` / `handleData2` 改成说得清的名字 `applyDiscount` / `recalcShipping`；
> - 最后跑 `npm test`，确认 137 个用例还是全绿，然后告诉你改了哪几处、为什么。

**注意**：它刻意只动改动行附近，不会顺手重构整个文件——所以 review 起来很快。

---

### 10. `pi-cc-extensions` — 终端界面变成 Claude Code 那样

**作用**：把 Pi 的 TUI 换成更清爽的 Claude Code 风格，并加了一堆顺手的小功能。

**功能**：

| 功能 | 说明 | 入口 |
|------|------|------|
| 工具卡片 | 每次工具调用折成一张卡，可展开看完整输入/输出；文件改动直接显示 diff | `/ccstyle` 切换 `on` / `compact` / `off` |
| 状态栏 | 一行显示模型、上下文占用、缓存命中、本次花费、输出速率（tok/s + TTFT）、git 分支，接了 `@narumitw/pi-usage` 还能看额度 | 自动 |
| 上下文检查 | 看当前上下文被谁占满了，并预览 System prompt、记忆、Skills、工具定义 | `/context` |
| 引用历史 | 用 `@` 引用以前的会话或子代理的有效上下文 | `@` |
| Markdown 增强 | Mermaid 图、提示框、链接可点 | 自动 |
| 全屏模式 | 工具卡点击展开收起、悬浮高亮、回到底部 | `--tui-mode fullscreen` |
| 主题 | 自带 CC Dark / CC Light | `/theme` |

**大白话例子**：

> 以前它读一个 800 行的文件，终端里哗啦刷 800 行，你想回看前面某句话得往上翻半天。
>
> 装了之后，那一屏变成一张卡：
>
> ```
> ● Read src/order/orderService.ts  (800 lines)
> ```
>
> 想看细节就点开，不想看就让它折着。右下角状态栏一直显示"上下文 42% / 本次 $0.13"——你一眼就知道是不是该开新会话了。哪天觉得"怎么这么慢、上下文怎么涨这么快"，敲 `/context`，它告诉你是 System prompt 占得多，还是某个 skill 的定义太长。

**配置**：`~/.pi/agent/pi-cc-extensions.json`（模式、状态栏字段、diff 布局、卡片行数上限等）。

---

## 更新这份备份

插件升级后，把仓库刷新一遍再提交：

```bash
pi update                     # 或 pi install npm:xxx@latest
./scripts/export.sh --prune   # 重新导出源码 + 刷新 packages.json
git add -A && git commit -m "更新：升级 xxx 到 yyy"
git push
```

`export.sh` 读取 `~/.pi/agent/settings.json` 的 `packages` 列表决定导出哪些；`--prune` 会顺手删掉仓库里已经卸载的插件目录。

---

## 说明与注意事项

- **许可证**：这 10 个插件全部是 MIT 协议，各包的 `LICENSE` 文件已随源码保留。这里只是个人环境的备份，版权归各上游作者，请勿当作自己的作品发布。
- **没有 `node_modules`**：`dist/`、`src/`、主题、文档都完整保留，所以离线也能直接 `pi install ./packages/xxx`。个别包（如 `pi-btw`）自带很小的运行时依赖，已在安装时由 Pi/npm 处理。
- **不包含密钥**：`auth.json`、各插件 `config.json` 里的 API Key 一律没有备份。换机器后需要自己重填（`web_search` 相关配置、记忆模型等）。
- **版本已锁定**：`install.sh --npm` 会装回表里记录的版本，避免上游更新把环境搞坏。
- **环境要求**：`pi-goal` 需要 Pi ≥ 0.80.6；`pi-cc-extensions` 需要 Node ≥ 22.19；`pi-btw` 需要 TUI 模式。


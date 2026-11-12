# dsh-deepseek-web

在 DeepSeek Harness（DSH）现有界面中接入 DeepSeek 网页版。插件把网页版作为**原生右侧栏 Browser 标签页**打开，而不是另造网页容器，因此地址栏、前进/后退、重新载入、标签页拖拽与快捷键都保持 DSH 原有风格和操作习惯。入口按钮位于**左侧边栏底部**、设置按钮上方的动作区。

## 工作方式

DSH 桌面版内置 `@deepseek-ai/dsh-client-ui-sidebar-browser`：桌面配置下用 Electron `<webview>` 承载页面，Web 配置下用带 sandbox 的 iframe。插件不重复实现这部分能力，只做五件事：

1. 在左侧边栏底部动作区（`sidebar.footer.action`）提供一个入口按钮，点击展开面板（收窄为 56px 图标栏时只显示圆形图标）；
2. 通过 `ctx.sidebarRight.openTab('browser', { params: { url } })` 打开或新建网页版标签页；
3. 通过 `ctx.sidebarRight.openTabs` 查找已有 Browser 标签页并 `focus` 复用，避免每次点击都新建标签而丢失当前对话；
4. 注册快捷键 `Ctrl/Cmd + Alt + D`，并提供配置、状态校验与错误提示；
5. 首次运行时在面板中给出一次「内嵌环境」提示，说明站点可能报告环境异常并建议官方客户端，可标记为不再提示。

网页版自身的「新对话 / 输入问题 / 查看回复 / 继续会话」全部由网页承载，插件不读取、注入或转发页面内容。

| 核心流程 | 承载方式 |
| --- | --- |
| 打开对话 | 面板内「打开」打开标签页；「新建标签」另开一个；网页版内点「新对话」 |
| 输入问题 | 网页版输入框 |
| 查看回复 | 网页版页面（含流式输出） |
| 继续会话 | 复用已有 Browser 标签页（`keepMounted` 保留页面状态）；或从网页版历史记录进入 |

## 目录结构

```
dsh-deepseek-web/
├── package.json          # 清单：bundle patch、client 入口、导出资源
├── cordis.patch.yml      # 插入一行 Loader 记录（name 相对锚定）
├── index.js              # Host 半部：apply 为空，持有配置 schema
├── client.js             # Client 半部：侧栏入口、快捷键、状态机、错误提示
├── icon.svg              # 图标
├── locale/{zh,en}.json   # 显示元数据
├── docs/DETAIL.md        # 插件详情页内容
└── test/smoke.mjs        # 离线自检
```

## 安装与启用

包写在普通工作区目录，不要手工放进 `$DSH_HOME`，也不要改 profile 的 `package.json` 或 `cordis.patch.yml`。

- **GUI**：「插件」→「Add plugin」→ 选择「安装第三方插件」→ 填入插件目录的**绝对路径**。
- **CLI**：`dsh plugin add <插件目录绝对路径>`；指定配置时加 `--profile <name>`。
- **工具**：`plugin_manager` 的 `install_bundle`，`target` 为插件目录绝对路径。

安装后观察 `application` 与 `warnings` 字段判断是否生效。首次安装可经 HMR 激活；若结果为 `restart-required`，或替换了已安装的包，需要重启 DSH。启用后在「插件」列表中应能看到 **DeepSeek 网页版** 及其图标与描述。

`dsh` 未加入 PATH 时，优先使用 GUI 的「Add plugin」或 DSH 会话内的 `plugin_manager` 工具。

自检（离线，不需要启动 DSH）：

```bash
cd <插件目录> && node test/smoke.mjs
```

## 前置条件

| 项 | 要求 |
| --- | --- |
| DSH 版本 | 0.2.2-rc.2 及以上（依赖 `ctx.sidebarRight.openTabs` 与 `openTab('browser', …)`） |
| 内置 Browser | 桌面配置默认启用；Web 配置默认关闭，需在 profile patch 中写 `- id: ui-sidebar-browser / disabled: false` |
| 右侧栏 | 当前须有前台会话，右侧栏控制器才能放置标签页 |
| 网络 | 能访问 `chat.deepseek.com`；内置 Browser 是真实浏览器导航，不走应用内 web 工具 |
| 权限 | 安装包为 `asInvoker`；插件安装本身通过 DSH 的插件机制完成，无需系统管理员提权 |

## 必要配置项

默认值为 `url = https://chat.deepseek.com`、`reuseExistingTab = true`、`registerShortcut = true`，由 Host 的 `Config` schema 提供。

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `url` | string | `https://chat.deepseek.com` | 打开的 HTTPS 地址；仅接受不含账号密码的 http/https |
| `reuseExistingTab` | boolean | `true` | 已有 Browser 标签页时聚焦复用（保持会话）；`false` 时每次新建 |
| `registerShortcut` | boolean | `true` | 是否注册 `Ctrl/Cmd + Alt + D` |

覆盖方式：在 profile patch 中按 id 覆盖，**Loader 会整体替换 `config`，需写全三个字段**：

```yaml
- id: dsh-deepseek-web
  config:
    url: 'https://chat.deepseek.com'
    reuseExistingTab: true
    registerShortcut: false
```

`dsh.client.inject` 中列出的 `@deepseek-ai/dsh-client-ui-sidebar-browser` 只用于保证激活顺序，不是依赖声明；这些包由 DSH 安装本体提供，插件不引入 `node_modules`。

## 登录状态要求

- 首次打开需在 Browser 标签页内完成 DeepSeek 网页版登录。
- 桌面配置的 Browser 使用进程内会话分区 `dsh-sidebar-browser-<uuid>`，按工作区 CWD 分组：**Cookie 与 Web Storage 不跨 DSH 重启保存**。每次重启应用后需要重新登录，会话历史仍由网页版账号提供。
- 同一进程内，同一工作区的标签页共享该分区，因此新建标签页不会重复要求登录。
- 插件不保存、不读取账号、Cookie 或令牌。

## 首次运行提示

首次在某一浏览器配置中运行时，面板会自动展开，并显示一条「环境提示」：DeepSeek 网页版运行在内嵌浏览器里，站点可能报告环境异常并建议使用官方客户端；插件仅在本机打开该页面，不读取或转发对话内容。点「不再提示」后写入本地存储，之后不再出现。

- 提示只解释与引导，不拦截打开操作，也不改变站点行为。
- 本地存储不可用时（例如受限的存储策略）提示保持隐藏，避免每次启动重复打扰。

## 错误提示

状态显示在侧栏入口展开后的面板内；出错时给出可读文案、重试按钮与检查项。页面自身的加载失败由内置 Browser 的原生失败提示负责，两者互补。

| 状态 | 触发条件 | 提示 |
| --- | --- | --- |
| `no-service` | 右侧栏服务未就绪 | 右侧栏服务未就绪，无法打开标签页 |
| `no-browser` | `openTab('browser')` 因未注册该类型而抛错 | 提示在「插件」中启用 `dsh-client-ui-sidebar-browser`；Web 配置还需 `disabled: false` |
| `no-session` | 无前台会话，右侧栏无法放置标签页 | 进入一个会话后重试 |
| `bad-url` | 配置地址为空、超长、协议非 http/https、含账号密码或无法解析 | 显示具体原因，仅接受合规地址 |
| `open-failed` | 打开时抛出其它异常 | 显示异常摘要，提示检查右侧栏 |
| `not-appeared` | 调用返回成功但 2.5 秒内 `openTabs` 未出现新 Browser 标签页 | 提示右侧栏可能折叠或不可用；`openTabs` 不可用时跳过该判定，避免误报 |
| `page-problem` | 用户主动点「页面异常」 | 展开加载失败/登录失效/嵌入受限的检查项 |
| 页面级失败 | DNS、TLS、CSP、`X-Frame-Options`、白屏、登录失效 | 由内置 Browser 的加载失败提示显示；插件提供「重试」「新建标签」与检查项 |

所有服务调用均包在 `try/catch` 中，Client 半部不抛异常拖垮所在 bundle；快捷键在没有可见组件时也会把错误写入控制台。

## 适用边界

- 适用于桌面配置的 DSH 0.2.2-rc.2 及以上；Web 配置需先启用内置 Browser，且页面受 iframe sandbox 限制更多。
- 面向「在 IDE 内随时切到网页版对话」的场景；不改变 DSH 自身的 Agent 会话、工具、提示词或模型请求，不注册模型可见能力。
- 网页版与 DSH 会话相互独立：网页里的对话不会进入 DSH 的会话日志，也不会消耗 DSH 的模型额度。
- 站点需允许在 `<webview>` / iframe 内加载；只允许 http/https，拒绝 `file:`、脚本/数据地址、内嵌凭据与应用自身 origin。

## 已知限制

1. **登录态不跨应用重启**：桌面 Browser 分区为进程内分区，重启后需重新登录。这是内置 Browser 的既定策略，插件不改写。
2. **部分站点拒绝嵌入**：CSP 或 `X-Frame-Options` 可能导致空白页；浏览器出于安全考虑常不派发可识别的 `error` 事件，加载失败提示是尽力而为。此类情况应使用 Browser 工具栏的「在系统浏览器打开」。
3. **页面内部状态不可观测**：受同源策略与 webview 隔离限制，插件无法判断网页是否已完成登录、是否正在流式输出或是否报错；这些状态由网页版自身呈现。
4. **下载、原生弹窗、权限请求被拒绝**：内置 guest 策略统一禁用，需要这些能力的操作应转到系统浏览器。
5. **地址变化不可完全追踪**：网页内部 History API 与 fragment 跳转不产生新的导航记录；插件只按「是否存在 Browser 标签页」复用，不推断页面 URL。
6. **Web 配置的 sandbox**：默认 sandbox 会限制顶层跳转与下载；取消 sandbox 只对当前标签页临时生效。
7. **快捷键冲突**：`Ctrl/Cmd + Alt + D` 可能被系统或其它应用占用，可设 `registerShortcut: false` 关闭，只用按钮入口。
8. **侧栏底部空间有限**：`sidebar.footer.action` 与内置「插件」入口同处设置按钮上方，条目较多时该区域会被压缩；插件按 42px 行高与 36px 圆形按钮（收窄栏）渲染，不参与折叠逻辑。
9. 未在 Web 配置与 macOS/Linux 上做实机验证；`openTabs`、`focus`、`openTab` 的行为来自 DSH 0.2.2-rc.2 桌面版源码与包文档。

## 版本记录

- **1.1.0**：入口从对话输入框下方迁到左侧边栏底部动作区（`sidebar.footer.action`）；面板改为锚定入口的浮层；新增首次运行的内嵌环境提示（可关闭且不再出现）。
- **1.0.0**：首个版本，入口位于对话输入框下方（`conversation.composer.dock`）。

## 卸载

在「插件」中移除该 bundle，或使用 `plugin_manager` 的 `remove_bundle`。插件不写应用配置之外的数据；卸载后启动入口、快捷键与标签页类型登记一并消失，已打开的 Browser 标签页属于内置功能，不受影响。

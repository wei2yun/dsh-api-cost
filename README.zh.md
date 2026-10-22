# dsh-api-cost

[DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/zh/) 的一个插件包（bundle）：在输入框下方的统计控件旁，显示**本次会话的 API 消耗折合多少钱**，以及钱花在了哪里。

[English](README.md) | 简体中文

---

## 这是什么

这是一个 **Harness 插件包（bundle）**：一个 npm 包里同时提供 **Host 插件**和 **Web 客户端插件**。

- Host 插件注册会话投影 `apiCost`，把每次已结算模型调用的 usage 折叠成按路由、按计费时段的 token 桶，再按价目表计价。
- 客户端插件在输入框下方的环境控件区（`conversation.composer.dock`）注册一个控件，只渲染 Host 已经算好的值。

它**不是 skill**（skill 是给模型读的指令集），**不是 agent preset**（preset 为会话组合插件），也**不是独立应用**。bundle 是 Harness 插件管理器安装、启用、移除的单位。

## 看到什么

输入框下方，在内置统计控件之后：

```
   3 轮 12 步 · 41.2 tok/s     612.3k tokens · 缓存命中 99%     ¥0.83
   └──────────── 内置控件 ──────────────────────────────┘  └ 本插件 ┘
```

点开后：

```
API 花费                                              ¥0.83
────────────────────────────────────────────────────────────
DeepSeek-V4.1-Flash                                   ¥0.83
输入 214k · 缓存命中 32.0M · 输出 127k
缓存命中率 99.3%
高峰 ¥0 · 空闲 ¥0.83
按 DeepSeek 官方价目估算，实际扣费以账单为准。
```

总额覆盖整段对话：本会话**加上它派生的每一个子智能体会话**，面板里单独列出子智能体的份额。子会话的费用由控件自己读取，不需要你先点开它；还没读到、或子会话仍在运行时，总额后面带一个 `+`，表示这是下限或暂估值。每个已完成的回合，还会在回合页脚（「本轮用量」旁边）显示这一轮的花费，例如「本轮 ¥0.0123」。

面板还能切到时间范围（今天 / 近24小时 / 近7天 / 近30天），统计**本机全部已存储会话**。没有计费用量时控件不显示；遇到不认识的 `provider/model` 会显示「未配置价目」，而不是瞎猜一个价格。

## 安装

要求：DeepSeek Harness `0.2.1-rc.2` 或其他 `0.2.x` 版本（包里声明了 `engines.dsh`），并且使用 Web UI。

**在 Web UI 里**：侧边栏 → **Plugins** → **Install**，粘贴本仓库地址：

```
https://github.com/wei2yun/dsh-api-cost
```

**命令行：**

```sh
dsh plugin --profile web add github:wei2yun/dsh-api-cost
```

**在对话里**：调用 `plugin_manager` 工具，`action: install_bundle`，target 填同一个地址（开发时也可以填本地目录）。

Git 安装跟随分支头；需要可复现时钉 commit（`github:wei2yun/dsh-api-cost#<sha>`）。本包是纯 ESM，Git 安装不会触发任何构建脚本。

### 分发方式

本仓库就是 bundle 本身：无构建步骤、无运行时依赖，Host 与浏览器加载的文件都已入库。可以从 Git 依赖、本地目录安装，也可以在发布 npm 后按包名安装。生态里的发现渠道是 GitHub 的 `dsh-plugin` topic；插件市场索引是可选项，不装也不影响使用。

装好后发一条消息即可。如果页面在安装前就已经打开，它还没有新投影键的基线数据，刷新一次即可。

插件不保存任何数据，除自己的 profile 条目外不改动任何 Harness 设置；随时可以在 Plugins 页移除。

## 时间范围统计

面板顶部可以在「本会话」和几个时间窗之间切换。时间窗统计的是**本机这个 Harness home 下所有工作区的全部会话**——也就是这把 API Key 在这台机器上的总消耗，而不只是当前对话：

1. Host 通过 `ctx.sessionPersistence` 读取持久会话存储——不解析文件路径，也不依赖私有目录。
2. 每个会话被折叠成紧凑的逐次调用列表（时间、路由、token 桶），跳过 fork 子会话的继承前缀，只保留最近 35 天。
3. 列表按存储自身的 `revision` 缓存，重复查询只重读有变化的会话。
4. 在左闭右开的窗口内精确求和，并用同一套价目逐次计价：「今天」从本地零点开始，其余是滚动窗口，截止到当前时刻。

浏览器通过插件自己的同源路由 `/plugins/api-cost/window` 读取结果，只返回聚合值——没有会话 id、没有内容。该路由属于 Host 半边，**重启 Harness 后**才可用。

## 每轮花费

每条 `assistant/message` 还会按 `turn` 折叠进一份按回合记账的表，回合页脚据此显示该轮花费。它和面板读的是同一个投影值；没有计费调用的回合（例如压缩摘要，费用记在会话上但不属于任何回合）不显示。

## 价格是怎么算出来的

1. 每次模型调用结算时，会话日志会追加一条 `assistant/message`，其中带有服务端返回的 `usage` 和实际使用的 `provider`/`model`；压缩时的摘要调用则把同样的信息写在 `compaction/summary` 上，按普通调用计价。流式尝试先按其流中上报的 usage 计费，同回合同步骤的结算消息会替换它；`llm/retry-started` 会关闭替换窗口，所以重试的尝试单独计费——中断但服务端已上报 usage 的调用也会被计入。
2. 投影把这些事件折叠成每个路由的四个互不重叠的桶——未命中输入、缓存命中输入、缓存写入、输出——并按计费时段分别累计。
3. 客户端拿到的 view 已经按下列价目算好金额，包含总额、按模型明细和峰谷拆分。
4. 控件再叠加会话列表里每个后代会话（`origin: subagent`）的 `apiCost`；列表还没带这个值时（新建的子会话、插件安装前的旧检查点），控件通过会话控制器按需折叠它的投影，不需要先打开那个会话。分叉出来的子会话继承了父会话日志，因此会减掉它的 `inherited` 份额，只计分叉之后自己的消耗。仍在运行的子会话结算后再读一次，避免把运行中的快照当成最终值。

会话日志始终是唯一事实来源：重放、恢复、分叉都会得到同一个数字，插件从不写日志。

## 价目

单位：**每百万 tokens**，取自 [DeepSeek 官方价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（2026 年 10 月）。空闲时段为高峰价的一半。

| 模型 | 时段 | 缓存命中输入 | 缓存未命中输入 | 输出 |
|---|---|---|---|---|
| `deepseek-flash`（DeepSeek-V4.1-Flash-1017） | 高峰 | ¥0.04 | ¥2 | ¥8 |
| | 空闲 | ¥0.02 | ¥1 | ¥4 |
| `deepseek-v4-pro`（DeepSeek-V4-Pro-0813） | 高峰 | ¥0.30 | ¥9 | ¥27 |
| | 空闲 | ¥0.15 | ¥4.50 | ¥13.5 |

国际平台的美元价目同样内置，`currency: USD` 即可切换。

- **计费规则与官方说明一致**：高峰为北京时间周一至周五 09:00–12:00、14:00–18:00，法定节假日全天按空闲价；周末（含调休上班的周末）按空闲价。每条调用按上报 usage 的时刻归入时段。2026 年法定节假日已内置，之后的年份用 `offPeakDates` 追加。
- 退场模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 按 Flash 价格计。
- DeepSeek 不单独收缓存写入费，该桶默认 0。
- 只有官方 DeepSeek 路由（`deepseek-official`、`deepseek-account` 或其他 `deepseek…` provider id）才继承这套价目。中转/聚合服务即使挂着同一个模型 id 也价格不同，需要在 `prices` 里写 `provider/model`；否则显示「未配置价目」，而不是按官方价硬算。

## 配置

在 profile 的 `cordis.patch.yml` 里给这一行写 `config`（Web profile 会热更新，其他 profile 重启后生效）：

```yaml
- id: api-cost
  config:
    currency: CNY          # CNY（¥）| USD（$）
    peakPricing: auto      # auto | peak | offPeak
    prices:
      deepseek-flash:
        input: 1
        cacheRead: 0.02
        cacheWrite: 0
        output: 4
        peak:
          input: 2
          cacheRead: 0.04
          output: 8
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `currency` | `CNY` | 选择内置价目表和货币符号。 |
| `peakPricing` | `auto` | `auto` 按北京时间的峰谷窗口计价；`peak`/`offPeak` 把所有调用都按单一价格计。 |
| `offPeakDates` | `[]` | 额外的法定节假日（`YYYY-MM-DD`，北京时间），全天按空闲价；2026 年已内置。 |
| `prices` | `{}` | 按配置货币、每百万 tokens 的模型覆盖价。键可以是裸 `model`（对所有 provider 生效）或 `provider/model`（只对该路由）。一项会整体替换该模型的价目；`peak` 块只覆盖写出的字段，其余回落到该条目的基础价。 |

覆盖价用于促销价、自建端点或内置价目表里没有的模型。价格和币种只影响展示：改了之后历史记录会按新价重新计算，不会改写记录。

## 已知限制

- **是估算，不是账单。** 促销、协议价、服务商自身的取整都没有建模。
- **法定节假日。** DeepSeek 在节假日按空闲价计费，但 Harness 不内置节假日日历，这里工作日一律按高峰价计。
- **子会话已计入**。控件会为每个后代会话按需读取投影，所以「没点进去就少算」不会再发生；确实读不到时（例如会话已被清理）会在面板标注「费用尚未载入」，总额带 `+`，而不是当成 0。子会话仍在运行时，其份额是最近一次读取的暂估值，结算后会自动更新。外部或由 provider 托管、从不作为 Harness 会话出现的子智能体无法计入。
- **分叉会话**继承父会话日志，因此它的计数包含产生这段历史的消耗——与 Harness 自己的 token 统计口径一致。
- **跨峰谷边界的单次请求**按结算所在的时段计价。
- **范围统计读的是存储**：从未落盘的会话不在统计内；历史很多时首次查询会慢一点；35 天缓存窗口限制内存占用。统计范围是**本机的这个 Harness home**（所有工作区与子会话）；换一个 `DSH_HOME` 或换机器不互通；中转等未配置价目的路由只计 token、不计金额。

## 价目与节假日的维护

价目表和节假日日历目前是 `lib/pricing.js` 里的**静态数据**——运行时不联网，所以你看到的数字不依赖网络。

| 变化 | 更新方式 |
|---|---|
| 某个模型调价 | 新版本改 `PRICE_BOOKS`；不想等版本时，用 `prices` 覆盖该模型，下次组合即生效。 |
| 新增模型 | 在 `prices` 里加一项（`provider/model` 或裸 `model`）。 |
| 次年的法定节假日 | 把日期加进 `offPeakDates`；不加的话，节假日的工作日会按高峰价计。 |
| 高峰窗口 / 计费桶变化 | 需要新版本：窗口写在代码里，不是配置。 |

仓库是这两张表的唯一来源，所以纯数据更新就是「改一个文件 + 升版本」。不想等发版时，`prices` 和 `offPeakDates` 能覆盖所有常规变化。

## 开发

无构建步骤，也不安装运行时依赖：Host 插件把 `@deepseek-ai/schemastery` 声明为 **peer**，由 Harness 启动器从运行中的安装目录解析。

```
index.js          Host 插件：Config schema + 投影注册
lib/pricing.js    纯定价模型、折叠与 view（不 import 任何 Harness 包）
client.js         Web 客户端插件：控件与面板
locale/*.json     插件管理器展示用的元数据
test/             定价与折叠测试
```

```bash
npm test                     # 97 项检查，无需安装
node --check index.js client.js lib/pricing.js
```

要在 profile 里试跑本地目录，直接安装该目录：

```
plugin_manager  action=install_bundle  target=/absolute/path/to/dsh-api-cost
```

## 许可

MIT。内置价目是 DeepSeek 公布的事实数据，不构成对你实际账单的保证。

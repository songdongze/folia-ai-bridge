# Folia AI 桥接

一个 DSH 插件，把 DeepSeek Harness 里已经配置好的模型对外暴露成 **OpenAI 兼容接口**，
并自带 **Folia 同步服务** —— 装一个插件，Folia 的 AI 主题和外观同步都齐了。

- **AI 主题**：Folia 用「AI 供应商 → 自定义兼容接口」走 DSH 的模型，不必再准备一份 API 密钥。
- **外观同步**：内置 `folia-major/sync-server` 的完整协议，主题与视觉设置跨设备同步。

> 需要 [DeepSeek Harness](https://github.com/deepseek-ai) 与自己部署的 [Folia](https://github.com/chthollyphile/folia-major)。
> 本插件是一个 DSH bundle，不是 Folia 模组。

## 安装

```powershell
# 在任意目录克隆
git clone <本仓库地址> folia-ai-bridge
```

然后在 DSH 里：**插件** → **添加插件** → 选择上面克隆出来的 `folia-ai-bridge` 目录。
安装后设置里会多出「Folia AI 桥接」一页。

## 功能一：AI 主题

1. DSH 设置 → **Folia AI 桥接**，确认状态显示「服务可用」。
2. Folia 设置 → **AI 服务**：
   - AI 供应商选 **自定义兼容接口**
   - 接口地址填 `http://127.0.0.1:13691/v1/chat/completions`（端口以设置页里显示的为准）
   - API 密钥随便填一个非空值（例如 `dsh`）；只有在 DSH 里设了「访问令牌」时才需要填那个令牌
   - 点「获取模型」挑一个，或手填
3. 回 Folia 点「测试连接」，显示 `连接成功 · HTTP 200` 即可。

## 功能二：外观同步

1. DSH 设置 → **Folia AI 桥接** → **同步服务** 卡片：确认已开启，复制显示的**同步地址**，
   并记下或填一个 **Bearer Token**。
2. Folia 设置 → **连接与集成** → **同步服务**：
   - **Sync Server 地址**填同步地址（默认 `http://127.0.0.1:13691`）
   - **Bearer Token**填上一步的值
3. 点「测试」，成功后就能「同步 AI 主题」「同步视觉设置」了。

> 地址与 Token 都在设置页里现成显示/复制，不用自己拼。
> 同步库默认放在 `~/.dsh/folia-sync/folia-sync.db`（Windows 是 `%USERPROFILE%\.dsh\...`）。

### 同步协议

与官方 `folia-major/sync-server` 完全一致：同样的表结构、同样的 256 分桶、同样的增量哈希
（`FNV-1a(fingerprint + \0 + updatedAt)` 异或累加），所以客户端缓存的 manifest 可以直接通用。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `GET` | `/state` | 设置/主题更新时间与主题总数 |
| `GET` `PUT` | `/settings` | 读 / 写视觉设置 |
| `GET` | `/themes/manifest` | 256 个分桶的摘要 |
| `POST` | `/themes/get` | 按 fingerprint 批量取主题 |
| `POST` | `/themes/put` | 批量写主题 |
| `POST` | `/themes/bucket` | 按桶取主题（首次全量同步） |
| `POST` | `/themes/list` | 分页列出主题 |
| `GET` | `/?token=…` | 状态看板（需 `dashboardToken`） |

## 设置页能做什么

设置 → Folia AI 桥接，一块页面里管完：

- **模型选择**：提供方与模型都留空 = 跟随 DSH 的默认模型；选定了就固定用这一个。
- **思考强度**：默认「自动（取最低档，最省 token）」，也可以固定 low / medium / high 或干脆不指定。
- **输出上限 / 温度 / 访问令牌**：输出上限与 Folia 请求里的 `max_tokens` 取较小值。
- **用量详情**：请求次数、输入/输出/总 token、成功率，以及按模型分组的分条明细。
- **最近请求**：最近 20 条的模型、token 数、耗时、流式与否、成功与否。

改完点「保存设置」，插件会自动重启一次让新配置生效。

## 用量统计的口径

- 只统计**本插件转发**的请求，你在 DSH 里正常聊天不计数。
- 只进内存计数器，**不落盘、不保存请求内容**，DSH 重启即清零；页面上的「清零」按钮可以随时手动清。
- 输入/输出 token 来自模型返回的 usage；某些模型或渠道不返回 usage 时，这两个数会是 0。

## 行为约定

- 请求里的 `model` 若是当前 provider 真有的模型就用它，否则回落到 DSH 默认模型。
- Folia 会带 `response_format: json_object`。DSH 的适配器不接这个字段，插件改为在 system 提示里
  追加一句「只返回 JSON 对象」，Folia 自己解析。
- 一次请求超过 5 分钟、或客户端断开，就中止模型调用，不白烧 token。
- 不写 DSH 会话日志、不读也不改 DSH 的其他设置。

## 关掉会怎样

在插件管理里禁用本插件，这几条路由随即消失，Folia 那边请求会失败；在 Folia 的 AI 服务里把供应商
改回官方接口即可恢复。

## 接口一览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | OpenAI chat completions，支持 `stream: true`；Folia 的主题生成走这里 |
| `GET` | `/v1/models` | 列出当前提供方的模型（Folia「获取模型」用） |
| `GET` | `/folia-ai/status` | 自检：服务是否可用、当前 provider/model |
| `GET` | `/folia-ai/overview` | 设置页用：状态 + 用量 + 模型目录 |
| `POST` | `/folia-ai/config` | 设置页保存（同源校验，走 DSH 的配置编辑器） |
| `POST` | `/folia-ai/stats/reset` | 用量清零 |

## 性能

热路径只有 `/v1/chat/completions`，其余都是常数：

- 空闲时**不占任何定时器或订阅**；请求超时扫描有请求才建、最后一个结束就清掉。
- 配置在插件启动时归一化一次，热路径不做字符串解析、不编译正则。
- 模型元信息按 `provider/model` 缓存（成功 10 分钟、失败 1 分钟，最多 64 条）。
- 流式响应攒批写：满 1KB 或 40ms 才 flush，并处理 `res.write` 背压。

本机实测（`node bench.mjs`，假模型、不含真实推理）：

```
非流式 /v1/chat/completions   0.133 ms/call
流式   /v1/chat/completions   0.176 ms/call
/v1/models                    0.002 ms/call
活跃定时器                     0
```

## 开发

```powershell
node selftest.mjs          # 35 项 AI 接口离线自测（假 ctx/llm/res，不需要 DSH 在跑）
node sync-selftest.mjs     # 33 项同步存储自测（分桶/哈希/增量语义与官方逐位比对）
node bench.mjs             # 单请求处理开销微基准
node probe-folia-theme.mjs # 用 Folia 真实主题提示词打一次桥接，校验返回的 DualTheme
```

`probe-folia-theme.mjs` 需要桥接已经在运行，并且能读到本机的 Folia 源码（脚本里写死了
`D:\Folia\folia-major` 的路径，可以按自己机器改）。

改完代码后在 DSH 里把插件关掉再打开即可热重载，不需要重启 DSH。

## 许可

[MIT](LICENSE)


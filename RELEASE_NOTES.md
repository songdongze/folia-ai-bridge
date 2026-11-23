## Folia AI 桥接 v1.1.0

把 DeepSeek Harness 里配置好的模型暴露成 OpenAI 兼容接口，供 Folia 的「自定义兼容接口」生成歌词主题。

### 这个版本有什么

- `POST /v1/chat/completions`（支持流式）与 `GET /v1/models`
- DSH 设置页「Folia AI 桥接」：选模型、思考强度、输出上限、温度、访问令牌
- 用量统计：按模型分组的 token 明细与最近 20 条请求
- 热路径优化：空闲零定时器、配置预解析、模型元信息缓存、流式攒批写

### 安装

**方式一：从源码目录安装（推荐）**

1. 下载下面的 `local-folia-ai-bridge-1.1.0.tgz`，解压
2. DSH → **插件** → **添加插件** → 选择解压出来的目录

**方式二：克隆仓库**

```powershell
git clone https://github.com/songdongze/folia-ai-bridge.git
```

然后在 DSH 里选这个目录安装。

### 接上 Folia

1. DSH 设置 → **Folia AI 桥接**，确认显示「服务可用」
2. Folia 设置 → **AI 服务** → 供应商选 **自定义兼容接口**
   - 接口地址：`http://127.0.0.1:13691/v1/chat/completions`（端口以设置页显示的为准）
   - API 密钥：随便填一个非空值（如 `dsh`）
   - 点「获取模型」挑一个
3. 点「测试连接」，显示 `连接成功 · HTTP 200` 即可

### 隐私与数据

- 插件**不收集、不上传任何数据**
- 用量统计只在你本机内存里，重启即清零，也可手动清零
- 你的模型与密钥由 DSH 管理，插件只读不存

### 已知限制

- 需要一份正在运行的 DSH，端口要与 Folia 里填的一致
- 只支持 OpenAI 兼容协议；Folia 的 `response_format` 会被改写成系统提示
- 用量里的 token 数依赖模型是否返回 usage，不返回时显示 0

### 许可

MIT

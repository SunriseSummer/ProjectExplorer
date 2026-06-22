# ProjectExplorer

ProjectExplorer 是一个本地 Web 应用，用来浏览并智能分析任意项目。请将待分析项目放到 `project/` 目录下，应用会加载呈现，提供目录导航、文件预览、AI 分析、数据持久化等功能。

<img width="2769" height="1743" alt="image" src="https://github.com/user-attachments/assets/23fc96ef-e78b-4162-a7e2-26c4698ccba7" />


## 功能

- 左侧目录树展示项目的真实文件结构，并自动忽略 `node_modules`、`.git`、`dist` 等目录。
- 右侧支持 AI 对话、目录概览、文件预览和图片预览等。
- 实现了项目分析 Agent，模型可通过工具获取项目结构、读取目录、读取文件和搜索代码等，高效精准分析问题。
- 输入框提供预置问题面板，汇总了常见问题。
- 面向大型项目优化了智能体工作策略：先绘制项目地图、发现关键文件，再用文件大纲和行段读取进行局部精读。
- 支持 DeepSeek、GLM、KIMI、Qwen 官方服务。
- 历史对话本地归档，实现知识复用。归档在 `analyses/` 目录，目录结构与被分析项目保持一致。

## 目录结构

```text
.
├─ server.js                 # 启动入口
├─ server/                   # 后端模块
│  ├─ app.js                 # 组装 HTTP 服务
│  ├─ api-router.js          # API 路由
│  ├─ agent-service.js       # LLM/Agent 调用与工具编排
│  ├─ project-service.js     # 项目目录、文件读取、搜索
│  ├─ config-store.js        # 模型配置读写与脱敏
│  ├─ analysis-store.js      # 分析归档读写
│  ├─ provider-catalog.js    # 模型服务商默认配置
│  ├─ constants.js           # 文件类型、忽略规则和默认策略
│  ├─ paths.js               # 应用路径与环境变量解析
│  └─ static-service.js      # 静态资源服务
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ js/                    # 前端模块
├─ project/                  # 被分析项目，不属于应用源码
└─ analyses/                 # 分析归档，不属于应用源码
```

## 启动

需要 Node.js 18 或更高版本。

```bash
npm start
```

默认访问地址：

```text
http://localhost:5173
```

也可以指定端口或被分析项目目录：

```bash
PORT=5183 PROJECT_DIR=C:\path\to\project npm start
```

开发时也可以使用：

```bash
npm run dev
npm run check
```

## 模型配置

点击右上角设置按钮可以配置各服务的 API Key、模型名和接口地址。配置保存在本地 `config.json`，接口返回时只暴露是否已配置和密钥尾号。

环境变量也可作为初始值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5173` | Web 服务端口 |
| `PROJECT_DIR` | `./project` | 被分析项目目录 |
| `HOMETRANS_DIR` | 无 | 兼容旧名称，优先级低于 `PROJECT_DIR` |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 初始密钥 |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | DeepSeek 初始模型 |

## API

- `GET /api/tree`：读取项目目录树。
- `GET /api/config` / `POST /api/config`：读取或保存模型配置。
- `POST /api/config/test`：测试指定模型服务连通性。
- `POST /api/chat`：Agent SSE 对话接口。
- `GET /api/analyze?path=<rel>&type=dir|file`：非流式节点分析。
- `GET /api/file?path=<rel>`：读取文件预览信息。
- `GET /api/raw?path=<rel>`：读取原始文件字节。
- `GET|POST|DELETE /api/analysis?path=<rel>`：读取、保存或删除分析归档。

## Agent 工具策略

Agent 面对复杂项目时会优先使用低成本工具建立上下文：

- `get_project_map`：获取有边界的项目地图和文件类型分布。
- `find_important_files`：发现 README、配置、入口和核心源码候选。
- `get_file_outline`：提取导入、导出、函数、类和类型的大纲。
- `read_file_slice`：按行号精读关键片段，避免整文件吞上下文。
- `search_code_context`：搜索并返回匹配行附近上下文。

这些工具和系统提示配合使用，能让模型先形成假设，再逐步验证，减少无效读取和上下文浪费。

为避免复杂问题把上下文撑爆，后端还会对 Agent 做服务端约束：

- 单轮最多执行 6 个工具调用，整段对话最多执行 14 个工具调用。
- 大工具结果会在传回模型前自动压缩，必要时再通过更窄的路径、搜索或行段读取继续验证。
- 回答中要求区分“已确认”和“推断”，并对 API Key、Token、密码等敏感信息脱敏。

## 开发说明

应用源码主要位于根目录入口、`server/` 和 `public/`。`project/` 是默认被分析对象，`analyses/` 是运行时分析归档，开发或重构应用本身时通常不要把它们当作应用源码目标。

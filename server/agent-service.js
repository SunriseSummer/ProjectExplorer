import { sendSSE } from './http-utils.js';

// 以下为 Agent 策略的回退默认值；运行时优先采用 configStore.agentStrategy() 中的用户配置。
const DEFAULT_STRATEGY = {
  maxAgentTurns: 16,
  maxToolCallsPerTurn: 8,
  maxTotalToolCalls: 35,
  toolResultMaxChars: 32000,
  maxTotalToolResultChars: 420000,
  streamForwardMinChars: 48,
  treeSnapshotMaxChars: 24000,
  maxTokens: 4096,
};
// DeepSeek 等模型偶尔会以文本协议（DSML）而非结构化 tool_calls 发起工具调用，
// 流式转发正文前需用该开头标记排除掉这类协议片段，避免协议泄漏到正文。
const TEXT_TOOL_OPENER = /<\s*(?:[｜|]{2}|\?{2})DSML/u;
// 流式空闲超时：KIMI 等推理模型在重负载问题上会"静默思考"很久（实测可达 ~100s
// 且期间不推送任何字节）才吐正文。该阈值放得较宽，仅用于兜底——当上游连接彻底
// 卡死（长时间无任何字节）时中断并报错，避免前端无限转圈，同时避免误杀长推理。
const STREAM_IDLE_TIMEOUT_MS = 180000;
// 心跳间隔：一轮请求里在首个真实输出（思考/正文/工具调用）出现前，
// 周期性向前端发送进度事件，让用户看到模型确实在工作而不是卡死。
const STREAM_HEARTBEAT_MS = 3000;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_project_map',
      description: '获取有边界的项目地图、目录/文件数量、主要扩展名分布和部分条目。用于复杂项目的第一轮侦察，避免一次性读取完整大树。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的路径，根目录用空字符串。' },
          maxDepth: { type: 'number', description: '展开深度，推荐 1-3。' },
          maxEntries: { type: 'number', description: '返回条目上限，推荐 80-180。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_important_files',
      description: '按启发式找出最值得优先阅读的入口、配置、README、核心目录文件。适合在大项目中建立最小有效上下文。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '限定扫描目录，根目录用空字符串。' },
          limit: { type: 'number', description: '返回文件数量，推荐 20-50。' },
          maxFiles: { type: 'number', description: '扫描文件数量上限，默认 1200；超大项目可按需提高。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出指定目录的一层内容。用于确认目录边界或展开特定模块。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对项目根目录的目录路径。' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_outline',
      description: '提取文件的导入/导出、函数、类、类型等大纲和行号。适合先定位结构，再决定读取哪些行段。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对项目根目录的文件路径。' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file_slice',
      description: '按行读取文件片段，返回带行号的内容。适合精读关键函数、错误处理或调用链局部。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径。' },
          startLine: { type: 'number', description: '起始行号，从 1 开始。' },
          endLine: { type: 'number', description: '结束行号。单次最多返回约 700 行。' },
        },
        required: ['path', 'startLine', 'endLine'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个较小文件的内容；大文件会截断。对大文件优先使用 get_file_outline 和 read_file_slice。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对项目根目录的文件路径。' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_related_files',
      description: '批量读取最多 5 个相关小文件。适合同时读取配置、入口和相邻模块。',
      parameters: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' } } },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: '搜索文本或正则模式，返回匹配文件和行。用于定位符号、依赖、配置项或错误处理。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索模式。' },
          path: { type: 'string', description: '可选：限定搜索目录。' },
          limit: { type: 'number', description: '匹配数量上限。' },
          maxFiles: { type: 'number', description: '扫描文件数量上限。' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code_context',
      description: '搜索代码并返回匹配行附近上下文片段。适合分析调用点、错误处理、配置读取等语义场景。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索模式。' },
          path: { type: 'string', description: '可选：限定搜索目录。' },
          before: { type: 'number', description: '匹配行前置上下文行数，推荐 2-4。' },
          after: { type: 'number', description: '匹配行后置上下文行数，推荐 2-6。' },
          limit: { type: 'number', description: '匹配数量上限。' },
        },
        required: ['pattern'],
      },
    },
  },
];

export function createAgentService({ projectService, configStore }) {
  const analysisCache = new Map();

  // 合并默认值与用户配置，得到当前生效的 Agent 策略。
  function strat() {
    return { ...DEFAULT_STRATEGY, ...(configStore.agentStrategy?.() || {}) };
  }

  async function executeTool(name, args = {}) {
    switch (name) {
      case 'get_project_map':
        return projectService.getProjectMap(args.path || '', args.maxDepth ?? 2, args.maxEntries ?? 160);
      case 'find_important_files':
        return projectService.findImportantFiles(args.path || '', args.limit ?? 40, args.maxFiles ?? 1200);
      case 'list_directory':
        return projectService.listDirectoryByPath(args.path || '');
      case 'get_file_outline':
        return projectService.getFileOutline(args.path || '');
      case 'read_file_slice':
        return projectService.readFileSlice(args.path || '', args.startLine, args.endLine);
      case 'read_file':
        return projectService.toolReadFile(args.path || '');
      case 'read_related_files': {
        const paths = Array.isArray(args.paths) ? args.paths.slice(0, 5) : [];
        if (!paths.length) return { ok: false, error: '未提供文件路径' };
        const files = [];
        for (const filePath of paths) files.push({ path: filePath, ...(await projectService.toolReadFile(filePath)) });
        const content = files.map((file) => `\n### ${file.path}\n${file.summary || ''}\n\`\`\`${file.lang || ''}\n${file.content || file.error || ''}\n\`\`\``).join('\n');
        return { ok: true, content, files, summary: `已读取 ${files.length} 个文件` };
      }
      case 'search_code':
        return projectService.searchCode(args.pattern || '', args.path || '', {
          limit: args.limit,
          maxFiles: args.maxFiles,
        });
      case 'search_code_context':
        return projectService.searchCode(args.pattern || '', args.path || '', {
          before: args.before ?? 3,
          after: args.after ?? 4,
          limit: args.limit ?? 20,
          maxFiles: args.maxFiles,
        });
      default:
        return { ok: false, error: `未知工具: ${name}` };
    }
  }

  // 以流式方式请求一次补全，边接收边把"最终回答"正文实时转发给前端。
  // 工具轮（结构化 tool_calls 或 DSML 文本协议）不转发正文，仅累积后交给调用方处理。
  async function streamCompletion(messages, { tools, res }) {
    const minForwardChars = strat().streamForwardMinChars;
    const controller = new AbortController();
    let idleAborted = false;
    let idleTimer = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleAborted = true; controller.abort(); }, STREAM_IDLE_TIMEOUT_MS);
    };
    const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };

    // 心跳：在首个真实信号（思考/正文/工具调用）出现前周期性推送进度，
    // 让前端展示"模型正在思考（已用时 Ns）"，避免静默推理被误判为卡死。
    // 必须在 await fetch 之前启动：KIMI 带 tools 直接作答时，会先静默推理很久
    // 才返回响应头（fetch 在此期间一直挂起），此时只有事先启动的心跳能持续反馈。
    const startedAt = Date.now();
    let signaled = false;
    let heartbeat = null;
    const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
    const markSignaled = () => { signaled = true; stopHeartbeat(); };
    heartbeat = setInterval(() => {
      if (!signaled) sendSSE(res, { type: 'progress', elapsedMs: Date.now() - startedAt });
    }, STREAM_HEARTBEAT_MS);

    armIdle();
    const response = await requestChatCompletion(messages, { tools, stream: true, signal: controller.signal }).catch((error) => ({ error }));
    if (response.error) {
      clearIdle();
      stopHeartbeat();
      return { error: idleAborted ? `API 连接超时（${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s 无响应）` : `API 连接失败: ${response.error.message}` };
    }
    if (!response.ok) {
      clearIdle();
      stopHeartbeat();
      return { error: `API ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}` };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    let content = '';
    let reasoning = '';
    let reasoningForwarded = false;
    const toolCalls = [];
    let decided = false;
    let forwarding = false;
    let flushed = 0;
    let forwardedAny = false;

    const pushForward = (final) => {
      if (toolCalls.length) return; // 工具轮：绝不把内容当正文转发
      if (!decided) {
        // 先攒够字符再决定是否转发：DeepSeek 等模型在工具轮里会先吐一句旁白
        // （如「让我先搜索…」）再发起 tool_calls。攒够 minForwardChars 后再决定，
        // 能让 tool_calls 先到达（从而被上面的 toolCalls.length 拦截），避免旁白闪现为正文。
        // 不再用换行作为提前触发条件，否则多行旁白会过早被判定为正文。
        if (!final && content.length < minForwardChars) return;
        decided = true;
        forwarding = !TEXT_TOOL_OPENER.test(content);
      }
      if (!forwarding) return;
      const pending = content.slice(flushed);
      if (pending) {
        sendSSE(res, { type: 'delta', content: pending });
        flushed = content.length;
        forwardedAny = true;
        markSignaled();
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle(); // 收到任意字节即重置空闲计时器
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (Array.isArray(delta.tool_calls)) {
            markSignaled(); // 进入工具轮，停止进度心跳（稍后由工具事件接管 UI）
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (!toolCalls[index]) toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              const slot = toolCalls[index];
              if (tc.id) slot.id = tc.id;
              if (tc.type) slot.type = tc.type;
              if (tc.function?.name) slot.function.name = tc.function.name;
              if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
            }
          }
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            // 推理模型（KIMI/DeepSeek 等）在部分问题上会先吐 reasoning_content，
            // 把思考过程实时转发给前端；停止纯进度心跳，改为展示真实思考内容。
            sendSSE(res, { type: 'reasoning', content: delta.reasoning_content });
            reasoningForwarded = true;
            markSignaled();
          }
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            pushForward(false);
          }
        }
      }
    } catch (error) {
      clearIdle();
      if (idleAborted) {
        return { error: `模型响应超时：${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s 内没有任何数据，请重试或缩小问题范围` };
      }
      return { error: `读取模型响应失败: ${error.message}` };
    } finally {
      clearIdle();
      stopHeartbeat();
    }
    pushForward(true);

    return { content, reasoning, toolCalls: toolCalls.filter(Boolean), forwardedAny, reasoningForwarded };
  }

  async function agenticChat(targetPath, nodeType, messages, res) {
    const s = strat();
    const context = await projectService.readContext(targetPath, nodeType);
    const tree = await projectService.getTree();
    const system = {
      role: 'system',
      content: buildSystemPrompt(projectService.projectName, targetPath, nodeType, context, projectService.compactTree(tree), s.treeSnapshotMaxChars),
    };
    const activeMessages = [system, ...messages];
    let totalToolCalls = 0;
    let toolResultCharsUsed = 0;

    for (let turn = 0; turn < s.maxAgentTurns; turn += 1) {
      const stream = await streamCompletion(activeMessages, { tools: TOOLS, res });
      if (stream.error) return endWithError(res, stream.error);

      const message = {
        content: stream.content,
        tool_calls: stream.toolCalls.length ? stream.toolCalls : undefined,
        reasoning_content: stream.reasoning || undefined,
      };
      const textToolCalls = stream.toolCalls.length ? [] : extractTextToolCalls(stream.content || '');
      const requestedToolCalls = stream.toolCalls.length ? stream.toolCalls : textToolCalls;

      if (requestedToolCalls.length) {
        // 安全网：极少数情况下模型先吐了正文又决定调用工具，让前端丢弃已转发的残段
        if (stream.forwardedAny) sendSSE(res, { type: 'discard' });
        const budgetExhausted = totalToolCalls >= s.maxTotalToolCalls || toolResultCharsUsed >= s.maxTotalToolResultChars;
        const remainingToolCalls = budgetExhausted ? 0 : s.maxTotalToolCalls - totalToolCalls;
        const selectedToolCalls = requestedToolCalls.slice(0, Math.min(s.maxToolCallsPerTurn, remainingToolCalls));
        const skippedToolCalls = requestedToolCalls.length - selectedToolCalls.length;

        if (!selectedToolCalls.length) {
          await sendFinalAnswer(activeMessages, res, '工具调用预算已用完。请基于已经读取的证据作答，并明确说明哪些结论仍需额外验证。不要再输出任何工具调用协议、XML、DSML 或 JSON 函数调用。');
          sendSSE(res, { type: 'done' });
          res.end();
          return;
        }

        activeMessages.push(normalizeAssistantToolMessage(message, selectedToolCalls));
        for (const toolCall of selectedToolCalls) {
          const fnName = toolCall.function.name;
          const args = parseToolArgs(toolCall.function.arguments);
          sendSSE(res, { type: 'tool_call', name: fnName, args });
          const toolResult = await executeTool(fnName, args);
          sendSSE(res, { type: 'tool_result', name: fnName, ok: toolResult.ok !== false, summary: toolResult.summary || toolResult.error || '' });
          const serializedResult = JSON.stringify(compactToolResult(toolResult, s.toolResultMaxChars, Math.max(2000, Math.floor(s.toolResultMaxChars / 4))));
          activeMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: serializedResult });
          totalToolCalls += 1;
          toolResultCharsUsed += serializedResult.length;
        }
        if (skippedToolCalls > 0) {
          activeMessages.push({
            role: 'system',
            content: `为控制上下文和延迟，本轮已执行 ${selectedToolCalls.length} 个最靠前的工具调用，跳过 ${skippedToolCalls} 个。请先判断现有证据是否足够；如仍不足，下一轮只请求最关键的 1-3 个工具。`,
          });
        }
        continue;
      }

      // 正文已在流式过程中实时转发；仅当未转发（极短内容或被判为协议但实际无工具）时补发一次
      if (!stream.forwardedAny) await emitFinalContent(stream.content || '', res);
      sendSSE(res, { type: 'done' });
      res.end();
      return;
    }

    await sendFinalAnswer(activeMessages, res, '工具调用已达到上限。请明确说明已经读取过哪些证据、哪些结论仍需验证，然后给出当前最可靠的回答。不要再输出任何工具调用协议、XML、DSML 或 JSON 函数调用。');
    sendSSE(res, { type: 'done' });
    res.end();
  }

  async function analyzeNonStream(targetPath, nodeType) {
    const cacheKey = `${nodeType}:${targetPath}`;
    if (analysisCache.has(cacheKey)) return analysisCache.get(cacheKey);

    const context = await projectService.readContext(targetPath, nodeType);
    const userPrompt = nodeType === 'dir'
      ? `请分析目录 /${targetPath || ''} 的功能定位和内容概览。仅返回 JSON：{"title":"...","kind":"dir","summary":"...","detail":["..."],"bullets":["..."],"tags":["..."]}`
      : `请分析文件 /${targetPath} 的功能、关键实现和项目角色。仅返回 JSON：{"title":"...","kind":"source|config|docs|asset","summary":"...","detail":["..."],"bullets":["..."],"tags":["..."]}`;

    // 非流式分析没有增量数据，用整体超时兜底，避免推理模型长时间无响应把请求挂死。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    let response;
    try {
      response = await requestChatCompletion([
        { role: 'system', content: `${buildSystemPrompt(projectService.projectName, targetPath, nodeType, context, '')}\n\n严格只返回 JSON，不要包裹代码块。` },
        { role: 'user', content: userPrompt },
      ], { max_tokens: 2000, signal: controller.signal });
    } catch (error) {
      throw new Error(controller.signal.aborted ? `分析超时（${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s）` : error.message);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`API ${response.status}`);
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || '';
    const jsonText = text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    const parsed = JSON.parse(jsonText);
    analysisCache.set(cacheKey, parsed);
    return parsed;
  }

  async function sendFinalAnswer(messages, res, instruction) {
    // 不带工具的收尾请求，同样走流式：正文实时转发；若被判为协议片段则清洗后补发
    const stream = await streamCompletion([...messages, { role: 'system', content: instruction }], { res });
    if (stream.error) {
      sendSSE(res, { type: 'error', message: `最终回答请求失败: ${stream.error}` });
      return;
    }
    if (!stream.forwardedAny) await emitFinalContent(stream.content || '', res);
  }

  async function requestChatCompletion(messages, options = {}) {
    const llm = configStore.activeLLM();
    if (!llm.apiKey) throw new Error('未配置当前模型服务的 API Key');
    return fetch(llm.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        messages: normalizeMessagesForProvider(messages, llm.provider),
        temperature: llm.temperature,
        max_tokens: options.max_tokens || strat().maxTokens,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.stream ? { stream: true } : {}),
      }),
      signal: options.signal,
    });
  }

  return { agenticChat, analyzeNonStream };
}

function buildSystemPrompt(projectName, targetPath, nodeType, context, treeText, treeSnapshotMax = DEFAULT_STRATEGY.treeSnapshotMaxChars) {
  const isDir = nodeType === 'dir';
  const contextLabel = isDir ? '目录内容列表' : `文件内容 (${context.lang || 'text'})${context.truncated ? ' [已截断]' : ''}`;
  const treeOverview = treeText ? `\n## 当前项目结构快照（可能已截断）\n\`\`\`\n${treeText.slice(0, treeSnapshotMax)}\n\`\`\`` : '';

  return `你是严谨的代码分析 Agent，正在分析项目 "${projectName}"。

## 当前分析目标
${isDir ? '目录' : '文件'} /${targetPath || ''}

${contextLabel}:
\`\`\`
${context.content}
\`\`\`
${treeOverview}

## 大项目分析策略
1. 先建立地图：复杂问题优先调用 get_project_map 和 find_important_files，识别入口、配置、核心目录和代表性文件。
2. 再低成本定位：对候选文件先用 get_file_outline，看导入、导出、函数、类和行号。
3. 最后局部精读：只对关键函数、调用链、配置读取、错误处理等区域使用 read_file_slice；小文件才直接 read_file。
4. 搜索要带目的：查符号用 search_code；需要理解上下文时用 search_code_context。
5. 管理上下文预算：上下文窗口较大，可在需要时适度多读完整文件或较长行段；在心里规划当前假设、已读证据和下一步，但不要把这些过程性思考作为正文输出，避免漫无目的地读取。
6. 面对不确定性：明确标注“已确认”和“推断”，不要把未读取的文件内容说成事实。

7. 过滤低价值上下文：除非用户明确要求，优先跳过生成物、二进制资源、锁文件、快照、fixture 和测试目录；需要验证质量风险时再读取测试。
8. 适可而止：证据已经足够回答时停止调用工具，不要为了形式上的完整性继续读取文件。
9. 控制工具批量：单轮可请求 4-8 个相关工具并行推进；优先选择代表性文件，按优先级排序，把最关键的放在前面。
10. 保护敏感信息：如果文件或配置里出现 API Key、Token、密钥、密码等内容，回答中只描述用途和风险，必须脱敏展示。
11. 工具调用纪律：当你决定调用工具时，本轮【不要】输出任何自然语言正文、旁白或解释（例如“让我先搜索…”“现在分析一下…”“接下来读取…”），直接发起工具调用即可。只有在给出面向用户的最终回答时才输出正文。
## 回答要求
- 使用中文，结构清晰，先结论后证据。
- 引用具体文件路径；如已读取到行号，给出行号。
- 对架构/质量/风险类问题，按优先级排序并给出可执行建议。
- 如果证据不足，说明还需要读取哪些文件或运行哪些检查。`;
}

function normalizeAssistantToolMessage(message, toolCalls) {
  const normalized = {
    role: 'assistant',
    content: hasTextToolCalls(message.content || '') ? null : message.content || null,
    tool_calls: toolCalls.map((toolCall, index) => ({
      id: toolCall.id || `text_tool_${Date.now()}_${index}`,
      type: toolCall.type || 'function',
      function: {
        name: toolCall.function.name,
        arguments: typeof toolCall.function.arguments === 'string'
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments || {}),
      },
    })),
  };
  if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
    normalized.reasoning_content = message.reasoning_content;
  }
  return normalized;
}

function normalizeMessagesForProvider(messages, provider) {
  return messages.map((message) => {
    const normalized = { ...message };
    if (provider !== 'deepseek' || !normalized.reasoning_content) delete normalized.reasoning_content;
    return normalized;
  });
}

async function emitFinalContent(content, res) {
  const clean = stripTextToolCalls(content).trim();
  if (!clean) {
    sendSSE(res, {
      type: 'error',
      message: '模型返回了未完成的工具调用协议，已阻止其作为正文显示。请重试或缩小问题范围。',
    });
    return;
  }
  for (const chunk of chunkFinalContent(clean)) {
    sendSSE(res, { type: 'delta', content: chunk });
    await delay(4);
  }
}

function chunkFinalContent(content) {
  const chunks = [];
  let cursor = 0;
  while (cursor < content.length) {
    const next = findChunkEnd(content, cursor);
    chunks.push(content.slice(cursor, next));
    cursor = next;
  }
  return chunks;
}

function findChunkEnd(content, start) {
  const maxEnd = Math.min(content.length, start + 72);
  const minEnd = Math.min(content.length, start + 18);
  for (let index = minEnd; index < maxEnd; index += 1) {
    if (/[\n。！？；.!?;，,、]/u.test(content[index])) return index + 1;
  }
  return maxEnd;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasTextToolCalls(content) {
  return /<\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})tool_calls\s*>/u.test(content);
}

function stripTextToolCalls(content) {
  return content.replace(/<\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})tool_calls\s*>[\s\S]*?<\s*\/\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})tool_calls\s*>/gu, '');
}

function extractTextToolCalls(content) {
  const calls = [];
  const blockRegex = /<\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})tool_calls\s*>([\s\S]*?)<\s*\/\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})tool_calls\s*>/gu;
  for (const blockMatch of content.matchAll(blockRegex)) {
    const block = blockMatch[1];
    const invokeRegex = /<\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\s*\/\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})invoke\s*>/gu;
    for (const invokeMatch of block.matchAll(invokeRegex)) {
      const args = {};
      const paramRegex = /<\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\s*\/\s*(?:[｜|]{2}|\?{2})DSML(?:[｜|]{2}|\?{2})parameter\s*>/gu;
      for (const paramMatch of invokeMatch[2].matchAll(paramRegex)) {
        const [, key, stringFlag, rawValue] = paramMatch;
        args[key] = stringFlag === 'true' ? rawValue.trim() : parsePrimitive(rawValue.trim());
      }
      const normalized = normalizeTextToolRequest(invokeMatch[1], args);
      calls.push({
        id: `text_tool_${Date.now()}_${calls.length}`,
        type: 'function',
        function: { name: normalized.name, arguments: JSON.stringify(normalized.args) },
      });
    }
  }
  return calls;
}

function normalizeTextToolRequest(name, args) {
  if (name === 'read_file' && args.startLine != null && args.endLine != null) {
    return { name: 'read_file_slice', args: { path: args.path, startLine: args.startLine, endLine: args.endLine } };
  }
  return { name, args };
}

function parsePrimitive(value) {
  if (/^-?\d+(\.\d+)?$/u.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseToolArgs(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function compactToolResult(result, maxChars = DEFAULT_STRATEGY.toolResultMaxChars, itemMaxChars = 8000) {
  const compacted = { ...result };
  if (typeof compacted.content === 'string') compacted.content = truncateText(compacted.content, maxChars);
  if (Array.isArray(compacted.entries)) compacted.entries = compacted.entries.slice(0, 80);
  if (Array.isArray(compacted.results)) compacted.results = compacted.results.slice(0, 40);
  if (Array.isArray(compacted.files)) {
    compacted.files = compacted.files.slice(0, 5).map((file) => ({
      ...file,
      content: typeof file.content === 'string' ? truncateText(file.content, itemMaxChars) : file.content,
    }));
  }
  return compacted;
}

function truncateText(text, maxChars) {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n... [工具结果已压缩，必要时请使用更窄的 path、search_code_context 或 read_file_slice 继续验证]`
    : text;
}

function endWithError(res, message) {
  sendSSE(res, { type: 'error', message });
  sendSSE(res, { type: 'done' });
  res.end();
}

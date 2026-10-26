if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
  window.__ModuleLoader__.load({
    id: "dsh-table",
    factory: function(require) {
      var module = { exports: {} };
      var exports = module.exports;
      const { jsx: _jsx, jsxs: _jsxs, Fragment: _Fragment } = require("react/jsx-runtime");
const React = require("react");
const { useState, useEffect } = React;
const PANEL_ID = 'workbench';
// 侧栏入口名不能与宿主自带的“工作台”重名，否则用户无法区分本插件与宿主面板
const ENTRY_TITLE = '任务台';
/** Kept pure so the packaged desktop control copy can be regression tested. */
const formatStopFeedback = (res) => {
    if (res.status === 'stopped')
        return '已确认目标工作停止；已有成果保留。';
    if (res.status === 'already_terminal')
        return '目标工作已结束。';
    if (res.status === 'waiting_tool_exit' || res.status === 'stopping')
        return '已请求停止，正在等待执行工具退出；尚未确认停止。';
    if (res.status === 'conflict')
        return '无法确认目标已停止，执行结果仍待核对；请勿重复开工。';
    return '停止请求已收到，等待执行端确认。';
};
/** 卡片状态只呈现业务语义，不把内部状态码暴露给用户。 */
const taskStatusLabel = (statusCode) => {
    switch (statusCode) {
        case 'todo':
            return '待办';
        case 'in_progress':
            return '推进中';
        case 'review':
            return '待验收';
        case 'done':
            return '已完成';
        case 'blocked':
            return '已阻塞';
        case 'failed':
            return '未完成';
        case 'cancelled':
            return '已取消';
        default:
            return '未知状态';
    }
};
/** 优先级同样只呈现业务语义。 */
const taskPriorityLabel = (priorityCode) => {
    switch (priorityCode) {
        case 'urgent':
            return '紧急';
        case 'high':
            return '高';
        case 'normal':
            return '普通';
        case 'low':
            return '低';
        default:
            return '普通';
    }
};
/** 运行状态同样只呈现业务语义，不把内部状态码暴露给用户。 */
const runStateLabel = (state) => {
    switch (state) {
        case 'running':
            return '推进中';
        case 'queued':
            return '排队中';
        case 'stopping':
            return '正在停止';
        case 'awaiting_input':
            return '等待输入';
        case 'completed':
            return '已完成';
        case 'interrupted':
            return '已中断';
        case 'failed':
            return '失败';
        case 'unknown':
            return '结果待核对';
        default:
            return '处理中';
    }
};
// ================= API Client =================
async function fetchJson(url, options) {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
}
// ================= 主应用视图 =================
function WorkbenchView({ onClose }) {
    const [projects, setProjects] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [inputText, setInputText] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [controlSnapshot, setControlSnapshot] = useState({
        activeCount: 0,
        queuedCount: 0,
        awaitingCount: 0,
        items: [],
    });
    const [actionFeedback, setActionFeedback] = useState(null);
    const [sending, setSending] = useState(false);
    const [connection, setConnection] = useState(null);
    const [pendingInteractions, setPendingInteractions] = useState([]);
    const [questionAnswers, setQuestionAnswers] = useState({});
    useEffect(() => {
        let active = true;
        const poll = async () => {
            try {
                const identity = await fetchJson('/api/workbench/connection');
                if (active)
                    setConnection(identity);
                const result = await fetchJson('/api/workbench/interactions');
                if (active)
                    setPendingInteractions(result.pending);
            }
            catch {
                if (active)
                    setPendingInteractions([]);
            }
        };
        void poll();
        const timer = setInterval(poll, 1500);
        return () => { active = false; clearInterval(timer); };
    }, []);
    const respondInteraction = async (item, action) => {
        try {
            const answers = item.questions?.map((q) => {
                const value = (questionAnswers[item.id + q.id] || '').trim();
                const selected = q.options?.some((o) => o.label === value) ? [value] : [];
                return { id: q.id, selected, ...(selected.length ? {} : { custom: value }) };
            });
            await fetchJson('/api/workbench/interactions/respond', { method: 'POST', body: JSON.stringify({ id: item.id, sessionId: item.sessionId, turnId: item.turnId, action, answers }) });
            setPendingInteractions(items => items.filter(p => p.id !== item.id));
            setActionFeedback('已答复原请求，后台继续推进。');
        }
        catch (error) {
            setActionFeedback(error.message);
        }
    };
    const abandonHost = async () => {
        try {
            const state = await fetchJson('/api/workbench/control/uncertain');
            if (state.host?.status !== 'unknown') {
                setActionFeedback('请先核验当前状态；未解除保护。');
                return;
            }
            if (!window.confirm('仅在你已确认原宿主进程或会话退出时继续。解除保护不会停止仍在运行的工具，也不会撤销已有成果；误确认可能导致重复执行。'))
                return;
            await fetchJson('/api/workbench/control/abandon', { method: 'POST', body: JSON.stringify({ expectedRequestId: state.host.requestId, confirmed: true, reason: '用户明确确认原宿主已退出，放弃该未知轮次' }) });
            setActionFeedback('已放弃旧轮次；没有宣称已验证停止，下次使用新会话。');
            await loadControlSnapshot();
        }
        catch (error) {
            setActionFeedback(error.message);
        }
    };
    // 任务编辑与材料补充模态框状态
    const [editingTask, setEditingTask] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [editGoal, setEditGoal] = useState('');
    const [editAcceptance, setEditAcceptance] = useState('');
    // 默认主助理欢迎词
    const defaultWelcomeMessage = {
        id: 'welcome',
        sender: 'assistant',
        text: '你好！我是工作台主助理。\n• 你可以在这里和我持续对话、梳理并拆解新任务\n• 也可以将左侧任务卡拖入下方输入框，或用 @ 选择任务卡后说“推进这些”\n• 后台 worker 会在独立项目根执行，成果与审批将在这里集中呈现。\n• 顶部设有常驻控制条，独立于对话，可随时一键中止运行中的后台任务。',
        createdAt: new Date().toISOString(),
    };
    const [messages, setMessages] = useState([defaultWelcomeMessage]);
    // 1. 加载项目和任务卡
    const loadData = async () => {
        try {
            const [pList, tList] = await Promise.all([
                fetchJson('/api/workbench/projects').catch(() => []),
                fetchJson('/api/workbench/tasks').catch(() => []),
            ]);
            setProjects(pList);
            setTasks(tList);
            if (!selectedProjectId && pList.length > 0) {
                setSelectedProjectId(pList[0].id);
            }
        }
        catch (err) {
            console.error('[Workbench] Load data error:', err);
        }
        finally {
            setLoading(false);
        }
    };
    // 2. 加载控制快照 (独立控制路径)
    const loadControlSnapshot = async () => {
        try {
            const snapshot = await fetchJson('/api/workbench/control/snapshot');
            setControlSnapshot(snapshot);
        }
        catch (err) {
            // 忽略短暂网络闪断
        }
    };
    // 3. 加载历史聊天记录
    const loadChatMessages = async () => {
        try {
            const chatList = await fetchJson('/api/workbench/chat/messages').catch(() => []);
            if (chatList && chatList.length > 0) {
                setMessages(chatList);
            }
        }
        catch (err) {
            // 忽略读取聊天失败
        }
    };
    useEffect(() => {
        loadData();
        loadControlSnapshot();
        loadChatMessages();
        // 轮询 Outbox 事件与控制快照保持实时同步
        let seq = 0;
        const interval = setInterval(async () => {
            try {
                const events = await fetchJson(`/api/workbench/events?after=${seq}`).catch(() => []);
                if (events && events.length > 0) {
                    seq = events[events.length - 1].sequence;
                    loadData();
                    loadChatMessages();
                }
                await loadControlSnapshot();
            }
            catch {
                // ignore
            }
        }, 1500);
        return () => clearInterval(interval);
    }, []);
    // 触发全局或单项停止
    const handleStop = async (target) => {
        try {
            setActionFeedback(`正在向控制路径投递停止指令 (${target.kind}${target.id ? ':' + target.id : ''})...`);
            const res = await fetchJson('/api/workbench/control/stop', {
                method: 'POST',
                body: JSON.stringify({ target }),
            });
            setActionFeedback(formatStopFeedback(res));
            await loadControlSnapshot();
            await loadData();
            await loadChatMessages();
            setTimeout(() => setActionFeedback(null), 4000);
        }
        catch (err) {
            setActionFeedback(`停止失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 单卡快速推进
    const handleStartTaskRun = async (taskId) => {
        try {
            setActionFeedback(`正在推进任务 ${taskId.slice(0, 8)}...`);
            await fetchJson('/api/workbench/runs/start', {
                method: 'POST',
                body: JSON.stringify({ taskId, clientRequestId: `cli-${Date.now()}-${taskId}` }),
            });
            setActionFeedback(`任务 ${taskId.slice(0, 8)} 调度成功`);
            await loadControlSnapshot();
            await loadData();
            setTimeout(() => setActionFeedback(null), 3000);
        }
        catch (err) {
            setActionFeedback(`启动推进失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 核对并解除未知状态（T-012）
    const handleReconcileUncertain = async (targetRunId) => {
        try {
            setActionFeedback('正在向控制路径核对未决状态...');
            if (targetRunId) {
                await fetchJson('/api/workbench/control/reconcile', {
                    method: 'POST',
                    body: JSON.stringify({
                        runId: targetRunId,
                        resolution: { state: 'interrupted', summary: '用户在界面确认前序执行已退出，解除保护并重置为待办' },
                    }),
                });
                setActionFeedback('已核实并解除该任务的未知状态');
            }
            else {
                const autoRes = await fetchJson('/api/workbench/control/reconcile', {
                    method: 'POST',
                    body: JSON.stringify({ auto: true }),
                });
                if (autoRes.reconciled && autoRes.reconciled.length > 0) {
                    setActionFeedback(`已由宿主核实并解除 ${autoRes.reconciled.length} 项未决执行`);
                }
                else {
                    const uncertData = await fetchJson('/api/workbench/control/uncertain');
                    let resolved = 0;
                    if (uncertData.runs) {
                        for (const r of uncertData.runs) {
                            await fetchJson('/api/workbench/control/reconcile', {
                                method: 'POST',
                                body: JSON.stringify({
                                    runId: r.id,
                                    resolution: { state: 'interrupted', summary: '经操作员核实：确认前序 Worker 已退出，解除保护并重置为待办' },
                                }),
                            });
                            resolved++;
                        }
                    }
                    if (uncertData.queue) {
                        for (const q of uncertData.queue) {
                            await fetchJson('/api/workbench/control/reconcile', {
                                method: 'POST',
                                body: JSON.stringify({ queueId: q.id, action: 'cancel' }),
                            });
                            resolved++;
                        }
                    }
                    setActionFeedback(`已核对并解除 ${resolved} 项未知状态，项目保护已恢复正常`);
                }
            }
            await loadControlSnapshot();
            await loadData();
            setTimeout(() => setActionFeedback(null), 4000);
        }
        catch (err) {
            setActionFeedback(`核对失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 保存任务编辑与补充的材料
    const handleSaveTaskEdit = async () => {
        if (!editingTask)
            return;
        try {
            setActionFeedback(`正在更新任务 [${editingTask.title}]...`);
            await fetchJson('/api/workbench/tasks/update', {
                method: 'POST',
                body: JSON.stringify({
                    id: editingTask.id,
                    expectedRevision: editingTask.revision,
                    title: editTitle,
                    goal: editGoal,
                    acceptance: editAcceptance,
                }),
            });
            setActionFeedback('任务已成功更新');
            setEditingTask(null);
            await loadData();
            setTimeout(() => setActionFeedback(null), 3000);
        }
        catch (err) {
            setActionFeedback(`更新失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 发送主助理消息（通过服务端真实端点）
    const handleSend = async () => {
        if (!inputText.trim() || sending)
            return;
        const text = inputText.trim();
        setInputText('');
        setSending(true);
        // 乐观添加用户消息
        const userMsg = {
            id: `temp-${Date.now()}`,
            sender: 'user',
            text,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        try {
            const res = await fetchJson('/api/workbench/chat/send', {
                method: 'POST',
                body: JSON.stringify({ text, projectId: selectedProjectId }),
            });
            if (res && res.reply) {
                setMessages((prev) => [...prev, res.reply]);
            }
            await loadControlSnapshot();
            await loadData();
        }
        catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    id: `err-${Date.now()}`,
                    sender: 'assistant',
                    text: `[错误] 通信异常：${err.message}`,
                    createdAt: new Date().toISOString(),
                },
            ]);
        }
        finally {
            setSending(false);
        }
    };
    // 拖卡处理
    const handleDragStart = (e, task) => {
        e.dataTransfer.setData('text/plain', `@task:${task.id}[${task.title}]`);
    };
    const handleDrop = (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('text/plain');
        if (data) {
            setInputText((prev) => (prev ? `${prev} ${data}` : data));
        }
    };
    const currentProject = projects.find((p) => p.id === selectedProjectId);
    const filteredTasks = tasks
        .filter((t) => !selectedProjectId || t.projectId === selectedProjectId)
        .filter((t) => (activeTab === 'all' ? true : t.statusCode === activeTab));
    const awaitingCount = controlSnapshot.awaitingCount ?? 0;
    const unknownCount = controlSnapshot.unknownCount ?? controlSnapshot.items.filter(item => item.state === 'unknown').length;
    const isWorking = controlSnapshot.activeCount > 0 || controlSnapshot.queuedCount > 0 || awaitingCount > 0 || unknownCount > 0;
    return (_jsxs("div", { style: {
            // 作为 DSH 主面板渲染时铺满面板容器；不再用 fixed 覆盖层，避免遮挡宿主自身界面
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
            color: '#1e293b',
            overflow: 'hidden',
        }, children: [_jsxs("div", { style: {
                    height: '52px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 20px',
                    background: '#f8fafc',
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx("span", { style: { fontSize: '16px', fontWeight: 700, color: '#0f172a' }, children: "DSH Table \u5DE5\u4F5C\u53F0" }), _jsx("span", { style: {
                                            fontSize: '11px',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            background: '#dcfce7',
                                            color: '#15803d',
                                            fontWeight: 600,
                                        }, children: connection?.mode === 'client' ? connection.ready ? `Windows · ${connection.profile || '远程'} · ${String(connection.hostId || '').slice(0, 8)}` : '请先连接 Windows' : connection?.mode === 'host' ? 'Windows Host 权威' : '正在核验执行端' })] }), currentProject && (_jsxs("span", { style: { fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }, children: ["\u7269\u7406\u6839: ", currentProject.rootPath] }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [_jsx("button", { onClick: () => {
                                    loadData();
                                    loadControlSnapshot();
                                    loadChatMessages();
                                }, style: {
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    color: '#475569',
                                }, children: "\u5237\u65B0\u6570\u636E" }), onClose && (_jsx("button", { onClick: onClose, style: {
                                    padding: '6px 14px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: '#e2e8f0',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    color: '#334155',
                                }, children: "\u8FD4\u56DE\u5BF9\u8BDD" }))] })] }), _jsxs("div", { style: {
                    padding: '8px 20px',
                    background: isWorking ? '#fff7ed' : '#f8fafc',
                    borderBottom: '1px solid #fed7aa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    transition: 'background 0.2s ease',
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '16px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px' }, children: [_jsx("span", { style: {
                                            display: 'inline-block',
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            background: isWorking ? '#f97316' : '#22c55e',
                                            boxShadow: isWorking ? '0 0 6px #f97316' : 'none',
                                        } }), _jsx("span", { style: { fontWeight: 600, color: isWorking ? '#9a3412' : '#15803d' }, children: unknownCount > 0 ? '有工作等待核对' : awaitingCount > 0 ? '等待你的回复' : isWorking ? '工作推进中' : '执行控制就绪' })] }), _jsxs("span", { style: { color: '#475569' }, children: ["\u8FD0\u884C\u4E2D: ", _jsx("strong", { children: controlSnapshot.activeCount }), " \u9879 \u00B7 \u6392\u961F\u4E2D: ", _jsx("strong", { children: controlSnapshot.queuedCount }), " \u9879", awaitingCount > 0 && _jsxs(_Fragment, { children: [" \u00B7 \u5F85\u56DE\u590D: ", _jsx("strong", { children: awaitingCount }), " \u9879"] }), unknownCount > 0 && _jsxs(_Fragment, { children: [" \u00B7 \u5F85\u6838\u5BF9: ", _jsx("strong", { children: unknownCount }), " \u9879"] })] }), controlSnapshot.items.length > 0 && (_jsx("div", { style: { display: 'flex', gap: '6px', alignItems: 'center' }, children: controlSnapshot.items.slice(0, 2).map((item) => (_jsxs("span", { style: {
                                        fontSize: '11px',
                                        background: '#ffedd5',
                                        color: '#c2410c',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                    }, children: [item.taskTitle ? item.taskTitle.slice(0, 14) : item.taskId.slice(0, 8), " (", runStateLabel(item.state), ")"] }, item.runId))) })), actionFeedback && (_jsx("span", { style: { color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }, children: actionFeedback }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [unknownCount > 0 && (_jsxs("button", { onClick: () => handleReconcileUncertain(), style: {
                                    padding: '4px 10px',
                                    borderRadius: '5px',
                                    border: '1px solid #d97706',
                                    background: '#fffbeb',
                                    color: '#b45309',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }, title: "\u81EA\u52A8\u5411\u5BBF\u4E3B\u6216\u64CD\u4F5C\u5458\u6838\u9A8C\u5E76\u89E3\u9664\u5F85\u6838\u5BF9\u6267\u884C", children: ["\u6838\u9A8C\u5F85\u6838\u5BF9 (", unknownCount, ")"] })), controlSnapshot.items.some(item => item.taskId === 'main-assistant' && item.state === 'unknown') && (_jsx("button", { onClick: abandonHost, children: "\u786E\u8BA4\u539F\u5BBF\u4E3B\u5DF2\u9000\u51FA" })), controlSnapshot.activeCount > 0 && (_jsx("button", { onClick: () => handleStop({ kind: 'run', id: controlSnapshot.items[0]?.runId }), style: {
                                    padding: '4px 10px',
                                    borderRadius: '5px',
                                    border: '1px solid #f97316',
                                    background: '#ffffff',
                                    color: '#c2410c',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }, children: "\u505C\u6B62\u5F53\u524D\u4EFB\u52A1" })), _jsx("button", { onClick: () => handleStop({ kind: 'all' }), style: {
                                    padding: '4px 12px',
                                    borderRadius: '5px',
                                    border: 'none',
                                    background: '#ef4444',
                                    color: '#ffffff',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(239, 68, 68, 0.2)',
                                }, children: "\u505C\u6B62\u5168\u90E8\u5DE5\u4F5C" })] })] }), pendingInteractions.map(item => (_jsxs("div", { style: { padding: '12px 20px', background: '#fffbeb', borderBottom: '1px solid #fbbf24' }, children: [_jsx("strong", { children: item.title }), item.kind === 'approval' ? _jsxs("span", { children: [_jsx("button", { onClick: () => respondInteraction(item, 'approve'), children: "\u6279\u51C6\u672C\u6B21" }), _jsx("button", { onClick: () => respondInteraction(item, 'reject'), children: "\u62D2\u7EDD" })] }) : _jsxs("div", { children: [item.questions.map((q) => _jsxs("label", { style: { display: 'block', marginTop: '8px' }, children: [q.question || q.header || q.id, q.detail && _jsx("pre", { style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }, children: q.detail }), q.options?.map((o) => _jsx("button", { onClick: () => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: o.label })), children: o.label }, o.label)), _jsx("input", { placeholder: "\u9009\u62E9\u4E0A\u65B9\u9009\u9879\uFF0C\u6216\u8865\u5145\u56DE\u7B54", value: questionAnswers[item.id + q.id] || '', onChange: e => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: e.target.value })) })] }, q.id)), _jsx("button", { onClick: () => respondInteraction(item), children: "\u63D0\u4EA4\u8FD9\u7EC4\u56DE\u7B54" })] })] }, item.id))), _jsxs("div", { style: { flex: 1, display: 'flex', overflow: 'hidden' }, children: [_jsxs("div", { style: { width: '220px', borderRight: '1px solid #e2e8f0', background: '#f8fafc', padding: '16px', overflowY: 'auto' }, children: [_jsxs("div", { style: { fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '10px', textTransform: 'uppercase' }, children: ["\u5173\u8054\u9879\u76EE (", projects.length, ")"] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: projects.map((p) => {
                                    const pTasks = tasks.filter((t) => t.projectId === p.id);
                                    const isSelected = selectedProjectId === p.id;
                                    return (_jsxs("button", { onClick: () => setSelectedProjectId(p.id), style: {
                                            textAlign: 'left',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: isSelected ? '#3b82f6' : 'transparent',
                                            color: isSelected ? '#ffffff' : '#334155',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '2px',
                                            transition: 'all 0.15s ease',
                                        }, children: [_jsx("span", { style: { fontSize: '13px', fontWeight: isSelected ? 600 : 500 }, children: p.title }), _jsxs("span", { style: { fontSize: '11px', color: isSelected ? '#e0f2fe' : '#94a3b8' }, children: [pTasks.length, " \u9879\u4EFB\u52A1"] })] }, p.id));
                                }) })] }), _jsxs("div", { style: { flex: 1, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#f1f5f9' }, children: [_jsxs("div", { style: {
                                    padding: '12px 20px',
                                    background: '#ffffff',
                                    borderBottom: '1px solid #e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }, children: [_jsx("div", { style: { display: 'flex', gap: '6px' }, children: ['all', 'todo', 'in_progress', 'review', 'done'].map((tab) => (_jsxs("button", { onClick: () => setActiveTab(tab), style: {
                                                padding: '4px 12px',
                                                borderRadius: '16px',
                                                border: 'none',
                                                background: activeTab === tab ? '#0f172a' : '#f1f5f9',
                                                color: activeTab === tab ? '#ffffff' : '#64748b',
                                                fontSize: '12px',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                            }, children: [tab === 'all' && '全部', tab === 'todo' && '待办', tab === 'in_progress' && '推进中', tab === 'review' && '待验收', tab === 'done' && '已完成'] }, tab))) }), _jsx("span", { style: { fontSize: '12px', color: '#94a3b8' }, children: "\u63D0\u793A: \u53EF\u76F4\u63A5\u62D6\u62FD\u5361\u7247\u5230\u53F3\u4FA7\u8F93\u5165\u6846\u5F15\u7528" })] }), _jsx("div", { style: { flex: 1, padding: '20px', overflowY: 'auto' }, children: loading ? (_jsx("div", { style: { textAlign: 'center', padding: '40px', color: '#94a3b8' }, children: "\u52A0\u8F7D\u4E2D..." })) : filteredTasks.length === 0 ? (_jsx("div", { style: { textAlign: 'center', padding: '60px', color: '#94a3b8' }, children: "\u5F53\u524D\u5206\u7C7B\u4E0B\u65E0\u4EFB\u52A1\u5361\uFF0C\u53EF\u5728\u53F3\u4FA7\u4E3B\u52A9\u7406\u8F93\u5165\u201C\u65B0\u5EFA\u4EFB\u52A1\uFF1A...\u201D\u81EA\u52A8\u751F\u6210" })) : (_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }, children: filteredTasks.map((task) => {
                                        let badgeBg = '#f1f5f9';
                                        let badgeColor = '#475569';
                                        if (task.statusCode === 'done') {
                                            badgeBg = '#dcfce7';
                                            badgeColor = '#15803d';
                                        }
                                        else if (task.statusCode === 'in_progress') {
                                            badgeBg = '#dbeafe';
                                            badgeColor = '#1d4ed8';
                                        }
                                        else if (task.statusCode === 'review') {
                                            badgeBg = '#fef3c7';
                                            badgeColor = '#b45309';
                                        }
                                        else if (task.statusCode === 'blocked') {
                                            badgeBg = '#fee2e2';
                                            badgeColor = '#b91c1c';
                                        }
                                        const matchingRunningItem = controlSnapshot.items.find((i) => i.taskId === task.id);
                                        const matchingUncertainItem = controlSnapshot.items.find((i) => i.taskId === task.id && i.state === 'unknown');
                                        return (_jsxs("div", { draggable: true, onDragStart: (e) => handleDragStart(e, task), style: {
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '10px',
                                                padding: '14px',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                                cursor: 'grab',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'space-between',
                                                minHeight: '130px',
                                            }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }, children: [_jsx("span", { style: {
                                                                        fontSize: '11px',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '4px',
                                                                        background: badgeBg,
                                                                        color: badgeColor,
                                                                        fontWeight: 600,
                                                                    }, children: taskStatusLabel(task.statusCode) }), _jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' })] }), _jsx("div", { style: { fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }, children: task.title }), task.goal && (_jsx("div", { style: { fontSize: '12px', color: '#64748b', lineHeight: 1.4, marginBottom: '8px' }, children: task.goal }))] }), _jsxs("div", { style: {
                                                        borderTop: '1px solid #f8fafc',
                                                        paddingTop: '8px',
                                                        marginTop: '4px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '6px',
                                                    }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: ["\u4F18\u5148\u7EA7: ", taskPriorityLabel(task.priorityCode)] }), task.dependencies.length > 0 && (_jsxs("span", { style: { fontSize: '11px', color: '#ef4444', fontWeight: 500 }, children: ["\u4F9D\u8D56: ", task.dependencies.length, " \u9879"] }))] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' }, children: [_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        setEditingTask(task);
                                                                        setEditTitle(task.title);
                                                                        setEditGoal(task.goal || '');
                                                                        setEditAcceptance(task.acceptance || '');
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #cbd5e1',
                                                                        background: '#f8fafc',
                                                                        color: '#475569',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 500,
                                                                    }, children: "\u7F16\u8F91/\u8865\u5145\u6750\u6599" }), task.statusCode === 'in_progress' ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        if (matchingRunningItem) {
                                                                            handleStop({ kind: 'run', id: matchingRunningItem.runId });
                                                                        }
                                                                        else {
                                                                            handleStop({ kind: 'all' });
                                                                        }
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #ef4444',
                                                                        background: '#fff',
                                                                        color: '#ef4444',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, children: "\u505C\u6B62\u6267\u884C" })) : matchingUncertainItem ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        handleReconcileUncertain(matchingUncertainItem.runId);
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #d97706',
                                                                        background: '#fffbeb',
                                                                        color: '#b45309',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, title: "\u89E3\u9664\u672A\u77E5\u6267\u884C\u4FDD\u62A4\uFF0C\u6062\u590D\u4E3A\u5F85\u529E", children: "\u89E3\u9664\u5F85\u6838\u5BF9" })) : task.statusCode !== 'done' ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        handleStartTaskRun(task.id);
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #3b82f6',
                                                                        background: '#3b82f6',
                                                                        color: '#fff',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, children: "\u63A8\u8FDB\u8BE5\u4EFB\u52A1" })) : null] })] })] }, task.id));
                                    }) })) })] }), _jsxs("div", { style: { width: '420px', display: 'flex', flexDirection: 'column', background: '#ffffff' }, children: [_jsx("div", { style: {
                                    height: '48px',
                                    borderBottom: '1px solid #e2e8f0',
                                    padding: '0 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    background: '#f8fafc',
                                    color: '#334155',
                                }, children: "\u4E3B\u52A9\u7406\u5BF9\u8BDD\u4E0E\u6267\u884C\u534F\u540C" }), _jsx("div", { style: {
                                    flex: 1,
                                    padding: '16px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px',
                                    background: '#f8fafc',
                                }, children: messages.map((m) => {
                                    const isUser = m.sender === 'user';
                                    const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    return (_jsxs("div", { style: {
                                            alignSelf: isUser ? 'flex-end' : 'flex-start',
                                            maxWidth: '88%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: isUser ? 'flex-end' : 'flex-start',
                                        }, children: [_jsx("div", { style: {
                                                    padding: '10px 14px',
                                                    borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                                    fontSize: '13px',
                                                    lineHeight: 1.5,
                                                    background: isUser ? '#2563eb' : '#ffffff',
                                                    color: isUser ? '#ffffff' : '#1e293b',
                                                    border: isUser ? 'none' : '1px solid #e2e8f0',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                                    whiteSpace: 'pre-wrap',
                                                }, children: m.text }), _jsx("span", { style: { fontSize: '10px', color: '#94a3b8', marginTop: '4px' }, children: timeStr })] }, m.id));
                                }) }), _jsxs("div", { onDragOver: (e) => e.preventDefault(), onDrop: handleDrop, style: {
                                    padding: '14px',
                                    borderTop: '1px solid #e2e8f0',
                                    background: '#ffffff',
                                }, children: [_jsx("textarea", { value: inputText, onChange: (e) => setInputText(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }, placeholder: "\u8F93\u5165\u804A\u5929\u5185\u5BB9\u3001\u62D6\u5165\u4EFB\u52A1\u5361\u6216\u952E\u5165 @\u4EFB\u52A1\u5361 \u5E76\u8BF4\u201C\u63A8\u8FDB\u201D...", rows: 3, style: {
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            resize: 'none',
                                            fontSize: '13px',
                                            outline: 'none',
                                            fontFamily: 'inherit',
                                        } }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }, children: [_jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Enter \u53D1\u9001 \u00B7 Shift+Enter \u6362\u884C" }), _jsx("button", { disabled: sending, onClick: handleSend, style: {
                                                    padding: '6px 16px',
                                                    borderRadius: '6px',
                                                    background: sending ? '#94a3b8' : '#2563eb',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: sending ? 'not-allowed' : 'pointer',
                                                }, children: sending ? '处理中...' : '发送指令' })] })] })] })] }), editingTask && (_jsx("div", { style: {
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }, onClick: () => setEditingTask(null), children: _jsxs("div", { style: {
                        width: '560px',
                        maxWidth: '90vw',
                        background: '#ffffff',
                        borderRadius: '12px',
                        padding: '24px',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                    }, onClick: (e) => e.stopPropagation(), children: [_jsx("div", { style: { fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#0f172a' }, children: "\u7F16\u8F91\u4EFB\u52A1\u5361\u4E0E\u8865\u5145\u6750\u6599" }), _jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u4EFB\u52A1\u6807\u9898" }), _jsx("input", { type: "text", value: editTitle, onChange: (e) => setEditTitle(e.target.value), style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' } })] }), _jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u4EFB\u52A1\u76EE\u6807\u4E0E\u4F1A\u8BAE/\u4E1A\u52A1\u6750\u6599\uFF08\u53EF\u76F4\u63A5\u7C98\u8D34\u4F1A\u8BAE\u53D1\u8A00\u3001\u9700\u6C42\u6587\u6863\uFF09" }), _jsx("textarea", { rows: 6, value: editGoal, onChange: (e) => setEditGoal(e.target.value), placeholder: "\u5728\u6B64\u7C98\u8D34\u4F1A\u8BAE\u8BB0\u5F55\u3001\u9700\u6C42\u8981\u70B9\u6216\u539F\u59CB\u6750\u6599...", style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', resize: 'vertical' } })] }), _jsxs("div", { style: { marginBottom: '16px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u9A8C\u6536\u6807\u51C6" }), _jsx("input", { type: "text", value: editAcceptance, onChange: (e) => setEditAcceptance(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5305\u542B\u4F1A\u8BAE\u4E3B\u9898\u3001\u5404\u4EBA\u53D1\u8A00\u8981\u70B9\u3001\u884C\u52A8\u9879\u5F85\u529E\u8868", style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' } })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' }, children: [_jsx("button", { onClick: () => setEditingTask(null), style: { padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '13px' }, children: "\u53D6\u6D88" }), _jsx("button", { onClick: handleSaveTaskEdit, style: { padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#ffffff', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }, children: "\u4FDD\u5B58\u66F4\u65B0" })] })] }) }))] }));
}
// ================= DSH 客户端插件装配 =================
/**
 * 面板级错误边界：任务台自身的渲染异常降级为一张可重试的错误卡，
 * 绝不让异常冒泡炸掉宿主整个 Web 壳（面板只是宿主 UI 的一个插槽）。
 * 导出供面板契约回归测试直接验证 getDerivedStateFromError 行为。
 */
class PanelErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (_jsxs("div", { style: { padding: '24px', color: '#b91c1c', fontSize: '14px', lineHeight: 1.7 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: '8px' }, children: "\u4EFB\u52A1\u53F0\u52A0\u8F7D\u51FA\u73B0\u95EE\u9898" }), _jsx("div", { style: { color: '#64748b', marginBottom: '12px' }, children: String(this.state.error?.message ?? this.state.error) }), _jsx("button", { onClick: () => this.setState({ error: null }), style: { padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }, children: "\u91CD\u8BD5" })] }));
        }
        return this.props.children;
    }
}
const name = 'workbench';
const inject = ['slots', 'layout'];
function apply(ctx) {
    const slots = ctx.slots;
    const layout = ctx.layout;
    const disposers = [];
    // DSH 客户端契约（宿主自带文档）：全局面板入口在 root 作用域的 `sidebar.panellist`
    // 注册图标，同一 id 还必须注册到 root 作用域的 `main` keyed slot 才会渲染；
    // 只注册图标而不注册 main 时，点击会抛“主面板条目不存在”并保留当前面板。
    // 因此这里成对注册：图标只负责 layout.selectPanel，内容由 main 槽承载。
    if (slots && typeof slots.inject === 'function') {
        try {
            const d1 = slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID, label: ENTRY_TITLE }, () => (_jsx(PanelErrorBoundary, { children: _jsx(WorkbenchView, {}) }))));
            if (typeof d1 === 'function')
                disposers.push(d1);
        }
        catch (err) {
            console.warn('[workbench] Failed to register main panel:', err);
        }
        try {
            const d2 = slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: -4, label: ENTRY_TITLE }, () => (_jsx("button", { onClick: () => {
                    if (layout && typeof layout.selectPanel === 'function')
                        layout.selectPanel(PANEL_ID);
                }, style: {
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'currentColor',
                }, title: ENTRY_TITLE, "aria-label": ENTRY_TITLE, children: _jsxs("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", children: [_jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" }), _jsx("line", { x1: "9", y1: "3", x2: "9", y2: "21" }), _jsx("line", { x1: "9", y1: "9", x2: "21", y2: "9" })] }) }))));
            if (typeof d2 === 'function')
                disposers.push(d2);
        }
        catch (err) {
            console.warn('[workbench] Failed to register sidebar.panellist:', err);
        }
    }
    return () => {
        for (const d of disposers)
            d();
    };
}
//# sourceMappingURL=client.js.map
exports.PANEL_ID = PANEL_ID;
exports.ENTRY_TITLE = ENTRY_TITLE;
exports.formatStopFeedback = formatStopFeedback;
exports.taskStatusLabel = taskStatusLabel;
exports.taskPriorityLabel = taskPriorityLabel;
exports.runStateLabel = runStateLabel;
exports.name = name;
exports.inject = inject;
exports.WorkbenchView = WorkbenchView;
exports.apply = apply;
exports.PanelErrorBoundary = PanelErrorBoundary;
      return module.exports;
    }
  });
} else {
  var module = { exports: {} };
  var exports = module.exports;
  const { jsx: _jsx, jsxs: _jsxs, Fragment: _Fragment } = require("react/jsx-runtime");
const React = require("react");
const { useState, useEffect } = React;
const PANEL_ID = 'workbench';
// 侧栏入口名不能与宿主自带的“工作台”重名，否则用户无法区分本插件与宿主面板
const ENTRY_TITLE = '任务台';
/** Kept pure so the packaged desktop control copy can be regression tested. */
const formatStopFeedback = (res) => {
    if (res.status === 'stopped')
        return '已确认目标工作停止；已有成果保留。';
    if (res.status === 'already_terminal')
        return '目标工作已结束。';
    if (res.status === 'waiting_tool_exit' || res.status === 'stopping')
        return '已请求停止，正在等待执行工具退出；尚未确认停止。';
    if (res.status === 'conflict')
        return '无法确认目标已停止，执行结果仍待核对；请勿重复开工。';
    return '停止请求已收到，等待执行端确认。';
};
/** 卡片状态只呈现业务语义，不把内部状态码暴露给用户。 */
const taskStatusLabel = (statusCode) => {
    switch (statusCode) {
        case 'todo':
            return '待办';
        case 'in_progress':
            return '推进中';
        case 'review':
            return '待验收';
        case 'done':
            return '已完成';
        case 'blocked':
            return '已阻塞';
        case 'failed':
            return '未完成';
        case 'cancelled':
            return '已取消';
        default:
            return '未知状态';
    }
};
/** 优先级同样只呈现业务语义。 */
const taskPriorityLabel = (priorityCode) => {
    switch (priorityCode) {
        case 'urgent':
            return '紧急';
        case 'high':
            return '高';
        case 'normal':
            return '普通';
        case 'low':
            return '低';
        default:
            return '普通';
    }
};
/** 运行状态同样只呈现业务语义，不把内部状态码暴露给用户。 */
const runStateLabel = (state) => {
    switch (state) {
        case 'running':
            return '推进中';
        case 'queued':
            return '排队中';
        case 'stopping':
            return '正在停止';
        case 'awaiting_input':
            return '等待输入';
        case 'completed':
            return '已完成';
        case 'interrupted':
            return '已中断';
        case 'failed':
            return '失败';
        case 'unknown':
            return '结果待核对';
        default:
            return '处理中';
    }
};
// ================= API Client =================
async function fetchJson(url, options) {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
}
// ================= 主应用视图 =================
function WorkbenchView({ onClose }) {
    const [projects, setProjects] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [inputText, setInputText] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [controlSnapshot, setControlSnapshot] = useState({
        activeCount: 0,
        queuedCount: 0,
        awaitingCount: 0,
        items: [],
    });
    const [actionFeedback, setActionFeedback] = useState(null);
    const [sending, setSending] = useState(false);
    const [connection, setConnection] = useState(null);
    const [pendingInteractions, setPendingInteractions] = useState([]);
    const [questionAnswers, setQuestionAnswers] = useState({});
    useEffect(() => {
        let active = true;
        const poll = async () => {
            try {
                const identity = await fetchJson('/api/workbench/connection');
                if (active)
                    setConnection(identity);
                const result = await fetchJson('/api/workbench/interactions');
                if (active)
                    setPendingInteractions(result.pending);
            }
            catch {
                if (active)
                    setPendingInteractions([]);
            }
        };
        void poll();
        const timer = setInterval(poll, 1500);
        return () => { active = false; clearInterval(timer); };
    }, []);
    const respondInteraction = async (item, action) => {
        try {
            const answers = item.questions?.map((q) => {
                const value = (questionAnswers[item.id + q.id] || '').trim();
                const selected = q.options?.some((o) => o.label === value) ? [value] : [];
                return { id: q.id, selected, ...(selected.length ? {} : { custom: value }) };
            });
            await fetchJson('/api/workbench/interactions/respond', { method: 'POST', body: JSON.stringify({ id: item.id, sessionId: item.sessionId, turnId: item.turnId, action, answers }) });
            setPendingInteractions(items => items.filter(p => p.id !== item.id));
            setActionFeedback('已答复原请求，后台继续推进。');
        }
        catch (error) {
            setActionFeedback(error.message);
        }
    };
    const abandonHost = async () => {
        try {
            const state = await fetchJson('/api/workbench/control/uncertain');
            if (state.host?.status !== 'unknown') {
                setActionFeedback('请先核验当前状态；未解除保护。');
                return;
            }
            if (!window.confirm('仅在你已确认原宿主进程或会话退出时继续。解除保护不会停止仍在运行的工具，也不会撤销已有成果；误确认可能导致重复执行。'))
                return;
            await fetchJson('/api/workbench/control/abandon', { method: 'POST', body: JSON.stringify({ expectedRequestId: state.host.requestId, confirmed: true, reason: '用户明确确认原宿主已退出，放弃该未知轮次' }) });
            setActionFeedback('已放弃旧轮次；没有宣称已验证停止，下次使用新会话。');
            await loadControlSnapshot();
        }
        catch (error) {
            setActionFeedback(error.message);
        }
    };
    // 任务编辑与材料补充模态框状态
    const [editingTask, setEditingTask] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [editGoal, setEditGoal] = useState('');
    const [editAcceptance, setEditAcceptance] = useState('');
    // 默认主助理欢迎词
    const defaultWelcomeMessage = {
        id: 'welcome',
        sender: 'assistant',
        text: '你好！我是工作台主助理。\n• 你可以在这里和我持续对话、梳理并拆解新任务\n• 也可以将左侧任务卡拖入下方输入框，或用 @ 选择任务卡后说“推进这些”\n• 后台 worker 会在独立项目根执行，成果与审批将在这里集中呈现。\n• 顶部设有常驻控制条，独立于对话，可随时一键中止运行中的后台任务。',
        createdAt: new Date().toISOString(),
    };
    const [messages, setMessages] = useState([defaultWelcomeMessage]);
    // 1. 加载项目和任务卡
    const loadData = async () => {
        try {
            const [pList, tList] = await Promise.all([
                fetchJson('/api/workbench/projects').catch(() => []),
                fetchJson('/api/workbench/tasks').catch(() => []),
            ]);
            setProjects(pList);
            setTasks(tList);
            if (!selectedProjectId && pList.length > 0) {
                setSelectedProjectId(pList[0].id);
            }
        }
        catch (err) {
            console.error('[Workbench] Load data error:', err);
        }
        finally {
            setLoading(false);
        }
    };
    // 2. 加载控制快照 (独立控制路径)
    const loadControlSnapshot = async () => {
        try {
            const snapshot = await fetchJson('/api/workbench/control/snapshot');
            setControlSnapshot(snapshot);
        }
        catch (err) {
            // 忽略短暂网络闪断
        }
    };
    // 3. 加载历史聊天记录
    const loadChatMessages = async () => {
        try {
            const chatList = await fetchJson('/api/workbench/chat/messages').catch(() => []);
            if (chatList && chatList.length > 0) {
                setMessages(chatList);
            }
        }
        catch (err) {
            // 忽略读取聊天失败
        }
    };
    useEffect(() => {
        loadData();
        loadControlSnapshot();
        loadChatMessages();
        // 轮询 Outbox 事件与控制快照保持实时同步
        let seq = 0;
        const interval = setInterval(async () => {
            try {
                const events = await fetchJson(`/api/workbench/events?after=${seq}`).catch(() => []);
                if (events && events.length > 0) {
                    seq = events[events.length - 1].sequence;
                    loadData();
                    loadChatMessages();
                }
                await loadControlSnapshot();
            }
            catch {
                // ignore
            }
        }, 1500);
        return () => clearInterval(interval);
    }, []);
    // 触发全局或单项停止
    const handleStop = async (target) => {
        try {
            setActionFeedback(`正在向控制路径投递停止指令 (${target.kind}${target.id ? ':' + target.id : ''})...`);
            const res = await fetchJson('/api/workbench/control/stop', {
                method: 'POST',
                body: JSON.stringify({ target }),
            });
            setActionFeedback(formatStopFeedback(res));
            await loadControlSnapshot();
            await loadData();
            await loadChatMessages();
            setTimeout(() => setActionFeedback(null), 4000);
        }
        catch (err) {
            setActionFeedback(`停止失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 单卡快速推进
    const handleStartTaskRun = async (taskId) => {
        try {
            setActionFeedback(`正在推进任务 ${taskId.slice(0, 8)}...`);
            await fetchJson('/api/workbench/runs/start', {
                method: 'POST',
                body: JSON.stringify({ taskId, clientRequestId: `cli-${Date.now()}-${taskId}` }),
            });
            setActionFeedback(`任务 ${taskId.slice(0, 8)} 调度成功`);
            await loadControlSnapshot();
            await loadData();
            setTimeout(() => setActionFeedback(null), 3000);
        }
        catch (err) {
            setActionFeedback(`启动推进失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 核对并解除未知状态（T-012）
    const handleReconcileUncertain = async (targetRunId) => {
        try {
            setActionFeedback('正在向控制路径核对未决状态...');
            if (targetRunId) {
                await fetchJson('/api/workbench/control/reconcile', {
                    method: 'POST',
                    body: JSON.stringify({
                        runId: targetRunId,
                        resolution: { state: 'interrupted', summary: '用户在界面确认前序执行已退出，解除保护并重置为待办' },
                    }),
                });
                setActionFeedback('已核实并解除该任务的未知状态');
            }
            else {
                const autoRes = await fetchJson('/api/workbench/control/reconcile', {
                    method: 'POST',
                    body: JSON.stringify({ auto: true }),
                });
                if (autoRes.reconciled && autoRes.reconciled.length > 0) {
                    setActionFeedback(`已由宿主核实并解除 ${autoRes.reconciled.length} 项未决执行`);
                }
                else {
                    const uncertData = await fetchJson('/api/workbench/control/uncertain');
                    let resolved = 0;
                    if (uncertData.runs) {
                        for (const r of uncertData.runs) {
                            await fetchJson('/api/workbench/control/reconcile', {
                                method: 'POST',
                                body: JSON.stringify({
                                    runId: r.id,
                                    resolution: { state: 'interrupted', summary: '经操作员核实：确认前序 Worker 已退出，解除保护并重置为待办' },
                                }),
                            });
                            resolved++;
                        }
                    }
                    if (uncertData.queue) {
                        for (const q of uncertData.queue) {
                            await fetchJson('/api/workbench/control/reconcile', {
                                method: 'POST',
                                body: JSON.stringify({ queueId: q.id, action: 'cancel' }),
                            });
                            resolved++;
                        }
                    }
                    setActionFeedback(`已核对并解除 ${resolved} 项未知状态，项目保护已恢复正常`);
                }
            }
            await loadControlSnapshot();
            await loadData();
            setTimeout(() => setActionFeedback(null), 4000);
        }
        catch (err) {
            setActionFeedback(`核对失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 保存任务编辑与补充的材料
    const handleSaveTaskEdit = async () => {
        if (!editingTask)
            return;
        try {
            setActionFeedback(`正在更新任务 [${editingTask.title}]...`);
            await fetchJson('/api/workbench/tasks/update', {
                method: 'POST',
                body: JSON.stringify({
                    id: editingTask.id,
                    expectedRevision: editingTask.revision,
                    title: editTitle,
                    goal: editGoal,
                    acceptance: editAcceptance,
                }),
            });
            setActionFeedback('任务已成功更新');
            setEditingTask(null);
            await loadData();
            setTimeout(() => setActionFeedback(null), 3000);
        }
        catch (err) {
            setActionFeedback(`更新失败: ${err.message}`);
            setTimeout(() => setActionFeedback(null), 4000);
        }
    };
    // 发送主助理消息（通过服务端真实端点）
    const handleSend = async () => {
        if (!inputText.trim() || sending)
            return;
        const text = inputText.trim();
        setInputText('');
        setSending(true);
        // 乐观添加用户消息
        const userMsg = {
            id: `temp-${Date.now()}`,
            sender: 'user',
            text,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        try {
            const res = await fetchJson('/api/workbench/chat/send', {
                method: 'POST',
                body: JSON.stringify({ text, projectId: selectedProjectId }),
            });
            if (res && res.reply) {
                setMessages((prev) => [...prev, res.reply]);
            }
            await loadControlSnapshot();
            await loadData();
        }
        catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    id: `err-${Date.now()}`,
                    sender: 'assistant',
                    text: `[错误] 通信异常：${err.message}`,
                    createdAt: new Date().toISOString(),
                },
            ]);
        }
        finally {
            setSending(false);
        }
    };
    // 拖卡处理
    const handleDragStart = (e, task) => {
        e.dataTransfer.setData('text/plain', `@task:${task.id}[${task.title}]`);
    };
    const handleDrop = (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('text/plain');
        if (data) {
            setInputText((prev) => (prev ? `${prev} ${data}` : data));
        }
    };
    const currentProject = projects.find((p) => p.id === selectedProjectId);
    const filteredTasks = tasks
        .filter((t) => !selectedProjectId || t.projectId === selectedProjectId)
        .filter((t) => (activeTab === 'all' ? true : t.statusCode === activeTab));
    const awaitingCount = controlSnapshot.awaitingCount ?? 0;
    const unknownCount = controlSnapshot.unknownCount ?? controlSnapshot.items.filter(item => item.state === 'unknown').length;
    const isWorking = controlSnapshot.activeCount > 0 || controlSnapshot.queuedCount > 0 || awaitingCount > 0 || unknownCount > 0;
    return (_jsxs("div", { style: {
            // 作为 DSH 主面板渲染时铺满面板容器；不再用 fixed 覆盖层，避免遮挡宿主自身界面
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
            color: '#1e293b',
            overflow: 'hidden',
        }, children: [_jsxs("div", { style: {
                    height: '52px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 20px',
                    background: '#f8fafc',
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx("span", { style: { fontSize: '16px', fontWeight: 700, color: '#0f172a' }, children: "DSH Table \u5DE5\u4F5C\u53F0" }), _jsx("span", { style: {
                                            fontSize: '11px',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            background: '#dcfce7',
                                            color: '#15803d',
                                            fontWeight: 600,
                                        }, children: connection?.mode === 'client' ? connection.ready ? `Windows · ${connection.profile || '远程'} · ${String(connection.hostId || '').slice(0, 8)}` : '请先连接 Windows' : connection?.mode === 'host' ? 'Windows Host 权威' : '正在核验执行端' })] }), currentProject && (_jsxs("span", { style: { fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }, children: ["\u7269\u7406\u6839: ", currentProject.rootPath] }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [_jsx("button", { onClick: () => {
                                    loadData();
                                    loadControlSnapshot();
                                    loadChatMessages();
                                }, style: {
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    color: '#475569',
                                }, children: "\u5237\u65B0\u6570\u636E" }), onClose && (_jsx("button", { onClick: onClose, style: {
                                    padding: '6px 14px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: '#e2e8f0',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    color: '#334155',
                                }, children: "\u8FD4\u56DE\u5BF9\u8BDD" }))] })] }), _jsxs("div", { style: {
                    padding: '8px 20px',
                    background: isWorking ? '#fff7ed' : '#f8fafc',
                    borderBottom: '1px solid #fed7aa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    transition: 'background 0.2s ease',
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '16px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px' }, children: [_jsx("span", { style: {
                                            display: 'inline-block',
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            background: isWorking ? '#f97316' : '#22c55e',
                                            boxShadow: isWorking ? '0 0 6px #f97316' : 'none',
                                        } }), _jsx("span", { style: { fontWeight: 600, color: isWorking ? '#9a3412' : '#15803d' }, children: unknownCount > 0 ? '有工作等待核对' : awaitingCount > 0 ? '等待你的回复' : isWorking ? '工作推进中' : '执行控制就绪' })] }), _jsxs("span", { style: { color: '#475569' }, children: ["\u8FD0\u884C\u4E2D: ", _jsx("strong", { children: controlSnapshot.activeCount }), " \u9879 \u00B7 \u6392\u961F\u4E2D: ", _jsx("strong", { children: controlSnapshot.queuedCount }), " \u9879", awaitingCount > 0 && _jsxs(_Fragment, { children: [" \u00B7 \u5F85\u56DE\u590D: ", _jsx("strong", { children: awaitingCount }), " \u9879"] }), unknownCount > 0 && _jsxs(_Fragment, { children: [" \u00B7 \u5F85\u6838\u5BF9: ", _jsx("strong", { children: unknownCount }), " \u9879"] })] }), controlSnapshot.items.length > 0 && (_jsx("div", { style: { display: 'flex', gap: '6px', alignItems: 'center' }, children: controlSnapshot.items.slice(0, 2).map((item) => (_jsxs("span", { style: {
                                        fontSize: '11px',
                                        background: '#ffedd5',
                                        color: '#c2410c',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                    }, children: [item.taskTitle ? item.taskTitle.slice(0, 14) : item.taskId.slice(0, 8), " (", runStateLabel(item.state), ")"] }, item.runId))) })), actionFeedback && (_jsx("span", { style: { color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }, children: actionFeedback }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [unknownCount > 0 && (_jsxs("button", { onClick: () => handleReconcileUncertain(), style: {
                                    padding: '4px 10px',
                                    borderRadius: '5px',
                                    border: '1px solid #d97706',
                                    background: '#fffbeb',
                                    color: '#b45309',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }, title: "\u81EA\u52A8\u5411\u5BBF\u4E3B\u6216\u64CD\u4F5C\u5458\u6838\u9A8C\u5E76\u89E3\u9664\u5F85\u6838\u5BF9\u6267\u884C", children: ["\u6838\u9A8C\u5F85\u6838\u5BF9 (", unknownCount, ")"] })), controlSnapshot.items.some(item => item.taskId === 'main-assistant' && item.state === 'unknown') && (_jsx("button", { onClick: abandonHost, children: "\u786E\u8BA4\u539F\u5BBF\u4E3B\u5DF2\u9000\u51FA" })), controlSnapshot.activeCount > 0 && (_jsx("button", { onClick: () => handleStop({ kind: 'run', id: controlSnapshot.items[0]?.runId }), style: {
                                    padding: '4px 10px',
                                    borderRadius: '5px',
                                    border: '1px solid #f97316',
                                    background: '#ffffff',
                                    color: '#c2410c',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }, children: "\u505C\u6B62\u5F53\u524D\u4EFB\u52A1" })), _jsx("button", { onClick: () => handleStop({ kind: 'all' }), style: {
                                    padding: '4px 12px',
                                    borderRadius: '5px',
                                    border: 'none',
                                    background: '#ef4444',
                                    color: '#ffffff',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(239, 68, 68, 0.2)',
                                }, children: "\u505C\u6B62\u5168\u90E8\u5DE5\u4F5C" })] })] }), pendingInteractions.map(item => (_jsxs("div", { style: { padding: '12px 20px', background: '#fffbeb', borderBottom: '1px solid #fbbf24' }, children: [_jsx("strong", { children: item.title }), item.kind === 'approval' ? _jsxs("span", { children: [_jsx("button", { onClick: () => respondInteraction(item, 'approve'), children: "\u6279\u51C6\u672C\u6B21" }), _jsx("button", { onClick: () => respondInteraction(item, 'reject'), children: "\u62D2\u7EDD" })] }) : _jsxs("div", { children: [item.questions.map((q) => _jsxs("label", { style: { display: 'block', marginTop: '8px' }, children: [q.question || q.header || q.id, q.detail && _jsx("pre", { style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }, children: q.detail }), q.options?.map((o) => _jsx("button", { onClick: () => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: o.label })), children: o.label }, o.label)), _jsx("input", { placeholder: "\u9009\u62E9\u4E0A\u65B9\u9009\u9879\uFF0C\u6216\u8865\u5145\u56DE\u7B54", value: questionAnswers[item.id + q.id] || '', onChange: e => setQuestionAnswers(values => ({ ...values, [item.id + q.id]: e.target.value })) })] }, q.id)), _jsx("button", { onClick: () => respondInteraction(item), children: "\u63D0\u4EA4\u8FD9\u7EC4\u56DE\u7B54" })] })] }, item.id))), _jsxs("div", { style: { flex: 1, display: 'flex', overflow: 'hidden' }, children: [_jsxs("div", { style: { width: '220px', borderRight: '1px solid #e2e8f0', background: '#f8fafc', padding: '16px', overflowY: 'auto' }, children: [_jsxs("div", { style: { fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '10px', textTransform: 'uppercase' }, children: ["\u5173\u8054\u9879\u76EE (", projects.length, ")"] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: projects.map((p) => {
                                    const pTasks = tasks.filter((t) => t.projectId === p.id);
                                    const isSelected = selectedProjectId === p.id;
                                    return (_jsxs("button", { onClick: () => setSelectedProjectId(p.id), style: {
                                            textAlign: 'left',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: isSelected ? '#3b82f6' : 'transparent',
                                            color: isSelected ? '#ffffff' : '#334155',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '2px',
                                            transition: 'all 0.15s ease',
                                        }, children: [_jsx("span", { style: { fontSize: '13px', fontWeight: isSelected ? 600 : 500 }, children: p.title }), _jsxs("span", { style: { fontSize: '11px', color: isSelected ? '#e0f2fe' : '#94a3b8' }, children: [pTasks.length, " \u9879\u4EFB\u52A1"] })] }, p.id));
                                }) })] }), _jsxs("div", { style: { flex: 1, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#f1f5f9' }, children: [_jsxs("div", { style: {
                                    padding: '12px 20px',
                                    background: '#ffffff',
                                    borderBottom: '1px solid #e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }, children: [_jsx("div", { style: { display: 'flex', gap: '6px' }, children: ['all', 'todo', 'in_progress', 'review', 'done'].map((tab) => (_jsxs("button", { onClick: () => setActiveTab(tab), style: {
                                                padding: '4px 12px',
                                                borderRadius: '16px',
                                                border: 'none',
                                                background: activeTab === tab ? '#0f172a' : '#f1f5f9',
                                                color: activeTab === tab ? '#ffffff' : '#64748b',
                                                fontSize: '12px',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                            }, children: [tab === 'all' && '全部', tab === 'todo' && '待办', tab === 'in_progress' && '推进中', tab === 'review' && '待验收', tab === 'done' && '已完成'] }, tab))) }), _jsx("span", { style: { fontSize: '12px', color: '#94a3b8' }, children: "\u63D0\u793A: \u53EF\u76F4\u63A5\u62D6\u62FD\u5361\u7247\u5230\u53F3\u4FA7\u8F93\u5165\u6846\u5F15\u7528" })] }), _jsx("div", { style: { flex: 1, padding: '20px', overflowY: 'auto' }, children: loading ? (_jsx("div", { style: { textAlign: 'center', padding: '40px', color: '#94a3b8' }, children: "\u52A0\u8F7D\u4E2D..." })) : filteredTasks.length === 0 ? (_jsx("div", { style: { textAlign: 'center', padding: '60px', color: '#94a3b8' }, children: "\u5F53\u524D\u5206\u7C7B\u4E0B\u65E0\u4EFB\u52A1\u5361\uFF0C\u53EF\u5728\u53F3\u4FA7\u4E3B\u52A9\u7406\u8F93\u5165\u201C\u65B0\u5EFA\u4EFB\u52A1\uFF1A...\u201D\u81EA\u52A8\u751F\u6210" })) : (_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }, children: filteredTasks.map((task) => {
                                        let badgeBg = '#f1f5f9';
                                        let badgeColor = '#475569';
                                        if (task.statusCode === 'done') {
                                            badgeBg = '#dcfce7';
                                            badgeColor = '#15803d';
                                        }
                                        else if (task.statusCode === 'in_progress') {
                                            badgeBg = '#dbeafe';
                                            badgeColor = '#1d4ed8';
                                        }
                                        else if (task.statusCode === 'review') {
                                            badgeBg = '#fef3c7';
                                            badgeColor = '#b45309';
                                        }
                                        else if (task.statusCode === 'blocked') {
                                            badgeBg = '#fee2e2';
                                            badgeColor = '#b91c1c';
                                        }
                                        const matchingRunningItem = controlSnapshot.items.find((i) => i.taskId === task.id);
                                        const matchingUncertainItem = controlSnapshot.items.find((i) => i.taskId === task.id && i.state === 'unknown');
                                        return (_jsxs("div", { draggable: true, onDragStart: (e) => handleDragStart(e, task), style: {
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '10px',
                                                padding: '14px',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                                cursor: 'grab',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'space-between',
                                                minHeight: '130px',
                                            }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }, children: [_jsx("span", { style: {
                                                                        fontSize: '11px',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '4px',
                                                                        background: badgeBg,
                                                                        color: badgeColor,
                                                                        fontWeight: 600,
                                                                    }, children: taskStatusLabel(task.statusCode) }), _jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' })] }), _jsx("div", { style: { fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }, children: task.title }), task.goal && (_jsx("div", { style: { fontSize: '12px', color: '#64748b', lineHeight: 1.4, marginBottom: '8px' }, children: task.goal }))] }), _jsxs("div", { style: {
                                                        borderTop: '1px solid #f8fafc',
                                                        paddingTop: '8px',
                                                        marginTop: '4px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '6px',
                                                    }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: ["\u4F18\u5148\u7EA7: ", taskPriorityLabel(task.priorityCode)] }), task.dependencies.length > 0 && (_jsxs("span", { style: { fontSize: '11px', color: '#ef4444', fontWeight: 500 }, children: ["\u4F9D\u8D56: ", task.dependencies.length, " \u9879"] }))] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' }, children: [_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        setEditingTask(task);
                                                                        setEditTitle(task.title);
                                                                        setEditGoal(task.goal || '');
                                                                        setEditAcceptance(task.acceptance || '');
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #cbd5e1',
                                                                        background: '#f8fafc',
                                                                        color: '#475569',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 500,
                                                                    }, children: "\u7F16\u8F91/\u8865\u5145\u6750\u6599" }), task.statusCode === 'in_progress' ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        if (matchingRunningItem) {
                                                                            handleStop({ kind: 'run', id: matchingRunningItem.runId });
                                                                        }
                                                                        else {
                                                                            handleStop({ kind: 'all' });
                                                                        }
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #ef4444',
                                                                        background: '#fff',
                                                                        color: '#ef4444',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, children: "\u505C\u6B62\u6267\u884C" })) : matchingUncertainItem ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        handleReconcileUncertain(matchingUncertainItem.runId);
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #d97706',
                                                                        background: '#fffbeb',
                                                                        color: '#b45309',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, title: "\u89E3\u9664\u672A\u77E5\u6267\u884C\u4FDD\u62A4\uFF0C\u6062\u590D\u4E3A\u5F85\u529E", children: "\u89E3\u9664\u5F85\u6838\u5BF9" })) : task.statusCode !== 'done' ? (_jsx("button", { onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        handleStartTaskRun(task.id);
                                                                    }, style: {
                                                                        padding: '3px 8px',
                                                                        fontSize: '11px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #3b82f6',
                                                                        background: '#3b82f6',
                                                                        color: '#fff',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 600,
                                                                    }, children: "\u63A8\u8FDB\u8BE5\u4EFB\u52A1" })) : null] })] })] }, task.id));
                                    }) })) })] }), _jsxs("div", { style: { width: '420px', display: 'flex', flexDirection: 'column', background: '#ffffff' }, children: [_jsx("div", { style: {
                                    height: '48px',
                                    borderBottom: '1px solid #e2e8f0',
                                    padding: '0 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    background: '#f8fafc',
                                    color: '#334155',
                                }, children: "\u4E3B\u52A9\u7406\u5BF9\u8BDD\u4E0E\u6267\u884C\u534F\u540C" }), _jsx("div", { style: {
                                    flex: 1,
                                    padding: '16px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px',
                                    background: '#f8fafc',
                                }, children: messages.map((m) => {
                                    const isUser = m.sender === 'user';
                                    const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    return (_jsxs("div", { style: {
                                            alignSelf: isUser ? 'flex-end' : 'flex-start',
                                            maxWidth: '88%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: isUser ? 'flex-end' : 'flex-start',
                                        }, children: [_jsx("div", { style: {
                                                    padding: '10px 14px',
                                                    borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                                    fontSize: '13px',
                                                    lineHeight: 1.5,
                                                    background: isUser ? '#2563eb' : '#ffffff',
                                                    color: isUser ? '#ffffff' : '#1e293b',
                                                    border: isUser ? 'none' : '1px solid #e2e8f0',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                                    whiteSpace: 'pre-wrap',
                                                }, children: m.text }), _jsx("span", { style: { fontSize: '10px', color: '#94a3b8', marginTop: '4px' }, children: timeStr })] }, m.id));
                                }) }), _jsxs("div", { onDragOver: (e) => e.preventDefault(), onDrop: handleDrop, style: {
                                    padding: '14px',
                                    borderTop: '1px solid #e2e8f0',
                                    background: '#ffffff',
                                }, children: [_jsx("textarea", { value: inputText, onChange: (e) => setInputText(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }, placeholder: "\u8F93\u5165\u804A\u5929\u5185\u5BB9\u3001\u62D6\u5165\u4EFB\u52A1\u5361\u6216\u952E\u5165 @\u4EFB\u52A1\u5361 \u5E76\u8BF4\u201C\u63A8\u8FDB\u201D...", rows: 3, style: {
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            resize: 'none',
                                            fontSize: '13px',
                                            outline: 'none',
                                            fontFamily: 'inherit',
                                        } }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }, children: [_jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Enter \u53D1\u9001 \u00B7 Shift+Enter \u6362\u884C" }), _jsx("button", { disabled: sending, onClick: handleSend, style: {
                                                    padding: '6px 16px',
                                                    borderRadius: '6px',
                                                    background: sending ? '#94a3b8' : '#2563eb',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: sending ? 'not-allowed' : 'pointer',
                                                }, children: sending ? '处理中...' : '发送指令' })] })] })] })] }), editingTask && (_jsx("div", { style: {
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }, onClick: () => setEditingTask(null), children: _jsxs("div", { style: {
                        width: '560px',
                        maxWidth: '90vw',
                        background: '#ffffff',
                        borderRadius: '12px',
                        padding: '24px',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                    }, onClick: (e) => e.stopPropagation(), children: [_jsx("div", { style: { fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#0f172a' }, children: "\u7F16\u8F91\u4EFB\u52A1\u5361\u4E0E\u8865\u5145\u6750\u6599" }), _jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u4EFB\u52A1\u6807\u9898" }), _jsx("input", { type: "text", value: editTitle, onChange: (e) => setEditTitle(e.target.value), style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' } })] }), _jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u4EFB\u52A1\u76EE\u6807\u4E0E\u4F1A\u8BAE/\u4E1A\u52A1\u6750\u6599\uFF08\u53EF\u76F4\u63A5\u7C98\u8D34\u4F1A\u8BAE\u53D1\u8A00\u3001\u9700\u6C42\u6587\u6863\uFF09" }), _jsx("textarea", { rows: 6, value: editGoal, onChange: (e) => setEditGoal(e.target.value), placeholder: "\u5728\u6B64\u7C98\u8D34\u4F1A\u8BAE\u8BB0\u5F55\u3001\u9700\u6C42\u8981\u70B9\u6216\u539F\u59CB\u6750\u6599...", style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', resize: 'vertical' } })] }), _jsxs("div", { style: { marginBottom: '16px' }, children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }, children: "\u9A8C\u6536\u6807\u51C6" }), _jsx("input", { type: "text", value: editAcceptance, onChange: (e) => setEditAcceptance(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5305\u542B\u4F1A\u8BAE\u4E3B\u9898\u3001\u5404\u4EBA\u53D1\u8A00\u8981\u70B9\u3001\u884C\u52A8\u9879\u5F85\u529E\u8868", style: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' } })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' }, children: [_jsx("button", { onClick: () => setEditingTask(null), style: { padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '13px' }, children: "\u53D6\u6D88" }), _jsx("button", { onClick: handleSaveTaskEdit, style: { padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#ffffff', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }, children: "\u4FDD\u5B58\u66F4\u65B0" })] })] }) }))] }));
}
// ================= DSH 客户端插件装配 =================
/**
 * 面板级错误边界：任务台自身的渲染异常降级为一张可重试的错误卡，
 * 绝不让异常冒泡炸掉宿主整个 Web 壳（面板只是宿主 UI 的一个插槽）。
 * 导出供面板契约回归测试直接验证 getDerivedStateFromError 行为。
 */
class PanelErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (_jsxs("div", { style: { padding: '24px', color: '#b91c1c', fontSize: '14px', lineHeight: 1.7 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: '8px' }, children: "\u4EFB\u52A1\u53F0\u52A0\u8F7D\u51FA\u73B0\u95EE\u9898" }), _jsx("div", { style: { color: '#64748b', marginBottom: '12px' }, children: String(this.state.error?.message ?? this.state.error) }), _jsx("button", { onClick: () => this.setState({ error: null }), style: { padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }, children: "\u91CD\u8BD5" })] }));
        }
        return this.props.children;
    }
}
const name = 'workbench';
const inject = ['slots', 'layout'];
function apply(ctx) {
    const slots = ctx.slots;
    const layout = ctx.layout;
    const disposers = [];
    // DSH 客户端契约（宿主自带文档）：全局面板入口在 root 作用域的 `sidebar.panellist`
    // 注册图标，同一 id 还必须注册到 root 作用域的 `main` keyed slot 才会渲染；
    // 只注册图标而不注册 main 时，点击会抛“主面板条目不存在”并保留当前面板。
    // 因此这里成对注册：图标只负责 layout.selectPanel，内容由 main 槽承载。
    if (slots && typeof slots.inject === 'function') {
        try {
            const d1 = slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID, label: ENTRY_TITLE }, () => (_jsx(PanelErrorBoundary, { children: _jsx(WorkbenchView, {}) }))));
            if (typeof d1 === 'function')
                disposers.push(d1);
        }
        catch (err) {
            console.warn('[workbench] Failed to register main panel:', err);
        }
        try {
            const d2 = slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: -4, label: ENTRY_TITLE }, () => (_jsx("button", { onClick: () => {
                    if (layout && typeof layout.selectPanel === 'function')
                        layout.selectPanel(PANEL_ID);
                }, style: {
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'currentColor',
                }, title: ENTRY_TITLE, "aria-label": ENTRY_TITLE, children: _jsxs("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", children: [_jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" }), _jsx("line", { x1: "9", y1: "3", x2: "9", y2: "21" }), _jsx("line", { x1: "9", y1: "9", x2: "21", y2: "9" })] }) }))));
            if (typeof d2 === 'function')
                disposers.push(d2);
        }
        catch (err) {
            console.warn('[workbench] Failed to register sidebar.panellist:', err);
        }
    }
    return () => {
        for (const d of disposers)
            d();
    };
}
//# sourceMappingURL=client.js.map
exports.PANEL_ID = PANEL_ID;
exports.ENTRY_TITLE = ENTRY_TITLE;
exports.formatStopFeedback = formatStopFeedback;
exports.taskStatusLabel = taskStatusLabel;
exports.taskPriorityLabel = taskPriorityLabel;
exports.runStateLabel = runStateLabel;
exports.name = name;
exports.inject = inject;
exports.WorkbenchView = WorkbenchView;
exports.apply = apply;
exports.PanelErrorBoundary = PanelErrorBoundary;
}

import { useEffect, useMemo, useState } from 'react';
import {
    CalendarDays,
    CalendarRange,
    BadgeCheck,
    CircleAlert,
    Clock3,
    KeyRound,
    LoaderCircle,
    Plus,
    Radar,
    Save,
    Send,
    ShieldCheck,
    Sparkles,
    Trash2,
    UserRound,
} from 'lucide-react';

// 前端总控页面：
// 负责多 OpenID 管理、手动签到、OpenID 抓取和定时任务配置。
const initialSummary = {
    loginSuccess: false,
    withinTimeWindow: null,
    signStatus: null,
    signedSuccess: false,
    alreadySigned: false,
    account: null,
    task: null,
    error: null,
    startedAt: null,
    completedAt: null,
};

const initialCaptureSummary = {
    startedAt: null,
    completedAt: null,
    openid: null,
    saved: false,
    matchedUrl: null,
    error: null,
};

const initialDebuggerStatus = {
    installed: false,
    dependenciesInstalled: false,
    running: false,
    wsUrl: '',
    repoDir: '',
    logPath: '',
};

const initialSchedule = {
    enabled: false,
    mode: 'daily',
    time: '21:05',
    dates: [],
    timezone: 'Asia/Shanghai',
    lastAttemptDate: null,
    lastAttemptAt: null,
    lastResult: null,
    lastMessage: null,
    nextRunAt: null,
};

const initialScheduleMeta = {
    taskInstalled: false,
    taskName: '',
    commandPath: '',
};

function formatClock(value) {
    return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(value);
}

function formatDateTime(value) {
    if (!value) {
        return '未开始';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(value));
}

function createLog(message, tone = 'neutral') {
    return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message,
        tone,
        time: formatClock(new Date()),
    };
}

function formatDateTimeVerbose(value) {
    if (!value) {
        return '未设置';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function statusTone(summary) {
    if (summary.error) {
        return 'error';
    }

    if (summary.signedSuccess || summary.alreadySigned) {
        return 'success';
    }

    if (summary.withinTimeWindow === false) {
        return 'warning';
    }

    return 'neutral';
}

function captureTone(summary) {
    if (summary.error) {
        return 'error';
    }

    if (summary.openid) {
        return 'success';
    }

    return 'neutral';
}

function parseOpenIds(value) {
    return Array.from(
        new Set(
            (Array.isArray(value) ? value : String(value ?? '').split(','))
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    );
}

function joinOpenIds(openids) {
    return parseOpenIds(openids).join(',');
}

export default function App() {
    const [clock, setClock] = useState(() => new Date());
    const [openidInput, setOpenidInput] = useState('');
    const [openidList, setOpenidList] = useState([]);
    const [savedOpenidList, setSavedOpenidList] = useState([]);
    const [debuggerWsUrl, setDebuggerWsUrl] = useState('');
    const [logs, setLogs] = useState([
        createLog('页面已就绪，先准备 OpenID，再发起签到。'),
    ]);
    const [summary, setSummary] = useState(initialSummary);
    const [captureSummary, setCaptureSummary] = useState(initialCaptureSummary);
    const [debuggerStatus, setDebuggerStatus] = useState(initialDebuggerStatus);
    const [schedule, setSchedule] = useState(initialSchedule);
    const [scheduleMeta, setScheduleMeta] = useState(initialScheduleMeta);
    const [scheduleDateInput, setScheduleDateInput] = useState('');
    const [captureStatus, setCaptureStatus] = useState('准备好后，点一次按钮即可自动准备抓取环境。');
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingSchedule, setIsSavingSchedule] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [inlineError, setInlineError] = useState('');
    const [serverReady, setServerReady] = useState(false);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClock(new Date());
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function loadInitialData() {
            try {
                const [configResponse, debuggerResponse, scheduleResponse] = await Promise.all([
                    fetch('/api/config'),
                    fetch('/api/debugger/status'),
                    fetch('/api/schedule'),
                ]);
                const config = await configResponse.json();
                const debuggerData = await debuggerResponse.json();
                const scheduleData = await scheduleResponse.json();

                if (!cancelled) {
                    const nextOpenids = parseOpenIds(config.openids ?? config.openid ?? '');
                    setOpenidList(nextOpenids);
                    setSavedOpenidList(nextOpenids);
                    setDebuggerWsUrl(config.debuggerWsUrl ?? '');
                    setDebuggerStatus(debuggerData);
                    setSchedule(scheduleData.config ?? initialSchedule);
                    setScheduleMeta({
                        taskInstalled: scheduleData.taskInstalled ?? false,
                        taskName: scheduleData.taskName ?? '',
                        commandPath: scheduleData.commandPath ?? '',
                    });
                    setServerReady(true);
                }
            }
            catch (error) {
                if (!cancelled) {
                    setInlineError(error instanceof Error ? error.message : '无法连接本地服务。');
                }
            }
        }

        loadInitialData();
        return () => {
            cancelled = true;
        };
    }, []);

    const pendingChanges = joinOpenIds(openidList) !== joinOpenIds(savedOpenidList);
    const captureButtonLabel = debuggerStatus.running
        ? '开始捕获 OpenID'
        : '一键准备并捕获 OpenID';

    const headline = useMemo(() => {
        if (summary.signedSuccess) {
            return '本次签到已经提交成功';
        }

        if (summary.alreadySigned) {
            return '今天已经签过了';
        }

        if (summary.withinTimeWindow === false) {
            return '当前不在签到时间内';
        }

        if (summary.error) {
            return '这次执行没有走通';
        }

        if (isRunning) {
            return '正在完成平安打卡流程';
        }

        if (isCapturing) {
            return '正在自动准备抓取环境';
        }

        return 'CSUFT 平安打卡签到系统';
    }, [isCapturing, isRunning, summary]);

    async function refreshDebuggerStatus() {
        try {
            const response = await fetch('/api/debugger/status');
            const data = await response.json();
            setDebuggerStatus(data);
        }
        catch {
            // keep current status when refresh fails
        }
    }

    async function refreshSchedule() {
        try {
            const response = await fetch('/api/schedule');
            const data = await response.json();
            setSchedule(data.config ?? initialSchedule);
            setScheduleMeta({
                taskInstalled: data.taskInstalled ?? false,
                taskName: data.taskName ?? '',
                commandPath: data.commandPath ?? '',
            });
        }
        catch {
            // keep current schedule when refresh fails
        }
    }

    function addOpenId(candidate = openidInput) {
        const normalized = parseOpenIds(candidate);
        if (normalized.length === 0) {
            return false;
        }

        let changed = false;
        setOpenidList((current) => {
            const next = Array.from(new Set([...current, ...normalized]));
            changed = next.length !== current.length;
            return next;
        });
        setOpenidInput('');
        return changed;
    }

    function removeOpenId(target) {
        setOpenidList((current) => current.filter((item) => item !== target));
    }

    async function handleSave() {
        const normalizedList = parseOpenIds([...openidList, ...parseOpenIds(openidInput)]);
        if (normalizedList.length === 0) {
            setInlineError('请先添加至少一个 OpenID。');
            return;
        }

        setOpenidList(normalizedList);
        setIsSaving(true);
        setInlineError('');

        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ openids: normalizedList }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error ?? '保存失败');
            }

            const savedList = parseOpenIds(data.openids ?? data.openid ?? '');
            setOpenidList(savedList);
            setSavedOpenidList(savedList);
            setOpenidInput('');
            setLogs((current) => [
                createLog('OpenID 已保存到本地 .env。', 'success'),
                ...current,
            ]);
        }
        catch (error) {
            setInlineError(error instanceof Error ? error.message : '保存失败');
        }
        finally {
            setIsSaving(false);
        }
    }

    function addScheduleDate() {
        if (!scheduleDateInput) {
            return;
        }

        setSchedule((current) => ({
            ...current,
            dates: Array.from(new Set([...current.dates, scheduleDateInput])).sort(),
        }));
        setScheduleDateInput('');
    }

    function removeScheduleDate(value) {
        setSchedule((current) => ({
            ...current,
            dates: current.dates.filter((item) => item !== value),
        }));
    }

    async function handleSaveSchedule() {
        setIsSavingSchedule(true);
        setInlineError('');

        try {
            const response = await fetch('/api/schedule', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(schedule),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error ?? '保存定时配置失败');
            }

            setSchedule(data.config ?? initialSchedule);
            setScheduleMeta({
                taskInstalled: data.taskInstalled ?? false,
                taskName: data.taskName ?? '',
                commandPath: data.commandPath ?? '',
            });
            setLogs((current) => [
                createLog(
                    data.config?.enabled
                        ? `定时任务已更新，下次执行时间：${formatDateTimeVerbose(data.config?.nextRunAt)}`
                        : '定时任务已关闭。',
                    'success',
                ),
                ...current,
            ]);
        }
        catch (error) {
            setInlineError(error instanceof Error ? error.message : '保存定时配置失败');
        }
        finally {
            setIsSavingSchedule(false);
        }
    }

    function handleCapture() {
        setCaptureSummary(initialCaptureSummary);
        setCaptureStatus('正在准备本地抓取环境。');
        setIsCapturing(true);
        setInlineError('');
        setLogs((current) => [
            createLog('开始准备 OpenID 抓取环境，外部只需要你在微信里点一次登录。'),
            ...current,
        ]);

        const source = new EventSource('/api/openid/capture/stream');

        source.addEventListener('status', (event) => {
            const payload = JSON.parse(event.data);
            setCaptureStatus(payload.message);
            setLogs((current) => [createLog(payload.message), ...current]);
        });

        source.addEventListener('found', (event) => {
            const payload = JSON.parse(event.data);
            let totalAccounts = 1;
            setOpenidList((current) => {
                const next = Array.from(new Set([...current, payload.openid]));
                totalAccounts = next.length;
                return next;
            });
            setSavedOpenidList((current) => Array.from(new Set([...current, payload.openid])));
            setCaptureStatus('已拿到 OpenID，并写入本地 .env。');
            setLogs((current) => [
                createLog(`已捕获 OpenID：${payload.openid}，当前共 ${totalAccounts} 个账号。`, 'success'),
                ...current,
            ]);
        });

        source.addEventListener('error', (event) => {
            const payload = JSON.parse(event.data);
            setCaptureStatus(payload.message);
            setCaptureSummary((current) => ({
                ...current,
                error: payload.message,
            }));
            setLogs((current) => [createLog(payload.message, 'error'), ...current]);
        });

        source.addEventListener('summary', (event) => {
            const payload = JSON.parse(event.data);
            setCaptureSummary(payload);
            setCaptureStatus(payload.error ?? (payload.openid ? 'OpenID 捕获完成。' : '捕获已结束。'));
            setIsCapturing(false);
            refreshDebuggerStatus();
            setLogs((current) => [
                createLog(
                    payload.error ?? (payload.openid ? 'OpenID 已自动保存，可直接去签到。' : 'OpenID 捕获结束。'),
                    payload.error ? 'error' : 'success',
                ),
                ...current,
            ]);
            source.close();
        });

        source.onerror = () => {
            source.close();
            setIsCapturing(false);
        };
    }

    function handleRun() {
        const normalizedList = parseOpenIds([...openidList, ...parseOpenIds(openidInput)]);
        if (normalizedList.length === 0) {
            setInlineError('请先添加或获取至少一个 OpenID。');
            return;
        }

        setOpenidList(normalizedList);
        setInlineError('');
        setIsRunning(true);
        setSummary(initialSummary);
        setLogs([
            createLog(`已发起新的签到任务，将为 ${normalizedList.length} 个账号按顺序签到。`),
        ]);

        const source = new EventSource(`/api/sign-in/stream?openid=${encodeURIComponent(normalizedList.join(','))}`);

        const addLog = (message, tone = 'neutral') => {
            setLogs((current) => [createLog(message, tone), ...current]);
        };

        source.addEventListener('start', (event) => {
            const payload = JSON.parse(event.data);
            addLog(`开始处理 OpenID：${payload.openid}`);
            setSummary((current) => ({
                ...current,
                startedAt: payload.at,
            }));
        });

        source.addEventListener('wait', (event) => {
            const payload = JSON.parse(event.data);
            addLog(`等待 ${(payload.durationMs / 1000).toFixed(1)} 秒，规避风控。`);
        });

        source.addEventListener('log', (event) => {
            const payload = JSON.parse(event.data);
            addLog(payload.message);
        });

        source.addEventListener('signInResult', (event) => {
            const payload = JSON.parse(event.data);
            addLog(`登录成功：${payload.userName} / ${payload.accountNo}`, 'success');
            setSummary((current) => ({
                ...current,
                loginSuccess: true,
                account: payload,
            }));
        });

        source.addEventListener('taskDetail', (event) => {
            const payload = JSON.parse(event.data);
            addLog(`签到窗口：${payload.signStartTime} - ${payload.signEndTime}`);
            setSummary((current) => ({
                ...current,
                withinTimeWindow: true,
                task: payload,
            }));
        });

        source.addEventListener('signTimeInvalid', (event) => {
            const payload = JSON.parse(event.data);
            addLog(payload.message, 'warning');
            setSummary((current) => ({
                ...current,
                withinTimeWindow: false,
                error: payload.message,
            }));
        });

        source.addEventListener('recordStatus', (event) => {
            const payload = JSON.parse(event.data);
            addLog(`当前签到状态：${payload.signStatusName}`);
            setSummary((current) => ({
                ...current,
                signStatus: payload.signStatusName,
                alreadySigned: payload.signStatus === 0,
            }));
        });

        source.addEventListener('signRecordResponse', (event) => {
            const payload = JSON.parse(event.data);
            addLog(payload.signedSuccess ? '签到提交成功。' : '签到提交未成功。', payload.signedSuccess ? 'success' : 'warning');
            setSummary((current) => ({
                ...current,
                signedSuccess: payload.signedSuccess,
            }));
        });

        source.addEventListener('error', (event) => {
            const payload = JSON.parse(event.data);
            addLog(payload.message, 'error');
            setSummary((current) => ({
                ...current,
                error: payload.message,
            }));
        });

        source.addEventListener('summary', (event) => {
            const payload = JSON.parse(event.data);
            setSummary(payload);
            setIsRunning(false);
            addLog(
                payload.error ?? (payload.signedSuccess ? '本次签到已完成。' : '任务执行结束。'),
                payload.error ? 'error' : 'success',
            );
            source.close();
        });

        source.onerror = () => {
            source.close();
            setIsRunning(false);
        };
    }

    return (
        <main className="shell">
            <section className="hero">
                <div className="hero-copy">
                    <span className="eyebrow">CSUFT Unsafe Dorm</span>
                    <h1>{headline}</h1>
                    <p>
                        现在这个页面既能做签到，也能自动准备抓取环境来获取 <code>OpenID</code>。
                        如果本机可用 <code>mitmproxy</code>，页面会优先走本地代理抓取；否则再回退到
                        <code> WMPFDebugger </code> 方案。
                    </p>
                </div>
                <div className={`hero-status tone-${statusTone(summary)}`}>
                    <div className="status-row">
                        <Clock3 size={18} />
                        <span>{formatClock(clock)}</span>
                    </div>
                    <div className="status-row">
                        <ShieldCheck size={18} />
                        <span>{serverReady ? '本地服务已连接' : '正在连接本地服务'}</span>
                    </div>
                    <div className="status-row">
                        {isRunning ? <LoaderCircle className="spin" size={18} /> : <BadgeCheck size={18} />}
                        <span>{isRunning ? '签到进行中' : '等待发起签到'}</span>
                    </div>
                </div>
            </section>

            <section className="workspace">
                <div className="control-panel">
                    <div className="section-heading">
                        <h2>配置与执行</h2>
                        <p>把账号入口管好，然后让脚本自己走完整个流程。</p>
                    </div>

                    <label className="field">
                        <span className="field-label">OpenID 列表</span>
                        <div className="field-input">
                            <KeyRound size={18} />
                            <input
                                type="text"
                                value={openidInput}
                                onChange={(event) => setOpenidInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addOpenId();
                                    }
                                }}
                                placeholder="输入一个 OpenID，按回车或点加入按钮"
                            />
                            <button
                                type="button"
                                className="chip-action"
                                onClick={() => addOpenId()}
                                disabled={isSaving || isRunning || isCapturing}
                            >
                                <Plus size={16} />
                                <span>加入</span>
                            </button>
                        </div>
                    </label>

                    <div className="openid-panel">
                        <div className="openid-panel-header">
                            <span>当前待签到账号</span>
                            <strong>{openidList.length} 个</strong>
                        </div>
                        <div className="openid-chip-list">
                            {openidList.length > 0 ? openidList.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    className="openid-chip"
                                    onClick={() => removeOpenId(item)}
                                    disabled={isSaving || isRunning || isCapturing}
                                >
                                    <span>{item}</span>
                                    <Trash2 size={14} />
                                </button>
                            )) : (
                                <span className="helper-text">还没有加入账号，支持手动添加和一键捕获后自动追加。</span>
                            )}
                        </div>
                    </div>

                    <div className="action-row">
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={handleSave}
                            disabled={isSaving || isRunning || isCapturing}
                        >
                            <Save size={18} />
                            <span>{isSaving ? '保存中' : '保存配置'}</span>
                        </button>
                        <button
                            type="button"
                            className="primary-button"
                            onClick={handleRun}
                            disabled={isRunning || isCapturing}
                        >
                            {isRunning ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
                            <span>{isRunning ? '签到进行中' : `立即为 ${Math.max(openidList.length, 1)} 个账号签到`}</span>
                        </button>
                    </div>

                    {inlineError ? (
                        <div className="inline-feedback tone-error">
                            <CircleAlert size={16} />
                            <span>{inlineError}</span>
                        </div>
                    ) : null}

                    {pendingChanges ? (
                        <div className="inline-feedback tone-warning">
                            <CircleAlert size={16} />
                            <span>当前输入还没保存到本地 .env。</span>
                        </div>
                    ) : null}

                    <div className="fact-strip">
                        <article>
                            <span>任务开始</span>
                            <strong>{formatDateTime(summary.startedAt)}</strong>
                        </article>
                        <article>
                            <span>任务结束</span>
                            <strong>{formatDateTime(summary.completedAt)}</strong>
                        </article>
                        <article>
                            <span>当前状态</span>
                            <strong>{summary.signStatus ?? '待获取'}</strong>
                        </article>
                    </div>
                </div>

                <div className="overview">
                    <div className="section-heading">
                        <h2>结果概览</h2>
                        <p>这块只保留你最关心的四件事，不让日志淹没人。</p>
                    </div>

                    <div className="overview-grid">
                        <article className="metric">
                            <span>登录</span>
                            <strong>{summary.loginSuccess ? '成功' : '未确认'}</strong>
                        </article>
                        <article className="metric">
                            <span>签到时间</span>
                            <strong>
                                {summary.withinTimeWindow === null
                                    ? '待判断'
                                    : summary.withinTimeWindow
                                        ? '在时间内'
                                        : '不在时间内'}
                            </strong>
                        </article>
                        <article className="metric">
                            <span>任务</span>
                            <strong>{summary.task?.taskName ?? '待获取'}</strong>
                        </article>
                        <article className="metric">
                            <span>执行结果</span>
                            <strong>
                                {summary.signedSuccess
                                    ? '签到成功'
                                    : summary.alreadySigned
                                        ? '已签过'
                                        : summary.error
                                            ? '执行失败'
                                            : '待执行'}
                            </strong>
                        </article>
                    </div>

                    <div className="detail-list">
                        <div className="detail-row">
                            <UserRound size={18} />
                            <div>
                                <span>账号信息</span>
                                <strong>
                                    {summary.account
                                        ? `${summary.account.userName} · ${summary.account.accountNo}`
                                        : '还没有登录结果'}
                                </strong>
                            </div>
                        </div>
                        <div className="detail-row">
                            <Clock3 size={18} />
                            <div>
                                <span>签到窗口</span>
                                <strong>
                                    {summary.task
                                        ? `${summary.task.signStartTime} - ${summary.task.signEndTime}`
                                        : '还没有任务窗口'}
                                </strong>
                            </div>
                        </div>
                        <div className="detail-row">
                            <ShieldCheck size={18} />
                            <div>
                                <span>异常说明</span>
                                <strong>{summary.error ?? '目前没有异常。'}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="capture-grid">
                <div className={`capture-panel tone-${captureTone(captureSummary)}`}>
                    <div className="section-heading">
                        <h2>一键获取 OpenID</h2>
                        <p>页面会优先尝试本地代理抓取，必要时再回退到调试器方案。当前调试器监听地址是 {debuggerWsUrl || '未读取'}。</p>
                    </div>

                    <div className="detail-list">
                        <div className="detail-row">
                            <Sparkles size={18} />
                            <div>
                                <span>当前动作</span>
                                <strong>{captureStatus}</strong>
                            </div>
                        </div>
                        <div className="detail-row">
                            <Radar size={18} />
                            <div>
                                <span>捕获结果</span>
                                <strong>{captureSummary.openid ?? '还没有拿到 OpenID'}</strong>
                            </div>
                        </div>
                        <div className="detail-row">
                            <ShieldCheck size={18} />
                            <div>
                                <span>调试器回退状态</span>
                                <strong>{debuggerStatus.running ? 'WMPFDebugger 已就绪' : '未启用，优先走本地代理'}</strong>
                            </div>
                        </div>
                    </div>

                    <div className="action-row single-action">
                        <button
                            type="button"
                            className="primary-button"
                            onClick={handleCapture}
                            disabled={isCapturing || isRunning}
                        >
                            {isCapturing ? <LoaderCircle className="spin" size={18} /> : <Radar size={18} />}
                            <span>{isCapturing ? '正在准备并监听登录请求' : captureButtonLabel}</span>
                        </button>
                    </div>

                    <div className="fact-strip capture-facts">
                        <article>
                            <span>开始时间</span>
                            <strong>{formatDateTime(captureSummary.startedAt)}</strong>
                        </article>
                        <article>
                            <span>结束时间</span>
                            <strong>{formatDateTime(captureSummary.completedAt)}</strong>
                        </article>
                        <article>
                            <span>保存状态</span>
                            <strong>{captureSummary.saved ? '已写入 .env' : '待写入'}</strong>
                        </article>
                    </div>
                </div>

                <div className="capture-notes">
                    <div className="section-heading">
                        <h2>你只需要做什么</h2>
                        <p>这里尽量把复杂步骤都吃掉，外部动作只剩微信里那一下。</p>
                    </div>

                    <div className="notes-list">
                        <article className="note-item">
                            <span>01</span>
                            <p>点一次主按钮，页面会自动准备本地抓取环境。</p>
                        </article>
                        <article className="note-item">
                            <span>02</span>
                            <p>微信里打开“中南林业科技大学学生工作部”小程序，进入“我的”页面， 重新进行登录， 来发送API请求让系统捕获你的OpenID。</p>
                        </article>
                        <article className="note-item">
                            <span>03</span>
                            <p>看到页面提示监听就绪后，在微信里点一次登录，OpenID 会自动回填并保存。</p>
                        </article>
                    </div>
                </div>
            </section>

            <section className="schedule-grid">
                <div className="schedule-panel">
                    <div className="section-heading">
                        <h2>定时自动签到</h2>
                        <p>配置一次后，系统会在你指定的时间自动触发本地签到脚本。</p>
                    </div>

                    <label className="toggle-row">
                        <span>启用定时任务</span>
                        <input
                            type="checkbox"
                            checked={schedule.enabled}
                            onChange={(event) => setSchedule((current) => ({ ...current, enabled: event.target.checked }))}
                        />
                    </label>

                    <div className="mode-grid">
                        <button
                            type="button"
                            className={schedule.mode === 'daily' ? 'mode-button active' : 'mode-button'}
                            onClick={() => setSchedule((current) => ({ ...current, mode: 'daily' }))}
                        >
                            <CalendarDays size={18} />
                            <span>每天</span>
                        </button>
                        <button
                            type="button"
                            className={schedule.mode === 'weekdays' ? 'mode-button active' : 'mode-button'}
                            onClick={() => setSchedule((current) => ({ ...current, mode: 'weekdays' }))}
                        >
                            <BadgeCheck size={18} />
                            <span>工作日</span>
                        </button>
                        <button
                            type="button"
                            className={schedule.mode === 'dates' ? 'mode-button active' : 'mode-button'}
                            onClick={() => setSchedule((current) => ({ ...current, mode: 'dates' }))}
                        >
                            <CalendarRange size={18} />
                            <span>指定日期</span>
                        </button>
                    </div>

                    <label className="field">
                        <span className="field-label">触发时间</span>
                        <div className="field-input">
                            <Clock3 size={18} />
                            <input
                                type="time"
                                value={schedule.time}
                                onChange={(event) => setSchedule((current) => ({ ...current, time: event.target.value }))}
                            />
                        </div>
                    </label>

                    {schedule.mode === 'dates' ? (
                        <div className="dates-panel">
                            <div className="date-entry">
                                <input
                                    type="date"
                                    value={scheduleDateInput}
                                    onChange={(event) => setScheduleDateInput(event.target.value)}
                                />
                                <button type="button" className="secondary-button compact-button" onClick={addScheduleDate}>
                                    <Plus size={16} />
                                    <span>添加日期</span>
                                </button>
                            </div>
                            <div className="date-chip-list">
                                {schedule.dates.length > 0 ? schedule.dates.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className="date-chip"
                                        onClick={() => removeScheduleDate(value)}
                                    >
                                        <span>{value}</span>
                                        <Trash2 size={14} />
                                    </button>
                                )) : (
                                    <span className="helper-text">还没有指定日期。</span>
                                )}
                            </div>
                        </div>
                    ) : null}

                    <div className="fact-strip schedule-facts">
                        <article>
                            <span>计划任务</span>
                            <strong>{scheduleMeta.taskInstalled ? '已安装' : '未安装'}</strong>
                        </article>
                        <article>
                            <span>下次执行</span>
                            <strong>{formatDateTimeVerbose(schedule.nextRunAt)}</strong>
                        </article>
                        <article>
                            <span>最近结果</span>
                            <strong>{schedule.lastResult ?? '暂无记录'}</strong>
                        </article>
                    </div>

                    <button
                        type="button"
                        className="primary-button full-width-button"
                        onClick={handleSaveSchedule}
                        disabled={isSavingSchedule || isRunning || isCapturing}
                    >
                        {isSavingSchedule ? <LoaderCircle className="spin" size={18} /> : <CalendarDays size={18} />}
                        <span>{isSavingSchedule ? '正在保存定时配置' : '保存定时配置'}</span>
                    </button>
                </div>

                <div className="schedule-notes">
                    <div className="section-heading">
                        <h2>调度说明</h2>
                        <p>这里配的是规则，本机会按这个规则在后台决定今天要不要真正发起签到。</p>
                    </div>

                    <div className="notes-list">
                        <article className="note-item">
                            <span>01</span>
                            <p>“每天”和“工作日”会创建一个固定时间的本地计划任务，再由脚本判断今天是否该执行。</p>
                        </article>
                        <article className="note-item">
                            <span>02</span>
                            <p>“指定日期”同样会在每天固定时间唤起一次脚本，但只有你选中的日期才会真正签到。</p>
                        </article>
                        <article className="note-item">
                            <span>03</span>
                            <p>计划任务入口是 {scheduleMeta.commandPath || '本地命令文件'}，最近一次执行结果会写回页面。</p>
                        </article>
                    </div>
                </div>
            </section>

            <section className="timeline">
                <div className="section-heading">
                    <h2>活动日志</h2>
                    <p>日志按最新在上排列，方便你盯住最后一个关键动作。</p>
                </div>

                <div className="timeline-list">
                    {logs.map((log) => (
                        <article key={log.id} className={`timeline-item tone-${log.tone}`}>
                            <span>{log.time}</span>
                            <p>{log.message}</p>
                        </article>
                    ))}
                </div>
            </section>
        </main>
    );
}

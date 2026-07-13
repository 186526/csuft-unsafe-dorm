const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://127.0.0.1:3001';

type Summary = {
    startedAt: string;
    completedAt?: string;
    loginSuccess: boolean;
    withinTimeWindow: boolean | null;
    signStatus: string | null;
    signedSuccess: boolean;
    alreadySigned: boolean;
    account: null | {
        userName: string;
        schoolName: string;
        accountNo: string;
    };
    task: null | {
        taskName: string;
        signStartTime: string;
        signEndTime: string;
    };
    error: string | null;
};

function parseSseChunk(buffer: string) {
    const events: Array<{ event: string; data: string }> = [];
    const normalized = buffer.replace(/\r/g, '');
    const parts = normalized.split('\n\n');
    const remainder = parts.pop() ?? '';

    for (const part of parts) {
        const lines = part.split('\n');
        let event = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
            if (line.startsWith('event:')) {
                event = line.slice('event:'.length).trim();
                continue;
            }

            if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trim());
            }
        }

        events.push({
            event,
            data: dataLines.join('\n'),
        });
    }

    return { events, remainder };
}

function reportSummary(summary: Summary) {
    console.log('前端立即签到结果:');
    console.log(`- 登录: ${summary.loginSuccess ? '成功' : '未确认'}`);
    console.log(
        `- 签到时间: ${
            summary.withinTimeWindow === null
                ? '未确认'
                : summary.withinTimeWindow
                    ? '在时间内'
                    : '不在时间内'
        }`,
    );
    console.log(
        `- 签到结果: ${
            summary.signedSuccess
                ? '成功'
                : summary.alreadySigned
                    ? '已签到'
                    : '未成功'
        }`,
    );

    if (summary.account) {
        console.log(
            `- 账号: ${summary.account.userName} @ ${summary.account.schoolName} # ${summary.account.accountNo}`,
        );
    }

    if (summary.task) {
        console.log(
            `- 任务: ${summary.task.taskName} (${summary.task.signStartTime} ~ ${summary.task.signEndTime})`,
        );
    }

    if (summary.signStatus) {
        console.log(`- 当前状态: ${summary.signStatus}`);
    }

    if (summary.error) {
        console.log(`- 异常: ${summary.error}`);
    }
}

async function main() {
    const streamUrl = new URL('/api/sign-in/stream', FRONTEND_BASE_URL);
    const response = await fetch(streamUrl, {
        headers: {
            Accept: 'text/event-stream',
        },
    });

    if (!response.ok || !response.body) {
        throw new Error(`前端服务请求失败: HTTP ${response.status}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = '';
    let summary: Summary | null = null;

    while (true) {
        const { value, done } = await reader.read();
        buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const parsed = parseSseChunk(buffered);
        buffered = parsed.remainder;

        for (const item of parsed.events) {
            if (item.event === 'log') {
                const payload = JSON.parse(item.data) as { message?: string };
                if (payload.message) {
                    console.log(payload.message);
                }
                continue;
            }

            if (item.event === 'summary') {
                summary = JSON.parse(item.data) as Summary;
            }
        }

        if (done) {
            break;
        }
    }

    if (!summary) {
        throw new Error('前端服务未返回签到汇总结果。');
    }

    reportSummary(summary);

    if (summary.error && !summary.signedSuccess && !summary.alreadySigned) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('ui-trigger 执行失败:', error);
    process.exitCode = 1;
});

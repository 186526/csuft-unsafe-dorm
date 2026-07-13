import 'dotenv/config';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { mainLoop } from './index.js';
import {
    computeNextRunAt,
    getShanghaiDate,
    loadScheduleConfig,
    matchesScheduleOnDate,
    saveScheduleConfig,
} from '../scheduler.js';
import { ensureScheduleLogDir, writeScheduleLog, type ScheduleLogResult } from '../schedule-logging.js';

function buildResultMessage(successCount: number, skippedCount: number, failureCount: number) {
    return `自动签到统计：成功 ${successCount}，跳过 ${skippedCount}，失败 ${failureCount}。`;
}

export async function runScheduledSignIn() {
    await ensureScheduleLogDir();

    const startedAt = new Date();
    const logLines: string[] = [
        `自动签到触发时间：${startedAt.toLocaleString('zh-CN', { hour12: false })}`,
    ];
    const originalLog = console.log;
    const originalError = console.error;

    const appendLine = (...args: unknown[]) => {
        const text = args.map((item) => item instanceof Error ? item.stack ?? item.message : String(item)).join(' ');
        logLines.push(text);
    };

    console.log = (...args: unknown[]) => {
        appendLine(...args);
        originalLog(...args);
    };
    console.error = (...args: unknown[]) => {
        appendLine(...args);
        originalError(...args);
    };

    let logResult: ScheduleLogResult = '失败';
    let schedule = await loadScheduleConfig();
    let today = getShanghaiDate();

    try {
        schedule = await loadScheduleConfig();
        today = getShanghaiDate();

        if (!schedule.enabled) {
            logResult = '跳过';
            console.log('定时任务未启用，已跳过本次自动签到。');
            return;
        }

        if (schedule.lastSuccessDate === today) {
            logResult = '跳过';
            console.log(`今天（${today}）已经自动签到成功过，本次不再重复执行。`);
            return;
        }

        if (!matchesScheduleOnDate(schedule, today)) {
            const skipped = {
                ...schedule,
                lastAttemptDate: today,
                lastAttemptAt: new Date().toISOString(),
                lastResult: 'skipped' as const,
                lastMessage: '今天不在已配置的自动签到日期内，已跳过。',
            };
            skipped.nextRunAt = computeNextRunAt(skipped);
            await saveScheduleConfig(skipped);
            logResult = '跳过';
            console.log(`今天（${today}）不符合当前定时规则，已跳过执行。`);
            return;
        }

        const started = {
            ...schedule,
            lastAttemptDate: today,
            lastAttemptAt: new Date().toISOString(),
            lastResult: null,
            lastMessage: '自动签到已开始执行。',
        };
        started.nextRunAt = computeNextRunAt(started);
        await saveScheduleConfig(started);

        const summary = await mainLoop();
        const summaryMessage = buildResultMessage(summary.successCount, summary.skippedCount, summary.failureCount);

        if (summary.failureCount > 0) {
            const failure = {
                ...started,
                lastResult: 'failure' as const,
                lastMessage: summaryMessage,
            };
            failure.nextRunAt = computeNextRunAt(failure);
            await saveScheduleConfig(failure);
            logResult = '失败';
            console.log(summaryMessage);
            return;
        }

        if (summary.successCount > 0) {
            const success = {
                ...started,
                lastSuccessDate: today,
                lastSuccessAt: new Date().toISOString(),
                lastResult: 'success' as const,
                lastMessage: summaryMessage,
            };
            success.nextRunAt = computeNextRunAt(success);
            await saveScheduleConfig(success);
            logResult = '成功';
            console.log(summaryMessage);
            return;
        }

        const skipped = {
            ...started,
            lastResult: 'skipped' as const,
            lastMessage: summaryMessage,
        };
        skipped.nextRunAt = computeNextRunAt(skipped);
        await saveScheduleConfig(skipped);
        logResult = '跳过';
        console.log(summaryMessage);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = {
            ...schedule,
            lastAttemptDate: today,
            lastAttemptAt: new Date().toISOString(),
            lastResult: 'failure' as const,
            lastMessage: `自动签到执行失败：${message}`,
        };
        failure.nextRunAt = computeNextRunAt(failure);
        await saveScheduleConfig(failure);
        throw error;
    }
    finally {
        console.log = originalLog;
        console.error = originalError;
        logLines.push(`自动签到结果：${logResult}`);
        logLines.push(`日志生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
        await writeScheduleLog(logResult, logLines);
    }
}

const isDirectRun = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
    runScheduledSignIn().catch((error) => {
        console.error('Scheduled runner failed:', error);
        process.exitCode = 1;
    });
}

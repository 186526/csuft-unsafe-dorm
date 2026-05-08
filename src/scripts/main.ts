import EventEmitter from 'node:events';
import unsafeDorm, { getDistance } from '../index.js';
import type { AuthTokenResponse, RecordStatus, TaskDetails, TaskInfo } from '../types.js';

export interface MainEvents {
    wait: [time: number];
    log: [...args: any[]];
    error: [error: unknown];
    start: [openid: string];
    finish: [openid: string];
    signInResult: [openid: string, signInResult: AuthTokenResponse];
    taskInfos: [openid: string, taskInfos: TaskInfo[]];
    taskDetail: [openid: string, taskDetail: TaskDetails];
    signTimeInvalid: [openid: string, startTime: string, endTime: string];
    recordStatus: [openid: string, recordStatus: RecordStatus];
    signRecordResponse: [openid: string, signRecordResponse: boolean];
    destroy: [];
}

export type OpenIdRunStatus = 'success' | 'skipped' | 'failure';

export type OpenIdRunResult = {
    openid: string;
    status: OpenIdRunStatus;
    message: string;
};

export type MainLoopResult = {
    successCount: number;
    skippedCount: number;
    failureCount: number;
    results: OpenIdRunResult[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getFailureHint(error: unknown): string | null {
    if (!(error instanceof Error)) {
        return null;
    }

    const message = error.message.toLowerCase();

    if (message.includes('spawn eperm')) {
        return '当前环境禁止 tsx/esbuild 拉起子进程，脚本还没有真正发出签到请求。';
    }

    if (message.includes('connect eacces') || message.includes('network error')) {
        return '当前环境网络被拦截，签到请求没有成功发到服务器。';
    }

    if (message.includes('timed out') || message.includes('timeout')) {
        return '连接签到服务器超时，本次未能完成请求。';
    }

    return null;
}

function parseHmsToSeconds(time: string): number {
    const parts = time.split(':').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        throw new Error(`无效的时间格式: ${time}`);
    }

    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function getCurrentUtc8Seconds(): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    const second = Number(parts.find((part) => part.type === 'second')?.value ?? '0');

    return hour * 3600 + minute * 60 + second;
}

function isWithinUtc8SignTimeWindow(startTime: string, endTime: string): boolean {
    const start = parseHmsToSeconds(startTime);
    const end = parseHmsToSeconds(endTime);
    const now = getCurrentUtc8Seconds();

    if (start <= end) {
        return now >= start && now <= end;
    }

    return now >= start || now <= end;
}

function summarizeResults(results: OpenIdRunResult[]): MainLoopResult {
    return {
        successCount: results.filter((item) => item.status === 'success').length,
        skippedCount: results.filter((item) => item.status === 'skipped').length,
        failureCount: results.filter((item) => item.status === 'failure').length,
        results,
    };
}

export default async function main(openids: string[], events: EventEmitter<MainEvents>): Promise<MainLoopResult> {
    if (openids.length === 0) {
        throw new Error('请设置至少一个有效的 openid。');
    }

    const results: OpenIdRunResult[] = [];

    for (const openid of openids) {
        events.emit('start', openid);

        let waitingTime = 5000 + Math.random() * 2500;
        events.emit('wait', waitingTime);
        events.emit('log', '等待', (waitingTime / 1000).toFixed(1), '秒中, 避免风控...\n');

        await sleep(waitingTime);
        events.emit('log', '开始执行下一个 openid（如果有）。\n');

        const app = new unsafeDorm({
            openId: openid,
        });

        try {
            events.emit('log', '开始执行登录，目前时间:', new Date().toLocaleString());
            events.emit('log', '正在登录... openId:', openid);

            const signInResult = await app.signInWithOpenId();
            events.emit('signInResult', openid, signInResult);
            events.emit('log', '登录成功！', signInResult.userName, '@', signInResult.schoolName, '#', signInResult.accountNo);

            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', '登录成功，等待', (waitingTime / 1000).toFixed(1), '秒，获取任务信息...');

            await sleep(waitingTime);
            const taskInfos = await app.listTask();
            events.emit('taskInfos', openid, taskInfos);

            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit(
                'log',
                '获取任务信息列表成功！等待',
                (waitingTime / 1000).toFixed(1),
                '秒，仅尝试选择第 1 项获取任务信息:',
                taskInfos[0].taskName,
                taskInfos[0].taskId,
            );

            await sleep(waitingTime);
            const taskDetail = await app.getTask(taskInfos[0].taskId);
            events.emit('taskDetail', openid, taskDetail);

            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', '获取任务详情成功！可签到时间:', taskDetail.signStartTime, '~', taskDetail.signEndTime);

            if (!isWithinUtc8SignTimeWindow(taskDetail.signStartTime, taskDetail.signEndTime)) {
                events.emit('signTimeInvalid', openid, taskDetail.signStartTime, taskDetail.signEndTime);
                events.emit(
                    'log',
                    `当前不在签到时间内（UTC+8）：${taskDetail.signStartTime}~${taskDetail.signEndTime}，继续请求服务端状态，确认是否仍可补签。`,
                );
            }

            events.emit('log', '等待', (waitingTime / 1000).toFixed(1), '秒，获取签到状态..');

            await sleep(waitingTime);
            const recordStatus = await app.getRecordStatus(taskDetail.taskId);
            events.emit('recordStatus', openid, recordStatus);
            events.emit('log', '获取签到状态成功！当前签到状态:', recordStatus.signStatusName);

            if (recordStatus.signStatus === 0) {
                events.emit('log', '当前已签到，签到时间为', recordStatus.signTime);
                events.emit('log', '跳过签到，继续下一个 openid（如果有）。\n');
                results.push({
                    openid,
                    status: 'success',
                    message: `服务端确认已签到：${recordStatus.signStatusName}`,
                });
                events.emit('finish', openid);
                continue;
            }

            if (recordStatus.isShowBtn === false) {
                events.emit('log', '服务端当前未开放签到按钮，本次不提交签到请求。');
                results.push({
                    openid,
                    status: 'skipped',
                    message: `服务端未开放签到：${recordStatus.signStatusName}`,
                });
                events.emit('finish', openid);
                continue;
            }

            const signLat = parseFloat(taskDetail.dormitoryRegisterVO.locationLat) + Math.random() * 0.001;
            const signLng = parseFloat(taskDetail.dormitoryRegisterVO.locationLng) + Math.random() * 0.001;

            events.emit('log', '将签到位置设置为:', signLat, signLng);
            events.emit(
                'log',
                '该签到位置距宿舍楼距离为:',
                getDistance(
                    signLat,
                    signLng,
                    parseFloat(taskDetail.dormitoryRegisterVO.locationLat),
                    parseFloat(taskDetail.dormitoryRegisterVO.locationLng),
                ),
                'm',
            );

            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', '等待', (waitingTime / 1000).toFixed(1), '秒，提交签到信息...');

            const signRecordResponse = await app.signRecord({
                taskId: taskDetail.taskId,
                signLat,
                signLng,
                roomId: taskDetail.dormitoryRegisterVO.roomId,
            });

            events.emit('signRecordResponse', openid, signRecordResponse);
            events.emit('log', '提交签到信息成功！', signRecordResponse);

            results.push({
                openid,
                status: signRecordResponse ? 'success' : 'failure',
                message: signRecordResponse ? '服务端确认签到提交成功。' : '服务端返回签到提交失败。',
            });
            events.emit('finish', openid);
        }
        catch (error) {
            events.emit('error', error);
            const failureHint = getFailureHint(error);
            if (failureHint) {
                events.emit('log', failureHint);
            }
            events.emit('log', '尝试失败！请检查 openid 是否正确，或者当前是否允许签到/补签。');
            results.push({
                openid,
                status: 'failure',
                message: error instanceof Error ? error.message : String(error),
            });
            events.emit('finish', openid);
        }
    }

    events.emit('log', '\n所有 openid 均已处理完成。');
    events.emit('destroy');
    return summarizeResults(results);
}

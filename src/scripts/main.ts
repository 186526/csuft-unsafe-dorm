import unsafeDorm, { getDistance } from '../index';
import EventEmitter from 'node:events';
import type { AuthTokenResponse, RecordStatus, TaskDetails, TaskInfo } from '../types';

export interface MainEvents {
    wait: [time: number];
    log: [...args: any[]];
    error: [openid: string, error: unknown];
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseHmsToSeconds(time: string): number {
    const parts = time.split(":").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        throw new Error(`无效的时间格式: ${time}`);
    }
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function getCurrentUtc8Seconds(): number {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    const second = Number(parts.find((part) => part.type === "second")?.value ?? "0");

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

export type MainOptions = {
    concurrency?: number;
};

const DEFAULT_SIGN_CONCURRENCY = 3;

export default async function main(
    openids: string[],
    events: EventEmitter<MainEvents>,
    options: MainOptions = {},
) {
    if (openids.length === 0) {
        throw new Error("请设置至少一个有效的 openid。");
    }

    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_SIGN_CONCURRENCY, openids.length));
    const queue = [...openids];

    async function signOpenid(openid: string) {
        events.emit('start', openid);

        let waitingTime = 5000 + Math.random() * 2500;
        events.emit('wait', waitingTime);
        events.emit('log', "等待", (waitingTime / 1000).toFixed(1), "秒中, 避免风控...\n");

        await sleep(waitingTime);
        events.emit('log', "开始处理该 openid。\n");

        const App = new unsafeDorm({
            openId: openid,
        });

        try {
            events.emit('log', "开始执行登录，目前时间:", new Date().toLocaleString());
            events.emit('log', "正在登录... openId:", openid);

            const signInResult = await App.signInWithOpenId();
            events.emit('signInResult', openid, signInResult);
            events.emit('log', "登录成功！", signInResult.userName, "@", signInResult.schoolName, "#", signInResult.accountNo);
            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', "登录成功，等待", (waitingTime / 1000).toFixed(1), "秒，获取任务信息...");

            await sleep(waitingTime);
            const taskInfos = await App.listTask();
            events.emit('taskInfos', openid, taskInfos);
            if (taskInfos.length === 0) {
                throw new Error("任务信息列表为空，没有可签到的任务。");
            }
            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', "获取任务信息列表成功！等待", (waitingTime / 1000).toFixed(1), "秒，仅尝试选择第 1 项获取任务信息:", taskInfos[0].taskName, taskInfos[0].taskId);

            await sleep(waitingTime);
            const taskDetail = await App.getTask(taskInfos[0].taskId);
            events.emit('taskDetail', openid, taskDetail);
            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', "获取任务详情成功！可签到时间:", taskDetail.signStartTime, "~", taskDetail.signEndTime);

            if (!isWithinUtc8SignTimeWindow(taskDetail.signStartTime, taskDetail.signEndTime)) {
                events.emit('signTimeInvalid', openid, taskDetail.signStartTime, taskDetail.signEndTime);
                events.emit('log', `当前不在签到时间内（UTC+8）：${taskDetail.signStartTime}~${taskDetail.signEndTime}`);
                events.emit('finish', openid);
                return;
            }

            events.emit('log', "等待", (waitingTime / 1000).toFixed(1), "秒，获取签到状态...");

            await sleep(waitingTime);
            const recordStatus = await App.getRecordStatus(taskDetail.taskId);
            events.emit('recordStatus', openid, recordStatus);
            events.emit('log', "获取签到状态成功！当前签到状态: ", recordStatus.signStatusName);

            if (recordStatus.signStatus === 0) {
                events.emit('log', "当前已签到，签到时间为:", recordStatus.signTime);
                events.emit('log', "跳过签到。\n");
                events.emit('finish', openid);
                return;
            }

            const signLat = parseFloat(taskDetail.dormitoryRegisterVO.locationLat) + Math.random() * 0.001,
                signLng = parseFloat(taskDetail.dormitoryRegisterVO.locationLng) + Math.random() * 0.001;


            events.emit('log', "将签到位置设置为: ", signLat, signLng);
            events.emit('log', "该签到位置距宿舍楼距离为: ", getDistance(
                signLat,
                signLng,
                parseFloat(taskDetail.dormitoryRegisterVO.locationLat),
                parseFloat(taskDetail.dormitoryRegisterVO.locationLng))
                , "m");

            waitingTime = 1000 + Math.random() * 2000;
            events.emit('wait', waitingTime);
            events.emit('log', "等待", (waitingTime / 1000).toFixed(1), "秒，提交签到信息...");
            const signRecordResponse = await App.signRecord({
                taskId: taskDetail.taskId,
                signLat: signLat,
                signLng: signLng,
                roomId: taskDetail.dormitoryRegisterVO.roomId,
            });

            events.emit('signRecordResponse', openid, signRecordResponse);
            events.emit('log', "提交签到信息成功！", signRecordResponse);
            events.emit('finish', openid);
        }
        catch (error) {
            events.emit('error', openid, error);
            events.emit('log', "尝试失败！请检查 openid 是否正确，或者是否在签到时间内，或者您已签到。");
            events.emit('finish', openid);
        }
    }

    async function worker() {
        for (;;) {
            const openid = queue.shift();
            if (openid === undefined) {
                return;
            }
            await signOpenid(openid);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    events.emit('log', "\n所有 openid 均已处理完成。");
    events.emit('destroy');
}

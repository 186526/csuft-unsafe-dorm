import process from "node:process";
import { pathToFileURL } from "node:url";
import main, { MainEvents } from "./main";
import { EventEmitter } from "node:events";
import { loadBarkConfig, resolveBarkConfigPath } from "../bark-config";
import {
    buildEntry,
    buildTitle,
    joinContents,
    planPushes,
    type SignState,
} from "../bark-report";
import { pushBark } from "../bark";

function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

async function run() {
    const config = await loadBarkConfig(resolveBarkConfigPath());
    const openids = config.users.map((user) => user.openid);

    const events = new EventEmitter<MainEvents>();
    const states = new Map<string, SignState>();
    let currentOpenid: string | null = null;

    for (const user of config.users) {
        states.set(user.openid, { openid: user.openid, name: user.name });
    }

    events.on("start", (openid) => {
        currentOpenid = openid;
        if (!states.has(openid)) {
            states.set(openid, { openid });
        }
    });

    events.on("signInResult", (openid, signInResult) => {
        const state = states.get(openid) || { openid };
        state.name = signInResult.userName || state.name;
        state.accountId = signInResult.accountNo;
        states.set(openid, state);
    });

    events.on("taskInfos", (openid, taskInfos) => {
        const state = states.get(openid) || { openid };
        if (taskInfos.length > 0) {
            state.taskName = taskInfos[0].taskName;
        }
        states.set(openid, state);
    });

    events.on("taskDetail", (openid, taskDetail) => {
        const state = states.get(openid) || { openid };
        state.taskName = taskDetail.taskName || state.taskName;
        states.set(openid, state);
    });

    events.on("signTimeInvalid", (openid, startTime, endTime) => {
        const state = states.get(openid) || { openid };
        state.result = `未到签到时间(${startTime}~${endTime})`;
        state.time = new Date().toLocaleString();
        states.set(openid, state);
    });

    events.on("recordStatus", (openid, recordStatus) => {
        const state = states.get(openid) || { openid };
        state.taskName = recordStatus.taskName || state.taskName;
        if (recordStatus.signStatus === 0) {
            state.result = "已签到";
            state.time = recordStatus.signTime || state.time;
        }
        states.set(openid, state);
    });

    events.on("signRecordResponse", (openid, signRecordResponse) => {
        const state = states.get(openid) || { openid };
        state.result = signRecordResponse ? "签到成功" : "签到失败";
        state.time = new Date().toLocaleString();
        states.set(openid, state);
    });

    events.on("error", (error) => {
        if (!currentOpenid) {
            return;
        }
        const state = states.get(currentOpenid) || { openid: currentOpenid };
        state.error = formatErrorMessage(error);
        state.time = new Date().toLocaleString();
        states.set(currentOpenid, state);
    });

    events.on("finish", (openid) => {
        if (!states.has(openid)) {
            states.set(openid, { openid });
        }
    });

    events.on("log", (...args) => {
        console.log(...args);
    });

    events.on("destroy", () => {
        events.removeAllListeners();
    });

    await main(openids, events);

    const entries = config.users.map((user) => {
        const state = states.get(user.openid) ?? { openid: user.openid };
        return buildEntry(user, state);
    });

    config.users.forEach((user, index) => {
        if (!user.deviceKey) {
            console.warn(`[bark] ${entries[index].name} 没有配置设备 key，跳过个人推送。`);
        }
    });

    let failedPushes = 0;
    for (const plan of planPushes(config, entries)) {
        const description = plan.kind === "global" ? "全局状态" : `${plan.label}的个人状态`;

        try {
            await pushBark(config.api, plan.deviceKey, buildTitle(plan.entries), joinContents(plan.entries));
            console.log(`[bark] 已推送${description}。`);
        }
        catch (error) {
            failedPushes += 1;
            console.error(`[bark] 推送${description}失败：${formatErrorMessage(error)}`);
        }
    }

    if (failedPushes > 0) {
        process.exitCode = 1;
    }
}

const entryFile = process.argv[1];
const isDirectRun = !!entryFile && import.meta.url === pathToFileURL(entryFile).href;

if (isDirectRun) {
    run().catch((error) => {
        console.error("bark-bot 执行失败:", error);
        process.exitCode = 1;
    });
}

import process from "node:process";
import { pathToFileURL } from "node:url";
import main, { MainEvents } from "./main";
import { EventEmitter } from "node:events";
import { loadBarkConfig, resolveBarkConfigPath } from "../bark-config";
import {
    buildEntry,
    buildTitle,
    joinContents,
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
    const userByOpenid = new Map(config.users.map((user) => [user.openid, user]));
    const pushPromises: Promise<void>[] = [];
    const notifiedOpenids = new Set<string>();
    let failedPushes = 0;

    for (const user of config.users) {
        states.set(user.openid, { openid: user.openid, name: user.name });
        if (!user.deviceKey) {
            console.warn(`[bark] ${user.name ?? user.openid} 没有配置设备 key，跳过个人推送。`);
        }
    }

    function notifyIndividual(openid: string) {
        if (notifiedOpenids.has(openid)) {
            return;
        }
        notifiedOpenids.add(openid);

        const user = userByOpenid.get(openid);
        if (!user?.deviceKey) {
            return;
        }

        const state = states.get(openid) ?? { openid };
        const entry = buildEntry(user, state);

        pushPromises.push(
            pushBark(config.api, user.deviceKey, buildTitle([entry]), joinContents([entry]))
                .then(() => {
                    console.log(`[bark] 已推送${entry.name}的个人状态。`);
                })
                .catch((error) => {
                    failedPushes += 1;
                    console.error(`[bark] 推送${entry.name}的个人状态失败：${formatErrorMessage(error)}`);
                }),
        );
    }

    events.on("start", (openid) => {
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

    events.on("error", (openid, error) => {
        const state = states.get(openid) || { openid };
        state.error = formatErrorMessage(error);
        state.time = new Date().toLocaleString();
        states.set(openid, state);
    });

    events.on("finish", (openid) => {
        if (!states.has(openid)) {
            states.set(openid, { openid });
        }
        notifyIndividual(openid);
    });

    events.on("log", (...args) => {
        console.log(...args);
    });

    events.on("destroy", () => {
        events.removeAllListeners();
    });

    await main(openids, events);
    await Promise.all(pushPromises);

    const entries = config.users.map((user) => {
        const state = states.get(user.openid) ?? { openid: user.openid };
        return buildEntry(user, state);
    });
    const attentionEntries = entries.filter((entry) => !entry.completed);
    const globalBody = attentionEntries.length > 0
        ? joinContents(attentionEntries)
        : "所有人员签到正常。";

    try {
        await pushBark(config.api, config.globalDeviceKey, buildTitle(entries), globalBody);
        console.log("[bark] 已推送全局状态。");
    }
    catch (error) {
        failedPushes += 1;
        console.error(`[bark] 推送全局状态失败：${formatErrorMessage(error)}`);
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

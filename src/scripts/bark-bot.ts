import "dotenv/config";
import axios from "axios";
import process from "node:process";
import { pathToFileURL } from "node:url";
import main, { MainEvents } from "./main.js";
import { EventEmitter } from "node:events";

type OpenIdState = {
    openid: string;
    name?: string;
    accountId?: string;
    taskName?: string;
    result?: string;
    time?: string;
    error?: string;
};

const TITLE = "平安打卡结果";

function normalizeApiBaseUrl(rawUrl: string): string {
    return rawUrl.replace(/\/+$/, "");
}

function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

async function pushBark(apiBaseUrl: string, deviceToken: string, body: string) {
    const baseUrl = normalizeApiBaseUrl(apiBaseUrl);

    try {
        await axios.post(`${baseUrl}/push`, {
            device_key: deviceToken,
            title: TITLE,
            body,
        });
        return;
    }
    catch {
        const url = `${baseUrl}/${encodeURIComponent(deviceToken)}/${encodeURIComponent(TITLE)}/${encodeURIComponent(body)}`;
        await axios.get(url);
    }
}

function buildContent(state: OpenIdState): string {
    const name = state.name || "未知用户";
    const accountId = state.accountId || "未知学号";
    const taskName = state.taskName || "未知任务";
    const result = state.error ? `失败(${state.error})` : (state.result || "未知");
    const time = state.time || new Date().toLocaleString();

    return `签到信息：${name}#${accountId}, 签到条目：${taskName}, 签到结果：${result}, 签到时间：${time}`;
}

async function run() {
    const barkApi = process.env.BARK_API || process.env.barkAPI;
    const barkDeviceToken = process.env.BARK_DEVICE_TOKEN || process.env.barkDeviceToken;

    if (!barkApi) {
        throw new Error("缺少 Bark API，请设置环境变量 BARK_API 或 barkAPI。");
    }

    if (!barkDeviceToken) {
        throw new Error("缺少 Bark 设备 Token，请设置环境变量 BARK_DEVICE_TOKEN 或 barkDeviceToken。");
    }

    const openids = process.env.openid ? process.env.openid.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : [];
    const events = new EventEmitter<MainEvents>();
    const states = new Map<string, OpenIdState>();
    let currentOpenid: string | null = null;

    events.on("start", (openid) => {
        currentOpenid = openid;
        if (!states.has(openid)) {
            states.set(openid, { openid });
        }
    });

    events.on("signInResult", (openid, signInResult) => {
        const state = states.get(openid) || { openid };
        state.name = signInResult.userName;
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

    const orderedStates = openids.map((openid) => states.get(openid) || { openid });
    const lines = orderedStates.map((state) => buildContent(state));
    const mergedContent = lines.join("\n\n");

    await pushBark(barkApi, barkDeviceToken, mergedContent);
}

const entryFile = process.argv[1];
const isDirectRun = !!entryFile && import.meta.url === pathToFileURL(entryFile).href;

if (isDirectRun) {
    run().catch((error) => {
        console.error("bark-bot 执行失败:", error);
        process.exitCode = 1;
    });
}

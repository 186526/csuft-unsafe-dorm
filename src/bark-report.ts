import type { BarkUser } from "./bark-config";

export type SignState = {
    openid: string;
    name?: string;
    accountId?: string;
    taskName?: string;
    result?: string;
    time?: string;
    error?: string;
};

export type ReportEntry = {
    name: string;
    content: string;
    completed: boolean;
};

const COMPLETED_RESULTS = new Set(["签到成功", "已签到"]);

export function buildEntry(user: BarkUser, state: SignState): ReportEntry {
    const name = state.name || user.name || user.openid;
    const accountId = state.accountId || "未知学号";
    const taskName = state.taskName || "未知任务";
    const result = state.error ? `失败(${state.error})` : (state.result || "未知");
    const time = state.time || new Date().toLocaleString();

    return {
        name,
        completed: state.result !== undefined && COMPLETED_RESULTS.has(state.result),
        content: `签到信息：${name}#${accountId}, 签到条目：${taskName}, 签到结果：${result}, 签到时间：${time}`,
    };
}

export function buildTitle(entries: ReportEntry[]): string {
    const total = entries.length;
    const completed = entries.filter((entry) => entry.completed).length;
    const attention = total - completed;

    return `平安打卡状态推送（应打卡 ${total} 人，实际完成打卡 ${completed} 人，需关注 ${attention} 人）`;
}

export function joinContents(entries: ReportEntry[]): string {
    return entries.map((entry) => entry.content).join("\n\n");
}

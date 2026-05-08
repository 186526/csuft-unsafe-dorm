import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 定时任务配置只负责“何时触发”，真正是否执行签到仍由运行脚本结合当天规则判断。
export type ScheduleMode = 'daily' | 'weekdays' | 'dates';
export type ScheduleResult = 'success' | 'failure' | 'skipped' | null;

export type ScheduleConfig = {
    enabled: boolean;
    mode: ScheduleMode;
    time: string;
    dates: string[];
    timezone: string;
    lastAttemptDate: string | null;
    lastAttemptAt: string | null;
    lastSuccessDate: string | null;
    lastSuccessAt: string | null;
    lastResult: ScheduleResult;
    lastMessage: string | null;
    nextRunAt: string | null;
};

const ROOT = process.cwd();
const TOOL_HOME = path.join(ROOT, '.codex-tools');
export const SCHEDULE_PATH = path.join(TOOL_HOME, 'schedule.json');

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
});

function normalizeDate(value: string) {
    return value.trim().slice(0, 10);
}

export function defaultScheduleConfig(): ScheduleConfig {
    return {
        enabled: false,
        mode: 'daily',
        time: '21:05',
        dates: [],
        timezone: 'Asia/Shanghai',
        lastAttemptDate: null,
        lastAttemptAt: null,
        lastSuccessDate: null,
        lastSuccessAt: null,
        lastResult: null,
        lastMessage: null,
        nextRunAt: null,
    };
}

export function getShanghaiDate(date = new Date()) {
    return DATE_FORMATTER.format(date);
}

export function getShanghaiWeekday(date = new Date()) {
    return WEEKDAY_FORMATTER.format(date);
}

export function isValidTime(value: string) {
    return /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(3, 5)) < 60;
}

export function matchesScheduleOnDate(config: ScheduleConfig, dateString: string) {
    if (config.mode === 'daily') {
        return true;
    }

    if (config.mode === 'weekdays') {
        const weekday = getShanghaiWeekday(new Date(`${dateString}T00:00:00+08:00`));
        return weekday !== 'Sat' && weekday !== 'Sun';
    }

    return config.dates.includes(dateString);
}

export function computeNextRunAt(config: ScheduleConfig, from = new Date()) {
    // 这里按上海时区推导下一次触发时间，和 node-cron 的每日触发规则保持一致。
    if (!config.enabled || !isValidTime(config.time)) {
        return null;
    }

    const [hours, minutes] = config.time.split(':').map(Number);

    for (let offset = 0; offset < 400; offset++) {
        const probe = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000);
        const dateString = getShanghaiDate(probe);
        if (!matchesScheduleOnDate(config, dateString)) {
            continue;
        }

        const candidate = new Date(`${dateString}T${config.time}:00+08:00`);
        if (offset > 0 || candidate.getTime() > from.getTime()) {
            return candidate.toISOString();
        }

        if (offset === 0 && hours === from.getHours() && minutes > from.getMinutes()) {
            return candidate.toISOString();
        }
    }

    return null;
}

export function sanitizeScheduleConfig(input: Partial<ScheduleConfig>): ScheduleConfig {
    const config = defaultScheduleConfig();
    config.enabled = input.enabled ?? config.enabled;
    config.mode = input.mode ?? config.mode;
    config.time = input.time ?? config.time;
    config.dates = Array.from(new Set((input.dates ?? []).map(normalizeDate).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))).sort();
    config.timezone = 'Asia/Shanghai';
    config.lastAttemptDate = input.lastAttemptDate ?? null;
    config.lastAttemptAt = input.lastAttemptAt ?? null;
    config.lastSuccessDate = input.lastSuccessDate ?? null;
    config.lastSuccessAt = input.lastSuccessAt ?? null;
    config.lastResult = input.lastResult ?? null;
    config.lastMessage = input.lastMessage ?? null;
    config.nextRunAt = computeNextRunAt(config);
    return config;
}

export async function loadScheduleConfig() {
    if (!existsSync(SCHEDULE_PATH)) {
        return sanitizeScheduleConfig(defaultScheduleConfig());
    }

    const raw = await readFile(SCHEDULE_PATH, 'utf8');
    return sanitizeScheduleConfig(JSON.parse(raw) as Partial<ScheduleConfig>);
}

export async function saveScheduleConfig(input: Partial<ScheduleConfig>) {
    const merged = sanitizeScheduleConfig(input);
    await writeFile(SCHEDULE_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    return merged;
}

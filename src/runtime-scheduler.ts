import cron, { type ScheduledTask } from 'node-cron';
import { defaultScheduleConfig, type ScheduleConfig } from './scheduler.js';
import { runScheduledSignIn } from './scripts/schedule-runner.js';

type RuntimeScheduleStatus = {
    active: boolean;
    driver: 'node-cron';
    pattern: string | null;
    timezone: string;
    lastTriggeredAt: string | null;
};

let activeTask: ScheduledTask | null = null;
let runtimeStatus: RuntimeScheduleStatus = {
    active: false,
    driver: 'node-cron',
    pattern: null,
    timezone: defaultScheduleConfig().timezone,
    lastTriggeredAt: null,
};

function buildCronPattern(time: string) {
    const [hours, minutes] = time.split(':').map(Number);
    return `${minutes} ${hours} * * *`;
}

export function getRuntimeScheduleStatus(): RuntimeScheduleStatus {
    return { ...runtimeStatus };
}

export function applyRuntimeSchedule(config: ScheduleConfig) {
    if (activeTask) {
        activeTask.stop();
        activeTask.destroy();
        activeTask = null;
    }

    runtimeStatus = {
        active: false,
        driver: 'node-cron',
        pattern: null,
        timezone: config.timezone,
        lastTriggeredAt: runtimeStatus.lastTriggeredAt,
    };

    if (!config.enabled) {
        return runtimeStatus;
    }

    const pattern = buildCronPattern(config.time);
    activeTask = cron.schedule(
        pattern,
        async () => {
            runtimeStatus.lastTriggeredAt = new Date().toISOString();
            try {
                await runScheduledSignIn();
            }
            catch (error) {
                console.error('Scheduled cron run failed:', error);
            }
        },
        {
            timezone: config.timezone,
        },
    );

    runtimeStatus = {
        active: true,
        driver: 'node-cron',
        pattern,
        timezone: config.timezone,
        lastTriggeredAt: runtimeStatus.lastTriggeredAt,
    };

    return getRuntimeScheduleStatus();
}

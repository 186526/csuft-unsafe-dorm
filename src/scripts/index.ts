import unsafeDorm, { getDistance } from '../index';
import process from "node:process";
import 'dotenv/config';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

if (!process.env.openid) {
    throw new Error("请在环境变量中设置 openid。");
}

const openids = process.env.openid.split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

if (openids.length === 0) {
    throw new Error("请在环境变量中设置至少一个有效的 openid。");
}

for (const openid of openids) {

    let waitingTime = 5000 + Math.random() * 2500;
    console.log("等待", (waitingTime/1000).toFixed(1), "秒中, 避免风控...\n");

    await sleep(waitingTime);
    console.log("开始执行下一个 openid（如果有）。\n");

    const App = new unsafeDorm({
        openId: openid,
    });

    try {
        console.log("开始执行登录，目前时间:", new Date().toLocaleString());
        console.log("正在登录... openId:", openid);

        const signInResult = await App.signInWithOpenId();
        console.log("登录成功！", signInResult.userName, "@", signInResult.schoolName, "#", signInResult.accountNo);
        waitingTime = 1000 + Math.random() * 2000;
        console.log("登录成功，等待", (waitingTime/1000).toFixed(1), "秒，获取任务信息...");

        await sleep(waitingTime);
        const taskInfos = await App.listTask();
        waitingTime = 1000 + Math.random() * 2000;
        console.log("获取任务信息列表成功！等待", (waitingTime/1000).toFixed(1), "秒，仅尝试选择第 1 项获取任务信息:", taskInfos[0].taskName, taskInfos[0].taskId);

        await sleep(waitingTime);
        const taskDetail = await App.getTask(taskInfos[0].taskId);
        waitingTime = 1000 + Math.random() * 2000;
        console.log("获取任务详情成功！可签到时间:", taskDetail.signStartTime, "~", taskDetail.signEndTime);
        console.log("等待", (waitingTime/1000).toFixed(1), "秒，获取签到状态...");

        await sleep(waitingTime);
        const recordStatus = await App.getRecordStatus(taskDetail.taskId);
        console.log("获取签到状态成功！当前签到状态: ", recordStatus.signStatusName);

        if (recordStatus.signStatus === 0) {
            console.log("当前已签到，签到时间为:", recordStatus.signTime);
            console.log("跳过签到，继续下一个 openid（如果有）。\n");
            continue;
        }

        const signLat = parseFloat(taskDetail.dormitoryRegisterVO.locationLat) + Math.random() * 0.001,
            signLng = parseFloat(taskDetail.dormitoryRegisterVO.locationLng) + Math.random() * 0.001;


        console.log("将签到位置设置为: ", signLat, signLng);
        console.log("该签到位置距宿舍楼距离为: ", getDistance(
            signLat,
            signLng,
            parseFloat(taskDetail.dormitoryRegisterVO.locationLat),
            parseFloat(taskDetail.dormitoryRegisterVO.locationLng))
            , "m");

        waitingTime = 1000 + Math.random() * 2000;
        console.log("等待", (waitingTime/1000).toFixed(1), "秒，提交签到信息...");
        const request = await App.signRecord({
            taskId: taskDetail.taskId,
            signLat: signLat,
            signLng: signLng,
            roomId: taskDetail.dormitoryRegisterVO.roomId,
        });

        console.log("提交签到信息成功！", request);
    }
    catch (error) {
        console.error("发生错误！", error);
        console.log("请检查 openid 是否正确，或者是否在签到时间内，或者您已签到。");
    }

}

console.log("\n所有 openid 均已处理完成。");
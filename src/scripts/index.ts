import unsafeDorm, { getDistance } from '../index';
import process from "node:process";
import 'dotenv/config';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

if (!process.env.openid) {
    throw new Error("请在环境变量中设置 openid。");
}

const App = new unsafeDorm({
    openId: process.env.openid,
});

await App.signInWithOpenId();
await sleep(1000);
const taskInfos = await App.listTask();
await sleep(1000);
const taskDetail = await App.getTask(taskInfos[0].taskId);
await sleep(1000);

const signLat = parseFloat(taskDetail.dormitoryRegisterVO.locationLat) + Math.random() * 0.001,
    signLng = parseFloat(taskDetail.dormitoryRegisterVO.locationLng) + Math.random() * 0.001;

console.log("计算定位偏移 ", getDistance(
    signLat,
    signLng,
    parseFloat(taskDetail.dormitoryRegisterVO.locationLat),
    parseFloat(taskDetail.dormitoryRegisterVO.locationLng))
    , "m");

const request = await App.signRecord({
    taskId: taskDetail.taskId,
    signLat: signLat,
    signLng: signLng,
    roomId: taskDetail.dormitoryRegisterVO.roomId,
});

console.log(request);


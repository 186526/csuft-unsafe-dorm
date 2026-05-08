import axios from 'axios';
import * as constant from './constant.js';

import { createHash } from 'node:crypto';

import * as types from './types.js';

// 对学校接口的底层封装。
// 这里负责登录、读取任务详情、校验定位距离，并最终提交签到数据。
export function md5(data: string): string {
    return createHash('md5').update(data).digest('hex');
}

/**
 * getDistance 计算两点之间的距离
 *
 * @param latFromStudent 来自于定位的 Lat 信息
 * @param lngFromStudent 来自于定位的 Lng 信息
 * @param targetLat 宿舍楼的 Lat
 * @param targetLng 宿舍楼的 Lng
 * @returns 两点之间的距离
 */
export function getDistance(
    latFromStudent: number,
    lngFromStudent: number,
    targetLat: number,
    targetLng: number,
): number {
    var a = (latFromStudent * Math.PI) / 180,
        i = (targetLat * Math.PI) / 180,
        g = a - i,
        o = (lngFromStudent * Math.PI) / 180 - (targetLng * Math.PI) / 180,
        l =
            2 *
            Math.asin(
                Math.sqrt(
                    Math.pow(Math.sin(g / 2), 2) +
                    Math.cos(a) *
                    Math.cos(i) *
                    Math.pow(Math.sin(o / 2), 2),
                ),
            );
    return ((l *= 6378.137), (l = Math.round(1e4 * l) / 10));
}

export class unsafeDorm {
    private readonly baseUrl = constant.BASE_API_URL;

    // username 即为学号
    public username: string;
    // password in md5;
    private password: string;
    // openId 需要抓包获取
    private openId: string;
    private isAuthenticated: boolean = false;

    public userAgent: string = constant.RANDOM_UA();

    private authInfo!: types.AuthTokenResponse;

    public taskList: {
        [taskId: string]: types.TaskInfo;
    } = {};

    public recordList: {
        [taskId: string]: types.RecordStatus;
    } = {};

    constructor({
        username,
        password,
        openId,
    }: {
        username?: string;
        password?: string;
        openId: string;
    }) {
        this.username = username ?? "";
        this.password = md5(password ?? "") ?? "";
        this.openId = openId;
    }

    /**
     * calculates the sign header for the request, which is required for authentication.
     *
     * `FlySource-sign` = md5(url_with_out_query_params+"?sign="+md5(timestamp+access-key))+"1."+base64(timestamp);
     *
     * `FlySource-Auth` = access-key;
     *
     * `Authorization` = "Basic "+base64(clientId+":"+clientSecret);
     *
     * @param url the request url, e.g. https://simp.csuft.edu.cn/api/
     * @param token the access key, which from the sign-in request.
     *
     * @return the sign header value, which is used for authentication. place it in FlySource-Sign.
     */

    public calcSignHeader(
        url: string,
        token: string,
        timestamp?: string,
    ): string {
        // REF TO GH:Feather-P/ahut-dorm-sign
        const nowTimeStamp = timestamp || new Date().getTime().toString();

        const firstHash = md5(`${nowTimeStamp}${token}`);

        // only need path here.
        // - `https://a.com/api/x?y=1` -> `/api/x`
        // - `/api/x?y=1` -> `/api/x`
        const urlObj = new URL(url, 'https://simp.csuft.edu.cn');

        const secondHash = md5(`${urlObj.pathname}?sign=${firstHash}`);

        return `${secondHash}1.${Buffer.from(nowTimeStamp).toString('base64')}`;
    }

    async captcha(): Promise<{
        key: string;
        /** img is png file in base64, already have header data:image/png;base64, */
        img: string;
    }> {
        const request = await axios.get(
            `${this.baseUrl}${constant.CAPTCHA_API_URL}`,
            {
                headers: {
                    'User-Agent': constant.RANDOM_UA(),
                },
            },
        );

        return {
            key: request.data.key,
            img: request.data.image,
        };
    }

    /**
     * Sign in with username & password, may need captcha.
     * Never work when account is binding with WeChat. Use signInWithOpenId instead.
     *
     * @returns
     * 
     * @deprecated This method never work because the server only authorize wechat openId now.
     */
    async signIn() {
        const postBody = {
            username: this.username,
            password: this.password,
            // 000000 is the default now.
            tenantId: '000000',
            type: 'account',
            grant_type: 'password',
            scope: 'all',
        };

        console.log(postBody);

        const request = await axios.post(
            `${this.baseUrl}${constant.LOGIN_API_URL}`,
            postBody,
            {
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Tenant-Id': '000000',
                    // 'Captcha-Key': captchaKey,
                    // 'Captcha-Code': captchaCode,
                    Authorization: `Basic ${constant.BASE_TOKEN_FOR_AUTHORIZATION}`,
                    referer:
                        'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
                },
            },
        );

        this.authInfo = request.data;
        this.isAuthenticated = true;

        return this.authInfo;
    }

    async signInWithOpenId() {
        const request = await axios.post(
            `${this.baseUrl}${constant.LOGIN_API_URL}`,
            {
                // 000000 is the default now.
                tenantId: '000000',
                // wxapp is the default now.
                grant_type: 'wxapp',
                username: '',
                password: '',
                scope: 'all',

                bindState: 0,
                openid: this.openId,
            },
            {
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Tenant-Id': '000000',
                    'Web-Type': 'wxapp',
                    Authorization: `Basic ${constant.BASE_TOKEN_FOR_AUTHORIZATION}`,
                    referer:
                        'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
                },
            },
        );

        this.authInfo = request.data;
        this.isAuthenticated = true;
        return this.authInfo;
    }

    async signInWithAccessToken(token: string) {
        this.authInfo = {
            access_token: token,
            token_type: 'bearer',
            refresh_token: '',
            expires_in: 0,
            scope: '',
            passWordLevel: 0,
            avatarUrl: '',
            accountType: 0,
            userName: '',
            roleType: '',
            userId: '',
            lastLoginTime: '',
            oauthId: null,
            accountNo: '',
            tenantId: '',
            roleName: '',
            userType: 0,
            detail: {
                sysAuthType: '',
                isSysUserSecondAuth: false,
            },
            schoolName: '',
            jti: '',
        };

        this.isAuthenticated = true;
        return this.authInfo;
    }

    isTokenValid(): boolean {
        if (!this.isAuthenticated) return false;

        return true;
    }

    async listTask(
        currentPage: number = 1,
        pageSize: number = 10,
    ): Promise<types.TaskInfo[]> {
        if (!this.isTokenValid()) {
            throw new Error('Token is invalid, please sign in first.');
        }

        const requestUrl = `${this.baseUrl}${constant.LIST_TASK_API_URL}?current=${currentPage}&size=${pageSize}`;

        const request = await axios.get(requestUrl, {
            headers: {
                'User-Agent': this.userAgent,
                Authorization: `Basic ${constant.BASE_TOKEN_FOR_AUTHORIZATION}`,
                'Flysource-Sign': this.calcSignHeader(
                    requestUrl,
                    this.authInfo.access_token,
                ),
                'Flysource-Auth': this.authInfo.access_token,
                Referer:
                    'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
            },
        });

        request.data.data.records.forEach((task: types.TaskInfo) => {
            this.taskList[task.taskId] = task;
        });

        return request.data.data.records;
    }

    async getTask(taskId: string): Promise<types.TaskDetails> {
        if (!this.isTokenValid()) {
            throw new Error('Token is invalid, please sign in first.');
        }

        const requestUrl = `${this.baseUrl}${constant.GET_TASK_API_URL}?taskId=${taskId}`;

        const request = await axios.get(requestUrl, {
            headers: {
                'User-Agent': this.userAgent,
                Authorization: `Basic ${constant.BASE_TOKEN_FOR_AUTHORIZATION}`,
                'Flysource-Sign': this.calcSignHeader(
                    requestUrl,
                    this.authInfo.access_token,
                ),
                'Flysource-Auth': this.authInfo.access_token,
                Referer:
                    'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
            },
        });

        if (!request.data.success) {
            throw new Error('Failed to get task detail.');
        }

        if (request.data.data.taskId != taskId) {
            throw new Error('Task ID mismatch.');
        }

        this.taskList[taskId] = request.data.data;

        return request.data.data;
    }

    public async getRecordStatus(taskId: string): Promise<types.RecordStatus> {
        if (!this.isTokenValid()) {
            throw new Error('Token is invalid, please sign in first.');
        }

        const requestUrl = `${this.baseUrl}${constant.GET_RECORD_STATUS_API_URL}?taskId=${taskId}`;

        const request = await axios.get(requestUrl, {
            headers: {
                'User-Agent': this.userAgent,
                'Flysource-Sign': this.calcSignHeader(
                    requestUrl,
                    this.authInfo.access_token,
                ),
                'Flysource-Auth': this.authInfo.access_token,
                Referer:
                    'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
            },
        });

        if (!request.data.success) {
            throw new Error('Failed to get record status.');
        }

        this.recordList[taskId] = request.data.data;

        return this.recordList[taskId];
    }

    public async signRecord({
        taskId,
        signLat,
        signLng,
        roomId,
    }: {
        taskId: string;
        signLat: string | number;
        signLng: string | number;
        roomId: string;
    }): Promise<boolean> {
        if (!this.isTokenValid()) {
            throw new Error('Token is invalid, please sign in first.');
        }

        if (this.taskList[taskId] == undefined) {
            await this.getTask(taskId);
        }

        const processedLat = parseFloat(
            parseFloat(signLat.toString()).toFixed(6),
        ),
            processedLng = parseFloat(
                parseFloat(signLng.toString()).toFixed(6),
            );

        // Check Record Status

        const recordStatus = await this.getRecordStatus(taskId);

        if (recordStatus.signStatus != 3) {
            throw new Error(
                'Record status is not normal unsigned, may be already signed or not allowed to sign.',
            );
        }

        const taskInfo = this.taskList[taskId];

        // Check Location & Dorm Info

        if (taskInfo.dormitoryRegisterVO == undefined) {
            throw new Error('Task does not have dormitory register info.');
        }

        if (
            taskInfo.dormitoryRegisterVO.locationLat == undefined ||
            taskInfo.dormitoryRegisterVO.locationLng == undefined
        ) {
            throw new Error('Task does not have dormitory location info.');
        }

        // 宿舍基准经纬度来自任务详情里的 dormitoryRegisterVO，不是项目里写死的常量。
        const dormLat = taskInfo.dormitoryRegisterVO.locationLat,
            dormLng = taskInfo.dormitoryRegisterVO.locationLng;

        const locationAccuracy = getDistance(
            processedLat,
            processedLng,
            parseFloat(dormLat.toString()),
            parseFloat(dormLng.toString()),
        );

        if (locationAccuracy >= parseFloat(taskInfo.locationAccuracy)) {
            throw new Error(
                `Location accuracy ${locationAccuracy} is too low, not allowed to sign record.`,
            );
        }

        if (roomId != taskInfo.dormitoryRegisterVO.roomId) {
            throw new Error(
                `roomId ${roomId} is not same as roomId in taskInfo, may enter a wrong roomId`,
            );
        }

        // Check Photo Requirement

        if (taskInfo.openTakePhoto == 1) {
            throw new Error(
                'Task requires photo, which is not supported in current version.',
            );
        }

        // Check Time

        const now = new Date();

        // Notice: Sign start & end in UTC+8.
        const signStartTime = new Date(
            `${recordStatus.signDate}T${taskInfo.signStartTime}+0800`,
        );
        const signEndTime = new Date(
            `${recordStatus.signDate}T${taskInfo.signEndTime}+0800`,
        );

        if (now < signStartTime || now > signEndTime) {
            throw new Error(
                `Current time ${now.toISOString()} is not within sign time range ${signStartTime.toISOString()} - ${signEndTime.toISOString()}.`,
            );
        }

        const stuSignData: types.stuSignData = {
            taskId,
            scanType: taskInfo.scanType,
            roomId,
            isLateStuTakePhoto: taskInfo.isLateStuTakePhoto,
            signLat: processedLat,
            signLng: processedLng,
            locationAccuracy,
            stuTaskId: md5(
                JSON.stringify({
                    latitude: processedLat.toString(),
                    longitude: processedLng.toString(),
                    locationAccuracy: locationAccuracy.toString(),
                    signDate: recordStatus.signDate,
                    taskId,
                    fileId: '',
                }),
            ),
            signType: 0,
            scanCode: '',
        };

        const requestUrl = `${this.baseUrl}${constant.SIGN_RECORD_API_URL}`;

        const request = await axios.post(requestUrl, stuSignData, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': this.userAgent,
                'Flysource-Sign': this.calcSignHeader(
                    requestUrl,
                    this.authInfo.access_token,
                ),
                'Flysource-Auth': this.authInfo.access_token,
                Referer:
                    'https://servicewechat.com/wx0e47c34c9982aa09/7/page-frame.html',
            },
        });

        if (!request.data.success) {
            throw new Error(`Failed to sign record, message: ${request.data}`);
        }

        const recheckRecordStatus = await this.getRecordStatus(taskId);

        if (recheckRecordStatus.signStatus != 0) {
            throw new Error(
                'After upload sign record, record status is still not signed, may be failed to sign record.',
            );
        }

        return true;
    }
}

export default unsafeDorm;

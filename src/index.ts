import axios from 'axios';
import * as constant from './constant';

import { createHash } from 'node:crypto';

import * as types from './types';

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

    constructor({
        username,
        password,
        openId,
    }: {
        username: string;
        password: string;
        openId: string;
    }) {
        this.username = username;
        this.password = md5(password);
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
     * @param captchaKey captcha key from captcha api
     * @param captchaCode captcha code from user input
     * @returns
     */
    async signIn(captchaKey: string, captchaCode: string) {
        const request = await axios.post(
            `${this.baseUrl}${constant.LOGIN_API_URL}`,
            {
                username: this.username,
                password: this.password,
                // 000000 is the default now.
                tenantId: '000000',
                // wxapp is the default now.
                grant_type: 'wxapp',
                scope: 'all',
            },
            {
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Tenant-Id': '000000',
                    'Captcha-Key': captchaKey,
                    'Captcha-Code': captchaCode,
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

    isTokenValid(): boolean {
        if (!this.isAuthenticated) return false;

        return true;
    }

    async listTask(currentPage: number = 1, pageSize: number = 10) {
        if (!this.isTokenValid()) {
            throw new Error('Token is invalid, please sign in first.');
        }

        const requestUrl = `${this.baseUrl}${constant.LIST_TASK_API_URL}?current=${currentPage}&size=${pageSize}`;

        const request = axios.get(requestUrl, {
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

        return request;
    }
}

export default unsafeDorm;

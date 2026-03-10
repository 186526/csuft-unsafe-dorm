import { md5, getDistance } from './index';

interface stuSignData {
    taskId: String; // taskId 平安打卡项目 ID
    scanType: String; // taskInfo.scanType 晚打卡项目疑似为 1
    roomId: String; // taskInfo.dormitoryRegisterVO.roomId, 分配的房间 Id，Int.length==36
    isLateStuTakePhoto: String; // taskInfo.isLateStuTakePhoto, 目前为 0
    signLat: String; // Like "28.1310867391577"
    signLng: String; // Like "112.994658417835"

    locationAccuracy: ReturnType<typeof getDistance>; // 计算出来的距离，单位为米

    stuTaskId: ReturnType<typeof md5>; // md5(JSON.stringify({ latitude, longitude, locationAccuracy, signDate, taskId, fileId? }))
    // signDate in "YYYY-mm-dd"

    // fileId 同下
    fileId?: string; // 拍照并上传 OSS 成功后返回

    signType: 0; // 提交前固定赋值为 0
    scanCode: ''; // 提交前固定赋值为空字符串
}

export interface AuthDetail {
    sysAuthType: string;
    isSysUserSecondAuth: boolean;
}

export interface AuthTokenResponse {
    access_token: string;
    token_type: 'bearer' | string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    passWordLevel: number;
    avatarUrl: string;
    accountType: number;
    userName: string;
    roleType: string;
    userId: string;
    lastLoginTime: string;
    oauthId: string | null;
    accountNo: string;
    tenantId: string;
    roleName: string;
    userType: number;
    detail: AuthDetail;
    schoolName: string;
    jti: string;
}

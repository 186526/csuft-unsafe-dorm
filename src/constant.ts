// 你螺专考勤 BASE API URL
export const BASE_API_URL = 'https://simp.csuft.edu.cn/api/';

// UA List

export const UA_LIST = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541739) XWEB/18955',
];

export const RANDOM_UA = () =>
    UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

// base64(clientId+":"+clientSecret)
export const BASE_TOKEN_FOR_AUTHORIZATION = `Zmx5c291cmNlX3dpc2Vfd3hhcHA6REE3ODhhc2RVRGpuYXNkX2ZseXNvdXJjZV93eGFwcGRzZGFkREFJVWl1d3Fl`;

export const CAPTCHA_API_URL = 'flySource-auth/captcha';
export const LOGIN_API_URL = 'flySource-auth/oauth/token';
export const LIST_TASK_API_URL = 'flySource-yxgl/dormSignTask/getListForApp';

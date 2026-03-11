import { md5, getDistance } from './index';

export interface stuSignData {
    taskId: string; // taskId 平安打卡项目 ID
    scanType: string; // taskInfo.scanType 晚打卡项目疑似为 1
    roomId: string; // taskInfo.dormitoryRegisterVO.roomId, 分配的房间 Id，Int.length==36
    isLateStuTakePhoto: number; // taskInfo.isLateStuTakePhoto, 目前为 0
    signLat: string; // Like "28.1310867391577"
    signLng: string; // Like "112.994658417835"

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

export interface DormitoryRegisterDetail {
    bedId: string;
    userId: string;
    createTime: string;
    createUser: string;
    isQuote: number;
    userDataSql: string;
    userDataType: string;
    secretFlag: string;
    secretDataSql: string;
    teaSecretDataSql: string;
    checkField: boolean;
    xn: string | number | null;
    xqM: string;
    grade: number | null;
    departmentId: string;
    dwmc: string;
    majorId: string;
    zymc: string;
    classId: string;
    bjmc: string;
    userDwmc: string;
    pyccm: string;
    pyccmName: string;
    mentorId: string;
    xm: string;
    xh: string;
    xbm: string;
    xbmName: string;
    xsztM: string;
    zxztM: string;
    xjztM: string;
    xsztMName: string;
    zxztMName: string;
    xjztMName: string;
    khhM: string;
    khhMName: string;
    yhkh: string;
    deptId: string;
    xqmc: string;
    campusId: string;
    deptName: string;
    dormId: string;
    dormNo: string;
    dormName: string;
    unitId: string;
    unitNo: number;
    unitName: string;
    floorId: string;
    floorNo: number;
    floorName: string;
    roomId: string;
    roomNo: string;
    sexType: number;
    sexTypeName: string;
    dormLevelId: string;
    dormLevelName: string;
    dormLevelFees: string;
    bedNo: string;
    bedType: number;
    bedStatus: number;
    bedStatusName: string;
    bedName: string;
    regStatus: number;
    regStatusName: string;
    isLoc: number;
    isLocName: string;
    status: number | string | null;
    checkId: string;
    statusName: string;
    luserId: string;
    laUserId: string;
    lssUserId: string;
    checkDate: string;
    viewType: number;
    ksh: string;
    fdy: string;
    fdySjhm: string;
    dormMaster: string;
    mobilePhone: string;
    stayStatus: string;
    changeType: number;
    retreatType: number;
    sfzjh: string;
    sjhm: string;
    locationPlace: string;
    /** 宿舍所在经度 */
    locationLat: string;
    /** 宿舍所在纬度 */
    locationLng: string;
    locationState: string;
    notReg: boolean;
    mixRoom: boolean;
    majorChange: boolean;
    stuNum: number | null;
    roomTypeId: string;
    typeName: string;
    bunkBed: string;
    bunkBedName: string;
    roomStatus: string;
    fdyNo: string;
    fdyName: string;
    fdyMobilePhone: string;
    roomNoOrName: string;
    fileId: string;
    remark: string;
    roleType: string;
    handleSuggest: string;
}

export type DormitoryRegisterVO = Partial<DormitoryRegisterDetail>;

export interface TaskInfo {
    taskId: string;
    taskName: string;
    taskStartDate: string;
    taskEndDate: string;
    taskType: string;
    /**
     * 打卡开始时间，格式为 "HH:mm:ss"
     */
    signStartTime: string;
    /**
     * 打卡结束时间，格式为 "HH:mm:ss"
     */
    signEndTime: string;
    autoSign: number;
    openLocate: number;
    /**
     * 要求定位精度，精确到米
     */
    locationAccuracy: string;
    scanSign: number;
    openRemind: number;
    remindTime: number;
    signWeek: string;
    taskStatus: number;
    codeRefreshTime: number | null;
    // 是否需要进行拍照，0 代表不需要，1 代表需要
    openTakePhoto: number | null;
    /**
     * 辅导员？何意味
     */
    isFdy: number;
    fdyTime: string;
    isUser: number;
    userTime: string;
    isNextDay: number;
    nextDayTime: string;
    isDormMaster: number;
    dormMasterTime: string;
    isAllowFdyEdit: number;
    isStaySchoolTask: number;
    scanType: string;
    isAllowSpecialSign: number;
    isLateStuTakePhoto: number;
    isAllowFdyAddWhiteList: number;
    allowLateSignTime: string;
    useStaySchModule: number;
    isFdyBefore: number;
    fdyBeforeTime: string;
    createTime: string;
    createUser: string;
    updateTime: string;
    updateUser: string;
    isQuote: number;
    checkField: boolean;
    userDataSql: string;
    userDataType: string;
    taskTypeName: string;
    grade: number;
    userId: string;
    leaveUserId: string;
    signDate: string;
    leaderUser: string;
    notSignDates: string[];
    dormitoryRegisterVO: DormitoryRegisterVO;
    leader: boolean;
    leaveFlag: boolean;
    locFlag: boolean;
    lxFlag: boolean;
    wsFlag: boolean;
    bmdFlag: boolean;
    yqdCount: number;
    qdCount: number;
    wqdCount: number;
    wqdwqrCount: number;
    wqdyqrCount: number;
    leaveCount: number;
    cdCount: number;
    cdwqrCount: number;
    cdyqrCount: number;
    nowDate: string;
    scanTypeName: string;
    departmentId: string;
    majorId: string;
    classId: string;
}

export interface TaskDetails extends TaskInfo {
    dormitoryRegisterVO: DormitoryRegisterDetail;
}

export type TaskRecord = TaskInfo;

export interface TaskListData {
    records: TaskInfo[];
    total: number;
    size: number;
    current: number;
    pages: number;
}

export interface ApiResponse<T> {
    code: number;
    success: boolean;
    data: T;
    msg: string;
}

export type TaskListResponse = ApiResponse<TaskListData>;

export type TaskDetailResponse = ApiResponse<TaskInfo>;

export interface RecordStatus {
    id: string;
    taskId: string;
    userId: string;
    /** 本次签到任务需签到的日期，in "YYYY-MM-DD" */
    signDate: string;
    signTime: string;
    signAddress: string;
    signLat: string;
    signLng: string;
    leadUserId: string;
    signType: number;
    /**
     * signStauts:
     * 0 - 正常签到
     * 1 - ？
     * 2 - ？
     * 3 - 还未签到
     */
    signStatus: number;
    signWeek: string;
    locationAccuracy: string;
    fileId: string;
    isFdyEdit: number;
    roomId: string;
    createTime: string;
    createUser: string;
    updateTime: string;
    updateUser: string;
    secondValidateStatus: number;
    scanCode: string;
    checkResult: string;
    situation: string;
    otherReason: string;
    isLateSign: number;
    lateSignTime: string;
    isQuote: number;
    checkField: boolean;
    userDataSql: string;
    userDataType: string;
    isShowBtn: boolean;
    isLateSignName: string;
    signStatusName: string;
    startDate: string;
    endDate: string;
    leaveStart: string;
    leaveEnd: string;
    startTime: string;
    endTime: string;
    type: string;
    taskType: number;
    taskName: string;
    xh: string;
    xm: string;
    xbm: string;
    xbmName: string;
    bjmc: string;
    zymc: string;
    dwmc: string;
    grade: number;
    noticeUserId: string;
    userNum: number;
    dormId: string;
    dormName: string;
    dormInfo: string;
    callbackDate: string;
    callbackTime: string;
    allowLateSignTime: string;
    sj: string;
    signStartTime: string;
    signEndTime: string;
}

export type RecordStatusResponse = ApiResponse<RecordStatus>;

# running csuft-unsafe-dorm as script

csuft-unsafe-dorm 作为一个库，在 `src/scripts/index.ts` 提供了一个默认的 autosign script 实现。

如果仅需要基础的虚拟签到，可以直接运行 `yarn run script` 来执行这个脚本。

下列是详细的配置说明：

1. 环境准备
    - 确保你已经安装了 Node.js 和 Yarn。

2. 安装依赖
    - 使用 git 克隆项目到本地：

        ```bash
        git clone https://github.com/186526/csuft-unsafe-dorm
        ```

    - 进入项目目录并安装依赖：

        ```bash
        cd csuft-unsafe-dorm
        yarn
        ```

3. 抓取 OpenId 信息

    > 目前由于服务器配置无法实现直接使用账号密码登录，因此需要使用 OpenId 来进行鉴权。  
    > 由于你专仅允许了 wxapp 的 OpenId 作为唯一的 OAuth 鉴权方式，所以请确保你已经在小程序中登录并绑定过。

    运行 `yarn capture:openid`，按提示在微信小程序中退出登录再重新登录一次，命令会输出你的 OpenID。详细步骤、环境要求和 WMPFDebugger 备用方案见 [OpenID 抓取指南](./openid.md)。

    请注意，我们绝对不会获取你的个人隐私，仅使用 OpenId 作为鉴权工具。

4. 配置环境变量
    - 在项目根目录下创建一个 `.env` 文件，并添加以下内容：

        ```env
        openid=${你的OpenId}
        ```

    - 替换 `${你的OpenId}` 为你在上一步中获取的 OpenId。

5. 运行脚本
    - 运行以下命令来执行脚本：

        ```bash
        > yarn run script
        yarn run v1.22.22
        $ tsx src/scripts/index.ts
        计算定位偏移  109.9 m
        true
        Done in 4.84s.
        ```

    - 脚本会自动使用你提供的 OpenId 进行鉴权，并执行签到操作。

6. 配置 crontab
    - 如果你希望定期自动执行签到，可以使用 crontab 来设置定时任务。
    - 运行以下命令来编辑 crontab：

        ```bash
        crontab -e
        ```

    - 在 crontab 文件中添加以下行来每天晚上 10 点执行脚本：（请先检查你的系统时间和时区设置，确保定时任务在正确的时间执行）

        ```bash
        0 22 * * * cd /path/to/csuft-unsafe-dorm && yarn run script >> /path/to/logfile.log 2>&1
        ```

    - 替换 `/path/to/csuft-unsafe-dorm` 为你本地项目的实际路径，替换 `/path/to/logfile.log` 为你希望保存日志的文件路径。

7. 使用 systemd user timer 定时执行 Bark 推送脚本
    - 仓库中有一个使用 Bark 作为推送服务器的示例脚本 `src/scripts/bark-bot.ts`，你可以通过 `yarn run script:bark` 来运行它。脚本从 YAML 文件读取配置，示例见仓库根目录的 `bark.example.yaml`。

    - 仓库已提供示例 unit 文件：
        - `docs/systemd-user/csuft-unsafe-dorm-bark.service`
        - `docs/systemd-user/csuft-unsafe-dorm-bark.timer`

    - 复制 unit 到用户目录：

        ```bash
        mkdir -p ~/.config/systemd/user
        cp docs/systemd-user/csuft-unsafe-dorm-bark.service ~/.config/systemd/user/
        cp docs/systemd-user/csuft-unsafe-dorm-bark.timer ~/.config/systemd/user/
        ```

    - 创建 Bark 配置文件：

        ```bash
        mkdir -p ~/.config/csuft-unsafe-dorm
        cp bark.example.yaml ~/.config/csuft-unsafe-dorm/bark.yaml
        ```

        按用户填写 `openid` 和 `bark.deviceKey`。`bark.globalDeviceKey` 接收一条包含所有人的汇总通知；每个填写了 `bark.deviceKey` 的用户再单独收到自己的状态。没有填写个人设备 key 的用户只出现在汇总通知中。

        两类通知的标题都是 `平安打卡状态推送（应打卡 N 人，实际完成打卡 N 人，需关注 N 人）`。汇总通知按全部用户统计；个人通知只统计该用户。`签到成功` 和 `已签到` 计入完成，其余结果计入需关注。

    - 按需修改 service 文件中的 `WorkingDirectory` 路径，确保与本地仓库路径一致。`BARK_CONFIG` 默认指向 `~/.config/csuft-unsafe-dorm/bark.yaml`，配置文件放在其它位置时同步修改。

    - 启用并立即运行一次：

        ```bash
        systemctl --user daemon-reload
        systemctl --user enable --now csuft-unsafe-dorm-bark.timer
        systemctl --user start csuft-unsafe-dorm-bark.service
        ```

    - 查看状态与日志：

        ```bash
        systemctl --user status csuft-unsafe-dorm-bark.timer
        journalctl --user -u csuft-unsafe-dorm-bark.service -n 100 --no-pager
        ```
    
若有任何疑问，请随时 `unsafe-dorm[AT]186.ee` 联系我，我会在有空闲时尽快回复你。

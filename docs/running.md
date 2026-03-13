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

    请先查阅 [OpenId 抓取指南](./openid.md) 来获取你在小程序的唯一标识符 OpenId。

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

若有任何疑问，请随时 `unsafe-dorm[AT]186.ee` 联系我，我会在有空闲时尽快回复你。

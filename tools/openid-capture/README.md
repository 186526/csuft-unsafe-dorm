# OpenID 抓取工具

独立运行的 mitmproxy 抓包工具，只做一件事：抓取微信小程序登录时 `getOpenidByJsCode` 响应里的 OpenID，并打印到标准输出。

这个目录不依赖项目其它代码，也不需要 `npm install`，可以整体复制到任意位置使用。

## 环境要求

- Node.js 20 或更高版本。
- Windows 或 macOS；Linux 需要 GNOME 桌面会话才能自动切换系统代理。
- 自动信任 mitmproxy 证书只在 Windows 和 macOS 上实现。
- 电脑版微信，以及微信中的“中南林业科技大学学生工作部”小程序。
- Python 3.12 或更高版本（首次运行时用来把 mitmproxy 安装到本工具目录）。
- pip 能访问 PyPI 或国内镜像源。

## 用法

```bash
node tools/openid-capture/cli.mjs
```

首次运行会在本目录的 `.cache/venv` 中安装 mitmproxy。安装完成后，工具会：

1. 启动 `mitmdump`，监听 `127.0.0.1:8866`。
2. 信任 mitmproxy CA 证书（Windows 加入当前用户根证书库）。
3. 把系统代理临时指向 `127.0.0.1:8866`。
4. 等待小程序请求，抓到 OpenID 后恢复原代理并退出。

在提示出现后，打开微信中的小程序，点击“我的”，退出登录后重新登录一次。抓到结果后，标准输出只有一行 OpenID，过程的提示都写到标准错误：

```bash
OPENID=$(node tools/openid-capture/cli.mjs)
```

## 选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--port <端口>` | `8866` | mitmproxy 监听端口。 |
| `--timeout <秒>` | `120` | 等待 OpenID 的超时时间。 |
| `--home <目录>` | `.cache` | 虚拟环境、日志和抓包文件的存放目录。 |
| `-h, --help` | | 显示帮助。 |

对应的环境变量：`OPENID_CAPTURE_HOME`、`MITM_PYTHON_PATH`、`PIP_INDEX_URL`、`PIP_TRUSTED_HOST`。

## 抓包文件与日志

- `.cache/openid-capture.jsonl`：每次匹配到的响应记录，包含 `matched_url`、`openid`、`response_text`。
- `.cache/mitmdump.log`：mitmdump 的输出。
- `~/.mitmproxy/`：mitmproxy 生成的 CA 证书与私钥。

## 注意事项

- 抓取期间不要关闭终端，程序会在结束或收到 Ctrl+C 时恢复原系统代理。
- 如果程序被强制结束，系统代理可能停留在 `127.0.0.1:8866`，需要手动关闭。
- Linux 上通过 GNOME 的 `gsettings` 切换系统代理，不需要 root；抓取结束后恢复原值。非 GNOME 桌面或没有桌面会话时，工具会提示手动设置代理。
- Linux 上不会自动信任 CA 证书。微信的小程序运行时 `WeChatAppEx` 使用 NSS 证书库，需要把 `~/.mitmproxy/mitmproxy-ca-cert.pem` 导入 `~/.pki/nssdb`，然后完全退出并重新打开微信：
  - 使用 Chrome 打开 `chrome://settings/certificates`，在“受信任的根证书颁发机构”中导入该文件。
  - 或安装 `libnss3-tools` 后执行 `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n mitmproxy -i ~/.mitmproxy/mitmproxy-ca-cert.pem`。
- 运行 `update-ca-certificates` 只会更新系统 OpenSSL 证书库。本机的 NSS 配置只加载 `libnssckbi.so`，系统证书库里的证书不会进入 NSS，微信仍会拒绝 mitmproxy 证书。
- 只应在自己信任的设备上使用。

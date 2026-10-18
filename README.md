# dsh-agent-gate

给 DeepSeek Harness（DSH）套一层「碟中谍」式的开场：打开 DSH 时全屏终端挡住界面，输入数字访问码才放行。

```
┌─ DSH // MISSION CONTROL ───────────────────────────┐
│ AGENT AUTHENTICATION                               │
│ 本次任务已加密。输入访问码以解除锁定 —— 6 位数字。    │
│                                                    │
│ > 建立加密信道 ... OK   TLS-1.3 / ECDHE            │
│ > 校验终端指纹 ... OK   DEVICE BOUND               │
│ > 加载身份档案 ... OK   AGENT FILE FOUND           │
│                                                    │
│ [■][■][■][■][□][□]                                 │
│                                                    │
│   1    2    3                                      │
│   4    5    6                                      │
│   7    8    9                                      │
│  CLR   0   ENTER                                   │
│                                                    │
│ STATUS AWAITING ACCESS CODE      ALT+L 立即上锁     │
└────────────────────────────────────────────────────┘
```

## 特性

- **全屏闸门**：挂在 `shell.overlay` 帧级槽位，切换会话 / 换面板都不会掉。
- **访问码在设置里管理**：设置 →「启动密码」，改码 / 开关 / 立即上锁 / 清除都在这一页。
- **连错锁定**：错 5 次进入冷却，15 秒起逐轮翻倍，最长 5 分钟。
- **不存明文**：PBKDF2-SHA256（12 万轮）派生后落盘到 `~/.dsh/agent-gate.json`，浏览器里不留任何明文或哈希。
- **会话级解锁**：刷新页面不用重输，彻底退出 DSH 重开才重新验证。
- **`Alt+L` 随手锁屏**：不用重开程序。
- **Fail-open**：宿主路由挂掉时给出提示并允许「继续进入」，绝不会把人锁在门外。

## 安装

插件由两半组成：`index.js`（宿主，注册校验路由）+ `client.js`（客户端，闸门与设置页）。

### 方式一：`plugin_manager`（推荐，如果有这个工具）

在带 `plugin_manager` 工具的 Harness 会话里，把这个目录作为 bundle 安装：

```
plugin_manager { action: "install_bundle", target: "<本目录绝对路径>" }
```

它会替你写好 profile 的 `package.json`，不需要手工改文件。

### 方式二：手工放进 profile

```bash
# 1) 拷进当前 profile 的 node_modules
cp -r dsh-agent-gate ~/.dsh/profiles/<profile>/node_modules/dsh-agent-gate

# 2) 把包名追加到 ~/.dsh/profiles/<profile>/package.json 的 dsh.profile.bundles 数组
#    "bundles": [ "...", "dsh-agent-gate" ]

# 3) 重启 DSH
```

插件自己带 `cordis.patch.yml`，会往配置树里 `insert` 一行，所以 **不需要**手改 profile 的 `cordis.patch.yml`。

## 使用

1. 第一次启动显示 `FIRST BOOT · AGENT ENROLLMENT`，设 4—8 位数字访问码。
2. 之后每次打开都要输入它。输满自动校验，也可以点小键盘。
3. 输错 → 面板红框抖动 + 剩余次数；输对 → 绿色 `ACCESS GRANTED` 后淡出。
4. `Alt+L` 随时重新上锁。
5. 改密码：设置 →「启动密码」。

### 忘了访问码

退出 DSH，删掉 `~/.dsh/agent-gate.json`（Windows：`%USERPROFILE%\.dsh\agent-gate.json`），重新打开回到「建立访问码」。

## 安全边界

这是**体验层的锁**，不是安全边界。它挡的是"随手打开就被看到"，挡不住会开 DevTools 的人：把遮罩节点删掉就进去了。

真正的权限控制仍然由 DSH 自己的沙箱与审批策略负责。别拿它当磁盘加密、密码管理器或账号密码用。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` + `dsh.client{platform, immediately, inject}` |
| `cordis.patch.yml` | `insert` 一行 `id: dsh-agent-gate` |
| `index.js` | 宿主：`status` / `verify` / `set` / `clear` / `toggle` 五条路由，PBKDF2 存储 |
| `client.js` | 客户端：`window.__ModuleLoader__.load` 注册 `shell.overlay` 闸门 + `settings.section` 设置页 |
| `icon.svg` | 插件图标 |

### HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-agent-gate/status` | `{enabled, configured, length, lockedFor, storePath}` |
| POST | `/dsh-agent-gate/verify` | `{pin}` → `{ok}` 或 `{ok:false, remaining \| lockedFor}` |
| POST | `/dsh-agent-gate/set` | `{pin, current}` → 设置 / 修改 |
| POST | `/dsh-agent-gate/clear` | `{current}` → 清除 |
| POST | `/dsh-agent-gate/toggle` | `{enabled, current}` → 开关闸门 |

## 兼容性

- 依赖 DSH Client 的四个服务：`slots`、`shell.overlay`、`settings.section`、`webServer`。
- 只 import `react`（由浏览器模块表提供）与 Node 内置模块，不依赖任何 Harness Client 包。
- 设置页只用主机主题变量（`--dsw-alias-*`），明暗主题都不会花屏。

## 已知限制

- 视觉未做跨主题逐项回归；如果遮罩在某些布局下只盖住一部分，欢迎提 issue 并附截图。
- 访问码是"本地校验 + 本地存储"，多台机器不同步。

## License

[MIT](./LICENSE)

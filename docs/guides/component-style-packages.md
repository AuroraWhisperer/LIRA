# 制作和导入 LIRA 本机素材套装

套装是图片、视频和一份分类清单。主播导入后，背景、弹幕装饰、时钟等会出现在各自的样式库中。媒体保存在应用数据目录，后续更新套装可单独发 ZIP，无需把大视频加入 EXE。

## 主播怎么用

1. 客户端「点歌 → 浏览器源 → 样式与套装 → 导入套装」，直接选择作者提供的 LIRA 套装 ZIP，无需解压或手动放目录。
2. 核对名称、版本和组件清单，确认导入。
3. 打开「直播场景 → 编辑场景」，在「添加组件 → 套装」按套装选成员，或在对应组件分类选择样式。每点一个卡片添加一个独立组件；也可直接从客户端的样式窗点击卡片进入画布。已有组件用「更换样式 / 添加素材」保留原位置和尺寸。
4. 调整布局后「保存并应用」。导入本身不会切换直播画面。

第三方购买的普通 ZIP 先自行解压，再从对应组件「＋ 添加样式」选择图片或视频、拖动内容区域。HTML/CSS/JS 或其他软件的专用模板不能通过素材导入执行；卖家提供的兼容网页链接可使用已有网页源入口。

卡片上的 × 只从可选样式库移除，不破坏已有场景引用，也不立即清理磁盘文件。已使用的图层在画布中删除。素材库是本机的，换电脑需要同时迁移应用数据；不要只复制场景或 EXE。

### 以月渡花汀为例

选择 `月渡花汀-1.0.0.zip` 后应看到 6 个样式：静态背景、动态背景、开播动画、时钟、弹幕姬、礼物许愿。背景两款按需选用，其他成员也可以单独添加，不必整套一起用。本包没有礼物感谢样式；其他套装的种类和数量以导入预览为准。

如果旧场景已经用了此前内置的月渡花汀，先导入 ZIP，再选中原图层，用「更换样式 / 添加素材」选择对应成员，最后「保存并应用」。锁定的图层需先解锁。这样会保留图层名称、位置、尺寸和层级，避免重建布局。

这些样式用于本机场景，OBS 或哔哩哔哩直播姬须与 LIRA 在同一电脑上运行，直播时保持 LIRA 开启。导入不会修改服务器弹幕姬链接。客户端内置教程位于「百宝箱 → 使用文档 → 直播姬 / OBS 与套装」，可搜索「套装」「ZIP」「月渡花汀」。

### 遇到问题

| 现象 | 处理方法 |
| --- | --- |
| 找不到「样式与套装」，或提示需要更新客户端 | 使用包含套装导入功能的客户端版本；月渡花汀还需要支持资源型套装。仓库版本号不代表对应功能已发布。 |
| 普通购买包提示缺少清单 | 先解压，再从对应组件「＋ 添加样式」逐个选图片、视频；不能把普通 ZIP 改名就当成 LIRA 套装。 |
| 导入成功，直播画面没变化 | 在画布选用样式，再点「保存并应用」；导入只增加可选样式。 |
| 误删样式卡片 | 重新导入原来的同一版本 ZIP，可恢复卡片；画布里删除的图层需重新添加。 |
| 同名同版本提示内容冲突 | 请作者提高包版本号后重新导出，不要覆盖旧包文件。不同版本并存，已有图层需自行更换样式。 |
| 旧场景提示套装资源缺失 | 先重新导入对应 ZIP，在原图层重新选择样式并保存应用；换电脑时还需迁移本机素材库。 |

## 作者目录与清单

ZIP **根目录**必须有 UTF-8 的 `lira-pack.json`，不要把整个文件夹再套一层。最小示例：

```text
my-suite.zip
├── lira-pack.json
├── assets/
│   ├── background.mp4
│   ├── chat-frame.png
│   ├── clock.png
│   ├── wishes.png
│   ├── opening.webm
│   └── thanks.webm
└── 使用说明.txt
```

```json
{
  "schemaVersion": 1,
  "id": "my-studio.moon-suite",
  "name": "月色直播套装",
  "version": "1.0.0",
  "styles": [
    { "type": "background", "name": "月色背景", "file": "assets/background.mp4", "width": 1920, "height": 1080 },
    {
      "type": "danmaku", "name": "月色弹幕框", "file": "assets/chat-frame.png", "width": 480, "height": 720,
      "media": { "content": { "x": 10, "y": 12, "width": 80, "height": 76 }, "textColor": "#ffffff", "fontSize": 28 }
    },
    { "type": "clock", "name": "月色时钟", "file": "assets/clock.png", "width": 640, "height": 360 },
    { "type": "gift-wishes", "name": "月色许愿", "file": "assets/wishes.png", "width": 640, "height": 240 },
    { "type": "opening", "name": "月色开播", "file": "assets/opening.webm", "width": 1920, "height": 1080 },
    {
      "type": "gift-frame", "name": "月色礼物感谢", "file": "assets/thanks.webm", "width": 1280, "height": 720,
      "media": { "showText": true, "textTemplate": "感谢 {name} 的 {gift} ×{count}", "textDelayMs": 1000, "volume": 0 }
    },
    {
      "type": "guard-thanks", "name": "月色大航海感谢", "file": "assets/thanks.webm", "width": 1280, "height": 720,
      "media": { "showText": true, "textTemplate": "感谢 {name} 开通{tier} · {months}个月" }
    }
  ]
}
```

`id` 使用小写字母、数字、点或短横线，数字或字母开头，最长 80 字符；`version` 使用三段数字。包名、样式名不超过 80 字。`file` 大小写必须和 ZIP 内一致，使用 `/` 相对路径。宽高写素材或设计画布尺寸，不决定主播最后摆放位置。相同文件可以供多个组件使用。

`media` 控制装饰和文字，字段详情与默认值见 [overlay 合同](../reference/frontend/overlays.md#本地媒体样式)。`content` 是相对整张素材的百分比区域，弹幕内容、时钟和许愿进度在里面显示。组件配置 `config` 可省略；需要提供时必须符合对应组件已有合同，不能加入账号、网址凭据或直播业务数据。导入服务生成素材 ID 和路径，清单无需填写这些值。

背景和装饰视频循环。开播动画跟随开播开关；感谢动画跟随客户端已有触发条件。事件图片默认显示 6 秒；事件视频默认播到结束、最长 120 秒，可用 `durationMs` 缩短。感谢视频不会自动取得卖家模板中的触发逻辑；姓名、礼物、数量由 LIRA 在预留区域绘制。已做死文字的素材可设置 `showText:false`。

## 打 ZIP 与检查

在套装文件夹内打开 PowerShell，运行下面的命令，把 ZIP 放在文件夹外：

```powershell
Compress-Archive -Path .\lira-pack.json, .\assets, .\使用说明.txt -DestinationPath ..\moon-suite-1.0.0.zip
```

没有说明文件时，删除命令中的该项。先在 LIRA 导入自己的包，逐个检查文字区域和视频，最后在实际使用的 OBS 或哔哩哔哩直播姬预览透明边缘、音量和比例。相同版本相同 ZIP 重复导入不会产生副本，曾删除的样式可以恢复；改动内容后请提高版本号。不同版本并存，主播自行替换，现有场景不会自动变样。

普通素材支持 PNG/JPEG/GIF/WebP/MP4/WebM。附件仅允许 TXT/MD 说明，保留在原 ZIP 中，不会安装成组件。不导入单独音频、脚本、自定义运行代码或整套场景布局。资源型样式还允许 SVG 与 WOFF2，见下节。单个媒体最多 512 MiB，ZIP 最多 1 GiB，展开总量最多 2 GiB；最多 256 个条目和 64 个样式，清单和单个说明最多 256 KiB。不接受加密 ZIP、符号链接、重复路径或损坏内容。

已经压缩过的视频再放 ZIP 通常不会大幅变小。分离套装解决的是 EXE 不必携带所有大素材；实际减小素材仍需要控制分辨率、时长和编码码率。月渡花汀现已外置，其专用素材不再随 EXE 分发。

## 月渡花汀与多素材样式

月渡花汀的时钟、弹幕、许愿和开播使用分层原画及客户端动画。用 `schemaVersion:2`、`preset` 和 `resources` 声明这种样式，客户端继续渲染真实时间、弹幕、礼物进度与程序动画。ZIP 不携带或执行 JS/CSS。根目录清单仍是可变长度的 `styles` 数组：可以缺少某类组件，也可以有多个同类样式；不要为不存在的内容建空文件夹。

运行 `node scripts/package-moonlit-suite.js`，生成 `output/月渡花汀-1.0.0.zip`。清单来自 [套装导出脚本](../../scripts/package-moonlit-suite.js)，包含 6 个样式、去重的运行素材、预览图、字体许可证和使用说明。原始素材保留在仓库，`build.files` 排除安装包中的专用素材。

下面是一份只包含许愿样式的完整清单示例，并非月渡花汀整包清单。将预览图、许愿底图和起始装饰分别放到示例指定路径。`resources` 必须完整声明对应预设列出的资源，键是客户端逻辑路径，值是 ZIP 内的相对路径：

```json
{
  "schemaVersion": 2,
  "id": "my-studio.wishes-suite",
  "name": "许愿素材套装",
  "version": "1.0.0",
  "styles": [
    {
      "type": "gift-wishes",
      "name": "礼物许愿",
      "preset": "moonlit-wishes",
      "width": 640,
      "height": 400,
      "preview": "assets/preview.webp",
      "config": { "displayStyle": "moonlit" },
      "resources": {
        "/img/shared/gift-wish-moonlit.webp": "assets/wish.webp",
        "/img/shared/gift-wish-moonlit-start.svg": "assets/start.svg"
      }
    }
  ]
}
```

已支持的预设由 [component-resource-style.js](../../public/js/shared/component-resource-style.js) 定义。`schemaVersion:2` 也支持前文的普通 `file/media` 样式，可以混装。例如下一包不含开播、多两款感谢视频，只需改变数组内容。AI 制作的全新程序动画需要先接入客户端渲染器，或作为兼容网页源使用；仅添加未知 `preset` 不会执行新程序。

### 交给 AI 制作下一套时

先列出本次实际需要的成员，每个成员对应 `styles` 中一项；同类多款各写一项，没有的组件直接省略。普通图片或视频用 `file/media`，复用客户端已支持的分层动画用 `preset/resources`，同一个样式不要混用这两种声明。多个成员可以共用同一素材路径。

交付 ZIP 前检查：根目录清单可读取、每项素材路径存在、预览与实际内容一致、字体或素材许可随包附带；然后按前述步骤实际导入，选用所有成员并检查直播输出。作者应说明所需客户端能力；更新同一套装保持 `id` 不变并提高 `version`。需要新渲染器时，应先完成客户端适配再发素材包。

开发接入的接口、存储、渲染与打包边界见[技术参考入口](../reference/README.md#本机样式与外置套装)。

# 主题包格式 v1（THEME-PACK）

> 这份文件只讲"怎么做一个主题包"。**不需要读《引擎方案》或源码**，按本文就能做出可校验、可导入、可应用的主题包。
>
> - 适用版本：皮肤引擎插件 **0.2.0**（Step 7 发布版），包格式 `dshte.theme` **v1**。
> - 权威来源：`src/shared/pack-schema.js`（v1 校验器）。本文与它逐条对齐；两者冲突时以源码为准。
> - 安装、卸载、常见问题、与 dream-skin 的差异见同目录 [`README.md`](README.md)。

---

## 1. 30 秒开始：最小可用主题包

四步：

1. 新建一个目录（目录名随意，建议 = 包 id，例如 `my-warm-paper/`）。
2. 在里面新建 `theme.json`，内容如下（**正好 20 行，逐字可用**）。
3. 在插件目录下运行 `node scripts/pack-check.mjs <你的包目录>`，看到 `RESULT: OK` 即通过。
4. Tavern → 设置 →「皮肤引擎」→ **行 4 · 导入** → 选择这个目录（或把目录拖进去）→ 导入成功后点 **行 1** 的包卡片应用。

`theme.json`：

```json
{
  "format": "dshte.theme",
  "formatVersion": 1,
  "id": "my-warm-paper",
  "name": "My Warm Paper",
  "colorScheme": "light",
  "missingScheme": "mirror",
  "preview": { "bg": "#EFE8E0", "fg": "#14110F", "accent": "#7557A8" },
  "tokens": {
    "light": {
      "--dsw-alias-bg-base": "#EFE8E0",
      "--dsw-alias-bg-layer-1": "#FEFAF7",
      "--dsw-alias-brand-primary": "#7557A8",
      "--dsw-alias-label-primary": "#14110F",
      "--dsw-alias-label-secondary": "#5F5A52",
      "--dsw-alias-border-l1": "#DCD8D7",
      "--dsw-alias-border-l2": "#CAC6C3"
    }
  }
}
```

### 1.1 逐行解释

| 行 | 内容 | 作用 |
|---|---|---|
| 1 / 20 | `{` … `}` | 一个 JSON 对象（顶层必须是对象，不能是数组）。 |
| 2 | `format: "dshte.theme"` | 标识"这是本引擎的主题包"。**必填，必须逐字一致**（区分 `.dshte.json` 交换包的 `dshte.bundle`）。 |
| 3 | `formatVersion: 1` | 包格式版本。**必填，必须是数字 `1`**。 |
| 4 | `id` | 包的唯一 id，也是导入后的目录名。规则：`^[a-z][a-z0-9-]{2,47}$`（小写字母开头，3–48 字符，可含数字与 `-`）；保留 `light` / `dark` / `system` / `builtin-*`。 |
| 5 | `name` | 展示名（≤48 字符）。中文界面优先显示 `nameZh`（可另写）。 |
| 6 | `colorScheme: "light"` | 这个包**按哪一档设计**：`light` 或 `dark`。**必填**。 |
| 7 | `missingScheme: "mirror"` | 另一档缺失时的策略：`mirror`（另一档镜像本档）或 `inherit`（切到另一档时撤掉本引擎的层）。可省略，默认 `mirror`。 |
| 8 | `preview` | 设置页包卡片的**色卡**，不需要加载包就能画。可省略。 |
| 9–19 | `tokens.light` | 变量表。**必须包含 `colorScheme` 对应的那一档**（这里是 `light`）；每档最多 400 个 token。 |
| 11–17 | 7 个 `--dsw-*` | **必填 token**（见 §4），缺一个都算 error。 |

> 只有 `tokens` 是必填的"内容块"；`typography` / `radii` / `spacing` / `shadows` / `regions` / `components` / `theme.css` / `assets/` 全部可选。最小包只要颜色就能生效。

---

## 2. 目录结构与文件白名单

```
<包目录>/
├─ theme.json          # 必填：清单 + 变量表 + 可选 recipes
├─ theme.css           # 可选：受控自定义 CSS（需在 theme.json 里写 "css": "theme.css"）
├─ preview.png         # 可选：大预览图（v1 只允许这个根文件名，界面暂未渲染）
├─ README.md           # 可选：给包使用者看的说明（不会被执行）
├─ LICENSE             # 可选：许可证文本
└─ assets/             # 可选：资源
   ├─ fonts/<name>.woff2|woff|ttf|otf
   └─ images/<name>.png|jpg|jpeg|webp|svg|avif
```

**文件白名单（校验器实际允许的只有这些）**：

| 位置 | 允许 | 说明 |
|---|---|---|
| 根目录 | `theme.json`、`theme.css`、`preview.png`、`README.md`、`LICENSE` | 其它根文件名 → `file-location` error。 |
| `assets/fonts/` | `.woff2` `.woff` `.ttf` `.otf` | 字体文件，必须在这里。 |
| `assets/images/` | `.png` `.jpg` `.jpeg` `.webp` `.svg` `.avif` | 图片/纹理，必须在这里。 |
| 其它任意位置 | ❌ | 例如 `assets/docs/x.md`、`assets/css/x.css`、`script.js` 都会报 `file-location` error。 |

要点：

- **目录名建议 = `id`**：导入时宿主会以 `theme.json` 的 `id` 落盘为 `skin-engine/packs/<id>/`，导入后目录名与 id 一致；内置包（`themes/<id>/`）则要求严格一致（不一致会拒绝装载）。
- 包内不存在"可执行物"通道：只接受上面白名单的扩展名；CSS 仅作为文本注入 `<style>`，不会执行 JS。
- `pack-check` 命令会跳过以 `.` 开头的隐藏文件/目录；但**导入时不要把 `.DS_Store`、`.git/` 等隐藏文件放进包目录**（目录导入会把它们当普通文件按白名单校验，通常报 `file-location`）。
- 单包上限：**包体 ≤16 MB**、**单文件 ≤8 MB**、**≤200 个文件**、**用户包总数 ≤100**。目录导入的大小/数量含 `theme.json` 自身；`.dshte.json` 交换包里 `theme.json` 内嵌在 `pack`、不计入 `files`（另受 24 MB 文本上限约束）。传输层信息见 §11。

---

## 3. `theme.json` 字段表

顶层必须是一个 JSON 对象。**未知顶层字段 → warning 并忽略（不会静默丢弃，warning 会指出字段路径）**；字段值非法 → error，包不能装载。

| 字段 | 类型 | 必填 | 默认 | 说明 / 校验规则 |
|---|---|---|---|---|
| `format` | string | ✅ | — | 必须 `"dshte.theme"`。 |
| `formatVersion` | number | ✅ | — | 必须 `1`。 |
| `id` | string | ✅ | — | `^[a-z][a-z0-9-]{2,47}$`；保留 `light`/`dark`/`system`/`builtin-*`。 |
| `release` | string | ❌ | `"1.0.0"` | semver（`1.0.0`、`1.2.0-beta.1`）。用于导出文件名 `<id>-<release>.dshte.json`。 |
| `name` | string | ✅ | — | 展示名，≤48 字符，不能为空。 |
| `nameZh` | string | ❌ | — | 中文名，≤48 字符；有则中文界面优先显示。 |
| `author` | string \| `{name, url?}` | ❌ | — | 字符串 ≤80 字符；对象时 `name` 必填 ≤80、`url` ≤200。卡片上会显示作者。 |
| `description` | string | ❌ | — | ≤200 字符。预留字段（数据会被保留，v1 卡片暂不展示）。 |
| `license` | string | ❌ | — | ≤80 字符（SPDX 或自由文本）。预留字段（导出/分享时保留，界面未展示）。 |
| `homepage` | string | ❌ | — | ≤200 字符；**只存不请求**（防止第三方跟踪；v1 界面未展示链接）。 |
| `tags` | string[] | ❌ | — | ≤8 个字符串；建议全小写（大写只 warning）。预留字段（v1 界面未用于筛选）。 |
| `engine` | string | ❌ | 不校验 | semver 范围（`>=0.1.0`、`^0.1.0`、`~0.1.0`、`=0.1.0`、空格连接多个）。不满足 → error。**比较对象是"主题包格式引擎常量" `0.1.0`（`pack-schema.js` 的 `ENGINE_VERSION`），不是插件发布版本 0.2.0**；留空表示不限制。 |
| `colorScheme` | `"light"` \| `"dark"` | ✅ | — | 包的设计基准档。 |
| `missingScheme` | `"mirror"` \| `"inherit"` | ❌ | `"mirror"` | 另一档缺失时的策略，见 §4.5。 |
| `tokens` | object | ✅ | — | `{ light: {...}, dark?: {...} }`；**必须含 `colorScheme` 对应那一档**。见 §4。 |
| `typography` | object | ❌ | — | 字体栈/字号/字重/行高/字距/字体文件。见 §5。 |
| `radii` | object | ❌ | — | 圆角。见 §5。 |
| `spacing` | object | ❌ | — | 间距。见 §5。 |
| `shadows` | object | ❌ | — | 阴影。见 §5。 |
| `regions` | object | ❌ | — | 5 个分区 × 7 个白名单属性。见 §6。 |
| `components` | object | ❌ | — | 11 个组件 × 各自的 knob。见 §7。 |
| `preview` | object | ❌ | — | `{ bg, fg, accent }` 色卡。见 §8。 |
| `assets` | object | ❌ | — | `{ preview?: 图片相对路径 }`。见 §9。 |
| `css` | string | ❌ | — | **只允许 `"theme.css"`**（包内唯一自定义 CSS 文件）。见 §9。 |

校验分级（与 `pack-check` 输出一致）：

- **error**（`✗`，阻止装载/导入）：结构错误、必填字段缺失、非法值、必填 token 缺失、白名单外的分区/组件/属性/knob、路径不安全、文件类型/位置不允许、超限。
- **warning**（`!`，允许装载，设置页标黄）：未知字段、`tags` 非小写、`dark` 档缺必填 token、`theme.css` 用了 `!important` / `position:fixed`、`theme.css` 为空、文件未被声明引用等。
- 所有问题都带**字段路径**（如 `tokens.light["--dsw-alias-bg-base"]`、`regions.sidebar.width`）与可读原因。

---

## 4. `tokens` 规则（变量表）

### 4.1 结构与命名

```json
"tokens": {
  "light": { "--dsw-alias-bg-base": "#EFE8E0", "…": "…" },
  "dark":  { "--dsw-alias-bg-base": "#14161C", "…": "…" }
}
```

| 规则 | 内容 |
|---|---|
| 档位键 | 只能是 `light` / `dark`；出现其它键 → `unknown-scheme` error。 |
| 必须含设计档 | `tokens[colorScheme]` 必须存在，否则 `missing-scheme` error。 |
| token 名 | 只允许三种前缀：`--dsw-`（DSH 宿主 token）、`--dsh-tavern-`（Tavern 宿主 token）、`--dshte-`（本引擎 token）；名字其余部分只能字母/数字/`-`/`_`。其它前缀 → `token-prefix` error。 |
| 数量 | 每档 ≤400 个 token。 |
| 值 | 必须是**安全的 CSS 值字符串**（见 §4.3）。**不要求是颜色**——长度、字体栈、`color-mix(...)` 都可以；颜色是否合法由浏览器决定。 |

### 4.2 7 个必填 token（沿用 dream-skin 的集合，保证互通/可迁移）

`colorScheme` 对应那一档必须包含这 7 个，缺任一 → `missing-required-token` error：

```
--dsw-alias-bg-base
--dsw-alias-bg-layer-1
--dsw-alias-brand-primary
--dsw-alias-label-primary
--dsw-alias-label-secondary
--dsw-alias-border-l1
--dsw-alias-border-l2
```

`dark` 档（当它是非设计档时）缺这 7 个只会 warning（`dark-fallback`）：引擎会回退到 `light` 档的值，设置页会提示"深色未完整设计"。

### 4.3 值的合法形式（安全 CSS 值）

- 非空字符串，**≤2000 字符**。
- 禁止出现：`;`、`}`、`</style`、`@import`、`javascript:`、`expression(`（会破坏样式块或引入脚本）。
- 允许 `url(...)`，但只能引用包内资源：`assets/…`、`/dsh-tavern-skin/assets/…` 或 `data:`；`http(s)://` 外链 → `external-resource` error。
- 值里含换行只给 warning（建议写成单行）。
- 示例（全部合法）：`#EFE8E0`、`rgba(20,17,15,.08)`、`color-mix(in srgb, #7557A8 10%, transparent)`、`10px`、`"Inter",sans-serif`、`0 1px 0 rgba(0,0,0,.1)`。

> 说明：v1 校验器**不校验颜色字面量**，`--dsw-*` token 的值写错颜色时浏览器会丢弃该声明（表现为颜色不生效），不会让包校验失败。想让诊断行把它标出来，用设置页「诊断」行的 token 差异对比（只对 hex 颜色做逐值比较，其它值显示为"不可核验"）。

### 4.4 宿主 token 与引擎 token 的区别

| 前缀 | 谁消费 | 怎么生效 |
|---|---|---|
| `--dsw-*` / `--dsh-tavern-*` | 宿主主题服务（`ctx.theme.overrideTokens`） | 成为宿主 token 的真实值；宿主要求每个 token 同时有 `light`/`dark`，缺的一侧由引擎自动用另一侧补齐。 |
| `--dshte-*` | 引擎自己的 `#dshte-vars` 样式块 | `light` 写在 `:root`，`dark` 写在 `body[data-ds-dark-theme]`；同时是 `regions`/`components`/`theme.css` 的公共词汇。 |

### 4.5 `missingScheme`：只设计一档时怎么办

| 值 | 行为 | 什么时候用 |
|---|---|---|
| `mirror`（默认） | 包只给一档时，**另一档整套镜像同一套值** → 用户切换浅色/深色，皮肤外观保持一致（"镜像占位"）。 | 大多数包（尤其只做一个设计稿的包）。 |
| `inherit` | 当 Tavern 当前明暗档 **≠** 包的 `colorScheme` 时，**引擎自动撤掉本引擎的 token 层**，交回宿主/dream-skin 原生外观；只在匹配档生效。 | 浅色包只想在浅色下生效，不想"污染"深色界面时。 |

补充：

- 设置页「7 · 方案与深色」可以**即时覆盖**包里的 `missingScheme`（mirror / inherit 两个按钮），不改包文件。
- `mirror` 下如果包写了 `dark` 档，则 `dark` 档存在时优先用 `dark`；`inherit` 下不写 `dark` 就真的不写深色变量。
- 深色包（`colorScheme: "dark"`）同理：`mirror` 时浅色档镜像深色；`inherit` 时切到浅色就撤层。

### 4.6 深色包示例（节选）

```json
"colorScheme": "dark",
"missingScheme": "mirror",
"tokens": {
  "dark": {
    "--dsw-alias-bg-base": "#14161C",
    "--dsw-alias-bg-layer-1": "#1C1F27",
    "--dsw-alias-brand-primary": "#7FA7FF",
    "--dsw-alias-label-primary": "#E8ECF4",
    "--dsw-alias-label-secondary": "#9AA4B5",
    "--dsw-alias-border-l1": "#2A2F3A",
    "--dsw-alias-border-l2": "#3A4150"
  }
}
```

---

## 5. `typography` / `radii` / `spacing` / `shadows`（编译成 `--dshte-*` 的语法糖）

这四块都是可选的"快捷写法"：写进 JSON，引擎会编译成 `--dshte-*` 变量。你也可以直接在 `tokens` 里写同名变量，效果一样。**键名写错会被校验器按"未知字段"报 warning**（不会静默生效）。

### 5.1 `typography`

| 键 | 类型/子键 | 规则 | 编译成 |
|---|---|---|---|
| `sans` / `latin` / `display` / `mono` | string | 非空字体栈 | `--dshte-font-sans` / `-font-latin` / `-font-display` / `-font-mono` |
| `sizes` | object | 子键白名单：`eyebrow` `brand` `panel` `h2` `body` `note` `nav` `group` `button` `meta` `chip`；值为正数（px，0 < n ≤ 96）或 `"13px"`/`"0.8rem"`/`"1em"` | `--dshte-text-<key>` |
| `weights` | object | 子键白名单：`regular` `medium` `semibold` `bold` `black`；值 100–900 | `--dshte-weight-<key>` |
| `leading` | object | 子键白名单：`body` `tight`；值 0–4（行高倍数） | `--dshte-leading-<key>` |
| `tracking` | object | 子键白名单：`eyebrow`；值必须带单位的长度字符串（`"0.12em"`） | `--dshte-tracking-eyebrow` |
| `fonts` | array ≤8 | 每项 `{ family, file, weight?, style?, display?, unicodeRange? }`，见下 | 生成 `@font-face`（不产变量） |

`fonts[]` 每项：

| 子字段 | 必填 | 规则 |
|---|---|---|
| `family` | ✅ | 非空字符串（字体族名）。 |
| `file` | ✅ | 包内相对路径，**必须位于 `assets/fonts/`**，扩展名 `woff2/woff/ttf/otf`；文件必须真实存在（宿主导入时检查）。 |
| `weight` | ❌ | 数字或字符串（如 `"400"`）。 |
| `style` | ❌ | `normal` / `italic` / `oblique`。 |
| `display` | ❌ | `auto` / `block` / `swap` / `fallback` / `optional`。 |
| `unicodeRange` | ❌ | 字符串，原样写进 `unicode-range`。 |

示例：

```json
"typography": {
  "sans": "\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif",
  "display": "\"Ink Display\",\"Inter\",sans-serif",
  "sizes": { "eyebrow": 10, "h2": 16, "body": 13, "note": 11 },
  "weights": { "regular": 400, "semibold": 600, "bold": 700 },
  "leading": { "body": 1.55, "tight": 1.3 },
  "tracking": { "eyebrow": "0.1em" },
  "fonts": [
    { "family": "Ink Display", "file": "assets/fonts/ink-display.woff2", "weight": 400, "display": "swap" }
  ]
}
```

### 5.2 `radii`

子键白名单：`quote` `sm` `card` `input` `pill`。值为数字（自动补 px，0–9999）或 `"8px"`/`"0.5rem"`/`"9999px"`。编译成 `--dshte-radius-<key>`。

```json
"radii": { "quote": 4, "sm": 6, "card": 12, "input": 14, "pill": 9999 }
```

### 5.3 `spacing`

子键白名单：`xxs` `xs` `sm` `md` `lg` `xl` `xxl` `xxxl` `inputPad` `sidebarInset` `navPadX` `rightbarInset`。值为数字（自动补 px，0–512）或长度字符串。编译成 `--dshte-space-<key>`。

```json
"spacing": { "xs": 8, "sm": 12, "md": 18, "lg": 26, "inputPad": 12, "sidebarInset": 14 }
```

### 5.4 `shadows`

子键白名单：`card` `spine` `line`。值为安全 CSS 值（`box-shadow` 或颜色；`line` 常写成颜色）。编译成 `--dshte-shadow-<key>`。

```json
"shadows": {
  "card": "0 1px 0 rgba(0,0,0,.35), 0 8px 22px rgba(0,0,0,.28)",
  "spine": "0 0 10px rgba(127,167,255,.25)",
  "line": "#2A2F3A"
}
```

---

## 6. `regions`（5 个分区）

分区是"视觉安全区"：只允许改颜色/背景/边线/阴影/透明度，**禁止一切布局属性**（避免压住宿主内联的三栏 grid、废掉拖动把手）。

| 分区键 | 对应位置 |
|---|---|
| `sidebar` | 左栏 |
| `center` | 中栏（会话区） |
| `rightbar` | 右栏 |
| `composer` | 输入坞 |
| `settings` | 设置页 |

允许属性（7 个）与编译目标：

| JSON 属性 | 值类型 | 编译成 | 说明 |
|---|---|---|---|
| `background` | 安全 CSS 值 | `--dshte-region-<name>-bg` | 底色。 |
| `backgroundImage` | 安全 CSS 值（通常 `url(assets/images/…)`） | `--dshte-region-<name>-bg-image` | 纹理/背景图。 |
| `borderColor` | 安全 CSS 值 | `--dshte-region-<name>-border-color` | 边线颜色。 |
| `borderWidth` | 数字（px）或 `"1px"` | `--dshte-region-<name>-border-width` | 边线宽度；引擎用 inset 阴影/伪元素实现，不改变盒子尺寸。 |
| `shadow` | 安全 CSS 值 | `--dshte-region-<name>-shadow` | 阴影/书脊。 |
| `opacity` | 数字 0–1 | `--dshte-region-<name>-opacity` | 透明度。 |
| `backdropFilter` | 安全 CSS 值 | `--dshte-region-<name>-backdrop` | 毛玻璃；本项目设计规范默认"无毛玻璃"，一般留空。 |

**禁用属性（error `layout-forbidden`）**：`width` `height` `minWidth` `maxWidth` `minHeight` `maxHeight` `padding` `paddingTop` `paddingRight` `paddingBottom` `paddingLeft` `margin` `marginTop` `marginRight` `marginBottom` `marginLeft` `display` `position` `inset` `top` `right` `bottom` `left` `grid` `gridTemplateColumns` `gridTemplateRows` `gridArea` `flex` `flexDirection` `order` `transform` `overflow` `zIndex`。

> **为什么禁用**：三栏宽度是宿主写死的**内联** `grid-template-columns` + 拖动把手；CSS 若用 `width`/`padding`/`!important` 去压它，会把拖动把手压废（dream-skin 的 `paper.css` 就因此退过款）。分区/组件 JSON 通道从根上不给这个口子；`theme.css` 另有静态扫描（§9）。
>
> 另外：`regions` 和 `components` **不分浅色/深色**（两档用同一套值）；若两档视觉差异大，把颜色差异放进 `tokens`，或给两档做两个包。

示例：

```json
"regions": {
  "sidebar": { "background": "var(--dshte-bg-sidebar)" },
  "center": {
    "background": "var(--dshte-bg-base)",
    "backgroundImage": "url(assets/images/ink-grid.svg)"
  },
  "rightbar": { "background": "transparent" },
  "composer": { "background": "var(--dshte-bg-elevated)", "borderColor": "var(--dshte-border-hairline)" }
}
```

> 白名单外的属性（如 `regions.sidebar.color`）→ `unknown-prop` error；未知分区（如 `leftbar`）→ `unknown-region` error。

---

## 7. `components`（11 个组件）

组件是"部件级配方"。每个组件接受一小组 **knob**，按组件校验子集；不在该组件白名单里的 knob → `unknown-knob` error；未知组件 → `unknown-component` error。

**knob 词表（按组件，与 `pack-schema.js` 的 `COMPONENT_KNOBS` 一致）**：

| 组件 | 可用 knob |
|---|---|
| `card` | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `borderWidth` `radius` `shadow` `paddingX` `paddingY` |
| `buttonPrimary` | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `borderWidth` `radius` `shadow` `height` `fontSize` `fontWeight` `paddingX` `paddingY` |
| `buttonDanger` | 同 `buttonPrimary` |
| `buttonGhost` | 同 `buttonPrimary` |
| `input` | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `borderWidth` `radius` `shadow` `fontSize` `lineHeight` `paddingX` `paddingY` |
| `quote` | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `borderWidth` `borderStyle` `radius` `fontSize` `lineHeight` `paddingX` `paddingY` `letterSpacing` |
| `navItem` | `color` `activeBackground` `activeColor` `radius` `height` `fontSize` `fontWeight` `paddingX` `paddingY` |
| `eyebrow` | `color` `fontSize` `fontWeight` `letterSpacing` `textTransform` |
| `badge` | `background` `color` `borderColor` `borderWidth` `radius` `fontSize` `fontWeight` `paddingX` `paddingY` |
| `fileCard` | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `borderWidth` `radius` `shadow` `fontSize` `lineHeight` `paddingX` `paddingY` |
| `codeBlock` | `background` `color` `borderColor` `borderWidth` `radius` `fontSize` `lineHeight` `paddingX` `paddingY` |

knob 取值规则：

| knob 类别 | 编号 | 规则 |
|---|---|---|
| 颜色/原始值 | `background` `color` `borderColor` `activeBackground` `activeColor` `placeholderColor` `shadow` | 安全 CSS 值（同 §4.3）。 |
| 长度 | `radius` `height` `fontSize` `paddingX` `paddingY` `borderWidth` | 数字（自动补 px，≥0）或 `px/rem/em/%` 字符串。 |
| 字重 | `fontWeight` | 100–900 数字，或 `normal` / `bold` / `"100"`…`"900"`。 |
| 行高 | `lineHeight` | 0–4 数字，或长度字符串。 |
| 字距 | `letterSpacing` | 必须带单位的 `px/em/rem` 字符串（可为负）。 |
| 变换 | `textTransform` | `none` / `uppercase` / `lowercase` / `capitalize`。 |
| 边线样式 | `borderStyle` | `none` / `solid` / `dashed` / `dotted` / `double`。 |

编译目标：`--dshte-<组件名 kebab>-<knob kebab>`，其中三个 knob 有别名：`background → bg`、`activeBackground → active-bg`、`activeColor → active-color`（如 `card.radius` → `--dshte-card-radius`，`card.background` → `--dshte-card-bg`）。

示例：

```json
"components": {
  "card": {
    "background": "var(--dshte-bg-surface)",
    "borderColor": "var(--dshte-border-hairline)",
    "borderWidth": 1,
    "radius": 12,
    "shadow": "var(--dshte-shadow-card)",
    "paddingX": 18,
    "paddingY": 18
  },
  "buttonPrimary": {
    "background": "var(--dshte-accent)",
    "color": "#0B1020",
    "radius": 8,
    "height": 32,
    "fontWeight": 600
  }
}
```

> 组件规则按"宿主真实 DOM 钩子注册表"生效，不同 Tavern 版本的选择器可能漂移：**没命中的组件只是"没效果"，不会报错**；设置页「诊断」行有钩子命中率，升级 Tavern 后先看那里。组件规则会尽量保留宿主 hover/disabled 状态，但少数状态色会跟随主题（这是"组件级换肤真的可见"的取舍）。

---

## 8. `preview`（色卡）

```json
"preview": { "bg": "#EFE8E0", "fg": "#14110F", "accent": "#7557A8" }
```

- 用途：设置页包卡片**不加载包**就画出缩略色卡（`bg` 底色、`accent` 边框、`fg` 底部色条）。
- 三个键都可选；校验器只检查"是非空字符串"（**不校验颜色格式**，写错颜色只会让色卡难看）。
- 与 `assets.preview`（大预览图）不是同一个东西；后者见 §9。

---

## 9. `assets` 与 `theme.css`

### 9.1 资源引用

| 场景 | 写法 |
|---|---|
| 字体 | `typography.fonts[].file = "assets/fonts/x.woff2"` |
| 大预览图 | `assets.preview = "assets/images/preview.png"`（**声明了就必须真实存在**；v1 界面暂不渲染图片，预留） |
| 分区背景图 | `regions.<name>.backgroundImage = "url(assets/images/x.svg)"` |
| `theme.css` 里 | `background-image: url(assets/images/x.svg);` |

- 引用必须是**包内相对路径**（`assets/…`，用 `/` 分隔）；引擎注入前会改写成同源路由：用户包 `/dsh-tavern-skin/assets/pack/<id>/assets/…`、内置包 `/dsh-tavern-skin/assets/builtin/<id>/assets/…`。
- **不允许外链**：`url(http(s)://…)` 在 token 值 / 分区属性 / `theme.css` 里都会被拒绝（error）。
- 字体文件必须放在 `assets/fonts/`、扩展名只允许 `woff2/woff/ttf/otf`；图片必须放在 `assets/images/`。
- **注意**：校验器只检查"结构性引用"是否真实存在（`css`、`typography.fonts[].file`、`assets.preview`）；**`regions.*.backgroundImage` / `theme.css` 里 `url()` 指向的图片不会做存在性检查**——文件放错位置不会让导入失败，但运行时会 404（背景不显示）。发布前请手动确认这些路径。
- 建议资源文件名带内容哈希（如 `paper-grain-5b5310ab02.svg`）：宿主对带哈希的资源给长缓存，未哈希的走 `no-cache`+ETag（能用，只是每次协商）。

### 9.2 `theme.css`（受控 unsafe 通道）

`theme.css` 是 v1 唯一能碰到"宿主没给 token 的边角"的口子。它与 dream-skin 的 `.css 皮肤` 同机制（纯 `<style>` 注入，不可能执行 JS），但**多了静态扫描**：

| 规则 | 说明 |
|---|---|
| 声明 | 必须写 `"css": "theme.css"`；若包里有 `theme.css` 但没声明，导入会 warning（**这份 CSS 不会生效**）。`css` 只能是 `"theme.css"`。 |
| 体积 | ≤1 MB。 |
| 语法预检 | 注入前做括号/引号配平与规则级扫描，错误**带行号**（如"第 12 行的规则块「…」缺少右花括号"）。 |
| `@import` | **拒绝**（会引入外部资源/绕过资源规则）。 |
| 布局属性扫描 | ① 全局禁止 `grid-template-columns/rows/areas`、`grid-column/row/area`；② 当选择器命中**三栏/列钩子**（`[data-slot="root|sidebar|main|rightbar|shell.bottom"]`、`_frame`/`_sidebarCol`/`_centerCol`/`_rightbarCol`、`[data-side…]`、`[data-sidebar-right-panel]`、`[data-dsh-center-col]`、`[data-rightbar-col]`）时，再禁止 `width/height/min-max/padding/margin/display/position/inset/top/right/bottom/left/transform/overflow`。命中即 error 并给行号。 |
| 其它选择器上的布局属性 | 允许（例如 `[data-slot="conversation.session"] { width: … }` 不在列钩子上，不会被拒），但仍可能影响界面，**请自测**。 |
| 资源 | `url()` 只能引用 `assets/…`、`/dsh-tavern-skin/assets/…` 或 `data:`。 |
| `position: fixed/absolute` | 允许，但 warning（可能覆盖宿主浮层）。 |
| `!important` | 允许，但 warning（统计处数；滥用会压住宿主状态样式）。 |
| 空文件 | warning。 |

**导入确认**：任何包含自定义 CSS 的包（有 `css` 声明或包内有 `theme.css`），导入时设置页会显示行内确认「该包包含自定义 CSS（theme.css，可影响整个界面），请确认来源可信后再导入」，必须点「确认导入（含自定义 CSS）」才会落盘；点「取消」不写任何文件。

示例（安全写法，来自本文示例包）：

```css
/* 只做安全通道内的视觉微调：无布局属性、无 @import、无外链 */
::selection {
  background: var(--dshte-accent-soft);
  color: var(--dshte-fg-primary);
}

[data-slot="conversation.session"] blockquote {
  border-left: 3px solid var(--dshte-accent);
}

[data-slot="sidebar.settings"] button {
  border-radius: var(--dshte-radius-sm);
}
```

> `theme.css` 可以引用 `--dsw-*` / `--dshte-*` 变量，也可以写选择器/`!important`；它注入在 `#dshte-pack-css`（body 末尾），位于引擎变量块之后。

---

## 10. `pack-check`（主题包检查器）

在**插件目录**下运行（`node scripts/pack-check.mjs …`）：

```
node scripts/pack-check.mjs <包目录>                    # 检查目录
node scripts/pack-check.mjs --bundle <包>.dshte.json     # 检查单文件交换包
node scripts/pack-check.mjs <包目录> --json              # 机器可读输出
node scripts/pack-check.mjs <包目录> --max-pack-bytes N  # 压测/自测体积上限
node scripts/pack-check.mjs <包目录> --max-file-bytes N
node scripts/pack-check.mjs <包目录> --max-css-bytes N
```

输出格式（目录模式）：

```
pack: my-warm-paper — My Warm Paper (release 1.0.0, light)
stats: {"files":1,"bytes":577,"pack":{"schemes":["light"],"tokens":7,"regions":0,"components":0}}
errors (N):
  ✗ tokens.light["--dsw-alias-bg-base"]  [missing-required-token]  缺少必填 token「--dsw-alias-bg-base」…
warnings (N):
  ! theme.css  [important-count]  theme.css 使用了 1 处 !important…
RESULT: OK
```

- **退出码**：`0` = 0 error（允许有 warning）；`1` = 有 error（包括"目录里没有 `theme.json`"）；`2` = 用法错误（缺参数、未知选项、`--bundle` 与目录同时给）。目录/文件读不到的 IO 错误会抛异常（非 0 退出，`pack-check:` 前缀的用法提示除外）。
- **error 阻止装载/导入；warning 只标黄**。每条问题都带字段路径与可读原因。
- 检查范围：`theme.json` 结构与字段、文件清单/白名单/大小/数量、`theme.css` 静态扫描；**不检查"theme.json 声明的文件是否真实存在"**（css / 字体 / `assets.preview` 缺失时 CLI 仍可能 `RESULT: OK`）。
  - ⚠️ **`pack-check` 0 error ≠ 导入必成功**：声明的 `theme.css`、`typography.fonts[].file`、`assets.preview` 必须真实存在，宿主导入时会逐项检查，缺失报 `missing-file`（HTTP 400，不落盘）。发布前请自己也确认这些路径。
- 建议流程：改包 → `pack-check` → 设置页导入（导入时会跑宿主全量校验，结果同样带字段路径）→ 应用 → 设置页「诊断」行看 token 差异/钩子命中率。

---

## 11. 导入 / 导出 / 分享 / 回收站

入口都在 Tavern 设置 →「皮肤引擎」：

| 行 | 功能 |
|---|---|
| **行 4 · 导入** | 单文件 `.dshte.json` / dream-skin 主题包 JSON / 包目录（`webkitdirectory`）/ 拖放（文件或目录）；单个 `theme.json` 文件也能直接导入（按"只有清单的包"处理）。 |
| **行 5 · 导出** | 把当前活动包（内置/用户包）导出为 `<id>-<release>.dshte.json`（资源以 data URL 内嵌）。 |
| **行 6 · 管理** | 用户包删除（进回收站）、回收站列表/恢复/彻底删除、恢复默认；内置包只读。 |

### 11.1 导入过程

1. 浏览器**轻量预检**：JSON 语法、格式识别（`dshte.bundle` / `dsh-dream-skin/pack` / `dshte.theme`）、体积/数量、`theme.css` 语法；含 `theme.css` 的包先要求行内确认。
2. 上传到宿主（目录导入是每个文件纯 base64；单文件是原文），显示进度条（读取 → 等待确认 → 上传 → 校验写入）。
3. 宿主**全量校验**（`pack-schema` + 文件清单 + 声明文件存在性）→ 写 staging → 校验通过才 `rename` 到 `skin-engine/packs/<id>/`。
4. **任何失败都不落盘**（staging 清理），错误带字段路径；导入成功后**不会自动应用**，点行 1 的包卡片才应用。
5. 客户端只做轻量预检，**深度校验以宿主为准**（同一个 `pack-schema` 在宿主/CLI/浏览器共用）。

### 11.2 冲突策略

导入前在行 4 选冲突模式（默认「自动改名 -2」）：

| 模式 | 用户包同名 | 内置包同名 |
|---|---|---|
| `rename`（UI 默认 / API 可传） | 自动另存 `<id>-2`、`-3`…（`collision:renamed`，提示原名） | **自动另存 `<id>-2`**（内置包永远不覆盖） |
| `reject`（API 缺省） | HTTP **409** `conflict`（提示改用 rename/overwrite） | 自动另存 `<id>-2` |
| `overwrite` | 覆盖同名用户包（旧包先移入回收站，可恢复） | HTTP 400 `builtin-protected`（内置不可覆盖） |

用户包总数上限 100：满了以后导入报 `pack-limit-reached`（先删包）。

### 11.3 `.dshte.json` 交换包格式

```json
{
  "format": "dshte.bundle",
  "formatVersion": 1,
  "exportedAt": "2026-11-03T05:00:00.000Z",
  "engineVersion": "0.1.0",
  "pack": { "…": "与 theme.json 完全相同的对象" },
  "files": {
    "theme.css": "（文本原样）",
    "assets/images/x.png": "data:image/png;base64,…"
  }
}
```

- `theme.json` 的正文内嵌在 `pack` 里，**不要**再把 `theme.json` 放进 `files`（放了会报 `reserved-file`）。
- `files` 的键是包内相对路径；文本类（`.css`/`.json`/`.md`/`.txt`）原样存字符串，二进制存 `data:<mime>;base64,…`。
- 路径安全：禁止 `..`、绝对路径、盘符、反斜杠、NUL。
- `engineVersion` 是导出引擎版本；比当前引擎**主版本更高**时只 warning（未知字段会被忽略）。
- 校验：`node scripts/pack-check.mjs --bundle <file>`；导出前宿主会再跑一遍校验，保证"能导就能导回"。

### 11.4 体积上限（业务规则）

| 项 | 上限 | 说明 |
|---|---|---|
| 包本体（解码后） | **16 MB** | 含 `theme.json`；文件夹导入按解码后大小算。 |
| 单文件 | **8 MB** | 解码后。 |
| 文件数 | **200** | 含 `theme.json`。 |
| `.dshte.json` 文本 | **24 MB** | 单请求业务上限（16 MB 包 base64 膨胀约 21.3 MB）。 |
| 用户包数 | **100** | 回收站另算（≤100 条）。 |
| 单请求体 | **48 MB** | 传输层自卫，不是业务上限；超过时服务端按 `content-length` 回 413 并关闭连接。 |

> **v1 不做分块上传**：实测单请求 4/8/16/24/32 MB 全部 200，16 MB 包 base64 后约 21.3 MB < 24 MB 业务上限，所以保留"一次请求"；>16 MB 的包会被业务上限拒绝（`pack-too-large`），不是传输截断。详见 `README.md` 的实测结论。

### 11.5 删除与回收站

- 删除用户包 = 目录移动到 `skin-engine/trash/<id>-<时间戳>/`（附 `.trash-meta.json`），**不硬删**。
- 回收站可「恢复」或「彻底删除」；恢复时若同名包已存在，自动加 `-2/-3` 后缀并同步改写 `theme.json` 的 `id`（否则目录名≠id 会 404）。
- 删除当前激活包时，引擎自动切到"无包 + 停用"状态，避免指向不存在的包。
- 内置包不可删除；「恢复默认」= 停用皮肤 + 清空全部 overrides + 深色策略回到包默认（`state.schemePolicy=null`）。

---

## 12. 从 dream-skin 主题包迁移

Tavern 里 dream-skin 的「导入主题包…」入口被构建删掉了；本引擎把它补回来。

- 接受格式：单 JSON，`format: "dsh-dream-skin/pack"`、`version: 1`，`manifest` 含 `id`、`name`、`colorScheme`（字符串）与 `tokens` 对象。
- 映射规则：
  - 只保留前缀合法（`--dsw-` / `--dsh-tavern-` / `--dshte-`）且**值"像颜色"**的 token（`#rgb` / `#rrggbb` / `rgb()` / `rgba()` / `hsl()` / `hsla()`）；
  - 其它字段/非颜色 token **丢弃并在映射报告里列出原因**（不静默）；
  - 7 个必填 token 缺任一 → 可读错误拒绝；
  - 目标 id = `imported-` + 规范化源 id；`tokens.light` 与 `tokens.dark` **同值**（`missingScheme: "mirror"`）；
  - `preview` 取 `bg-base` / `label-primary` / `brand-primary` 三个 token 的颜色。
- 迁移后看哪里：行 4 下方的「dream-skin 映射报告」会列出 **目标 id、映射的 token、被丢弃的字段/原因**；确认后在包卡片上应用。
- 注意：长度、`color-mix()`、字体栈等"非颜色"值在 dream-skin 包里本来就会被丢掉或不被支持，迁移后需要手动补进 `tokens`（`--dshte-*`）/ `typography`。

---

## 13. 常见错误对照表

> 位置 = `pack-check` / 导入结果里的字段路径；`[code]` 是内部错误码（便于搜索）。

| 位置 / 现象 | 原因 | 怎么改 |
|---|---|---|
| `format` `[value]` | 不是 `"dshte.theme"` | 检查是否误把 `.dshte.json` 交换包当 `theme.json`（交换包顶层是 `dshte.bundle`）。 |
| `formatVersion` `[value]` | 不是数字 `1` | 写成 `1`（不是 `"1"`）。 |
| `id` `[pattern]` / `[reserved]` | id 不匹配 `^[a-z][a-z0-9-]{2,47}$`，或用了保留名 | 小写字母开头、3–48 字符、只用小写/数字/`-`；别用 `light/dark/system/builtin-*`。 |
| `name` `[missing-field]` | 缺展示名 | 补 `name`（≤48 字符）。 |
| `colorScheme` `[enum]` | 缺失或不是 `light`/`dark` | 补 `"light"` 或 `"dark"`。 |
| `tokens` `[type]` | 不是对象 | 写成 `{ "light": { … } }`。 |
| `tokens.<档>` `[unknown-scheme]` | 出现 `light/dark` 之外的档位键 | 只留 `light`、`dark`。 |
| `tokens.<档>["<name>"]` `[token-prefix]` | token 名前缀不在白名单 | 只用 `--dsw-` / `--dsh-tavern-` / `--dshte-`。 |
| `tokens.<档>["…"]` `[missing-required-token]` | 7 个必填 token 缺了 | 补齐 7 个（§4.2）。 |
| `tokens.<档>["…"]` `[unsafe-value]` | 值含 `;` `}` `</style` `@import` `javascript:` `expression(` | 去掉这些片段；一个值只写一个声明。 |
| `tokens.<档>["…"]` `[external-resource]` | `url()` 引用了外链 | 改用包内 `assets/…` 或 `data:`。 |
| `tokens.<档>["…"]` `[too-long]` | 值 >2000 字符 | 精简。 |
| `tokens.dark["…"]` `[dark-fallback]`（warning） | 深色档缺必填 token | 补 `dark` 档或接受回退到 `light`。 |
| `tokens.<档>` `[too-many-tokens]` | 单档 >400 个 | 精简 token。 |
| `engine` `[incompatible]` | `engine` 范围高于引擎常量 `0.1.0` | 改成 `>=0.1.0` 或删掉 `engine`。 |
| `typography.<key>` `[unknown-field]`（warning） | 字体键名写错 | 按 §5.1 的白名单键名。 |
| `typography.sizes.<key>` / `weights` / `leading` / `tracking` `[type]` | 值类型/范围不对 | 见 §5.1 的范围与单位。 |
| `typography.fonts[i].file` `[missing-field]` / `[file-location]` / `[file-extension]` | 没写文件 / 不在 `assets/fonts/` / 扩展名不对 | 文件放进 `assets/fonts/`，写相对路径。 |
| `typography.fonts[i].file` `[missing-file]`（导入时） | 声明了字体文件但包里没有 | 补文件；**注意 pack-check 不查这一项**。 |
| `radii.<key>` / `spacing.<key>` `[type]` / `[range]` | 值不是数字/长度，或超出 0–9999 / 0–512 | 见 §5.2/§5.3。 |
| `shadows.<key>` `[unknown-field]`（warning）/ `[unsafe-value]` | 键名不在 `card/spine/line`，或值不安全 | 见 §5.4。 |
| `regions.<name>` `[unknown-region]` | 分区名写错 | 只允许 5 个分区（§6）。 |
| `regions.<name>.<prop>` `[layout-forbidden]` | 用了布局属性 | 删掉；布局由宿主控制（§6）。 |
| `regions.<name>.<prop>` `[unknown-prop]` | 属性不在 7 个白名单 | 见 §6。 |
| `components.<name>` `[unknown-component]` | 组件名写错 | 只允许 11 个组件（§7）。 |
| `components.<name>.<knob>` `[unknown-knob]` | knob 不在该组件白名单 | 见 §7 的 knob 表。 |
| `css` `[value]` | 不是 `"theme.css"` | v1 只支持 `theme.css` 一个文件。 |
| `files["…"]` `[unsafe-path]` | 路径含 `..` / 绝对路径 / 盘符 / 反斜杠 | 用包内相对路径、`/` 分隔。 |
| `files["…"]` `[file-location]` | 文件位置不在白名单 | 根目录只放那 5 个文件名；资源只放 `assets/fonts` / `assets/images`。 |
| `files["…"]` `[file-extension]` | 扩展名不在白名单 | 字体 4 种、图片 6 种。 |
| `files` `[pack-too-large]` / `files["…"]` `[file-too-large]` / `[too-many-files]` | 超 16 MB / 8 MB / 200 个 | 减肥或拆包。 |
| `theme.css` `[css-import]` | 用了 `@import` | 删掉；资源用 `url(assets/…)`。 |
| `theme.css` `[layout-forbidden]` | 布局属性（含行号） | 删掉；见 §9.2。 |
| `theme.css` `[external-resource]` | `url()` 外链 | 改包内资源。 |
| `theme.css` `[css-brace]` | 花括号/引号不配平（带行号） | 修语法。 |
| `theme.css` `[css-too-large]` | CSS >1 MB | 精简。 |
| `theme.css` `[important-count]` / `[position-warning]`（warning） | 用了 `!important` / `position:fixed|absolute` | 允许但需自测。 |
| `theme.css` `[empty-css]`（warning） | 空文件 | 删掉文件或补内容。 |
| `[theme-css-undeclared]`（导入 warning） | 包内有 `theme.css` 但没写 `"css": "theme.css"` | 补声明，否则 CSS 不生效。 |
| `needs-confirmation`（导入 400） | 包含自定义 CSS，未确认 | 在行内点「确认导入（含自定义 CSS）」。 |
| `builtin-protected`（导入 400） | 用 `overwrite` 覆盖内置包 | 改用 `rename`（自动另存 -2）。 |
| `conflict`（导入 409） | 用户包同名且 `collision:"reject"` | 改用 `rename` / `overwrite`。 |
| `$` `[json-parse]` | `theme.json` 不是合法 JSON | 检查逗号/引号（常见：尾逗号、中文引号）。 |
| `$` `[unknown-field]`（warning） | 顶层有本版本不认识的字段 | 删掉或确认拼写；不会静默丢，会提示。 |

---

## 14. 示例与实测

### 14.1 最小示例（20 行，完整可用）

与 §1 完全相同，原样复制即可。它包含：`format` / `formatVersion` / `id` / `name` / `colorScheme` / `missingScheme` / `preview` + `tokens.light` 里的 7 个必填 token。

```json
{
  "format": "dshte.theme",
  "formatVersion": 1,
  "id": "my-warm-paper",
  "name": "My Warm Paper",
  "colorScheme": "light",
  "missingScheme": "mirror",
  "preview": { "bg": "#EFE8E0", "fg": "#14110F", "accent": "#7557A8" },
  "tokens": {
    "light": {
      "--dsw-alias-bg-base": "#EFE8E0",
      "--dsw-alias-bg-layer-1": "#FEFAF7",
      "--dsw-alias-brand-primary": "#7557A8",
      "--dsw-alias-label-primary": "#14110F",
      "--dsw-alias-label-secondary": "#5F5A52",
      "--dsw-alias-border-l1": "#DCD8D7",
      "--dsw-alias-border-l2": "#CAC6C3"
    }
  }
}
```

### 14.2 中等示例：`midnight-ink`（深色 + 字体栈/圆角/间距/分区/组件/CSS）

目录：

```
midnight-ink/
├─ theme.json
└─ theme.css
```

`theme.json`：

```json
{
  "format": "dshte.theme",
  "formatVersion": 1,
  "release": "1.0.0",
  "id": "midnight-ink",
  "name": "Midnight Ink",
  "nameZh": "午夜墨蓝",
  "author": { "name": "Example Author" },
  "description": "深色示例：墨蓝底 + 冷光强调；含字体栈、圆角、分区与组件配方。",
  "license": "MIT",
  "engine": ">=0.1.0",
  "colorScheme": "dark",
  "missingScheme": "mirror",
  "tags": ["dark", "ink", "example"],
  "preview": { "bg": "#14161C", "fg": "#E8ECF4", "accent": "#7FA7FF" },
  "tokens": {
    "dark": {
      "--dsw-alias-bg-base": "#14161C",
      "--dsw-alias-bg-layer-1": "#1C1F27",
      "--dsw-alias-bg-layer-2": "#222633",
      "--dsw-alias-brand-primary": "#7FA7FF",
      "--dsw-alias-label-primary": "#E8ECF4",
      "--dsw-alias-label-secondary": "#9AA4B5",
      "--dsw-alias-border-l1": "#2A2F3A",
      "--dsw-alias-border-l2": "#3A4150",
      "--dsh-tavern-accent": "#7FA7FF",
      "--dshte-bg-base": "#14161C",
      "--dshte-bg-sidebar": "#181B23",
      "--dshte-bg-surface": "#1C1F27",
      "--dshte-bg-elevated": "#222633",
      "--dshte-fg-primary": "#E8ECF4",
      "--dshte-fg-body": "#C6CDDA",
      "--dshte-fg-secondary": "#9AA4B5",
      "--dshte-accent": "#7FA7FF",
      "--dshte-accent-soft": "#25314A",
      "--dshte-border-hairline": "#2A2F3A",
      "--dshte-danger": "#F07A86"
    }
  },
  "typography": {
    "sans": "\"PingFang SC\",\"Noto Sans SC\",\"Microsoft YaHei\",system-ui,sans-serif",
    "latin": "\"Inter\",\"Segoe UI\",sans-serif",
    "display": "\"Inter\",\"PingFang SC\",sans-serif",
    "mono": "\"JetBrains Mono\",Consolas,monospace",
    "sizes": { "eyebrow": 10, "h2": 16, "body": 13, "note": 11, "button": 11.5 },
    "weights": { "regular": 400, "semibold": 600, "bold": 700 },
    "leading": { "body": 1.55, "tight": 1.3 },
    "tracking": { "eyebrow": "0.1em" }
  },
  "radii": { "quote": 4, "sm": 6, "card": 12, "input": 14, "pill": 9999 },
  "spacing": { "xs": 8, "sm": 12, "md": 18, "lg": 26, "inputPad": 12, "sidebarInset": 14 },
  "shadows": {
    "card": "0 1px 0 rgba(0,0,0,.35), 0 8px 22px rgba(0,0,0,.28)",
    "spine": "0 0 10px rgba(127,167,255,.25)",
    "line": "#2A2F3A"
  },
  "regions": {
    "sidebar": { "background": "var(--dshte-bg-sidebar)" },
    "center": { "background": "var(--dshte-bg-base)" },
    "rightbar": { "background": "transparent" },
    "composer": { "background": "var(--dshte-bg-elevated)", "borderColor": "var(--dshte-border-hairline)" }
  },
  "components": {
    "card": {
      "background": "var(--dshte-bg-surface)",
      "borderColor": "var(--dshte-border-hairline)",
      "borderWidth": 1,
      "radius": 12,
      "shadow": "var(--dshte-shadow-card)",
      "paddingX": 18,
      "paddingY": 18
    },
    "buttonPrimary": {
      "background": "var(--dshte-accent)",
      "color": "#0B1020",
      "radius": 8,
      "height": 32,
      "fontSize": 11.5,
      "fontWeight": 600
    },
    "input": {
      "background": "var(--dshte-bg-elevated)",
      "color": "var(--dshte-fg-body)",
      "radius": 14,
      "fontSize": 13,
      "placeholderColor": "#78839A"
    },
    "navItem": {
      "color": "var(--dshte-fg-secondary)",
      "activeBackground": "var(--dshte-bg-elevated)",
      "activeColor": "var(--dshte-fg-primary)",
      "radius": 6,
      "height": 36,
      "fontSize": 12.5
    },
    "badge": {
      "background": "var(--dshte-accent-soft)",
      "color": "var(--dshte-accent)",
      "radius": 9999,
      "fontSize": 10,
      "fontWeight": 600
    }
  },
  "css": "theme.css"
}
```

`theme.css`：

```css
/* Midnight Ink — 只做"安全通道"内的视觉微调：无布局属性、无 @import、无外链。 */

::selection {
  background: var(--dshte-accent-soft);
  color: var(--dshte-fg-primary);
}

[data-slot="conversation.session"] blockquote {
  border-left: 3px solid var(--dshte-accent);
}

[data-slot="conversation.chat.flow"] .dsh-tavern-assistant p {
  letter-spacing: 0.01em;
}

[data-slot="sidebar.settings"] button {
  border-radius: var(--dshte-radius-sm);
}
```

> 这个示例故意**不带二进制资源**（字体文件/图片），保证整段可复制。要加自带字体或背景图，按 §9 建 `assets/fonts/`、`assets/images/` 并在 `typography.fonts[]` / `regions.*.backgroundImage` 里引用（记得文件必须真实存在）。

### 14.3 本文示例已实测

实测环境：Windows，Node **v24.12.0**，插件 **0.2.0**（Step 7 发布版），校验器 `src/shared/pack-schema.js`（包格式 v1）。实测日期：**2026-11-03**。
示例目录位于开发工作区 `.tmp/docs-examples/`（`minimal-warm-paper/`、`medium-midnight-ink/`），命令在插件目录下执行。

**最小示例（§1 的 20 行）**：

```
$ cd <插件目录>
$ node scripts/pack-check.mjs <工作区>/.tmp/docs-examples/minimal-warm-paper
pack: my-warm-paper — My Warm Paper (release 1.0.0, light)
stats: {"files":1,"bytes":577,"pack":{"schemes":["light"],"tokens":7,"regions":0,"components":0}}
RESULT: OK
[exit=0]
```

**中等示例（§14.2）**：

```
$ node scripts/pack-check.mjs <工作区>/.tmp/docs-examples/medium-midnight-ink
pack: midnight-ink — 午夜墨蓝 (release 1.0.0, dark)
stats: {"files":2,"bytes":4033,"pack":{"schemes":["dark"],"tokens":20,"regions":4,"components":5}}
RESULT: OK
[exit=0]
```

**同一中等示例导出为 `.dshte.json` 后复验（`--bundle`）**：

```
$ node scripts/pack-check.mjs --bundle <工作区>/.tmp/docs-examples/medium-midnight-ink.dshte.json
pack: midnight-ink — 午夜墨蓝 (release 1.0.0, dark)
stats: {"fileCount":1,"totalBytes":473,"packErrors":0,"packWarnings":0}
RESULT: OK
[exit=0]
```

结论：两个示例均为 **0 error / 0 warning**；`.dshte.json` 交换包同样通过校验。建议你复制后先跑 `pack-check`，再导入。

---

## 附：v1 明确做不到的事（避免误解）

1. **改不了三栏列宽/顺序/显隐**：宿主用内联 `grid-template-columns` + 常量控制列宽；CSS 强行 `!important` 覆盖会废掉拖动把手。`regions`/`components` JSON 通道禁止布局属性，`theme.css` 对三栏/列钩子上的布局属性直接拒绝（§6/§9.2）。
2. **改不了文案、按钮有无、DOM 结构**：CSS 只能做视觉，不能真正增删节点。
3. **没有"深色设计稿"这回事**：v1 只提供 `mirror` / `inherit` 两种策略，不凭空生成深色配色；深色需要作者自己写 `tokens.dark`。
4. **没有分块上传**：单包 >16 MB 直接拒绝（§11.4）。
5. **`assets.preview` 大预览图**：v1 只做路径/存在性校验，设置页卡片仍只画 `preview` 色卡，暂不渲染图片。
6. **组件选择器可能随 Tavern 版本漂移**：未命中的组件"没效果、不报错"，看设置页「诊断」行的钩子命中率。
7. **不校验颜色语义**：token 值只需是安全 CSS 值；写错的颜色由浏览器丢弃（诊断行只能对 hex 颜色逐值核验）。

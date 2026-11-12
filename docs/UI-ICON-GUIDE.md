# 人生管家 lovelife · UI 图标规范

> 版本：v1.0.9 起生效 · 状态：**强制规范**
> 本文件是全软件图标的唯一依据。新增/修改界面时，先查本表再写代码；表中没有的语义，**先补表再使用**。

## 1. 总则

1. **唯一图标库：[Lucide](https://lucide.dev)**（ISC 开源协议，1.5px 描边风格）。
   本地打包于 `app/vendor/lucide.min.js`，不依赖任何网络 CDN。
2. **禁止**使用 emoji 作为功能图标；**禁止**手绘/复制其他库的 SVG 进入界面。
3. **唯一例外**：用户头像（24 个表情头像池）属个人内容，保留 emoji。
4. 图标颜色一律 `currentColor`（跟随文字色），不单独上色；需要强调色时给外层文字上色。

## 2. 用法（代码规范）

```js
// ✅ 标准：统一助手，自动把 kebab 名转成内联 SVG
UI.icon('camera', 20);          // → <svg class="ic" …>…</svg>
UI.icon('trash-2');             // 默认 16px

// ❌ 禁止
'<i data-lucide="camera"></i>'  // 不用 DOM 扫描式（渲染时序不可控）
'<img src="…/camera.svg">'      // 不引外部文件
'📷'                            // 不用 emoji 当功能图标
```

- 助手实现在 `app/js/ui.js`（`UI.icon`），键名取 Lucide 官方 kebab-case 名。
- 图标查不到时回退为圆角占位方块并 `console.warn`，**不要**静默用错图标。

## 3. 尺寸档位（只允许这四档）

| 档位 | 尺寸 | 用途 |
|---|---|---|
| xs | 14px | 行内小标、chip 内、表单项前缀 |
| sm | 16px | 按钮内、列表行内 |
| md | 20px | 导航项、卡片头、分类图标 |
| lg | 24px | 页面标题、空状态、弹窗标题 |
| 展示档 | 28/32/48px | 仅限占位图/空态/天气大图（pick-noimg 32、look/rec-noimg 28~32、item-noimg 48、天气 32） |

## 4. 语义映射表（全站唯一出处）

### 4.1 导航与页面
| 语义 | 图标名 | | 语义 | 图标名 |
|---|---|---|---|---|
| 我的统计 | `chart-column` | | 穿搭日历 | `calendar-days` |
| 我的数码 | `gamepad-2` | | 美食日历 | `utensils` |
| 我的衣橱 | `shirt` | | 设置 | `settings` |
| 我的生活 | `heart` | | 全局搜索 | `search` |

### 4.2 操作按钮
| 语义 | 图标名 | | 语义 | 图标名 |
|---|---|---|---|---|
| 新建/添加 | `plus` | | 保存 | `save` |
| 编辑 | `pencil` | | 删除 | `trash-2` |
| 刷新/检查更新 | `refresh-cw` | | 关闭 | `x` |
| 上移 / 下移 | `chevron-up` / `chevron-down` | | 隐藏/显示 | `eye-off` / `eye` |
| 排序方向 | `arrow-up-down` | | 排序字段 | `arrow-down-wide-narrow` |
| 记数码 / 记衣服 / 记美妆 | `plus`（文字已含"记xx"） | | 穿搭打卡 | `calendar-check` |
| 饮食打卡 | `utensils` | | 栏目设置 | `sliders-horizontal` |
| 穿搭组合 | `layers` | | 妆容组合 | `palette` |
| 裁切 | `crop` | | 一键抠图 | `scissors` |
| 上传图片 | `image-plus` | | 备份导出 | `download` |
| 重新定位 | `map-pin` | | 导入 / 导出账单 | `file-down` / `file-up` |
| 热力打卡 | `flame` | | 倒计时 | `timer` |
| 翻月 / 翻年 | `chevron-left` / `chevron-right` | |  |  |
| 备份恢复 | `upload` | | 迁移数据 | `folder-sync` |
| 创建桌面快捷方式 | `monitor-up` | | 查看更新日志 | `file-text` |
| 手动填入 | `pencil-line` | | 套用/打卡 | `check` |
| 看详情 | `eye` | | 恢复默认 | `rotate-ccw` |

### 4.3 分类树（服务端 `icon` 字段存图标名）
| 分类 | 图标名 | | 分类 | 图标名 |
|---|---|---|---|---|
| 主机类 | `laptop` | | 上装 | `shirt` |
| 影像类 | `camera` | | 下装 | `pants`（§7 扩展） |
| 音频类 | `headphones` | | 内衣家居 | `house` |
| 显示外设 | `monitor` | | 鞋靴 | `footprints` |
| 存储 | `hard-drive` | | 配饰 | `gem` |
| 配件 | `plug` | | 正装/礼服 | `crown` |
| 其他数码 | `watch` | | 运动服饰 | `dumbbell` |
| 游戏 | `gamepad-2` | | 护肤 | `droplets` |
| 数码兜底/未分类 | `package` | | 彩妆 | `palette` |
| 工具 | `brush` | | 香氛 | `flower-2` |
| 身体护理 | `bath` | | 美妆兜底/未分类 | `package` |

### 4.4 天气（weather.js WMO 码 → 图标名）
| 天气 | 图标名 | | 天气 | 图标名 |
|---|---|---|---|---|
| 晴 | `sun` | | 小雨 | `cloud-drizzle` |
| 大部晴 | `cloud-sun` | | 中雨 | `cloud-rain` |
| 多云 | `cloud` | | 大雨/暴雨 | `cloud-rain-wind` |
| 阴 | `cloudy` | | 冻雨 | `cloud-hail` |
| 雾/雾凇 | `cloud-fog` | | 雪（小/中/阵） | `cloud-snow` |
| 毛毛雨 | `cloud-drizzle` | | 大雪/雪粒 | `snowflake` |
| 雷雨/雷雨冰雹 | `cloud-lightning` | | 手动设定 | `pencil-line` |

### 4.5 状态 / 占位 / 分域
| 语义 | 图标名 | | 语义 | 图标名 |
|---|---|---|---|---|
| 数码（分域/兜底） | `gamepad-2` | | 空瓶/回购 | `recycle` |
| 衣橱 | `shirt` | | 保修 | `shield-check` |
| 生活/美妆 | `heart` | | 吃灰 | `moon` |
| 美食 | `utensils` | | 临期 | `alarm-clock` |
| 未分类/无图占位 | `package` | | 成本 | `coins` |

### 4.6 设置（v1.0.9 分标签）
| 标签 | 图标名 | | 标签 | 图标名 |
|---|---|---|---|---|
| 账号 | `users` | | 使用偏好 | `sliders-horizontal` |
| 数据与备份 | `database` | | 软件 | `app-window` |
| 消费与统计口径 | `wallet` | | 危险操作 | `triangle-alert` |

### 4.7 其它控件
| 语义 | 图标名 | | 语义 | 图标名 |
|---|---|---|---|---|
| 拖动手柄 | `grip-vertical` | | 游戏兜底/光盘 | `disc-3` |

### 4.8 钱袋 / 记账（v1.1.0）
| 语义 | 图标名 | | 语义 | 图标名 |
|---|---|---|---|---|
| 我的钱袋（导航/账户） | `wallet` | | 记一笔 / 添加 | `plus` |
| 流水账 | `list` | | 导入管理 | `upload` |
| 查看统计 | `chart-column` | | 转账 | `arrow-left-right` |
| 预算 | `target` | | 标签库 | `tags` |
| 下载模板 | `download` | | 选择文件 | `file-up` |
| 导入批次 | `history` | | 支出构成 | `pie-chart` |
| 收支趋势 | `trending-up` | | 升/降序 | `arrow-up` / `arrow-down` |
| 食品餐饮 | `utensils` | | 购物消费 | `shopping-bag` |
| 出行交通 | `car` | | 居家生活 | `home` |
| 休闲娱乐 | `music` | | 文化教育 | `book-open` |
| 健康医疗 | `heart-pulse` | | 人情往来/礼金 | `gift` |
| 宠物 | `paw-print` | | 其他收支 | `more-horizontal` |
| 工资 | `briefcase` | | 兼职外快 | `zap` |
| 报销 | `receipt` | | 理财收益 | `trending-up` |
| 二手闲置 | `refresh-cw` | | 现金 | `banknote` |
| 微信 | `message-circle` | | 支付宝 | `smartphone` |
| 银行卡 | `credit-card` | | 账单行图标 | 分类图标（同上） |

## 7. 扩展图标（Lucide 缺失且语义必需时自绘）

lucide 目前没有"裤子"类图标；`pants` 为自绘补充，**lucide 同风格**（24 网格 / stroke=currentColor / stroke-width 2 / 圆角端点），登记如下：

| 名称 | 语义 | SVG 路径（children） | 启用日期 |
|---|---|---|---|
| `pants` | 下装 | `M5 4h14l-1 5-1 11h-4l-1-9-1 9H8L7 9z` | 2026-11-04 |

- 实现在 `app/js/ui.js` 的 `CUSTOM_ICONS` 表，`UI.icon()` 自动回退查找
- lucide 官方补了同类图标后，优先改回官方名并从本表移除

## 5. 新增语义流程

1. 先在 [lucide.dev](https://lucide.dev/icons) 选名（kebab-case）；
2. 在本文件 §4 对应表里补一行；
3. 代码中 `UI.icon('名字', 档位)`；
4. 提交时说明映射理由。

## 8. 版本记录

| 日期 | 变更 |
|---|---|
| 2026-11-04 | 初版：确立 Lucide 唯一图标库、四档尺寸、全站映射表（v1.0.9 全量替换） |
| 2026-11-04 | 修订：下装改自绘 `pants`（§7）；「我的生活」sparkles→heart |
| 2026-11-04 | 修订：登记展示档尺寸（28/32/48）与 sparkles/circle-check/grip-vertical/disc-3 |
| 2026-11-04 | v1.1.0 钱袋：登记 §4.8 记账/分类/账户全套图标（28 语义） |

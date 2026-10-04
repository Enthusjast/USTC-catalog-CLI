# USTC Catalog CLI

基于 TypeScript、Node.js 和 npm 的中国科学技术大学本科教务目录命令行客户端。

它把 [catalog.ustc.edu.cn](https://catalog.ustc.edu.cn) 的公开只读查询转换为适合终端和脚本使用的命令。默认输出中文表格，也支持 JSON 和 CSV；默认请求最新数据，网络失败时自动回退到最近的本地 SQLite 缓存。

## 快速开始

### 环境要求

- Node.js 20.18.1 或更新版本；
- npm；
- 支持 `better-sqlite3` 的本机编译或预构建环境。

检查 Node.js 和 npm：

```bash
node --version
npm --version
```

### 通过 npm 安装

包发布后，执行：

```bash
npm install --global ustc-catalog-cli
```

安装后，程序命令名是 `catalog`：

```bash
catalog --help
catalog --version
```

版本命令输出产品名和版本号，例如：

```text
USTC-catalog-CLI 0.2.2
```

### 第一次查询

```bash
# 搜索课程
catalog course search 数学

# 查看当前默认学期的数学课程
catalog lesson list --course 数学

# 查看今天的空闲教室
catalog classroom list --available

# 找出一周内每天 14:00–16:00 都空闲、可借用且至少 30 座的教室
catalog classroom available --from-date 2026-10-04 --to-date 2026-10-10 --from 14:00 --to 16:00 --bookable --min-seats 30

# 按教室汇总整周使用情况
catalog classroom week --summary

# 导出某日教室使用记录到日历
catalog --ics classroom list --date 2026-10-04 > classrooms.ics
```

默认输出是终端表格。需要脚本处理时，使用 `--json` 或 `--csv`：

```bash
catalog --json course search 数学
catalog --csv lesson list --course 数学 > lessons.csv
catalog --ics lesson list --semester 461 --course 数学 > math.ics
```

## 命令速览

所有命令只查询公开数据，不执行登录、选课或数据修改操作。

| 命令 | 用途 | 示例 |
| --- | --- | --- |
| `catalog semester list` | 查看学期及学期代码 | `catalog semester list` |
| `catalog department list` | 查看院系树 | `catalog department list` |
| `catalog calendar` | 查看教学日历占位信息 | `catalog calendar` |
| `catalog course search <关键词>` | 搜索课程 | `catalog course search 数学` |
| `catalog course categories` | 查看网页课程分类代码 | `catalog course categories` |
| `catalog course list <分类>` | 查看课程分类目录 | `catalog course list quality` |
| `catalog course show <课程编号...>` | 查看一个或多个课程详情 | `catalog course show MATH1001` |
| `catalog program catalog [关键词]` | 搜索 2013 版静态培养方案目录 | `catalog program catalog 数学` |
| `catalog program document <编号>` | 查看静态培养方案正文 | `catalog program document 001001` |
| `catalog program history` | 查看历史培养方案链接 | `catalog program history` |
| `catalog program list` | 查看培养方案列表 | `catalog program list --department 001` |
| `catalog program show <计划ID>` | 查看培养方案及课程模块 | `catalog program show 3430` |
| `catalog program module <模块ID>` | 查看培养方案模块 | `catalog program module 10001 --courses` |
| `catalog lesson list` | 查询全校教学班 | `catalog lesson list --course 数学` |
| `catalog lesson options` | 查看学期教学班筛选值与数量 | `catalog lesson options --semester 461` |
| `catalog lesson conflicts <课堂号...>` | 检查教学班的可能时间冲突 | `catalog lesson conflicts MATH1001.01 PHYS1001.01 --semester 461` |
| `catalog lesson show <课堂号...>` | 查看教学班和课程详情 | `catalog lesson show MATH1001.01 --semester 461` |
| `catalog classroom list` | 按日期、楼栋、记录类型和房间属性查看教室使用情况 | `catalog classroom list --usage-type 会议,讲座 --bookable` |
| `catalog classroom available` | 按单日或多日时间范围找空闲教室 | `catalog classroom available --from-date 2026-10-04 --to-date 2026-10-10 --from 14:00 --to 16:00` |
| `catalog classroom buildings` | 查看楼栋代码和房间数 | `catalog classroom buildings` |
| `catalog classroom show <教室>` | 查看单个教室 | `catalog classroom show 2303` |
| `catalog classroom week` | 查看一周教室使用情况或按教室汇总 | `catalog classroom week --summary` |
| `catalog exam list` | 查询考试 | `catalog exam list --course 微积分` |
| `catalog exam show <考试ID>` | 查看单个考试 | `catalog exam show 13138 --semester 441` |
| `catalog substitute list` | 查询替代课程关系 | `catalog substitute list --course 数学分析` |
| `catalog substitute summary` | 查看网页提供的替代关系汇总表链接 | `catalog substitute summary` |
| `catalog cache status` | 查看缓存数据库和快照统计 | `catalog cache status` |
| `catalog cache clear` | 清理缓存 | `catalog cache clear --yes` |
| `catalog cache prefetch` | 预取学期与指定日期缓存 | `catalog cache prefetch --semester 461 --date 2026-10-04` |
| `catalog cache prune` | 删除较旧的快照 | `catalog cache prune --older-than 30d --yes` |
| `catalog doctor` | 检查运行环境与 API | `catalog doctor --offline` |
| `catalog completion show <shell>` | 输出 shell 补全脚本 | `catalog completion show zsh` |
| `catalog preset save/run/list/delete` | 保存和重用只读查询 | `catalog preset save 数学课 -- lesson list --course 数学` |

学期、计划、课堂号和考试 ID 应使用网站返回的实际值。可先执行 `catalog semester list`、`catalog department list` 或不带筛选条件的列表命令发现可用值。

## 输出格式

### 表格

默认输出中文人类可读表格：

```bash
catalog course search 数学 --limit 5
```

表格末尾会显示数据来源和抓取时间；网络失败回退缓存时会在 stderr 输出警告，`--offline` 使用缓存时会输出提示，并显示缓存数据时间。

### JSON

JSON 输出统一为 `meta` 和 `data` 两个字段，适合脚本处理：

```bash
catalog --json lesson list --course 数学 \
  | jq '.data[] | {课堂号: .code, 课程名: .courseName}'
```

`meta` 包含资源、查询范围、数据来源、抓取时间、数据时间和是否过期等信息。`source` 可能是 `network`、`cache`、`static` 或 `mixed`；内置培养方案目录和网页占位信息使用 `static`。

### CSV

CSV 使用 UTF-8 BOM，适合 Excel 或其他表格软件：

```bash
catalog --csv lesson list --department 001 > lessons.csv
```

教学班 CSV 包含网页 Excel 导出的主要字段，如课堂类型、课程范畴分类、课程类型、授课语言、考核方式、本研同堂和上课班级。

## MCP

本包同时提供本地 stdio MCP 服务。MCP 客户端可以调用课程分类、培养方案、教学班筛选选项和冲突检查、楼栋发现、时段空闲教室、考试、替代课程、学期和院系等只读查询；返回统一的 `meta/data` JSON，不返回终端表格，也不提供缓存清理、预设管理、登录或选课操作。

全局安装后，在 MCP 客户端配置：

```json
{
  "mcpServers": {
    "ustc-catalog": {
      "command": "catalog-mcp"
    }
  }
}
```

不安装全局命令时，可以使用 `npx`：

```json
{
  "mcpServers": {
    "ustc-catalog": {
      "command": "npx",
      "args": [
        "--yes",
        "--package",
        "ustc-catalog-cli@0.2.2",
        "catalog-mcp"
      ]
    }
  }
}
```

缓存目录和网站地址通过环境变量配置，例如：

```json
{
  "mcpServers": {
    "ustc-catalog": {
      "command": "catalog-mcp",
      "env": {
        "CATALOG_CACHE_DIR": "/path/to/catalog-cache"
      }
    }
  }
}
```

完整工具清单、参数和返回约定见 [CLI 与 MCP 交互说明](./guide.md)。

### 常用全局选项

全局选项可以与各个子命令组合使用：

| 选项 | 作用 |
| --- | --- |
| `--json` | 输出规范化 JSON |
| `--csv` | 输出规范化 CSV |
| `--ics` | 教学班、考试列表或教室使用记录导出 iCalendar |
| `--offline` | 只读取缓存，不发起网络请求 |
| `--no-cache` | 忽略已有缓存并强制请求最新数据 |
| `--cache-dir <path>` | 覆盖 SQLite 缓存目录 |
| `--timeout <ms>` | 设置网络超时时间 |
| `--limit <n>` | 限制输出记录数 |
| `--offset <n>` | 跳过前 `n` 条列表记录 |
| `--all` | 表格输出全部记录 |
| `--no-color` | 关闭表格颜色 |
| `--wide` | 表格列不截断文本 |
| `--quiet` | 不输出来源、时间等提示 |
| `--verbose` | 将请求和缓存诊断信息输出到 stderr |

`--limit` 和 `--offset` 适用于列表结果；详情对象不支持 `--offset`。JSON 和 CSV 默认不受表格分页大小限制，表格输出较多记录时可使用 `--all`。

## 缓存、最新数据和离线模式

默认查询流程如下：

1. 请求网站最新数据；
2. 请求成功后写入本地 SQLite 快照；
3. 网络请求失败时，如果存在对应快照，则回退到最近缓存并标记为过期；
4. 没有缓存时返回错误。

强制离线读取：

```bash
catalog --offline course search 数学
```

忽略已有缓存并强制联网：

```bash
catalog --no-cache course search 数学
```

`--offline` 和 `--no-cache` 不能同时使用。

查找某日一段连续的空闲时间：

```bash
catalog classroom available --date 2026-10-04 --from 14:00 --to 16:00 --min-seats 30
```

多日查询只返回日期范围内每天该时段都没有公开占用记录的教室：

```bash
catalog classroom available --from-date 2026-10-04 --to-date 2026-10-10 --from 14:00 --to 16:00 --bookable --min-seats 30
```

“空闲”是根据公开课表记录推算，不代表教室已获准预约。教室使用记录还可以导出 iCalendar：

```bash
catalog --ics classroom list --date 2026-10-04 > classrooms.ics
catalog --ics classroom show 2303 --date 2026-10-04 > room-2303.ics
catalog --ics classroom week --date 2026-10-04 > classroom-week.ics
```

日历只包含课表中已有的使用记录，不会把推算出的空闲时段写成预约事件。`--ics` 不能用于 `classroom available`。

缓存可按学期预取，按抓取时间清理：

```bash
catalog cache prefetch --semester 461 --date 2026-10-04
catalog cache prune --older-than 30d --yes
```

查看运行环境、生成 shell 补全或保存常用查询：

```bash
catalog doctor --offline
catalog completion show zsh
catalog preset save 数学课 -- lesson list --course 数学
catalog preset run 数学课 --json
```

冲突检查只比较命令行中明确列出的公开教学班，不推断学生选课关系。ICS 日历导出也只包含公开课程和考试数据。

预取一个学期的教学班和考试缓存，也可重复指定教室日期：

```bash
catalog cache prefetch --semester 461 --date 2026-10-04 --date 2026-10-05
```

清除 30 天以前的快照需要确认：

```bash
catalog cache prune --older-than 30d --yes
```

`catalog doctor` 可离线检查 Node.js、SQLite 和缓存目录；命令补全脚本由 `catalog completion show zsh|bash|fish|powershell` 输出。预设保存在用户配置目录，仅接受公开只读查询，不支持 `cache clear`。

指定日期和时段查找连续空闲教室：

```bash
catalog classroom available --date 2026-10-04 --from 14:00 --to 16:00 --min-seats 30
```

课程冲突检查只比较显式给出的公开教学班编号；无法解析的周次会单独提示，不会推断选课学生关系：

```bash
catalog lesson conflicts MATH1001.01 PHYS1001.01 --semester 461
```

查询结果可导出为日历：

```bash
catalog --ics lesson list --semester 461 --course 数学 > math.ics
catalog --ics exam list --semester 461 > exams.ics
```

### 缓存位置

默认数据库路径：

```text
Linux:   ~/.cache/catalog-cli/catalog.sqlite
macOS:   ~/Library/Caches/catalog-cli/catalog.sqlite
Windows: %LOCALAPPDATA%/catalog-cli/catalog.sqlite
```

也可以使用 `--cache-dir <path>` 指定临时或项目专用缓存目录。

### 缓存管理

```bash
catalog cache status
catalog cache clear --resource lessons --yes
catalog cache clear --yes
```

交互终端清理缓存前会要求确认。非交互环境以及 JSON/CSV 输出必须显式提供 `--yes`。

## 数据范围和权限边界

- 只使用 `catalog.ustc.edu.cn` 当前公开页面使用的只读数据；
- 课程、培养方案、学期、院系、教学班、教室、考试和替代课程查询均只读；
- 不实现 CAS 登录、认证绕过、个人课表、成绩、选课或退课；
- 不修改教务数据；
- 培养方案正文解析为文本、表格和课程引用，不执行其中的 HTML 脚本；
- API 原始 JSON 会经过适配器转换，表格、JSON 和 CSV 输出使用 CLI 的稳定字段；
- 网站进入需要统一认证的限制模式时，CLI 会提示用户先在网页端完成认证，不代为登录。

## 从源码运行和开发

如果需要参与开发：

```bash
git clone https://github.com/Enthusjast/USTC-catalog-CLI.git
cd USTC-catalog-CLI
npm install
npm run build
node dist/main.js --version
```

将源码链接为 `catalog` 命令：

```bash
npm link
catalog --version
```

运行完整检查：

```bash
npm run check
```

分步执行：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:coverage
npm run mcp:smoke
npm run package:smoke
```

检查 npm 包内容：

```bash
npm pack --dry-run
npm pack
```

推送形如 `v0.2.2` 的 Git tag 会触发 GitHub Actions 发布流程。发布前需要在 npm 包设置中为该 GitHub 仓库配置 Trusted Publishing（OIDC）；日常开发不需要 npm token 写入仓库。

当前包生成的本地压缩包名称类似 `ustc-catalog-cli-0.2.2.tgz`。

## 详细文档

完整命令、参数、输出字段、缓存策略、错误和退出码见 [CLI 交互说明](./guide.md)。

## 许可证

[MIT License](./LICENSE)

# USTC Catalog CLI 使用说明

- 版本：0.2.1
- 文档日期：2026-08-26
- 命令名：catalog
- 语言：中文
- 运行环境：Node.js >=20.18.1

## 1. 快速开始

开发环境直接运行：

```bash
npm install
npm run build
node dist/main.js --help
```

如果已经把包安装为命令行程序，可以把 node dist/main.js 替换为 catalog。

最常用的查询：

```bash
# 搜索课程
catalog course search 数学

# 查看网页课程目录中的数学科学学院课程
catalog course list 001

# 查看当前培养方案计划
catalog program list --department 001 --grade 2026

# 查看某学期教学班
catalog lesson list --semester 461 --course 数学

# 查看某天的教室
catalog classroom list --date 2026-08-26 --building 2

# 查看考试
catalog exam list --semester 441 --course 微积分

# 查看替代关系
catalog substitute list --course 数学分析
```

## 2. 命令行语法

通用形式：

```bash
catalog [全局选项] <资源> <动作> [位置参数] [动作选项]
```

例如：

```bash
catalog --json course search 数学 --limit 10
catalog course search 数学 --json --limit 10
```

全局选项可以放在资源命令之前，也可以放在动作之后。推荐把输出、缓存等全局选项放在 catalog 后面：

```bash
catalog --json --offline lesson list --semester 461
```

没有参数时，程序显示顶层帮助，不会进入交互式菜单，也不会访问网站。

## 3. 顶层命令

当前命令树：

```bash
catalog semester list
catalog department list
catalog calendar

catalog course search <keyword>
catalog course show <code...>
catalog course list <category>

catalog program catalog [keyword]
catalog program document <code>
catalog program history
catalog program list
catalog program show <id>
catalog program module <id>

catalog lesson list
catalog lesson show <code...>

catalog classroom list
catalog classroom show <room>
catalog classroom week

catalog exam list
catalog exam show <id>

catalog substitute list
catalog substitute summary

catalog cache status
catalog cache clear
```

## 4. 全局选项

以下选项可以用于网络查询、静态正文查询或缓存命令。具体命令是否使用某个选项，以该命令的行为为准。

| 选项 | 作用 |
| --- | --- |
| `--json` | 输出规范化 JSON |
| `--csv` | 输出 UTF-8 CSV，带 BOM |
| `--offline` | 只读取本地缓存，不访问网络 |
| `--no-cache` | 不读取已有快照，强制请求；成功后仍写入缓存 |
| `--cache-dir <path>` | 指定 SQLite 缓存目录 |
| `--timeout <ms>` | 设置网络请求超时，默认 15000 毫秒 |
| `--limit <n>` | 限制输出记录数 |
| `--offset <n>` | 跳过前 n 条记录，默认 0 |
| `--all` | 表格输出全部记录 |
| `--no-color` | 关闭表格颜色 |
| `--quiet` | 不输出普通提示和缓存回退警告 |
| `--verbose` | 将网络、缓存和回退诊断写入 stderr |

`cache clear` 另有动作级选项 `--yes`，用于确认删除缓存。

执行 `catalog --version` 会输出产品名和版本号，例如：

```text
USTC-catalog-CLI 0.2.1
```

### 4.1 选项约束

- `--json` 与 `--csv` 互斥；
- `--offline` 与 `--no-cache` 互斥；
- `--limit`、`--offset` 必须是非负整数；
- `--timeout` 必须是正整数。

错误示例：

```bash
catalog --json --csv course search 数学
catalog --offline --no-cache course search 数学
```

这两种情况都会返回参数错误，不会发出网络请求。

### 4.2 `--limit`、`--offset` 和 `--all`

默认表格分页大小：

| 资源 | 默认表格行数 |
| --- | --- |
| 教学班 | 25 |
| 考试 | 25 |
| 替代关系 | 40 |
| 其他列表 | 25，或由命令自己的表格逻辑决定 |

行为规则：

- 表格没有指定 `--limit` 时，只显示默认页数，并在末尾提示总数；
- 表格使用 `--all` 时显示全部行；
- 表格同时使用 `--all` 和 `--limit` 时，`--all` 优先；
- `--offset` 在表格、JSON、CSV 中都生效；
- JSON/CSV 默认输出完整过滤结果，不受表格默认页数限制；
- JSON/CSV 指定 `--limit` 后才截取结果；
- 对于嵌套 JSON，`--limit` 作用于最外层数组，不会截断组内的 courses 或模块内课程；
- 对于表格，CLI 使用扁平化后的表格行数。
- 对于对象型详情，`--offset` 大于 0 会返回参数错误；`--limit` 不截断对象。

例如，课程分类 JSON 的顶层记录是课程分组，而表格的记录是课程：

```bash
# JSON 的 --limit 1 表示保留一个课程分组
catalog --json course list 001 --limit 1

# 表格的 --limit 10 表示显示十门课程行
catalog course list 001 --limit 10
```

## 5. 数据请求、缓存和来源

### 5.1 默认在线策略

普通查询的顺序是：

```text
请求 /api/restricted
        ↓
请求最新数据
        ↓
规范化、筛选、排序
        ↓
写入 SQLite 快照
        ↓
输出结果
```

如果网络请求失败，但已有同一资源和作用域的快照，CLI 会自动使用最近快照：

```text
网络失败 → 读取最近缓存 → 输出缓存数据 → 标记 stale=true
```

只有网络传输错误会触发上述回退。HTTP 404、其他 HTTP 错误、无效 JSON 或接口数据结构变化会直接报错，避免把不再适用的旧快照误显示为可用数据。

如果网络和缓存都失败，命令失败并返回错误码。

### 5.2 `--offline`

`--offline` 完全不访问网络，只读取匹配的 SQLite 快照：

```bash
catalog --offline course search 数学
catalog --offline lesson list --semester 461
```

没有对应快照时返回：

```text
错误 [CACHE_MISS]：没有找到 lessons/461 的缓存。
提示：去掉 --offline 后联网获取，或先执行一次普通查询。
```

静态内置目录 program catalog 不需要网络，JSON 的 `meta.source` 为 `static`；静态培养方案正文只有在此前成功请求并缓存后才能离线读取。

### 5.3 `--no-cache`

`--no-cache` 跳过已有缓存，强制请求最新数据：

```bash
catalog --no-cache course search 数学
```

请求成功后仍会覆盖写入缓存。请求失败时不会读取旧缓存，因此会直接失败。

### 5.4 缓存目录

默认数据库位置：

```text
Linux:   $XDG_CACHE_HOME/catalog-cli/catalog.sqlite
         或 $HOME/.cache/catalog-cli/catalog.sqlite
macOS:   $HOME/Library/Caches/catalog-cli/catalog.sqlite
Windows: %LOCALAPPDATA%/catalog-cli/catalog.sqlite
```

也可以使用：

```bash
catalog --cache-dir /tmp/my-catalog-cache course search 数学
```

缓存快照保存原始 JSON 或静态正文的规范化输入，使用 gzip 压缩。缓存读取后仍会经过适配器和本地筛选，不直接把原始响应打印到终端。

### 5.5 来源和时间字段

JSON 的 meta 结构：

```json
{
  "resource": "lessons",
  "scope": "461",
  "source": "network",
  "fetchedAt": "2026-08-26T00:00:00.000Z",
  "dataAsOf": "2026年秋季学期",
  "stale": false
}
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `resource` | 内部资源名，例如 lessons、exams、timetable |
| `scope` | 请求作用域，例如学期 ID、日期或课程编号 |
| `source` | network、cache、static 或 mixed |
| `fetchedAt` | 快照抓取时间，使用 ISO 8601 |
| `dataAsOf` | 数据实际所属学期、日期或静态内容说明 |
| `stale` | 是否不是当前在线响应；包括离线读取和网络失败后的缓存数据 |

默认表格会在表格后显示来源和抓取时间。网络失败回退时会把警告写入 stderr；`--offline` 读取缓存时会写入离线提示：

```text
警告：网络请求失败，使用缓存数据。抓取时间：2026-08-25T20:26:13.490Z
```

`--quiet` 会隐藏这类提示，但不会修改 JSON 的 meta。

## 6. 输出格式

### 6.1 默认表格

默认输出面向人类阅读：

```bash
catalog course search 数学 --limit 3
```

表格包含中文列名，长文本会自动换行。表格之后可能出现：

```text
数据来源：网络，抓取时间：2026-08-26T00:00:00.000Z
共 228 条，当前显示 3 条；使用 --all 查看全部。
```

`--no-color` 只影响颜色，不改变列和数据：

```bash
catalog --no-color course search 数学
```

### 6.2 JSON

使用 `--json` 时 stdout 只输出一个 JSON 对象：

```json
{
  "meta": {
    "resource": "course-search",
    "scope": "数学",
    "source": "network",
    "fetchedAt": "2026-08-26T00:00:00.000Z",
    "dataAsOf": null,
    "stale": false
  },
  "data": [
    {
      "id": "MATH1001",
      "nameZh": "数学分析(A1)",
      "nameEn": "Mathematical Analysis A1",
      "valid": true,
      "lastTerm": "2025年秋季学期",
      "department": "数学科学学院"
    }
  ]
}
```

JSON 输出特点：

- 使用 CLI 规范化字段，不是 API 原始字段；
- meta 始终存在；
- 数组资源的 data 是数组；
- 详情资源的 data 通常是对象或详情数组，取决于命令；
- 内部搜索辅助字段 searchText 不会输出；
- JSON 错误写入 stderr，stdout 不输出半截结果；
- 缓存回退信息从 meta.source 和 meta.stale 判断。

使用 jq：

```bash
catalog --json lesson list --semester 461 --course 数学 \
  | jq '.data[] | {课堂号: .code, 课程: .courseName, 教师: [.teachers[].nameZh]}'
```

### 6.3 CSV

使用 `--csv` 时 stdout 是 UTF-8 CSV，并带 UTF-8 BOM，方便 Excel 直接打开：

```bash
catalog --csv lesson list --semester 461 --department 001 > lessons.csv
```

CSV 行使用人类可读表格的扁平字段，而不是 JSON 的全部嵌套字段。常见处理规则：

- 数组字段会合并为中文分隔文本；
- 教师通常使用 、 连接；
- 课程教材、替代课程等嵌套字段会被压平成一个单元格；
- CSV 不写 meta，因此不会混入来源提示；
- 混合类型表格会先计算所有行的列并集，缺少的字段留空；
- 如果需要抓取时间和来源，应使用 `--json`。

`--json` 与 `--csv` 不能同时使用。

## 7. 课程目录

### 7.1 course search

语法：

```bash
catalog course search <keyword> [--include-invalid]
```

参数：

| 参数 | 说明 |
| --- | --- |
| `<keyword>` | 课程编号、中文名或英文名关键词；必填 |
| `--include-invalid` | 保留网页响应中 valid=false 的课程 |

示例：

```bash
catalog course search 数学
catalog course search MATH1001 --include-invalid
catalog --json course search "Mathematical Analysis"
```

默认只输出有效课程。网页前端会在服务端搜索结果上再次过滤 valid=true，CLI 保持相同默认语义。

JSON data 是课程轻量对象数组，常见字段：

```text
id
nameZh
nameEn
valid
lastTerm
department
category
classification
gradation
```

### 7.2 course show

语法：

```bash
catalog course show <code...>
```

一次可以查询多个课程编号：

```bash
catalog course show MATH1001 MATH1002
```

默认表格显示：

```text
课程编号、课程名、英文名、开课单位、学分、学时、学期、考核方式、授课语言、预修要求、教材、简介
```

JSON 还包含：

- 中文/英文描述；
- 教材和讲义；
- 参考书；
- syllabus 段落；
- 课程类别、学科和评分制。

### 7.3 course list

语法：

```bash
catalog course list <category>
catalog course list department --department <id[,id...]>
```

网页可见分类代码：

| 分类代码 | 名称 | 实际来源 |
| --- | --- | --- |
| ma | 数学类 | 公共课程组 43 |
| ph | 物理类 | 公共课程组 45 |
| fl | 英语类 | 公共课程组 59 |
| hs+ps | 人文、思政类 | 公共课程组 58、63 |
| pe | 体育类 | 公共课程组 66 |
| cs+es+in | 计算机、电子类 | 公共课程组 49、41、47、102 |
| ch+ms+bi | 化学、生物类 | 公共课程组 44、54、53 |
| ge+gp+ae+en | 地球、环境类 | 公共课程组 50、52、55、46 |
| quality | 综合素质类 | /course/quality |
| 001 | 数学科学学院 | 院系 ID 2、5、6、61 |
| 203 | 物理学院 | 院系 ID 87、56、62、63、77、100、122 |
| 204 | 管理学院 | 院系 ID 88、71、72、73 |
| 206 | 化学与材料科学学院 | 院系 ID 89、57、68、70、74、75、182 |
| 207 | 生命科学学院 | 院系 ID 90、66、76、101、102 |
| 208 | 地球和空间科学学院 | 院系 ID 91、18、43、46 |
| 209 | 工程科学学院 | 院系 ID 92、3、4、69、99 |
| 210 | 信息科学技术学院 | 院系 ID 93、23、65、67、78 |
| 211 | 人文与社会科学学院 | 院系 ID 94、58、80 |
| 215 | 计算机科学与技术学院 | 院系 ID 96、64 |
| 216 | 公共事务学院 | 院系 ID 15 |
| 221 | 网络空间安全学院 | 院系 ID 146 |
| 229 | 大数据学院 | 院系 ID 142 |
| 910 | 生命科学与医学部 | 院系 ID 145 |

例如：

```bash
catalog course list ma
catalog course list 001
catalog course list department --department 2,5,6,61
```

网页分类代码和 API 内部 ID 不相同。应优先使用网页代码 001、203 等；只有需要精确控制接口来源时才使用 department --department。

## 8. 学期和院系发现

### 8.1 semester list

语法：

```bash
catalog semester list
```

输出字段：

```text
学期ID、学期代码、学期名称、开始日期、结束日期、当前
```

学期参数可以使用以下三种形式：

```bash
catalog lesson list --semester 461
catalog lesson list --semester 20261
catalog lesson list --semester "2026年秋季学期"
```

### 8.2 department list

语法：

```bash
catalog department list
```

该命令展示网页筛选器使用的院系树，包括院系内部 ID、院系代码、名称和子系。

## 9. 培养方案

网页有两套不同的培养方案数据：

1. 2013 版静态培养方案目录和正文；
2. /plan 页面使用的 API 执行计划。

CLI 用不同命令区分这两类数据。

### 9.1 program catalog

语法：

```bash
catalog program catalog [keyword]
```

不带关键词时列出静态目录：

```bash
catalog program catalog
```

带关键词时执行本地中文包含匹配：

```bash
catalog program catalog 数学
catalog --json program catalog 英才班
```

结果包含：

```text
id
file
type
parent
nameZh
```

类型包括院系、专业、英才班、学科交叉、双学位和说明页。

### 9.2 program document

语法：

```bash
catalog program document <code>
```

示例：

```bash
catalog program document 001001
catalog --json program document 001001
catalog --csv program document 001001 > program.csv
```

在线模式请求并缓存：

```text
/data/program/cn/<code>.html
```

CLI 不执行正文中的脚本，只解析为：

- h2 至 h6 章节，并保留章节层级；
- 正文段落；
- 表格；
- 图片和正文中的链接；
- data-cid 课程引用。

JSON 结构示例：

```json
{
  "code": "001001",
  "title": "数学与应用数学专业",
  "sourcePath": "/data/program/cn/001001.html",
  "sections": [
    {
      "id": "h0",
      "title": "专业培养目标",
      "level": 2,
      "blocks": [
        { "type": "paragraph", "text": "……" },
        {
          "type": "table",
          "table": {
            "headers": ["课程名称", "学分"],
            "rows": [["数学分析", "6"]]
          }
        },
        { "type": "course", "code": "MATH1001", "text": "数学分析" }
      ]
    }
  ],
  "courseCodes": ["MATH1001"]
}
```

### 9.3 program history

语法：

```bash
catalog program history
```

输出网页提供的历史培养方案链接。使用 --json 时返回规范化的 label/value 对象。

### 9.4 program list

语法：

```bash
catalog program list [options]
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--department <id>` | 院系代码或内部 ID |
| `--major <id>` | 专业代码或内部 ID |
| `--grade <grade>` | 年级，例如 2026 |
| `--type <type>` | 培养类型，例如 主修 |

示例：

```bash
catalog program list
catalog program list --department 001
catalog program list --major 20 --grade 2026
catalog program list --type 主修
```

这是对 /api/teach/program/tree 的扁平化展示，默认列出计划 ID、院系、专业、计划名称、年级和培养类型。

### 9.5 program show

语法：

```bash
catalog program show <id> [--term <term>]
```

id 是 API 培养方案 ID，不是静态正文代码。例如：

```bash
catalog program show 3430
catalog program show 3430 --term 1秋
catalog --json program show 3430
```

`--term` 在本地递归过滤模块课程，只保留包含该开课学期的课程。

默认表格先显示计划摘要，再显示模块和课程行。JSON data 是完整计划对象，包含递归 modules。

### 9.6 program module

语法：

```bash
catalog program module <id> [--courses]
```

示例：

```bash
catalog program module 31764
catalog program module 31764 --courses
```

默认表格显示模块摘要。--courses 追加课程编号、名称、必修状态、学时、学分和开课学期。

## 10. 全校开课查询

### 10.1 lesson list

语法：

```bash
catalog lesson list [options]
```

筛选选项：

| 选项 | 说明 |
| --- | --- |
| `--semester <id-or-code>` | 学期 ID、学期代码或中文名称 |
| `--department <code>` | 开课单位代码，例如 001 |
| `--education <name>` | 学历层次，例如 本科、研究生、本研贯通 |
| `--course <text>` | 课程名、英文名或教学班编号，多空格 token 全部匹配 |
| `--teacher <text>` | 教师姓名，多空格 token 全部匹配 |
| `--location <text>` | 校区或教室 |
| `--span <text>` | 精确匹配规范化上课时间片，例如 1(3,4) |
| `--course-type <text>` | 课堂类型，例如 理论课 |
| `--course-classify <text>` | 课程范畴 |

排序选项：

| 选项 | 可选值 |
| --- | --- |
| `--sort <field>` | code、course、department、teacher、location、students |
| `--desc` | 降序；不提供时升序 |

默认排序是 code 升序，与网页默认教学班编号排序一致。

示例：

```bash
catalog lesson list --semester 461
catalog lesson list --semester 461 --education 本科
catalog lesson list --semester 461 --department 001 --course 数学
catalog lesson list --semester 461 --teacher 张三 --location 5401
catalog lesson list --semester 461 --sort students --desc
```

普通筛选是在完整学期快照上本地执行，不会为每个筛选条件重复请求接口。改变学期会读取或请求新的教学班快照。

默认表格字段：

```text
课堂号、课程名、开课单位、授课教师、时间地点、学分、学时、学历、课堂类型、课程范畴、选课人数、限选人数
```

### 10.2 lesson show

语法：

```bash
catalog lesson show <code...> --semester <id-or-code>
```

示例：

```bash
catalog lesson show 001101.01 --semester 461
catalog --json lesson show 001101.01 --semester 461
```

该命令调用教学班详情接口，输出 LessonDetail 模型。JSON data 包含 lesson 和 course 两层：lesson 保留接口实际返回的教学班编号、课程名、学分、课堂类型、开课单位、教师、班级、地点、周次、选课人数和考核方式等字段；course 保留课程教材、简介和 syllabus。接口若没有返回教师、班级或时间地点字段，teachingClassDataAvailable 会为 false，CLI 不会伪造这些数据。详情数据作用域包含学期和教学班编号。

## 11. 教室使用情况

### 11.1 classroom list

语法：

```bash
catalog classroom list [options]
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--date <YYYY-MM-DD>` | 日期，默认使用中国标准时间当天 |
| `--building <code[,code...]>` | 一个或多个楼栋代码 |
| `--keyword <text>` | 房间号、课程编号、课程名、教师、申请人或主办方关键词 |
| `--available` | 只保留当天没有使用记录的房间 |
| `--free-period <n>` | 只保留指定教学节次空闲的房间；0 表示全天空闲 |

示例：

```bash
catalog classroom list --date 2026-08-26
catalog classroom list --date 2026-08-26 --building 1
catalog classroom list --date 2026-08-26 --building 1,2,3
catalog classroom list --date 2026-08-26 --keyword MATH1001
catalog classroom list --date 2026-08-26 --available
catalog classroom list --date 2026-08-26 --free-period 3
```

楼栋代码示例：

```text
1、2、3、5、8、9、11、12、13、14、15、16、22
41、42、43
4123 表示 41、42、43 的聚合楼栋
```

房间元数据来自 CLI 内置静态房间表，日期使用记录来自课表接口。关键词和空闲筛选在已取得课表后本地执行。

### 11.2 classroom show

语法：

```bash
catalog classroom show <room> [--date <YYYY-MM-DD>]
```

示例：

```bash
catalog classroom show 2303 --date 2026-08-26
catalog --json classroom show 1101 --date 2026-08-23
```

返回指定房间的楼栋、房间类型、楼层、座位数和当天完整使用记录。

### 11.3 classroom week

语法：

```bash
catalog classroom week [--date <YYYY-MM-DD>] [--building <code[,code...]>]
```

示例：

```bash
catalog classroom week --date 2026-08-26
catalog classroom week --date 2026-08-26 --building 1,2,3
```

周视图以给定日期所在周的星期日为起点，依次读取 7 天：

```text
星期日、星期一、星期二、星期三、星期四、星期五、星期六
```

JSON 每条房间记录额外包含 date。周请求的 meta.dataAsOf 是日期范围，例如：

```text
2026-08-23 至 2026-08-29
```

## 12. 考试查询

### 12.1 exam list

语法：

```bash
catalog exam list [options]
```

筛选选项：

| 选项 | 说明 |
| --- | --- |
| `--semester <id-or-code>` | 学期 ID、代码或名称 |
| `--type <type>` | 考试类型，例如 期末考试 |
| `--education <name>` | 学历层次 |
| `--department <code>` | 开课单位代码 |
| `--grade <grade>` | 年级 |
| `--building <code>` | 教学楼代码或前缀 |
| `--date <YYYY-MM-DD>` | 考试日期 |
| `--course <text>` | 课程名称或课程号，多 token 全部匹配 |
| `--teacher <text>` | 教师 |
| `--location <text>` | 考场 |
| `--class <text>` | 上课班级 |
| `--span <span>` | morning、afternoon、evening |

排序选项：

```bash
--sort course|department|teacher|location|date|time|class
--desc
```

示例：

```bash
catalog exam list --semester 441
catalog exam list --semester 441 --date 2026-07-25
catalog exam list --semester 441 --span evening --sort time --desc
catalog exam list --semester 441 --course 微积分 --teacher 张三
```

计划内考试和通用考试会被规范化为同一套 Exam 模型。默认表格字段：

```text
课程号、课程名、开课单位、授课教师、考试类型、日期、时间、地点、人数、上课班级、学历、年级、考核方式
```

### 12.2 exam show

语法：

```bash
catalog exam show <id> --semester <id-or-code>
```

示例：

```bash
catalog exam show 13138 --semester 441
catalog --json exam show 13138 --semester 441
```

考试 ID 只在对应学期范围内查找，因此必须提供学期。

## 13. 替代课程

### 13.1 substitute list

语法：

```bash
catalog substitute list [options]
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--course <text>` | 课程编号或名称，多 token 全部匹配 |
| `--mode interchangeable` | 只显示同级可互换关系 |
| `--mode straight` | 只显示单向高级替代关系 |
| `--multiple` | 只显示多门关系 |
| `--single` | 只显示单门关系 |

`--multiple` 和 `--single` 互斥。`--mode` 只能是 `interchangeable` 或 `straight`。

示例：

```bash
catalog substitute list
catalog substitute list --course 数学分析
catalog substitute list --mode interchangeable --multiple
catalog --json substitute list --single
```

网页接口返回的反向关系会合并为一条 interchangeable=true 关系。CLI 使用两侧课程数组长度判断 multiple，不会复制网页中数组与数字比较的错误。

默认表格字段：

```text
替代课程、原课程、关系、门数
```

### 13.2 substitute summary

语法：

```bash
catalog substitute summary
```

输出网页提供的交流学校课程替代关系汇总表外链。使用 `--json` 时返回 label/value 对象。

## 14. 教学日历占位命令

```bash
catalog calendar
catalog --json calendar
```

网页当前 /query/calendar 没有数据加载、控件或教务接口。CLI 保留该命令以对应公开路由，并明确输出“网页当前没有公开教学日历数据”。

## 15. 缓存管理

### 15.1 cache status

```bash
catalog cache status
catalog --json cache status
```

表格显示：

```text
数据库路径、总字节数、资源名、快照数量、最近抓取时间、字节数
```

JSON 结构：

```json
{
  "data": {
    "databasePath": "/home/user/.cache/catalog-cli/catalog.sqlite",
    "totalBytes": 4452034,
    "resources": [
      {
        "resource": "lessons",
        "count": 1,
        "latestFetchedAt": "2026-08-26T00:00:00.000Z",
        "bytes": 3490000
      }
    ]
  }
}
```

### 15.2 cache clear

清理全部快照：

```bash
catalog cache clear
```

清理是破坏性操作。非交互环境必须显式提供 `--yes`；交互终端不提供 `--yes` 时会询问确认：

```bash
catalog cache clear --yes
catalog cache clear --resource lessons --yes
```

使用 `--json` 或 `--csv` 时也必须提供 `--yes`。JSON 返回删除数量和资源名：

```json
{
  "data": {
    "removed": 24,
    "resource": "lessons"
  }
}
```

只清理一个资源：

```bash
catalog cache clear --resource lessons --yes
catalog cache clear --resource timetable --yes
```

`--resource` 必须是 CLI 已知的快照资源，例如 `lessons`、`exams`、`timetable`、`semesters` 或 `program-document`；拼写错误会返回参数错误，不会静默显示“删除 0 条”。

该命令删除快照行，不删除数据库目录本身，也不删除用户其他文件。

## 16. 错误和退出码

错误统一写 stderr，格式：

```text
错误 [错误码]：中文错误消息
提示：可选的处理建议
```

主要退出码：

| 退出码 | 错误类型 | 常见原因 |
| --- | --- | --- |
| 0 | 成功 | 查询或帮助正常完成 |
| 1 | 未分类错误 | 未预期异常 |
| 2 | 参数错误 | 缺少参数、值非法、互斥参数同时使用 |
| 3 | 网络/缓存不可用 | 网络失败且没有缓存，或 offline cache miss |
| 4 | 远端或限制错误 | HTTP 错误、404、JSON/结构错误、网站限制模式 |
| 5 | 缓存错误 | SQLite 打开、迁移或读取失败 |

常见错误码：

```text
ARGUMENT_ERROR
CACHE_MISS
NETWORK_ERROR
REMOTE_HTTP_ERROR
REMOTE_NOT_FOUND
REMOTE_INVALID_JSON
REMOTE_INVALID_DATA
RESTRICTED
CACHE_ERROR
```

### 16.1 网站限制模式

在线数据命令会先请求 /api/restricted。如果网站要求统一认证，CLI 返回 RESTRICTED，不会执行 CAS 登录，也不会保存认证令牌。

```text
错误 [RESTRICTED]：catalog 当前处于限制模式，公开查询需要统一认证。
提示：CLI 不执行 CAS 登录，请在网页端完成认证后再查询。
```

`--offline` 不需要访问限制接口，但必须已有对应数据快照。

## 17. stdout、stderr 和脚本集成

适合脚本的约定：

- stdout：结果数据、表格、JSON、CSV；
- stderr：缓存回退警告、verbose 诊断和错误；
- 退出码：表示成功、参数错误、网络错误或缓存错误；
- `--json`：适合程序解析和 jq；
- `--csv`：适合表格软件；
- `--quiet`：适合不希望看到缓存提示但仍使用表格的脚本。

示例：

```bash
if catalog --json --offline lesson list --semester 461 > lessons.json; then
  jq '.data | length' lessons.json
else
  echo "查询失败" >&2
  exit 1
fi
```

只保留 stdout：

```bash
catalog --json course search 数学 2>/dev/null | jq '.data'
```

保留诊断但不污染 JSON：

```bash
catalog --json --verbose lesson list --semester 461 \
  > lessons.json \
  2> lessons.trace
```

## 18. 当前边界

- CLI 只支持中文，不提供网页的 English 切换；
- CLI 不实现 CAS 登录、个人课表、选课、退课或写入教务数据；
- 静态培养方案目录随当前网页前端脚本版本固化，正文在线请求并缓存；
- 教室房间容量和基础属性来自 CLI 内置静态表，日期使用记录来自网站课表；
- CSV 面向表格使用，不保证保留 JSON 的全部嵌套结构；
- `program show <id>` 使用 API 计划 ID，例如 3430；`program document <code>` 使用静态网页代码，例如 001001，两者不能混用。

## 19. MCP 服务

### 19.1 启动和配置

从 0.2.0 开始，npm 包同时提供 `catalog-mcp` 命令。它使用本地 stdio 传输，适用于 Claude Desktop、Cursor、VS Code 等支持 MCP 的客户端：

```bash
npm install --global ustc-catalog-cli@0.2.1
catalog-mcp
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "ustc-catalog": {
      "command": "catalog-mcp"
    }
  }
}
```

也可以不安装全局命令，直接使用 npm：

```json
{
  "mcpServers": {
    "ustc-catalog": {
      "command": "npx",
      "args": [
        "--yes",
        "--package",
        "ustc-catalog-cli@0.2.1",
        "catalog-mcp"
      ]
    }
  }
}
```

MCP 服务会为每次工具调用启动一个 `catalog --json` 子进程，使用参数数组执行，不经过 shell。最多同时运行 3 个子进程，超出的请求排队。

### 19.2 环境变量

MCP 服务会继承 CLI 的配置环境变量：

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `CATALOG_BASE_URL` | 覆盖 catalog 网站地址 | `https://catalog.ustc.edu.cn` |
| `CATALOG_CACHE_DIR` | 指定 SQLite 缓存目录 | 系统用户缓存目录 |
| `CATALOG_TIMEOUT_MS` | CLI 单次网络请求超时时间 | `15000` |
| `CATALOG_USER_AGENT` | 覆盖 HTTP User-Agent | `ustc-catalog-cli/0.2.1` |
| `CATALOG_MCP_PROCESS_TIMEOUT_MS` | MCP 子进程总超时时间 | `120000` |

`CATALOG_CACHE_DIR` 应配置在 MCP 服务的 `env` 中，不作为模型可修改的工具参数。MCP 工具不暴露 `cache clear`。

### 19.3 工具清单

MCP 共提供 22 个只读工具：

| 工具 | 对应 CLI 命令 | 用途 |
| --- | --- | --- |
| `ustc_semester_list` | `semester list` | 学期列表 |
| `ustc_department_list` | `department list` | 院系树 |
| `ustc_calendar` | `calendar` | 教学日历公开状态 |
| `ustc_course_search` | `course search` | 课程搜索 |
| `ustc_course_list` | `course list` | 课程分类目录 |
| `ustc_course_show` | `course show` | 课程详情 |
| `ustc_program_catalog` | `program catalog` | 静态培养方案目录 |
| `ustc_program_document` | `program document` | 静态培养方案正文 |
| `ustc_program_history` | `program history` | 历史培养方案链接 |
| `ustc_program_list` | `program list` | API 培养方案列表 |
| `ustc_program_show` | `program show` | 培养方案详情 |
| `ustc_program_module` | `program module` | 培养方案模块 |
| `ustc_lesson_list` | `lesson list` | 全校教学班 |
| `ustc_lesson_show` | `lesson show` | 教学班详情 |
| `ustc_classroom_list` | `classroom list` | 单日教室使用情况 |
| `ustc_classroom_show` | `classroom show` | 单个教室 |
| `ustc_classroom_week` | `classroom week` | 一周教室使用情况 |
| `ustc_exam_list` | `exam list` | 考试列表 |
| `ustc_exam_show` | `exam show` | 考试详情 |
| `ustc_substitute_list` | `substitute list` | 替代课程关系 |
| `ustc_substitute_summary` | `substitute summary` | 替代关系汇总表链接 |
| `ustc_cache_status` | `cache status` | 缓存统计 |

工具名使用 ASCII，工具描述和返回数据使用中文。除 `ustc_cache_status` 外，查询工具都支持以下公共参数：

| 参数 | 类型 | 作用 |
| --- | --- | --- |
| `offline` | boolean | 只读取缓存；默认不提供时为 false |
| `noCache` | boolean | 忽略已有缓存并强制请求；默认不提供时为 false |
| `limit` | non-negative integer | 限制列表返回记录数 |
| `offset` | non-negative integer | 跳过前 n 条列表记录 |

`offline` 和 `noCache` 不能同时使用。MCP 固定使用 JSON，因此不提供 `json`、`csv`、`noColor`、`quiet`、`verbose` 和 `all` 参数；JSON/CSV 的 CLI 规则见第 6 节。

### 19.4 工具参数

除公共参数外，各工具使用以下业务参数：

| 工具 | 业务参数 |
| --- | --- |
| `ustc_course_search` | `keyword: string`；`includeInvalid?: boolean` |
| `ustc_course_list` | `category: string`；`department?: string` |
| `ustc_course_show` | `codes: string[]`，至少一个课程编号 |
| `ustc_program_catalog` | `keyword?: string` |
| `ustc_program_document` | `code: string` |
| `ustc_program_list` | `department?: string`、`major?: string`、`grade?: string`、`type?: string` |
| `ustc_program_show` | `id: integer`；`term?: string` |
| `ustc_program_module` | `id: integer`；`courses?: boolean` |
| `ustc_lesson_list` | `semester?: string\|integer`、`department?: string`、`education?: string`、`course?: string`、`teacher?: string`、`location?: string`、`span?: string`、`courseType?: string`、`courseClassify?: string`、`sort?: code\|course\|department\|teacher\|location\|students`、`desc?: boolean` |
| `ustc_lesson_show` | `codes: string[]`；`semester: string\|integer` |
| `ustc_classroom_list` | `date?: YYYY-MM-DD`、`building?: string`、`keyword?: string`、`available?: boolean`、`freePeriod?: 0..13` |
| `ustc_classroom_show` | `room: string`；`date?: YYYY-MM-DD` |
| `ustc_classroom_week` | `date?: YYYY-MM-DD`；`building?: string` |
| `ustc_exam_list` | `semester?: string\|integer`、`type?: string`、`education?: string`、`department?: string`、`grade?: string`、`building?: string`、`date?: YYYY-MM-DD`、`course?: string`、`teacher?: string`、`location?: string`、`className?: string`、`span?: morning\|afternoon\|evening`、`sort?: course\|department\|teacher\|location\|date\|time\|class`、`desc?: boolean` |
| `ustc_exam_show` | `id: integer`；`semester: string\|integer` |
| `ustc_substitute_list` | `course?: string`、`mode?: interchangeable\|straight`、`multiple?: boolean`、`single?: boolean` |

`semester list`、`department list`、`calendar`、`program history`、`substitute summary` 和 `cache status` 不需要业务参数。`ustc_substitute_list` 的 `multiple` 与 `single` 互斥。

### 19.5 返回结构

成功时，MCP 工具同时返回 `structuredContent` 和文本形式的 JSON。两者内容相同：

```json
{
  "meta": {
    "resource": "lessons",
    "scope": "461",
    "source": "network",
    "fetchedAt": "2026-08-26T00:00:00.000Z",
    "dataAsOf": "2026年秋季学期",
    "stale": false
  },
  "data": []
}
```

MCP 保留 CLI 的规范化字段和缓存元数据。网络失败回退缓存时，`meta.source` 为 `cache`，`meta.stale` 为 `true`。

工具失败时返回 `isError: true`，文本内容为：

```json
{
  "error": {
    "code": "CACHE_MISS",
    "message": "没有找到缓存。",
    "hint": "去掉 --offline 后联网获取，或先执行一次普通查询。"
  }
}
```

CLI 的 `ARGUMENT_ERROR`、`CACHE_MISS`、`NETWORK_ERROR`、远端错误和缓存错误会保留错误码和中文提示。子进程超时、异常退出或返回非 `meta/data` JSON 时，MCP 返回对应的 MCP 执行错误，不返回堆栈或半截结果。

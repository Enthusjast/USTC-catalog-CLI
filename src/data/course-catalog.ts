export type CourseCatalogEntry = {
  code: string;
  name: string;
  kind: "generic" | "quality" | "school";
  sourceIds: string[];
};

/**
 * This table is copied from the current site's `ko` configuration. The
 * visible code is not necessarily the API's internal group id.
 * Last verified against catalog.ustc.edu.cn on 2026-08-30.
 */
export const COURSE_CATALOG_ENTRIES: CourseCatalogEntry[] = [
  { code: "ma", name: "数学类", kind: "generic", sourceIds: ["43"] },
  { code: "ph", name: "物理类", kind: "generic", sourceIds: ["45"] },
  { code: "fl", name: "英语类", kind: "generic", sourceIds: ["59"] },
  { code: "hs+ps", name: "人文、思政类", kind: "generic", sourceIds: ["58", "63"] },
  { code: "pe", name: "体育类", kind: "generic", sourceIds: ["66"] },
  {
    code: "cs+es+in",
    name: "计算机、电子类",
    kind: "generic",
    sourceIds: ["49", "41", "47", "102"],
  },
  {
    code: "ch+ms+bi",
    name: "化学、生物类",
    kind: "generic",
    sourceIds: ["44", "54", "53"],
  },
  {
    code: "ge+gp+ae+en",
    name: "地球、环境类",
    kind: "generic",
    sourceIds: ["50", "52", "55", "46"],
  },
  { code: "quality", name: "综合素质类", kind: "quality", sourceIds: [] },
  { code: "001", name: "数学科学学院", kind: "school", sourceIds: ["2", "5", "6", "61"] },
  { code: "203", name: "物理学院", kind: "school", sourceIds: ["87", "56", "62", "63", "77", "100", "122"] },
  { code: "204", name: "管理学院", kind: "school", sourceIds: ["88", "71", "72", "73"] },
  { code: "206", name: "化学与材料科学学院", kind: "school", sourceIds: ["89", "57", "68", "70", "74", "75", "182"] },
  { code: "207", name: "生命科学学院", kind: "school", sourceIds: ["90", "66", "76", "101", "102"] },
  { code: "208", name: "地球和空间科学学院", kind: "school", sourceIds: ["91", "18", "43", "46"] },
  { code: "209", name: "工程科学学院", kind: "school", sourceIds: ["92", "3", "4", "69", "99"] },
  { code: "210", name: "信息科学技术学院", kind: "school", sourceIds: ["93", "23", "65", "67", "78"] },
  { code: "211", name: "人文与社会科学学院", kind: "school", sourceIds: ["94", "58", "80"] },
  { code: "215", name: "计算机科学与技术学院", kind: "school", sourceIds: ["96", "64"] },
  { code: "216", name: "公共事务学院", kind: "school", sourceIds: ["15"] },
  { code: "221", name: "网络空间安全学院", kind: "school", sourceIds: ["146"] },
  { code: "229", name: "大数据学院", kind: "school", sourceIds: ["142"] },
  { code: "910", name: "生命科学与医学部", kind: "school", sourceIds: ["145"] },
];

export const COURSE_CATALOG_BY_CODE = new Map(
  COURSE_CATALOG_ENTRIES.map((entry) => [entry.code, entry]),
);

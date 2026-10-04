import type { FreePeriod, QueryOptions } from "./models.js";

export const RESOURCE_NAMES = [
  "course-search",
  "course-list",
  "course-detail",
  "program-tree",
  "program-detail",
  "program-module",
  "department-tree",
  "semesters",
  "lessons",
  "lesson-detail",
  "exams",
  "general-exams",
  "substitutes",
  "timetable",
  "restricted",
  "program-catalog",
  "program-document",
] as const;

export type ResourceName = typeof RESOURCE_NAMES[number];

export const CACHE_RESOURCE_NAMES = RESOURCE_NAMES.filter(
  (resource): resource is Exclude<ResourceName, "program-catalog"> => resource !== "program-catalog",
);

export const CACHE_RESOURCES = CACHE_RESOURCE_NAMES;

export type LessonFilter = {
  semesterId: number;
  department?: string;
  education?: string;
  course?: string;
  teacher?: string;
  location?: string;
  span?: string;
  courseType?: string;
  courseClassify?: string;
};

export type ClassroomFilter = {
  date: string;
  building?: string;
  keyword?: string;
  freePeriod?: FreePeriod;
  availableBetween?: { from: number; to: number };
  availableOnly?: boolean;
};

export type ExamFilter = {
  semesterId: number;
  type?: string;
  education?: string;
  department?: string;
  grade?: string;
  building?: string;
  date?: string;
  span?: import("./models.js").ExamRange;
  className?: string;
  course?: string;
  teacher?: string;
  location?: string;
};

export type SubstituteFilter = {
  course?: string;
  mode?: "interchangeable" | "straight";
  multiple?: boolean;
};

export type QueryContext = {
  options: QueryOptions;
  cacheDir?: string;
};

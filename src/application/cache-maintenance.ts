import type { Loaded } from "./data-access-policy.js";
import type { Services, ServiceOptions } from "./services.js";
import type { Semester } from "../domain/models.js";
import { CACHE_RESOURCES } from "../domain/query.js";

export { CACHE_RESOURCES };

export type CachePrefetchResult = {
  semester: Semester;
  requestedDates: string[];
  queriedResources: string[];
  queries: number;
};

export const prefetchSnapshots = async (
  services: Services,
  options: ServiceOptions,
  semesterId?: number,
  dates: string[] = [],
): Promise<Loaded<CachePrefetchResult>> => {
  const semesterResult = semesterId === undefined
    ? await services.common.defaultSemester(options)
    : await services.common.semesters(options);
  const semester = semesterId === undefined
    ? semesterResult.value as Semester
    : (semesterResult.value as Semester[]).find((item) => item.id === semesterId);
  if (!semester) throw new Error(`未找到学期 ${semesterId}`);

  const jobs: Array<Promise<unknown>> = [
    services.lesson.list({ semesterId: semester.id }, options),
    services.exam.list({ semesterId: semester.id }, options),
  ];
  for (const date of [...new Set(dates)]) jobs.push(services.classroom.list(date, {}, options));
  await Promise.all(jobs);
  const queriedResources = ["lessons", "exams", "general-exams", ...(dates.length > 0 ? ["timetable"] : [])];
  return {
    value: {
      semester,
      requestedDates: [...new Set(dates)],
      queriedResources,
      queries: jobs.length,
    },
    meta: {
      ...semesterResult.meta,
      resource: "cache-prefetch",
      scope: `${semester.id}${dates.length ? `:${[...new Set(dates)].join(",")}` : ""}`,
      dataAsOf: semester.nameZh,
    },
  };
};

export const pruneSnapshots = (services: Services, olderThan: string, resource?: string): number =>
  services.repository.pruneBefore(olderThan, resource);

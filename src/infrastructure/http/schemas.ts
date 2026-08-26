import { z } from "zod";
import { CliError } from "../../domain/errors.js";

const arrayPayload = z.array(z.record(z.unknown()));
const objectPayload = z.record(z.unknown());
const restrictedPayload = z.object({ restricted: z.boolean() });
const timetablePayload = z.object({ timetable: z.record(z.unknown()) });

export const validateApiPayload = <T>(path: string, value: unknown): T => {
  const expectsArray = /course\/search|course\/infos|college-tree|semester\/list|lesson\/list|lesson\/infos|exam\/list|general-exam|course-substitute-pool/.test(path);
  const acceptsCourseEmptyArray = /course\/(public|quality|department)/.test(path);
  const schema = path === "/api/restricted"
    ? restrictedPayload
    : path.includes("timetable-public-all")
      ? timetablePayload
      : acceptsCourseEmptyArray ? z.union([arrayPayload, objectPayload]) : expectsArray ? arrayPayload : objectPayload;
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CliError(
      "REMOTE_INVALID_DATA",
      `${path} 返回的数据结构不符合网页接口约定。`,
      result.error.issues.map((issue) => issue.message).join("；"),
    );
  }
  return value as T;
};

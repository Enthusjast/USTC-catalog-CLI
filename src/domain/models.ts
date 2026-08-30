export type SourceKind = "network" | "cache" | "static" | "mixed";

export type ResultMeta = {
  resource: string;
  scope: string;
  source: SourceKind;
  fetchedAt: string;
  dataAsOf?: string | null;
  stale: boolean;
};

export type ResultEnvelope<T> = {
  meta: ResultMeta;
  data: T;
};

export type Course = {
  id: string;
  nameZh: string;
  nameEn?: string;
  valid: boolean;
  lastTerm?: string | null;
  department?: string | null;
  category?: string | null;
  classification?: string | null;
  gradation?: string | null;
};

export type Textbook = {
  name: string;
  nameEn?: string | null;
  author?: string | null;
  publisher?: string | null;
  edition?: string | null;
  date?: string | null;
  isbn?: string | null;
  type?: string | null;
};

export type SyllabusSection = {
  title: string;
  content: string;
  index: number;
};

export type CourseDetail = Course & {
  numericId?: number;
  courseId?: number;
  credits?: number | null;
  hours?: number | null;
  semester?: string | null;
  grading?: string | null;
  examType?: string | null;
  language?: string | null;
  discipline?: string | null;
  prerequisite?: string | null;
  descriptionZh?: string | null;
  descriptionEn?: string | null;
  textbooks: Textbook[];
  materials: Textbook[];
  references?: string | null;
  syllabus: SyllabusSection[];
};

export type ProgramSummary = {
  id: number;
  departmentId: number;
  departmentCode: string;
  departmentName: string;
  majorId: number;
  majorCode: string;
  majorName: string;
  name: string;
  grade: string;
  trainType: string;
};

export type ProgramCourse = {
  code: string;
  name: string;
  compulsory: boolean;
  hours?: number | null;
  credits?: number | null;
  terms: string[];
};

export type ProgramModule = {
  id: number;
  parentId?: number;
  type: string;
  typeEn?: string;
  major?: string;
  majorDirection?: string;
  remark?: string | null;
  requiredCredits?: number | null;
  requiredCourseNum?: number | null;
  isLeaf: boolean;
  publicModuleId?: number | null;
  courses: ProgramCourse[];
  children: ProgramModule[];
};

export type ProgramDetail = ProgramSummary & {
  beginSemester?: string;
  requiredCredits?: number;
  awardDegree?: boolean;
  modules: ProgramModule[];
};

export type ProgramCatalogEntry = {
  id: string;
  file: string;
  type: "school" | "major" | "talent" | "special" | "dual" | "more";
  parent: string[];
  nameZh: string;
};

export type ProgramDocumentTable = {
  headers: string[];
  rows: string[][];
};

export type ProgramDocumentLink = {
  text: string;
  href: string;
};

export type ProgramDocumentBlock =
  | { type: "paragraph"; text: string; links?: ProgramDocumentLink[] }
  | { type: "table"; table: ProgramDocumentTable }
  | { type: "image"; src: string; alt?: string }
  | { type: "course"; code: string; text: string };

export type ProgramDocumentSection = {
  id: string;
  title: string;
  level: number;
  blocks: ProgramDocumentBlock[];
};

export type ProgramDocument = {
  code: string;
  title: string;
  sourcePath: string;
  sections: ProgramDocumentSection[];
  courseCodes: string[];
};

export type Person = {
  nameZh: string;
  nameEn?: string | null;
  departmentCode?: string | null;
};

export type LessonLocation = {
  text: string;
  weekText?: string;
  day?: number;
  periods?: number[];
};

export type LessonSpan = {
  text: string;
  day?: number;
  periods: number[];
  weeks?: string;
};

export type Lesson = {
  id: number;
  code: string;
  courseId?: number;
  courseCode: string;
  courseName: string;
  courseNameEn?: string;
  credits?: number | null;
  hours?: number | null;
  education?: string | null;
  courseType?: string | null;
  courseGradation?: string | null;
  courseCategory?: string | null;
  courseClassify?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  teachers: Person[];
  classes: Person[];
  campus?: string | null;
  locations: LessonLocation[];
  spans: LessonSpan[];
  scheduleText: string;
  examMode?: string | null;
  studentCount?: number | null;
  limitCount?: number | null;
  teachLanguage?: string | null;
  graduateAndPostgraduate?: boolean;
};

export type LessonDetail = {
  lesson: Lesson;
  course: CourseDetail;
  teachingClassDataAvailable: boolean;
};

export type Classroom = {
  code: string;
  name: string;
  buildingCode: string;
  buildingName: string;
  floor: number;
  seats: number;
  roomType?: string;
  canBook?: boolean;
  canArrange?: boolean;
  layout?: number;
};

export type ClassroomUsage = {
  classroomCode: string;
  date: string;
  usageType: "lesson" | "temporary" | "exam" | "occupancy";
  courseIds: string[];
  courseName?: string;
  teachers: string[];
  applicant?: string;
  sponsor?: string;
  departmentName?: string;
  classes: string[];
  studentCount?: number | null;
  courseType?: string;
  start: string;
  end: string;
  channels: number[];
  channelText: string[];
  layout?: number;
  allDay: boolean;
  occupied: boolean;
  seal?: boolean;
};

export type ExamRoom = {
  room: string;
  count?: number | null;
};

export type Exam = {
  id: number;
  type: string;
  courseCode: string;
  courseName: string;
  departmentCode?: string;
  departmentName?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  rooms: ExamRoom[];
  teachers: string[];
  students?: number | null;
  classes: string[];
  grades: string[];
  education?: string | null;
  courseCredits?: number | null;
  courseType?: string | null;
  examMode?: string | null;
};

export type ExamRange = "morning" | "afternoon" | "evening";

export type CourseRef = {
  id: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  hours?: number | null;
  credits?: number | null;
};

export type SubstituteRelation = {
  id: number;
  substituteCourses: CourseRef[];
  originalCourses: CourseRef[];
  interchangeable: boolean;
  multiple: boolean;
  searchText: string;
};

export type DepartmentNode = {
  id?: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  children: DepartmentNode[];
};

export type Semester = {
  id: number;
  nameZh: string;
  code: string;
  start: string;
  end: string;
  isLast?: boolean;
};

export type TimetableData = {
  lessons: Record<string, unknown>[];
  tmpLessons: Record<string, unknown>[];
  roomOccupies: Record<string, unknown>[];
  exams: Record<string, unknown>[];
  makeupExams: Record<string, unknown>[];
  tmpExams: Record<string, unknown>[];
};

export type QueryOptions = {
  format: "table" | "json" | "csv";
  offline: boolean;
  noCache: boolean;
  limit?: number;
  offset: number;
  all: boolean;
  noColor: boolean;
  quiet: boolean;
  verbose: boolean;
};

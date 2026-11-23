// Subconjunto tipado de las respuestas de la API de Moodle que usamos.

export interface SiteInfo {
  sitename: string;
  username: string;
  fullname: string;
  userid: number;
  release: string;
  version: string;
  functions?: { name: string; version: string }[];
}

export interface Course {
  id: number;
  shortname: string;
  fullname: string;
  visible?: number;
  startdate?: number;
  enddate?: number;
}

export interface CourseDetail {
  id: number;
  fullname: string;
  contacts?: { id: number; fullname: string }[];
}

export interface FileContent {
  type: 'file' | 'url' | 'content';
  filename: string;
  filepath?: string;
  filesize?: number;
  fileurl: string;
  timemodified?: number;
  mimetype?: string;
}

export interface Module {
  id: number; // cmid
  name: string;
  modname: string;
  instance?: number;
  url?: string;
  uservisible?: boolean;
  contents?: FileContent[];
}

export interface Section {
  id: number;
  name: string;
  section: number;
  uservisible?: boolean;
  modules: Module[];
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  intro?: string;
  introattachments?: FileContent[];
  duedate?: number;
  allowsubmissionsfromdate?: number;
  cutoffdate?: number;
  timemodified?: number;
}

export interface Forum {
  id: number;
  course: number;
  type: string; // 'news' = Avisos
  name: string;
  cmid: number;
}

export interface Discussion {
  id: number; // post id
  discussion: number;
  name: string;
  subject: string;
  message: string;
  userfullname: string;
  created: number;
  modified?: number;
  timemodified?: number;
  attachments?: FileContent[];
}

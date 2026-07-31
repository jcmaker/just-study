import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";

export type CourseDraft = {
  tempDirectory: string;
  finalDirectory: string;
  finalMarkdownPath: string;
  relativeMarkdownPath: string;
  sha256: string;
};

type DraftRecord = CourseDraft & {
  root: string;
  temporaryMarkdownPath: string;
  finalMarkdownInTempPath: string;
};

class StorageError extends Error {}

const drafts = new WeakMap<CourseDraft, DraftRecord>();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageError(message: string): never {
  throw new StorageError(message);
}

function resolveInsideDataRoot(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    storageError("Path is outside the data root");
  }

  return target;
}

function lstatIfExists(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertNoSymlinks(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  const parts = pathFromRoot === "" ? [] : pathFromRoot.split(sep);

  for (let index = 0; index <= parts.length; index += 1) {
    const current = index === 0 ? root : resolve(root, ...parts.slice(0, index));

    const stat = lstatIfExists(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) storageError("Storage path must not be a symbolic link");
    if (index < parts.length && !stat.isDirectory()) {
      storageError("Storage path is not a directory");
    }
  }
}

function ensureDirectory(root: string, directory: string): void {
  resolveInsideDataRoot(root, relative(root, directory));
  assertNoSymlinks(root, directory);
  mkdirSync(directory, { recursive: true });
  assertNoSymlinks(root, directory);
}

function storagePaths(dataRoot: string): { root: string; coursesRoot: string; temporaryRoot: string } {
  const root = resolve(dataRoot);
  ensureDirectory(root, root);
  const coursesRoot = resolveInsideDataRoot(root, "courses");
  const temporaryRoot = resolveInsideDataRoot(root, "tmp");

  ensureDirectory(root, coursesRoot);
  ensureDirectory(root, temporaryRoot);
  return { root, coursesRoot, temporaryRoot };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function rethrowStorageError(error: unknown, message: string): never {
  if (error instanceof StorageError) throw error;
  throw new StorageError(message);
}

function draftFor(draft: CourseDraft): DraftRecord {
  const record = drafts.get(draft);
  if (!record) storageError("Invalid course draft");
  return record;
}

export function prepareCourseFiles(
  dataRoot: string,
  courseId: string,
  markdown: string,
): CourseDraft {
  if (!UUID_V4.test(courseId)) storageError("Invalid course ID");

  let temporaryDirectory: string | undefined;

  try {
    const { root, coursesRoot, temporaryRoot } = storagePaths(dataRoot);
    const temporaryName = `${courseId}-${randomUUID()}`;
    const tempDirectory = resolveInsideDataRoot(root, `tmp/${temporaryName}`);
    const finalDirectory = resolveInsideDataRoot(root, `courses/${courseId}`);
    const temporaryMarkdownPath = resolveInsideDataRoot(root, `tmp/${temporaryName}/course.md.tmp`);
    const finalMarkdownInTempPath = resolveInsideDataRoot(root, `tmp/${temporaryName}/course.md`);
    const finalMarkdownPath = resolveInsideDataRoot(root, `courses/${courseId}/course.md`);

    assertNoSymlinks(root, coursesRoot);
    assertNoSymlinks(root, temporaryRoot);
    assertNoSymlinks(root, finalDirectory);
    assertNoSymlinks(root, finalMarkdownPath);
    mkdirSync(tempDirectory);
    temporaryDirectory = tempDirectory;
    assertNoSymlinks(root, tempDirectory);
    assertNoSymlinks(root, temporaryMarkdownPath);
    writeFileSync(temporaryMarkdownPath, markdown, { encoding: "utf8", flag: "wx" });
    assertNoSymlinks(root, temporaryMarkdownPath);
    assertNoSymlinks(root, finalMarkdownInTempPath);
    renameSync(temporaryMarkdownPath, finalMarkdownInTempPath);
    assertNoSymlinks(root, finalMarkdownInTempPath);

    const draft: CourseDraft = {
      tempDirectory,
      finalDirectory,
      finalMarkdownPath,
      relativeMarkdownPath: `courses/${courseId}/course.md`,
      sha256: sha256(markdown),
    };
    drafts.set(draft, { ...draft, root, temporaryMarkdownPath, finalMarkdownInTempPath });
    return draft;
  } catch (error) {
    if (temporaryDirectory) {
      try {
        const root = resolve(dataRoot);
        assertNoSymlinks(root, temporaryDirectory);
        if (existsSync(temporaryDirectory)) rmSync(temporaryDirectory, { recursive: true, force: true });
      } catch {
        // The original preparation failure remains the actionable error.
      }
    }
    return rethrowStorageError(error, "Storage preparation failed");
  }
}

export function finalizeCourseFiles(draft: CourseDraft): void {
  const record = draftFor(draft);

  try {
    const coursesRoot = resolveInsideDataRoot(record.root, "courses");
    const temporaryRoot = resolveInsideDataRoot(record.root, "tmp");
    assertNoSymlinks(record.root, record.root);
    assertNoSymlinks(record.root, coursesRoot);
    assertNoSymlinks(record.root, temporaryRoot);
    assertNoSymlinks(record.root, record.tempDirectory);
    assertNoSymlinks(record.root, record.finalMarkdownInTempPath);
    assertNoSymlinks(record.root, record.finalDirectory);
    assertNoSymlinks(record.root, record.finalMarkdownPath);

    if (!existsSync(record.finalMarkdownInTempPath)) storageError("Course draft is incomplete");
    if (existsSync(record.finalDirectory)) storageError("Storage finalization failed");

    renameSync(record.tempDirectory, record.finalDirectory);
    drafts.delete(draft);
  } catch (error) {
    rethrowStorageError(error, "Storage finalization failed");
  }
}

export function discardCourseDraft(draft: CourseDraft): void {
  const record = draftFor(draft);

  try {
    assertNoSymlinks(record.root, record.root);
    assertNoSymlinks(record.root, record.tempDirectory);
    if (existsSync(record.tempDirectory)) rmSync(record.tempDirectory, { recursive: true, force: true });
    drafts.delete(draft);
  } catch (error) {
    rethrowStorageError(error, "Storage draft cleanup failed");
  }
}

export function readVerifiedMarkdown(
  dataRoot: string,
  relativePath: string,
  expectedSha256: string,
): string {
  try {
    const root = resolve(dataRoot);
    const markdownPath = resolveInsideDataRoot(root, relativePath);
    assertNoSymlinks(root, markdownPath);
    const content = readFileSync(markdownPath, "utf8");

    if (sha256(content) !== expectedSha256) storageError("Markdown checksum mismatch");
    return content;
  } catch (error) {
    return rethrowStorageError(error, "Markdown read failed");
  }
}

export function listCourseDirectoryIds(dataRoot: string): string[] {
  try {
    const root = resolve(dataRoot);
    const coursesRoot = resolveInsideDataRoot(root, "courses");
    assertNoSymlinks(root, root);
    if (!existsSync(coursesRoot)) return [];
    assertNoSymlinks(root, coursesRoot);

    return readdirSync(coursesRoot, { withFileTypes: true })
      .filter((entry) => {
        assertNoSymlinks(root, resolveInsideDataRoot(root, `courses/${entry.name}`));
        return entry.isDirectory();
      })
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return rethrowStorageError(error, "Storage inspection failed");
  }
}

export function listTemporaryEntries(dataRoot: string): string[] {
  try {
    const root = resolve(dataRoot);
    const temporaryRoot = resolveInsideDataRoot(root, "tmp");
    assertNoSymlinks(root, root);
    if (!existsSync(temporaryRoot)) return [];
    assertNoSymlinks(root, temporaryRoot);

    return readdirSync(temporaryRoot)
      .map((entry) => {
        assertNoSymlinks(root, resolveInsideDataRoot(root, `tmp/${entry}`));
        return entry;
      })
      .sort();
  } catch (error) {
    return rethrowStorageError(error, "Storage inspection failed");
  }
}

export function probeStorageWritable(dataRoot: string): void {
  let probePath: string | undefined;

  try {
    const { root, temporaryRoot } = storagePaths(dataRoot);
    probePath = resolveInsideDataRoot(root, `tmp/.health-${randomUUID()}`);
    assertNoSymlinks(root, temporaryRoot);
    assertNoSymlinks(root, probePath);
    writeFileSync(probePath, "ok", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    rethrowStorageError(error, "Storage write probe failed");
  } finally {
    if (probePath && existsSync(probePath)) {
      try {
        const root = resolve(dataRoot);
        assertNoSymlinks(root, probePath);
        unlinkSync(probePath);
      } catch (error) {
        rethrowStorageError(error, "Storage write probe failed");
      }
    }
  }
}

import { isSupported } from './formats';

/** The parts of the File System Entry API this reads (webkitGetAsEntry and its directory readers). */
export interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  file?(done: (file: File) => void, fail: (e: unknown) => void): void;
  createReader?(): { readEntries(done: (entries: Entry[]) => void, fail: (e: unknown) => void): void };
}

const readAll = async (entry: Entry): Promise<Entry[]> => {
  const reader = entry.createReader!();
  const all: Entry[] = [];
  // readEntries returns a batch at a time (100 in Chrome) until it returns none
  for (;;) {
    const batch = await new Promise<Entry[]>((done, fail) => reader.readEntries(done, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
};

/** The model files in a dropped folder and the folders below it. */
async function filesIn(entry: Entry): Promise<File[]> {
  if (entry.isDirectory) return (await Promise.all((await readAll(entry)).map(filesIn))).flat();
  const file = await new Promise<File>((done, fail) => entry.file!(done, fail));
  return isSupported(file.name) ? [file] : [];
}

/**
 * The files of a drop: dropped files as they are, and for each dropped folder the model files in it
 * (an assembly is dropped with the files it references). Call it in the drop handler itself: the
 * entries are gone once that returns.
 */
export function filesOfDrop(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].map((item) => item.webkitGetAsEntry?.() as Entry | null | undefined);
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve([...data.files]);
  return Promise.all(
    entries.map((entry, i) => {
      if (!entry) return [];
      if (entry.isDirectory) return filesIn(entry);
      const file = data.items[i].getAsFile();
      return file ? [file] : [];
    }),
  ).then((files) => files.flat());
}

/** The model files of a folder picked with the folder input. */
export const filesOfFolder = (files: FileList | File[]): File[] => [...files].filter((f) => isSupported(f.name));

/** Names (as the first file spells them) shared by several files: an assembly finds its parts by name alone. */
export function duplicateNames(files: File[]): string[] {
  const seen = new Map<string, { name: string; count: number }>();
  for (const { name } of files) {
    const entry = seen.get(name.toLowerCase());
    if (entry) entry.count++;
    else seen.set(name.toLowerCase(), { name, count: 1 });
  }
  return [...seen.values()].filter((e) => e.count > 1).map((e) => e.name);
}

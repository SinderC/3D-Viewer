/**
 * Which of several files opened together to open: the STEP assembly that names the others (its
 * external references) and that none of them names, else the first file. texts: each file's
 * content, undefined where it cannot reference others.
 */
export function mainFileIndex(names: string[], texts: (string | undefined)[]): number {
  const lowerNames = names.map((n) => n.toLowerCase());
  const lowerTexts = texts.map((t) => t?.toLowerCase());
  const namesOthers = (i: number) => lowerNames.some((n, j) => j !== i && lowerTexts[i]?.includes(n));
  const namedByOthers = (i: number) => lowerTexts.some((t, j) => j !== i && t?.includes(lowerNames[i]));
  const assemblies = names.map((_, i) => i).filter(namesOthers);
  return assemblies.find((i) => !namedByOthers(i)) ?? assemblies[0] ?? 0;
}

/** The file to open of several opened together, see mainFileIndex. */
export async function mainFile(files: File[]): Promise<File> {
  if (files.length < 2) return files[0];
  const texts = await Promise.all(files.map((f) => (/\.(stp|step)$/i.test(f.name) ? f.text() : undefined)));
  return files[mainFileIndex(files.map((f) => f.name), texts)];
}

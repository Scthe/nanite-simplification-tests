import { BinaryFileReader, TextFileReader } from '../constants.ts';

// deno-lint-ignore require-await
export const textFileReader_Deno: TextFileReader = async (filename: string) => {
  return Deno.readTextFileSync(filename);
};

export const binaryFileReader_Deno: BinaryFileReader = async (
  filename: string
) => {
  const rawFileData = await Deno.readFile(filename);
  return rawFileData.buffer;
};

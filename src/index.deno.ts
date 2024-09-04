import {
  injectMeshoptimizerWASM,
  injectMetisWASM,
} from './sys_deno/testUtils.ts';
import { SceneObjectName } from './sceneFiles.ts';
import { loadObject } from './loadObject.ts';

const SCENE_FILE: SceneObjectName = 'jinxCombined';

injectMeshoptimizerWASM();
injectMetisWASM();

async function main() {
  const device = undefined!;

  // console.log(cliArgs);
  // const actSceneName = parseSceneName();

  const obj = await loadObject(SCENE_FILE);
  obj.naniteObject.printStats();

  /*const exportedFiles: string[] = [];

  await loadSceneFile(device, actSceneName, async (obj) => {
    const fileNameLC = obj.fileName.toLowerCase();
    if (!fileNameLC.endsWith('.obj')) {
      console.log(`Skipping export for '${obj.fileName}', it is not an .obj file`); // prettier-ignore
      return;
    }

    console.log(`Exporting: '${obj.fileName}'`);
    const fileNameNew = replaceFileExt(obj.fileName, '.json');
    const exportedFilePath = `${MODELS_DIR}/${fileNameNew}`;
    const exportedFilePathBin = replaceFileExt(exportedFilePath, '.bin');

    await exportToFile(device, obj, exportedFilePath, exportedFilePathBin);

    console.log(`Export success. Result file: '${exportedFilePath}'`);
    exportedFiles.push(exportedFilePath, exportedFilePathBin);
  });

  console.log(`Success! Exported files:`, exportedFiles);*/
}

main();

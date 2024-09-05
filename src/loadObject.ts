import { CONFIG, MODELS_DIR } from './constants.ts';
import { createNaniteMeshlets } from './meshPreprocessing/index.ts';
import { getVertexCount, getTriangleCount } from './utils/index.ts';
import { printBoundingBox } from './utils/calcBounds.ts';
import { createNaniteObject } from './naniteObject/createNaniteObject.ts';
import { loadObjFile } from './utils/objLoader.ts';

export async function loadObject(fileName: string) {
  // console.groupCollapsed(`Object '${name}'`);
  console.log(`Loading file: '${fileName}'`);

  // get file text
  const fileText = await CONFIG.loaders.textFileReader(
    `${MODELS_DIR}/${fileName}`
  );

  // parse OBJ file
  const loadedObj = await loadObjFile(fileText, 1.0);
  // prettier-ignore
  console.log(`Object '${name}': ${getVertexCount(loadedObj.positions)} vertices, ${getTriangleCount(loadedObj.indices)} triangles`);
  printBoundingBox(loadedObj.positions);

  // Nanite preprocess: create meshlet LOD hierarchy
  const naniteMeshlets = await createNaniteMeshlets(
    loadedObj,
    loadedObj.indices
  );

  // create nanite object
  const naniteObject = createNaniteObject(fileName, loadedObj, naniteMeshlets);

  // console.groupEnd();

  return {
    parsedMesh: loadedObj,
    naniteObject,
  };
}

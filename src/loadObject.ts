import { CONFIG, MODELS_DIR } from './constants.ts';
import { createNaniteMeshlets } from './meshPreprocessing/index.ts';
import { getVertexCount, getTriangleCount } from './utils/index.ts';
import { printBoundingBox } from './utils/calcBounds.ts';
import {
  SceneObjectName,
  getSceneObjectDef,
  SceneObjectDef,
} from './sceneFiles.ts';
import { createNaniteObject } from './naniteObject/createNaniteObject.ts';
import { loadObjFile } from './utils/objLoader.ts';

export interface ObjectLoaderParams {
  name: SceneObjectName;
  objectDef: SceneObjectDef;
  device: GPUDevice;
}

export async function loadObject(name: SceneObjectName) {
  console.groupCollapsed(`Object '${name}'`);

  // get file text
  const objectDef = getSceneObjectDef(name);
  const fileText = await CONFIG.loaders.textFileReader(
    `${MODELS_DIR}/${objectDef.file}`
  );

  // parse OBJ file
  const loadedObj = await loadObjFile(fileText, objectDef.scale);
  // prettier-ignore
  console.log(`Object '${name}': ${getVertexCount(loadedObj.positions)} vertices, ${getTriangleCount(loadedObj.indices)} triangles`);
  printBoundingBox(loadedObj.positions);

  // Nanite preprocess: create meshlet LOD hierarchy
  const naniteMeshlets = await createNaniteMeshlets(
    loadedObj,
    loadedObj.indices
  );

  // create nanite object
  const naniteObject = createNaniteObject(name, loadedObj, naniteMeshlets);

  console.groupEnd();

  return {
    parsedMesh: loadedObj,
    naniteObject,
  };
}

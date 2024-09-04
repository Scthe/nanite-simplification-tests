import { BYTES_U32, CONFIG } from '../constants.ts';
import { MeshletWIP, isWIP_Root } from '../meshPreprocessing/index.ts';
import { ParsedMesh } from '../utils/objLoader.ts';
import { calculateBounds } from '../utils/calcBounds.ts';
import { createArray } from '../utils/index.ts';
import { assertValidNaniteObject } from './assertValidNaniteObject.ts';
import { NaniteObject, NaniteMeshletTreeNode } from './naniteObject.ts';

export function createNaniteObject(
  name: string,
  loadedObj: ParsedMesh,
  allWIPMeshlets: MeshletWIP[]
): NaniteObject {
  const naniteObject = new NaniteObject(name, loadedObj.bounds);

  // write meshlets to the LOD tree
  let indexBufferOffsetBytes = 0;
  let nextId = 0; // id in the index buffer order
  const rewriteIds = createArray(naniteObject.meshletCount);

  // array of [parentNode, meshletToCheck]
  const roots = allWIPMeshlets.filter(isWIP_Root);
  const meshletsToCheck: Array<
    [NaniteMeshletTreeNode | undefined, MeshletWIP]
  > = roots.map((m) => [undefined, m]);

  while (meshletsToCheck.length > 0) {
    const [parentNode, meshlet] = meshletsToCheck.shift()!; // remove 1st from queue

    if (naniteObject.contains(meshlet.id)) {
      continue;
    }

    // create meshlet
    const ownBounds = calculateBounds(loadedObj.positions, meshlet.indices);
    const node = naniteObject.addMeshlet(
      parentNode,
      meshlet,
      indexBufferOffsetBytes / BYTES_U32,
      ownBounds
    );

    // rewrite id's to be in index buffer order
    rewriteIds[meshlet.id] = nextId;
    nextId += 1;

    // schedule child nodes processing
    meshlet.createdFrom.forEach((m) => {
      if (m) {
        meshletsToCheck.push([node, m]);
      }
    });
  }

  // assert all added OK
  if (allWIPMeshlets.length !== naniteObject.allMeshlets.length) {
    // prettier-ignore
    throw new Error(`Created ${allWIPMeshlets.length} meshlets, but only ${naniteObject.allMeshlets.length} were added to the LOD tree? Please verify '.createdFrom' for all meshlets.`);
  }

  // rewrite id's to be in index buffer order
  // This should be the last step, as we use ids all over the place.
  // After this step, MeshletWIP[_].id !== naniteLODTree.allMeshlets[_].id
  naniteObject.allMeshlets.forEach((m) => {
    m.id = rewriteIds[m.id];
  });

  // finalize
  assertValidNaniteObject(naniteObject);

  // print stats
  if (!CONFIG.isTest) {
    naniteObject.printStats();
  }

  return naniteObject;
}

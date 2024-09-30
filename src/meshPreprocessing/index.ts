import { CONFIG } from '../constants.ts';
import { MeshletId } from '../naniteObject/naniteObject.ts';
import {
  assert_,
  createArray,
  formatPercentageNumber,
  getTriangleCount,
  shuffleArray,
} from '../utils/index.ts';
import { BoundingSphere, calculateBounds } from '../utils/calcBounds.ts';
import {
  createMeshlets,
  splitIndicesPerMeshlets,
} from '../meshoptimizer/createMeshlets.ts';
import {
  listAllEdges,
  findBoundaryEdges,
  Edge,
  getEdgeVertices,
  createMeshletAdjacencyMap,
} from './edgesUtils.ts';
import {
  metisFreeAllocations,
  partitionGraph,
} from '../metis/partitionGraph.ts';
import { ParsedMesh } from '../utils/objLoader.ts';
import { simplifyWithAttributes } from '../meshoptimizer/simplifyWithAttributes.ts';
import { DbgMeshletExporter } from './dbgExportMeshlets.ts';
import { simplifyMesh } from '../meshoptimizer/simplifyMesh.ts';
import { quadricErrorForTriangle } from './quadric.ts';

let DEBUG = true;

/** Sometimes you get simplification error 0 and then error for children and parent are same. Would render both at same time. */
const MINIMAL_SIMPLICATION_ERROR = 0.000000001;

let NEXT_MESHLET_ID = 0;
let exporter: DbgMeshletExporter = undefined!;

function exportMeshletWIP(m: MeshletWIP) {
  const edges = Array.from(m.boundaryEdges);
  const boundsVertices = edges.map(getEdgeVertices).flat();
  exporter.addMeshlet(m.indices, new Set(boundsVertices));
}

// TODO robot still has some problems

/**
 * Meshlet when constructing the tree. This is an intermediary structure.
 * Later on we will convert it to 'NaniteMeshletTreeNode'.
 *
 * WIP - work in progress
 */
export interface MeshletWIP {
  id: MeshletId;
  /** In tree, these are the children nodes */
  createdFrom: MeshletWIP[];
  /** 0 for leaf, N for root (e.g. 6 is the root for bunny.obj) */
  lodLevel: number;
  indices: Uint32Array;
  boundaryEdges: Set<Edge>;
  /** Neighbour idx among meshlets of same level */
  neighbourMeshletIdx: Set<MeshletId>;

  // Nanite error calc:
  /** ## CALCULATED DURING CREATION!
   * Simplification error when the meshlet was created. Shared between all the meshlets created from the same lower level (more detailed) meshlets */
  maxSiblingsError: number;
  /** ## CALCULATED DURING CREATION!
   *  Combined bounds of the (lower level, more detailed) meshlets used to create this meshlet. Shared with other meshlets created from the same meshlets */
  sharedSiblingsBounds: BoundingSphere;
  /** ## ASSINGED WHEN MORE COARSE MESHLET USES US AS A BASE!
   * Parent/higher-level meshlets means created from this meshlet. `Infinity` for root (most coarse) meshlet. */
  parentError: number;
  /** ## ASSINGED WHEN MORE COARSE MESHLET USES US AS A BASE!
   * Parent/higher-level meshlets means created from this meshlet. `undefined` for root (most coarse) meshlet. */
  parentBounds: BoundingSphere | undefined;
}

export const isWIP_Root = (m: Pick<MeshletWIP, 'parentBounds'>) =>
  m.parentBounds === undefined;

export async function createNaniteMeshlets(
  parsedMesh: ParsedMesh,
  indices: Uint32Array
): Promise<MeshletWIP[]> {
  const MAX_LODS = CONFIG.nanite.maxLods;
  exporter = new DbgMeshletExporter(parsedMesh.positions);

  NEXT_MESHLET_ID = 0;
  // DEBUG = DEBUG && getTriangleCount(parsedMesh.indices) < 200000;

  const allMeshlets: MeshletWIP[] = [];
  let lodLevel = 0;
  // does not matter, bottom meshlets have error 0, so they always pass
  // the 'has error < threshold' check. They only depend on the parent's error.
  // If the parent also passes the check, the parent should be rendered instead
  const mockBounds = calculateBounds(parsedMesh.positions, indices).sphere;
  const bottomMeshlets = await splitIntoMeshlets(indices, 0.0, [], mockBounds);
  fillAdjacency(bottomMeshlets);

  let currentMeshlets = bottomMeshlets;
  lodLevel += 1;
  let lastLevelTriangeCount = -1;

  for (; lodLevel < MAX_LODS + 1; lodLevel++) {
    // break condition: nothing left to minimize
    if (currentMeshlets.length <= 1) {
      break;
    }

    const startTriangeCount = getMeshletsTriangleCount(currentMeshlets);
    const removedTrisStr = lodLevel == 1 ? '' : `Previous level removed ${formatPercentageNumber(lastLevelTriangeCount - startTriangeCount, lastLevelTriangeCount)} of the remaining triangles.`; // prettier-ignore

    // log
    console.groupCollapsed(`%cCreating LOD level ${lodLevel}. Starting with ${startTriangeCount} triangles (${currentMeshlets.length} meshlets). ${removedTrisStr}`, "color: blue"); // prettier-ignore
    lastLevelTriangeCount = startTriangeCount;

    // 1. group meshlets into groups of 4
    // e.g. 33 meshlets is 9 groups (last one is 1 meshlet)
    const partitioned = await groupMeshletsMetis(currentMeshlets);
    if (DEBUG) {
      // prettier-ignore
      console.log(
        `%c[LOD ${lodLevel}] Starting with ${currentMeshlets.length} meshlets. Partition into ${partitioned.length} groups of <=4 meshlets`,
        "color: blue", 
      );
    }

    // 2. for each group of 4 meshlets
    const newlyCreatedMeshlets: MeshletWIP[] = [];
    for (const childMeshletGroup of partitioned) {
      // TODO add warning if there is unexpected meshlet count after metis. Investigate why?
      // Metis was not able to find 4 or even 3 meshlets. Grab 2 meshlets and simplify them for a last time into 1
      const isLastMeshlet = currentMeshlets.length <= 2;

      // 2.1 [GROUP] merge triangles from all meshlets in the group
      const megaMeshlet = mergeMeshlets(...childMeshletGroup);

      // 2.2 [GROUP] simplify to remove not needed edges/vertices in the middle
      const simplifiedMesh = await simplify(
        parsedMesh,
        lodLevel,
        megaMeshlet,
        isLastMeshlet
      );
      if (!simplifiedMesh) {
        // debug the 4 meshlets that did not simplify well
        // childMeshletGroup.forEach((m) =>
        // exporter.addMeshlet(m.indices, megaMeshlet.lockedVerticesIds)
        // );
        continue;
      }

      // simplification went OK, calculate meshlet data
      const errorNow = Math.max(
        simplifiedMesh.error * simplifiedMesh.errorScale,
        MINIMAL_SIMPLICATION_ERROR
      );
      const childrenError = Math.max(
        ...childMeshletGroup.map((m) => m.maxSiblingsError)
      );
      const totalError = errorNow + childrenError;
      const bounds = calculateBounds(
        parsedMesh.positions,
        megaMeshlet.indices
      ).sphere;

      // 2.3 [GROUP] split into new meshlets.
      // Share: simplificationError, bounds (both are used in nanite to reproject the error)
      let newMeshlets: MeshletWIP[];
      if (isLastMeshlet) {
        // this happens on last iteration, when < 4 meshlets
        console.log('Reached last meshlet. Creating root node');
        // prettier-ignore
        const rootMeshlet = await createMeshletWip(simplifiedMesh.indexBuffer, totalError, childMeshletGroup, bounds);
        newMeshlets = [rootMeshlet];
      } else {
        // prettier-ignore
        newMeshlets = await splitIntoMeshlets(simplifiedMesh.indexBuffer, totalError, childMeshletGroup, bounds);
      }

      // update all lower level meshlets with parent data.
      // This way they all take same decision when deciding if render self or parent
      childMeshletGroup.forEach((childMeshlet) => {
        childMeshlet.parentError = totalError; // set based on simplify, not meshlets!
        childMeshlet.parentBounds = bounds;
        // childMeshlet.maxSiblingsError = childrenError; // NO! DO NOT EVER TOUCH THIS
      });
      newlyCreatedMeshlets.push(...newMeshlets);
    }

    // check if the base mesh (LOD level 0) is even simplify-able into LOD level 1
    if (lodLevel == 1 && newlyCreatedMeshlets.length == 0) {
      throw new SimplificationError(lodLevel - 1, parsedMesh.vertexCount);
    }

    currentMeshlets = newlyCreatedMeshlets;
    fillAdjacency(currentMeshlets);
    // await exporter.write(`meshlets-${lodLevel}`);
    console.groupEnd();
  }

  const root = currentMeshlets[0];
  // exportMeshletWIP(root);
  // root.createdFrom.forEach(exportMeshletWIP);
  // await exporter.write();

  // export all, level by level
  /*let i = 0;
  while (true) {
    const meshlets = allMeshlets.filter((m) => m.lodLevel === i);
    if (meshlets.length === 0) break;
    // console.log(`lvl ${0}, meshlets: ${meshlets.length}`);
    meshlets.forEach(exportMeshletWIP);
    await exporter.write(`meshlets-${i}`);
    i += 1;
  }*/

  // We have filled all LOD tree levels (or reached MAX_LODS iters).
  // By now the LOD tree is complete

  // mass free the memory, see the JSDocs of the fn.
  metisFreeAllocations();

  return allMeshlets;

  /////////////
  /// Utils

  async function splitIntoMeshlets(
    indices: Uint32Array,
    simplificationError: number,
    createdFrom: MeshletWIP[],
    sharedSiblingsBounds: BoundingSphere
  ) {
    const meshletsOpt = await createMeshlets(parsedMesh, indices, {
      maxVertices: CONFIG.nanite.meshletMaxVertices,
      maxTriangles: CONFIG.nanite.meshletMaxTriangles,
      coneWeight: CONFIG.nanite.meshletBackfaceCullingConeWeight,
    });
    // during init: create tons of small meshlets
    // during iter: split simplified mesh into 2+ meshlets
    const meshletsIndices = splitIndicesPerMeshlets(meshletsOpt);

    const meshlets: MeshletWIP[] = await Promise.all(
      meshletsIndices.map((indices) => {
        return createMeshletWip(
          indices,
          simplificationError,
          createdFrom,
          sharedSiblingsBounds
        );
      })
    );

    // 'createdFrom' is 0 for the initial meshlet split
    if (DEBUG && meshlets.length != 2 && createdFrom.length > 0) {
      // TODO repeat simplification?
      console.log(`%cSplit into ${meshlets.length} meshlets, expected 2`, 'color: yellow'); // prettier-ignore
    }

    return meshlets;
  }

  function createMeshletWip(
    indices: Uint32Array,
    simplificationError: number,
    createdFrom: MeshletWIP[],
    sharedSiblingsBounds: BoundingSphere
  ): MeshletWIP {
    const m: MeshletWIP = {
      id: NEXT_MESHLET_ID,
      indices,
      boundaryEdges: new Set(),
      neighbourMeshletIdx: new Set(),
      maxSiblingsError: simplificationError,
      parentError: Infinity,
      sharedSiblingsBounds,
      parentBounds: undefined,
      lodLevel,
      createdFrom,
    };
    NEXT_MESHLET_ID += 1;
    allMeshlets.push(m);
    return m;
  }
}

function fillAdjacency(meshlets: MeshletWIP[]) {
  const boundaryEdges: Array<Edge[]> = meshlets.map((m) => {
    const edges = listAllEdges(m.indices);
    return findBoundaryEdges(edges);
  });

  const meshletsByEdges = createMeshletAdjacencyMap(boundaryEdges);
  meshletsByEdges.forEach((meshletIdx, edge) => {
    if (meshletIdx.length <= 1) return;

    meshletIdx.forEach((idx) => {
      const m = meshlets[idx];
      m.boundaryEdges.add(edge);

      meshletIdx.forEach((idx2) => {
        if (idx !== idx2) m.neighbourMeshletIdx.add(idx2);
      });
    });
  });
}

async function groupMeshletsMetis(currentMeshlets: MeshletWIP[]) {
  const GROUP_SIZE = 4;
  const nparts = Math.ceil(currentMeshlets.length / GROUP_SIZE);
  let partitioned = [currentMeshlets];

  // TODO add metis weights
  if (currentMeshlets.length > GROUP_SIZE) {
    const adjacency = currentMeshlets.map((m) =>
      Array.from(m.neighbourMeshletIdx)
    );
    // each part is 4 meshlets
    const meshletIdxPerPart = await partitionGraph(adjacency, nparts, {});
    partitioned = meshletIdxPerPart.map((indices) => {
      return indices.map((i) => currentMeshlets[i]);
    });
  }

  return partitioned;
}

interface MegaMeshlet {
  indices: Uint32Array;
  lockedVerticesIds: Set<number>;
  triangleCount: number;
}

const findElementsThatAreUnique = <T>(arr: T[]) =>
  arr.filter((e) => {
    return arr.indexOf(e) === arr.lastIndexOf(e);
  });

function mergeMeshlets(...meshletGroup: MeshletWIP[]): MegaMeshlet {
  const len = meshletGroup.reduce((acc, m) => acc + m.indices.length, 0);
  const indices = new Uint32Array(len);

  // copy all indices into a single Uint32Array one by one
  let nextIdx = 0;
  meshletGroup.forEach((m) => {
    m.indices.forEach((idx) => {
      indices[nextIdx] = idx;
      nextIdx += 1;
    });
  });

  // find external edges after merge
  const allEdges: Edge[] = meshletGroup
    .map((m) => Array.from(m.boundaryEdges))
    .flat();
  const externalEdges = findElementsThatAreUnique(allEdges);
  const lockedVerticesIds = new Set<number>();
  externalEdges.forEach((e) => {
    const [v0, v1] = getEdgeVertices(e);
    lockedVerticesIds.add(v0);
    lockedVerticesIds.add(v1);
  });

  // stats
  const allVertices = new Set(indices);
  if (DEBUG) {
    console.log(`Meshlet has ${formatPercentageNumber(lockedVerticesIds.size, allVertices.size)} locked vertices`); // prettier-ignore
  }

  // export
  // if (meshletGroup[0].lodLevel === 1) {
  // exporter.addMeshlet(indices, lockedVerticesIds, 'megameshlet');
  // }

  return {
    indices,
    lockedVerticesIds,
    triangleCount: getTriangleCount(indices),
  };
}

async function simplify(
  parsedMesh: ParsedMesh,
  lodLevel: number,
  megaMeshlet: MegaMeshlet,
  reduceToSingleMeshlet: boolean // happens for the last meshlet - DAG root
) {
  const { allowRemoveRandomTriangles } = CONFIG.nanite;

  const targetMeshletCnt = reduceToSingleMeshlet ? 1 : 2;
  const targetTriangleCount = Math.floor(
    megaMeshlet.triangleCount / CONFIG.nanite.simplificationDecimateFactor
  );
  /*const targetTriangleCount = Math.min(
    targetMeshletCnt * CONFIG.nanite.meshletMaxTriangles,
    megaMeshlet.triangleCount
  );*/

  /*const simplifiedMesh = await simplifyMesh(parsedMesh, megaMeshlet.indices, {
    targetIndexCount: targetTriangleCount * 3,
    targetError: CONFIG.nanite.simplificationTargetError,
    lockBorders: true, // important!
  });*/
  const simplifiedMesh = await simplifyWithAttributes(
    parsedMesh,
    megaMeshlet.indices,
    megaMeshlet.lockedVerticesIds,
    {
      targetIndexCount: targetTriangleCount * 3,
      targetError: CONFIG.nanite.simplificationTargetError,
    }
  );

  let trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);
  const trianglesStillLeftToRemove =
    allowRemoveRandomTriangles && trianglesAfter > targetTriangleCount
      ? Math.abs(targetTriangleCount - trianglesAfter)
      : 0;
  /*if (trianglesStillLeftToRemove > 0) {
    console.log({
      intial: megaMeshlet.triangleCount,
      targetTriangleCount,
      trianglesAfter1stStep: trianglesAfter,
      trianglesStillLeftToRemove,
    });
  }*/

  const trisRemoveResult = removeRandomTriangles(
    parsedMesh.positions,
    simplifiedMesh.indexBuffer,
    trianglesStillLeftToRemove
  );
  /*if (trianglesStillLeftToRemove > 0) {
    console.log('errors', {
      trianglesStillLeftToRemove,
      simpl: simplifiedMesh.error,
      rngTriRm: trisRemoveResult.error,
      factor: simplifiedMesh.error / trisRemoveResult.error,
    });
  }*/
  simplifiedMesh.error += trisRemoveResult.error;
  simplifiedMesh.indexBuffer = trisRemoveResult.indices;

  // AKA percent of triangles still left after simplify.
  // Check if we simplified enough. If we could not simplify further, no point
  // in continuing for this group for higher levels
  const trianglesBefore = megaMeshlet.triangleCount;
  trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);
  const preservedTrisFactor = trianglesAfter / trianglesBefore;
  const megameshletHadTooMuchTris =
    megaMeshlet.triangleCount > targetTriangleCount; // sometimes METIS puts 2 meshlets instead of 4 into a group

  if (
    megameshletHadTooMuchTris &&
    !allowRemoveRandomTriangles &&
    preservedTrisFactor > 0.74 && // TODO if you had 3 meshlets in a group, this is 66%
    // we want to simplify to at most 2*128 triangles. If not possible than fail
    trianglesAfter > targetMeshletCnt * CONFIG.nanite.meshletMaxTriangles
  ) {
    // Simplification unsuccessful. This is OK for complicated objects
    // Current `childMeshlet` will be roots of the LOD tree (no parent).
    console.log(`%c  \\ Part of the mesh could not be simplified more (LOD level=${lodLevel}). Reduced from ${trianglesBefore} to ${formatPercentageNumber(trianglesAfter, trianglesBefore)} triangles`, "color: orange"); // prettier-ignore

    // debug the merged meshlet
    // exporter.addMeshlet(megaMeshlet.indices, megaMeshlet.lockedVerticesIds);
    return undefined;
  }

  if (DEBUG) {
    const isPerfect = trianglesAfter <= targetTriangleCount;
    // const p = isPerfect ? ['%c- PERFECT', 'color: green'] : [];
    const p = isPerfect ? 'PERFECT' : '';
    // prettier-ignore
    console.log(
      `%c  \\ Simplify (intial=${megaMeshlet.triangleCount} into target=${targetTriangleCount} tris), got ${trianglesAfter} tris (${(100.0 * preservedTrisFactor).toFixed(2)}%). %c${p}`,
      "color: default","color: green",
    );
  }

  return simplifiedMesh;
}

/** WARNING: THIS CAN ALSO REMOVE TRIANGLES THAT SHARE A BORDER WITH NEIGHBOUR MESHLETS! */
function removeRandomTriangles(
  vertexPositions: Float32Array,
  indexBuffer: Uint32Array,
  trianglesToRemoveCnt: number
) {
  if (trianglesToRemoveCnt <= 0) {
    return { indices: indexBuffer, error: 0 };
  }
  console.log(
    `%c  \\ RNG triangle remove: ${trianglesToRemoveCnt}`,
    'color: red'
  );

  /*// let a = (new Uint32Array([1,2,3,4,5,6,7,8,9])) // browser-test
  // new Uint32Array(a.buffer, 4) // browser-test
  const removedIndices = trianglesToRemoveCnt * 3;
  const removedBytes = removedIndices * 4; // offset
  return {
    indices: new Uint32Array(indexBuffer.buffer, removedBytes),
    error: 0,
  };*/

  const triangleCntBefore = getTriangleCount(indexBuffer);
  const triangleIds = createArray(triangleCntBefore).map((_, i) => i); // (0...triangleCntBefore-1)
  shuffleArray(triangleIds);
  // console.log(triangleIds);
  const removedTrianglesIds = triangleIds.slice(0, trianglesToRemoveCnt);
  assert_(removedTrianglesIds.length === trianglesToRemoveCnt);

  const preservedTrianglesCnt = triangleCntBefore - trianglesToRemoveCnt;
  const resultIndices = new Uint32Array(preservedTrianglesCnt * 3);
  let nextWriteIdx = 0;
  let error = 0;

  for (let triangleIdx = 0; triangleIdx < triangleCntBefore; triangleIdx++) {
    const i0 = indexBuffer[triangleIdx * 3];
    const i1 = indexBuffer[triangleIdx * 3 + 1];
    const i2 = indexBuffer[triangleIdx * 3 + 2];

    if (removedTrianglesIds.includes(triangleIdx)) {
      error += quadricErrorForTriangle(vertexPositions, i0, i1, i2);
    } else {
      resultIndices[nextWriteIdx + 0] = i0;
      resultIndices[nextWriteIdx + 1] = i1;
      resultIndices[nextWriteIdx + 2] = i2;
      nextWriteIdx += 3;
    }
  }
  assert_(nextWriteIdx === preservedTrianglesCnt * 3);

  return { indices: resultIndices, error };
}

export class SimplificationError extends Error {
  constructor(lodLevel: number, vertexCount: number) {
    // Flat shading turns each triangle into something like it's own sub-mesh.
    // All 3 triangle vertices share same normal, but a triangle
    // next to it has different normal, so 3 more vertices.
    // In that case, 2 triangles next to each other have 6 different unique
    // vertices instead of 4. This is impossible to simplify.
    // This could be enforced in code, but I'm too lazy.

    // prettier-ignore
    super(
      `Failed to simplify the mesh. Was not able to simplify beyond LOD level ${lodLevel}. This usually happens if you have duplicated vertices (${vertexCount}, should roughly match Blender's). One cause could be a flat shading or tons of UV islands.`
    );
  }
}

function getMeshletsTriangleCount(mx: MeshletWIP[]) {
  const idxCnt = mx.reduce((acc, m) => acc + m.indices.length, 0);
  return getTriangleCount(idxCnt);
}

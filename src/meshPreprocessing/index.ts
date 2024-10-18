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
  getEdgeVertices,
  createMeshletAdjacencyMap,
  hashVertexPositions,
  VertexPositionHashes,
  calculateLockedVerticesBetweenMeshlets,
} from './edgesUtils.ts';
import {
  metisFreeAllocations,
  partitionGraph,
} from '../metis/partitionGraph.ts';
import { ParsedMesh } from '../utils/objLoader.ts';
import { simplifyWithAttributes } from '../meshoptimizer/simplifyWithAttributes.ts';
import { DbgMeshletExporter } from './dbgExportMeshlets.ts';
import { SimplifiedMesh, simplifyMesh } from '../meshoptimizer/simplifyMesh.ts';
import { quadricErrorForTriangle } from './quadric.ts';
import { METIS_OPTION } from '../metis/partitionGraph.ts';

let DEBUG = true;

/** Sometimes you get simplification error 0 and then error for children and parent are same. Would render both at same time. */
const MINIMAL_SIMPLICATION_ERROR = 0.000000001;

let NEXT_MESHLET_ID = 0;
let exporter: DbgMeshletExporter = undefined!;

/*function exportMeshletWIP(m: MeshletWIP) {
  const edges = Array.from(m.sharedEdges);
  const boundsVertices = edges.map(getEdgeVertices).flat();
  exporter.addMeshlet(m.indices, new Set(boundsVertices));
}*/

const TRIS_REMOVED_PER_LEVEL: Record<number, number> = {};

const addStatsTrisRngRemoved = (lvl: number, cnt: number) => {
  const v = TRIS_REMOVED_PER_LEVEL[lvl] || 0;
  TRIS_REMOVED_PER_LEVEL[lvl] = v + cnt;
};

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
  geometricBorderVertices: Set<number>;

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
  const vertexPositionHashes = hashVertexPositions(parsedMesh);

  NEXT_MESHLET_ID = 0;
  // DEBUG = DEBUG && getTriangleCount(parsedMesh.indices) < 200000;

  const allMeshlets: MeshletWIP[] = [];
  let lodLevel = 0;
  // does not matter, bottom meshlets have error 0, so they always pass
  // the 'has error < threshold' check. They only depend on the parent's error.
  // If the parent also passes the check, the parent should be rendered instead
  const mockBounds = calculateBounds(parsedMesh.positions, indices).sphere;
  const bottomMeshlets = await splitIntoMeshlets(indices, 0.0, [], mockBounds);

  let currentMeshlets = bottomMeshlets;
  lodLevel += 1;
  let lastLevelTriangeCount = -1;

  for (; lodLevel < MAX_LODS + 1; lodLevel++) {
    // break condition: nothing left to minimize
    if (currentMeshlets.length <= 1) {
      break;
    }

    // log level data
    const startTriangeCount = getMeshletsTriangleCount(currentMeshlets);
    console.groupCollapsed(
      `%c\nCreating LOD level ${lodLevel}. Starting with ${currentMeshlets.length} meshlets (${startTriangeCount} triangles).`,
      'color: blue'
    );
    if (lodLevel > 1) {
      const trisRemovedStr = formatPercentageNumber(
        lastLevelTriangeCount - startTriangeCount,
        lastLevelTriangeCount
      );
      console.log(`%cPrevious level removed ${trisRemovedStr} of the remaining triangles.`, "color: blue"); // prettier-ignore
    }

    // 1. group meshlets into groups of 4 (or $mergeGroupSize)
    // e.g. 33 meshlets is 9 groups (last one is 1 meshlet)
    const partitioned = await groupMeshletsMetis(
      vertexPositionHashes,
      currentMeshlets
    );
    const lockedVerticesIds = calculateLockedVerticesBetweenMeshlets(
      vertexPositionHashes,
      partitioned
    );
    console.log(`%cPartitioned into ${partitioned.length} groups of ~${CONFIG.nanite.mergeGroupSize} meshlets`, "color: blue"); // prettier-ignore
    lastLevelTriangeCount = startTriangeCount;

    // 2. for each group of 4 meshlets
    const newlyCreatedMeshlets: MeshletWIP[] = [];
    for (const childMeshletGroup of partitioned) {
      // 2.1 [GROUP] merge triangles from all meshlets in the group
      const megaMeshlet = mergeMeshlets(...childMeshletGroup);

      // 2.2 [GROUP] simplify to remove not needed edges/vertices in the middle
      const simplifiedMesh = await simplify(
        parsedMesh,
        lockedVerticesIds,
        lodLevel,
        megaMeshlet
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
      // TODO Should be a sphere that encompass the child spheres,
      //      see "Smallest enclosing balls of balls" by Bernd Gartner
      const bounds = calculateBounds(parsedMesh.positions, megaMeshlet.indices).sphere; // prettier-ignore

      // 2.3 [GROUP] split into new meshlets.
      // Share: simplificationError, bounds (both are used in nanite to reproject the error)
      let newMeshlets: MeshletWIP[];
      if (currentMeshlets.length <= 2) {
        // this happens on last iteration, when <=2 meshlets
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

  // final logs
  printFinalStats(allMeshlets);

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

    const isInitialSplit = createdFrom.length === 0;
    const expectedMeshletCnt = Math.min(
      // if you have 346 tris, you expect e meshlets e.g. [128, 128, 90].
      Math.ceil(getTriangleCount(indices) / CONFIG.nanite.meshletMaxTriangles),
      // we could have ($mergeGroupSize / 2) here, but sometimes METIS groups >$mergeGroupSize meshlets. This is how METIS works, so no reason to report it
      Math.ceil(createdFrom.length / 2)
    );

    // log if we split into MORE meshlets than expected.
    // E.g. we expect to simplify 16 meshlets into 8 etc.
    // This can happen cause e.g. METIS grouped 17 meshlets together (instead of 16). Or meshoptimizer decided it's better to have more groups.
    // It's ok to have LESS meshlets than expected. Usually caused by many low-triangle meshlets that were grouped and simplified nicely.
    if (
      DEBUG &&
      !isInitialSplit && // (prettier pls)
      meshlets.length > expectedMeshletCnt
    ) {
      console.log(`%c\tSplit into ${meshlets.length} meshlets, expected ${expectedMeshletCnt}`, 'color: yellow'); // prettier-ignore
    }

    return meshlets;
  }

  function createMeshletWip(
    indices: Uint32Array,
    simplificationError: number,
    createdFrom: MeshletWIP[],
    sharedSiblingsBounds: BoundingSphere
  ): MeshletWIP {
    const edges = listAllEdges(indices);
    const geoEdges = findBoundaryEdges(edges);

    const m: MeshletWIP = {
      id: NEXT_MESHLET_ID,
      indices,
      // sharedEdges: new Set(),
      // geometricEdges: new Set(geoEdges),
      geometricBorderVertices: new Set(geoEdges.flatMap(getEdgeVertices)),
      // neighbourMeshletIdx: new Set(),
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

async function groupMeshletsMetis(
  posHashes: VertexPositionHashes,
  currentMeshlets: MeshletWIP[]
) {
  const GROUP_SIZE = CONFIG.nanite.mergeGroupSize;
  const nparts = Math.ceil(currentMeshlets.length / GROUP_SIZE);
  let partitioned = [currentMeshlets];

  if (currentMeshlets.length > GROUP_SIZE) {
    const adjacency = createMeshletAdjacencyMap(posHashes, currentMeshlets);

    // each part is ~GROUP_SIZE meshlets.
    // It can be more, it can be less. We only tell metis HOW MANY GROUPS TO CREATE,
    // we cannot specify we want them <=GROUP_SIZE each.
    // METIS is not a greedy algorithm!
    const meshletIdxPerPart = await partitionGraph(adjacency, nparts, {
      // https://github.com/zeux/meshoptimizer/blob/c664ea295861242f018d3b72ed150acc2cf848c8/demo/nanite.cpp#L340
      [METIS_OPTION.UFACTOR]: 100,
      [METIS_OPTION.SEED]: CONFIG.nanite.seed,
    });

    const meshletsCountPerPart = meshletIdxPerPart.map((e) => e.length);
    // prettier-ignore
    // console.log(`METIS split ${currentMeshlets.length} into ${nparts} groups:`, meshletsCountPerPart);
    const partsTooBig = meshletsCountPerPart.filter((e) => e > GROUP_SIZE);
    if (partsTooBig.length > 0) {
      const msg = `There are ${formatPercentageNumber(partsTooBig.length,meshletsCountPerPart.length)} parts after METIS split with more meshlets than ${GROUP_SIZE}. This is just how METIS works.`; // prettier-ignore
      // throw new Error(msg);
      console.log(`%c${msg}`, 'color:orange;');
    }

    partitioned = meshletIdxPerPart.map((indices) => {
      return indices.map((i) => currentMeshlets[i]);
    });
  }

  return partitioned;
}

interface MegaMeshlet {
  indices: Uint32Array;
  triangleCount: number;
  groupMeshletCnt: number;
}

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

  // stats
  if (DEBUG) {
    const trisPerMeshlet = meshletGroup.map((e) => getTriangleCount(e.indices));
    const trisTotal = trisPerMeshlet.reduce((a, e) => a + e, 0);
    console.log(`Merged meshlet created from ${meshletGroup.length} meshlets (${trisTotal} tris: [${trisPerMeshlet}])`); // prettier-ignore
  }

  // export
  // if (meshletGroup[0].lodLevel === 1) {
  // exporter.addMeshlet(indices, lockedVerticesIds, 'megameshlet');
  // }

  return {
    indices,
    triangleCount: getTriangleCount(indices),
    groupMeshletCnt: meshletGroup.length,
  };
}

async function simplify(
  parsedMesh: ParsedMesh,
  lockedVerticesIds: Set<number>,
  lodLevel: number,
  megaMeshlet: MegaMeshlet
) {
  const { allowRemoveRandomTriangles, border } = CONFIG.nanite;

  const targetTriangleCount = getTargetTriangleCount(megaMeshlet);

  let simplifiedMesh: SimplifiedMesh;

  if (border === 'geometric') {
    simplifiedMesh = await simplifyMesh(parsedMesh, megaMeshlet.indices, {
      targetIndexCount: targetTriangleCount * 3,
      targetError: CONFIG.nanite.simplificationTargetError,
      lockBorders: true, // important!
    });
  } else {
    simplifiedMesh = await simplifyWithAttributes(
      parsedMesh,
      megaMeshlet.indices,
      lockedVerticesIds,
      {
        targetIndexCount: targetTriangleCount * 3,
        targetError: CONFIG.nanite.simplificationTargetError,
      }
    );
  }

  let trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);
  const trianglesStillLeftToRemove = allowRemoveRandomTriangles
    ? Math.max(trianglesAfter - targetTriangleCount, 0)
    : 0;

  const trisRemoveResult = removeRandomTriangles(
    lodLevel,
    parsedMesh.positions,
    simplifiedMesh.indexBuffer,
    trianglesStillLeftToRemove
  );
  /*console.log('simplify stats', {
    trianglesIntial: megaMeshlet.triangleCount,
    targetTriangleCount,
    trianglesAfter1stStep: trianglesAfter,
    trianglesStillLeftToRemove,
    trianglesAfterRngTrisRm: getTriangleCount(simplifiedMesh.indexBuffer),
    // simpl: simplifiedMesh.error,
    // rngTriRm: trisRemoveResult.error,
    // factor: simplifiedMesh.error / trisRemoveResult.error,
  });*/
  simplifiedMesh.error += trisRemoveResult.error;
  simplifiedMesh.indexBuffer = trisRemoveResult.indices;

  // AKA percent of triangles still left after simplify.
  // Check if we simplified enough. If we could not simplify further, no point
  // in continuing for this group for higher levels
  const trianglesBefore = megaMeshlet.triangleCount;
  trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);
  const preservedTrisFactor = trianglesAfter / trianglesBefore;
  // we require to remove at least one meshlet-worth of triangles
  const requiredFactor =
    (megaMeshlet.groupMeshletCnt - 1) / megaMeshlet.groupMeshletCnt;

  if (
    preservedTrisFactor > requiredFactor &&
    trianglesAfter > targetTriangleCount
  ) {
    // Simplification unsuccessful. This is OK for complicated objects
    // Current `childMeshlet` will become a root of the LOD tree.
    console.log(`%c\tPart of the mesh could not be simplified more (LOD level=${lodLevel}). Reduced from ${trianglesBefore} to ${formatPercentageNumber(trianglesAfter, trianglesBefore)} triangles`, "color: orange"); // prettier-ignore

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
      `%c\tSimplify (intial=${megaMeshlet.triangleCount} into target=${targetTriangleCount} tris), got ${trianglesAfter} tris (${(100.0 * preservedTrisFactor).toFixed(2)}%). %c${p}`,
      "color: default","color: green",
    );
  }

  return simplifiedMesh;
}

function getTargetTriangleCount(megaMeshlet: MegaMeshlet) {
  const cfg = CONFIG.nanite;

  let targetTriangleCount = Math.floor(
    megaMeshlet.triangleCount / cfg.simplificationDecimateFactor
  );

  if (cfg.simplificationDecimateRoundToMeshlet) {
    // let pre_targetTriangleCount = targetTriangleCount;
    const roundedTrisCnt =
      Math.ceil(targetTriangleCount / cfg.meshletMaxTriangles) *
      cfg.meshletMaxTriangles;

    // if megaMeshlet has only e.g. 12 tris [2,8,2], then we cannot simplify it into 128..
    if (roundedTrisCnt < megaMeshlet.triangleCount) {
      targetTriangleCount = roundedTrisCnt;
    }
    /*console.log({
      megaMeshlet_triangleCount: megaMeshlet.triangleCount,
      megaMeshlet_groupMeshletCnt: megaMeshlet.groupMeshletCnt,
      targetTriangleCount,
      pre_targetTriangleCount,
    });*/
  }

  return targetTriangleCount;
}

/** WARNING: THIS CAN ALSO REMOVE TRIANGLES THAT SHARE A BORDER WITH NEIGHBOUR MESHLETS! */
function removeRandomTriangles(
  lodLevel: number,
  vertexPositions: Float32Array,
  indexBuffer: Uint32Array,
  trianglesToRemoveCnt: number
) {
  if (trianglesToRemoveCnt <= 0) {
    return { indices: indexBuffer, error: 0 };
  }
  console.log(`%c\tRNG triangle remove: ${trianglesToRemoveCnt}`, 'color: red');
  addStatsTrisRngRemoved(lodLevel, trianglesToRemoveCnt);

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

function printFinalStats(allMeshlets: MeshletWIP[]) {
  console.log('\n------------- SUMMARY -------------');
  const CFG = CONFIG.nanite;
  const lodLevel = allMeshlets.reduce((acc, m) => Math.max(acc, m.lodLevel), 0);

  for (let i = 0; i < lodLevel + 1; i++) {
    // const isLastLevel = i === lodLevel;
    const meshlets = allMeshlets.filter((e) => e.lodLevel === i);
    const trisCnt = getMeshletsTriangleCount(meshlets);

    // meshlet stats
    let fullyFilledCnt = 0;
    let halfFilledCnt = 0;
    let rootsCnt = 0;
    meshlets.forEach((m) => {
      const tris = getTriangleCount(m.indices);
      fullyFilledCnt += tris === CFG.meshletMaxTriangles ? 1 : 0;
      halfFilledCnt += tris <= CFG.meshletMaxTriangles / 2 ? 1 : 0;
      rootsCnt += isWIP_Root(m) ? 1 : 0;
    });
    const fullyFilledPct = formatPercentageNumber(fullyFilledCnt, meshlets.length) // prettier-ignore
    const halfFilledPct = formatPercentageNumber(halfFilledCnt, meshlets.length) // prettier-ignore

    // roots stats
    const rootsStr = rootsCnt > 0 ? `Contains ${rootsCnt} roots. ` : '';

    // tris rm stats
    const trisRngRemovedCnt = TRIS_REMOVED_PER_LEVEL[i];
    const trisRngRemovedCntStr =
      trisRngRemovedCnt > 0
        ? `RNG tris removed: ${formatPercentageNumber(trisRngRemovedCnt, trisCnt)}.` // prettier-ignore
        : '';

    console.log(
      `%cLevel ${i}: %c${meshlets.length} meshlets (${trisCnt} tris). Meshlets: ${fullyFilledPct} fully filled, ${halfFilledPct} barely filled. ${rootsStr}${trisRngRemovedCntStr}`, // prettier-ignore
      'color: blue',
      'color: default'
    );
  }

  const totalRngTrisRemoved = Object.values(TRIS_REMOVED_PER_LEVEL).reduce(
    (acc, x) => acc + x,
    0
  );
  const totalTris = getMeshletsTriangleCount(allMeshlets);
  console.log(`Total RNG tris removed: ${formatPercentageNumber(totalRngTrisRemoved, totalTris)}`); // prettier-ignore
  console.log('');
}

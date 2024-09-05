import { CONFIG } from '../constants.ts';
import { MeshletId } from '../naniteObject/naniteObject.ts';
import {
  formatPercentageNumber,
  getTriangleCount,
  randomIntFromInterval,
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
  findAdjacentMeshlets_Iter,
  findAdjacentMeshlets_Map,
  getEdgeVertices,
} from './edgesUtils.ts';
import {
  metisFreeAllocations,
  partitionGraph,
} from '../metis/partitionGraph.ts';
import { ParsedMesh } from '../utils/objLoader.ts';
import { simplifyWithAttributes } from '../meshoptimizer/simplifyWithAttributes.ts';
import { DbgMeshletExporter } from './dbgExportMeshlets.ts';
import { simplifyMesh } from '../meshoptimizer/simplifyMesh.ts';

const findAdjacentMeshlets = CONFIG.nanite.useMapToFindAdjacentEdges
  ? findAdjacentMeshlets_Map
  : findAdjacentMeshlets_Iter;

const DEBUG = false;
// const EXPORT_FIRST_LEVEL = false;

/** Sometimes you get simplification error 0 and then error for children and parent are same. Would render both at same time. */
const MINIMAL_SIMPLICATION_ERROR = 0.000000001;

let NEXT_MESHLET_ID = 0;
let exporter: DbgMeshletExporter = undefined!;

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
  boundaryEdges: Edge[];

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
        `%c[LOD ${lodLevel}] Starting with ${currentMeshlets.length} meshlets. Partition into groups of <=4 meshlets:`,
        "color: blue", partitioned.length
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
    // if (EXPORT_FIRST_LEVEL) {
    // exporter.write('meshlet');
    // Deno.exit(0);
    // }
    console.groupEnd();
  }

  // We have filled all LOD tree levels (or reached MAX_LODS iters).
  // By now the LOD tree is complete

  // mass free the memory, see the JSDocs of the fn.
  metisFreeAllocations();
  // exporter.write('meshlet');

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
    const edges = listAllEdges(indices);
    const boundaryEdges = findBoundaryEdges(edges);
    const m: MeshletWIP = {
      id: NEXT_MESHLET_ID,
      indices,
      boundaryEdges,
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

async function groupMeshletsMetis(currentMeshlets: MeshletWIP[]) {
  const GROUP_SIZE = 4;
  const nparts = Math.ceil(currentMeshlets.length / GROUP_SIZE);
  let partitioned = [currentMeshlets];

  // TODO add metis weights
  if (currentMeshlets.length > GROUP_SIZE) {
    const adjacency = findAdjacentMeshlets(
      currentMeshlets.map((m) => m.boundaryEdges)
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

  // edges
  const allEdges: Edge[] = meshletGroup.map((m) => m.boundaryEdges).flat();
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
  // exporter.addMeshlet(indices, lockedVerticesIds);

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
  // Here either hardcode toward 2 full meshlets or half the triangle count
  // const targetTriangleCount =
  // megaMeshlet.triangleCount / CONFIG.nanite.simplificationDecimateFactor;

  const targetMeshletCnt = reduceToSingleMeshlet ? 1 : 2;
  const targetTriangleCount = Math.min(
    targetMeshletCnt * CONFIG.nanite.meshletMaxTriangles,
    megaMeshlet.triangleCount
  );
  const simplifiedMesh = await simplifyMesh(parsedMesh, megaMeshlet.indices, {
    targetIndexCount: targetTriangleCount * 3,
    targetError: CONFIG.nanite.simplificationTargetError,
    lockBorders: true, // important!
  });
  /*const simplifiedMesh = await simplifyWithAttributes(
    parsedMesh,
    megaMeshlet.indices,
    megaMeshlet.lockedVerticesIds,
    {
      targetIndexCount: targetTriangleCount * 3,
      targetError: CONFIG.nanite.simplificationTargetError,
    }
  );*/

  let trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);

  // AKA percent of triangles still left after simplify.
  // Check if we simplified enough. If we could not simplify further, no point
  // in continuing for this group for higher levels
  const trianglesBefore = megaMeshlet.triangleCount;
  trianglesAfter = getTriangleCount(simplifiedMesh.indexBuffer);
  const preservedTrisFactor = trianglesAfter / trianglesBefore;
  if (preservedTrisFactor > 0.74) {
    // Simplification unsuccessful. This is OK for complicated objects
    // Current `childMeshlet` will be roots of the LOD tree (no parent).
    console.warn(`%c  \\ Part of the mesh could not be simplified more (LOD level=${lodLevel}). Reduced from ${trianglesBefore} to ${formatPercentageNumber(trianglesAfter, trianglesBefore)} triangles`, "color: orange"); // prettier-ignore

    // debug the merged meshlet
    // exporter.addMeshlet(megaMeshlet.indices, megaMeshlet.lockedVerticesIds);
    return undefined;
  }

  if (DEBUG) {
    const isPerfect = trianglesAfter === targetTriangleCount;
    // const p = isPerfect ? ['%c- PERFECT', 'color: green'] : [];
    const p = isPerfect ? 'PERFECT' : '';
    // prettier-ignore
    console.log(
      `%c  \\ Simplified (intial=${megaMeshlet.triangleCount} into target=${targetTriangleCount} tris), got ${trianglesAfter} tris (${(100.0 * preservedTrisFactor).toFixed(2)}%). %c${p}`,
      "color: default","color: green",
    );
  }

  return simplifiedMesh;
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

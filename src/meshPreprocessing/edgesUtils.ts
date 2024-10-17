import { VERTS_IN_TRIANGLE } from '../constants.ts';
import { GraphNodeConnections } from '../metis/partitionGraph.ts';
import { MeshletId } from '../naniteObject/naniteObject.ts';
import {
  combinations,
  getTriangleCount,
  getVertexCount,
} from '../utils/index.ts';
import { ParsedMesh } from '../utils/objLoader.ts';
import { MeshletWIP } from './index.ts';

/** Indices of the vertices. First index is the smaller number.
 *
 * Using object that has build-in == operator turns out to be fast.
 * Ideally it would be a number, but 32bits is too small. BigInt is slow.
 * We could try to use collision-prone hash for coarse phase
 * (something like collision detection) with the Map-based algo.
 */
export type Edge = string;

// min, max used for easier isSameEdge()
export const createEdge = (ii: number, jj: number): Edge =>
  `${Math.min(ii, jj)}-${Math.max(ii, jj)}`;

export const getEdgeVertices = (e: Edge): [number, number] =>
  // deno-lint-ignore no-explicit-any
  e.split('-').map((v) => parseInt(v)) as any;

export function listAllEdges(indices: Uint32Array): Edge[] {
  if (indices.length % VERTS_IN_TRIANGLE !== 0) {
    throw new Error(
      `Index buffer has ${indices.length} indices, cannot make triangles from this`
    );
  }

  const result: Edge[] = [];
  const triangleCount = getTriangleCount(indices);
  const addEdge = (ii: number, jj: number) => result.push(createEdge(ii, jj)); // min, max used for easier isSameEdge()

  for (let i = 0; i < triangleCount; i++) {
    const i0 = indices[VERTS_IN_TRIANGLE * i];
    const i1 = indices[VERTS_IN_TRIANGLE * i + 1];
    const i2 = indices[VERTS_IN_TRIANGLE * i + 2];
    addEdge(i0, i1);
    addEdge(i0, i2);
    addEdge(i1, i2);
  }

  return result;
}

export const isSameEdge = (e0: Edge, e1: Edge): boolean => e0 === e1;

/** Boundary edges - edge that belongs to only 1 triangle. */
export function findBoundaryEdges(allEdges: Edge[]): Edge[] {
  const countEdgeRepeats = (e: Edge) => {
    let repeats = 0;
    allEdges.forEach((e2) => {
      if (isSameEdge(e, e2)) repeats += 1;
    });
    return repeats;
  };

  // only in 1 triangle, so not shared by 2 triangles
  return allEdges.filter((e) => countEdgeRepeats(e) == 1);
}

export type VertexPositionHashes = string[];

export const hashVertexPositions = (mesh: ParsedMesh): VertexPositionHashes => {
  const result: VertexPositionHashes = [];
  for (let i = 0; i < getVertexCount(mesh.positions); i++) {
    const x = mesh.positions[i * 3 + 0];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    result.push(`${x}_${y}_${z}`);
  }

  return result;
};

export function createMeshletAdjacencyMap(
  posHashes: VertexPositionHashes,
  meshlets: MeshletWIP[]
) {
  const meshletsByVerts = new Map<string, Set<MeshletId>>();
  meshlets.forEach((m, mIdx) => {
    /*m.geometricEdges.forEach((e) => {
      const edgeVerts = getEdgeVertices(e);
      edgeVerts.forEach((vId) => {
        const hash = posHashes[vId];
        const data = meshletsByVerts.get(hash) || new Set();
        data.add(mIdx);
        meshletsByVerts.set(hash, data);
      });
    });*/
    m.geometricBorderVertices.forEach((vId) => {
      const hash = posHashes[vId];
      const data = meshletsByVerts.get(hash) || new Set();
      data.add(mIdx);
      meshletsByVerts.set(hash, data);
    });
  });

  const meshletPairsToVertCnt = new Map<string, number>();
  for (const meshledIdxs of meshletsByVerts.values()) {
    for (const [mIdx0, mIdx1] of combinations(Array.from(meshledIdxs))) {
      const key = createEdge(mIdx0, mIdx1);
      const v = meshletPairsToVertCnt.get(key) || 0;
      meshletPairsToVertCnt.set(key, v + 1);
    }
  }

  const adjacency: GraphNodeConnections[] = meshlets.map((_) => []);
  const addAdjacencyOneDir = (mIdx0: number, mIdx1: number, weight: number) => {
    const a0 = adjacency[mIdx0] || [];
    a0.push({ otherNodeIdx: mIdx1, weight });
    adjacency[mIdx0] = a0;
  };

  meshletPairsToVertCnt.forEach((sharedVertCount, key) => {
    const [mIdx0, mIdx1] = getEdgeVertices(key);
    addAdjacencyOneDir(mIdx0, mIdx1, sharedVertCount);
    addAdjacencyOneDir(mIdx1, mIdx0, sharedVertCount);
  });

  return adjacency;
}

export function calculateLockedVerticesBetweenMeshlets(
  posHashes: VertexPositionHashes,
  meshletGroups: MeshletWIP[][]
) {
  const MARK_LOCKED = -1;
  // Map cause our hash-by-position for each vertex is a string.
  // too lazy to fix this.
  const claimedVertices = new Map<string, number>();

  meshletGroups.forEach((meshlets, groupId) => {
    meshlets.forEach((m) => {
      m.geometricBorderVertices.forEach((vId) => {
        const hash = posHashes[vId];
        const isClaimedByOtherGroup =
          claimedVertices.has(hash) && claimedVertices.get(hash) !== groupId;

        if (isClaimedByOtherGroup) {
          claimedVertices.set(hash, MARK_LOCKED);
        } else {
          // claim the vertex for the current groupId
          claimedVertices.set(hash, groupId);
        }
      });
    });
  });

  // we have to do this in 2 passes
  const result = new Set<number>();
  posHashes.forEach((hash, vId) => {
    if (claimedVertices.get(hash) === MARK_LOCKED) {
      result.add(vId);
    }
  });

  return result;
}

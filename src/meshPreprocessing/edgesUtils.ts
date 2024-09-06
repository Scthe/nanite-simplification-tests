import { VERTS_IN_TRIANGLE } from '../constants.ts';
import { MeshletId } from '../naniteObject/naniteObject.ts';
import { getTriangleCount } from '../utils/index.ts';

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

export type MeshletAdjacencyMap = Map<Edge, Array<MeshletId>>;

export function createMeshletAdjacencyMap(edgesPerMeshlet: Array<Edge[]>) {
  // map: edge -> meshletId[]
  const meshletsByEdges = new Map<Edge, Array<MeshletId>>();

  // fill the map
  for (let i = 0; i < edgesPerMeshlet.length; i++) {
    const meshletEdges = edgesPerMeshlet[i];
    for (let j = 0; j < meshletEdges.length; j++) {
      const edgeHash = meshletEdges[j];
      const data = meshletsByEdges.get(edgeHash) || [];
      data.push(i);
      meshletsByEdges.set(edgeHash, data);
    }
  }

  return meshletsByEdges;
}

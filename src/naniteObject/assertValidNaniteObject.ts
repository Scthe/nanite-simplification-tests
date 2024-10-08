import { CONFIG } from '../constants.ts';
import { isSameBoundingSphere } from '../utils/calcBounds.ts';
import { NaniteMeshletTreeNode, NaniteObject } from './naniteObject.ts';

const throwErr = (msg: string) => {
  throw new Error(`Internal error, invalid nanite LOD tree. ${msg}`); // prettier-ignore
};

export function assertValidNaniteObject(naniteObject: NaniteObject) {
  const meshletsToCheck = [...naniteObject.roots];
  const visitedMeshlets = new Set<NaniteMeshletTreeNode['id']>([]);

  while (meshletsToCheck.length > 0) {
    const meshlet = meshletsToCheck.pop()!; // remove last from queue - depth first
    if (visitedMeshlets.has(meshlet.id)) {
      continue;
    }
    visitedMeshlets.add(meshlet.id);

    assertHaveSameParent(meshlet.createdFrom);
    assertHasHigherErrorThanChildren(meshlet);
    assertHasValidParentData(naniteObject, meshlet);

    if (isNaN(meshlet.maxSiblingsError)) {
      throwErr(`Meshlet has NaN maxSiblingsError`); // prettier-ignore
    }
    if (isNaN(meshlet.parentError)) {
      throwErr(`Meshlet has NaN parentError`); // prettier-ignore
    }
    if (meshlet.triangleCount > CONFIG.nanite.meshletMaxTriangles) {
      throwErr(`Meshlet contains ${meshlet.triangleCount} triangles, while max is ${CONFIG.nanite.meshletMaxTriangles}`); // prettier-ignore
    }

    meshlet.createdFrom.forEach((m) => {
      meshletsToCheck.push(m);
    });
  }

  if (visitedMeshlets.size !== naniteObject.meshletCount) {
    throwErr(`Some meshlets were not added to LOD tree. Tree contains ${visitedMeshlets.size} nodes, while expected ${naniteObject.meshletCount}`); // prettier-ignore
  }
}

function assertHasHigherErrorThanChildren(meshlet: NaniteMeshletTreeNode) {
  const myError = meshlet.maxSiblingsError;
  meshlet.createdFrom.forEach((m) => {
    const childError = m.maxSiblingsError;
    if (myError <= childError) {
      throwErr(`The error should increase as we go higher. My error if ${myError}, while child's is ${childError} (+${childError-myError})`); // prettier-ignore
    }
  });
}

function assertHaveSameParent(meshlets: NaniteMeshletTreeNode[]) {
  if (meshlets.length <= 1) {
    return; // nothing to check
  }
  const refMeshlet = meshlets[0];

  for (let i = 1; i < meshlets.length; i++) {
    const m = meshlets[i];
    if (!isSameBoundingSphere(m.parentBounds, refMeshlet.parentBounds)) {
      throwErr(`Meshlets should have same 'parentBounds'`); // prettier-ignore
    }

    // NOTE: we are testing by actually breaking this condition. Makes it easier.
    if (!CONFIG.isTest && m.parentError !== refMeshlet.parentError) {
      throwErr(`Meshlets should have same 'parentError'. ${m.parentError} vs ${refMeshlet.parentError}`); // prettier-ignore
    }
  }
}

// TODO [LOW] implement. Kinda awakward with current tree structure. You have to find all meshlets created from same meshlets as us
// function assertHasSameErrorAsSiblings() {
// if (m.sharedSiblingsBounds !== refMeshlet.sharedSiblingsBounds) {
// throwErr(`Meshlets should have same 'sharedSiblingsBounds'`); // prettier-ignore
// }
// if (m.maxSiblingsError !== refMeshlet.maxSiblingsError) {
// throwErr(`Meshlets should have same 'maxSiblingsError'`); // prettier-ignore
// }
// }

function assertHasValidParentData(
  obj: NaniteObject,
  meshlet: NaniteMeshletTreeNode
) {
  const isRoot = obj.roots.includes(meshlet);

  if (isRoot) {
    // root should have empty/invalid parent fields
    if (isFinite(meshlet.parentError)) {
      throwErr(`Root node should have parent error INFINITY, was ${meshlet.parentError}`); // prettier-ignore
    }
    if (meshlet.parentBounds !== undefined) {
      throwErr(`Root node should have no parent bounds, was ${JSON.stringify(meshlet.parentBounds)}`); // prettier-ignore
    }
  } else {
    // child node
    // NOTE: we are testing by actually breaking this condition. Makes it easier.
    if (!CONFIG.isTest && !isFinite(meshlet.parentError)) {
      throwErr(`Child node should have valid parent error, was INFINITY`); // prettier-ignore
    }
    if (meshlet.parentBounds === undefined) {
      throwErr(`Child node should have valid parent bounds`); // prettier-ignore
    }
  }
}

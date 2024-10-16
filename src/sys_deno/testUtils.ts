import * as path from 'std-path';
import { assertEquals } from 'assert';
import { getClassName } from '../utils/index.ts';
import { MeshletWIP } from '../meshPreprocessing/index.ts';
import { OVERRIDE_MESHOPTIMIZER_WASM_PATH } from '../meshoptimizer/meshoptimizerUtils.ts';
import { OVERRIDE_METIS_WASM_PATH } from '../metis/partitionGraph.ts';
import { existsSync } from 'fs';

export function absPathFromRepoRoot(filePath: string) {
  const __dirname = path.dirname(path.fromFileUrl(import.meta.url));
  return path.resolve(__dirname, '..', '..', filePath);
}

export function relativePath(
  importMeta: { dirname?: string },
  filePath: string
) {
  return path.resolve(importMeta?.dirname || '', filePath);
}

export function injectMeshoptimizerWASM() {
  OVERRIDE_MESHOPTIMIZER_WASM_PATH.value =
    'file:///' + absPathFromRepoRoot('static/meshoptimizer.wasm');
}

export function injectMetisWASM() {
  OVERRIDE_METIS_WASM_PATH.value =
    'file:///' + absPathFromRepoRoot('static/metis.wasm');
}

export const assertSameArray = (
  actual: number[] | Uint32Array | Float32Array,
  expected: number[]
) => {
  assertEquals(
    actual.length,
    expected.length,
    `Different array length: ${actual.length} vs ${expected.length}`
  );
  const actualAsArr: number[] = [];
  actual.forEach((e) => actualAsArr.push(e)); // Uint32Array | Float32Array -> number[]
  assertEquals(actualAsArr, expected);
};

export function printTypedArray(
  preffix: string,
  arr: Float32Array | Uint32Array,
  cnt = 0
) {
  cnt = cnt > 0 ? cnt : arr.length;
  const data = Array.from(arr).slice(0, cnt);
  const typeName = getClassName(arr);
  preffix = preffix.length > 0 ? `${preffix} ` : '';
  console.log(
    `${preffix}${typeName}(len=${arr.length}, bytes=${arr.byteLength})`,
    data
  );
}

/** Replace MeshletWIP's 'createdFrom' with indices*/
type PartialMeshletWIP = Partial<Omit<MeshletWIP, 'createdFrom'>> & {
  parentIdx?: number;
};

export function createMeshlets_TESTS(
  data: Array<PartialMeshletWIP>
): MeshletWIP[] {
  const center = [0, 0, -1.2];
  const MOCK_PARENT_BOUNDS = { center, radius: 1 };
  const MOCK_SIBLINGS_BOUNDS = { center, radius: 1 };

  const meshlets = data.map(
    ({ parentIdx, ...m }, idx): MeshletWIP => ({
      id: idx,
      maxSiblingsError: 0.001,
      parentError: parentIdx !== undefined ? 0.002 : Infinity,
      sharedSiblingsBounds: MOCK_SIBLINGS_BOUNDS,
      parentBounds: parentIdx !== undefined ? MOCK_PARENT_BOUNDS : undefined,
      // ignore fields below:
      sharedEdges: [],
      createdFrom: [],
      indices: new Uint32Array([0, 1, 2]),
      lodLevel: 0,
      ...m,
    })
  );
  data.forEach((m, idx) => {
    if (m.parentIdx !== undefined) {
      meshlets[m.parentIdx].createdFrom.push(meshlets[idx]);
    }
  });
  return meshlets;
}

export async function assertBinarySnapshot(
  filepath: string,
  bytes: ArrayBuffer
) {
  const bytesU8 = new Uint8Array(bytes);

  if (existsSync(filepath)) {
    console.log(`Comparing snapshots: '${filepath}'`);
    const expected = await Deno.readFile(filepath);
    // expected[0] = 11; // test that it fails
    assertEquals(
      bytesU8,
      expected,
      'Uint8Array result does not match snapshot',
      {
        formatter: () => '<buffers-too-long-to-print>',
      }
    );
  } else {
    console.log(`Creating new snapshot: '${filepath}'`);
    await Deno.writeFile(filepath, bytesU8);
  }
}

import { ParsedMesh } from '../utils/objLoader.ts';
import { WasmModule } from '../utils/wasm-types.d.ts';
import { meshoptCall, wasmPtr } from '../utils/wasm.ts';
import { getMeshOptimizerModule } from './meshoptimizerUtils.ts';
import { roundToMultiplyOf3, simplifyScale } from './simplifyMesh.ts';

interface Opts {
  targetIndexCount: number;
  targetError?: number;
}

/**
 * Reduce triangle count. Mesh will look worse.
 *
 * https://github.com/zeux/meshoptimizer?tab=readme-ov-file#simplification
 */
export async function simplifyWithAttributes(
  mesh: ParsedMesh,
  indices: Uint32Array,
  lockedVerticesIds: Set<number>,
  opts: Opts
) {
  const module = await getMeshOptimizerModule();
  const indicesCount = indices.length;

  opts.targetIndexCount = roundToMultiplyOf3(opts.targetIndexCount);
  opts.targetError = opts.targetError || 0.01;

  const [error, newIndexCount, result] = _simplifyWithAttributes_IMPL(
    module,
    mesh.verticesAndAttributes,
    mesh.vertexCount,
    mesh.verticesAndAttributesStride,
    lockedVerticesIds,
    indices,
    indicesCount,
    opts
  );
  // const [error, newIndexCount, result] = simplify2(mesh, indices, opts);

  const errorScale = simplifyScale(
    module,
    mesh.verticesAndAttributes,
    mesh.vertexCount,
    mesh.verticesAndAttributesStride
  );

  return {
    error,
    errorScale,
    indexBuffer: result.slice(0, newIndexCount),
  };
}

function _simplifyWithAttributes_IMPL(
  module: WasmModule,
  vertices: Float32Array,
  vertexCount: number,
  stride: number,
  lockedVerticesIds: Set<number>,
  indices: Uint32Array,
  indicesCount: number,
  opts: Opts
): [number, number, Uint32Array] {
  const result = new Uint32Array(indicesCount);
  const outResultError = new Float32Array(1);

  // meshopt_SimplifyX flags, 0 is a safe default
  // TODO Could use optional flags: meshopt_SimplifySparse | meshopt_SimplifyErrorAbsolute
  const options = 0;

  const vertex_attributes_data = new Float32Array();
  const attribute_weights = new Float32Array();
  const vertex_attributes_stride = 0;
  const attribute_count = 0;
  const lockedVertices = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    lockedVertices[i] = lockedVerticesIds.has(i) ? 1 : 0;
  }

  const newIndexCount = meshoptCall(
    module,
    'number',
    'meshopt_simplifyWithAttributes',
    [
      wasmPtr(result, 'out'), // destination
      wasmPtr(indices), // indices
      indicesCount, // index_count
      wasmPtr(vertices), // vertex_positions_data
      vertexCount, // vertex_count
      stride, // vertex_positions_stride
      wasmPtr(vertex_attributes_data),
      vertex_attributes_stride,
      wasmPtr(attribute_weights),
      attribute_count,
      wasmPtr(lockedVertices),
      opts.targetIndexCount, // target_index_count
      opts.targetError!, // target_error
      options, // options
      wasmPtr(outResultError, 'out'), // out_result_error
    ]
  );
  return [outResultError[0], newIndexCount, result];
}

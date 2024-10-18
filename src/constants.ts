import {
  binaryFileReader_Deno,
  textFileReader_Deno,
} from './sys_deno/loadersDeno.ts';

export const BYTES_U8 = 1;
export const BYTES_F32 = 4;
export const BYTES_U32 = 4;
export const BYTES_U64 = 8;
export const BYTES_VEC2 = BYTES_F32 * 2;
export const BYTES_VEC3 = BYTES_F32 * 3;
export const BYTES_VEC4 = BYTES_F32 * 4;
export const BYTES_UVEC2 = BYTES_U32 * 2;
export const BYTES_UVEC4 = BYTES_U32 * 4;
export const BYTES_U8_VEC4 = BYTES_U8 * 4;
export const BYTES_MAT4 = BYTES_F32 * 16;

// deno-lint-ignore no-window-prefix no-window
export const IS_DENO = window.Deno !== undefined;
export const IS_BROWSER = !IS_DENO;
export const IS_WGPU = IS_DENO;

export const MODELS_DIR = IS_DENO ? 'static/models' : 'models';

/** 4 for Vec4, 3 for Vec3. ATM using Vec3  */
export const CO_PER_VERTEX: number = 3;
/** Give a name to a random magic value '3'. Surely, number of points in a triangle can change someday!  */
export const VERTS_IN_TRIANGLE: number = 3;

export type TextFileReader = (filename: string) => Promise<string>;
export type BinaryFileReader = (filename: string) => Promise<ArrayBuffer>;

type BorderType = 'geometric' | 'meshlets';

export const CONFIG = {
  /** Test env may require GPUBuffers to have extra COPY_* flags to readback results. Or silence console spam. */
  isTest: false,
  /** This runtime injection prevents loading Deno's libraries like fs, png, etc. */
  loaders: {
    textFileReader: textFileReader_Deno,
    binaryFileReader: binaryFileReader_Deno,
  },

  ///////////////
  /// NANITE
  nanite: {
    seed: 123, // https://www.youtube.com/watch?v=h8MHXfH6Mwk (I HATE "Hitchhikers Guide ...")
    meshletMaxVertices: 255,
    meshletMaxTriangles: 128,
    meshletBackfaceCullingConeWeight: 0.0, // cone culling
    /** Reduce triangle count per each level. */
    simplificationDecimateFactor: 2,
    /** Simplification will round up target tris count to $meshletMaxTriangles.
     * Does not matter that much in practice (!) as meshoptimizer can split 256 tris into 3 meshlets of [120, 128, 8] tris. We could greedy merge them, but there might be a reason for such split e.g. all 3 meshlets do not share any vertex. They might be even spread apart and the combined bounding sphere would be big (harder to cull).
     *
     * Usually this adds few nodes, a LOD level or 2 (and sometimes much, much more). But it should RNG-remove triangles more uniformly between levels. */
    simplificationDecimateRoundToMeshlet: false,
    /** target_error for meshoptimizer */
    simplificationTargetError: 3.40282347e30, // close enough to 32-bit float MAX. JS has unusual number representation
    /** Remove random triangles if simplification failed to reach required triangle count */
    allowRemoveRandomTriangles: true,
    /** How many meshlets to merge? Original slides had 4, but this is restrictive. 16 or 32 is better. */
    mergeGroupSize: 4, // TODO adaptive?
    /**
     * - 'geometric' - Border defined as vertices on non-internal edges
     * - 'meshlets' - Border defined as vertices shared between meshlets.
     */
    border: 'meshlets' as BorderType,

    ///////////////////
    // Not important options below:

    /** Prevent infinite loop */
    maxLods: 50,
    /** Select algo. to use. IGNORE! */
    useMapToFindAdjacentEdges: true,
  },
};

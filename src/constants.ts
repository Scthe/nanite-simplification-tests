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
    meshletMaxVertices: 255,
    meshletMaxTriangles: 128,
    meshletBackfaceCullingConeWeight: 0.0, // cone culling
    /** Reduce triangle count per each level. */
    simplificationDecimateFactor: 2,
    /** target_error for meshoptimizer */
    simplificationTargetError: 3.40282347e30, // close enough to 32-bit float MAX. JS has unusual number representation
    /** Prevent infinite loop */
    maxLods: 50,
    /** Select algo. to use. IGNORE! */
    useMapToFindAdjacentEdges: true,
  },
};

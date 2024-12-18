import { CONFIG, CO_PER_VERTEX, VERTS_IN_TRIANGLE } from '../constants.ts';

import './wasm-types.d.ts';

export interface Dimensions {
  width: number;
  height: number;
}

export type ValueOf<T> = T[keyof T];

/** Remove readonly from object properties */
export type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export function getClassName(a: object) {
  // deno-lint-ignore no-explicit-any
  return (a as any).constructor.name;
}

// deno-lint-ignore no-explicit-any
export function getTypeName(a: any) {
  if (Array.isArray(a)) return 'Array';
  if (typeof a === 'object') return getClassName(a);
  return typeof a;
}

export const createArray = (len: number) => Array(len).fill(0);

type TypedArrayConstructor<T extends TypedArray> = new (len: number) => T;

export function copyToTypedArray<T extends TypedArray>(
  TypedArrayClass: TypedArrayConstructor<T>,
  data: number[]
): T {
  const result = new TypedArrayClass(data.length);
  data.forEach((e, idx) => (result[idx] = e));
  return result;
}

export function ensureTypedArray<T extends TypedArray>(
  TypedArrayClass: TypedArrayConstructor<T>,
  data: T | number[]
): T {
  if (data instanceof TypedArrayClass) {
    return data;
  } else {
    // deno-lint-ignore no-explicit-any
    return copyToTypedArray(TypedArrayClass, data as any);
  }
}

export const lerp = (a: number, b: number, fac: number) => {
  fac = Math.max(0, Math.min(1, fac));
  return a * (1 - fac) + b * fac;
};

export const getTriangleCount = (indices: Uint32Array | number[] | number) =>
  typeof indices === 'number'
    ? indices / VERTS_IN_TRIANGLE
    : indices.length / VERTS_IN_TRIANGLE;

export const getVertexCount = (verts: Float32Array | number[] | number) =>
  typeof verts === 'number'
    ? verts / CO_PER_VERTEX
    : verts.length / CO_PER_VERTEX;

export function printMinMax(name: string, arr: TypedArray | number[]) {
  console.log(name, `min(${Math.min(...arr)})`, `max(${Math.max(...arr)})`);
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes <= 0) return '0 Bytes';

  // prettier-ignore
  const units = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = (bytes / Math.pow(k, i)).toFixed(decimals);
  return `${v} ${units[i]}`;
}

export function formatNumber(num: number, decimals = 2) {
  if (num === 0) return '0';
  const sign = num < 0 ? '-' : '';
  num = Math.abs(num);

  const units = ['', 'k', 'm', 'b'];
  const k = 1000;
  const i = Math.floor(Math.log(num) / Math.log(k));
  const v = (num / Math.pow(k, i)).toFixed(decimals);
  return `${sign}${v}${units[i]}`;
}

/** Return true if is not fractional (is integer and not a float) */
export const isInt = (x: number) => x % 1 === 0;

/** Format 4 out of 100 into: '4 (4%)' */
export function formatPercentageNumber(actual: number, total: number) {
  const decimals = isInt(actual) ? 0 : 2;
  const percent = total > 0 ? (actual / total) * 100.0 : 0;
  return `${actual} (${percent.toFixed(1)}%)`;
}

export function replaceFileExt(filePath: string, nextExt: string) {
  const pos = filePath.includes('.')
    ? filePath.lastIndexOf('.')
    : filePath.length;
  const fileRoot = filePath.substring(0, pos);
  nextExt = nextExt.startsWith('.') ? nextExt : `.${nextExt}`;
  return `${fileRoot}${nextExt}`;
}

/** https://stackoverflow.com/a/47593316 */
function splitmix32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** https://stackoverflow.com/a/47593316 */
export const getRandom = splitmix32(CONFIG.nanite.seed);

export function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i >= 0; i--) {
    const j = Math.floor(getRandom() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export function assert_(cond: boolean, msg = 'Critical failure') {
  if (!cond) {
    throw new Error(msg);
  }
}

export const findUniqueElements = <T>(arr: T[]) =>
  arr.filter((e) => {
    return arr.indexOf(e) === arr.lastIndexOf(e);
  });

export function* combinations<T>(array: T[]) {
  for (let i = 0; i < array.length - 1; i++) {
    for (let j = i + 1; j < array.length; j++) {
      yield [array[i], array[j]];
    }
  }
}

import { CO_PER_VERTEX, VERTS_IN_TRIANGLE } from '../constants.ts';

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

/** Format 4 out of 100 into: '4 (4%)' */
export function formatPercentageNumber(actual: number, total: number) {
  const percent = total > 0 ? (actual / total) * 100.0 : 0;
  return `${formatNumber(actual)} (${percent.toFixed(1)}%)`;
}

export function replaceFileExt(filePath: string, nextExt: string) {
  const pos = filePath.includes('.')
    ? filePath.lastIndexOf('.')
    : filePath.length;
  const fileRoot = filePath.substring(0, pos);
  nextExt = nextExt.startsWith('.') ? nextExt : `.${nextExt}`;
  return `${fileRoot}${nextExt}`;
}

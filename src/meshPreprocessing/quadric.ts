import { Vec3, vec3 } from 'wgpu-matrix';
import { assert_ } from '../utils/index.ts';

/*
Based on meshoptimizer:
- https://github.com/zeux/meshoptimizer/blob/89ab317a96734460c0482c4ca41537611692e7e2/src/simplifier.cpp
Which is distributed under MIT License: https://github.com/zeux/meshoptimizer/blob/89ab317a96734460c0482c4ca41537611692e7e2/LICENSE.md .


TODO check how this should really work. ATM it's just random code snippets and my arbitrary nonsense (see below for comment).
*/

type Vec3 = [number, number, number];

/** a00*x^2 + a11*y^2 + a22*z^2 + 2*(a10*xy + a20*xz + a21*yz) + b0*x + b1*y + b2*z + c */
interface Quadric {
  a00: number;
  a11: number;
  a22: number, // prettier-ignore
  a10: number;
  a20: number;
  a21: number, // prettier-ignore
  b0: number;
  b1: number;
  b2: number;
  c: number, // prettier-ignore
  w: number // prettier-ignore
}

function quadricAdd(Q: Quadric, R: Quadric) {
  Q.a00 += R.a00;
  Q.a11 += R.a11;
  Q.a22 += R.a22;
  Q.a10 += R.a10;
  Q.a20 += R.a20;
  Q.a21 += R.a21;
  Q.b0 += R.b0;
  Q.b1 += R.b1;
  Q.b2 += R.b2;
  Q.c += R.c;
  Q.w += R.w;
}

/** https://github.com/zeux/meshoptimizer/blob/89ab317a96734460c0482c4ca41537611692e7e2/src/simplifier.cpp#L672 */
function quadricFromTriangle(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  weight = 1.0
): Quadric {
  const p10: Vec3 = vec3.sub(p1, p0);
  const p20: Vec3 = vec3.sub(p2, p0);

  // normal = cross(p1 - p0, p2 - p0)
  const normal: Vec3 = vec3.cross(p10, p20);
  const area: number = vec3.length(normal);

  const distance: number = vec3.dot(normal, p0);

  // we use sqrtf(area) so that the error is scaled linearly; this tends to improve silhouettes
  return quadricFromPlane(
    normal[0],
    normal[1],
    normal[2],
    -distance,
    Math.sqrt(area) * weight
  );
}

/** https://github.com/zeux/meshoptimizer/blob/89ab317a96734460c0482c4ca41537611692e7e2/src/simplifier.cpp#L652 */
function quadricFromPlane(
  a: number,
  b: number,
  c: number,
  d: number,
  w: number
): Quadric {
  const aw = a * w;
  const bw = b * w;
  const cw = c * w;
  const dw = d * w;

  const Q: Quadric = {} as any;
  Q.a00 = a * aw;
  Q.a11 = b * bw;
  Q.a22 = c * cw;
  Q.a10 = a * bw;
  Q.a20 = a * cw;
  Q.a21 = b * cw;
  Q.b0 = a * dw;
  Q.b1 = b * dw;
  Q.b2 = c * dw;
  Q.c = d * dw;
  Q.w = w;
  return Q;
}

function quadricFromTriangleEdge(p0: Vec3, p1: Vec3, p2: Vec3, weight = 1.0) {
  const p10: Vec3 = vec3.sub(p1, p0);

  // edge length; keep squared length around for projection correction
  const length: number = vec3.length(p10);
  const lengthsq = length * length;

  // p20p = length of projection of p2-p0 onto p1-p0; note that p10 is unnormalized so we need to correct it later
  const p20: Vec3 = vec3.sub(p2, p0);
  const p20p: number = vec3.dot(p20, p10);

  // perp = perpendicular vector from p2 to line segment p1-p0
  // note: since p10 is unnormalized we need to correct the projection; we scale p20 instead to take advantage of normalize below
  let perp: Vec3 = [
    p20[0] * lengthsq - p10[0] * p20p,
    p20[1] * lengthsq - p10[1] * p20p,
    p20[2] * lengthsq - p10[2] * p20p,
  ];
  perp = vec3.normalize(perp);

  const distance = vec3.dot(perp, p0);

  // note: the weight is scaled linearly with edge length; this has to match the triangle weight
  return quadricFromPlane(
    perp[0],
    perp[1],
    perp[2],
    -distance,
    length * weight
  );
}

function quadricEval(Q: Quadric, v: Vec3): number {
  let rx = Q.b0;
  let ry = Q.b1;
  let rz = Q.b2;

  rx += Q.a10 * v[1];
  ry += Q.a21 * v[2];
  rz += Q.a20 * v[0];

  rx *= 2;
  ry *= 2;
  rz *= 2;

  rx += Q.a00 * v[0];
  ry += Q.a11 * v[1];
  rz += Q.a22 * v[2];

  let r = Q.c;
  r += rx * v[0];
  r += ry * v[1];
  r += rz * v[2];

  return r;
}

export function quadricError(Q: Quadric, v: Vec3) {
  const r = quadricEval(Q, v);
  const s = Q.w == 0.0 ? 0.0 : 1.0 / Q.w;

  return Math.abs(r) * s;
}

/** https://github.com/zeux/meshoptimizer/blob/89ab317a96734460c0482c4ca41537611692e7e2/src/simplifier.cpp#L792 */
export function quadricErrorForTriangle(
  vertex_positions: Float32Array,
  i0: number,
  i1: number,
  i2: number
) {
  const vert = (idx: number): Vec3 => [
    vertex_positions[idx * 3],
    vertex_positions[idx * 3 + 1],
    vertex_positions[idx * 3 + 2],
  ];
  const p0 = vert(i0);
  const p1 = vert(i1);
  const p2 = vert(i2);
  const Q_triangle = quadricFromTriangle(p0, p1, p2, 1.0);

  /*
  WARNING: THIS IS NOT HOW YOU CALCULATE THIS.

  From quick glance on meshoptimizer, each vertex should have own quadric based
  on it's edges and triangles. I'm too tired to do this, so I just got a value
  that is roughly in a ballpark. As in: not orders of magnitude away from what
  the normal meshopt_simplify() returns.
  */

  const Q = { ...Q_triangle }; // 3 verts
  quadricAdd(Q, Q_triangle);
  quadricAdd(Q, Q_triangle);

  // edge
  quadricAdd(Q, quadricFromTriangleEdge(p0, p1, p2));
  quadricAdd(Q, quadricFromTriangleEdge(p1, p2, p0));
  quadricAdd(Q, quadricFromTriangleEdge(p2, p0, p1));

  // Note: this is nonsense
  const r = quadricError(Q, p0) + quadricError(Q, p1) + quadricError(Q, p2);

  assert_(!isNaN(r));
  // return Math.sqrt(r);
  return r;
}

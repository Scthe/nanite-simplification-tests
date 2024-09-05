import { getTriangleCount, getVertexCount } from '../utils/index.ts';

interface MeshletDbg {
  name: string;
  indices: Uint32Array;
  lockedVerticesIds: Set<number>;
}

export class DbgMeshletExporter {
  private meshlets: MeshletDbg[] = [];

  constructor(
    private readonly vertexPositions: Float32Array,
    private readonly prefix: string = 'dbg'
  ) {}

  addMeshlet(indices: Uint32Array, lockedVerticesIds: Set<number> = new Set()) {
    this.meshlets.push({
      name: `meshlet-${this.meshlets.length}`,
      indices,
      lockedVerticesIds,
    });
    /*
    const dumpAfter = 5;
    if (this.meshlets.length >= dumpAfter) {
      this.write();
      console.log(`Exported first ${dumpAfter} meshlets. DONE!`);
      Deno.exit(0);
    }*/
  }

  async write(filePath: string = 'meshlet') {
    console.log('EXPORTING: ', filePath);
    const lines: string[] = [];
    this.meshlets.forEach((m) => this.dumpMeshlet(lines, m));

    filePath = `${this.prefix}-${filePath}.obj`;
    await Deno.writeTextFile(filePath, lines.join('\n'));
  }

  private dumpMeshlet(lines: string[], m: MeshletDbg) {
    lines.push(`o ${m.name}`);

    // vertices
    // yes, full set of vertices from the original mesh FOR EVERY MESHLET
    const vertexCount = getVertexCount(this.vertexPositions);
    for (let i = 0; i < vertexCount; i++) {
      lines.push(
        [
          'v',
          this.vertexPositions[i * 3 + 0],
          this.vertexPositions[i * 3 + 1],
          this.vertexPositions[i * 3 + 2],
        ].join(' ')
      );
    }

    // normals - used to show locked vertices.
    // Blender visualizes them nicely.
    lines.push('vn 0 1 0');
    lines.push('vn 0 -1 0');

    // indices
    // warning: indices are 1-indexed, not 0!
    const serializeTriangleVert = (idx: number) =>
      `${idx + 1}//${m.lockedVerticesIds.has(idx) ? 1 : 2}`;

    const triangleCount = getTriangleCount(m.indices);
    for (let i = 0; i < triangleCount; i++) {
      const verts = [
        m.indices[i * 3 + 0],
        m.indices[i * 3 + 1],
        m.indices[i * 3 + 2],
      ];
      lines.push(
        [
          'f',
          serializeTriangleVert(verts[0]),
          serializeTriangleVert(verts[1]),
          serializeTriangleVert(verts[2]),
        ].join(' ')
      );
    }
  }
}

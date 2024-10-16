import {
  injectMeshoptimizerWASM,
  injectMetisWASM,
} from './sys_deno/testUtils.ts';
import { loadObject } from './loadObject.ts';
import { CONFIG } from './constants.ts';

injectMeshoptimizerWASM();
injectMetisWASM();

const objectFilePath = parseCmdArgs();
console.log('CONFIG', CONFIG.nanite);

const obj = await loadObject(objectFilePath);

function parseCmdArgs(): string {
  const args = Deno.args.slice();

  if (args.length === 0) throw new Error('First arg should be .obj file path');
  const objFile = args.shift()!;
  console.log(`Cmd args: [${args.join('|')}]`);

  args.forEach((arg) => {
    arg = arg.trim().toLowerCase();
    switch (arg) {
      case 'border-geometric': {
        CONFIG.nanite.border = 'geometric';
        break;
      }
      case 'decimate-round-to-meshlet': {
        CONFIG.nanite.simplificationDecimateRoundToMeshlet = true;
        break;
      }
      case 'no-rng-tris-remove': {
        CONFIG.nanite.allowRemoveRandomTriangles = false;
        break;
      }
      case '16': {
        CONFIG.nanite.mergeGroupSize = 16;
        break;
      }
      case '32': {
        CONFIG.nanite.mergeGroupSize = 32;
        break;
      }
      default: {
        throw new Error(`Unknown arg '${arg}'`);
      }
    }
  });

  return objFile;
}

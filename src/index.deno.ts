import {
  injectMeshoptimizerWASM,
  injectMetisWASM,
} from './sys_deno/testUtils.ts';
import { loadObject } from './loadObject.ts';

const DEFAULT_OBJECT = 'jinx-combined.obj';

injectMeshoptimizerWASM();
injectMetisWASM();

const objectFile = Deno.args.length > 0 ? Deno.args[0] : DEFAULT_OBJECT;

const obj = await loadObject(objectFile);

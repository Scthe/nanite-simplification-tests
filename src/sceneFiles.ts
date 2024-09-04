// prettier-ignore
const OBJECTS = {
  bunny: { file: 'bunny.obj', scale: 8 },
  lucy: { file: 'lucy.obj', scale: 1 },
  lucyJson: { file: 'lucy.json', scale: 1 },
  dragon: { file: 'xyzrgb_dragon.obj', scale: 0.01 },
  dragonJson: { file: 'xyzrgb_dragon.json', scale: 0.01 },
  robot: { file: 'robot.obj', scale: 1 },
  robotJson: { file: 'robot.json', scale: 1 },
  cube: { file: 'cube.obj', scale: 1 },
  plane: { file: 'plane.obj', scale: 1, },
  planeSubdiv: { file: 'plane-subdiv.obj', scale: 0.5 },
  displacedPlane: {
    file: 'displaced-plane.obj',
    scale: 0.2,
  },
  // test flat shading - it WILL fail with 'cannot simplify' error.
  displacedPlaneFlat: { file: 'displaced-plane-flat.obj', scale: 0.2 },
  // jinx
  jinxCombined: { file: 'jinx-combined.obj', scale: 1 },
};
export type SceneObjectName = keyof typeof OBJECTS;

export type SceneObjectDef = ReturnType<typeof getSceneObjectDef>;

export function getSceneObjectDef(name: SceneObjectName) {
  const result = OBJECTS[name];
  if (!result) {
    throw new Error(`Nonexistent object '${name}'`);
  }
  return result as {
    file: string;
    scale: number;
  };
}

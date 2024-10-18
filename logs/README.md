# Logs

## Model files

Both models are characters, which is a terrible scenario.

* [jinx](https://github.com/Scthe/nanite-webgpu/tree/master/static/models/jinx-combined)
* [robot](https://sketchfab.com/3d-models/modular-mecha-doll-neon-mask-1e0dcf3e016f4bc897d4b39819220732)

## Naming convention

Each filename contains special attributes describing used simplification options. See [src/constants.ts](../src/constants.ts) for more details about the options.

* `rngTrisRemove`. With random triangle removal.
    * **Verdict:** No other choice if you want a perfect DAG?
* `geometricBorder`. Border defined as vertices on non-internal edges ("geometric" definition).
    * Without this setting, border is defined as vertices shared between meshlets.
    * **Verdict:** Do not use the geometric border definiton. Always manually check which vertices are shared with other meshlets.
* `roundUpTrisTo128`. After dividing triangle count by 2, `ceil()` it to the nearest 128 triangles.
    * Adds a few meshlets and LOD levels. If you have 10 vs 4 meshlets at e.g. LOD level 6 will make a huge difference in total LOD level count. LOD level count by itself is a flawed metric. For some meshes this will make 0 difference.
    * **Verdict:** Works best for lower merge group size, but not amazing. Just see [src/constants.ts](../src/constants.ts).
* `32`. Merge 32 meshlets instead of 4.
    * **Verdict:** Mandatory. Exact value TBD, can be adaptive based on level's meshlet count.
    * See meshoptimizer's original [implementation](https://github.com/zeux/meshoptimizer/blob/master/demo/nanite.cpp).

# Nanite simplification tests

Tests for mesh simplification for [Nanite WebGPU](https://github.com/Scthe/nanite-webgpu). Intended for me.

Main file you want: [src/meshPreprocessing/index.ts](src/meshPreprocessing/index.ts). Theire is a separate [config file](src/constants.ts).

The context for this repo is discussions with [JMS55](https://github.com/JMS55) and [Arseny Kapoulkine](https://github.com/zeux). Since this README.md has a stupidly ridiculous conclusion, I'm only going to link my own posts:

* [post 1](https://github.com/bevyengine/bevy/discussions/14998#discussioncomment-10508903).
* [some other comments](https://github.com/bevyengine/bevy/pull/15023#discussion_r1744493894).

There is also a separate discussion in [meshoptimizer's repo](https://github.com/zeux/meshoptimizer/discussions/750).



## Quick notes (draft)

### Problems

1. Nanite does not allow you to simplify vertices that are shared with other meshlets. This is usually 30-50% of the meshlet's vertices when constructing the first DAG level. It gets worse on higher levels.
1. At some point, you end up with disjointed triangles. Not possible to simplify.

As for problem 2), from [meshoptimizer's](https://github.com/zeux/meshoptimizer?tab=readme-ov-file#simplification) documentation:

> For meshes with inconsistent topology or many seams, such as faceted meshes, it can result in simplifier getting "stuck" and not being able to simplify the mesh fully. Therefore it's critical that identical vertices are "welded" together, that is, the input vertex buffer does not contain duplicates. Additionally, it may be worthwhile to weld the vertices without taking into account vertex attributes that aren't critical and can be rebuilt later.

In some situations, there is no correct answer. Similar problems appeared [in Bevy's implementation](https://github.com/bevyengine/bevy/discussions/14998#discussioncomment-10508898). We both used many DAG roots as a quick band-aid, but it's far from optimal.


### Optimal DAG

There is a definition of an optimal DAG (from ["Batched Multi Triangulation"](http://publications.crs4.it/pubdocs/2005/CGGMPS05a/ieeeviz2005-gpumt.pdf) section 3.2):

1) the length of a path connecting the root to any leaf is logarithmic in the number of nodes and
1) the diameter of a fragment decreases geometrically with the distance of the corresponding node from the root of the DAG.

### Conclusion

> BTW. I know nothing about mesh simplification algorithms.

ATM I think that it's not possible to get an optimal DAG by only following the standard simplification rules. A similar observation I've buried in [Nanite WebGPU's Usage.md](https://github.com/Scthe/nanite-webgpu/blob/20f768a97df2bcbde7c9bbe02107727c0407d9c9/USAGE.md#what-are-simplification-warningserrors). Let's take a model that has flat shading. Each vertex is unique wrt. position and normal. According to problem 2), there is nothing we can do with it.

There are some ways to partially solve this, but none that will **always** work. E.g. you can merge vertices that are close, but it's not a definitive solution.

Actually, I lied. There is one solution that works every time. Randomly removing triangles when the simplifier gets stuck. This also includes triangles whose edge is shared with neighboring meshlets. You increase Nanite's simplification error (one used for error metric) so that the meshlet is not shown to the user if the artifacts would be visible.

This is the same solution used for LODs in my ["Frostbitten hair WebGPU"](https://github.com/Scthe/frostbitten-hair-webgpu/blob/3acd5df90409ed4c2ab43e10042ee86c26c8199a/src/scene/hair/hairObject.ts#L52). But there I remove randomly entire hair strands ([Frostbite does the same](https://youtu.be/ool2E8SQPGU?si=qklCeRbGZHXTB0jZ&t=1638)).


Not sure if there is an alternative? I'm glad I only do this in my spare time.

I'm also not sure you can always get a balanced DAG. Sometimes METIS creates a group with a single meshlet instead of 4 and you wonder what to do with it. But this solves itself on higher levels. Or tune METIS better. I don't think that's a big issue (needs testing).


## Usage (not tested)

This project is 99% copy paste from [Nanite WebGPU](https://github.com/Scthe/nanite-webgpu/tree/master). I've removed all of the WebGPU stuff. It's all intended as an experiment.

Node.js does not support WebGPU. Deno does.

1. Download the `.zip` file from [deno/releases](https://github.com/denoland/deno/releases).
   1. I use [v1.43.5](https://github.com/denoland/deno/releases/tag/v1.43.5) because I never update things that work.
2. `"<path-to-unzipped-deno>/deno.exe" cache "src/index.deno.ts"`. Download the dependencies.
3. `"<path-to-unzipped-deno>/deno.exe" task start`.

Personally, I just use the [makefile](makefile). Update paths there and you should be good to go.



PS. DO NOT LOOK INTO [quadric.ts](src/meshPreprocessing/quadric.ts).



## References

* [Arcane - Jinx](https://sketchfab.com/3d-models/arcane-jinx-b74f25a5ee6e43efbe9766b9fbebc705) 3D model by sketchfab user [Craft Tama](https://sketchfab.com/rizky08). Used under [CC Attribution](https://creativecommons.org/licenses/by/4.0/) license.
    * I've merged the textures, adjusted UVs, and removed the weapon.

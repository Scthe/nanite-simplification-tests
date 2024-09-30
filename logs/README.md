# Logs

## Model files

* [jinx](https://github.com/Scthe/nanite-webgpu/tree/master/static/models/jinx-combined)
* [robot](https://sketchfab.com/3d-models/modular-mecha-doll-neon-mask-1e0dcf3e016f4bc897d4b39819220732)

## Log files

* `jinx.txt` - without random triangle removal. Ends up as 36 root meshlets (3717 triangles).
* `jinx-rngTrisRemove.txt` - with random triangle removal. Ends up as 1 root meshlet with 128 triangles.
* `jinx-sharedBorder-rngTrisRemove.txt` - with random triangle removal. Border defined as vertices shared between meshlets.
    * In this log, meshlet size is not rounded to 128/128 tris. This has neglible impact on stats.
* `robot.txt` - the "Modular Mecha Doll Neon Mask" model without random triangle removal. Ends up as 1597 root meshlets (176614 triangles).
* `robot-rngTrisRemove.txt` - the "Modular Mecha Doll Neon Mask" model with random triangle removal. Ends up as 1 root meshlets with 128 triangles.
* `robot-sharedBorder-rngTrisRemove.txt` - with random triangle removal. Border defined as vertices shared between meshlets.
    * In this log, meshlet size is not rounded to 128/128 tris. This has neglible impact on stats.

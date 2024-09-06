DENO = "C:\\programs\\portable\\deno\\deno.exe"

# install dependencies before first run
install:
	$(DENO) cache "src/index.deno.ts"

run:
	$(DENO) task start
# DENO_NO_PACKAGE_JSON=1 && "_references/deno.exe" run --allow-read=. --allow-write=. --unstable-webgpu src/index.deno.ts

bunny:
	$(DENO) task start bunny.obj

robot:
	$(DENO) task start robot.obj

subd-plane:
	$(DENO) task start subdivided-plane.obj

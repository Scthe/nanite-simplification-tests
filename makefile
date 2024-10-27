DENO = "C:\\programs\\portable\\deno\\deno.exe"
# DENO_NO_PACKAGE_JSON=1 && "_references/deno.exe" run --allow-read=. --allow-write=. --unstable-webgpu src/index.deno.ts

# install dependencies before first run
install:
	$(DENO) cache "src/index.deno.ts"

clean:
	rm logs/*txt

run:
	$(DENO) task start jinx-combined.obj 16

run2:
	$(DENO) task start jinx-combined.obj 16 decimate-round-to-meshlet

# e.g. 'make bench-jinx', 'make bench-robot'
bench-%:
	python bench.py $*


##############################
### Misc models

bunny:
	$(DENO) task start bunny.obj

subd-plane:
	$(DENO) task start subdivided-plane.obj

robot:
	$(DENO) task start robot.obj

benchmark-jinx:
	$(DENO) task start jinx-combined.obj border-geometric no-rng-tris-remove > "logs\jinx.txt"
	$(DENO) task start jinx-combined.obj border-geometric > "logs\jinx-rngTrisRemove.txt"
	$(DENO) task start jinx-combined.obj > "logs\jinx-rngTrisRemove-meshletBorder.txt"
	$(DENO) task start jinx-combined.obj 32 > "logs\jinx-rngTrisRemove-meshletBorder-32.txt"
	$(DENO) task start jinx-combined.obj decimate-round-to-meshlet > "logs\jinx-rngTrisRemove-meshletBorder-roundUpTrisTo128.txt"
	$(DENO) task start jinx-combined.obj decimate-round-to-meshlet 32 > "logs\jinx-rngTrisRemove-meshletBorder-roundUpTrisTo128-32.txt"

##############################
### Dependencies

dep-meshoptimizer:
	mkdir -p "libs/meshoptimizer/js-my"
	cp "meshoptimizer-emscripten.bat" "libs/meshoptimizer/js-my/meshoptimizer-emscripten.bat"
	cd "libs/meshoptimizer" && "js-my/meshoptimizer-emscripten.bat"
	cp "libs/meshoptimizer/js-my/meshoptimizer.wasm" "static/meshoptimizer.wasm"
	cp "libs/meshoptimizer/js-my/meshoptimizer.js" "src/lib/meshoptimizer.js"
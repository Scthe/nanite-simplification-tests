"C:\programs\portable\emsdk\upstream\emscripten\emcc.bat" ^
-O3 ^
-s WASM=1 ^
-s ALLOW_MEMORY_GROWTH=1 ^
-s EXPORT_ES6=1 ^
-s MODULARIZE=1 ^
-s ENVIRONMENT=web ^
-s ASSERTIONS=1 ^
-s EXPORTED_RUNTIME_METHODS="['cwrap', 'ccall']" ^
-s EXPORTED_FUNCTIONS="['_malloc', '_free', '_meshopt_buildMeshletsBound', '_meshopt_buildMeshlets', '_meshopt_buildMeshletsScan', '_meshopt_simplify', '_meshopt_generateVertexRemap', '_meshopt_remapIndexBuffer', '_meshopt_remapVertexBuffer', '_meshopt_simplifyScale', '_meshopt_computeMeshletBounds', '_meshopt_simplifyWithAttributes']" ^
./src/clusterizer.cpp ./src/simplifier.cpp ./src/indexgenerator.cpp ^
-o ./js-my/meshoptimizer.js

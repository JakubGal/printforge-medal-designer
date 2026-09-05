import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSTL, createDemoMesh, normalizeOptions, generateLattice, encodeBinarySTL, isPointInsideMesh } from '../lattice-engine.js';

const regular = { quality:'draft',cellSize:8,thickness:2,resolution:1,randomness:0,seed:42 };
const cube = createDemoMesh('cube');
const asASCII = positions => `solid test\n${Array.from({length:positions.length/9},(_,i)=>`facet normal 0 0 0\nouter loop\n${[0,3,6].map(c=>`vertex ${Array.from(positions.slice(i*9+c,i*9+c+3)).join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test`;
const parsePositions = positions => parseSTL(encodeBinarySTL(positions));
const translatedCube = (size,offset=[0,0,0],reverse=false) => {
  const p=Float32Array.from(cube.positions,(v,i)=>v*size/32+offset[i%3]);
  if(reverse) for(let i=0;i<p.length;i+=9) for(let d=0;d<3;d++) [p[i+3+d],p[i+6+d]]=[p[i+6+d],p[i+3+d]];
  return p;
};

function assertClosed(result) {
  assert.ok(result.positions.length>0);
  assert.equal(result.stats.boundaryEdges,0);
  assert.equal(result.stats.nonManifoldEdges,0);
  assert.equal(result.stats.inconsistentWindingEdges,0);
  assert.equal(result.stats.watertight,true);
  assert.ok(result.stats.volumeMm3>0);
  const roundTrip=parsePositions(result.positions);
  assert.equal(roundTrip.stats.watertight,true,'exported, welded STL must also be manifold');
  assert.equal(roundTrip.stats.degenerateTriangles,0,'export must not contain collapsed triangles');
}

test('binary and ASCII STL imports preserve mm scale, bounds, volume and topology',()=>{
  for(const data of [encodeBinarySTL(cube.positions),new TextEncoder().encode(asASCII(cube.positions))]) {
    const mesh=parseSTL(data,{unitScale:2});
    assert.deepEqual(mesh.bounds.size,[64,64,64]);
    assert.equal(mesh.stats.triangles,12);
    assert.equal(mesh.stats.watertight,true);
    assert.ok(Math.abs(mesh.stats.volumeMm3-64**3)<1e-6);
  }
  const binary=encodeBinarySTL(cube.positions);
  new Uint8Array(binary,0,5).set(new TextEncoder().encode('solid'));
  assert.equal(parseSTL(binary).stats.format,'binary','binary STL may begin with solid');
});

test('malformed, open, flat and non-finite sources fail with actionable errors',()=>{
  assert.throws(()=>parseSTL(new TextEncoder().encode('not an stl')),/not a readable/);
  assert.throws(()=>parseSTL(encodeBinarySTL(cube.positions),{unitScale:0}),/unit scale/);
  const open=parsePositions(cube.positions.slice(9));
  assert.ok(open.stats.boundaryEdges>0);
  assert.throws(()=>generateLattice(open,regular),/closed, manifold/);
  const invalid=encodeBinarySTL(cube.positions);new DataView(invalid).setFloat32(96,NaN,true);
  assert.throws(()=>parseSTL(invalid),/non-finite/);
});

test('actual 3D cell-edge rods occupy Voronoi junctions, not seed-to-seed connections',()=>{
  const result=generateLattice(cube,{...regular,mode:'struts'});
  assertClosed(result);
  assert.ok(result.stats.edgeCount>0);
  assert.ok(isPointInsideMesh(result,[0,0,4]),'three-cell junction is a rod');
  assert.equal(isPointInsideMesh(result,[0,4,4]),false,'Delaunay seed connector is not a rod');
  assert.equal(isPointInsideMesh(result,[4,4,4]),false,'seed center is an open cell');
  for(let i=0;i<result.positions.length;i++) assert.ok(Math.abs(result.positions[i])<=16.001,'output stays in the source box');
});

test('3D walls and 2D extrusion have deliberately different Z topology',()=>{
  const walls=generateLattice(cube,{...regular,mode:'walls'});
  const planar=generateLattice(cube,{...regular,mode:'2d'});
  assertClosed(walls);assertClosed(planar);
  assert.ok(isPointInsideMesh(walls,[4,4,0]),'3D cells have horizontal internal walls');
  assert.equal(isPointInsideMesh(planar,[4,4,0]),false,'2D pattern remains open along extrusion Z');
  assert.ok(isPointInsideMesh(planar,[0,4,0]));
  assert.ok(isPointInsideMesh(planar,[0,4,12]));
});

test('surface lattice occupies the skin and leaves a hollow interior',()=>{
  const result=generateLattice(cube,{...regular,mode:'surface',surfaceDepth:3});
  assertClosed(result);
  assert.equal(isPointInsideMesh(result,[0,4,0]),false);
  assert.ok(isPointInsideMesh(result,[0,4,14.5]));
});

test('optional outer skin and solid Z caps fuse into the same closed solid',()=>{
  const result=generateLattice(cube,{...regular,mode:'struts',shellThickness:2,bottomThickness:2,topThickness:2});
  assertClosed(result);
  assert.ok(isPointInsideMesh(result,[4,4,15]));
  assert.ok(isPointInsideMesh(result,[4,4,-15]));
  assert.ok(isPointInsideMesh(result,[15,4,4]));
  assert.equal(isPointInsideMesh(result,[4,4,4]),false);
  const kept=generateLattice(cube,{...regular,mode:'struts',shellThickness:2,bottomThickness:2,topThickness:2,keepLargest:true});
  assert.equal(kept.stats.volumeMm3,result.stats.volumeMm3,'keep-largest must not discard enclosed air boundaries');
  assert.equal(isPointInsideMesh(kept,[4,4,4]),false);
});

test('nested source cavities survive clipping, shells and keep-largest filtering',()=>{
  const hollow=parsePositions(Float32Array.from([...cube.positions,...translatedCube(16,[0,0,0],true)]));
  assert.equal(hollow.stats.watertight,true);
  assert.ok(Math.abs(hollow.stats.volumeMm3-(32**3-16**3))<1e-6);
  assert.equal(isPointInsideMesh(hollow,[0,0,0]),false);
  const result=generateLattice(hollow,{...regular,mode:'walls',shellThickness:2,keepLargest:true});
  assertClosed(result);
  assert.equal(isPointInsideMesh(result,[0,0,0]),false,'the original internal cavity stays empty');
  assert.equal(isPointInsideMesh(result,[4,4,4]),false);
  assert.ok(isPointInsideMesh(result,[0,0,10]),'material exists around the cavity');
  assert.equal(result.stats.components,1);
  assert.ok(result.stats.cavityComponents>=1);
});

test('keep largest removes a nested solid together with that solid’s own cavity',()=>{
  const source=parsePositions(Float32Array.from([
    ...translatedCube(32),...translatedCube(24,[0,0,0],true),
    ...translatedCube(10),...translatedCube(6,[0,0,0],true),
  ]));
  const options={...regular,mode:'walls',cellSize:16,thickness:8,shellThickness:16,resolution:1};
  const all=generateLattice(source,options),kept=generateLattice(source,{...options,keepLargest:true});
  assert.equal(all.stats.components,2);assert.equal(all.stats.surfaceComponents,4);
  assert.equal(isPointInsideMesh(all,[0,0,0]),false);assert.ok(isPointInsideMesh(all,[4,0,0]));
  assertClosed(kept);
  assert.equal(kept.stats.components,1);assert.equal(kept.stats.surfaceComponents,2);
  assert.equal(kept.stats.cavityComponents,1);assert.equal(kept.stats.discardedComponents,1);
  assert.equal(isPointInsideMesh(kept,[0,0,0]),false,'an orphan cavity boundary must not turn air into material');
  assert.equal(isPointInsideMesh(kept,[4,0,0]),false,'the nested island was removed');
  assert.ok(isPointInsideMesh(kept,[14,0,0]),'the selected outer solid remains');
});

test('largest solid selection compares material volume after subtracting its own cavities',()=>{
  const source=parsePositions(Float32Array.from([
    ...translatedCube(32),...translatedCube(30,[0,0,0],true),...translatedCube(20,[40,0,0]),
  ]));
  const kept=generateLattice(source,{...regular,mode:'walls',cellSize:16,thickness:8,shellThickness:16,resolution:0.8,keepLargest:true});
  assertClosed(kept);
  assert.equal(kept.stats.components,1);assert.equal(kept.stats.surfaceComponents,1);
  assert.equal(isPointInsideMesh(kept,[15.5,0,0]),false,'the larger bounding shell has less material and is removed');
  assert.ok(isPointInsideMesh(kept,[40,0,0]),'the smaller bounding cube contains more material and is retained');
});

test('concave torus clipping preserves its through-hole',()=>{
  const torus=createDemoMesh('torus');
  assert.equal(torus.stats.watertight,true);
  const result=generateLattice(torus,{...regular,mode:'struts',shellThickness:2,resolution:1.2});
  assertClosed(result);
  assert.equal(isPointInsideMesh(result,[0,0,0]),false);
  assert.equal(isPointInsideMesh(result,[7,0,0]),false);
  assert.ok(isPointInsideMesh(result,[19,0,0]));
});

test('seed, anisotropy and thickness gradients are deterministic and change real geometry',()=>{
  const options={...regular,cellSize:12,randomness:0.9,stretch:[1.4,1,0.8],gradientAxis:'z',gradientStrength:0.6,resolution:1};
  const a=generateLattice(cube,options),b=generateLattice(cube,options),c=generateLattice(cube,{...options,seed:43});
  assert.deepEqual(a.positions,b.positions);
  assert.notDeepEqual(a.positions,c.positions);
  assertClosed(a);
  assert.ok(a.warnings.some(w=>w.includes('thinnest feature')));
});

test('resource budgets report effective settings instead of silently accepting impossible resolution',()=>{
  const result=generateLattice(cube,{...regular,mode:'2d',resolution:0.025,cellSize:1});
  assertClosed(result);
  assert.ok(result.stats.gridNodes<=200000);
  assert.ok(result.stats.voxelSize>0.025);
  assert.ok(result.stats.siteCount<=1600);
  assert.ok(result.warnings.some(w=>w.includes('Voxel size increased')));
  const defaults=normalizeOptions({stretch:[-1,Infinity,2],randomness:10});
  assert.deepEqual(defaults.stretch,[0.25,1,2]);assert.equal(defaults.randomness,1);
  assert.equal(normalizeOptions({resolution:0}).resolution,0,'zero requests automatic resolution');
  const automatic=generateLattice(cube,{...regular,cellSize:16,thickness:4,resolution:0});
  assert.equal(automatic.options.resolution,0);assert.ok(automatic.stats.voxelSize<1);
  assert.ok(automatic.stats.sourceSamplesAcross.every(value=>value>40),'automatic sampling also preserves the source shape');
});

test('keep largest removes detached bodies while retaining manifold topology',()=>{
  const source=parsePositions(Float32Array.from([...translatedCube(20,[-15,0,0]),...translatedCube(8,[15,0,0])]));
  const all=generateLattice(source,{...regular,mode:'walls',shellThickness:2,resolution:1.3});
  const kept=generateLattice(source,{...regular,mode:'walls',shellThickness:2,resolution:1.3,keepLargest:true});
  assert.ok(all.stats.components>=2);assert.equal(kept.stats.components,1);
  assert.ok(kept.stats.discardedComponents>=1);assertClosed(kept);
  assert.equal(isPointInsideMesh(kept,[18,0,0]),false);
});

test('small imported units retain dimensional controls and generate the same scaled geometry',()=>{
  const options={...regular,mode:'surface',cellSize:12,thickness:1.6,surfaceDepth:2.4,resolution:0};
  const reference=generateLattice(cube,options);
  for(const scale of [1/128,8]) {
    const source=parsePositions(Float32Array.from(cube.positions,v=>v*scale));
    const scaledOptions={...options,cellSize:options.cellSize*scale,thickness:options.thickness*scale,surfaceDepth:options.surfaceDepth*scale};
    const normalized=normalizeOptions({...scaledOptions,resolution:0.01*scale},source.bounds);
    assert.equal(normalized.thickness,scaledOptions.thickness);
    assert.equal(normalized.cellSize,scaledOptions.cellSize);
    assert.equal(normalized.surfaceDepth,scaledOptions.surfaceDepth);
    assert.equal(normalized.resolution,0.01*scale,'explicit resolution must not have a fixed mm floor');
    const result=generateLattice(source,scaledOptions);
    assert.equal(result.stats.triangles,reference.stats.triangles);
    assert.equal(result.stats.voxelSize/scale,reference.stats.voxelSize);
    assert.deepEqual(Float32Array.from(result.positions,v=>v/scale),reference.positions,'scaling source and controls together preserves the lattice');
    assertClosed(result);
  }
});

test('automatic sampling preserves a tiny source even when inherited walls are oversized',()=>{
  const source=parsePositions(translatedCube(1));
  const result=generateLattice(source,{mode:'walls',cellSize:17.1,thickness:1.6,surfaceDepth:2.4,shellThickness:1,quality:'balanced',resolution:0});
  assertClosed(result);
  assert.ok(result.stats.sourceSamplesAcross.every(value=>value>60));
  assert.ok(result.stats.triangles>10000,'an imported shape must not collapse to a handful of tetrahedra');
  assert.ok(Math.abs(result.stats.volumeMm3-1)<0.02);
  assert.ok(result.bounds.size.every(value=>value>0.99));
  assert.throws(()=>generateLattice(source,{mode:'walls',thickness:1.6,resolution:0.5}),/too coarse.*erase its shape/);
  assert.throws(()=>generateLattice(cube,{...regular,thickness:0.05,resolution:1}),/smallest requested feature/);
});

test('surface intersections stay on the analytic source, Voronoi walls or skin depth',()=>{
  const thickness=1.3,depth=2.7;
  const result=generateLattice(cube,{...regular,mode:'surface',thickness,surfaceDepth:depth,resolution:0.9});
  assertClosed(result);
  let maximumResidual=0;
  for(let i=0;i<result.positions.length;i+=3) {
    const p=Array.from(result.positions.subarray(i,i+3));
    const sourceDistance=Math.min(...p.map(value=>16-Math.abs(value)));
    const voronoiDistance=Math.min(...p.map(value=>Math.abs(value-Math.round(value/8)*8)));
    const residual=Math.min(sourceDistance,thickness/2-voronoiDistance,depth-sourceDistance);
    maximumResidual=Math.max(maximumResidual,Math.abs(residual));
  }
  assert.ok(maximumResidual<result.stats.voxelSize*0.001,`exact field residual ${maximumResidual} mm must be much smaller than one voxel`);
});

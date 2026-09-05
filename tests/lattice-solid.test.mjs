import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoMesh,encodeBinarySTL,parseSTL,isPointInsideMesh} from '../lattice-engine.js';
import {generateRodLattice} from '../lattice-solid.js';
import {resizeSourceMesh,scaleLatticeOptions} from '../lattice-settings.js';

const cube=createDemoMesh('cube');
const regular={mode:'struts',quality:'draft',cellSize:8,thickness:1.6,randomness:0,seed:42};
function closed(result) {
  assert.equal(result.stats.watertight,true);
  assert.equal(result.stats.boundaryEdges,0);
  assert.equal(result.stats.nonManifoldEdges,0);
  assert.equal(result.stats.inconsistentWindingEdges,0);
  assert.equal(result.stats.meshingMethod,'explicit-rods');
  assert.ok(result.stats.volumeMm3>0);
  const imported=parseSTL(encodeBinarySTL(result.positions));
  assert.equal(imported.stats.watertight,true);
  assert.equal(imported.stats.inconsistentWindingEdges,0);
  assert.equal(imported.stats.degenerateTriangles,0);
  assert.equal(imported.stats.duplicateTriangles,0);
}

test('internal rods have circular or rectangular sections and a fused, source-clipped network',async()=>{
  const circle=await generateRodLattice(cube,regular);
  const rectangle=await generateRodLattice(cube,{...regular,rodProfile:'rectangle'});
  closed(circle);closed(rectangle);
  assert.equal(circle.stats.components,1);
  assert.equal(rectangle.stats.components,1);
  assert.equal(isPointInsideMesh(circle,[3,.7,.7]),false,'a circle must not become a square or wall');
  assert.equal(isPointInsideMesh(rectangle,[3,.7,.7]),true,'a square rod retains its corner material');
  assert.equal(isPointInsideMesh(circle,[3,.5,0]),true);
  assert.equal(isPointInsideMesh(circle,[3,3,3]),false,'cell interiors remain open');
  assert.ok(circle.bounds.min.every(v=>v>=-16.00001));
  assert.ok(circle.bounds.max.every(v=>v<=16.00001));
  assert.ok(rectangle.stats.volumeMm3>circle.stats.volumeMm3);
});

test('surface rods keep their full profile across the source skin and leave cell faces open',async()=>{
  const result=await generateRodLattice(cube,{...regular,mode:'surface'});
  closed(result);
  assert.equal(isPointInsideMesh(result,[8,4,16.5]),true,'the outer half of a round surface rod is preserved');
  assert.equal(isPointInsideMesh(result,[8,4,15.5]),true,'the inner half is preserved too');
  assert.equal(isPointInsideMesh(result,[4,4,16]),false,'there must be no broad Voronoi wall plates');
  assert.equal(isPointInsideMesh(result,[0,0,0]),false,'surface mode must leave the center hollow');
  assert.equal(result.stats.voxelSize,null);
});

test('polygon side count and rotation alter physical rod geometry independently of voxel settings',async()=>{
  const options={...regular,rodProfile:'polygon',rodSides:3};
  const a=await generateRodLattice(cube,options);
  const b=await generateRodLattice(cube,{...options,rodSides:6});
  const rotated=await generateRodLattice(cube,{...options,rodRotation:25});
  const ignoredGrid=await generateRodLattice(cube,{...options,resolution:20});
  for(const result of [a,b,rotated,ignoredGrid]) closed(result);
  assert.ok(b.stats.volumeMm3>a.stats.volumeMm3);
  assert.notDeepEqual(a.positions,rotated.positions);
  assert.deepEqual(a.positions,ignoredGrid.positions,'rod-only modes do not use the old voxel mesh');
});

test('small STL coordinates and uniform resizing preserve explicit rod proportions',async()=>{
  const tiny=resizeSourceMesh(cube,.01),tinyOptions=scaleLatticeOptions(regular,.01);
  const a=await generateRodLattice(cube,regular),b=await generateRodLattice(tiny,tinyOptions);
  closed(a);closed(b);
  assert.ok(Math.abs(b.stats.volumeMm3/1e-6/a.stats.volumeMm3-1)<.0001);
  assert.equal(a.stats.rodCount,b.stats.rodCount);
});

test('thickness grading remains valid on rod segments outside the clipping bounds',async()=>{
  const result=await generateRodLattice(cube,{...regular,cellSize:16,thickness:8,gradientAxis:'z',gradientStrength:.8});
  closed(result);
});

test('curved surface rods stay near the source and export as one closed network',async()=>{
  const result=await generateRodLattice(createDemoMesh('sphere'),{...regular,mode:'surface',cellSize:12,randomness:.85});
  closed(result);
  assert.equal(result.stats.components,1);
  for(let i=0;i<result.positions.length;i+=3) {
    const radius=Math.hypot(...result.positions.subarray(i,i+3));
    assert.ok(radius>19.0 && radius<20.9,`surface rods must not form inward sheets (${radius})`);
  }
});

test('rotated rectangular surface joints fuse with positive overlap rather than zero-thickness flaps',async()=>{
  const result=await generateRodLattice(createDemoMesh('sphere'),{mode:'surface',cellSize:8,thickness:1.6,quality:'balanced',rodProfile:'rectangle',rodAspect:.6,rodRotation:15,seed:42,randomness:.85});
  closed(result);
  assert.equal(result.stats.components,1);
  assert.equal(result.stats.opposedDuplicateTriangles,0);
});

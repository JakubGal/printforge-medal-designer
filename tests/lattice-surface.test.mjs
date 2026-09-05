import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoMesh, parseSTL, encodeBinarySTL, normalizeOptions, buildVoronoi } from '../lattice-engine.js';
import { buildSurfaceRodGraph } from '../lattice-surface.js';

const cube=createDemoMesh('cube');
const sites=[];for(const z of [-8,8]) for(const y of [-8,8]) for(const x of [-8,8]) sites.push([x,y,z]);
function cellsFor(points,withNeighbors=true) {
  return points.map((site,i)=>({site,planes:points.flatMap((other,j)=>{
    if(i===j) return [];
    const delta=other.map((v,d)=>v-site[d]),length=Math.hypot(...delta),normal=delta.map(v=>v/length);
    return [{normal,offset:normal.reduce((sum,v,d)=>sum+v*(site[d]+other[d])/2,0),...(withNeighbors?{neighbor:j}:{})}];
  })}));
}
const voronoi={sites,cells:cellsFor(sites)};
const options={cellSize:16,thickness:2};
const parsePositions=positions=>parseSTL(encodeBinarySTL(positions));

function assertGraph(graph) {
  assert.ok(graph.edges.length>0);
  assert.equal(graph.nodes.length,graph.nodeNormals.length);
  for(const normal of graph.nodeNormals) assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-10);
  const unique=new Set();
  for(const [a,b] of graph.edges) {assert.notEqual(a,b);assert.ok(a>=0&&b>=0&&a<graph.nodes.length&&b<graph.nodes.length);const key=[a,b].sort((x,y)=>x-y).join(',');assert.ok(!unique.has(key));unique.add(key);}
  assert.equal(graph.stats.edges,graph.edges.length);
}

test('surface rods are stitched curves on actual cube faces with retained junctions and sharp turns',()=>{
  const graph=buildSurfaceRodGraph(cube,voronoi,options);assertGraph(graph);
  assert.equal(graph.stats.components,1);assert.equal(graph.stats.endpoints,0);
  assert.equal(graph.stats.junctions,6);assert.equal(graph.edges.length,24);
  assert.equal(graph.nodes.length,18);assert.equal(graph.polylines.length,12);
  for(const [a,b] of graph.edges) {
    const midpoint=graph.nodes[a].map((v,d)=>(v+graph.nodes[b][d])/2);
    assert.ok(midpoint.some(v=>Math.abs(Math.abs(v)-16)<1e-6),'a rod follows a real source face');
    assert.ok(midpoint.some(v=>Math.abs(v)<1e-6),'a rod follows a true Voronoi face plane');
  }
});

test('surface graph accepts legacy cells without neighbor metadata',()=>{
  const expected=buildSurfaceRodGraph(cube,voronoi,options);
  const inferred=buildSurfaceRodGraph(cube,{sites,cells:cellsFor(sites,false)},options);
  assert.deepEqual(inferred.nodes,expected.nodes);assert.deepEqual(inferred.edges,expected.edges);
});

test('curved torus graphs preserve the through-hole and retain closed connectivity',()=>{
  const torus=createDemoMesh('torus'),graph=buildSurfaceRodGraph(torus,voronoi,{cellSize:16,thickness:1.6});assertGraph(graph);
  assert.equal(graph.stats.endpoints,0);
  for(const [a,b] of graph.edges) {
    const p=graph.nodes[a].map((v,d)=>(v+graph.nodes[b][d])/2),radial=Math.hypot(p[0],p[1]);
    assert.ok(radial>7.8,'a rod must not bridge the torus hole');
    assert.ok(Math.abs(Math.hypot(radial-14,p[2])-6)<0.15,'simplified rods stay on the curved source within the chord tolerance');
  }
  assert.ok(graph.stats.rawSegments>graph.edges.length,'small collinear/curved mesh-edge segments are simplified');
});

test('separate cavity surfaces are never stitched across empty space',()=>{
  const inner=Float32Array.from(cube.positions,v=>v/2);
  for(let i=0;i<inner.length;i+=9) for(let d=0;d<3;d++) [inner[i+3+d],inner[i+6+d]]=[inner[i+6+d],inner[i+3+d]];
  const hollow=parsePositions(Float32Array.from([...cube.positions,...inner]));
  const graph=buildSurfaceRodGraph(hollow,voronoi,options);assertGraph(graph);
  assert.equal(graph.stats.components,2);assert.equal(graph.stats.endpoints,0);
  for(const [a,b] of graph.edges) {
    const outerA=Math.max(...graph.nodes[a].map(Math.abs)),outerB=Math.max(...graph.nodes[b].map(Math.abs));
    assert.ok(Math.abs(outerA-outerB)<1e-6,'an edge stays on one cavity/outer boundary');
  }
});

test('coplanar source faces produce perimeter curves, never flat panels',()=>{
  const coplanarSites=[[0,0,0],[32,0,0]],graph=buildSurfaceRodGraph(cube,{sites:coplanarSites,cells:cellsFor(coplanarSites)},options);assertGraph(graph);
  assert.equal(graph.stats.components,1);assert.equal(graph.stats.endpoints,0);assert.equal(graph.polylines.length,1);
  assert.ok(graph.stats.coplanarTriangles>0);assert.ok(graph.warnings.length>0);
  for(const point of graph.nodes) {assert.equal(point[0],16);assert.ok(Math.abs(point[1])===16||Math.abs(point[2])===16);}
});

test('surface graphs remain deterministic and scale with tiny source units',()=>{
  const graph=buildSurfaceRodGraph(cube,voronoi,options),scale=1/128;
  const source=parsePositions(Float32Array.from(cube.positions,v=>v*scale)),scaledSites=sites.map(p=>p.map(v=>v*scale));
  const smaller=buildSurfaceRodGraph(source,{sites:scaledSites,cells:cellsFor(scaledSites)},{cellSize:16*scale,thickness:2*scale});
  assert.deepEqual(smaller.edges,graph.edges);assert.deepEqual(smaller.nodes.map(p=>p.map(v=>v/scale)),graph.nodes);
  assert.deepEqual(buildSurfaceRodGraph(cube,voronoi,options).polylines,graph.polylines);
});

test('irregular curved surface traces form a closed graph with outward profile normals',()=>{
  const source=createDemoMesh('sphere'),settings=normalizeOptions({mode:'surface',cellSize:17.1,thickness:1.6,quality:'balanced',randomness:0.85,seed:42},source.bounds);
  const graph=buildSurfaceRodGraph(source,buildVoronoi(source.bounds,settings),settings);assertGraph(graph);
  assert.equal(graph.stats.endpoints,0);assert.equal(graph.stats.components,1);
  graph.nodes.forEach((point,id)=>{
    assert.ok(Math.hypot(...point)>19.9 && Math.hypot(...point)<=20.000001);
    const alignment=point.reduce((sum,v,d)=>sum+v*graph.nodeNormals[id][d],0)/Math.hypot(...point);
    assert.ok(alignment>0.995,'profile frames follow outward source normals');
  });
  assert.ok(graph.stats.simplificationTolerance<=Math.min(settings.thickness*0.06,settings.cellSize*0.005));
});

test('surface graph resource and empty-intersection failures are actionable',()=>{
  assert.throws(()=>buildSurfaceRodGraph(cube,voronoi,{...options,maxSurfaceSegments:10}),/rod segments.*limit/);
  const distant=[[-100,0,0],[0,0,0]];
  assert.throws(()=>buildSurfaceRodGraph(cube,{sites:distant,cells:cellsFor(distant)},options),/No Voronoi boundaries cross/);
});

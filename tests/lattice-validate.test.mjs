import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoMesh, parseSTL, encodeBinarySTL, inspectMesh } from '../lattice-engine.js';
import { canonicalizeFloat32Mesh, exportPrecisionBudget } from '../lattice-validate.js';

const cube=createDemoMesh('cube');
const canonical=positions=>canonicalizeFloat32Mesh(positions);
function tetra(points) {
  const faces=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
  let result=Float32Array.from(faces.flatMap(face=>face.flatMap(id=>points[id])));
  const u=points[1].map((v,d)=>v-points[0][d]),v=points[2].map((n,d)=>n-points[0][d]),w=points[3].map((n,d)=>n-points[0][d]);
  const determinant=u[0]*(v[1]*w[2]-v[2]*w[1])-u[1]*(v[0]*w[2]-v[2]*w[0])+u[2]*(v[0]*w[1]-v[1]*w[0]);
  if(determinant<0) for(let i=0;i<result.length;i+=9) for(let d=0;d<3;d++) [result[i+3+d],result[i+6+d]]=[result[i+6+d],result[i+3+d]];
  return result;
}

test('exact Float32 validation preserves a legitimate extremely thin closed tetrahedron',()=>{
  const positions=tetra([[0,0,0],[1e-9,0,0],[0,1,0],[0,0,1]]);
  const result=canonical(positions);assert.equal(result.stats.watertight,true);assert.equal(result.stats.triangles,4);
  assert.equal(result.stats.degenerateTriangles,0);
  const imported=parseSTL(encodeBinarySTL(result.positions));
  assert.equal(imported.stats.watertight,true);assert.equal(imported.stats.triangles,4);assert.equal(imported.stats.degenerateTriangles,0);
});

test('Boolean-style narrow faces survive an STL roundtrip without tolerance-grid deletion',()=>{
  const shifted=Float32Array.from(cube.positions,value=>value+16),result=[];
  for(let i=0;i<shifted.length;i+=9) {
    const p=[0,3,6].map(offset=>Array.from(shifted.subarray(i+offset,i+offset+3)));
    let split=-1;
    for(let c=0;c<3;c++) {
      const a=p[c],b=p[(c+1)%3];
      if(a[1]===0&&a[2]===0&&b[1]===0&&b[2]===0&&a[0]!==b[0]) split=c;
    }
    if(split<0) result.push(...p.flat());
    else {const a=p[split],b=p[(split+1)%3],c=p[(split+2)%3],middle=[1e-7,0,0];result.push(...a,...middle,...c,...middle,...b,...c);}
  }
  const output=canonical(Float32Array.from(result)),imported=parseSTL(encodeBinarySTL(output.positions));
  assert.equal(output.stats.triangles,14);assert.equal(imported.stats.triangles,14);
  assert.equal(imported.stats.degenerateTriangles,0);assert.equal(imported.stats.watertight,true);
  assert.equal(imported.stats.tolerantWeldTolerance,undefined);
});

test('property-seam metadata and extra vertex properties preserve exact mesh topology',()=>{
  const props=[];for(let i=0;i<cube.positions.length;i+=3) props.push(...cube.positions.subarray(i,i+3),1,0,0);
  const raw={numProp:6,vertProperties:Float32Array.from(props),triVerts:Uint32Array.from({length:cube.positions.length/3},(_,i)=>i),mergeFromVert:Uint32Array.from([3]),mergeToVert:Uint32Array.from([0])};
  // Pick an actual duplicate position rather than assuming STL triangle order.
  const first=Array.from(cube.positions.subarray(0,3)).join(',');
  for(let i=1;i<cube.positions.length/3;i++) if(Array.from(cube.positions.subarray(i*3,i*3+3)).join(',')===first) {raw.mergeFromVert[0]=i;break;}
  const result=canonicalizeFloat32Mesh(raw,{scale:0.1,translation:[1,2,3],minFeature:0.1});
  assert.equal(result.stats.watertight,true);assert.equal(result.stats.inconsistentWindingEdges,0);assert.equal(result.stats.triangles,12);
  assert.equal(result.diagnostics.propertySeams,1);assert.ok(Math.abs(result.stats.volumeMm3-32.768)<1e-4);
});

test('only zero-area and identical duplicate faces are removed; holes and false connections are rejected',()=>{
  const withZeros=Float32Array.from([...cube.positions,0,0,0,1,0,0,2,0,0,...cube.positions.subarray(0,9)]);
  const cleaned=canonical(withZeros);assert.equal(cleaned.stats.triangles,12);assert.equal(cleaned.stats.degenerateTriangles,1);assert.equal(cleaned.stats.duplicateTriangles,1);
  assert.throws(()=>canonical(cube.positions.subarray(9)),/not a closed oriented solid/);
  const a=tetra([[0,0,0],[1,0,0],[0,1,0],[0,0,1]]),b=tetra([[0,0,0],[-1,0,0],[0,-1,0],[0,0,1]]);
  assert.throws(()=>canonical(Float32Array.from([...a,...b])),/non-manifold edges/,'touching along a single edge is not a valid solid connection');
});

test('a collinear zero-area junction is stitched by splitting its existing long-edge neighbor',()=>{
  const a=[0,0,0],b=[0.25,0,0],c=[1,0,0],d=[0,1,0],e=[0,0,1];
  const input=Float32Array.from([c,b,d,b,a,d,a,c,e,c,d,e,d,a,e,a,b,c].flat());
  const result=canonical(input);
  assert.equal(result.stats.watertight,true);assert.equal(result.stats.inconsistentWindingEdges,0);
  assert.equal(result.stats.repairedCollinearJunctions,1);assert.equal(result.stats.triangles,6);
  assert.ok(Math.abs(result.stats.volumeMm3-1/6)<1e-12);
  const original=new Set([a,b,c,d,e].map(point=>point.join(',')));
  for(let i=0;i<result.positions.length;i+=3) assert.ok(original.has(Array.from(result.positions.subarray(i,i+3)).join(',')),'repair never moves a vertex');
  const roundTrip=parseSTL(encodeBinarySTL(result.positions));
  assert.equal(roundTrip.stats.watertight,true);assert.equal(roundTrip.stats.degenerateTriangles,0);
});

test('tolerant repair is restricted to already-open imports and reports its intervention',()=>{
  const cracked=Float32Array.from(cube.positions,v=>v+16);
  const corner=Array.from(cracked.subarray(0,3));
  cracked[0]=corner[0]+1e-7;
  const open=inspectMesh(cracked);assert.ok(open.stats.boundaryEdges>0);
  const repaired=parseSTL(encodeBinarySTL(cracked));
  assert.equal(repaired.stats.watertight,true);assert.ok(repaired.stats.repairedBoundaryEdges>0);
  assert.ok(repaired.warnings.some(w=>w.includes('nearly coincident open edges')));
});

test('precision budgets scale with feature width and identify far-origin Float32 loss',()=>{
  const near=exportPrecisionBudget(cube.bounds,{minFeature:1.6});
  const far={min:cube.bounds.min.map((v,d)=>v+(d===0?10000:0)),max:cube.bounds.max.map((v,d)=>v+(d===0?10000:0)),size:cube.bounds.size};
  const budget=exportPrecisionBudget(far,{minFeature:1.6});
  assert.equal(near.requiresRecentering,false);assert.equal(budget.requiresRecentering,true);
  assert.ok(budget.coordinateSpacing>near.coordinateSpacing);assert.ok(budget.recommendedTolerance<=1.6*0.001);
  assert.throws(()=>canonicalizeFloat32Mesh(cube.positions,{translation:[10000.0004,0,0],minFeature:0.01}),/precision budget.*Recenter/);
});

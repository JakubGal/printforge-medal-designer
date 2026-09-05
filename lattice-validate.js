/** Validation of the coordinates an STL will actually contain, after Float32
 * conversion. Exact coordinate welding is intentional: a global weld grid can
 * destroy valid narrow Boolean triangles and create holes during validation.
 */
import { boundsOf, meshStatistics } from './lattice-engine.js';

const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

function float32Spacing(value) {
  const magnitude=Math.abs(Math.fround(value));
  if(!Number.isFinite(magnitude)) return Infinity;
  if(magnitude<2**-126) return 2**-149;
  return 2**(Math.floor(Math.log2(magnitude))-23);
}

/** Geometry error budget in the final output units, not the kernel's units. */
export function exportPrecisionBudget(bounds,{minFeature,maxDeviation}={}) {
  const span=Math.max(...bounds.size);
  if(!(span>0) || !Number.isFinite(span)) throw new Error('The exported mesh has no finite measurable size.');
  const maximumCoordinate=Math.max(...bounds.min.map(Math.abs),...bounds.max.map(Math.abs));
  const coordinateSpacing=float32Spacing(maximumCoordinate);
  const featureLimit=Number.isFinite(minFeature)&&minFeature>0?minFeature*0.001:Infinity;
  const allowedDeviation=Math.min(span*1e-5,featureLimit,Number.isFinite(maxDeviation)&&maxDeviation>0?maxDeviation:Infinity);
  const requiredTolerance=coordinateSpacing*8;
  return {span,maximumCoordinate,coordinateSpacing,allowedDeviation,requiredTolerance,
    recommendedTolerance:Math.min(allowedDeviation,Math.max(span*1e-5,requiredTolerance)),
    requiresRecentering:requiredTolerance>allowedDeviation};
}

function triangleAreaSquared(a,b,c) {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
  return x*x+y*y+z*z;
}

function orientedKey(a,b,c) {
  if(a<b&&a<c) return `${a},${b},${c}`;
  if(b<a&&b<c) return `${b},${c},${a}`;
  return `${c},${a},${b}`;
}

function repairCollinearJunctions(points,indices,candidates) {
  if(!candidates.length) return 0;
  const edgeKey=(a,b)=>Math.min(a,b)*points.length+Math.max(a,b),edges=new Map();
  const update=(offset,remove=false)=>{
    const tri=indices.slice(offset,offset+3);
    for(let i=0;i<3;i++) {
      const key=edgeKey(tri[i],tri[(i+1)%3]);
      if(remove) {const uses=edges.get(key);uses.splice(uses.indexOf(offset),1);if(!uses.length) edges.delete(key);}
      else {if(!edges.has(key)) edges.set(key,[]);edges.get(key).push(offset);}
    }
  };
  for(let offset=0;offset<indices.length;offset+=3) update(offset);
  const orientation=(offset,a,b)=>{
    for(let i=0;i<3;i++) {const x=indices[offset+i],y=indices[offset+(i+1)%3];if(x===a&&y===b) return 1;if(x===b&&y===a) return -1;}
    return 0;
  };
  let repaired=0;
  for(const candidate of candidates) {
    let a=candidate[0],c=candidate[1],b=candidate[2],longest=distance(points[a],points[c]);
    for(let i=0;i<3;i++) for(let j=i+1;j<3;j++) {
      const length=distance(points[candidate[i]],points[candidate[j]]);
      if(length>longest) {longest=length;a=candidate[i];c=candidate[j];b=candidate[3-i-j];}
    }
    const ac=edges.get(edgeKey(a,c)),ab=edges.get(edgeKey(a,b)),bc=edges.get(edgeKey(b,c));
    if(ac?.length!==1||ab?.length!==1||bc?.length!==1) continue;
    const target=ac[0],direction=orientation(target,a,c);
    if(!direction||orientation(ab[0],a,b)!==-direction||orientation(bc[0],b,c)!==-direction) continue;
    const tri=indices.slice(target,target+3),third=tri.find(id=>id!==a&&id!==c);
    if(third===undefined||third===b||triangleAreaSquared(points[a],points[b],points[third])===0||triangleAreaSquared(points[b],points[c],points[third])===0) continue;
    // Replace A-C-D by A-B-D and B-C-D using an existing exactly collinear
    // vertex B. This closes a zero-width T-junction without moving any vertex
    // or adding material. Boundary orientations must already match.
    if(direction<0) [a,c]=[c,a];
    update(target,true);
    indices[target]=a;indices[target+1]=b;indices[target+2]=third;
    const added=indices.length;indices.push(b,c,third);update(target);update(added);repaired++;
  }
  return repaired;
}

/**
 * Convert a Manifold.Mesh (or unindexed Float32 triangle positions) to a
 * canonical STL-ready mesh and validate exact exported coordinate topology.
 * It removes only mathematically zero-area and identically oriented duplicate
 * faces; it never deletes components, fills holes or merges nearby positions.
 *
 * @param {{numProp:number,vertProperties:Float32Array,triVerts:Uint32Array,mergeFromVert?:Uint32Array,mergeToVert?:Uint32Array}|Float32Array} input
 * @param {{scale?:number,translation?:number[],minFeature?:number,maxDeviation?:number,strict?:boolean}} options
 */
export function canonicalizeFloat32Mesh(input,{scale=1,translation=[0,0,0],minFeature,maxDeviation,strict=true}={}) {
  if(!Number.isFinite(scale)||scale===0||translation.length!==3||translation.some(v=>!Number.isFinite(v))) throw new Error('The export transform must have a finite non-zero scale and three finite translation coordinates.');
  const unindexed=input instanceof Float32Array;
  const properties=unindexed?input:input?.vertProperties,numProp=unindexed?3:input?.numProp;
  if(!properties || !Number.isInteger(numProp)||numProp<3||properties.length%numProp) throw new Error('The mesh has invalid vertex properties.');
  const count=properties.length/numProp,rawIndices=unindexed?Uint32Array.from({length:count},(_,i)=>i):input.triVerts;
  if(!count||!rawIndices?.length||rawIndices.length%3) throw new Error('The mesh does not contain complete triangles.');
  if(rawIndices.length>30000000) throw new Error('The mesh exceeds the export validation size limit.');
  const transformed=new Array(count),flat=new Float32Array(count*3),parents=Uint32Array.from({length:count},(_,i)=>i);
  const find=id=>{while(parents[id]!==id) {parents[id]=parents[parents[id]];id=parents[id];}return id;};
  let maximumRoundingError=0;
  for(let i=0;i<count;i++) {
    const exact=[0,1,2].map(d=>Number(properties[i*numProp+d])*scale+translation[d]);
    if(exact.some(v=>!Number.isFinite(v))) throw new Error('The mesh contains a non-finite coordinate.');
    const point=exact.map(Math.fround);if(point.some(v=>!Number.isFinite(v))) throw new Error('The mesh coordinates exceed the Float32 STL range.');
    transformed[i]=point;flat.set(point,i*3);maximumRoundingError=Math.max(maximumRoundingError,distance(exact,point));
  }
  const precision=exportPrecisionBudget(boundsOf(flat),{minFeature,maxDeviation});
  const mergeFrom=unindexed?[]:input.mergeFromVert||[],mergeTo=unindexed?[]:input.mergeToVert||[];
  if(mergeFrom.length!==mergeTo.length) throw new Error('The mesh has mismatched property-seam merge vectors.');
  let maximumMergeDisplacement=0;
  for(let i=0;i<mergeFrom.length;i++) {
    const a=Number(mergeFrom[i]),b=Number(mergeTo[i]);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=count||b>=count) throw new Error('The mesh contains an invalid property-seam vertex index.');
    const displacement=distance(transformed[a],transformed[b]);
    if(displacement>precision.allowedDeviation) throw new Error('A property seam would move exported geometry beyond its precision budget. Rebuild or recenter the source mesh.');
    maximumMergeDisplacement=Math.max(maximumMergeDisplacement,displacement);parents[find(a)]=find(b);
  }
  const points=[],map=new Map(),canonical=new Uint32Array(count);
  for(let i=0;i<count;i++) {
    const point=transformed[find(i)],key=point.join(',');let id=map.get(key);
    if(id===undefined) {id=points.length;map.set(key,id);points.push(point);}canonical[i]=id;
  }
  const indices=[],faces=new Set(),collinearCandidates=[];let degenerateTriangles=0,duplicateTriangles=0,opposedDuplicateTriangles=0;
  for(let i=0;i<rawIndices.length;i+=3) {
    const original=[Number(rawIndices[i]),Number(rawIndices[i+1]),Number(rawIndices[i+2])];
    if(original.some(id=>!Number.isInteger(id)||id<0||id>=count)) throw new Error('The mesh contains an out-of-range triangle vertex index.');
    let [a,b,c]=original.map(id=>canonical[id]);if(scale<0) [b,c]=[c,b];
    if(a===b||b===c||a===c) {degenerateTriangles++;continue;}
    if(triangleAreaSquared(points[a],points[b],points[c])===0) {degenerateTriangles++;collinearCandidates.push([a,b,c]);continue;}
    const key=orientedKey(a,b,c);if(faces.has(key)) {duplicateTriangles++;continue;}
    if(faces.has(orientedKey(a,c,b))) opposedDuplicateTriangles++;
    faces.add(key);indices.push(a,b,c);
  }
  if(!indices.length) throw new Error('All triangles collapse at Float32 STL precision. Recenter the model or increase its physical feature size.');
  const repairedCollinearJunctions=repairCollinearJunctions(points,indices,collinearCandidates);
  if(repairedCollinearJunctions) {
    const repairedFaces=new Set();opposedDuplicateTriangles=0;
    for(let i=0;i<indices.length;i+=3) {
      const [a,b,c]=indices.slice(i,i+3);
      if(repairedFaces.has(orientedKey(a,c,b))) opposedDuplicateTriangles++;
      repairedFaces.add(orientedKey(a,b,c));
    }
  }
  const stats=meshStatistics(points,indices);
  Object.assign(stats,{degenerateTriangles,duplicateTriangles,opposedDuplicateTriangles,repairedCollinearJunctions});
  const diagnostics={inputTriangles:rawIndices.length/3,inputVertices:count,exactWeldedVertices:count-points.length,
    propertySeams:mergeFrom.length,maximumRoundingError,maximumMergeDisplacement,repairedCollinearJunctions,precision};
  const warnings=[];
  if(degenerateTriangles>repairedCollinearJunctions) warnings.push(`Removed ${degenerateTriangles-repairedCollinearJunctions} mathematically zero-area triangles after Float32 conversion.`);
  if(repairedCollinearJunctions) warnings.push(`Retriangulated ${repairedCollinearJunctions} exactly collinear junctions without moving vertices or changing material.`);
  if(duplicateTriangles) warnings.push(`Removed ${duplicateTriangles} identically oriented duplicate triangles.`);
  if(maximumMergeDisplacement>0) warnings.push(`Canonicalized property seams with at most ${maximumMergeDisplacement.toPrecision(3)} mm displacement.`);
  if(precision.requiresRecentering) warnings.push(`The source coordinates are far from the origin relative to their detail. Float32 coordinate spacing is ${precision.coordinateSpacing.toPrecision(3)} mm; recentering preserves more precision.`);
  if(strict && maximumRoundingError>precision.allowedDeviation) throw new Error(`Float32 STL conversion would move vertices by ${maximumRoundingError.toPrecision(3)} mm, beyond the ${precision.allowedDeviation.toPrecision(3)} mm feature precision budget. Recenter the source near the origin before exporting.`);
  if(strict && (!stats.watertight||stats.inconsistentWindingEdges||opposedDuplicateTriangles||!(stats.volumeMm3>0))) {
    const error=new Error(`The actual Float32 STL coordinates are not a closed oriented solid (${stats.boundaryEdges} open edges, ${stats.nonManifoldEdges} non-manifold edges, ${stats.inconsistentWindingEdges} winding edges). Simplify numerical Boolean slivers within a bounded tolerance before export; no mesh parts were discarded.`);
    error.diagnostics={...diagnostics,...stats};throw error;
  }
  const positions=new Float32Array(indices.length*3);let cursor=0;
  for(const id of indices) {positions.set(points[id],cursor);cursor+=3;}
  return {positions,bounds:boundsOf(positions),stats,warnings,diagnostics};
}

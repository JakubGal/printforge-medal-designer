import { normalizeOptions, buildVoronoi, boundsOf, generateLattice, keepLargestComponent } from './lattice-engine.js';
import { scaleLatticeOptions } from './lattice-settings.js';
import { loadManifold } from './lattice-manifold.js';
import { buildSurfaceRodGraph } from './lattice-surface.js';
import { createJointMesh, createSweptRodMesh, createPolylineRodMeshes, pathNeedsSegmentUnion } from './lattice-rods.js';
import { canonicalizeFloat32Mesh } from './lattice-validate.js';

const MAX_RODS = 16000;
const MAX_TRIANGLES = 1500000;
const add = (a,b) => a.map((v,d)=>v+b[d]);
const sub = (a,b) => a.map((v,d)=>v-b[d]);

function normalizedSource(mesh) {
  const span = Math.max(...mesh.bounds.size);
  const factor = 40 / span;
  const center = mesh.bounds.min.map((v,d)=>v+mesh.bounds.size[d]/2);
  const positions = Float32Array.from(mesh.positions,(v,i)=>(v-center[i%3])*factor);
  return { mesh: { ...mesh, positions, bounds: boundsOf(positions) }, center, factor };
}

function indexedMesh(positions) {
  const vertices = [], indices = [], lookup = new Map();
  for(let i=0;i<positions.length;i+=3) {
    const p = Array.from(positions.subarray(i,i+3)), key=p.join(',');
    let id=lookup.get(key);
    if(id===undefined) { id=vertices.length/3; lookup.set(key,id); vertices.push(...p); }
    indices.push(id);
  }
  return { numProp:3, vertProperties:Float32Array.from(vertices), triVerts:Uint32Array.from(indices) };
}

function clipSegment(a,b,bounds,padding) {
  let low=0,high=1;
  const delta=sub(b,a);
  for(let d=0;d<3;d++) {
    const min=bounds.min[d]-padding,max=bounds.max[d]+padding;
    if(Math.abs(delta[d])<1e-14) { if(a[d]<min || a[d]>max) return null; continue; }
    const near=(min-a[d])/delta[d],far=(max-a[d])/delta[d];
    low=Math.max(low,Math.min(near,far)); high=Math.min(high,Math.max(near,far));
    if(low>=high) return null;
  }
  return [add(a,delta.map(v=>v*low)),add(a,delta.map(v=>v*high))];
}

function volumeGraph(voronoi,bounds,options) {
  const nodes=[],edges=[],lookup=new Map(),seen=new Set();
  const tolerance=Math.max(...bounds.size)*1e-7;
  const node=p=>{
    const key=p.map(v=>Math.round(v/tolerance)).join(',');
    let id=lookup.get(key);
    if(id===undefined) { id=nodes.length; lookup.set(key,id); nodes.push(p); }
    return id;
  };
  const padding=options.thickness*Math.max(1,options.rodAspect)*(1+Math.abs(options.gradientStrength));
  for(const edge of voronoi.edges) {
    const clipped=clipSegment(edge.a,edge.b,bounds,padding);
    if(!clipped) continue;
    const a=node(clipped[0]),b=node(clipped[1]);
    if(a===b) continue;
    const key=a<b?`${a}:${b}`:`${b}:${a}`;
    if(!seen.has(key)) { seen.add(key); edges.push([a,b]); }
  }
  return {nodes,edges,polylines:edges,stats:{},warnings:[]};
}

/** Explicit swept rods, fused with robust mesh Booleans; no voxel skin slicing. */
export async function generateRodLattice(source,inputOptions={},onProgress=()=>{}) {
  const started=performance.now();
  if(!(source?.positions instanceof Float32Array) || !source.stats?.watertight) throw new Error('Upload a closed, manifold STL before generating connected rods.');
  if(source.stats.inconsistentWindingEdges) throw new Error('The STL has inconsistent triangle orientation. Repair its face normals before generating fused rods.');
  const options=normalizeOptions(inputOptions,source.bounds);
  if(!['surface','struts'].includes(options.mode)) throw new Error('Connected rods are available for Surface rods and 3D struts.');
  const normalized=normalizedSource(source), mesh=normalized.mesh;
  const localOptions={...scaleLatticeOptions(options,normalized.factor),surfaceInset:options.surfaceInset*normalized.factor};
  const warnings=[];
  onProgress(.01,'Loading the solid geometry kernel…');
  const kernel=await loadManifold(), {Manifold,Mesh}=kernel;
  const live=new Set();
  const own=solid=>{ live.add(solid); return solid; };
  const release=solid=>{ if(live.delete(solid)) solid.delete(); };
  const checked=solid=>{
    if(solid.status()!=='NoError') throw new Error(`Solid geometry failed (${solid.status()}). Try a different pattern seed or a thicker rod profile.`);
    return solid;
  };
  const fromMesh=data=>{
    const input=new Mesh(data); input.merge();
    return checked(own(new Manifold(input)));
  };
  const fuse=(solids,start,end)=>{
    let current=solids;
    while(current.length>1) {
      const next=[];
      for(let i=0;i<current.length;i+=24) {
        const group=current.slice(i,i+24);
        if(group.length===1) { next.push(group[0]); continue; }
        const merged=checked(own(Manifold.union(group)));
        if(merged.numTri()>MAX_TRIANGLES*2) throw new Error('The rod network is too detailed for this browser. Increase cell size or choose Draft quality.');
        group.forEach(release); next.push(merged);
        onProgress(start+(end-start)*(i+group.length)/current.length,'Fusing rod connections…');
      }
      current=next;
    }
    return current[0];
  };
  try {
    let sourceSolid=fromMesh(indexedMesh(mesh.positions));
    if(sourceSolid.volume()<0) {
      for(let i=0;i<mesh.positions.length;i+=9) for(let d=0;d<3;d++) [mesh.positions[i+3+d],mesh.positions[i+6+d]]=[mesh.positions[i+6+d],mesh.positions[i+3+d]];
      release(sourceSolid); sourceSolid=fromMesh(indexedMesh(mesh.positions));
    }
    const sourceVolumeMm3=sourceSolid.volume()/normalized.factor**3;
    const patternWarnings=[];
    const voronoi=buildVoronoi(mesh.bounds,localOptions,patternWarnings,(p,message)=>onProgress(.03+p*.7,message));
    warnings.push(...patternWarnings.filter(message=>!message.startsWith('Cell size increased')));
    if(voronoi.effectiveCellSize>localOptions.cellSize*1.01) warnings.push(`Cell size increased from ${options.cellSize.toPrecision(3)} to ${(voronoi.effectiveCellSize/normalized.factor).toPrecision(3)} mm to fit the browser site budget.`);
    const graph=options.mode==='surface'
      ? buildSurfaceRodGraph(mesh,voronoi,{...localOptions,simplificationTolerance:Math.min(localOptions.thickness*.06,localOptions.cellSize*.005)*(options.quality==='fine'?.5:1)},(p,message)=>onProgress(.25+p*.03,message))
      : volumeGraph(voronoi,mesh.bounds,localOptions);
    warnings.push(...(graph.warnings||[]));
    if(!graph.edges.length) throw new Error('No rod paths cross this source. Reduce cell size or choose another pattern seed.');
    if(graph.edges.length>MAX_RODS) throw new Error(`This pattern needs ${graph.edges.length.toLocaleString()} rod segments. Increase cell size or choose Draft quality to stay within ${MAX_RODS.toLocaleString()} segments.`);
    const graphPoints=graph.nodes.map((p,i)=> options.mode==='surface' && localOptions.surfaceInset>0
      ? p.map((v,d)=>v-(graph.nodeNormals?.[i]?.[d]||0)*localOptions.surfaceInset) : p);
    const axis=['x','y','z'].indexOf(options.gradientAxis);
    const widthAt=p=>localOptions.thickness*(axis<0?1:1+localOptions.gradientStrength*(2*Math.max(0,Math.min(1,(p[axis]-mesh.bounds.min[axis])/mesh.bounds.size[axis]))-1));
    const incident=graphPoints.map(()=>[]),solids=[];
    const paths=graph.polylines?.length?graph.polylines:graph.edges;
    let rodCount=0,segmentedPaths=0;
    for(const path of paths) {
      const points=path.map(id=>graphPoints[id]);
      if(points.length<2) continue;
      const normals=graph.nodeNormals?path.map(id=>graph.nodeNormals[id]):undefined;
      const widths=points.map(widthAt);
      if(pathNeedsSegmentUnion(points,localOptions,widths,normals)) {
        // Tight bends can fold a continuous loft through itself. Fuse closed
        // segments there, while ordinary curves retain their shared rings.
        const segments=createPolylineRodMeshes(points,{...localOptions,widths},{normals,buildJoints:false});
        for(let i=0;i<segments.rods.length;i++) {
          const rod=segments.rods[i];solids.push(fromMesh(rod));
          incident[path[i]].push(rod.startRing);incident[path[i+1]].push(rod.endRing);
        }
        segmentedPaths++;
      } else {
        const rod=createSweptRodMesh(points,{...localOptions,widths},{normals});
        solids.push(fromMesh(rod));
        if(path[0]!==path.at(-1)) {
          incident[path[0]].push(rod.startRing);
          incident[path.at(-1)].push(rod.endRing);
        }
      }
      rodCount+=points.length-1;
      onProgress(.28+.18*rodCount/graph.edges.length,`Sweeping ${options.rodProfile} rod profiles (${rodCount.toLocaleString()})…`);
    }
    for(let id=0;id<incident.length;id++) {
      const rings=incident[id].filter(Boolean);
      if(rings.length<2) continue;
      // A small joint overlap avoids surfaces meeting only tangentially at a
      // profile corner. The envelope grows by 1% locally, not along the rods.
      const jointRings=rings.map(ring=>ring.map(p=>p.map((v,d)=>graphPoints[id][d]+(v-graphPoints[id][d])*1.01)));
      const joint=createJointMesh(graphPoints[id],{...localOptions,thickness:widthAt(graphPoints[id])},{rings:jointRings});
      if(joint?.triVerts?.length) solids.push(fromMesh(joint));
    }
    let result=fuse(solids,.47,.76);
    if(options.mode==='struts') {
      onProgress(.78,'Trimming the internal rods to the source solid…');
      const trimmed=checked(own(result.intersect(sourceSolid))); release(result); result=trimmed;
    }
    let regionVoxelSize=null;
    if(options.shellThickness>0 || options.bottomThickness>0 || options.topThickness>0) {
      onProgress(.80,'Building the optional shell and solid regions…');
      const regions=generateLattice(mesh,{...localOptions,mode:'struts',keepLargest:false},(p,message)=>onProgress(.80+p*.10,message),{solidRegionsOnly:true});
      const regionSolid=fromMesh(indexedMesh(regions.positions));
      const combined=checked(own(result.add(regionSolid))); release(result); release(regionSolid); result=combined;
      regionVoxelSize=regions.stats.voxelSize/normalized.factor;
      warnings.push('The optional shell uses sampled geometry; the rods themselves use explicit swept profiles.');
    }
    if(result.isEmpty()) throw new Error('This pattern leaves no rods inside the source. Reduce cell size or increase rod width.');
    onProgress(.94,'Validating the fused rod mesh…');
    const flattened=checked(own(result.asOriginal()));
    release(result);result=flattened;
    if(result.numTri()>MAX_TRIANGLES) throw new Error('The fused rods exceed 1.5 million triangles. Increase cell size or choose a lower quality.');
    const minimumWidth=localOptions.thickness*(axis<0?1:1-Math.abs(localOptions.gradientStrength))*Math.min(1,options.rodProfile==='rectangle'?options.rodAspect:1);
    const baseTolerance=Math.min(Math.max(...mesh.bounds.size)*1e-5,minimumWidth*.001);
    const maximumTolerance=Math.min(Math.max(...mesh.bounds.size)*1e-4,minimumWidth*.005);
    let inspected,validationError,exportTolerance=baseTolerance;
    // Boolean intersections can leave features smaller than STL Float32
    // spacing. Simplify only within a measured fraction of the rod width,
    // validating the exact exported coordinates after each bounded attempt.
    for(const multiplier of [1,2,4,8,16]) {
      exportTolerance=Math.min(baseTolerance*multiplier,maximumTolerance);
      const candidate=checked(own(result.setTolerance(exportTolerance)));
      try {
        inspected=canonicalizeFloat32Mesh(candidate.getMesh(),{scale:1/normalized.factor,translation:normalized.center,minFeature:minimumWidth/normalized.factor});
        validationError=null;
      } catch(error) {validationError=error;}
      release(candidate);
      if(inspected || exportTolerance===maximumTolerance) break;
    }
    if(!inspected) throw validationError;
    const validationDiagnostics=inspected.diagnostics;
    let discardedComponents=0;
    if(options.keepLargest && inspected.stats.components>1) {
      const data=indexedMesh(inspected.positions);
      const points=Array.from({length:data.vertProperties.length/3},(_,i)=>Array.from(data.vertProperties.subarray(i*3,i*3+3)));
      const kept=keepLargestComponent(points,Array.from(data.triVerts));
      discardedComponents=kept.discardedComponents;
      inspected=canonicalizeFloat32Mesh({...data,triVerts:Uint32Array.from(kept.indices)},{minFeature:minimumWidth/normalized.factor});
    }
    const stats=inspected.stats;
    if(discardedComponents) warnings.push(`Kept the largest solid and removed ${discardedComponents} detached pieces.`);
    if(stats.components>1) warnings.push(`The result contains ${stats.components} disconnected solid components. Reduce cell size or increase rod width to connect more of the model, or enable “Keep largest”.`);
    Object.assign(stats,{sourceVolumeMm3,relativeDensity:stats.volumeMm3/sourceVolumeMm3,sourceVolumeIsEstimate:false,
      meshingMethod:'explicit-rods',rodCount,segmentedPaths,junctionCount:incident.filter(rings=>rings.length>2).length,
      siteCount:voronoi.sites.length,effectiveCellSize:voronoi.effectiveCellSize/normalized.factor,
      voxelSize:regionVoxelSize,regionVoxelSize,gridNodes:0,discardedComponents,generationMs:performance.now()-started});
    stats.exportToleranceMm=exportTolerance/normalized.factor;
    stats.exportDiagnostics=validationDiagnostics;
    onProgress(1,'Connected rods ready');
    return {...inspected,stats,warnings,options:{...options,effectiveCellSize:stats.effectiveCellSize,effectiveResolution:regionVoxelSize}};
  } finally { for(const solid of live) solid.delete(); }
}

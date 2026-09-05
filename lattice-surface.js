/** Exact intersections of Voronoi cell faces with an STL surface.
 * The output is a curve graph, never cell-face panels or a sampled shell.
 * Closed source cavities are separate surface graphs. Coordinates use the
 * source's existing units; no unit conversion or inward offset is applied.
 */

const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length2 = a => dot(a,a);
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const normalize = value => {const length=Math.hypot(...value);return length?value.map(v=>v/length):[0,0,1];};
const pointKey = (p,tolerance) => p.map(value=>Math.floor(value/tolerance)).join(',');

function spatialWelder(tolerance) {
  const bins=new Map(),points=[],normalSums=[];
  return {
    points,normalSums,
    add(point,normal) {
      const base=point.map(value=>Math.floor(value/tolerance));
      let found=-1,best=tolerance*tolerance;
      for(let z=-1;z<=1;z++) for(let y=-1;y<=1;y++) for(let x=-1;x<=1;x++) {
        const ids=bins.get(`${base[0]+x},${base[1]+y},${base[2]+z}`);
        if(!ids) continue;
        for(const id of ids) {const distance=length2(sub(points[id],point));if(distance<=best) {best=distance;found=id;}}
      }
      if(found<0) {
        found=points.length;points.push(point);normalSums.push([0,0,0]);
        const key=base.join(',');if(!bins.has(key)) bins.set(key,[]);bins.get(key).push(found);
      }
      for(let d=0;d<3;d++) normalSums[found][d]+=normal[d];
      return found;
    },
  };
}

function buildTriangleTree(positions) {
  const count=positions.length/9;
  const triangleBounds=Array.from({length:count},(_,i)=>{
    const t=i*9,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let c=0;c<9;c+=3) for(let d=0;d<3;d++) {min[d]=Math.min(min[d],positions[t+c+d]);max[d]=Math.max(max[d],positions[t+c+d]);}
    return {min,max};
  });
  const build=ids=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const id of ids) for(let d=0;d<3;d++) {min[d]=Math.min(min[d],triangleBounds[id].min[d]);max[d]=Math.max(max[d],triangleBounds[id].max[d]);}
    if(ids.length<=10) return {min,max,ids};
    const spans=max.map((v,d)=>v-min[d]),axis=spans.indexOf(Math.max(...spans));
    ids.sort((a,b)=>triangleBounds[a].min[axis]+triangleBounds[a].max[axis]-triangleBounds[b].min[axis]-triangleBounds[b].max[axis]);
    const half=Math.floor(ids.length/2);
    return {min,max,left:build(ids.slice(0,half)),right:build(ids.slice(half))};
  };
  return build(Array.from({length:count},(_,i)=>i));
}

function planeRange(plane,min,max) {
  let low=-plane.offset,high=-plane.offset;
  for(let d=0;d<3;d++) {
    const n=plane.normal[d];
    low+=n*(n>=0?min[d]:max[d]);high+=n*(n>=0?max[d]:min[d]);
  }
  return [low,high];
}

function clipPolygon(polygon,plane,epsilon) {
  const result=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset;
    if(da<=epsilon) result.push(a);
    if((da>epsilon && db<-epsilon) || (da<-epsilon && db>epsilon)) {
      const t=da/(da-db);result.push(a.map((v,d)=>v+(b[d]-v)*t));
    }
  }
  return result;
}

function faceWithinBounds(plane,planes,bounds,epsilon) {
  const {min,max}=bounds;
  const vertices=[[min[0],min[1],min[2]],[max[0],min[1],min[2]],[max[0],max[1],min[2]],[min[0],max[1],min[2]],[min[0],min[1],max[2]],[max[0],min[1],max[2]],[max[0],max[1],max[2]],[min[0],max[1],max[2]]];
  const intersections=[];
  const add=p=>{if(!intersections.some(q=>length2(sub(p,q))<=epsilon*epsilon)) intersections.push(p);};
  for(const [i,j] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    const a=vertices[i],b=vertices[j],da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset;
    if(Math.abs(da)<=epsilon) add(a);if(Math.abs(db)<=epsilon) add(b);
    if(da*db<0) {const t=da/(da-db);add(a.map((v,d)=>v+(b[d]-v)*t));}
  }
  if(intersections.length<3) return null;
  const center=intersections.reduce((sum,p)=>sum.map((v,d)=>v+p[d]/intersections.length),[0,0,0]);
  const reference=Math.abs(plane.normal[0])<0.8?[1,0,0]:[0,1,0];
  const u=cross(plane.normal,reference),v=cross(plane.normal,u);
  intersections.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
  let polygon=intersections;
  for(const constraint of planes) {polygon=clipPolygon(polygon,constraint,epsilon);if(polygon.length<3) return null;}
  let area=0;
  for(let i=1;i<polygon.length-1;i++) area+=Math.abs(dot(plane.normal,cross(sub(polygon[i],polygon[0]),sub(polygon[i+1],polygon[0]))))/2;
  if(area<=epsilon*epsilon) return null;
  return {min:[0,1,2].map(d=>Math.min(...polygon.map(p=>p[d]))-epsilon),max:[0,1,2].map(d=>Math.max(...polygon.map(p=>p[d]))+epsilon)};
}

function intersectTriangle(positions,id,plane,epsilon) {
  const t=id*9,p=[Array.from(positions.subarray(t,t+3)),Array.from(positions.subarray(t+3,t+6)),Array.from(positions.subarray(t+6,t+9))];
  const distances=p.map(point=>dot(plane.normal,point)-plane.offset);
  if(distances.every(value=>Math.abs(value)<=epsilon)) return {coplanar:true};
  if(distances.every(value=>value>epsilon) || distances.every(value=>value<-epsilon)) return null;
  const found=[];
  const add=point=>{if(!found.some(q=>length2(sub(point,q))<=epsilon*epsilon)) found.push(point);};
  for(let i=0;i<3;i++) {
    const j=(i+1)%3,da=distances[i],db=distances[j];
    if(Math.abs(da)<=epsilon) add(p[i]);
    if((da>epsilon && db<-epsilon) || (da<-epsilon && db>epsilon)) {const ratio=da/(da-db);add(p[i].map((v,d)=>v+(p[j][d]-v)*ratio));}
  }
  if(found.length<2) return null;
  let a=found[0],b=found[1],longest=length2(sub(a,b));
  for(let i=0;i<found.length;i++) for(let j=i+1;j<found.length;j++) {const distance=length2(sub(found[i],found[j]));if(distance>longest) {a=found[i];b=found[j];longest=distance;}}
  if(longest<=epsilon*epsilon) return null;
  return {a,b,normal:normalize(cross(sub(p[1],p[0]),sub(p[2],p[0])))};
}

function clipSegment(segment,planes,epsilon) {
  const delta=sub(segment.b,segment.a);let low=0,high=1;
  for(const plane of planes) {
    const start=dot(plane.normal,segment.a)-plane.offset,slope=dot(plane.normal,delta);
    if(Math.abs(slope)<=epsilon) {if(start>epsilon) return null;continue;}
    const t=-start/slope;
    if(slope>0) high=Math.min(high,t);else low=Math.max(low,t);
    if(low>high) return null;
  }
  low=clamp(low,0,1);high=clamp(high,0,1);
  const a=segment.a.map((v,d)=>v+delta[d]*low),b=segment.a.map((v,d)=>v+delta[d]*high);
  return length2(sub(a,b))>epsilon*epsilon?{a,b,normal:segment.normal}:null;
}

function inferNeighbor(site,plane,siteBins,sites,tolerance) {
  const distance=plane.offset-dot(plane.normal,site),mirror=site.map((v,d)=>v+2*distance*plane.normal[d]),base=mirror.map(v=>Math.floor(v/tolerance));
  let found=-1,best=tolerance*tolerance*4;
  for(let z=-1;z<=1;z++) for(let y=-1;y<=1;y++) for(let x=-1;x<=1;x++) {
    const ids=siteBins.get(`${base[0]+x},${base[1]+y},${base[2]+z}`);
    if(ids) for(const id of ids) {const distance2=length2(sub(sites[id],mirror));if(distance2<best) {best=distance2;found=id;}}
  }
  return found;
}

function pointSegmentDistance2(p,a,b) {
  const delta=sub(b,a),length=length2(delta),t=length?clamp(dot(sub(p,a),delta)/length,0,1):0;
  return length2(p.map((v,d)=>v-a[d]-delta[d]*t));
}

function simplifyOpen(path,points,tolerance) {
  if(path.length<=2 || tolerance<=0) return path;
  const keep=new Uint8Array(path.length);keep[0]=1;keep[path.length-1]=1;
  const stack=[[0,path.length-1]],threshold=tolerance*tolerance;
  while(stack.length) {
    const [start,end]=stack.pop();let furthest=-1,best=threshold;
    for(let i=start+1;i<end;i++) {const distance=pointSegmentDistance2(points[path[i]],points[path[start]],points[path[end]]);if(distance>best) {best=distance;furthest=i;}}
    if(furthest>=0) {keep[furthest]=1;stack.push([start,furthest],[furthest,end]);}
  }
  return path.filter((_,i)=>keep[i]);
}

function tracePolylines(points,edges) {
  const adjacency=Array.from({length:points.length},()=>[]);
  edges.forEach(([a,b],id)=>{adjacency[a].push(id);adjacency[b].push(id);});
  const visited=new Uint8Array(edges.length),paths=[];
  const walk=(start,edge)=>{
    const path=[start];let current=start;
    while(!visited[edge]) {
      visited[edge]=1;const [a,b]=edges[edge],next=a===current?b:a;path.push(next);
      if(next===start || adjacency[next].length!==2) break;
      const available=adjacency[next].find(id=>!visited[id]);if(available===undefined) break;
      current=next;edge=available;
    }
    return path;
  };
  for(let node=0;node<points.length;node++) if(adjacency[node].length!==2) for(const edge of adjacency[node]) if(!visited[edge]) paths.push(walk(node,edge));
  for(let edge=0;edge<edges.length;edge++) if(!visited[edge]) paths.push(walk(edges[edge][0],edge));
  return {paths,adjacency};
}

function simplifyPaths(paths,points,tolerance) {
  return paths.map(path=>{
    if(path[0]!==path[path.length-1]) return simplifyOpen(path,points,tolerance);
    if(path.length<=4) return path;
    let split=1,farthest=0;
    for(let i=1;i<path.length-1;i++) {const distance=length2(sub(points[path[i]],points[path[0]]));if(distance>farthest) {farthest=distance;split=i;}}
    const a=simplifyOpen(path.slice(0,split+1),points,tolerance),b=simplifyOpen(path.slice(split),points,tolerance);
    const result=[...a,...b.slice(1)];return result.length>=4?result:path;
  });
}

/**
 * @param {{positions:Float32Array,bounds:{min:number[],max:number[],size:number[]}}} mesh
 * @param {{sites:number[][],cells:{site?:number[],planes:{normal:number[],offset:number,neighbor?:number}[]}[]}} voronoi
 * @param {{cellSize?:number,thickness?:number,simplificationTolerance?:number,maxSurfaceSegments?:number}} options
 * @returns {{nodes:number[][],nodeNormals:number[][],edges:number[][],polylines:number[][],stats:object,warnings:string[]}}
 */
export function buildSurfaceRodGraph(mesh,voronoi,options={},onProgress=()=>{}) {
  const started=typeof performance==='undefined'?Date.now():performance.now();
  if(!(mesh?.positions instanceof Float32Array) || !mesh.bounds || mesh.positions.length%9) throw new Error('Surface rods require an STL triangle mesh with valid bounds.');
  if(!voronoi?.sites?.length || voronoi.cells?.length!==voronoi.sites.length) throw new Error('Surface rods require matching Voronoi sites and clipped cells.');
  const span=Math.max(...mesh.bounds.size),epsilon=span*1e-9,weldTolerance=span*1e-7;
  const thickness=Number(options.thickness)>0?Number(options.thickness):span*0.0375,cellSize=Number(options.cellSize)>0?Number(options.cellSize):span/5;
  const defaultTolerance=Math.min(thickness*0.06,cellSize*0.005);
  const simplificationTolerance=options.simplificationTolerance===0?0:clamp(Number(options.simplificationTolerance)||defaultTolerance,0,defaultTolerance);
  const maxSegments=clamp(Math.floor(Number(options.maxSurfaceSegments)||10000),1,50000),warnings=[];
  const siteBins=new Map(),siteTolerance=span*1e-6;
  voronoi.sites.forEach((site,id)=>{const key=pointKey(site,siteTolerance);if(!siteBins.has(key)) siteBins.set(key,[]);siteBins.get(key).push(id);});
  const faces=[],seenFaces=new Set();
  for(let i=0;i<voronoi.cells.length;i++) {
    const cell=voronoi.cells[i];
    for(const original of cell.planes) {
      const magnitude=Math.hypot(...original.normal);
      if(!(magnitude>0) || !Number.isFinite(original.offset)) throw new Error('A Voronoi cell contains an invalid face plane.');
      const plane={normal:original.normal.map(v=>v/magnitude),offset:original.offset/magnitude};
      const neighbor=Number.isInteger(original.neighbor)?original.neighbor:inferNeighbor(voronoi.sites[i],plane,siteBins,voronoi.sites,siteTolerance);
      if(neighbor<0 || neighbor===i) continue;
      const key=`${Math.min(i,neighbor)},${Math.max(i,neighbor)}`;
      if(seenFaces.has(key)) continue;seenFaces.add(key);
      const range=planeRange(plane,mesh.bounds.min,mesh.bounds.max);if(range[0]>epsilon || range[1]<-epsilon) continue;
      const bounds=faceWithinBounds(plane,cell.planes,mesh.bounds,epsilon);if(bounds) faces.push({plane,planes:cell.planes,bounds});
    }
  }
  onProgress(0.05,'Indexing source triangles for surface rods');
  const tree=buildTriangleTree(mesh.positions),welder=spatialWelder(weldTolerance),rawEdges=[],edgeKeys=new Set();
  let coplanarTriangles=0,intersectedFaces=0,triangleTests=0;
  for(let faceId=0;faceId<faces.length;faceId++) {
    const face=faces[faceId],before=rawEdges.length;
    const visit=node=>{
      if(node.min.some((v,d)=>v>face.bounds.max[d] || node.max[d]<face.bounds.min[d])) return;
      const [low,high]=planeRange(face.plane,node.min,node.max);if(low>epsilon || high<-epsilon) return;
      if(!node.ids) {visit(node.left);visit(node.right);return;}
      for(const id of node.ids) {
        triangleTests++;const intersection=intersectTriangle(mesh.positions,id,face.plane,epsilon);
        if(intersection?.coplanar) {coplanarTriangles++;continue;}
        if(!intersection) continue;
        const segment=clipSegment(intersection,face.planes,epsilon);if(!segment) continue;
        const a=welder.add(segment.a,segment.normal),b=welder.add(segment.b,segment.normal);if(a===b) continue;
        const key=a<b?`${a},${b}`:`${b},${a}`;if(edgeKeys.has(key)) continue;edgeKeys.add(key);rawEdges.push([a,b]);
        if(rawEdges.length>300000) throw new Error('The surface graph exceeds 300,000 raw segments. Increase cell size or simplify the source STL.');
      }
    };
    visit(tree);if(rawEdges.length>before) intersectedFaces++;
    if(faceId%16===0) onProgress(0.05+0.8*(faceId+1)/faces.length,`Intersecting Voronoi faces with the source (${faceId+1}/${faces.length})`);
  }
  if(!rawEdges.length) throw new Error('No Voronoi boundaries cross this surface. Reduce cell size or change the pattern seed.');
  onProgress(0.9,'Stitching surface curves and retaining junctions');
  const {paths}=tracePolylines(welder.points,rawEdges),simplified=simplifyPaths(paths,welder.points,simplificationTolerance);
  const nodes=[],nodeNormals=[],mapping=new Map(),edges=[],polylines=[],finalEdgeKeys=new Set();
  const remap=id=>{let mapped=mapping.get(id);if(mapped===undefined) {mapped=nodes.length;mapping.set(id,mapped);nodes.push(welder.points[id]);nodeNormals.push(normalize(welder.normalSums[id]));}return mapped;};
  for(const path of simplified) {
    const mapped=path.map(remap);polylines.push(mapped);
    for(let i=1;i<mapped.length;i++) {const a=mapped[i-1],b=mapped[i];if(a===b) continue;const key=a<b?`${a},${b}`:`${b},${a}`;if(!finalEdgeKeys.has(key)) {finalEdgeKeys.add(key);edges.push([a,b]);}}
  }
  if(edges.length>maxSegments) throw new Error(`The surface needs ${edges.length.toLocaleString()} rod segments, above the ${maxSegments.toLocaleString()}-segment limit. Increase cell size or rod thickness, or simplify the STL.`);
  const {adjacency}=tracePolylines(nodes,edges),visited=new Uint8Array(nodes.length);let components=0;
  for(let i=0;i<nodes.length;i++) if(!visited[i]) {components++;const stack=[i];visited[i]=1;while(stack.length) {const a=stack.pop();for(const id of adjacency[a]) {const edge=edges[id],b=edge[0]===a?edge[1]:edge[0];if(!visited[b]) {visited[b]=1;stack.push(b);}}}}
  if(coplanarTriangles) warnings.push('Some Voronoi faces coincide with flat STL faces; only their boundary curves are used. Change cell irregularity or the seed to avoid this coincidence.');
  if(mesh.stats?.inconsistentWindingEdges) warnings.push('Surface profile normals follow the STL triangle winding, which is inconsistent in this source. Repair its orientation before using an inward offset.');
  const stats={nodes:nodes.length,edges:edges.length,polylines:polylines.length,junctions:adjacency.filter(list=>list.length>2).length,endpoints:adjacency.filter(list=>list.length===1).length,components,faceCount:faces.length,intersectedFaces,rawSegments:rawEdges.length,triangleTests,coplanarTriangles,totalLengthMm:edges.reduce((sum,[a,b])=>sum+Math.hypot(...sub(nodes[a],nodes[b])),0),simplificationTolerance,weldTolerance,buildMs:(typeof performance==='undefined'?Date.now():performance.now())-started};
  onProgress(1,'Surface rod graph ready');
  return {nodes,nodeNormals,edges,polylines,stats,warnings};
}

/**
 * Glacier contour editor terrain calculations.
 * Canvas model coordinates: 0..1000 (left to right), 0..600 (north to south).
 * All height values in meters. The editor outputs a terrain sampled on a regular grid.
 */
export const MAP_W=1000, MAP_H=600;
export const NX=161, NY=97;
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export function createEmpty(){
 return {version:1,title:'我的冰河地形',west:1800,east:600,interval:100,vertical:1.5,features:[]};
}
function ellipse(cx,cy,rx,ry,n=70,phase=0){
 const pts=[];
 for(let k=0;k<n;k++){
  const a=2*Math.PI*k/n;
  pts.push([clamp(cx+rx*Math.cos(a)*(1+.07*Math.sin(3*a+phase)),2,998),clamp(cy+ry*Math.sin(a)*(1+.06*Math.cos(2*a+phase)),2,598)]);
 }
 return pts;
}
function line(points,elevation,closed=false,label=''){
 return {id:`f${Math.random().toString(36).slice(2,10)}`,kind:'line',elevation,closed,points,label};
}
function point(x,y,elevation,label=''){
 return {id:`f${Math.random().toString(36).slice(2,10)}`,kind:'point',elevation,x,y,label};
}
export function createDemo(){
 const d=createEmpty();
 d.title='冰河地景示範（虛構）';d.west=2250;d.east=600;d.interval=100;d.vertical=1.6;
 // Horn mountain with multiple elevation control rings
 const rings=[ [155,165,2200],[128,135,2325],[101,106,2450],[72,77,2600],[40,45,2725] ];
 for(const [rx,ry,z] of rings) d.features.push(line(ellipse(212,232,rx,ry),z,true,`主峰等高線 ${z}m`));
 d.features.push(point(212,227,2880,'角峰高程點'));
 // Shoulder ridge and three basin points
 d.features.push(line([[244,199],[291,187],[330,198],[361,225]],2530,false,'稜線控制線'));
 d.features.push(point(360,124,1900,'冰斗控制點'));
 d.features.push(point(312,417,1930,'冰斗控制點'));
 d.features.push(point(90,403,2110,'冰斗控制點'));
 // Glacial trough: progressive thalweg from mountains eastwards
 for(const [x,y,z] of [[350,305,1650],[423,316,1490],[498,330,1370],[570,336,1240],[642,337,1100]])
  d.features.push(point(x,y,z,'冰槽谷底控制點'));
 // Lateral upper slopes of trough
 d.features.push(line([[365,220],[420,238],[494,246],[568,253]],1900,false,'冰槽北側坡肩'));
 d.features.push(line([[359,420],[433,416],[501,424],[564,436]],1890,false,'冰槽南側坡肩'));
 // Arcuate moraine crest
 d.features.push(line([[656,224],[674,254],[686,295],[694,344],[680,398],[657,447]],1260,false,'端磧脊頂'));
 // Drumlins, basal slope 900-1050, tops around 1100
 for(const [x,y,rx,ry,z] of [[751,261,34,14,1130],[773,359,43,17,1100],[813,298,32,12,1045],[827,410,38,15,1030]]){
  const lower=z-55;
  d.features.push(line(ellipse(x,y,rx,ry,35),lower,true,'鼓丘外緣'));
  d.features.push(point(x-8,y,z,'鼓丘頂'));
 }
 // Curved esker crest, not part of the main glacier moraine
 d.features.push(line([[705,507],[737,492],[762,520],[793,509],[818,532],[848,515]],1030,false,'蛇丘脊線'));
 // aeolian dune crests on lower terrain
 for(const [x,y,z] of [[899,235,890],[936,355,840],[896,456,865],[972,498,780]]){
  d.features.push(line(ellipse(x,y,19,28,35),z-45,true,'沙丘外緣'));
  d.features.push(point(x,y,z,'沙丘頂'));
 }
 return d;
}

export function validateProject(raw){
 if(!raw || !Array.isArray(raw.features))throw Error('專案缺少 features。');
 const d={...createEmpty(),...raw};
 for(const k of ['west','east','interval','vertical']){
  d[k]=Number(d[k]);if(!Number.isFinite(d[k]))throw Error(`數值錯誤：${k}`);
 }
 d.interval=clamp(d.interval,10,1000);d.vertical=clamp(d.vertical,0.2,8);
 if(d.features.length>500)throw Error('圖徵數量過多，請先刪除部分資料。');
 d.features=d.features.map((f,i)=>{
  const z=Number(f.elevation);
  if(!Number.isFinite(z)||Math.abs(z)>20000)throw Error(`第 ${i+1} 個圖徵高程錯誤。`);
  if(f.kind==='point'){
   if(!Number.isFinite(+f.x)||!Number.isFinite(+f.y))throw Error('控制點座標錯誤。');
   return {id:String(f.id||`i${i}`),kind:'point',x:clamp(+f.x,0,MAP_W),y:clamp(+f.y,0,MAP_H),elevation:z,label:String(f.label||'')};
  }
  if(f.kind!=='line'||!Array.isArray(f.points)||f.points.length<2||f.points.length>8000)throw Error('等高線資料不正確。');
  return {id:String(f.id||`i${i}`),kind:'line',closed:Boolean(f.closed),elevation:z,
   points:f.points.map(p=>[clamp(Number(p[0]),0,MAP_W),clamp(Number(p[1]),0,MAP_H)]),label:String(f.label||'')};
 });
 return d;
}

export function computeTerrain(doc,nx=NX,ny=NY){
 const length=nx*ny, heights=new Float32Array(length), fixed=new Uint8Array(length), vals=new Float32Array(length);
 let collisions=0;
 const baseline = x => doc.west+(doc.east-doc.west)*(x/(nx-1));
 const assign=(ix,iy,z,priority=false)=>{
  ix=clamp(ix,0,nx-1);iy=clamp(iy,0,ny-1);
  const i=iy*nx+ix;
  if(fixed[i] && Math.abs(vals[i]-z)>30 && !priority)collisions++;
  if(!fixed[i]||priority){ fixed[i]=1; vals[i]=z;heights[i]=z; }
 };
 // Edge values are a transparent boundary assumption, not measured topography.
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=y*nx+x;
  heights[i]=baseline(x);
  if(x===0||x===nx-1||y===0||y===ny-1){fixed[i]=1; vals[i]=heights[i];}
 }
 function stamp(x,y,z,priority=false){
  assign(Math.round(x/MAP_W*(nx-1)),Math.round(y/MAP_H*(ny-1)),z,priority);
 }
 // Stamp line elevations at approximately each grid cell.
 for(const f of doc.features){
  if(f.kind!=='line')continue;
  const pts=f.points, segments=f.closed?pts.length:pts.length-1;
  for(let s=0;s<segments;s++){
   const a=pts[s],b=pts[(s+1)%pts.length];
   const dx=(b[0]-a[0])/MAP_W*(nx-1),dy=(b[1]-a[1])/MAP_H*(ny-1);
   const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)*2));
   for(let k=0;k<=steps;k++){
    const t=k/steps;
    stamp(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,f.elevation);
   }
  }
 }
 // Points override coincident line constraints, intentionally.
 for(const f of doc.features)if(f.kind==='point')stamp(f.x,f.y,f.elevation,true);
 // Harmonic interpolation: fixed isolines + control points, smooth between them.
 // This is a teaching surface, not a scientifically unique contour reconstruction.
 const omega=1.57;
 let iterations=0;
 for(let iter=0;iter<750;iter++){
  let maxDelta=0;
  for(let y=1;y<ny-1;y++){
   for(let x=1;x<nx-1;x++){
    const i=y*nx+x;
    if(fixed[i])continue;
    const avg=(heights[i-1]+heights[i+1]+heights[i-nx]+heights[i+nx])*.25;
    const change=(avg-heights[i])*omega;
    heights[i]+=change;
    if(Math.abs(change)>maxDelta)maxDelta=Math.abs(change);
   }
  }
  iterations=iter+1;
  if(iter>75&&maxDelta<.04)break;
 }
 let min=Infinity,max=-Infinity;
 for(const h of heights){if(h<min)min=h;if(h>max)max=h;}
 return {nx,ny,heights,min,max,collisions,iterations};
}

export function getHeight(grid, px,py){
 const fx=clamp(px/MAP_W*(grid.nx-1),0,grid.nx-1-1e-8), fy=clamp(py/MAP_H*(grid.ny-1),0,grid.ny-1-1e-8);
 const ix=Math.floor(fx), iy=Math.floor(fy), u=fx-ix,v=fy-iy, k=iy*grid.nx+ix;
 const h=grid.heights,n=grid.nx;
 return (1-u)*(1-v)*h[k]+u*(1-v)*h[k+1]+(1-u)*v*h[k+n]+u*v*h[k+n+1];
}

// Marching squares returns exact raster-derived contour segments per elevation.
export function generateContours(grid,interval=100){
 interval=clamp(+interval,10,1000);
 const {nx,ny,min,max,heights:h}=grid;
 const start=Math.ceil((min+.00001)/interval)*interval;
 const end=Math.floor((max-.00001)/interval)*interval;
 const levels=[];
 for(let elev=start;elev<=end&&levels.length<100;elev+=interval){
  const seg=[];
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
   const k=j*nx+i;
   const z=[h[k],h[k+1],h[k+nx+1],h[k+nx]];
   const coords=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
   const intersections=[];
   for(let e=0;e<4;e++){
    const f=(e+1)%4;
    if((z[e]<elev)===(z[f]<elev))continue;
    const t=clamp((elev-z[e])/(z[f]-z[e]),0,1);
    const x=(coords[e][0]+(coords[f][0]-coords[e][0])*t)/(nx-1)*MAP_W;
    const y=(coords[e][1]+(coords[f][1]-coords[e][1])*t)/(ny-1)*MAP_H;
    intersections.push([x,y]);
   }
   if(intersections.length===2){seg.push([intersections[0],intersections[1]]);}
   else if(intersections.length===4){seg.push([intersections[0],intersections[1]]);seg.push([intersections[2],intersections[3]]);}
  }
  levels.push({elev,segments:seg});
 }
 return levels;
}

export function exportASC(grid,widthMeters=16000,heightMeters=9600){
 const nx=grid.nx-1,ny=grid.ny-1;
 const stepX=widthMeters/nx,stepY=heightMeters/ny;
 if(Math.abs(stepX-stepY)>.000001)throw Error('ASC 必須使用正方形像元');
 const rows=[`ncols ${nx}`,`nrows ${ny}`,`xllcorner 0`,`yllcorner 0`,`cellsize ${stepX}`,`NODATA_value -9999`];
 const h=grid.heights,n=grid.nx;
 for(let j=0;j<ny;j++){
  const row=[];
  for(let i=0;i<nx;i++){
   const k=j*n+i;
   row.push(((h[k]+h[k+1]+h[k+n]+h[k+n+1])*.25).toFixed(2));
  }
  rows.push(row.join(' '));
 }
 return rows.join('\n')+'\n';
}

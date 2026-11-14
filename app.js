import {MAP_W,MAP_H,NX,NY,clamp,createEmpty,createDemo,validateProject,computeTerrain,generateContours,getHeight,exportASC} from './terrain-core.mjs';

const $=s=>document.querySelector(s);
const canvas=$('#mapCanvas'), ctx=canvas.getContext('2d',{alpha:false});
let doc=createDemo(), grid=null, contours=[];
let activeTool='closed', drawing=null, selectedId=null;
let view={x:0,y:0,s:1};
let history=[];let scheduled=false;
let renderer=null,THREE=null,THREEscene=null,THREEcamera=null,controls=null,terrainMesh=null,threeRoot=null;
let renderDirty=false;
let toastTimer=0;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4200);}
function snapshot(){history.push(JSON.stringify(doc));if(history.length>40)history.shift();}
function syncInputs(){
 $('#westInput').value=doc.west;$('#eastInput').value=doc.east;$('#intervalInput').value=doc.interval;$('#verticalInput').value=doc.vertical;$('#vertText').textContent=`${Number(doc.vertical).toFixed(1)} ×`;
 $('#featureCount').textContent=`${doc.features.length} 個圖徵`;
 const f=doc.features.find(x=>x.id===selectedId);
 $('#selectionPanel').hidden=!f;
 if(f){$('#featureName').value=f.label||'';$('#elevationInput').value=f.elevation;}
}
function updateTool(t){activeTool=t;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('is-active',b.dataset.tool===t));}
function recompute(){
 try{
  grid=computeTerrain(doc);contours=generateContours(grid,doc.interval);
  $('#heightRange').textContent=`高程 ${Math.round(grid.min)}—${Math.round(grid.max)} m`;
  $('#buildStatus').textContent=`${grid.nx} × ${grid.ny} 網格`;
  $('#featureCount').textContent=`${doc.features.length} 個圖徵`;
  if(grid.collisions>18){$('#coordStatus').textContent=`提醒：存在 ${grid.collisions} 次高度約束重疊，請檢查等高線交叉。`;}else{$('#coordStatus').textContent='已依控制線與控制點重新計算地形；可拖曳右側模型觀察。';}
  renderCanvas();if(THREE) build3D();
 }catch(e){toast(`內插失敗：${e.message}`);console.error(e);}
}
function queueRecompute(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;recompute();});}
function layout(){
 const r=canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
 canvas.width=Math.max(10,Math.round(r.width*dpr));canvas.height=Math.max(10,Math.round(r.height*dpr));
 const pad=24;
 const s=Math.min((r.width-pad*2)/MAP_W,(r.height-pad*2)/MAP_H);
 view={s,x:(r.width-MAP_W*s)/2,y:(r.height-MAP_H*s)/2};
 renderCanvas();resize3D();
}
function drawLinePath(c,pts,closed){if(!pts.length)return;c.beginPath();c.moveTo(pts[0][0],pts[0][1]);for(let k=1;k<pts.length;k++)c.lineTo(pts[k][0],pts[k][1]);if(closed)c.closePath();}
function drawCalculatedContours(c,levels,scale=1){
 for(const lev of levels){
  const important=(Math.abs(lev.elev)%500)<.001;
  c.lineWidth=(important?1.75:1.05)/scale;
  c.strokeStyle=important?'#76634b':'#aa9274';
  c.beginPath();
  for(const [a,b] of lev.segments){c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);}
  c.stroke();
 }
}
function drawMapContent(c,opts={}){
 const withGuides=opts.guides??$('#guidesToggle').checked, withContours=opts.contours??$('#calculatedLines').checked;
 const s=opts.scale??view.s;
 c.fillStyle='#fbfaf6';c.fillRect(0,0,MAP_W,MAP_H);
 // Thin graticule, not actual georeferenced latitude/longitude.
 if(opts.grid??$('#gridToggle').checked){c.strokeStyle='#dce7e9';c.lineWidth=.8/s;c.beginPath();for(let x=100;x<MAP_W;x+=100){c.moveTo(x,0);c.lineTo(x,MAP_H);}for(let y=100;y<MAP_H;y+=100){c.moveTo(0,y);c.lineTo(MAP_W,y);}c.stroke();}
 if(withContours&&contours.length)drawCalculatedContours(c,contours,s);
 if(withGuides){
  for(const f of doc.features){
   const isSelected=f.id===selectedId;
   c.strokeStyle=isSelected?'#dd7136':f.kind==='line'?'#278aab':'#be634f';
   c.fillStyle=isSelected?'#e57639':'#c46a58';
   c.lineWidth=(isSelected?3.6:2.5)/s;
   if(f.kind==='line'){
    c.setLineDash(f.closed?[]:[8/s,5/s]);drawLinePath(c,f.points,f.closed);c.stroke();c.setLineDash([]);
    const first=f.points[0];c.fillStyle='#226c89';c.font=`${Math.max(10/s,1.4)}px system-ui`;c.fillText(`${f.elevation}`,first[0]+7/s,first[1]-7/s);
   }else{
    c.beginPath();c.arc(f.x,f.y,5/s,0,2*Math.PI);c.fill();
    c.font=`${Math.max(10/s,1.4)}px system-ui`;c.fillText(`${f.elevation}`,f.x+8/s,f.y-8/s);
   }
  }
 }
 if(drawing?.length){c.strokeStyle='#db7635';c.lineWidth=2.8/s;c.setLineDash([7/s,4/s]);drawLinePath(c,drawing,false);c.stroke();c.setLineDash([]);}
 c.strokeStyle='#b3c4cc';c.lineWidth=1/s;c.strokeRect(0,0,MAP_W,MAP_H);
}
function renderCanvas(){
 const dpr=canvas.width/Math.max(canvas.clientWidth,1),w=canvas.clientWidth,h=canvas.clientHeight;
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.fillStyle='#f0f4f6';ctx.fillRect(0,0,w,h);
 ctx.setTransform(dpr*view.s,0,0,dpr*view.s,dpr*view.x,dpr*view.y);
 drawMapContent(ctx,{scale:view.s});
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.fillStyle='#638396';ctx.font='11px system-ui';ctx.fillText('西 ←　地形高程示意　→ 東',Math.max(8,view.x),Math.max(14,view.y-7));
}
function positionOf(ev){const r=canvas.getBoundingClientRect();return {x:clamp((ev.clientX-r.left-view.x)/view.s,0,MAP_W),y:clamp((ev.clientY-r.top-view.y)/view.s,0,MAP_H)};}
function distancePointSegment(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],len=vx*vx+vy*vy;const t=len?clamp(((p.x-a[0])*vx+(p.y-a[1])*vy)/len,0,1):0;return Math.hypot(p.x-a[0]-t*vx,p.y-a[1]-t*vy);}
function nearestFeature(p){let best=null,dist=17/view.s;for(const f of doc.features){let d=Infinity;if(f.kind==='point')d=Math.hypot(f.x-p.x,f.y-p.y);else for(let i=0;i<(f.closed?f.points.length:f.points.length-1);i++)d=Math.min(d,distancePointSegment(p,f.points[i],f.points[(i+1)%f.points.length]));if(d<dist){dist=d;best=f;}}return best;}
function rdp(points,epsilon=2.2){if(points.length<=2)return points;let bestDist=0,idx=0;const a=points[0],b=points[points.length-1];for(let i=1;i<points.length-1;i++){const v=distancePointSegment({x:points[i][0],y:points[i][1]},a,b);if(v>bestDist){bestDist=v;idx=i;}}if(bestDist<=epsilon)return [a,b];return [...rdp(points.slice(0,idx+1),epsilon).slice(0,-1),...rdp(points.slice(idx),epsilon)];}
function newId(){return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;}
canvas.addEventListener('pointerdown',ev=>{
 if(ev.button!==0)return;
 ev.preventDefault();canvas.setPointerCapture(ev.pointerId);
 const p=positionOf(ev);
 if(activeTool==='select'){
  selectedId=nearestFeature(p)?.id||null;
  if(selectedId)$('#elevationInput').value=doc.features.find(f=>f.id===selectedId).elevation;
  syncInputs();renderCanvas();return;
 }
 if(activeTool==='point'){
  snapshot();doc.features.push({id:newId(),kind:'point',x:p.x,y:p.y,elevation:Number($('#elevationInput').value)||0,label:''});selectedId=null;syncInputs();queueRecompute();return;
 }
 drawing=[[p.x,p.y]];
 renderCanvas();
});
canvas.addEventListener('pointermove',ev=>{
 const p=positionOf(ev);
 if(drawing&&ev.buttons){const a=drawing[drawing.length-1];if(Math.hypot(p.x-a[0],p.y-a[1])>2.4/view.s){drawing.push([p.x,p.y]);renderCanvas();}}
 $('#coordStatus').textContent=`X ${Math.round(p.x/1000*16000)} m，Y ${Math.round((600-p.y)/600*9600)} m（局部示意坐標）`;
});
function finishDrawing(){if(!drawing)return;const pts=rdp(drawing,1.7/view.s);drawing=null;if(pts.length<3||pts.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):sum,0)<20){renderCanvas();return;}snapshot();doc.features.push({id:newId(),kind:'line',closed:activeTool==='closed',points:pts,elevation:Number($('#elevationInput').value)||0,label:''});selectedId=null;syncInputs();queueRecompute();}
canvas.addEventListener('pointerup',finishDrawing);canvas.addEventListener('pointercancel',()=>{drawing=null;renderCanvas();});
$('#elevationInput').addEventListener('change',()=>{const f=doc.features.find(f=>f.id===selectedId);if(!f)return;snapshot();f.elevation=Number($('#elevationInput').value)||0;queueRecompute();});
$('#featureName').addEventListener('change',()=>{const f=doc.features.find(f=>f.id===selectedId);if(!f)return;snapshot();f.label=$('#featureName').value;});
$('#deleteBtn').addEventListener('click',()=>{if(!selectedId)return;snapshot();doc.features=doc.features.filter(f=>f.id!==selectedId);selectedId=null;syncInputs();queueRecompute();});
$('#undoBtn').addEventListener('click',()=>{if(!history.length){toast('沒有可撤銷的操作。');return;}doc=validateProject(JSON.parse(history.pop()));selectedId=null;syncInputs();queueRecompute();});
$('#rebuildBtn').addEventListener('click',()=>{recompute();toast('已重新計算高程網格。');});
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>updateTool(b.dataset.tool)));
$('#westInput').addEventListener('change',()=>{snapshot();doc.west=Number($('#westInput').value)||0;queueRecompute();});
$('#eastInput').addEventListener('change',()=>{snapshot();doc.east=Number($('#eastInput').value)||0;queueRecompute();});
$('#intervalInput').addEventListener('change',()=>{doc.interval=Number($('#intervalInput').value);contours=generateContours(grid,doc.interval);renderCanvas();});
$('#verticalInput').addEventListener('input',()=>{doc.vertical=Number($('#verticalInput').value);$('#vertText').textContent=`${doc.vertical.toFixed(1)} ×`;if(THREE)build3D();});
['calculatedLines','guidesToggle','gridToggle'].forEach(id=>$('#'+id).addEventListener('change',renderCanvas));
$('#sampleBtn').addEventListener('click',()=>{snapshot();doc=createDemo();selectedId=null;syncInputs();queueRecompute();toast('已載入虛構冰河地形示例。');});
$('#newBtn').addEventListener('click',()=>{if(!window.confirm('要清空畫面並建立新地形嗎？可用「撤銷」還原。'))return;snapshot();doc=createEmpty();selectedId=null;syncInputs();queueRecompute();});
function saveBlob(blob,filename){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
$('#saveBtn').addEventListener('click',()=>saveBlob(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),'glacier-terrain-project.json'));
$('#loadBtn').addEventListener('click',()=>$('#fileInput').click());
$('#fileInput').addEventListener('change',async ev=>{const file=ev.target.files?.[0];if(!file)return;try{const loaded=validateProject(JSON.parse(await file.text()));snapshot();doc=loaded;selectedId=null;syncInputs();queueRecompute();toast('已開啟專案。');}catch(e){toast(`無法開啟：${e.message}`);}ev.target.value='';});

function downloadCanvas(c,name){if(c.toBlob)c.toBlob(b=>b?saveBlob(b,name):toast('PNG 編碼失敗。'),'image/png');else saveBlob(new Blob([]),name);}
function drawFiducial(c,x,y,r,seed){
 c.save();c.translate(x,y);c.fillStyle='#153e59';c.fillRect(-r,-r,2*r,2*r);c.fillStyle='#fff';c.fillRect(-r+9,-r+9,2*r-18,2*r-18);
 c.fillStyle='#1e617a';for(let j=0;j<4;j++)for(let i=0;i<4;i++)if((seed*7+i*13+j*17+(i*j))%5<3)c.fillRect(-r+14+i*(r-7)/2,-r+14+j*(r-7)/2,(r-7)/2-2,(r-7)/2-2);
 c.restore();
}
function createSheet(){
 const c=document.createElement('canvas');c.width=2400;c.height=1697;const p=c.getContext('2d');
 p.fillStyle='#fff';p.fillRect(0,0,c.width,c.height);
 p.fillStyle='#1d3b4b';p.font='bold 52px system-ui';p.fillText('冰河地形｜等高線判讀圖',126,108);
 p.fillStyle='#566f7c';p.font='30px system-ui';p.fillText(`等高距 ${doc.interval} 公尺　｜　虛構教學地形　｜　請先判讀，再用 3D 驗證`,126,157);
 const x=115,y=212,w=2170,h=1302;
 p.save();p.translate(x,y);p.scale(w/MAP_W,h/MAP_H);
 drawMapContent(p,{guides:false,contours:true,grid:false,scale:w/MAP_W});p.restore();
 p.strokeStyle='#253e4e';p.lineWidth=3;p.strokeRect(x,y,w,h);
 p.fillStyle='#56707c';p.font='27px system-ui';p.fillText('地圖範圍（示意）：16 × 9.6 公里　｜　等高線由高程網格計算，實際地形非真實地點',115,1573);
 p.fillText('小組：____________　成員：___________________________________',115,1628);
 // Four distinctive stationary corner blocks outside the map frame, kept free of student marks.
 drawFiducial(p,52,59,34,1);drawFiducial(p,2352,59,34,2);drawFiducial(p,52,1647,34,3);drawFiducial(p,2352,1647,34,4);
 p.save();p.translate(2238,125);p.fillStyle='#173d55';p.font='bold 32px system-ui';p.fillText('N',-10,-29);p.beginPath();p.moveTo(0,-22);p.lineTo(-14,12);p.lineTo(0,5);p.lineTo(14,12);p.closePath();p.fill();p.restore();
 return c;
}
$('#pngBtn').addEventListener('click',()=>{if(!grid)return;downloadCanvas(createSheet(),'glacier-student-A4.png');toast('已產生 A4 等高線 PNG，列印請選橫向、原比例。');});
$('#heightBtn').addEventListener('click',()=>{
 if(!grid)return;const c=document.createElement('canvas');c.width=grid.nx-1;c.height=grid.ny-1;
 const p=c.getContext('2d'),im=p.createImageData(c.width,c.height),h=grid.heights,n=grid.nx;
 for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){
  const k=j*n+i, value=(h[k]+h[k+1]+h[k+n]+h[k+n+1])/4;
  const col=Math.round(clamp((value-grid.min)/(grid.max-grid.min||1),0,1)*255),pos=(j*c.width+i)*4;
  im.data[pos]=im.data[pos+1]=im.data[pos+2]=col;im.data[pos+3]=255;
 }
 p.putImageData(im,0,0);downloadCanvas(c,'glacier-heightmap-8bit.png');
 toast(`灰階 PNG 已下載。黑色=${Math.round(grid.min)}m、白色=${Math.round(grid.max)}m（與真實海拔需另行換算）。`);
});
$('#ascBtn').addEventListener('click',()=>{
 if(!grid)return;const asc=exportASC(grid);saveBlob(new Blob([asc],{type:'text/plain;charset=utf-8'}),'glacier-dem.asc');toast('已下載 ESRI ASCII Grid；可將 .asc 拖進 QGIS。坐標為自訂公尺制示意，並非真實地理位置。');
});

async function setupThree(){
 try{
  const [T,orb,exp]=await Promise.all([
   import('three'),import('three/addons/controls/OrbitControls.js'),import('three/addons/exporters/GLTFExporter.js')
  ]);
  THREE=T;
  const viewport=$('#viewer');
  renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=T.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);
  THREEscene=new T.Scene();THREEscene.background=new T.Color('#dbe8ef');
  THREEscene.fog=new T.Fog('#dbe8ef',18,35);
  THREEcamera=new T.PerspectiveCamera(43,1,.04,100);THREEcamera.position.set(11.5,9.8,13.5);
  controls=new orb.OrbitControls(THREEcamera,renderer.domElement);
  controls.target.set(0,.45,0);controls.enableDamping=true;controls.dampingFactor=.07;
  controls.minDistance=5;controls.maxDistance=35;controls.maxPolarAngle=Math.PI*.495;
  THREEscene.add(new T.HemisphereLight('#ffffff','#a8b9c6',2.2));
  const light=new T.DirectionalLight('#ffffff',2.4);light.position.set(-5,12,5);THREEscene.add(light);
  $('#viewerFallback').remove();
  window.threeExporter=new exp.GLTFExporter();
  resize3D();build3D();
  const loop=()=>{requestAnimationFrame(loop);controls.update();renderer.render(THREEscene,THREEcamera);};loop();
 }catch(e){
  console.warn('3D engine failed to load',e);
  $('#viewerFallback').innerHTML='3D 引擎載入失敗<small>請確認網路可連接 jsDelivr，再重新整理；左側繪圖和 ASC 匯出仍可使用。</small>';
  $('#buildStatus').textContent='3D 未啟動';
 }
}
function resize3D(){if(!renderer||!THREEcamera)return;const {width,height}=$('#viewer').getBoundingClientRect();if(width<=0||height<=0)return;renderer.setSize(width,height,false);THREEcamera.aspect=width/height;THREEcamera.updateProjectionMatrix();}
function build3D(){
 if(!THREE||!grid||!THREEscene)return;
 if(terrainMesh){THREEscene.remove(terrainMesh);terrainMesh.geometry.dispose();terrainMesh.material.dispose();terrainMesh=null;}
 const n=grid.nx,m=grid.ny,pos=new Float32Array(n*m*3),colors=new Float32Array(n*m*3),indices=[];
 const leftBase=Math.min(doc.west,doc.east,grid.min)-20;
 const relativeH=10/16000*doc.vertical;
 const color=new THREE.Color();
 const stops=[['#c9d4be',0],['#83b0ad',.22],['#77978b',.38],['#b5a18d',.60],['#8e9ba1',.80],['#e9eff1',1]];
 for(let j=0;j<m;j++)for(let i=0;i<n;i++){
  const k=j*n+i, ele=grid.heights[k],t=clamp((ele-grid.min)/(grid.max-grid.min||1),0,1);
  pos[k*3]=(i/(n-1)-.5)*10;
  pos[k*3+1]=(ele-leftBase)*relativeH;
  pos[k*3+2]=(j/(m-1)-.5)*6;
  for(let s=0;s<stops.length-1;s++)if(t<=stops[s+1][1]){const a=stops[s],b=stops[s+1],f=(t-a[1])/(b[1]-a[1]);color.set(a[0]).lerp(new THREE.Color(b[0]),f);break;}
  colors[k*3]=color.r;colors[k*3+1]=color.g;colors[k*3+2]=color.b;
 }
 for(let j=0;j<m-1;j++)for(let i=0;i<n-1;i++){
  const a=j*n+i,b=a+1,c=a+n,d=c+1;
  indices.push(a,c,b,b,c,d);
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
 geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
 geo.setIndex(indices);geo.computeVertexNormals();
 terrainMesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide}));
 terrainMesh.name='GlacierTerrain';THREEscene.add(terrainMesh);
 // Keep AR export geometry free of helpers, axes and preview lighting.
}
$('#glbBtn').addEventListener('click',async()=>{
 if(!THREE||!terrainMesh||!window.threeExporter){toast('3D 引擎尚未載入；請確認網路與 jsDelivr。');return;}
 const b=$('#glbBtn');b.disabled=true;b.textContent='輸出中…';
 try{
  const exportScene=new THREE.Scene();
  // Clone references to geometry and material, maintaining the exact preview transform.
  exportScene.add(terrainMesh.clone());
  const result=await window.threeExporter.parseAsync(exportScene,{binary:true,onlyVisible:true});
  saveBlob(new Blob([result],{type:'model/gltf-binary'}),'glacier-terrain.glb');
  toast('已下載 GLB 模型。要對位到 MindAR A4 紙面，仍需設定模型軸向、比例與偏移。');
 }catch(e){toast(`GLB 匯出失敗：${e.message}`);console.error(e);}
 finally{b.disabled=false;b.textContent='3D 模型 GLB';}
});

syncInputs();
window.addEventListener('resize',layout);
const observer=new ResizeObserver(layout);observer.observe(canvas.parentElement);observer.observe($('#viewer'));
requestAnimationFrame(()=>{layout();recompute();setupThree();});

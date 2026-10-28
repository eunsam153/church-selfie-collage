/* 42 · 함께 만드는 교회 — first MVP
   Configure Supabase in Settings to sync photos across devices.
*/
const TOTAL = 42;
const $ = (id) => document.getElementById(id);
const STORAGE_BUCKET = 'church-42-photos';
const LOCAL_PREFIX = 'church42-photo-';
const SETTINGS_KEY = 'church42-settings';

const segments = [
  // Church roof / outer outline
  {a:[500,300],b:[390,375]}, {a:[390,375],b:[280,450]}, {a:[280,450],b:[220,492]},
  {a:[220,492],b:[220,555]}, {a:[220,555],b:[220,625]}, {a:[220,625],b:[220,700]},
  {a:[220,700],b:[220,775]}, {a:[220,775],b:[220,850]}, {a:[220,850],b:[320,850]},
  {a:[320,850],b:[420,850]}, {a:[420,850],b:[500,850]}, {a:[500,850],b:[600,850]},
  {a:[600,850],b:[700,850]}, {a:[700,850],b:[780,850]}, {a:[780,850],b:[780,775]},
  {a:[780,775],b:[780,700]}, {a:[780,700],b:[780,625]}, {a:[780,625],b:[780,555]},
  {a:[780,555],b:[780,492]}, {a:[780,492],b:[720,450]}, {a:[720,450],b:[610,375]},
  {a:[610,375],b:[500,300]},
  // Cross
  {a:[500,170],b:[500,300]}, {a:[465,205],b:[535,205]}, {a:[500,170],b:[500,205]},
  // Heart
  {a:[500,590],b:[455,540]}, {a:[455,540],b:[410,520]}, {a:[410,520],b:[365,530]},
  {a:[365,530],b:[330,560]}, {a:[330,560],b:[310,610]}, {a:[310,610],b:[325,665]},
  {a:[325,665],b:[360,715]}, {a:[360,715],b:[410,755]}, {a:[410,755],b:[460,785]},
  {a:[460,785],b:[500,800]}, {a:[500,800],b:[540,785]}, {a:[540,785],b:[590,755]},
  {a:[590,755],b:[640,715]}, {a:[640,715],b:[675,665]}, {a:[675,665],b:[690,610]},
  {a:[690,610],b:[670,560]}, {a:[670,560],b:[635,530]}
];
// The original graphic has 42 segmented red strokes. These editable guide coordinates
// are an approximate starter template; tune them against the exact artwork before an event.
let activeIndex = 0;
let stream = null;
let facingMode = 'user';
let pendingPhoto = null;
let photos = new Map();
let supabaseClient = null;
let currentUser = null;
let syncing = false;
let settings = loadSettings();

function loadSettings(){ try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return {}} }
function saveSettingsLocal(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function localPhotoKey(i){return LOCAL_PREFIX + String(i+1).padStart(2,'0')}
let localDbPromise = null;
function localDb(){
  if(localDbPromise)return localDbPromise;
  localDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open('church42-local',1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('photos'))req.result.createObjectStore('photos')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return localDbPromise;
}
async function localSavePhoto(i,dataUrl){
  try{const db=await localDb();await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').put(dataUrl,localPhotoKey(i));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}catch(e){console.warn('Local photo cache unavailable',e)}
}
async function localGetPhotos(){
  try{const db=await localDb();return await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readonly');const store=tx.objectStore('photos');const req=store.getAllKeys();req.onsuccess=async()=>{const out=[];for(const key of req.result){const get=store.get(key);out.push(await new Promise((res,rej)=>{get.onsuccess=()=>res([key,get.result]);get.onerror=()=>rej(get.error)}))}resolve(out)};req.onerror=()=>reject(req.error)})}catch(e){console.warn(e);return []}
}
function fmt(n){return String(n+1).padStart(2,'0')}
function showToast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function guideSVG(seg){
  const [ax,ay]=seg.a,[bx,by]=seg.b;
  const dx=bx-ax,dy=by-ay, len=Math.hypot(dx,dy)||1;
  const ux=dx/len,uy=dy/len;
  const cx=160,cy=95, maxLen=230, scale=Math.min(maxLen/len, 1.8);
  const sx=cx-ux*len*scale/2,sy=cy-uy*len*scale/2,ex=cx+ux*len*scale/2,ey=cy+uy*len*scale/2;
  return `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="guide-line"/><circle cx="${sx}" cy="${sy}" r="5" class="guide-dot"/><circle cx="${ex}" cy="${ey}" r="5" class="guide-dot"/>`;
}
function renderGrid(){
  const grid=$('segmentGrid');grid.innerHTML='';
  for(let i=0;i<TOTAL;i++){
    const b=document.createElement('button');b.className='segment-btn'+(i===activeIndex?' active':'')+(photos.has(i)?' done':'');
    b.textContent=fmt(i);b.setAttribute('aria-label',`${i+1}번 선${photos.has(i)?', 촬영 완료':''}`);
    b.addEventListener('click',()=>selectSegment(i));grid.appendChild(b);
  }
  const count=photos.size;$('progressText').textContent=`${count} / ${TOTAL}`;$('progressBar').style.width=(count/TOTAL*100)+'%';
  $('progressHint').textContent=count===TOTAL?'모든 선이 모였어요! 작품을 저장해 보세요.':count===0?'첫 번째 선부터 시작해 보세요.':`완성까지 ${TOTAL-count}장 남았어요.`;
  $('artworkCount').textContent=`${count} / ${TOTAL} photos`;
  $('captureStatus').textContent=photos.has(activeIndex)?'촬영 완료':'촬영 전';$('captureStatus').classList.toggle('done',photos.has(activeIndex));
  $('currentNumber').textContent=fmt(activeIndex);
}
function selectSegment(i){
  activeIndex=i;pendingPhoto=null;$('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');
  $('largeGuide').innerHTML=guideSVG(segments[i]||{a:[300,95],b:[20,95]});
  $('cameraOverlayLine').style.transform=`rotate(${Math.atan2(segments[i].b[1]-segments[i].a[1],segments[i].b[0]-segments[i].a[0])*180/Math.PI}deg)`;
  renderGrid();drawArtwork($('artworkCanvas'));
  $('captureSection').scrollIntoView({behavior:'smooth',block:'start'});
}
function openSettings(){ $('supabaseUrl').value=https://luflknyhvjrbwcuvtnxi.supabase.co/rest/v1/||'';$('supabaseKey').value=sb_publishable_Rx8VFmcjgOC3hGWhRAsKjQ_XTK3sZss||'';$('projectCode').value=settings.project||'church-42';$('settingsMessage').textContent=supabaseClient?'온라인 저장 연결됨': 'URL과 공개 키를 입력하면 기기 간 사진이 동기화됩니다.';$('settingsDialog').showModal() }

async function connectSupabase(){
  const url=$('supabaseUrl').value.trim().replace(/\/$/,'');const key=$('supabaseKey').value.trim();const project=$('projectCode').value.trim()||'church-42';
  if(!url||!key){showToast('Project URL과 anon/public key를 입력해 주세요.');return}
  if(!window.supabase){showToast('Supabase 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');return}
  settings={url,key,project};saveSettingsLocal();
  try{
    supabaseClient=window.supabase.createClient(url,key);
    const {data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
    if(sessionError)throw sessionError;
    if(!sessionData.session){
      const {error}=await supabaseClient.auth.signInAnonymously();
      if(error)throw new Error('익명 로그인 실패: '+error.message+' (Supabase Auth에서 Anonymous Sign-ins를 활성화해 주세요.)');
    }
    const {data:userData}=await supabaseClient.auth.getUser();currentUser=userData?.user||null;
    $('settingsMessage').textContent='연결 성공! 사진을 불러오는 중…';
    await ensureBucketExistsHint();
    await loadRemotePhotos();
    $('settingsMessage').textContent='연결되었습니다. 다른 기기와 사진이 동기화됩니다.';
    $('setupNotice').classList.add('hidden');$('settingsDialog').close();showToast('온라인 저장에 연결했어요.');renderGrid();drawArtwork($('artworkCanvas'));
  }catch(e){
    supabaseClient=null;$('settingsMessage').textContent='연결 실패: '+e.message;
    showToast('연결 실패. Supabase 설정과 SQL을 확인해 주세요.');
  }
}
async function ensureBucketExistsHint(){
  // Bucket is created by the supplied SQL. Storage list is intentionally not called here.
  return true;
}
async function loadRemotePhotos(){
  if(!supabaseClient)return;
  const {data,error}=await supabaseClient.from('church42_photos').select('segment_no,storage_path,updated_at').eq('project_code',settings.project);
  if(error)throw error;
  for(const row of data||[]){
    try{
      const {data:blobData,error:blobError}=await supabaseClient.storage.from(STORAGE_BUCKET).download(row.storage_path);
      if(blobError)continue;
      const dataUrl=await blobToDataURL(blobData);photos.set(row.segment_no-1,dataUrl);
      await localSavePhoto(row.segment_no-1,dataUrl);
    }catch(e){console.warn(e)}
  }
}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
function dataURLToBlob(dataURL){const [head,body]=dataURL.split(',');const mime=(head.match(/:(.*?);/)||[])[1]||'image/jpeg';const bin=atob(body);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:mime})}

async function savePhoto(){
  if(!pendingPhoto)return;
  const i=activeIndex;
  try{
    if(supabaseClient){
      const blob=dataURLToBlob(pendingPhoto);const path=`${settings.project}/${fmt(i)}.jpg`;
      const {error:uploadError}=await supabaseClient.storage.from(STORAGE_BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:true});
      if(uploadError)throw uploadError;
      const {error:rowError}=await supabaseClient.from('church42_photos').upsert({
        project_code:settings.project,segment_no:i+1,storage_path:path,updated_at:new Date().toISOString(),user_id:currentUser?.id||null
      },{onConflict:'project_code,segment_no'});
      if(rowError)throw rowError;
    }
    await localSavePhoto(i,pendingPhoto);photos.set(i,pendingPhoto);pendingPhoto=null;
    $('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');
    renderGrid();drawArtwork($('artworkCanvas'));showToast(`${i+1}번 사진을 저장했어요.`);
    if(i<TOTAL-1)selectSegment(i+1);
  }catch(e){showToast('저장 실패: '+e.message);console.error(e)}
}
async function loadLocalPhotos(){const entries=await localGetPhotos();for(const [key,value] of entries){const i=Number(String(key).replace(LOCAL_PREFIX,''))-1;if(Number.isInteger(i)&&i>=0&&i<TOTAL&&value)photos.set(i,value)}renderGrid();drawArtwork($('artworkCanvas'))}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){showToast('이 브라우저에서는 카메라를 사용할 수 없어요. HTTPS로 접속해 주세요.');return}
  stopCamera();
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:1600}},audio:false});
    $('camera').srcObject=stream;$('camera').classList.remove('hidden');$('cameraPlaceholder').classList.add('hidden');
    $('takePhotoBtn').disabled=false;$('switchCameraBtn').disabled=false;$('cameraMessage').textContent='빨간 선의 각도와 길이에 맞춰 포즈를 잡아 주세요.';
  }catch(e){showToast('카메라를 시작하지 못했어요. 권한과 HTTPS 연결을 확인해 주세요.');$('cameraMessage').textContent=e.message}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
function takePhoto(){
  const video=$('camera');if(!stream||!video.videoWidth)return;
  const c=$('captureCanvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');
  ctx.translate(c.width,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,c.width,c.height);
  pendingPhoto=c.toDataURL('image/jpeg',.88);
  $('cameraPlaceholder').classList.add('hidden');$('savePhotoBtn').disabled=false;$('retakeBtn').classList.remove('hidden');
  $('cameraMessage').textContent='촬영한 사진을 확인하고 저장하세요. 저장 전에는 작품에 반영되지 않아요.';
  showToast('사진을 촬영했어요. 마음에 들면 저장해 주세요.');
}
function drawLine(ctx,seg,color='#ff3038',width=13){
  const scaleX=1100/1000,scaleY=1375/1000;
  ctx.beginPath();ctx.moveTo(seg.a[0]*scaleX,seg.a[1]*scaleY);ctx.lineTo(seg.b[0]*scaleX,seg.b[1]*scaleY);
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='butt';ctx.stroke();
}
function loadImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src})}
async function drawArtwork(canvas){
  if(!canvas)return;const ctx=canvas.getContext('2d');ctx.fillStyle='#050505';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Position the 1000x1000 shape inside the 1100x1375 poster, leaving space for verse/footer.
  const offsetX=50,offsetY=80,scale=1;
  ctx.save();ctx.translate(offsetX,offsetY);
  // The shape uses the reference image's red stroke as the collage path.
  for(let i=0;i<TOTAL;i++){
    const photo=photos.get(i);
    if(photo){
      try{
        const im=await loadImage(photo);const seg=segments[i];const x=(seg.a[0]+seg.b[0])/2,y=(seg.a[1]+seg.b[1])/2;
        const w= Math.max(45,Math.hypot(seg.b[0]-seg.a[0],seg.b[1]-seg.a[1])+38),h=100;
        ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(seg.b[1]-seg.a[1],seg.b[0]-seg.a[0]));
        ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.clip();
        const ratio=Math.max(w/im.width,h/im.height);ctx.drawImage(im,-im.width*ratio/2,-im.height*ratio/2,im.width*ratio,im.height*ratio);
        ctx.restore();
      }catch(e){drawLine(ctx,segments[i])}
    }else drawLine(ctx,segments[i]);
  }
  ctx.restore();
  // caption
  ctx.fillStyle='#77767d';ctx.textAlign='center';ctx.font='bold 22px sans-serif';
  ctx.fillText("All of you together are Christ's body, and each of you is a part of it.",canvas.width/2,1185);
  ctx.font='bold 21px sans-serif';ctx.fillText('너희는 그리스도의 몸이요 지체의 각 부분이라 (고전 12:27)',canvas.width/2,1230);
  ctx.font='16px sans-serif';ctx.fillStyle='#66656b';ctx.fillText('@42 · ONE BODY',canvas.width/2,1320);
}
function downloadCanvas(canvas,name){
  canvas.toBlob(blob=>{if(!blob){showToast('이미지 생성에 실패했어요.');return}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)},'image/png');
}
function openPreview(){drawArtwork($('previewCanvas'));$('previewCount').textContent=`현재 ${photos.size} / 42장의 사진이 저장되어 있어요.`;$('previewDialog').showModal()}
function updateSetupNotice(){if(!settings.url||!settings.key)$('setupNotice').classList.remove('hidden');else $('setupNotice').classList.add('hidden')}

$('settingsBtn').addEventListener('click',openSettings);
$('openSettingsNotice').addEventListener('click',openSettings);
$('saveSettingsBtn').addEventListener('click',connectSupabase);
$('clearSettingsBtn').addEventListener('click',()=>{settings={};saveSettingsLocal();supabaseClient=null;$('settingsMessage').textContent='연결 정보가 이 브라우저에서 삭제됐어요.';showToast('온라인 연결 설정을 지웠어요.')});
$('startCameraBtn').addEventListener('click',startCamera);
$('switchCameraBtn').addEventListener('click',()=>{facingMode=facingMode==='user'?'environment':'user';startCamera()});
$('takePhotoBtn').addEventListener('click',takePhoto);
$('retakeBtn').addEventListener('click',()=>{pendingPhoto=null;$('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');$('cameraMessage').textContent='다시 포즈를 잡고 촬영해 주세요.'});
$('savePhotoBtn').addEventListener('click',savePhoto);
$('downloadBtn').addEventListener('click',()=>downloadCanvas($('artworkCanvas'),'church-42-collage.png'));
$('previewBtn').addEventListener('click',openPreview);
$('closePreviewBtn').addEventListener('click',()=>$('previewDialog').close());
$('previewDownloadBtn').addEventListener('click',()=>downloadCanvas($('previewCanvas'),'church-42-preview.png'));
window.addEventListener('beforeunload',stopCamera);

renderGrid();selectSegment(0);updateSetupNotice();drawArtwork($('artworkCanvas'));loadLocalPhotos();
if(settings.url&&settings.key){$('supabaseUrl').value=settings.url;$('supabaseKey').value=settings.key;$('projectCode').value=settings.project||'church-42';connectSupabase().catch(console.error)}

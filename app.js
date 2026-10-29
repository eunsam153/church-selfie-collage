/* 42 · 함께 만드는 교회 — square-cell version
   Photos occupy fixed 6x7 square cells. Red lines are pose guides only.
*/
const TOTAL = 42;
const COLS = 6, ROWS = 7;
const $ = (id) => document.getElementById(id);
const STORAGE_BUCKET = 'church-42-photos';
const LOCAL_PREFIX = 'church42-photo-';
const SETTINGS_KEY = 'church42-settings';

// Crop bounds of the 6x7 black grid in the supplied guide image (1638 x 2048).
const TEMPLATE = { width: 1638, height: 2048, x0: 308, x1: 1330, y0: 320, y1: 1513 };
const CELL_W = (TEMPLATE.x1 - TEMPLATE.x0) / COLS;
const CELL_H = (TEMPLATE.y1 - TEMPLATE.y0) / ROWS;
const ART = { x: 100, y: 65, cell: 150 };
let activeIndex = 0;
let stream = null;
let facingMode = 'user';
let pendingPhoto = null;
let photos = new Map();
let supabaseClient = null;
let currentUser = null;
let settings = loadSettings();
let templateImage = null;
let overlayImage = null;
let drawToken = 0;

function loadSettings(){ try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return {}} }
function saveSettingsLocal(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function localPhotoKey(i){return LOCAL_PREFIX + String(i+1).padStart(2,'0')}
function fmt(n){return String(n+1).padStart(2,'0')}
function showToast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
function loadImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src})}
function getCellCrop(i){
  const col=i%COLS,row=Math.floor(i/COLS);
  return {x:TEMPLATE.x0+col*CELL_W,y:TEMPLATE.y0+row*CELL_H,w:CELL_W,h:CELL_H};
}
function renderGrid(){
  const grid=$('segmentGrid');grid.innerHTML='';
  for(let i=0;i<TOTAL;i++){
    const b=document.createElement('button');
    b.className='segment-btn'+(i===activeIndex?' active':'')+(photos.has(i)?' done':'');
    b.textContent=fmt(i);b.setAttribute('aria-label',`${i+1}번 칸${photos.has(i)?', 촬영 완료':''}`);
    b.addEventListener('click',()=>selectSegment(i));grid.appendChild(b);
  }
  const count=photos.size;
  $('progressText').textContent=`${count} / ${TOTAL}`;
  $('progressBar').style.width=(count/TOTAL*100)+'%';
  $('progressHint').textContent=count===TOTAL?'모든 사진이 모였어요! 작품을 저장해 보세요.':count===0?'첫 번째 칸부터 시작해 보세요.':`완성까지 ${TOTAL-count}장 남았어요.`;
  $('artworkCount').textContent=`${count} / ${TOTAL} photos`;
  const isSaved = photos.has(activeIndex);
  $('captureStatus').textContent=isSaved?'촬영 완료':'촬영 전';
  $('captureStatus').classList.toggle('done',isSaved);
  $('replaceSavedBtn').classList.toggle('hidden',!isSaved);
  $('savePhotoBtn').textContent=isSaved?'사진 교체 저장':'이 번호에 저장';
}
function drawCurrentGuide(){
  const crop=getCellCrop(activeIndex);
  const guide=$('largeGuide');
  const ctx=guide.getContext('2d');
  ctx.clearRect(0,0,guide.width,guide.height);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,guide.width,guide.height);
  if(templateImage){
    ctx.drawImage(templateImage,crop.x,crop.y,crop.w,crop.h,0,0,guide.width,guide.height);
  }
  const c=$('cameraGuideCanvas'),cc=c.getContext('2d');
  c.width=600;c.height=600;cc.clearRect(0,0,c.width,c.height);
  if(overlayImage){
    cc.drawImage(overlayImage,crop.x,crop.y,crop.w,crop.h,0,0,c.width,c.height);
  }
}
function selectSegment(i){
  activeIndex=i;pendingPhoto=null;
  $('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');
  $('captureCanvas').classList.add('hidden');
  if(stream)$('camera').classList.remove('hidden');
  $('cameraGuideCanvas').classList.remove('hidden');
  $('cameraPlaceholder').classList.toggle('hidden',!!stream);
  drawCurrentGuide();renderGrid();drawArtwork($('artworkCanvas'));
  $('captureSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function openSettings(){ 
  $('supabaseUrl').value = settings.url || 'https://luflknyhvjrbwcuvtnxi.supabase.co/rest/v1/';
  $('supabaseKey').value = settings.key || 'sb_publishable_Rx8VFmcjgOC3hGWhRAsKjQ_XTK3sZss';
  $('projectCode').value = settings.project || 'church-42';
  $('settingsMessage').textContent = supabaseClient ? '온라인 저장 연결됨' : 'URL과 공개 키를 입력하면 기기 간 사진이 동기화됩니다.';
  $('settingsDialog').showModal();
}

async function connectSupabase(){
  const url=$('supabaseUrl').value.trim().replace(/\/$/,'');
  const key=$('supabaseKey').value.trim();
  const project=$('projectCode').value.trim()||'church-42';
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
    await loadRemotePhotos();
    $('settingsMessage').textContent='연결되었습니다. 다른 기기와 사진이 동기화됩니다.';
    $('setupNotice').classList.add('hidden');$('settingsDialog').close();
    showToast('온라인 저장에 연결했어요.');renderGrid();drawArtwork($('artworkCanvas'));
  }catch(e){
    supabaseClient=null;$('settingsMessage').textContent='연결 실패: '+e.message;
    showToast('연결 실패. Supabase 설정과 SQL을 확인해 주세요.');
  }
}
async function loadRemotePhotos(){
  if(!supabaseClient)return;
  const {data,error}=await supabaseClient.from('church42_photos').select('segment_no,storage_path,updated_at').eq('project_code',settings.project);
  if(error)throw error;
  for(const row of data||[]){
    try{
      const {data:blobData,error:blobError}=await supabaseClient.storage.from(STORAGE_BUCKET).download(row.storage_path);
      if(blobError)continue;
      const dataUrl=await blobToDataURL(blobData);
      photos.set(row.segment_no-1,dataUrl);localStorage.setItem(localPhotoKey(row.segment_no-1),dataUrl);
    }catch(e){console.warn(e)}
  }
}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
function dataURLToBlob(dataURL){
  const [head,body]=dataURL.split(',');const mime=(head.match(/:(.*?);/)||[])[1]||'image/jpeg';
  const bin=atob(body);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
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
    localStorage.setItem(localPhotoKey(i),pendingPhoto);photos.set(i,pendingPhoto);pendingPhoto=null;
    $('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');
    $('cameraGuideCanvas').classList.remove('hidden');
    renderGrid();await drawArtwork($('artworkCanvas'));showToast(`${i+1}번 사진을 저장했어요.`);
    if(i<TOTAL-1)selectSegment(i+1);
  }catch(e){showToast('저장 실패: '+e.message);console.error(e)}
}
function loadLocalPhotos(){
  for(let i=0;i<TOTAL;i++){const p=localStorage.getItem(localPhotoKey(i));if(p)photos.set(i,p)}
}
async function startCamera(){
  const video=$('camera');
  if(!window.isSecureContext){
    $('cameraMessage').textContent='카메라는 HTTPS 주소에서만 실행할 수 있어요. 배포된 https:// 링크를 Safari 주소창에 직접 열어 주세요.';
    showToast('HTTPS 주소로 접속해야 카메라를 사용할 수 있어요.');
    return;
  }
  if(!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia!=='function'){
    $('cameraMessage').textContent='이 브라우저에서 카메라 API를 사용할 수 없어요. 링크를 인앱 브라우저가 아닌 iPhone Safari에서 직접 열어 주세요.';
    showToast('Safari에서 링크를 직접 열어 주세요.');
    return;
  }
  stopCamera();
  $('startCameraBtn').disabled=true;
  $('cameraMessage').textContent='카메라에 연결 중…';
  try{
    let constraints={audio:false,video:{facingMode:facingMode,width:{ideal:1280},height:{ideal:1280}}};
    try{
      stream=await navigator.mediaDevices.getUserMedia(constraints);
    }catch(firstError){
      // Older iOS Safari versions may reject advanced constraints; retry simply.
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});
    }
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.autoplay=true;
    video.muted=true;
    video.srcObject=stream;
    video.classList.remove('hidden');
    $('captureCanvas').classList.add('hidden');
    $('cameraPlaceholder').classList.add('hidden');
    $('cameraGuideCanvas').classList.remove('hidden');

    // iOS Safari often needs an explicit play() after getUserMedia.
    await new Promise((resolve,reject)=>{
      if(video.readyState>=2 && video.videoWidth>0){resolve();return}
      const onReady=()=>{cleanup();resolve()};
      const onError=()=>{cleanup();reject(new Error('카메라 영상 스트림을 표시할 수 없어요.'))};
      const cleanup=()=>{video.removeEventListener('loadedmetadata',onReady);video.removeEventListener('canplay',onReady);video.removeEventListener('error',onError)};
      video.addEventListener('loadedmetadata',onReady,{once:true});
      video.addEventListener('canplay',onReady,{once:true});
      video.addEventListener('error',onError,{once:true});
      setTimeout(()=>{if(video.videoWidth>0){cleanup();resolve()}},2500);
    });
    try{await video.play()}catch(playError){
      // Retry play from this click-triggered flow; muted inline video is allowed by iOS.
      video.muted=true;
      await video.play();
    }
    $('takePhotoBtn').disabled=false;
    $('switchCameraBtn').disabled=false;
    $('cameraMessage').textContent='정사각형 프레임 안에서 포즈를 잡아 주세요. 빨간 가이드는 저장 사진에 포함되지 않아요.';
    showToast('카메라가 준비됐어요.');
  }catch(e){
    stopCamera();
    video.srcObject=null;
    video.classList.add('hidden');
    $('cameraPlaceholder').classList.remove('hidden');
    $('cameraMessage').textContent=`카메라를 시작하지 못했어요: ${e.message||e.name||'알 수 없는 오류'}. iPhone 설정 > Safari > 카메라 권한과 HTTPS 주소를 확인해 주세요.`;
    showToast('카메라 시작 실패: Safari 권한과 HTTPS를 확인해 주세요.');
    console.error('Camera startup failed:',e);
  }finally{
    $('startCameraBtn').disabled=false;
  }
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}

function takePhoto(){
  const video = $('camera');
  if(!stream || !video.videoWidth) return;

  // 정방형으로 크롭하되, 추가적인 좌우반전 왜곡 없이 화면에 보이는 그대로 저장합니다.
  const side = Math.min(video.videoWidth, video.videoHeight);
  const sx = Math.floor((video.videoWidth - side) / 2);
  const sy = Math.floor((video.videoHeight - side) / 2);
  
  const c = $('captureCanvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d');
  
  // 가이드선과 100% 일치하도록 보정 없이 원본 프레임 그대로 복사합니다.
  ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);

  pendingPhoto = c.toDataURL('image/jpeg', .92);

  $('camera').classList.add('hidden');
  c.classList.remove('hidden');
  $('cameraGuideCanvas').classList.add('hidden');
  $('savePhotoBtn').disabled = false;
  $('retakeBtn').classList.remove('hidden');
  $('cameraMessage').textContent = '정방형으로 잘린 사진을 확인하세요. 가이드는 저장 사진에 들어가지 않아요.';
  showToast('정방형 셀카를 촬영했어요. 확인 후 저장해 주세요.');
}

function drawCover(ctx,img,x,y,w,h){
  const s=Math.max(w/img.width,h/img.height),sw=w/s,sh=h/s;
  const sx=(img.width-sw)/2,sy=(img.height-sh)/2;
  ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
}
async function drawArtwork(canvas){
  if(!canvas)return;
  const token=++drawToken;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  const gridX=ART.x,gridY=ART.y,cell=ART.cell;
  // Each photo fills its fixed square cell; no spacing/gutters between cells.
  for(let i=0;i<TOTAL;i++){
    if(token!==drawToken)return;
    const x=gridX+(i%COLS)*cell,y=gridY+Math.floor(i/COLS)*cell;
    const photo=photos.get(i);
    if(photo){
      try{const im=await loadImage(photo);if(token!==drawToken)return;drawCover(ctx,im,x,y,cell,cell)}
      catch(e){ctx.fillStyle='#f1f1f1';ctx.fillRect(x,y,cell,cell)}
    }else{
      ctx.fillStyle='#f7f7f7';ctx.fillRect(x,y,cell,cell);
      // Empty slots remain plain placeholders. Guide lines are for capture only
      // and must never appear in the exported final artwork.
      ctx.fillStyle='#777';ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(fmt(i),x+cell/2,y+cell/2);
    }
  }
  // No grid strokes in the exported artwork: the grid is only a capture guide.
  // Photo cells are drawn edge-to-edge with zero gutters.
  ctx.fillStyle='#444';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.font='20px sans-serif';
  ctx.fillText("All of you together are Christ's body, and each of you is a part of it.",canvas.width/2,1190);
  ctx.fillStyle='#888';ctx.font='20px sans-serif';
  ctx.fillText('너희는 그리스도의 몸이요 지체의 각 부분이라 (고전 12:27)',canvas.width/2,1235);
  ctx.fillStyle='#999';ctx.font='14px sans-serif';ctx.fillText('@1faithinchrist',canvas.width/2,1325);
}
function downloadCanvas(canvas,name){
  canvas.toBlob(blob=>{
    if(!blob){showToast('이미지 생성에 실패했어요.');return}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
}
async function openPreview(){
  await drawArtwork($('previewCanvas'));
  $('previewCount').textContent=`현재 ${photos.size} / 42장의 사진이 저장되어 있어요.`;
  $('previewDialog').showModal();
}
function updateSetupNotice(){if(!settings.url||!settings.key)$('setupNotice').classList.remove('hidden');else $('setupNotice').classList.add('hidden')}

$('settingsBtn').addEventListener('click',openSettings);
$('openSettingsNotice').addEventListener('click',openSettings);
$('saveSettingsBtn').addEventListener('click',connectSupabase);
$('clearSettingsBtn').addEventListener('click',()=>{settings={};saveSettingsLocal();supabaseClient=null;$('settingsMessage').textContent='연결 정보가 이 브라우저에서 삭제됐어요.';showToast('온라인 연결 설정을 지웠어요.')});
$('startCameraBtn').addEventListener('click',()=>{
  $('cameraMessage').textContent='버튼이 눌렸어요. 카메라 연결을 시도하고 있어요…';
  $('startCameraBtn').disabled=true;
  Promise.resolve().then(startCamera).catch(e=>{
    console.error('Camera button handler failed:',e);
    $('cameraMessage').textContent='카메라 실행 중 오류가 발생했어요: '+(e.message||String(e));
    $('startCameraBtn').disabled=false;
    showToast('카메라 실행 오류가 발생했어요.');
  });
});
$('switchCameraBtn').addEventListener('click',()=>{facingMode=facingMode==='user'?'environment':'user';startCamera()});
$('takePhotoBtn').addEventListener('click',takePhoto);
$('replaceSavedBtn').addEventListener('click',async()=>{
  pendingPhoto=null;
  $('savePhotoBtn').disabled=true;
  $('retakeBtn').classList.add('hidden');
  $('captureCanvas').classList.add('hidden');
  $('cameraGuideCanvas').classList.remove('hidden');
  if(stream){
    $('camera').classList.remove('hidden');
    $('cameraPlaceholder').classList.add('hidden');
  }else{
    await startCamera();
  }
  $('cameraMessage').textContent='새 사진을 촬영한 뒤 “사진 교체 저장”을 누르면 기존 사진이 교체됩니다.';
});

$('retakeBtn').addEventListener('click',()=>{
  pendingPhoto=null;$('savePhotoBtn').disabled=true;$('retakeBtn').classList.add('hidden');
  $('captureCanvas').classList.add('hidden');
  if(stream)$('camera').classList.remove('hidden');
  $('cameraGuideCanvas').classList.remove('hidden');
  $('cameraMessage').textContent='다시 정방형 프레임에 맞춰 촬영해 주세요.';
});
$('savePhotoBtn').addEventListener('click',savePhoto);
$('downloadBtn').addEventListener('click',()=>downloadCanvas($('artworkCanvas'),'church-42-collage.png'));
$('previewBtn').addEventListener('click',openPreview);
$('closePreviewBtn').addEventListener('click',()=>$('previewDialog').close());
$('previewDownloadBtn').addEventListener('click',()=>downloadCanvas($('previewCanvas'),'church-42-preview.png'));
window.addEventListener('beforeunload',stopCamera);

(async function init(){
  loadLocalPhotos();
  try{[templateImage,overlayImage]=await Promise.all([loadImage('./guide-template.png'),loadImage('./guide-overlay.png')])}
  catch(e){console.error('Guide images failed to load:',e);showToast('가이드 이미지를 불러오지 못했어요. PNG 파일이 app.js와 같은 폴더에 있는지 확인해 주세요.')}
  renderGrid();drawCurrentGuide();await drawArtwork($('artworkCanvas'));updateSetupNotice();
  if(settings.url&&settings.key){$('supabaseUrl').value=settings.url;$('supabaseKey').value=settings.key;$('projectCode').value=settings.project||'church-42';connectSupabase().catch(console.error)}
})();

(() => {
const $=id=>document.getElementById(id),base=location.pathname.split('/modules/')[0],api=base+'/api/material-assets';
let assets=[],folders=[],current='',busy=false;
const themeFolders=['大促主题','品牌色平销','特殊内容场'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const allowed=new Set('png jpg jpeg webp gif bmp tif tiff heic svg pdf txt csv psd ai eps doc docx xls xlsx ppt pptx zip rar 7z mp4 mov webm mp3 wav m4a'.split(' '));
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
const message=text=>{$('status').textContent=text};
const dataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取本地文件失败'));reader.readAsDataURL(file)});
async function request(body){const r=await fetch(api,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'素材请求失败，请刷新重试');return result}
function render(){
  const query=$('visualSearch').value.trim().toLowerCase(),prefix=current?current+'/':'';
  $('folderHeading').textContent=current||'全部素材';
  document.querySelectorAll('[data-theme]').forEach(button=>button.classList.toggle('active',current===button.dataset.theme||current.startsWith(button.dataset.theme+'/')));
  const children=[...new Set(folders.filter(path=>path.startsWith(prefix)&&path!==current).map(path=>path.slice(prefix.length).split('/')[0]))];
  $('folders').innerHTML=children.filter(name=>!query||name.toLowerCase().includes(query)).map(name=>'<button class="visual-folder" data-folder="'+esc(prefix+name)+'">'+esc(name)+'</button>').join('');
  $('folders').querySelectorAll('[data-folder]').forEach(button=>button.onclick=()=>{current=button.dataset.folder;render()});
  const list=assets.filter(file=>file.kind==='visual'&&(query?[file.originalName,file.folder].join(' ').toLowerCase().includes(query):(file.folder||'')===current));
  $('visualList').innerHTML=list.length?list.map(file=>'<article class="visual-file"><button class="preview" data-preview="'+esc(file.id)+'" aria-label="查看 '+esc(file.originalName)+'">'+(/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.mime)?'<img loading="lazy" src="'+esc(file.url)+'" alt="'+esc(file.originalName)+'">':esc(file.extension.slice(1).toUpperCase())+' 文件')+'</button><div class="file-copy"><b>'+esc(file.originalName||file.title)+'</b><small>'+size(file.size)+' · '+esc(file.createdBy)+' · '+esc(file.createdAt?.slice(0,10))+'</small><a href="'+esc(file.url)+'?download=1" download>下载原文件</a></div></article>').join(''):'<p>此文件夹暂无匹配文件。可新建文件夹或上传文件。</p>';
  $('visualList').querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>{const f=assets.find(file=>file.id===button.dataset.preview),root=$('previewContent');root.replaceChildren();let media;if(/^image\/(png|jpeg|webp|gif|bmp)$/.test(f.mime))media=document.createElement('img');else if(f.mime.startsWith('video/'))media=document.createElement('video');else if(f.mime.startsWith('audio/'))media=document.createElement('audio');if(media){media.src=f.url;media.alt=f.originalName;media.controls=true;root.append(media)}else{const p=document.createElement('p');p.textContent='此格式保留原文件，请下载后用对应软件打开。';root.append(p)}const a=document.createElement('a');a.href=f.url+'?download=1';a.download=f.originalName;a.textContent='下载 '+f.originalName;root.append(a);$('previewDialog').showModal()});
}
async function load(){try{const result=await request();assets=result.assets||[];folders=result.folders||[];render();message('已读取 '+assets.filter(x=>x.kind==='visual').length+' 个视觉文件')}catch(error){message(error.message)}}
async function upload(input){
  if(busy)return;const files=[...input.files];if(!files.length)return;
  if(!themeFolders.some(theme=>current===theme||current.startsWith(theme+'/'))){message('请先选择“大促主题”“品牌色平销”或“特殊内容场”，再上传到对应主题目录。');input.value='';return}
  const invalid=files.filter(file=>!allowed.has(file.name.split('.').at(-1).toLowerCase())||file.size>50*1048576||file.size===0);
  if(invalid.length){message('以下文件格式不支持、为空或超过 50MB，尚未开始上传：\n'+invalid.map(x=>x.name).join('\n'));return}
  busy=true;document.querySelectorAll('.visual-header button').forEach(b=>b.disabled=true);let saved=0,errors=[];
  for(const file of files){message('正在上传 '+(saved+errors.length+1)+' / '+files.length+'：'+file.name);try{const path=file.webkitRelativePath||file.name,relative=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';await request({kind:'visual',folder:[current,relative].filter(Boolean).join('/'),name:file.name,dataUrl:await dataUrl(file)});saved++}catch(error){errors.push(file.name+'：'+error.message)}}
  busy=false;document.querySelectorAll('.visual-header button').forEach(b=>b.disabled=false);input.value='';await load();message('已保存 '+saved+' 个文件。'+(errors.length?'失败 '+errors.length+' 个，可重新选择失败文件重试：\n'+errors.join('\n'):''));
}
$('uploadFiles').onclick=()=>$('filesInput').click();$('uploadFolder').onclick=()=>$('folderInput').click();
$('filesInput').onchange=()=>upload($('filesInput'));$('folderInput').onchange=()=>upload($('folderInput'));
$('createFolder').onclick=()=>{if(!themeFolders.some(theme=>current===theme||current.startsWith(theme+'/'))){message('请先选择一个主题目录，再在其中新建文件夹。');return}$('folderForm').hidden=false;$('folderName').focus()};$('cancelFolder').onclick=()=>{$('folderForm').hidden=true};
$('folderForm').onsubmit=async event=>{event.preventDefault();const name=$('folderName').value.trim();if(!name||/[\\/]/.test(name)){message('请填写单个文件夹名称，不包含斜杠');return}const button=event.submitter;button.disabled=true;try{await request({kind:'visual',action:'create_folder',folder:[current,name].filter(Boolean).join('/')});$('folderForm').hidden=true;$('folderName').value='';await load()}catch(error){message(error.message)}finally{button.disabled=false}};
$('visualSearch').oninput=render;$('refresh').onclick=load;$('upFolder').onclick=()=>{current=current.includes('/')?current.slice(0,current.lastIndexOf('/')):'';render()};
document.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{current=button.dataset.theme;render()});
$('previewDialog').addEventListener('close',()=>$('previewContent').replaceChildren());load();
})();

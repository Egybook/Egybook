(() => {
'use strict';
const SUPABASE_URL='https://ezmglhwjiozevjebmgmj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_-YdgiJ_J-oFXugV3xwxNCA_Gog1dJrb';
const $=s=>document.querySelector(s);
const main=$('#main');
const client=window.supabase?.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getPostId(){const p=location.pathname.match(/\/post\/([^/]+)\/?$/i);if(p)return decodeURIComponent(p[1]);return new URLSearchParams(location.search).get('id')||'';}
function mediaList(row){let arr=row.media_urls;if(typeof arr==='string'){try{arr=JSON.parse(arr)}catch(_){arr=[arr]}}if(!Array.isArray(arr))arr=[];arr=arr.map(x=>typeof x==='string'?x:(x?.url||x?.src||x?.publicUrl)).filter(Boolean);if(!arr.length&&row.media_url)arr=[row.media_url];return [...new Set(arr)];}
function mediaKind(row,url){const t=String(row.media_type||'').toLowerCase();return t.includes('video')||/\.(mp4|webm|mov)(\?|$)/i.test(url)?'video':'image';}
function state(msg){main.innerHTML=`<div class="state"><p>${esc(msg)}</p></div>`;}
function formatDate(v){if(!v)return '';try{return new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch(_){return '';}}
function addMedia(row,urls){if(!urls.length)return null;const wrap=document.createElement('section');wrap.className='media';const track=document.createElement('div');track.className='media-track';urls.forEach((url,i)=>{const item=document.createElement('div');item.className='media-item';if(mediaKind(row,url)==='video'){const v=document.createElement('video');v.src=url;v.controls=true;v.playsInline=true;v.preload='metadata';item.append(v)}else{const img=document.createElement('img');img.src=url;img.alt='صورة المنشور';img.loading=i===0?'eager':'lazy';img.decoding='async';img.addEventListener('click',()=>openViewer(urls,i));item.append(img)}track.append(item)});wrap.append(track);if(urls.length>1){const count=document.createElement('span');count.className='media-count';count.textContent=`1 / ${urls.length}`;wrap.append(count);track.addEventListener('scroll',()=>{const i=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));count.textContent=`${Math.min(urls.length,Math.max(1,i+1))} / ${urls.length}`},{passive:true})}return wrap;}
function openViewer(urls,index){const box=$('#imageViewer');let current=index;const render=()=>{$('#viewerImage').src=urls[current];$('#viewerCount').textContent=`${current+1} / ${urls.length}`;$('#viewerPrev').hidden=urls.length<2;$('#viewerNext').hidden=urls.length<2};const close=()=>{box.hidden=true;document.removeEventListener('keydown',keys)};const keys=e=>{if(e.key==='Escape')close();if(e.key==='ArrowLeft')move(1);if(e.key==='ArrowRight')move(-1)};const move=d=>{current=(current+d+urls.length)%urls.length;render()};$('#viewerClose').onclick=close;$('#viewerPrev').onclick=()=>move(-1);$('#viewerNext').onclick=()=>move(1);box.onclick=e=>{if(e.target===box)close()};box.hidden=false;render();document.addEventListener('keydown',keys);}
async function load(){const id=getPostId();if(!id){state('رابط المنشور غير مكتمل.');return;}if(!client){state('تعذر تشغيل الاتصال بقاعدة البيانات.');return;}
try{
 const {data:row,error}=await client.from('posts').select('*').eq('id',id).maybeSingle();
 if(error)throw error;if(!row){state('المنشور غير موجود أو لا تملك صلاحية مشاهدته.');return;}
 let profile=null;if(row.user_id){const r=await client.from('profiles').select('id,username,full_name,avatar_url').eq('id',row.user_id).maybeSingle();if(!r.error)profile=r.data;}
 const card=document.createElement('article');card.className='card';
 const author=document.createElement('header');author.className='author';const avatar=document.createElement('img');avatar.className='avatar';avatar.src=profile?.avatar_url||'/Egybook/assets/default-avatar.png';avatar.alt='';avatar.onerror=()=>{avatar.style.visibility='hidden'};const who=document.createElement('div');const name=document.createElement('div');name.className='author-name';name.textContent=profile?.full_name||profile?.username||'عضو EgyBook';const meta=document.createElement('div');meta.className='meta';meta.textContent=formatDate(row.created_at);who.append(name,meta);author.append(avatar,who);card.append(author);
 if(row.text){const text=document.createElement('div');text.className='body-text';text.textContent=row.text;card.append(text)}
 const urls=mediaList(row);const media=addMedia(row,urls);if(media)card.append(media);
 if(row.music_title){const music=document.createElement('div');music.className='body-text';music.textContent=`♫ ${row.music_title}${row.music_artist?' — '+row.music_artist:''}`;card.append(music)}
 const stats=document.createElement('div');stats.className='stats';stats.textContent='';card.append(stats);
 const comments=document.createElement('section');comments.className='comments';const h=document.createElement('h3');h.textContent='التعليقات';comments.append(h);
 const cr=await client.from('post_comments').select('id,user_id,user_name,body,created_at,profiles(full_name,username,avatar_url)').eq('post_id',id).order('created_at',{ascending:true}).limit(100);
 if(cr.error){const msg=document.createElement('p');msg.className='empty';msg.textContent='تعذر تحميل التعليقات حاليًا.';comments.append(msg)}else if(!cr.data?.length){const msg=document.createElement('p');msg.className='empty';msg.textContent='لا توجد تعليقات حتى الآن.';comments.append(msg)}else{cr.data.forEach(c=>{const item=document.createElement('div');item.className='comment';const pic=document.createElement('img');const cp=Array.isArray(c.profiles)?c.profiles[0]:c.profiles;pic.src=cp?.avatar_url||'';pic.alt='';const body=document.createElement('div');const n=document.createElement('strong');n.textContent=cp?.full_name||cp?.username||c.user_name||'عضو';const p=document.createElement('p');p.textContent=c.body||'';body.append(n,p);item.append(pic,body);comments.append(item)})}
 card.append(comments);main.replaceChildren(card);
 // Keep the clean permalink while serving the dedicated static post document.
 const canonical='/Egybook/post/'+encodeURIComponent(id);if(location.pathname!==canonical)history.replaceState({page:'standalone-post',postId:id},'',canonical);
 document.title=(profile?.full_name||'منشور')+' | EgyBook';
}catch(e){console.error('Standalone post load failed',e);state('تعذر تحميل المنشور. تحقق من الاتصال أو صلاحيات المشاهدة ثم أعد المحاولة.')}
}
$('#backBtn').addEventListener('click',()=>{if(history.length>1)history.back();else location.assign('/Egybook/')});
window.addEventListener('pageshow',()=>{document.documentElement.style.overflow='';document.body.style.overflow='';});
load();
})();
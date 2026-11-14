/* EgyBook media views v37 — event-driven, batched counts, session-based recording. */
(()=>{'use strict';
if(window.EgyBookViews?.version===37)return;
const $=(s,r=document)=>r.querySelector(s);
const countCache=new Map(),loadedIds=new Set(),pendingIds=new Set();
const mediaTimers=new WeakMap(),mediaSessions=new WeakMap(),observed=new WeakSet();
let client=null,userPromise=null,refreshTimer=0,io=null;
const fmt=n=>new Intl.NumberFormat('ar-EG',{notation:'compact',maximumFractionDigits:1}).format(Math.max(0,Number(n)||0));
const getClient=()=>window.__egybookSupabaseClient||window.supabaseClient||null;
const uuid=()=>window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
async function user(){client=getClient();if(!client?.auth)return null;if(!userPromise)userPromise=client.auth.getUser().then(({data,error})=>error?null:data?.user?.id||null).catch(()=>null);return userPromise;}
const validId=id=>/^[0-9a-f-]{36}$/i.test(String(id||''));
function postId(root){return String(root?.dataset?.postId||root?.dataset?.momentPost||root?.dataset?.reelId||'');}
function badge(root,place='preview'){
 if(!root)return null;
 let el=root.querySelector(':scope > .eb-media-views');
 if(!el){el=document.createElement('span');el.className=`eb-media-views eb-media-views-${place}`;el.setAttribute('aria-label','عدد المشاهدات');el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg><span>—</span>';root.append(el);}
 return el;
}
function paint(id,value){
 countCache.set(String(id),Number(value)||0);
 document.querySelectorAll(`[data-post-id="${CSS.escape(String(id))}"],[data-moment-post="${CSS.escape(String(id))}"],[data-reel-id="${CSS.escape(String(id))}"]`).forEach(root=>root.querySelectorAll('.eb-media-views span').forEach(n=>n.textContent=fmt(value)));
 const modal=$('#egybookVideoModal');if(modal?.dataset.postId===String(id))modal.querySelectorAll('#evpPostRail .eb-media-views span').forEach(n=>n.textContent=fmt(value));
}
async function fetchCounts(ids){
 client=getClient();if(!client||!ids.length)return;
 for(let i=0;i<ids.length;i+=80){
  const batch=ids.slice(i,i+80);
  const {data,error}=await client.rpc('get_post_media_view_counts',{p_post_ids:batch});
  if(error){console.warn('[EgyBook views] count batch unavailable:',error.message);batch.forEach(id=>pendingIds.add(id));continue;}
  (data||[]).forEach(row=>{const id=String(row.post_id);loadedIds.add(id);pendingIds.delete(id);paint(id,row.view_count)});
 }
}
async function record(id,kind,sessionId){
 id=String(id||'');if(!validId(id)||!sessionId)return false;
 const uid=await user();client=getClient();if(!uid||!client)return false;
 const args={p_post_id:id,p_media_kind:kind==='image'?'image':'video',p_view_session_id:sessionId};
 let result=await client.rpc('record_post_media_view',args);
 // Backward-compatible fallback until the V37 SQL migration is applied.
 if(result.error&&/function|schema cache|p_view_session_id|does not exist/i.test(result.error.message||'')){
  result=await client.rpc('record_post_media_view',{p_post_id:id,p_media_kind:args.p_media_kind});
 }
 if(result.error){console.warn('[EgyBook views] record failed:',result.error.message);return false;}
 if(result.data===true){paint(id,(countCache.get(id)||0)+1);window.dispatchEvent(new CustomEvent('egybook:media-view-counted',{detail:{postId:id,kind:kind==='image'?'image':'video'}}));return true;}
 return false;
}
function ensurePost(post){
 if(!post?.matches?.('.post'))return;
 const media=post.querySelector('.post-image,video.egybook-feed-video');
 if(!media)return;
 let wrap=media.parentElement;
 if(!wrap?.classList.contains('eb-view-preview-wrap')){
  if(wrap?.classList.contains('post-media-single-wrap'))wrap.classList.add('eb-view-preview-wrap');
  else{const parent=media.parentNode;if(!parent)return;wrap=document.createElement('div');wrap.className='eb-view-preview-wrap';parent.insertBefore(wrap,media);wrap.append(media);}
 }
 badge(wrap,'preview');
}
function ensurePlayer(){
 const rail=$('#evpPostRail'),box=$('#egybookVideoBox');
 if(rail&&box){box.classList.add('eb-view-positioned');badge(rail,'player');}
 const image=$('#imageViewer');if(image){image.classList.add('eb-view-positioned');badge(image,'player');}
}
function ensureMoments(){document.querySelectorAll('#momentsStrip [data-moment-post]').forEach(tile=>badge(tile,'moment'));}
function isVisible(media){
 if(document.hidden||!media.isConnected)return false;
 const r=media.getBoundingClientRect(),w=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0)),h=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));
 return r.width>0&&r.height>0&&(w*h)/(r.width*r.height)>=.55;
}
function clearTimer(media){const t=mediaTimers.get(media);if(t){clearTimeout(t);mediaTimers.delete(media)}}
function scheduleVideo(media){
 clearTimer(media);
 const sessionId=uuid();mediaSessions.set(media,sessionId);
 const start=Number(media.currentTime)||0;
 const t=setTimeout(()=>{
  mediaTimers.delete(media);
  if(media.isConnected&&!media.paused&&isVisible(media)&&(Number(media.currentTime)||0)-start>=2.2){
   const root=media.closest('.post')||($('#egybookVideoModal')?.contains(media)?$('#egybookVideoModal'):null);
   const id=postId(root)||String($('#egybookVideoModal')?.dataset.postId||'');
   void record(id,'video',sessionId);
  }
 },3200);
 mediaTimers.set(media,t);
}
function observeMedia(media){
 if(!media||observed.has(media))return;observed.add(media);
 if(io&&media.tagName==='VIDEO')io.observe(media);
}
function refresh(){
 document.querySelectorAll('#postsList .post,#profilePostsList .post').forEach(ensurePost);
 ensurePlayer();ensureMoments();
 document.querySelectorAll('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer').forEach(observeMedia);
 const ids=[...new Set([...document.querySelectorAll('#postsList .post[data-post-id],#profilePostsList .post[data-post-id],#momentsStrip [data-moment-post]')].map(postId).filter(validId))];
 const missing=ids.filter(id=>!loadedIds.has(id)&&!pendingIds.has(id));
 if(missing.length)void fetchCounts(missing);
}
function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,450);}
if('IntersectionObserver'in window){
 io=new IntersectionObserver(entries=>entries.forEach(entry=>{
  const media=entry.target;
  if(entry.isIntersecting&&entry.intersectionRatio>=.55&&!media.paused)scheduleVideo(media);
  else clearTimer(media);
 }),{threshold:[.55,.7]});
}
document.addEventListener('play',e=>{const media=e.target;if(media?.tagName==='VIDEO'&&(media.matches('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer')))scheduleVideo(media);},true);
document.addEventListener('pause',e=>{if(e.target?.tagName==='VIDEO')clearTimer(e.target)},true);
document.addEventListener('ended',e=>{if(e.target?.tagName==='VIDEO')clearTimer(e.target)},true);
document.addEventListener('egybook:media-view-open',e=>{
 const d=e.detail||{};if(!d.postId)return;
 const id=String(d.postId),kind=d.kind==='image'?'image':'video';
 if(kind==='image'){const sessionId=uuid();setTimeout(()=>{if(!document.hidden)void record(id,'image',sessionId)},1800);}
});
document.addEventListener('egybook:pagechange',schedule);
document.addEventListener('egybook:reels-feed-refresh',schedule);
document.addEventListener('egybook:moment-feed-refresh',schedule);
['postsList','profilePostsList','momentsStrip'].forEach(id=>{const node=document.getElementById(id);if(node)new MutationObserver(schedule).observe(node,{childList:true,subtree:true});});
client=getClient();if(client?.auth?.onAuthStateChange)client.auth.onAuthStateChange(()=>{userPromise=null;pendingIds.clear();schedule()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
window.EgyBookViews=Object.freeze({version:37,refresh,record,format:fmt});
})();

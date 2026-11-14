/* EgyBook media views — batched reads, lazy observation, no document-wide mutation loop. */
(()=>{'use strict';if(window.EgyBookViews)return;
const $=(s,r=document)=>r.querySelector(s);
let client=null,userPromise=null,refreshTimer=0,io=null;
const seen=new Set(),counts=new Map(),countedRoots=new WeakSet(),timers=new WeakMap();
const getClient=()=>window.__egybookSupabaseClient||window.supabaseClient||null;
async function user(){client=getClient();if(!client?.auth)return null;if(!userPromise)userPromise=client.auth.getUser().then(({data,error})=>error?null:data?.user?.id||null).catch(()=>null);return userPromise;}
const fmt=n=>new Intl.NumberFormat('ar-EG',{notation:'compact',maximumFractionDigits:1}).format(Math.max(0,Number(n)||0));
function makeBadge(root,placement='preview'){
 if(!root)return null;let el=root.querySelector(':scope > .eb-media-views');
 if(!el){el=document.createElement('span');el.className=`eb-media-views eb-media-views-${placement}`;el.setAttribute('aria-label','عدد المشاهدات');el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg><span>—</span>';root.append(el);}
 return el;
}
function postId(root){return String(root?.dataset?.postId||root?.dataset?.momentPost||root?.dataset?.reelId||'');}
function paint(id,value){counts.set(id,Number(value)||0);document.querySelectorAll(`[data-post-id="${CSS.escape(id)}"],[data-moment-post="${CSS.escape(id)}"],[data-reel-id="${CSS.escape(id)}"]`).forEach(root=>{const n=root.querySelector('.eb-media-views span');if(n)n.textContent=fmt(value);});}
async function fetchCounts(ids){
 client=getClient();if(!client||!ids.length)return;
 const {data,error}=await client.rpc('get_post_media_view_counts',{p_post_ids:ids});
 if(error){console.warn('[EgyBook views] counts unavailable:',error.message);return;}
 (data||[]).forEach(row=>paint(String(row.post_id),row.view_count));
}
function ensurePost(post){
 if(!post?.matches?.('.post'))return;
 const media=post.querySelector(':scope > .post-image,:scope > .post-media-single-wrap .post-image');
 if(!media)return;let wrap=media.parentElement;
 if(!wrap?.classList.contains('eb-view-preview-wrap')){
  if(wrap?.classList.contains('post-media-single-wrap'))wrap.classList.add('eb-view-preview-wrap');
  else{const parent=media.parentNode;if(!parent)return;wrap=document.createElement('div');wrap.className='eb-view-preview-wrap';parent.insertBefore(wrap,media);wrap.append(media);}
 }
 makeBadge(wrap,'preview');
}
function ensureReels(){
 document.querySelectorAll('#reelsStage .reel-feed-card').forEach(card=>{
  const rail=card.querySelector('.post-actions')||card;
  const badge=makeBadge(rail,'reels');
  badge.classList.add('eb-media-views-reels');
 });
}
function ensurePlayer(){
 const video=$('#egybookVideoBox');if(video){video.classList.add('eb-view-positioned');makeBadge(video,'player');}
 const image=$('#imageViewer');if(image){image.classList.add('eb-view-positioned');makeBadge(image,'player');}
}
function ensureMoments(){document.querySelectorAll('#momentsStrip [data-moment-post]').forEach(tile=>makeBadge(tile,'moment'));}
async function record(id,kind,root){
 id=String(id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return;
 const uid=await user();client=getClient();if(!uid||!client)return;
 const key=`${id}:${uid}:${new Date().toISOString().slice(0,10)}`;if(seen.has(key))return;seen.add(key);
 const {data,error}=await client.rpc('record_post_media_view',{p_post_id:id,p_media_kind:kind==='image'?'image':'video'});
 if(error){seen.delete(key);console.warn('[EgyBook views] record failed:',error.message);return;}
 if(data===true){paint(id,(counts.get(id)||0)+1);}
}
function observe(){
 if(!('IntersectionObserver'in window))return;
 if(io)io.disconnect();
 io=new IntersectionObserver(entries=>entries.forEach(entry=>{
  const media=entry.target;if(media.tagName!=='VIDEO')return;
  if(entry.isIntersecting&&entry.intersectionRatio>=.65&&!media.paused){
   if(!timers.has(media)){const t=setTimeout(()=>{timers.delete(media);if(media.isConnected&&!media.paused&&entry.target.closest('.post,.reel-feed-card')){const root=media.closest('.post,.reel-feed-card');record(postId(root),'video',root);}},3000);timers.set(media,t);}
  }else if(timers.has(media)){clearTimeout(timers.get(media));timers.delete(media);}
 }),{threshold:[.65]});
 document.querySelectorAll('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#reelsStage video.reel-feed-video').forEach(v=>io.observe(v));
}
function refresh(){
 document.querySelectorAll('#postsList .post,#profilePostsList .post').forEach(ensurePost);
 ensureReels();ensurePlayer();ensureMoments();observe();
 const roots=[...document.querySelectorAll('#postsList .post[data-post-id],#profilePostsList .post[data-post-id],#reelsStage .reel-feed-card[data-post-id],#momentsStrip [data-moment-post]')];
 const ids=[...new Set(roots.map(postId).filter(id=>/^[0-9a-f-]{36}$/i.test(id)&&!counts.has(id)))];
 if(ids.length)void fetchCounts(ids);
}
function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,160);}
document.addEventListener('play',e=>{
 const media=e.target;if(!media?.matches?.('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#reelsStage video.reel-feed-video'))return;
 const root=media.closest('.post,.reel-feed-card');if(!root)return;
 if(timers.has(media))clearTimeout(timers.get(media));
 const t=setTimeout(()=>{timers.delete(media);if(!media.paused&&media.isConnected){const r=media.getBoundingClientRect(),w=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0)),h=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));if(w*h/Math.max(1,r.width*r.height)>=.65)record(postId(root),'video',root);}},3000);timers.set(media,t);
},true);
document.addEventListener('pause',e=>{const media=e.target;if(timers.has(media)){clearTimeout(timers.get(media));timers.delete(media);}},true);
document.addEventListener('egybook:media-view-open',e=>{const d=e.detail||{};if(!d.postId)return;setTimeout(()=>{if(!document.hidden)record(d.postId,d.kind||'video',d.root||null);},1800);});
document.addEventListener('egybook:pagechange',schedule);
document.addEventListener('egybook:reels-feed-refresh',schedule);
document.addEventListener('egybook:moment-feed-refresh',schedule);
['postsList','profilePostsList','momentsStrip','reelsStage'].forEach(id=>{const root=document.getElementById(id);if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});});
client=getClient();if(client?.auth?.onAuthStateChange)client.auth.onAuthStateChange(()=>{userPromise=null;seen.clear();schedule();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
window.EgyBookViews=Object.freeze({refresh,record,format:fmt});
})();
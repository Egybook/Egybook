/* EgyBook Reels experience. Uses the canonical post markup/actions; only its presentation changes. */
(()=>{'use strict';
if(window.EgyBookReelsExperience)return;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const page=$('#reelsPage'),stage=$('#reelsStage'),drawer=$('#reelsDrawer');
if(!page||!stage||!drawer)return;
let drag=null,historyEntry=false,observer=null,buildQueued=false;
const key='egybook_reels_watch_history_v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch(_){return[]}};
function historyRender(){
 const root=$('#reelsHistoryList');if(!root)return;root.replaceChildren();const rows=read();
 if(!rows.length){root.textContent='ستظهر هنا الفيديوهات التي تشاهدها.';return;}
 rows.slice(0,15).forEach(x=>{const b=document.createElement('button');b.type='button';b.className='reels-history-item';b.textContent=x.title||'فيديو من الريلز';b.addEventListener('click',()=>{close(false);$(`[data-reel-id="${CSS.escape(x.id)}"]`,stage)?.scrollIntoView({behavior:'smooth'});});root.append(b);});
}
function addHistory(row){const rows=read().filter(x=>x.id!==row.id);rows.unshift(row);try{localStorage.setItem(key,JSON.stringify(rows.slice(0,30)));}catch(_){}historyRender();}
function pauseOthers(active){$$('video',stage).forEach(v=>{if(v!==active&&!v.paused)v.pause();});}
function build(){
 if(observer){observer.disconnect();observer=null;}
 const source=$('#postsList');
 const posts=$$('.post',source||document).filter(p=>p.querySelector('video.egybook-feed-video,video.post-image')&&p.dataset.postId);
 if(!posts.length){
  if(!stage.querySelector('.reel-feed-card'))stage.innerHTML='<div class="reels-empty"><span>▶</span><h2>لا توجد فيديوهات محملة</h2><p>ارجع للرئيسية وانتظر تحميل المنشورات، ثم افتح الريلز مرة أخرى.</p><button type="button" data-action="reels-upload">اختيار فيديو</button></div>';
  return;
 }
 stage.replaceChildren();
 posts.forEach((post,i)=>{
  const original=post.querySelector('video.egybook-feed-video,video.post-image');
  const src=original.currentSrc||original.src||original.getAttribute('src')||post.dataset.media;
  if(!src)return;
  const card=post.cloneNode(true);
  card.classList.add('reel-feed-card');
  card.dataset.reelId=String(post.dataset.postId);
  card.dataset.postId=String(post.dataset.postId);
  card.dataset.media=src;card.dataset.mediaType='video';
  // Keep the original social-action DOM and data attributes so delegated
  // like/comment/share/save handlers continue to use the same post record.
  const video=card.querySelector('video.egybook-feed-video,video.post-image');
  if(!video)return;
  video.classList.add('reel-feed-video');
  video.removeAttribute('controls');video.controls=false;video.loop=true;video.playsInline=true;
  video.preload=i===0?'auto':'metadata';video.muted=false;video.autoplay=false;
  video.src=src;if(original.poster)video.poster=original.poster;
  const commentArea=card.querySelector('.comments-area');if(commentArea)commentArea.hidden=true;
  const stats=card.querySelector('.post-stats');if(stats)stats.setAttribute('aria-hidden','true');
  const extra=document.createElement('div');extra.className='reel-feed-actions';
  extra.innerHTML='<button type="button" data-reel-action="sound" aria-label="كتم الصوت"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4zM17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12"/></svg></button><button type="button" data-reel-action="more" aria-label="المزيد"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>';
  card.append(extra);stage.append(card);
  video.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(video.paused)video.play().catch(()=>{});else video.pause();});
  video.addEventListener('play',()=>{pauseOthers(video);addHistory({id:card.dataset.reelId,title:card.querySelector('.post-text')?.textContent?.trim()||'فيديو من الريلز',watchedAt:Date.now()});});
  if(!observer)observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
   const media=entry.target.querySelector('video');
   if(entry.isIntersecting&&entry.intersectionRatio>=.65){pauseOthers(media);media?.play().catch(()=>{if(media){media.muted=true;media.play().catch(()=>{});}});}
   else media?.pause();
  }),{threshold:[.2,.65]});
  observer.observe(card);
 });
 window.EgyBookViews?.refresh?.();
}
function scheduleBuild(){if(buildQueued)return;buildQueued=true;requestAnimationFrame(()=>{buildQueued=false;if(!page.hidden)build();});}
function open(){
 if(drawer.classList.contains('is-open'))return;
 drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');
 $('.reels-menu-trigger')?.setAttribute('aria-expanded','true');
 $('.reels-brand-row')?.classList.add('menu-open');
 $('.reels-drawer-backdrop').hidden=false;document.body.classList.add('reels-drawer-open');
 if(!historyEntry){history.pushState({...history.state,reelsDrawer:true},'',location.href);historyEntry=true;}
}
function close(back=true){
 if(!drawer.classList.contains('is-open'))return;
 drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');
 $('.reels-menu-trigger')?.setAttribute('aria-expanded','false');
 $('.reels-brand-row')?.classList.remove('menu-open');
 $('.reels-drawer-backdrop').hidden=true;document.body.classList.remove('reels-drawer-open');
 if(back&&historyEntry&&history.state?.reelsDrawer){historyEntry=false;history.back();}else historyEntry=false;
}
document.addEventListener('click',e=>{
 if(e.target.closest('[data-reels-menu-open]')){open();return;}
 if(e.target.closest('[data-reels-menu-close]')){close();return;}
 const action=e.target.closest('[data-reel-action]');
 if(action){const video=action.closest('.reel-feed-card')?.querySelector('video');
  if(action.dataset.reelAction==='sound'&&video){video.muted=!video.muted;action.setAttribute('aria-label',video.muted?'تشغيل الصوت':'كتم الصوت');}
  else if(action.dataset.reelAction==='more')open();return;
 }
 const item=e.target.closest('[data-reels-drawer-action]');
 if(item){const act=item.dataset.reelsDrawerAction;close();
  if(act==='upload')$('#reelUploadInput')?.click();
  else if(act==='history')$('#reelsHistoryList')?.scrollIntoView({behavior:'smooth'});
  else if(act==='profile')document.querySelector('.bottom-item[data-page="profile"]')?.click();
 }
});
$('.reels-drawer-backdrop')?.addEventListener('click',()=>close());
drawer.addEventListener('pointerdown',e=>{if(e.target.closest('button,a,input'))return;drag={id:e.pointerId,y:e.clientY};});
drawer.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dy=e.clientY-drag.y;if(dy>0){drawer.style.transition='none';drawer.style.transform=`translate3d(0,${dy}px,0)`;}});
drawer.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const dy=e.clientY-drag.y;drag=null;drawer.style.transition='';drawer.style.transform='';if(dy>110)close();});
drawer.addEventListener('pointercancel',()=>{drag=null;drawer.style.transition='';drawer.style.transform='';});
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
window.addEventListener('popstate',()=>{if(drawer.classList.contains('is-open')){historyEntry=false;close(false);}});
function mount(){
 if(page.hidden){document.body.classList.remove('egybook-reels-active');return;}
 document.body.classList.add('egybook-reels-active');
 document.querySelectorAll('.bottom-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page==='reels'));
 build();historyRender();
}
new MutationObserver(()=>{if(!page.hidden)mount();}).observe(page,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('egybook:pagechange',e=>{if(e.detail?.page==='reels')mount();else document.body.classList.remove('egybook-reels-active');});
document.addEventListener('egybook:reels-feed-refresh',scheduleBuild);
window.EgyBookReelsExperience={mount,openDrawer:open,closeDrawer:close,refresh:build};
})();
/* EgyBook Reels: presentation shell for the canonical EgyBook video player. */
(()=>{'use strict';
if(window.EgyBookReelsExperience)return;
const $=(s,r=document)=>r.querySelector(s);
const page=$('#reelsPage'),stage=$('#reelsStage'),drawer=$('#reelsDrawer'),backdrop=$('.reels-drawer-backdrop');
if(!page||!stage||!drawer)return;
let historyEntry=false,activePostId='',openQueued=false,drag=null;
const historyKey='egybook_reels_watch_history_v1';
const readHistory=()=>{try{return JSON.parse(localStorage.getItem(historyKey)||'[]')}catch(_){return[]}};
function renderHistory(){const host=$('#reelsHistoryList');if(!host)return;host.replaceChildren();const rows=readHistory();if(!rows.length){host.textContent='ستظهر هنا الفيديوهات التي تشاهدها.';return;}rows.slice(0,15).forEach(row=>{const b=document.createElement('button');b.type='button';b.className='reels-history-item';b.textContent=row.title||'فيديو من الريلز';b.addEventListener('click',()=>{closeDrawer();const post=findPosts().find(p=>p.dataset.postId===row.id);if(post)openPost(post);});host.append(b);});}
function findPosts(){return Array.from($('#postsList')?.querySelectorAll('.post[data-post-id]')||[]).filter(post=>post.querySelector('video.egybook-feed-video,video.post-image'));}
function openPost(post){if(!post||!window.EgyBookUnifiedVideoPlayer?.openFromReels)return false;const id=String(post.dataset.postId||'');if(id===activePostId&&window.EgyBookUnifiedVideoPlayer.isOpen())return true;activePostId=id;return window.EgyBookUnifiedVideoPlayer.openFromReels(post);}
function build(){
 const posts=findPosts();
 if(!posts.length){stage.innerHTML='<div class="reels-empty"><span>▶</span><h2>لا توجد فيديوهات متاحة حاليًا</h2><p>ارجع للرئيسية وانتظر تحميل الفيديوهات، ثم افتح الريلز مرة أخرى.</p><button type="button" data-action="reels-upload">اختيار فيديو</button></div>';return;}
 stage.replaceChildren();
 // Start in the shared video player; stage is only a routing surface, never a cloned post/player.
 if(!window.EgyBookUnifiedVideoPlayer){stage.textContent='مشغل الفيديو غير جاهز بعد.';return;}
 const target=posts.find(p=>p.dataset.postId===activePostId)||posts[0];
 if(!openQueued){openQueued=true;requestAnimationFrame(()=>{openQueued=false;if(!page.hidden&&document.body.classList.contains('egybook-reels-active'))openPost(target);});}
}
function openDrawer(){if(drawer.classList.contains('is-open'))return;drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');document.querySelectorAll('[data-reels-menu-open]').forEach(b=>b.setAttribute('aria-expanded','true'));$('.evp-brandline')?.classList.add('reels-menu-open');$('.reels-brand-row')?.classList.add('menu-open');if(backdrop)backdrop.hidden=false;document.body.classList.add('reels-drawer-open');if(!historyEntry){history.pushState({...history.state,reelsDrawer:true},'',location.href);historyEntry=true;}}
function closeDrawer(back=true){if(!drawer.classList.contains('is-open'))return;drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');document.querySelectorAll('[data-reels-menu-open]').forEach(b=>b.setAttribute('aria-expanded','false'));$('.evp-brandline')?.classList.remove('reels-menu-open');$('.reels-brand-row')?.classList.remove('menu-open');if(backdrop)backdrop.hidden=true;document.body.classList.remove('reels-drawer-open');if(back&&historyEntry&&history.state?.reelsDrawer){historyEntry=false;history.back();}else historyEntry=false;}
// Drawer is lifted out of the Reels page stacking context so it can appear above the unified modal.
if(drawer.parentElement!==document.body)document.body.append(drawer);
if(backdrop&&backdrop.parentElement!==document.body)document.body.append(backdrop);
document.addEventListener('click',e=>{
 if(e.target.closest('[data-reels-menu-open]')){openDrawer();return;}
 if(e.target.closest('[data-reels-menu-close]')){closeDrawer();return;}
 const item=e.target.closest('[data-reels-drawer-action]');if(item){const action=item.dataset.reelsDrawerAction;closeDrawer();if(action==='upload')$('#reelUploadInput')?.click();else if(action==='history')$('#reelsHistoryList')?.scrollIntoView({behavior:'smooth'});else if(action==='profile')document.querySelector('.bottom-item[data-page="profile"]')?.click();}
});
backdrop?.addEventListener('click',()=>closeDrawer());
drawer.addEventListener('pointerdown',e=>{if(e.target.closest('button,a,input'))return;drag={id:e.pointerId,y:e.clientY};});
drawer.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dy=e.clientY-drag.y;if(dy>0){drawer.style.transition='none';drawer.style.transform=`translate3d(0,${dy}px,0)`;}});
drawer.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const dy=e.clientY-drag.y;drag=null;drawer.style.transition='';drawer.style.transform='';if(dy>100)closeDrawer();});
drawer.addEventListener('pointercancel',()=>{drag=null;drawer.style.transition='';drawer.style.transform='';});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
window.addEventListener('popstate',()=>{if(drawer.classList.contains('is-open')){historyEntry=false;closeDrawer(false);}});
function mount(){if(page.hidden){document.body.classList.remove('egybook-reels-active');activePostId='';return;}document.body.classList.add('egybook-reels-active');document.querySelectorAll('.bottom-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page==='reels'));renderHistory();build();}
new MutationObserver(()=>{if(!page.hidden)mount();}).observe(page,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('egybook:pagechange',e=>{if(e.detail?.page==='reels')mount();else{document.body.classList.remove('egybook-reels-active');if(drawer.classList.contains('is-open'))closeDrawer(false);}});
document.addEventListener('egybook:reels-feed-refresh',()=>{if(!page.hidden){openQueued=false;build();}});
document.addEventListener('egybook:media-view-open',e=>{if(page.hidden||e.detail?.kind!=='video'||!e.detail?.postId)return;const post=findPosts().find(p=>p.dataset.postId===String(e.detail.postId));if(post){activePostId=String(e.detail.postId);const rows=readHistory().filter(x=>x.id!==activePostId);rows.unshift({id:activePostId,title:post.querySelector('.post-text')?.textContent?.trim()||'فيديو من الريلز',watchedAt:Date.now()});try{localStorage.setItem(historyKey,JSON.stringify(rows.slice(0,30)));}catch(_){}renderHistory();}});
window.EgyBookReelsExperience={mount,openDrawer,closeDrawer,refresh:build};
})();

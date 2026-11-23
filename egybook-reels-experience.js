/* EgyBook Reels v40: independent source with measured viewport/nav clearance. */
(()=>{
  'use strict';
  if(window.EgyBookReelsExperience?.version==='40.1')return;

  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const page=$('#reelsPage'),stage=$('#reelsStage'),drawer=$('#reelsDrawer');
  const backdrop=$('#reelsDrawerBackdrop'),modal=$('#egybookVideoModal');
  const bottomNav=$('.bottom-navigation');
  if(!page||!stage||!drawer||!backdrop||!modal)return;

  const historyKey='egybook_reels_watch_history_v1';
  const shareKey='egybook_reels_share_history_v1';
  let activePostId='',openQueued=false,drag=null,historyEntry=false,mountPromise=null;
  let mountPromiseToken=0,routeActivationToken=0;
  // Called by the main router before leaving Reels, including routes that do
  // not emit egybook:pagechange (Messages, Notifications and Profile).
  window.__egybookInvalidateReelsNavigation=()=>{routeActivationToken++;};
  let navResizeObserver=null,thumbnailObserver=null;

  const read=(key)=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch(_){return[]}};
  const write=(key,rows)=>{try{localStorage.setItem(key,JSON.stringify(rows.slice(0,40)))}catch(_){}};

  function syncBottomNavClearance(){
    if(!bottomNav)return;
    const rect=bottomNav.getBoundingClientRect();
    if(!Number.isFinite(rect.top)||rect.height<=0)return;
    const viewport=window.visualViewport;
    const layoutHeight=document.documentElement.clientHeight||window.innerHeight;
    const viewportBottom=viewport?Math.min(layoutHeight,viewport.offsetTop+viewport.height):layoutHeight;
    const clearance=Math.max(70,Math.min(layoutHeight,Math.ceil(viewportBottom-rect.top)));
    document.documentElement.style.setProperty('--eb-reels-nav-clearance',`${clearance}px`);
    const controls=$('.evp-controls',modal);
    const controlsHeight=controls?.getBoundingClientRect().height||0;
    if(controlsHeight>0&&controlsHeight<120){
      document.documentElement.style.setProperty('--eb-reels-controls-height',`${Math.ceil(controlsHeight)}px`);
    }
  }

  function ensureReelsHistoryContext(){
    if(!/\/reels\/?$/i.test(location.pathname))return;
    const state=history.state&&typeof history.state==='object'?history.state:{};
    if(state.page!=='reels'||state.reelsDrawer){
      const next={...state,page:'reels'};
      delete next.reelsDrawer;
      try{history.replaceState(next,'',location.href)}catch(_){}
    }
  }

  function hasHealthyRetainedPlayer(){
    if(!modal.classList.contains('open')||modal.hidden||!modal.classList.contains('evp-reels-context'))return false;
    const player=$('#egybookVideoPlayer');
    if(!player)return false;
    const source=String(player.currentSrc||player.getAttribute('src')||player.dataset.egybookOriginalSource||'').trim();
    const health=window.EgyBookReelsSessionHealth?.inspect?.(modal,player);
    if(!source||player.error||Number(player.networkState)===3)return false;
    if(health?.status==='failed'||health?.status==='missing-source')return false;
    // HAVE_METADATA is not enough to paint a frame. Treat only a decoded
    // current frame as a healthy retained Reels surface; loading/metadata-only
    // leases must continue through the recovery coordinator.
    return Number(player.readyState)>=2&&Number(player.videoWidth)>0&&Number(player.videoHeight)>0;
  }

  function findPosts(){
    // The Reels library is backed only by the independent Reels query. Home
    // cards are deliberately not a fallback source for this route.
    return window.EgyBookVideoSourceManager?.getReelsPosts?.()||[];
  }

  function openPost(post){
    if(!post||!window.EgyBookUnifiedVideoPlayer?.openFromReels)return false;
    const id=String(post.dataset.postId||'');
    if(id===activePostId&&window.EgyBookUnifiedVideoPlayer.isOpen())return true;
    const alreadyOpen=window.EgyBookUnifiedVideoPlayer.isOpen();
    activePostId=id;
    return alreadyOpen
      ?(window.EgyBookUnifiedVideoPlayer.navigateFromReels?.(post)||false)
      :window.EgyBookUnifiedVideoPlayer.openFromReels(post);
  }

  function mount(token=routeActivationToken){
    if(!token){token=++routeActivationToken;}
    page.hidden=true;
    document.body.classList.add('egybook-reels-active');
    if(window.__egybookSyncPrimaryNavigationActive)window.__egybookSyncPrimaryNavigationActive('reels');
    else $$('.top-nav-item[data-page],.bottom-item[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page==='reels'));
    syncBottomNavClearance();
    ensureReelsHistoryContext();
    // A route-suspended player without a decoded frame must not be exposed as
    // an empty modal. Reopen a cached/available Reels item through the same
    // canonical player, preferring a different item and falling back to the
    // same post from 0:00 only when it is the only available item.
    const returnRecovery=window.EgyBookReelsReturnRecoveryV232;
    const retainedPlayer=$('#egybookVideoPlayer');
    if(returnRecovery?.shouldFallback?.(modal,retainedPlayer)){
      const isCurrent=()=>token===routeActivationToken&&document.body.classList.contains('egybook-reels-active');
      const recovery=returnRecovery.recover({isCurrent,routeToken:token});
      const pendingRecovery=Promise.resolve(recovery).then(result=>{
        if(result?.ok){activePostId=String(result.post?.dataset?.postId||modal.dataset.postId||activePostId||'');return true;}
        if(!isCurrent())return false;
        const toast=$('#toast');
        if(toast){toast.textContent='تعذر استعادة فيديو الريلز الآن. حاول مرة أخرى.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3200);}
        return false;
      });
      mountPromise=pendingRecovery;mountPromiseToken=token;
      pendingRecovery.finally(()=>{if(mountPromise===pendingRecovery){mountPromise=null;mountPromiseToken=0;}});
      return pendingRecovery;
    }
    // Preserve the original same-video resume path whenever an actual frame is
    // already available. The fallback coordinator above handles stale leases.
    if(window.EgyBookUnifiedVideoPlayer?.resumeFromNavigation?.()){
      activePostId=String(modal.dataset.postId||activePostId||'');
      return Promise.resolve(true);
    }
    // Keep a healthy retained element alive. If its source has errored or was
    // cleared, continue through the source manager so the same reel can be
    // reopened through the existing canonical player instead of trapping the
    // selected tab behind a black, already-open modal.
    if(hasHealthyRetainedPlayer())return Promise.resolve(true);
    if(mountPromise&&mountPromiseToken===token)return mountPromise;

    const pending=(async()=>{
      const manager=window.EgyBookVideoSourceManager;
      if(!manager?.openReels){
        if(!openQueued){
          openQueued=true;
          setTimeout(()=>{
            openQueued=false;
            if(token===routeActivationToken&&document.body.classList.contains('egybook-reels-active'))mount(token);
          },500);
        }
        return false;
      }
      const isCurrent=()=>token===routeActivationToken&&document.body.classList.contains('egybook-reels-active');
      const result=await manager.openReels({isCurrent}).catch(error=>({ok:false,error,empty:false}));
      if(!isCurrent())return false;
      if(result?.ok){activePostId=String(result.post?.dataset?.postId||'');return true;}
      if(result?.stale)return false;
      const toast=$('#toast');
      if(toast){
        toast.textContent=result?.error?'تعذر تحميل فيديوهات الريلز الآن. تحقق من الاتصال وحاول مرة أخرى.':'لا توجد فيديوهات متاحة لك حاليًا.';
        toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3200);
      }
      return false;
    })();
    mountPromise=pending;
    mountPromiseToken=token;
    pending.then(()=>{if(mountPromise===pending){mountPromise=null;mountPromiseToken=0;}},()=>{if(mountPromise===pending){mountPromise=null;mountPromiseToken=0;}});
    return pending;
  }

  function savedPosts(){
    return findPosts().filter(post=>{
      const button=post.querySelector('.post-actions [data-action="save"]');
      return button?.classList.contains('is-active')||button?.getAttribute('aria-pressed')==='true'||post.classList.contains('is-saved');
    });
  }
  function likedPosts(){
    return findPosts().filter(post=>{
      const button=post.querySelector('.post-actions [data-action="react"],.post-actions [data-action="like"]');
      return button?.classList.contains('is-active')||button?.getAttribute('aria-pressed')==='true'||post.querySelector('.post-actions .reaction-selected');
    });
  }
  function sharedPosts(){
    const ids=new Set(read(shareKey).map(row=>String(row.id)));
    return findPosts().filter(post=>ids.has(String(post.dataset.postId)));
  }
  function watchedPosts(){
    const ids=new Set(read(historyKey).map(row=>String(row.id)));
    return findPosts().filter(post=>ids.has(String(post.dataset.postId)));
  }

  function videoSource(post,media){
    return String(media?.currentSrc||media?.getAttribute?.('src')||media?.dataset?.feedSrc||media?.src||post?.dataset?.media||'').trim();
  }
  function posterSource(post,media){
    return String(media?.poster||post?.dataset?.mediaPoster||post?.dataset?.posterUrl||post?.dataset?.posterImage||post?.dataset?.musicArtwork||'').trim();
  }
  function snapshotVideo(video){
    if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)return '';
    try{
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,480/video.videoWidth);
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)return '';
      context.drawImage(video,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',.76);
    }catch(_){return '';}
  }
  function makeImagePreview(src,card,onError=null){
    const image=document.createElement('img');
    image.src=src;image.alt='';image.loading='lazy';image.decoding='async';image.setAttribute('aria-hidden','true');
    image.addEventListener('error',()=>{
      image.remove();
      if(typeof onError==='function')onError();
      else if(!card.querySelector('video.reels-card-video'))card.classList.add('has-no-thumbnail');
    },{once:true});
    card.append(image);
  }
  function hydrateVideoPreview(video){
    if(video.dataset.reelsLoaded==='1')return;
    const src=video.dataset.thumbSrc;
    if(!src)return;
    video.dataset.reelsLoaded='1';
    video.src=src;video.preload='metadata';
    const seekFrame=()=>{
      if(!Number.isFinite(video.duration)||video.duration<=0)return;
      try{video.currentTime=Math.min(.18,video.duration*.04)}catch(_){}
    };
    video.addEventListener('loadedmetadata',seekFrame,{once:true});
    video.addEventListener('loadeddata',()=>{video.classList.add('is-ready');video.pause()},{once:true});
    video.addEventListener('seeked',()=>{video.classList.add('is-ready');video.pause()},{once:true});
    video.addEventListener('error',()=>{
      const card=video.closest('.reels-saved-card');
      video.remove();card?.classList.add('has-no-thumbnail');
    },{once:true});
    video.load();
  }
  function observeVideoPreview(video){
    if(!thumbnailObserver){
      if('IntersectionObserver'in window){
        thumbnailObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
          if(!entry.isIntersecting)return;
          hydrateVideoPreview(entry.target);
          thumbnailObserver.unobserve(entry.target);
        }),{root:null,rootMargin:'120px',threshold:.01});
      }
    }
    if(thumbnailObserver)thumbnailObserver.observe(video);
    else hydrateVideoPreview(video);
  }
  function addVideoPreview(post,media,card){
    const addDecodedPreview=()=>{
      const snapshot=snapshotVideo(media);
      if(snapshot){makeImagePreview(snapshot,card,()=>addVideoStreamPreview(post,media,card));return;}
      addVideoStreamPreview(post,media,card);
    };
    const poster=posterSource(post,media);
    if(poster){makeImagePreview(poster,card,addDecodedPreview);return;}
    addDecodedPreview();
  }
  function addVideoStreamPreview(post,media,card){
    const src=videoSource(post,media);
    if(!src){card.classList.add('has-no-thumbnail');return;}
    const preview=document.createElement('video');
    preview.className='reels-card-video';preview.dataset.thumbSrc=src;
    preview.muted=true;preview.playsInline=true;preview.preload='none';preview.controls=false;
    preview.disablePictureInPicture=true;preview.setAttribute('aria-hidden','true');
    preview.setAttribute('tabindex','-1');preview.setAttribute('playsinline','');preview.setAttribute('muted','');
    card.append(preview);observeVideoPreview(preview);
  }

  function cardFor(post){
    const card=document.createElement('button');
    card.type='button';card.className='reels-saved-card';
    const media=post.querySelector('video.egybook-feed-video,video.post-image,img.post-image');
    if(media?.tagName==='VIDEO')addVideoPreview(post,media,card);
    else{
      const src=String(media?.currentSrc||media?.src||'').trim();
      if(src)makeImagePreview(src,card);else card.classList.add('has-no-thumbnail');
    }
    const play=document.createElementNS('http://www.w3.org/2000/svg','svg');
    play.setAttribute('viewBox','0 0 24 24');play.setAttribute('aria-hidden','true');play.classList.add('reels-card-play');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M8 5.5v13l10-6.5z');play.append(path);card.append(play);
    const title=document.createElement('span');title.className='reels-card-title';
    title.textContent=post.querySelector('.post-text')?.textContent?.trim().slice(0,60)||'فيديو من الريلز';
    card.append(title);
    card.addEventListener('click',()=>{closeDrawer();openPost(post)});
    return card;
  }

  function renderSaved(){
    const host=$('#reelsSavedStrip');if(!host)return;
    host.replaceChildren();
    const rows=savedPosts().slice(0,12);
    if(!rows.length){const empty=document.createElement('p');empty.className='reels-library-empty';empty.textContent='ستظهر هنا مقاطع الريلز التي حفظتها.';host.append(empty);return;}
    rows.forEach(post=>host.append(cardFor(post)));
  }
  function renderList(kind){
    const map={
      saved:['مقاطع الريلز المحفوظة',savedPosts()],
      liked:['مقاطع الريلز التي أعجبتك',likedPosts()],
      shared:['مقاطع الريلز التي شاركتها',sharedPosts()],
      watched:['مقاطع الريلز التي شاهدتها',watchedPosts()]
    };
    const [title,posts]=map[kind]||map.watched;
    $('#reelsLibraryResultsTitle').textContent=title;
    const host=$('#reelsLibraryResultsList');host.replaceChildren();
    if(!posts.length){const empty=document.createElement('p');empty.className='reels-library-empty';empty.textContent='لا توجد مقاطع متاحة في هذه القائمة حاليًا.';host.append(empty);}
    else posts.slice(0,40).forEach(post=>host.append(cardFor(post)));
    $('#reelsLibraryResults').hidden=false;
    $('#reelsLibraryResults').setAttribute('aria-live','polite');
    $('#reelsLibraryResults').scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function openDrawer(){
    if(drawer.classList.contains('is-open'))return;
    renderSaved();$('#reelsLibraryResults').hidden=true;
    drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');
    $$('[data-reels-menu-open]').forEach(button=>button.setAttribute('aria-expanded','true'));
    $('.evp-brandline')?.classList.add('reels-menu-open');
    backdrop.hidden=false;document.body.classList.add('reels-drawer-open');
    syncBottomNavClearance();
    if(!historyEntry){
      const state=history.state&&typeof history.state==='object'?history.state:{};
      try{history.pushState({...state,page:'reels',reelsDrawer:true},'',location.href);historyEntry=true}
      catch(_){historyEntry=false}
    }
  }
  function closeDrawer({fromPopstate=false,fromRouteChange=false}={}){
    if(!drawer.classList.contains('is-open'))return;
    drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');
    $$('[data-reels-menu-open]').forEach(button=>button.setAttribute('aria-expanded','false'));
    $('.evp-brandline')?.classList.remove('reels-menu-open');
    backdrop.hidden=true;document.body.classList.remove('reels-drawer-open');
    if(historyEntry&&!fromPopstate&&!fromRouteChange){
      // Closing the drawer is a UI operation, not route navigation. Do not call
      // history.back(): the entry beneath /reels may be Home on restored sessions.
      const state=history.state&&typeof history.state==='object'?history.state:{};
      const next={...state,page:'reels'};delete next.reelsDrawer;
      try{history.replaceState(next,'','/Egybook/reels');}catch(_){try{history.replaceState(next,'',location.href)}catch(__){}}
    }
    historyEntry=false;
  }

  if(drawer.parentElement!==document.body)document.body.append(drawer);
  if(backdrop.parentElement!==document.body)document.body.append(backdrop);

  document.addEventListener('click',event=>{
    if(event.target.closest('[data-reels-menu-open]')){openDrawer();return;}
    if(event.target.closest('[data-reels-menu-close]')){closeDrawer();return;}
    const item=event.target.closest('[data-reels-library-action]');
    if(!item)return;
    const action=item.dataset.reelsLibraryAction;
    if(action==='profile'){
      closeDrawer({fromRouteChange:true});$('.bottom-item[data-action="profile"]')?.click();return;
    }
    renderList(action);
  });
  backdrop.addEventListener('click',()=>closeDrawer());

  drawer.addEventListener('pointerdown',event=>{
    if(event.target.closest('button,a,input,label'))return;
    drag={id:event.pointerId,y:event.clientY};
  });
  drawer.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const delta=event.clientY-drag.y;
    if(delta>0){drawer.style.transition='none';drawer.style.transform=`translate3d(0,${delta}px,0)`;}
  });
  drawer.addEventListener('pointerup',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const delta=event.clientY-drag.y;drag=null;drawer.style.transition='';drawer.style.transform='';
    if(delta>95)closeDrawer();
  });
  drawer.addEventListener('pointercancel',()=>{drag=null;drawer.style.transition='';drawer.style.transform='';});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDrawer()});

  // Browser Back/Android edge-swipe closes only the drawer. It must not bubble
  // into routeFromLocation, which could otherwise reveal Home behind the player.
  window.addEventListener('popstate',event=>{
    if(!drawer.classList.contains('is-open'))return;
    // Capture before route handlers: system Back dismisses this layer only.
    event.stopImmediatePropagation();
    closeDrawer({fromPopstate:true});
    const state=history.state&&typeof history.state==='object'?history.state:{};
    try{history.pushState({...state,page:'reels'},'','/Egybook/reels');}catch(_){
      try{history.replaceState({...state,page:'reels'},'','/Egybook/reels')}catch(__){}
    }
  },true);

  window.addEventListener('egybook:evp-post-context',event=>{
    const post=event.detail?.post,box=$('#evpReelsDescription');
    if(!box)return;
    const inReels=document.body.classList.contains('egybook-reels-active')||modal.classList.contains('evp-reels-context');
    if(!inReels){box.hidden=true;return;}
    if(post?.dataset?.postId)activePostId=String(post.dataset.postId);
    const text=post?.querySelector('.post-text')?.textContent?.trim()||'';
    box.textContent=text;box.hidden=!text;
    requestAnimationFrame(syncBottomNavClearance);
  });

  document.addEventListener('click',event=>{
    const share=event.target.closest('#egybookVideoBox [data-evp="post-share"]');
    if(!share||!document.body.classList.contains('egybook-reels-active'))return;
    const post=share.closest('.post')||findPosts().find(item=>String(item.dataset.postId||'')===String(modal.dataset.postId||''));
    const id=String(post?.dataset.postId||modal.dataset.postId||'');
    if(id){const rows=read(shareKey).filter(row=>String(row.id)!==id);rows.unshift({id,at:Date.now()});write(shareKey,rows);}
  },true);

  document.addEventListener('egybook:media-view-counted',event=>{
    if(!document.body.classList.contains('egybook-reels-active')||event.detail?.kind!=='video'||!event.detail?.postId)return;
    const post=findPosts().find(item=>item.dataset.postId===String(event.detail.postId));
    const id=String(event.detail.postId);
    const rows=read(historyKey).filter(row=>String(row.id)!==id);
    rows.unshift({id,title:post?.querySelector('.post-text')?.textContent?.trim()||'فيديو من الريلز',watchedAt:Date.now()});
    write(historyKey,rows);
  });

  const cellular=$('#reelsCellularData');
  if(cellular){
    cellular.checked=localStorage.getItem('egybook_reels_cellular_data')!=='off';
    cellular.addEventListener('change',()=>{
      localStorage.setItem('egybook_reels_cellular_data',cellular.checked?'on':'off');
      const player=$('#egybookVideoPlayer');if(player)player.preload=cellular.checked?'auto':'metadata';
      document.dispatchEvent(new CustomEvent('egybook:reels-data-setting',{detail:{cellular:cellular.checked}}));
    });
  }

  document.addEventListener('egybook:pagechange',event=>{
    if(event.detail?.page==='reels'){
      const token=++routeActivationToken;
      mount(token);
    }
    else{
      // Invalidate every in-flight open request before it can create a player
      // after the user has already moved to another page.
      routeActivationToken++;
      document.body.classList.remove('egybook-reels-active');
      if(drawer.classList.contains('is-open'))closeDrawer({fromRouteChange:true});
      $('#evpReelsDescription').hidden=true;
    }
  });
  document.addEventListener('egybook:reels-feed-refresh',()=>{
    if(document.body.classList.contains('egybook-reels-active'))mount(routeActivationToken);
  });

  window.addEventListener('resize',syncBottomNavClearance,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(syncBottomNavClearance,80),{passive:true});
  window.visualViewport?.addEventListener('resize',syncBottomNavClearance,{passive:true});
  window.visualViewport?.addEventListener('scroll',syncBottomNavClearance,{passive:true});
  if('ResizeObserver'in window&&bottomNav){
    navResizeObserver=new ResizeObserver(syncBottomNavClearance);
    navResizeObserver.observe(bottomNav);
    const controls=$('.evp-controls',modal);if(controls)navResizeObserver.observe(controls);
  }
  syncBottomNavClearance();
  window.EgyBookReelsExperience=Object.freeze({version:'40.1',mount,openDrawer,closeDrawer,refresh:mount});
})();

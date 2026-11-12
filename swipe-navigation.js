/* EgyBook Smart Media Engine — finger-tracked vertical media navigation.
 * The core player remains the sole owner of playback and audio. This module
 * only previews the adjacent queue item silently, animates the gesture, and
 * asks the core player to commit the selected queue item.
 */
(()=>{
 'use strict';
 const modal=document.getElementById('egybookVideoModal');
 const box=document.getElementById('egybookVideoBox');
 const player=document.getElementById('egybookVideoPlayer');
 const poster=document.getElementById('egybookVideoPoster');
 if(!modal||!box||!player||!poster)return;
 const REDUCED=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 // One consistent threshold and one transition path for all full-screen media.
 const SWIPE_MIN_DISTANCE=62,SWIPE_VIEWPORT_RATIO=.095;
 const FLING_SPEED=.30,FLING_MIN_DISTANCE=26;
 const COMMIT_MS=320,RETURN_MS=260,GAP=0;
 let pointer=null,preview=null,dragging=false,transitioning=false,startX=0,startY=0,lastY=0,lastAt=0,velocity=0,height=0,activeMedia=null,samples=[],dragFrame=0,pendingDistance=0;
 const interactive='button,a,input,textarea,select,[role="button"],.evp-post-rail,.evp-controls,.evp-top-actions,.evp-reaction-picker';
 const visible=()=>modal.classList.contains('open')&&!modal.hidden;
 const clean=()=>{if(preview){pausePreviewPlayback(preview);preview.dispose?.();preview.remove();preview=null;}[player,poster].forEach(el=>{el.style.transition='';el.style.transform='';});box.classList.remove('evp-swipe-dragging','evp-next-media-loading');};
 const sourceFor=(direction)=>window.__egybookEvpQueueState?.(direction)||null;
 const pausePreviewPlayback=(node)=>{
   const media=node?.querySelector?.('video');
   if(media){try{media.pause();}catch(_){}}
 };
 function buildPreview(item,direction){
   if(!item?.available)return null;
   const shell=document.createElement('div');shell.className='evp-swipe-preview';shell.dataset.previewKind=item.kind||'video';shell.setAttribute('aria-hidden','true');
   let media,still=null,resolveReady,readyTimer=0;
   const listenerCleanup=[];
   const listen=(node,type,handler,options={})=>{
     node.addEventListener(type,handler,options);
     listenerCleanup.push(()=>node.removeEventListener(type,handler,!!options.capture));
   };
   shell.dispose=()=>{while(listenerCleanup.length){try{listenerCleanup.pop()();}catch(_){}}};
   shell.previewReady=new Promise(resolve=>{resolveReady=resolve;});
   let readinessSettled=false;
   const settleReady=(ok)=>{if(readinessSettled)return;readinessSettled=true;clearTimeout(readyTimer);readyTimer=0;shell.dataset.previewReady=ok?'1':'0';resolveReady(!!ok);};
   // Bound video preview loading so a failed adjacent source cannot hold a
   // released gesture in a displaced state indefinitely.
   readyTimer=setTimeout(()=>settleReady(false),5000);
   const paintReady=()=>{
     if(!media)return;
     if(media.tagName==='IMG'){
       if(media.complete&&media.naturalWidth>0&&media.naturalHeight>0){
         const done=()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>settleReady(true)));};
         if(typeof media.decode==='function')media.decode().then(done).catch(done);else done();
       }
       return;
     }
     if(media.readyState>=2&&media.videoWidth>0&&media.videoHeight>0){
       const markPresented=()=>settleReady(true);
       if(typeof media.requestVideoFrameCallback==='function'){try{media.requestVideoFrameCallback(markPresented);}catch(_){requestAnimationFrame(()=>requestAnimationFrame(markPresented));}}
       else requestAnimationFrame(()=>requestAnimationFrame(markPresented));
       // Keep the verified poster visible until the video frame has had
       // two compositor paint opportunities.
       requestAnimationFrame(()=>requestAnimationFrame(()=>{
         if(media.readyState>=2&&media.videoWidth>0&&media.videoHeight>0){
           still?.classList.add('is-covered');
         }
       }));
     }
   };
   if(item.kind==='music-image'){
     media=warmCache.get(item.image) instanceof HTMLImageElement?warmCache.get(item.image):document.createElement('img');
     media.alt='';media.decoding='async';
     // Music-backed photos use the same preview and readiness gate as videos.
     media.addEventListener('load',paintReady,{once:true});
     media.addEventListener('error',()=>{shell.dataset.previewFailed='1';settleReady(false);},{once:true});
     if(!media.getAttribute('src'))media.src=item.image;
     if(media.complete&&media.naturalWidth>0)paintReady();
   }else{
     media=warmCache.get(item.source) instanceof HTMLVideoElement?warmCache.get(item.source):document.createElement('video');
     media.muted=true;media.defaultMuted=true;media.playsInline=true;media.preload='auto';
     const alignVideoPreview=()=>{
       if(!media.videoWidth||!media.videoHeight)return;
       const objectPosition=(media.videoHeight/media.videoWidth)>=1.20?'top center':'center center';
       media.style.objectPosition=objectPosition;
       if(still)still.style.objectPosition=objectPosition;
     };
     if(item.width&&item.height){
       const objectPosition=(item.height/item.width)>=1.20?'top center':'center center';
       media.style.objectPosition=objectPosition;
       if(still)still.style.objectPosition=objectPosition;
     }
     listen(media,'loadedmetadata',alignVideoPreview);
     alignVideoPreview(); // cached warm previews may already have metadata
     listen(media,'loadeddata',paintReady);
     listen(media,'canplay',paintReady);
     listen(media,'error',()=>{media.pause();media.dataset.previewFailed='1';shell.dataset.previewFailed='1';settleReady(false);});
     if(item.poster){
       still=document.createElement('img');still.className='evp-preview-poster';still.alt='';still.decoding='async';
       listen(still,'error',()=>still.remove());
       still.src=item.poster;shell.append(still);
     }
     // The warmCache keeps this same video element across several swipes.
     // Therefore autoplay must be attached for the lifetime of each preview,
     // not as a one-shot listener that disappears after the first reuse.
     alignVideoPreview();
     media.setAttribute('aria-hidden','true');
     listen(media,'loadeddata',()=>{
       if(shell.isConnected&&visible()){const play=media.play();play?.catch?.(()=>{});}
     });
     if(!media.getAttribute('src'))media.src=item.source;
     if(media.error)settleReady(false);
   }
   // Match the active surface's fit mode so the incoming media occupies the
   // same viewport geometry during the push instead of creating a false gap.
   const activeSurface=player.hidden?poster:player;
   const activeStyle=getComputedStyle(activeSurface);
   media.style.objectFit=activeStyle.objectFit||'contain';
   media.style.objectPosition=media.style.objectPosition||activeStyle.objectPosition||'center center';
   shell.append(media);shell.dataset.direction=String(direction);shell.style.transform=`translate3d(0,${direction<0?-(height+GAP):(height+GAP)}px,0)`;box.append(shell);
   // Cached resources may already be decoded, so inspect their state after
   // listeners are attached instead of relying only on future load events.
   paintReady();
   if(media.tagName==='VIDEO'&&media.readyState>=2){const play=media.play();play?.catch?.(()=>{});}
   return shell;
 }
 function canStart(event){
   if(!visible()||transitioning||event.button!==undefined&&event.button!==0)return false;
   if(box.classList.contains('evp-comments-open')||box.classList.contains('evp-next-media-loading'))return false;
   if(event.target.closest(interactive))return false;
   if(event.target!==player&&event.target!==poster&&!event.target.closest('.evp-swipe-preview'))return false;
   const kind=modal.dataset.mediaKind||'';
   if(!['video','audio','source-audio'].includes(kind))return false;
   return !!(sourceFor(1)?.available||sourceFor(-1)?.available);
 }
 function setDrag(distance){
   const direction=distance<0?1:-1;
   if(preview&&Number(preview.dataset.direction)!==direction){pausePreviewPlayback(preview);preview.dispose?.();preview.remove();preview=null;}
   if(!preview){const item=sourceFor(direction);if(item?.available)preview=buildPreview(item,direction);}
   const current=player.hidden?poster:player;
   if(activeMedia!==current){if(activeMedia){activeMedia.style.transition='';activeMedia.style.transform='';}activeMedia=current;}
   // Keep the gesture finger-tracked. Readiness must never throttle pointer
   // movement: doing so made the swipe feel sticky and prevented a deliberate
   // gesture from completing while the adjacent resource was still loading.
   // The preview stays in its own layer; handoff/readiness is handled after the
   // gesture rather than inside every drag frame.
   const offset=distance;
   current.style.transition='none';current.style.transform=`translate3d(0,${offset}px,0)`;
   if(preview){
     preview.style.transition='none';
     preview.style.transform=`translate3d(0,${direction<0?-(height+GAP)+offset:(height+GAP)+offset}px,0)`;
   }
 }
 function restoreCurrentMedia(waitingPreview=null){
   box.classList.remove('evp-next-media-loading');
   if(waitingPreview){
     if(preview===waitingPreview)preview=null;
     pausePreviewPlayback(waitingPreview);waitingPreview.dispose?.();waitingPreview.remove();
   }
   const duration=REDUCED?0:RETURN_MS;
   [player,poster].forEach(el=>{el.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;el.style.transform='translate3d(0,0,0)';});
   if(preview){preview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;preview.style.transform=`translate3d(0,${Number(preview.dataset.direction)<0?-(height+GAP):(height+GAP)}px,0)`;}
   window.setTimeout(()=>{clean();activeMedia=null;},duration+12);
 }
 function finish(commit){
   if(!dragging)return;
   if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;setDrag(pendingDistance);}
   dragging=false;box.classList.remove('evp-swipe-dragging');
   const direction=lastY<startY?1:-1;
   if(commit&&preview){
     const waitingPreview=preview;
     const beginCommit=()=>{
       if(!waitingPreview?.isConnected||!visible())return;
       box.classList.remove('evp-next-media-loading');
       const current=player.hidden?poster:player;
       const duration=REDUCED?0:COMMIT_MS;
       current.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;
       current.style.transform=`translate3d(0,${direction>0?-(height+GAP):(height+GAP)}px,0)`;
       waitingPreview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;
       waitingPreview.style.transform='translate3d(0,0,0)';
       transitioning=true;
       window.setTimeout(()=>{
         const transitionCover=preview;preview=null;
         // Keep the already-decoded preview video moving while the primary
         // player loads and presents its first frame. Pausing it here created
         // a visible multi-second freeze at every swipe on slower devices.
         // The preview is muted by design; the primary player takes over audio.
         clean();activeMedia=null;
         const nextItem=sourceFor(direction);
         if(nextItem?.kind==='music-image'&&nextItem.width&&nextItem.height){
           box.classList.remove('evp-video-tall-stage','evp-video-natural-stage');
           box.classList.toggle('evp-portrait-stage',nextItem.height/nextItem.width>1.18);
         }
         const videoHandoff=modal.dataset.mediaKind==='video'&&nextItem?.kind==='video';
         const navigate=window.__egybookEvpQueueNavigate;
         const accepted=typeof navigate==='function'&&navigate(direction,transitionCover)!==false;
         if(!accepted){transitionCover?.dispose?.();transitionCover?.remove();}
         if(accepted&&videoHandoff&&transitionCover?.isConnected){
           // Reels does not accept another vertical gesture while the primary
           // player is still taking over from the moving preview. Unlock only
           // after releaseEvpTransitionCover removes that preview, or the modal
           // closes. This prevents rapid swipes from racing two player opens.
           let settled=false,observer=null,unlockTimer=0;
           const unlock=()=>{
             if(settled)return;settled=true;
             observer?.disconnect();clearTimeout(unlockTimer);transitioning=false;
           };
           const inspect=()=>{if(!visible()||!transitionCover.isConnected)unlock();};
           observer=new MutationObserver(inspect);
           observer.observe(box,{childList:true,subtree:true});
           observer.observe(modal,{attributes:true,attributeFilter:['class','hidden']});
           unlockTimer=setTimeout(unlock,12000);
           inspect();
         }else transitioning=false;
       },duration+8);
     };
     pointer=null;samples=[];pendingDistance=0;
     // Do not move to an incoming layer until its image has decoded or its
     // video has presented a real frame. One readiness gate covers both.
     if(waitingPreview.dataset.previewReady==='1')beginCommit();
     else if(waitingPreview.dataset.previewReady==='0'){
       restoreCurrentMedia(waitingPreview);
     }else{
       box.classList.add('evp-next-media-loading');
       [player,poster].forEach(el=>{el.style.transition=`transform ${REDUCED?0:150}ms ease-out`;el.style.transform='translate3d(0,0,0)';});
       waitingPreview.style.transition=`transform ${REDUCED?0:150}ms ease-out`;
       waitingPreview.style.transform=`translate3d(0,${direction>0?-(height+GAP):(height+GAP)}px,0)`;
       const previewWaitTimer=setTimeout(()=>{
         if(waitingPreview.isConnected)restoreCurrentMedia(waitingPreview);
       },1600);
       waitingPreview.previewReady.then(ok=>{
         clearTimeout(previewWaitTimer);
         if(!waitingPreview.isConnected)return;
         if(ok){box.classList.remove('evp-next-media-loading');beginCommit();}
         else restoreCurrentMedia(waitingPreview);
       });
     }
   }else{
     const duration=REDUCED?0:RETURN_MS;
     [player,poster].forEach(el=>{el.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;el.style.transform='translate3d(0,0,0)';});
     if(preview){preview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;preview.style.transform=`translate3d(0,${Number(preview.dataset.direction)<0?-(height+GAP):(height+GAP)}px,0)`;}
     window.setTimeout(()=>{clean();activeMedia=null;},duration+8);
     pointer=null;samples=[];pendingDistance=0;if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
   }
 }
 box.addEventListener('pointerdown',event=>{
   if(!canStart(event))return;
   const next=sourceFor(1),previous=sourceFor(-1);if(!next?.available&&!previous?.available)return;
   pointer=event.pointerId;
   startX=event.clientX;startY=lastY=event.clientY;lastAt=performance.now();velocity=0;
   samples=[{y:event.clientY,t:lastAt}];height=Math.max(1,box.clientHeight);dragging=false;
   try{box.setPointerCapture(pointer);}catch(_){}
 },{passive:true});
 box.addEventListener('pointermove',event=>{
   if(pointer!==event.pointerId||!visible())return;
   const dy=event.clientY-startY,dx=event.clientX-startX;
   if(!dragging){
     if(Math.abs(dy)<12||Math.abs(dy)<Math.abs(dx)*1.25)return;
     const item=sourceFor(dy<0?1:-1);
     if(!item?.available){pointer=null;return;}
     dragging=true;box.classList.add('evp-swipe-dragging');
     try{box.setPointerCapture(pointer);}catch(_){}
   }
   box.dataset.evpSuppressSurfaceClickUntil=String(Date.now()+550);
   if(event.cancelable)event.preventDefault();
   const now=performance.now();
   samples.push({y:event.clientY,t:now});if(samples.length>5)samples.shift();
   const first=samples[0],last=samples[samples.length-1],sampleDt=Math.max(1,last.t-first.t);
   velocity=(last.y-first.y)/sampleDt;lastY=event.clientY;lastAt=now;
   pendingDistance=Math.max(-height,Math.min(height,dy));
   if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(dragging)setDrag(pendingDistance);});
 },{passive:false});
 function finishPointerGesture(event,cancelled=false){
   if(pointer!==event.pointerId)return;
   if(Number.isFinite(event.clientY)&&event.clientY!==0)lastY=event.clientY;
   if(!dragging){pointer=null;samples=[];return;}
   const now=performance.now();
   samples.push({y:lastY,t:now});if(samples.length>5)samples.shift();
   if(samples.length>1){const first=samples[0],last=samples[samples.length-1];velocity=(last.y-first.y)/Math.max(1,last.t-first.t);}
   pendingDistance=Math.max(-height,Math.min(height,lastY-startY));
   if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
   setDrag(pendingDistance);
   const distance=lastY-startY,direction=distance<0?1:-1,item=sourceFor(direction);
   const deliberateDistance=Math.abs(distance)>=Math.max(SWIPE_MIN_DISTANCE,height*SWIPE_VIEWPORT_RATIO);
   const deliberateFling=Math.sign(velocity)===Math.sign(distance)&&Math.abs(velocity)>=FLING_SPEED&&Math.abs(distance)>=FLING_MIN_DISTANCE;
   const commit=!!item?.available&&!cancelled&&(deliberateDistance||deliberateFling);
   pointer=null;
   finish(commit);
 }
 box.addEventListener('pointerup',event=>finishPointerGesture(event,false));
 box.addEventListener('pointercancel',event=>finishPointerGesture(event,true));
 box.addEventListener('lostpointercapture',event=>{
   if(pointer!==event.pointerId)return;
   finishPointerGesture({pointerId:event.pointerId,clientY:lastY},true);
 });
 window.addEventListener('blur',()=>{
   if(pointer===null)return;
   if(dragging)finish(false);
   else{pointer=null;samples=[];pendingDistance=0;}
 });
 const warmCache=new Map();
 function warmAdjacent(){
   const next=sourceFor(1),previous=sourceFor(-1);
   const wanted=[{item:next,priority:'next'},{item:previous,priority:'previous'}].filter(entry=>entry.item?.available);
   const keys=new Set(wanted.map(({item})=>item.kind==='music-image'?item.image:item.source));
   for(const [key,node] of warmCache){
   if(keys.has(key))continue;
   // Queue changes fire before the main player is ready. The outgoing cache
   // entry can still be the connected preview being used as the visual cover.
   // Never clear that video's src until the cover has been replaced.
   if(node.isConnected&&node.closest('.evp-swipe-preview')){
     // The outgoing preview is the visible handoff cover. Keep both image
     // and video resources alive until the primary surface has painted.
     warmCache.delete(key);
     continue;
   }
   try{node.pause?.();node.removeAttribute?.('src');node.load?.();}catch(_){}
   warmCache.delete(key);
 }
   wanted.forEach(({item,priority})=>{
     const key=item.kind==='music-image'?item.image:item.source;if(!key||warmCache.has(key))return;
     if(item.kind==='music-image'){
       const image=new Image();image.decoding='async';image.src=key;image.decode?.().catch(()=>{});warmCache.set(key,image);
     }else{
       const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;
       // Fully prepare only the likely next item; keep the previous item lightweight.
       video.preload=priority==='next'?'auto':'metadata';video.src=key;video.load();
       if(item.poster){const posterImage=new Image();posterImage.decoding='async';posterImage.src=item.poster;posterImage.decode?.().catch(()=>{});}
       warmCache.set(key,video);
     }
   });
 }
 window.addEventListener('egybook:evp-post-context',warmAdjacent);
 requestAnimationFrame(warmAdjacent);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dragging)finish(false);});
 window.addEventListener('resize',()=>{if(!dragging)height=Math.max(1,box.clientHeight);});
})();

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
 // A short/hesitant pull must always spring back. Only a deliberate swipe commits.
 const THRESHOLD=.30,MIN_DISTANCE=150,FLING=.95,FLING_MIN_DISTANCE=150,GAP=22;
 const COMMIT_MS=360,RETURN_MS=320;
 let pointer=null,preview=null,dragging=false,transitioning=false,startX=0,startY=0,lastY=0,lastAt=0,velocity=0,height=0,activeMedia=null,samples=[],dragFrame=0,pendingDistance=0;
 const interactive='button,a,input,textarea,select,[role="button"],.evp-post-rail,.evp-controls,.evp-top-actions,.evp-reaction-picker';
 const visible=()=>modal.classList.contains('open')&&!modal.hidden;
 const clean=()=>{if(preview){preview.remove();preview=null;}[player,poster].forEach(el=>{el.style.transition='';el.style.transform='';});box.classList.remove('evp-swipe-dragging');};
 const sourceFor=(direction)=>window.__egybookEvpQueueState?.(direction)||null;
 function buildPreview(item,direction){
   if(!item?.available)return null;
   const shell=document.createElement('div');shell.className='evp-swipe-preview';shell.setAttribute('aria-hidden','true');
   let media,still=null;
   const paintReady=()=>{
     if(!media)return;
     if(media.tagName==='IMG')return;
     if(media.readyState>=2&&media.videoWidth>0&&media.videoHeight>0){
       // Keep the poster visible until the browser confirms that a decoded
       // video frame was actually submitted to the compositor. readyState and
       // videoWidth alone are not enough on Android: the decoder can be ready
       // while the preview surface still paints only its blue CSS background.
       const coverPoster=()=>{
         if(media.readyState>=2&&media.videoWidth>0&&media.videoHeight>0){
           still?.classList.add('is-covered');
         }
       };
       if(typeof media.requestVideoFrameCallback==='function'){
         try{media.requestVideoFrameCallback(coverPoster);return;}catch(_){}
       }
       requestAnimationFrame(()=>requestAnimationFrame(coverPoster));
     }
   };
   if(item.kind==='music-image'){
     media=warmCache.get(item.image) instanceof HTMLImageElement?warmCache.get(item.image):document.createElement('img');
     media.alt='';media.decoding='async';
     media.addEventListener('error',()=>{shell.dataset.previewFailed='1';},{once:true});
     if(!media.getAttribute('src'))media.src=item.image;
   }else{
     media=warmCache.get(item.source) instanceof HTMLVideoElement?warmCache.get(item.source):document.createElement('video');
     media.muted=true;media.defaultMuted=true;media.playsInline=true;media.preload='auto';
     // A previous-item cache entry may have been kept metadata-only. Promote
     // only the item the user is actively pulling toward, rather than warming
     // both directions at full bandwidth during every queue change.
     if(media.readyState<2&&media.getAttribute('src')){try{media.load();}catch(_){}}
     media.addEventListener('loadeddata',paintReady);
     media.addEventListener('canplay',paintReady);
     media.addEventListener('error',()=>{media.pause();media.dataset.previewFailed='1';shell.dataset.previewFailed='1';},{once:true});
     if(item.poster){
       still=document.createElement('img');still.className='evp-preview-poster';still.alt='';still.decoding='async';
       still.addEventListener('error',()=>still.remove(),{once:true});
       still.src=item.poster;shell.append(still);
     }
     media.setAttribute('aria-hidden','true');
     media.addEventListener('loadeddata',()=>{if(dragging&&preview===shell){const play=media.play();play?.catch?.(()=>{});}}, {once:true});
     if(!media.getAttribute('src'))media.src=item.source;
   }
   const mediaWidth=Number(item.width)||Number(item.mediaWidth)||0,mediaHeight=Number(item.height)||Number(item.mediaHeight)||0;
   if(mediaWidth&&mediaHeight){
     const mode=window.EgyBookMediaDisplay?.modeFor?.(mediaWidth,mediaHeight)||'contained';
     media.style.objectFit=mode==='reel'?'cover':'contain';
     media.style.objectPosition=mode==='reel'?'center center':'center center';
   }
   shell.append(media);shell.dataset.direction=String(direction);shell.style.transform=`translate3d(0,${direction<0?-(height+GAP):(height+GAP)}px,0)`;box.append(shell);
   // Cached resources may already be decoded, so inspect their state after
   // listeners are attached instead of relying only on future load events.
   paintReady();
   if(media.tagName==='VIDEO'&&media.readyState>=2){const play=media.play();play?.catch?.(()=>{});}
   return shell;
 }
 function canStart(event){
   if(!visible()||event.button!==undefined&&event.button!==0)return false;
   if(event.target.closest(interactive))return false;
   if(event.target!==player&&event.target!==poster&&!event.target.closest('.evp-swipe-preview'))return false;
   return true;
 }
 function setDrag(distance){
   const direction=distance<0?1:-1;
   if(preview&&Number(preview.dataset.direction)!==direction){preview.remove();preview=null;}
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
 function finish(commit){
   if(!dragging)return;
   if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;setDrag(pendingDistance);}
   dragging=false;box.classList.remove('evp-swipe-dragging');
   const direction=lastY<startY?1:-1;
   if(commit&&preview){
     const current=player.hidden?poster:player;
     const duration=REDUCED?0:COMMIT_MS;
     current.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;
     current.style.transform=`translate3d(0,${direction>0?-(height+GAP):(height+GAP)}px,0)`;
     preview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;
     preview.style.transform='translate3d(0,0,0)';
     const navigate=window.__egybookEvpQueueNavigate;
     transitioning=true;
     window.setTimeout(()=>{
       const transitionCover=preview;preview=null;
       clean();activeMedia=null;
       const nextItem=sourceFor(direction);
       // Display sizing is owned by media-display-manager.js after source metadata.
       const accepted=typeof navigate==='function'&&navigate(direction,transitionCover)!==false;
       if(!accepted)transitionCover?.remove();
       // Never remove a handoff cover on a timer. On slow networks the new
       // media may need longer than five seconds to decode its first frame.
       // The core player owns this cover and releases it only after a real
       // image decode / presented video frame has been confirmed.
       transitioning=false;
     },duration+8);
   }else{
     const duration=REDUCED?0:RETURN_MS;
     [player,poster].forEach(el=>{el.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;el.style.transform='translate3d(0,0,0)';});
     if(preview){preview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;preview.style.transform=`translate3d(0,${Number(preview.dataset.direction)<0?-(height+GAP):(height+GAP)}px,0)`;}
     window.setTimeout(()=>{clean();activeMedia=null;},duration+8);
   }
   pointer=null;samples=[];pendingDistance=0;if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
 }
 box.addEventListener('pointerdown',event=>{
   if(transitioning||!canStart(event))return;
   const next=sourceFor(1),previous=sourceFor(-1);if(!next?.available&&!previous?.available)return;
   // Adjacent resources are warmed when the queue context changes; do not
   // start additional network/decoder work synchronously on pointerdown.
   pointer=event.pointerId;startX=event.clientX;startY=lastY=event.clientY;lastAt=performance.now();velocity=0;samples=[{y:event.clientY,t:lastAt}];height=Math.max(1,box.clientHeight);dragging=false;
 },{passive:true});
 box.addEventListener('pointermove',event=>{
   if(pointer!==event.pointerId||!visible())return;
   const dy=event.clientY-startY,dx=event.clientX-startX;
   if(!dragging){if(Math.abs(dy)<12||Math.abs(dy)<Math.abs(dx)*1.25)return;const item=sourceFor(dy<0?1:-1);if(!item?.available){pointer=null;return;}dragging=true;box.classList.add('evp-swipe-dragging');try{box.setPointerCapture(pointer);}catch(_){}}
   // touch-action:none on the viewer already reserves this gesture for the
   // swipe engine; avoid a redundant preventDefault call on every pointermove.
   const now=performance.now(),dt=Math.max(1,now-lastAt);
   samples.push({y:event.clientY,t:now});if(samples.length>5)samples.shift();
   const first=samples[0],last=samples[samples.length-1],sampleDt=Math.max(1,last.t-first.t);
   velocity=(last.y-first.y)/sampleDt;lastY=event.clientY;lastAt=now;
   pendingDistance=Math.max(-height,Math.min(height,dy));
   // Coalesce high-frequency pointer events into one compositor update/frame.
   if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(dragging)setDrag(pendingDistance);});
 },{passive:false});
 box.addEventListener('pointerup',event=>{
   if(pointer!==event.pointerId)return;
   if(!dragging){pointer=null;samples=[];return;}
   // Include the final pointerup coordinate; a tiny final movement must not
   // turn a short pull into a page change.
   if(Number.isFinite(event.clientY))lastY=event.clientY;
   pendingDistance=Math.max(-height,Math.min(height,lastY-startY));
   if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
   setDrag(pendingDistance);
   const distance=lastY-startY,direction=distance<0?1:-1;
   const item=sourceFor(direction);
   const deliberateDistance=Math.abs(distance)>=Math.max(MIN_DISTANCE,height*THRESHOLD);
   const deliberateFling=Math.abs(velocity)>=FLING&&Math.abs(distance)>=FLING_MIN_DISTANCE;
   const commit=!!item?.available&&(deliberateDistance||deliberateFling);
   finish(commit);
 });
 box.addEventListener('pointercancel',()=>{if(dragging)finish(false);else{pointer=null;samples=[];}});
 const warmCache=new Map();
 function warmAdjacent(){
   const next=sourceFor(1),previous=sourceFor(-1);
   const wanted=[{item:next,priority:'next'},{item:previous,priority:'previous'}].filter(entry=>entry.item?.available);
   const keys=new Set(wanted.map(({item})=>item.kind==='music-image'?item.image:item.source));
   for(const [key,node] of warmCache){
     if(!keys.has(key)){
       // A cached next-item video may have been moved into the live swipe
       // handoff cover. Queue navigation changes the current index before the
       // new player has its first frame; evicting that cache entry here used
       // to clear its src and expose the blue preview background for the
       // entire handoff (while the core player's audio could already play).
       // Detach it from the cache, but let the display manager own its lifetime
       // while it is connected as the active transition cover.
       const isLiveHandoff=!!node.isConnected&&!!node.closest?.('.evp-swipe-preview');
       if(!isLiveHandoff){try{node.pause?.();node.removeAttribute?.('src');node.load?.();}catch(_){}}
       warmCache.delete(key);
     }
   }
   wanted.forEach(({item,priority})=>{
     const key=item.kind==='music-image'?item.image:item.source;if(!key||warmCache.has(key))return;
     if(item.kind==='music-image'){
       const image=new Image();image.decoding='async';image.src=key;image.decode?.().catch(()=>{});warmCache.set(key,image);
     }else{
       const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;
       // Fully prepare only the likely next item; keep the previous item lightweight.
       video.preload=priority==='next'?'auto':'metadata';
       if(window.EgyBookMediaLoader)window.EgyBookMediaLoader.assignSource(video,key,video.preload);
       else video.src=key;
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

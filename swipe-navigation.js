/* EgyBook Stage 5.2 — finger-tracked vertical media navigation.
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
 const THRESHOLD=.27,MIN_DISTANCE=128,FLING=.82,FLING_MIN_DISTANCE=125,GAP=20;
 const COMMIT_MS=285,RETURN_MS=250;
 let pointer=null,preview=null,dragging=false,startX=0,startY=0,lastY=0,lastAt=0,velocity=0,height=0,activeMedia=null,samples=[];
 const interactive='button,a,input,textarea,select,[role="button"],.evp-post-rail,.evp-controls,.evp-top-actions,.evp-reaction-picker';
 const visible=()=>modal.classList.contains('open')&&!modal.hidden;
 const clean=()=>{if(preview){preview.remove();preview=null;}[player,poster].forEach(el=>{el.style.transition='';el.style.transform='';});box.classList.remove('evp-swipe-dragging');};
 const sourceFor=(direction)=>window.__egybookEvpQueueState?.(direction)||null;
 function buildPreview(item,direction){
   if(!item?.available)return null;
   const shell=document.createElement('div');shell.className='evp-swipe-preview';shell.setAttribute('aria-hidden','true');
   let media;
   if(item.kind==='music-image'){
     media=document.createElement('img');media.alt='';media.decoding='async';media.src=item.image;
   }else{
     media=document.createElement('video');media.muted=true;media.defaultMuted=true;media.playsInline=true;media.preload='auto';media.src=item.source;
     media.setAttribute('aria-hidden','true');
     media.addEventListener('loadeddata',()=>{if(dragging&&preview===shell){const play=media.play();play?.catch?.(()=>{});}}, {once:true});
     media.addEventListener('error',()=>{media.pause();},{once:true});
   }
   shell.append(media);shell.dataset.direction=String(direction);shell.style.transform=`translate3d(0,${direction<0?-(height+GAP):(height+GAP)}px,0)`;box.append(shell);
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
   const offset=distance;
   current.style.transition='none';current.style.transform=`translate3d(0,${offset}px,0)`;
   if(preview){preview.style.transition='none';preview.style.transform=`translate3d(0,${direction<0?-(height+GAP)+offset:(height+GAP)+offset}px,0)`;}
 }
 function finish(commit){
   if(!dragging)return;
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
     window.setTimeout(()=>{clean();activeMedia=null;if(typeof navigate==='function')navigate(direction);},duration+8);
   }else{
     const duration=REDUCED?0:RETURN_MS;
     [player,poster].forEach(el=>{el.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;el.style.transform='translate3d(0,0,0)';});
     if(preview){preview.style.transition=`transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;preview.style.transform=`translate3d(0,${Number(preview.dataset.direction)<0?-(height+GAP):(height+GAP)}px,0)`;}
     window.setTimeout(()=>{clean();activeMedia=null;},duration+8);
   }
   pointer=null;samples=[];
 }
 box.addEventListener('pointerdown',event=>{
   if(!canStart(event))return;
   const next=sourceFor(1),previous=sourceFor(-1);if(!next?.available&&!previous?.available)return;
   pointer=event.pointerId;startX=event.clientX;startY=lastY=event.clientY;lastAt=performance.now();velocity=0;samples=[{y:event.clientY,t:lastAt}];height=Math.max(1,box.clientHeight);dragging=false;
 },{passive:true});
 box.addEventListener('pointermove',event=>{
   if(pointer!==event.pointerId||!visible())return;
   const dy=event.clientY-startY,dx=event.clientX-startX;
   if(!dragging){if(Math.abs(dy)<9||Math.abs(dy)<Math.abs(dx)*1.18)return;const item=sourceFor(dy<0?1:-1);if(!item?.available){pointer=null;return;}dragging=true;box.classList.add('evp-swipe-dragging');try{box.setPointerCapture(pointer);}catch(_){}}
   if(event.cancelable)event.preventDefault();
   const now=performance.now(),dt=Math.max(1,now-lastAt);
   samples.push({y:event.clientY,t:now});if(samples.length>5)samples.shift();
   const first=samples[0],last=samples[samples.length-1],sampleDt=Math.max(1,last.t-first.t);
   velocity=(last.y-first.y)/sampleDt;lastY=event.clientY;lastAt=now;
   setDrag(Math.max(-height,Math.min(height,dy)));
 },{passive:false});
 box.addEventListener('pointerup',event=>{
   if(pointer!==event.pointerId)return;
   if(!dragging){pointer=null;samples=[];return;}
   // Include the final pointerup coordinate; a tiny final movement must not
   // turn a short pull into a page change.
   if(Number.isFinite(event.clientY))lastY=event.clientY;
   const distance=lastY-startY,direction=distance<0?1:-1;
   const item=sourceFor(direction);
   const commit=!!item?.available&&(Math.abs(distance)>=Math.max(MIN_DISTANCE,height*THRESHOLD)||
     (Math.abs(velocity)>=FLING&&Math.abs(distance)>=FLING_MIN_DISTANCE));
   finish(commit);
 });
 box.addEventListener('pointercancel',()=>{if(dragging)finish(false);else{pointer=null;samples=[];}});
 const warmCache=new Map();
 function warmAdjacent(){
   const wanted=[sourceFor(-1),sourceFor(1)].filter(item=>item?.available);
   const keys=new Set(wanted.map(item=>item.kind==='music-image'?item.image:item.source));
   for(const [key,node] of warmCache){if(!keys.has(key)){try{node.pause?.();node.removeAttribute?.('src');node.load?.();}catch(_){}warmCache.delete(key);}}
   wanted.forEach(item=>{
     const key=item.kind==='music-image'?item.image:item.source;if(!key||warmCache.has(key))return;
     if(item.kind==='music-image'){
       const image=new Image();image.decoding='async';image.src=key;image.decode?.().catch(()=>{});warmCache.set(key,image);
     }else{
       const video=document.createElement('video');video.muted=true;video.preload='metadata';video.playsInline=true;video.src=key;video.load();warmCache.set(key,video);
     }
   });
 }
 window.addEventListener('egybook:evp-post-context',warmAdjacent);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dragging)finish(false);});
 window.addEventListener('resize',()=>{if(!dragging)height=Math.max(1,box.clientHeight);});
})();

/* EgyBook Stage 5 — isolated Snap Scrolling controller.
   The core app owns route state; this module only toggles the CSS mode and
   observes newly-rendered media cards without changing their playback logic. */
(()=>{
 'use strict';
 const HOME_CLASS='egybook-home-feed-snap';
 const mark=()=>{document.querySelectorAll('#postsList > .post').forEach(post=>{
   if(post.querySelector('.post-image, video, img.post-image'))post.classList.add('feed-snap-media');
 });};
 const sync=()=>{if(document.body.classList.contains(HOME_CLASS))mark();};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync,{once:true});else sync();
 const list=document.getElementById('postsList');
 if(list&&'MutationObserver' in window){const observer=new MutationObserver(sync);observer.observe(list,{childList:true,subtree:false});}
 document.addEventListener('egybook:pagechange',sync);
})();

/* EgyBook Stage 5 — isolated infinite feed paging observer. */
(()=>{
 'use strict';
 const init=()=>{
   const list=document.getElementById('postsList');
   const section=document.getElementById('feedSection');
   if(!list||!section)return;
   let sentinel=section.querySelector(':scope > .feed-load-sentinel');
   if(!sentinel){sentinel=document.createElement('div');sentinel.className='feed-load-sentinel';sentinel.setAttribute('aria-hidden','true');section.append(sentinel);}
   let scheduled=false;
   const requestMore=()=>{
     if(scheduled||!document.body.classList.contains('egybook-home-feed-snap'))return;
     const load=window.__egybookLoadMoreFeedPosts;
     if(typeof load!=='function')return;
     scheduled=true;
     Promise.resolve().then(()=>load()).finally(()=>{scheduled=false;});
   };
   if('IntersectionObserver' in window){
     window.__egybookFeedObserver?.disconnect();
     window.__egybookFeedObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))requestMore();},{root:null,rootMargin:'1000px 0px 1000px 0px',threshold:0});
     window.__egybookFeedObserver.observe(sentinel);
   }else{window.addEventListener('scroll',()=>{if(sentinel.getBoundingClientRect().top<innerHeight+1000)requestMore();},{passive:true});}
   const check=()=>{if(!document.body.classList.contains('egybook-home-feed-snap'))return; if(sentinel.getBoundingClientRect().top<innerHeight+1000)requestMore();};
   requestAnimationFrame(check);
   document.addEventListener('egybook:pagechange',()=>requestAnimationFrame(check));
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

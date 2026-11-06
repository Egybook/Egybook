/* EgyBook v2009 — dedicated photo/music viewer swipe controller. */
(()=>{'use strict';
  const stage=document.getElementById('imageViewerStage');
  if(!stage)return;
  let start=null;
  const excluded='button,a,input,textarea,select,[role="button"],.iv-fixed-rail,.iv-topbar,.iv-bottom-bar,.iv-more-menu';
  stage.addEventListener('pointerdown',event=>{
    const viewer=document.getElementById('imageViewer');
    if(viewer?.hidden||event.button!==undefined&&event.button!==0||event.target.closest(excluded))return;
    start={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  },{passive:true});
  stage.addEventListener('pointermove',event=>{
    if(!start||event.pointerId!==start.id)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.2){start.moved=true;event.preventDefault?.();}
  },{passive:false});
  stage.addEventListener('pointerup',event=>{
    if(!start||event.pointerId!==start.id)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y,moved=start.moved;start=null;
    if(!moved||Math.abs(dy)<76||Math.abs(dy)<Math.abs(dx)*1.25)return;
    event.preventDefault?.();
    const nav=window.EgyBookImagePlayerNavigation;
    if(nav){if(dy<0)nav.next();else nav.previous();}
  },{passive:false});
  stage.addEventListener('pointercancel',()=>{start=null;},{passive:true});
})();

/* EgyBook v2009 — isolated video viewer swipe controller. */
(()=>{'use strict';
  const modal=document.getElementById('egybookVideoModal');
  if(!modal)return;
  let start=null;
  const excluded='button,a,input,textarea,select,[role="button"],.evp-post-rail,.evp-top-actions,.evp-controls,.evp-center,.evp-skip,.evp-reaction-picker';
  modal.addEventListener('pointerdown',event=>{
    if(modal.hidden||modal.dataset.mediaKind!=='video'||event.button!==undefined&&event.button!==0)return;
    if(event.target.closest(excluded))return;
    start={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  },{passive:true});
  modal.addEventListener('pointermove',event=>{
    if(!start||event.pointerId!==start.id)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.2){start.moved=true;event.preventDefault?.();}
  },{passive:false});
  const finish=event=>{
    if(!start||event.pointerId!==start.id)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y,moved=start.moved;start=null;
    if(!moved||Math.abs(dy)<76||Math.abs(dy)<Math.abs(dx)*1.25)return;
    if(modal.dataset.mediaKind!=='video')return;
    event.preventDefault?.();
    const nav=window.EgyBookMediaNavigation;
    if(nav){if(dy<0)nav.next();else nav.previous();}
  };
  modal.addEventListener('pointerup',finish,{passive:false});
  modal.addEventListener('pointercancel',()=>{start=null;},{passive:true});
})();

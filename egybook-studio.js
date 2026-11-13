/* EgyBook Camera Studio only — no editor, projects, or timeline runtime. */
(() => {
  'use strict';
  if (window.EgyBookStudio) return;
  const modal = () => document.getElementById('egybookStudioModal');
  let historyActive = false;
  let openedFrom = 'direct';
  function status(message, kind='info') {
    if (!['warn','error'].includes(kind)) return;
    const node=document.getElementById('studioStatus'); if(!node)return;
    node.textContent=message; node.dataset.kind=kind; node.hidden=false;
    clearTimeout(node.__hideTimer); node.__hideTimer=setTimeout(()=>{node.hidden=true;},kind==='error'?7000:4500);
  }
  async function open(detail={}) {
    const layer=modal(); if(!layer)return false;
    openedFrom=detail.origin||'direct';
    layer.hidden=false; layer.classList.add('open'); layer.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    if(!historyActive){try{history.pushState({...history.state,egybookCameraStudio:true},'',location.href);historyActive=true;}catch(_){}}
    if(detail.audioSource) void window.EgyBookCameraAudio?.setReelSource?.(detail.audioSource);
    await window.EgyBookStudioCamera?.startCamera?.();
    return true;
  }
  function close({fromHistory=false}={}) {
    const layer=modal(); if(!layer||layer.hidden)return;
    if(historyActive&&!fromHistory&&history.state?.egybookCameraStudio){history.back();return;}
    layer.classList.remove('open');layer.hidden=true;layer.setAttribute('aria-hidden','true');
    historyActive=false;window.EgyBookStudioCamera?.stop?.();window.EgyBookCameraAudio?.cleanup?.();
    if(!document.querySelector('.modal.open'))document.body.style.overflow='';
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-studio-close]')){close();return;}
    const button=event.target.closest('[data-action="composer-studio"]');
    if(button){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();document.querySelector('#composerMenuModal [data-action="close-modal"]')?.click();open({origin:'composer-menu'});}
  },true);
  document.addEventListener('egybook:camera-studio-open-request',event=>{void open(event.detail||{});});
  document.addEventListener('egybook:camera-capture-ready',event=>{const button=document.getElementById('studioUseCaptureButton');if(button){button.hidden=false;button.dataset.captureType=event.detail?.type||'video';}});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-camera-use-capture]');if(!button)return;
    const capture=window.EgyBookCameraCapture;if(!capture?.file){status('لا يوجد مقطع جاهز للاستخدام.','warn');return;}
    const input=document.getElementById(capture.type==='image'?'photoInput':'videoInput');
    if(!input||typeof DataTransfer==='undefined'){status('المتصفح لا يسمح بتمرير الملف مباشرة؛ استخدم زر الإرفاق داخل المنشور.','warn');return;}
    try{const transfer=new DataTransfer();transfer.items.add(capture.file);input.files=transfer.files;}catch(_){status('تعذر تجهيز الملف للمنشور في هذا المتصفح.','error');return;}
    close();requestAnimationFrame(()=>{document.querySelector('[data-action="open-post-composer"]')?.click();setTimeout(()=>input.dispatchEvent(new Event('change',{bubbles:true})),80);});
  });
  // Backward-compatible event name for existing internal entry points; it now opens Camera Studio only.
  document.addEventListener('egybook:studio-open-request',event=>{void open(event.detail||{});});
  window.addEventListener('popstate',event=>{if(!modal()?.classList.contains('open'))return;historyActive=false;close({fromHistory:true});event.stopImmediatePropagation();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal()?.classList.contains('open')){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  window.addEventListener('pagehide',()=>{window.EgyBookStudioCamera?.stop?.();window.EgyBookCameraAudio?.cleanup?.();});
  window.EgyBookStudio={open,close,status,getOrigin:()=>openedFrom};
})();

/* Camera Studio controls only. */
(() => {
 'use strict'; if(window.EgyBookStudioUI)return;
 const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
 const sheet=()=>$('#studioToolSheet');
 const titles={'camera-settings':'إعدادات الكاميرا',beauty:'تحسين ملامح الوجه',effects:'تأثيرات الكاميرا'};
 function openTool(name){const target=name==='speed'?'camera-settings':name;const panel=$(`[data-studio-tool-panel="${target}"]`);const layer=sheet();if(!panel||!layer)return false;$$('.studio-tool-panel',layer).forEach(p=>p.hidden=p!==panel);$('#studioToolSheetTitle').textContent=titles[target]||'أدوات الكاميرا';layer.hidden=false;layer.setAttribute('aria-hidden','false');return true;}
 function closeTool(){const layer=sheet();if(layer){layer.hidden=true;layer.setAttribute('aria-hidden','true');}}
 document.addEventListener('click',event=>{
  const tool=event.target.closest('[data-studio-tool]');if(tool){event.preventDefault();openTool(tool.dataset.studioTool);return;}
  if(event.target.closest('[data-studio-tool-close]')){closeTool();return;}
  const duration=event.target.closest('[data-studio-camera-duration]');if(duration){const seconds=Number(duration.dataset.studioCameraDuration)||15;$$('[data-studio-camera-duration]').forEach(b=>b.classList.toggle('is-active',b===duration));window.EgyBookStudioCamera?.setDuration(seconds);return;}
  const mode=event.target.closest('[data-studio-camera-mode]');if(mode&&!mode.disabled){event.preventDefault();window.EgyBookStudioCamera?.setMode(mode.dataset.studioCameraMode);}
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!sheet()?.hidden){event.preventDefault();closeTool();}},true);
 window.EgyBookStudioUI={openTool,closeTool};
})();

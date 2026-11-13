/* Camera-only audio selection and recording mix. Extraction is on-demand and local. */
(() => {
 'use strict'; if(window.EgyBookCameraAudio)return;
 const $=s=>document.querySelector(s); let selected=null, objectUrl='', context=null, destination=null, mediaSource=null, mediaGain=null, micSource=null, micGain=null, busy=false;
 const audio=()=>$('#studioCameraMusicAudio');
 const chip=()=>$('#studioCameraSoundChip');
 function label(text){const node=$('#studioCameraSoundName');if(node)node.textContent=text||'الصوت المختار';if(chip())chip().hidden=!text;}
 function revoke(){if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl='';}}
 async function setFile(file,name='الصوت المختار') {if(!file)return false;const el=audio();if(!el)return false;revoke();objectUrl=URL.createObjectURL(file);el.pause();el.src=objectUrl;el.load();selected={file,name};label(name);return true;}
 async function setReelSource(source){
  if(!source)return false;selected={source,name:source.title||'صوت من Reels'};label('جارٍ تجهيز: '+selected.name);
  if(!window.EgyBookStudioDemux?.extract){label('تعذر تجهيز صوت الريلز');window.EgyBookStudio?.status?.('أداة استخراج الصوت غير متاحة حاليًا.','error');return false;}
  if(busy)return false;busy=true;
  try{
   let file=source.file||null;
   if(!file&&source.mediaUrl){file=await window.EgyBookStudioDemux.extract({url:source.mediaUrl,name:source.title||'EgyBook-Reel.mp4'});}
   else if(!file&&source.trackId){const url=`https://api.audius.co/v1/tracks/${encodeURIComponent(source.trackId)}/stream`;const el=audio();if(el){revoke();el.src=url;el.crossOrigin='anonymous';el.load();selected={source,name:source.title||'صوت من EgyBook'};label(selected.name);window.EgyBookStudio?.status?.('تم تجهيز الصوت داخل Camera Studio.');return true;}}
   if(!file)throw new Error('SOURCE_NOT_AVAILABLE');
   await setFile(file,source.title||'صوت من Reels');
   window.EgyBookStudio?.status?.('تم تجهيز صوت الريلز وإضافته إلى Camera Studio. اضغط تشغيل الصوت لمعاينته.');
   return true;
  }catch(error){console.warn('Camera Reel audio preparation failed:',error);label('تعذر تجهيز صوت الريلز');window.EgyBookStudio?.status?.(error?.message==='SOURCE_TOO_LARGE'?'الفيديو أكبر من الحد الآمن لاستخراج الصوت على هذا الجهاز.':'تعذر استخراج صوت هذا الريل؛ قد يمنع مصدر الفيديو تنزيله من المتصفح.','error');return false;}
  finally{busy=false;}
 }
 async function preview(){const el=audio();if(!el?.src)return false;try{if(el.paused)await el.play();else el.pause();return true;}catch(_){window.EgyBookStudio?.status?.('اضغط تشغيل مرة أخرى لمعاينة الصوت.','warn');return false;}}
 async function prepareRecordingMix(cameraStream,volume=.7){
  const AC=window.AudioContext||window.webkitAudioContext;const el=audio();if(!AC||!el?.src)return null;
  try{
   if(!context){context=new AC();destination=context.createMediaStreamDestination();}
   if(context.state==='suspended')await context.resume();
   if(!mediaSource){mediaSource=context.createMediaElementSource(el);mediaGain=context.createGain();mediaSource.connect(mediaGain);mediaGain.connect(context.destination);}
   mediaGain.gain.setTargetAtTime(Math.max(0,Math.min(1,Number(volume)||0)),context.currentTime,.025);
   mediaGain.connect(destination);
   if(cameraStream?.getAudioTracks?.().length){micSource=context.createMediaStreamSource(new MediaStream(cameraStream.getAudioTracks()));micGain=context.createGain();micGain.gain.value=1;micSource.connect(micGain);micGain.connect(destination);}
   await el.play();
   const track=destination.stream.getAudioTracks()[0];let cleaned=false;
   return {audioTrack:track,cleanup(){if(cleaned)return;cleaned=true;try{mediaGain.disconnect(destination);}catch(_){}try{micSource?.disconnect();micGain?.disconnect();}catch(_){}micSource=null;micGain=null;}};
  }catch(error){console.warn('Camera audio mix unavailable:',error);return null;}
 }
 function setVolume(value){if(mediaGain&&context)mediaGain.gain.setTargetAtTime(Math.max(0,Math.min(1,Number(value)/100)),context.currentTime,.02);}
 function pause(){const el=audio();if(el)el.pause();}
 function cleanup(){const el=audio();if(el){el.pause();el.removeAttribute('src');el.load();}revoke();selected=null;label('');try{micSource?.disconnect();micGain?.disconnect();mediaSource?.disconnect();mediaGain?.disconnect();}catch(_){}micSource=null;micGain=null;mediaSource=null;mediaGain=null;destination=null;if(context){const old=context;context=null;old.close().catch(()=>{});}}
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-camera-audio-pick]')){$('#studioCameraAudioInput')?.click();return;}
  if(event.target.closest('[data-camera-audio-preview]'))void preview();
 });
 document.addEventListener('change',event=>{if(event.target.id==='studioCameraAudioInput'){const file=event.target.files?.[0];if(file)void setFile(file,file.name);event.target.value='';}});
 window.EgyBookCameraAudio={setReelSource,setFile,preview,prepareRecordingMix,setVolume,pause,isBusy:()=>busy,hasSound:()=>!!audio()?.src,getName:()=>selected?.name||'',cleanup};
})();

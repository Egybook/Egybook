/* Camera-only audio selection and recording mix. Extraction is on-demand and local. */
(() => {
 'use strict'; if(window.EgyBookCameraAudio)return;
 const $=s=>document.querySelector(s); let selected=null, objectUrl='', context=null, destination=null, mediaSource=null, mediaGain=null, micSource=null, micGain=null, busy=false;
 const audio=()=>$('#studioCameraMusicAudio');
 const chip=()=>$('#studioCameraSoundChip');
 function label(text){const node=$('#studioCameraSoundName');if(node)node.textContent=text||'الصوت المختار';if(chip())chip().hidden=!text;}
 function revoke(){if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl='';}}
 async function setFile(file,name='الصوت المختار',metadata={}) {if(!file)return false;const el=audio();if(!el)return false;revoke();objectUrl=URL.createObjectURL(file);el.pause();el.crossOrigin='anonymous';el.src=objectUrl;el.load();selected={file,name,metadata:{...metadata,name}};label(name);document.dispatchEvent(new CustomEvent('egybook:camera-audio-ready'));return true;}
 async function setRemoteTrack(track){
  if(!track?.trackId)return false;const el=audio();if(!el)return false;
  revoke();el.pause();el.crossOrigin='anonymous';el.src=`https://api.audius.co/v1/tracks/${encodeURIComponent(track.trackId)}/stream`;el.load();
  selected={source:track,name:track.title||'أغنية من EgyBook Music',metadata:{type:'music',trackId:String(track.trackId),title:track.title||'',artist:track.artist||'',artwork:track.artwork||'',name:track.title||'أغنية'}};
  label(formatLabel(selected));document.dispatchEvent(new CustomEvent('egybook:camera-audio-ready'));return true;
 }
 function formatLabel(item){
  const meta=item?.metadata||item?.source||{};
  if(meta.type==='reel'||meta.sourcePostId)return `الصوت الأصلي بواسطة ${meta.artist||meta.ownerName||'صاحب الحساب'} · ${item.name||''}`;
  if(meta.artist)return `${item.name||meta.title||'الأغنية'} · ${meta.artist}`;
  return item?.name||'الصوت المختار';
 }
 async function setReelSource(source){
  if(!source)return false;
  const sourceName=source.title||'صوت من Reels';
  selected={source,name:sourceName,metadata:{type:'reel',sourcePostId:source.sourcePostId||'',title:sourceName,artist:source.artist||source.ownerName||'صاحب الحساب',ownerName:source.ownerName||'',name:sourceName}};
  label('جارٍ تجهيز: '+formatLabel(selected));
  if(!window.EgyBookStudioDemux?.extract){label('تعذر تجهيز صوت الريلز');window.EgyBookStudio?.status?.('أداة استخراج الصوت غير متاحة حاليًا.','error');return false;}
  if(busy)return false;busy=true;
  try{
   let file=source.file||null;
   if(!file&&source.mediaUrl){file=await window.EgyBookStudioDemux.extract({url:source.mediaUrl,name:source.title||'EgyBook-Reel.mp4'});}
   else if(!file&&source.trackId){return await setRemoteTrack({trackId:source.trackId,title:source.title||'أغنية من EgyBook Music',artist:source.artist||'',artwork:source.artwork||''});}
   if(!file)throw new Error('SOURCE_NOT_AVAILABLE');
   await setFile(file,sourceName,{type:'reel',sourcePostId:source.sourcePostId||'',title:sourceName,artist:source.artist||source.ownerName||'صاحب الحساب',ownerName:source.ownerName||''});
   window.EgyBookStudio?.status?.('تم تجهيز صوت الريلز تلقائيًا، وسيعمل مع تسجيل الفيديو.','info');
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
  if(event.target.closest('[data-camera-audio-pick]')){
   if(typeof window.__egybookOpenCameraMusicPicker==='function')window.__egybookOpenCameraMusicPicker();
   else document.dispatchEvent(new CustomEvent('egybook:camera-music-library-request'));
   return;
  }
  if(event.target.closest('[data-camera-audio-preview]'))void preview();
 });
 document.addEventListener('change',event=>{if(event.target.id==='studioCameraAudioInput'){const file=event.target.files?.[0];if(file)void setFile(file,file.name);event.target.value='';}});
 window.EgyBookCameraAudio={setReelSource,setFile,setRemoteTrack,preview,prepareRecordingMix,setVolume,pause,isBusy:()=>busy,hasSound:()=>!!audio()?.src,getName:()=>selected?.name||'',getDisplayName:()=>selected?formatLabel(selected):'',getMetadata:()=>selected?.metadata||selected?.source||null,cleanup};
})();

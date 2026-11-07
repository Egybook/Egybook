/* EgyBook Smart Network Engine v206
 * Retries idempotent GET reads only. Never retries writes or caches API responses.
 */
(()=>{
 'use strict';
 if(window.EgyBookNetwork?.version===206)return;
 let banner=null,hideTimer=0,slow=false,lastRtt=0;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const connection=()=>navigator.connection||navigator.mozConnection||navigator.webkitConnection||null;
 function classify(){
  const c=connection(),type=String(c?.effectiveType||'').toLowerCase(),rtt=Number(c?.rtt)||0,down=Number(c?.downlink)||0;
  slow=!navigator.onLine||['slow-2g','2g'].includes(type)||(rtt>900)||(down>0&&down<0.35);
  return {online:navigator.onLine,slow,effectiveType:type||'unknown',rtt,downlink:down,lastRtt};
 }
 function ensureBanner(){
  if(banner||!document.body)return banner;
  banner=document.createElement('div');banner.id='egybook-network-status';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
  Object.assign(banner.style,{position:'fixed',top:'max(8px,env(safe-area-inset-top))',left:'50%',transform:'translate(-50%,-12px)',zIndex:'2147483000',maxWidth:'calc(100vw - 24px)',padding:'9px 16px',borderRadius:'999px',color:'#fff',background:'#b42318',boxShadow:'0 4px 18px rgba(0,0,0,.18)',font:'600 13px/1.4 system-ui,sans-serif',textAlign:'center',opacity:'0',pointerEvents:'none',transition:'opacity .2s ease,transform .2s ease'});
  document.body.appendChild(banner);return banner;
 }
 function show(message,kind='offline',duration=0){const el=ensureBanner();if(!el)return;el.textContent=message;el.style.background=kind==='online'?'#16834a':kind==='slow'?'#9a6700':'#b42318';el.style.opacity='1';el.style.transform='translate(-50%,0)';clearTimeout(hideTimer);if(duration)hideTimer=setTimeout(()=>{el.style.opacity='0';el.style.transform='translate(-50%,-12px)';},duration);}
 function update(){const state=classify();if(!state.online)show('الاتصال بالإنترنت منقطع — يتم عرض المحتوى المتاح', 'offline');else if(state.slow)show('الاتصال ضعيف — EgyBook يقلل التحميل ويحاول مجددًا', 'slow');else show('عاد الاتصال — جاري تحديث المحتوى', 'online',2600);window.dispatchEvent(new CustomEvent('egybook:network-state',{detail:state}));}
 const retryableStatus=s=>s===408||s===425||s===429||[500,502,503,504].includes(s);
 async function resilientFetch(input,init={}){
  const method=String(init.method||input?.method||'GET').toUpperCase();
  if(method!=='GET')return fetch(input,init);
  const maxAttempts=3;let lastError;
  for(let attempt=0;attempt<maxAttempts;attempt++){
   try{
    const started=performance.now();
    const response=await fetch(input,init);
    lastRtt=Math.max(0,Math.round(performance.now()-started));
    if(!response.ok&&retryableStatus(response.status)&&attempt<maxAttempts-1){await wait([350,900][attempt]);continue;}
    classify();return response;
   }catch(error){lastError=error;if(attempt>=maxAttempts-1)break;await wait([350,900][attempt]);}
  }
  throw lastError||new TypeError('Network read failed');
 }
 function init(){update();window.addEventListener('offline',update,{passive:true});window.addEventListener('online',update,{passive:true});connection()?.addEventListener?.('change',update);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
 window.EgyBookNetwork=Object.freeze({version:206,isOnline:()=>navigator.onLine,isSlow:()=>classify().slow,getState:classify,fetch:resilientFetch,showStatus:(message,kind='slow')=>show(message,kind,kind==='online'?2600:0)});
})();

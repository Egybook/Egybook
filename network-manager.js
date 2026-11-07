/* EgyBook Quiet Network Engine v208
 * Silent connectivity monitoring + bounded retries for idempotent GET reads.
 * Never retries writes and never displays repetitive connection banners.
 */
(()=>{
 'use strict';
 if(window.EgyBookNetwork?.version===208)return;
 let slow=false,lastRtt=0;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const connection=()=>navigator.connection||navigator.mozConnection||navigator.webkitConnection||null;
 function classify(){
  const c=connection(),type=String(c?.effectiveType||'').toLowerCase(),rtt=Number(c?.rtt)||0,down=Number(c?.downlink)||0;
  slow=!navigator.onLine||['slow-2g','2g'].includes(type)||rtt>900||(down>0&&down<0.35);
  return {online:navigator.onLine,slow,effectiveType:type||'unknown',rtt,downlink:down,lastRtt};
 }
 function update(){window.dispatchEvent(new CustomEvent('egybook:network-state',{detail:classify()}));}
 const retryableStatus=s=>s===408||s===425||s===429||[500,502,503,504].includes(s);
 async function resilientFetch(input,init={}){
  const method=String(init.method||input?.method||'GET').toUpperCase();
  if(method!=='GET')return fetch(input,init);
  const maxAttempts=3;let lastError;
  for(let attempt=0;attempt<maxAttempts;attempt++){
   try{
    const started=performance.now(),response=await fetch(input,init);
    lastRtt=Math.max(0,Math.round(performance.now()-started));
    if(!response.ok&&retryableStatus(response.status)&&attempt<maxAttempts-1){await wait([500,1400][attempt]);continue;}
    update();return response;
   }catch(error){lastError=error;if(attempt>=maxAttempts-1)break;await wait([500,1400][attempt]);}
  }
  throw lastError||new TypeError('Network read failed');
 }
 function init(){update();window.addEventListener('offline',update,{passive:true});window.addEventListener('online',update,{passive:true});connection()?.addEventListener?.('change',update);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
 window.EgyBookNetwork=Object.freeze({version:208,isOnline:()=>navigator.onLine,isSlow:()=>classify().slow,getState:classify,fetch:resilientFetch,showStatus:()=>{}});
})();

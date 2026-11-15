/* EgyBook media views v38 — event-driven counts, real playback sessions and completion statistics. */
(()=>{
  'use strict';
  if(window.EgyBookViews?.version===38)return;

  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const countCache=new Map();
  const loadedIds=new Set();
  const pendingIds=new Set();
  const retryAfter=new Map();
  const mediaSessions=new WeakMap();
  const observed=new WeakSet();
  const fetchQueue=new Set();
  const imageTimers=new Set();
  let client=null,userPromise=null,refreshTimer=0,fetchTimer=0,io=null,imageSequence=0;

  const fmt=value=>new Intl.NumberFormat('ar-EG',{notation:'compact',maximumFractionDigits:1})
    .format(Math.max(0,Number(value)||0));
  const getClient=()=>window.__egybookSupabaseClient||window.supabaseClient||null;
  const uuid=()=>window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{
    const random=Math.random()*16|0;return(char==='x'?random:(random&3|8)).toString(16);
  });
  const validId=id=>/^[0-9a-f-]{36}$/i.test(String(id||''));
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
  const hasNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

  async function user(){
    client=getClient();
    if(!client?.auth)return null;
    if(!userPromise)userPromise=client.auth.getUser().then(({data,error})=>error?null:data?.user?.id||null).catch(()=>null);
    return userPromise;
  }
  function postId(root){
    if(!root)return '';
    return String(root.dataset?.postId||root.dataset?.momentPost||root.dataset?.reelId||root.closest?.('.post')?.dataset?.postId||'');
  }
  function getMediaPostId(media){
    const post=media?.closest?.('.post');
    if(post?.dataset.postId)return String(post.dataset.postId);
    const modal=media?.closest?.('#egybookVideoModal')||$('#egybookVideoModal');
    return String(modal?.dataset.postId||'');
  }
  function makeEyeIcon(){
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
    const outline=document.createElementNS('http://www.w3.org/2000/svg','path');
    outline.setAttribute('d','M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z');
    const pupil=document.createElementNS('http://www.w3.org/2000/svg','circle');
    pupil.setAttribute('cx','12');pupil.setAttribute('cy','12');pupil.setAttribute('r','2.7');
    icon.append(outline,pupil);return icon;
  }
  function statsFor(root){
    const id=postId(root);
    return id?countCache.get(id)||null:null;
  }
  function applyBadge(el,stats,kind='video'){
    if(!el)return;
    let icon=el.querySelector(':scope > svg.eb-media-view-icon');
    let value=el.querySelector(':scope > .eb-media-views-value');
    let percent=el.querySelector(':scope > .eb-media-view-completion');
    if(!icon)icon=makeEyeIcon();
    icon.classList.add('eb-media-view-icon');
    if(!value){value=document.createElement('span');value.className='eb-media-views-value';}
    if(!percent){percent=document.createElement('span');percent.className='eb-media-view-completion';}
    // Normalize the badge once, removing stale text such as "إعجاب" only
    // inside this dedicated counter. Do not mutate an already-correct subtree:
    // the feed MutationObservers watch child changes and must not self-trigger.
    const children=Array.from(el.childNodes);
    const normalized=children.length===3&&children[0]===icon&&children[1]===value&&children[2]===percent;
    if(!normalized)el.replaceChildren(icon,value,percent);
    const hasCount=stats&&Number.isFinite(Number(stats.count));
    const nextValue=hasCount?fmt(stats.count):'—';
    if(value.textContent!==nextValue)value.textContent=nextValue;
    const nextHidden=kind!=='video'||!stats||!hasNumber(stats.avgCompletion);
    if(percent.hidden!==nextHidden)percent.hidden=nextHidden;
    if(!nextHidden){
      const nextPercent=`${Math.round(stats.avgCompletion)}٪`;
      if(percent.textContent!==nextPercent)percent.textContent=nextPercent;
    }
    const nextTitle=hasCount
      ?`عدد المشاهدات: ${Number(stats.count)||0}${!nextHidden?` • متوسط إكمال الفيديو: ${Math.round(stats.avgCompletion)}٪`:''}`
      :'عدد المشاهدات غير متاح حاليًا';
    if(el.title!==nextTitle)el.title=nextTitle;
  }
  function badge(root,place='preview'){
    if(!root)return null;
    let el=root.querySelector(':scope > .eb-media-views');
    if(!el){
      el=document.createElement('span');
      el.className=`eb-media-views eb-media-views-${place}`;
      el.setAttribute('aria-label','عدد المشاهدات');
      root.append(el);
    }else el.classList.add(`eb-media-views-${place}`);
    const post=root.closest?.('.post');
    const kind=post?.dataset.mediaType==='video'?'video':'image';
    applyBadge(el,statsFor(root)||null,kind);
    return el;
  }
  function updateBadgeForId(el,id,stats){
    const owner=el.closest?.('.post');
    const moment=el.closest?.('[data-moment-post]');
    const modal=el.closest?.('#egybookVideoModal');
    const matches=String(owner?.dataset.postId||moment?.dataset.momentPost||modal?.dataset.postId||'')===String(id);
    if(!matches)return;
    const kind=owner?.dataset.mediaType==='video'||modal?.dataset.mediaKind==='video'?'video':'image';
    applyBadge(el,stats,kind);
  }
  function badgesForId(id){
    // UUIDs are validated before they enter this selector; querying only the
    // matching post/moment/player avoids rescanning every badge for each row.
    const key=String(id);
    return $$(`.post[data-post-id="${key}"] .eb-media-views,[data-moment-post="${key}"] > .eb-media-views,#egybookVideoModal[data-post-id="${key}"] .eb-media-views`);
  }
  function paint(id,stats){
    id=String(id);
    const normalized={
      count:Math.max(0,Number(stats?.count)||0),
      avgCompletion:hasNumber(stats?.avgCompletion)?clamp(stats.avgCompletion,0,100):null
    };
    countCache.set(id,normalized);
    badgesForId(id).forEach(el=>updateBadgeForId(el,id,normalized));
  }
  function markUnavailable(id,message='تعذر تحميل بيانات المشاهدة. يلزم مراجعة ترحيل المشاهدات في Supabase.'){
    badgesForId(id).forEach(el=>{
      const value=el.querySelector('.eb-media-views-value');
      const percent=el.querySelector('.eb-media-view-completion');
      if(value)value.textContent='—';
      if(percent)percent.hidden=true;
      el.title=message;
    });
  }

  async function fetchCounts(ids){
    client=getClient();
    if(!ids.length)return;
    if(!client){ids.forEach(id=>{pendingIds.delete(id);retryAfter.set(id,Date.now()+60000);markUnavailable(id);});return;}
    const uid=await user();
    if(!uid){ids.forEach(id=>{pendingIds.delete(id);retryAfter.set(id,Date.now()+60000);markUnavailable(id,'سجّل الدخول لعرض إحصائيات المشاهدة.');});return;}
    for(let index=0;index<ids.length;index+=80){
      const batch=ids.slice(index,index+80);
      let data=null,error=null,hasCompletion=true;
      const statsResult=await client.rpc('get_post_media_view_stats',{p_post_ids:batch});
      if(statsResult.error){
        const message=String(statsResult.error.message||'');
        if(/function|schema cache|does not exist|could not find/i.test(message)){
          hasCompletion=false;
          const legacyResult=await client.rpc('get_post_media_view_counts',{p_post_ids:batch});
          data=legacyResult.data;error=legacyResult.error;
        }else error=statsResult.error;
      }else data=statsResult.data;

      if(error){
        console.warn('[EgyBook views] count batch unavailable:',error.message);
        batch.forEach(id=>{pendingIds.delete(id);retryAfter.set(id,Date.now()+60000);markUnavailable(id);});
        continue;
      }
      const returned=new Set();
      (data||[]).forEach(row=>{
        const id=String(row.post_id);returned.add(id);loadedIds.add(id);pendingIds.delete(id);retryAfter.delete(id);
        paint(id,{
          count:row.view_count,
          avgCompletion:hasCompletion&&row.avg_completion_percent!==null&&row.avg_completion_percent!==undefined
            ?Number(row.avg_completion_percent):null
        });
      });
      // The count RPC returns one row per requested id, including zero. Missing
      // rows are treated as unavailable instead of silently fabricating zero.
      batch.forEach(id=>{
        if(returned.has(id))return;
        pendingIds.delete(id);retryAfter.set(id,Date.now()+60000);markUnavailable(id,'لم يرجع خادم المشاهدات سجلًا لهذا المحتوى.');
      });
    }
  }
  function queueCounts(ids){
    ids.forEach(id=>{
      if(!validId(id)||loadedIds.has(id)||pendingIds.has(id)||Date.now()<(retryAfter.get(id)||0))return;
      pendingIds.add(id);fetchQueue.add(id);
    });
    if(!fetchQueue.size||fetchTimer)return;
    fetchTimer=setTimeout(()=>{
      fetchTimer=0;const batch=[...fetchQueue];fetchQueue.clear();
      void fetchCounts(batch).catch(error=>{
        console.warn('[EgyBook views] count request failed:',error?.message||error);
        batch.forEach(id=>{pendingIds.delete(id);retryAfter.set(id,Date.now()+60000);markUnavailable(id);});
      });
    },160);
  }

  async function record(id,kind,sessionId,watchedSeconds=0,durationSeconds=null){
    id=String(id||'');
    if(!validId(id)||!sessionId)return {ok:false,inserted:false,extended:false};
    try{
      const uid=await user();client=getClient();
      if(!uid||!client)return {ok:false,inserted:false,extended:false};
      const mediaKind=kind==='image'?'image':'video';
      const watched=clamp(watchedSeconds,0,86400);
      const duration=hasNumber(durationSeconds)&&Number(durationSeconds)>0?clamp(durationSeconds,0,86400):null;
      const args={
        p_post_id:id,p_media_kind:mediaKind,p_view_session_id:sessionId,
        p_watched_seconds:watched,p_media_duration_seconds:duration
      };
      let result=await client.rpc('record_post_media_view',args);
      let extended=!result.error;
      if(result.error&&/function|schema cache|p_watched_seconds|p_media_duration_seconds|does not exist|could not find/i.test(result.error.message||'')){
        result=await client.rpc('record_post_media_view',{
          p_post_id:id,p_media_kind:mediaKind,p_view_session_id:sessionId
        });
        extended=false;
      }
      if(result.error&&/function|schema cache|p_view_session_id|does not exist|could not find/i.test(result.error.message||'')){
        result=await client.rpc('record_post_media_view',{p_post_id:id,p_media_kind:mediaKind});
        extended=false;
      }
      if(result.error){console.warn('[EgyBook views] record failed:',result.error.message);return {ok:false,inserted:false,extended:false};}
      const inserted=result.data===true;
      if(inserted){
        const current=countCache.get(id);
        if(current){
          paint(id,{count:current.count+1,avgCompletion:current.avgCompletion});
        }else queueCounts([id]);
        window.dispatchEvent(new CustomEvent('egybook:media-view-counted',{detail:{postId:id,kind:mediaKind}}));
      }
      return {ok:true,inserted,extended};
    }catch(error){
      console.warn('[EgyBook views] record request failed:',error?.message||error);
      return {ok:false,inserted:false,extended:false};
    }
  }

  function ensurePost(post){
    if(!post?.matches?.('.post'))return;
    const media=post.querySelector('.post-image,video.egybook-feed-video');
    if(!media)return;
    let wrap=media.parentElement;
    if(!wrap?.classList.contains('eb-view-preview-wrap')){
      if(wrap?.classList.contains('post-media-single-wrap'))wrap.classList.add('eb-view-preview-wrap');
      else{
        const parent=media.parentNode;if(!parent)return;
        wrap=document.createElement('div');wrap.className='eb-view-preview-wrap';
        parent.insertBefore(wrap,media);wrap.append(media);
      }
    }
    badge(wrap,'preview');
  }
  function ensurePlayer(){
    const rail=$('#evpPostRail'),box=$('#egybookVideoBox'),modal=$('#egybookVideoModal');
    if(rail&&box){box.classList.add('eb-view-positioned');badge(rail,'player');}
    const image=$('#imageViewer');if(image){image.classList.add('eb-view-positioned');badge(image,'player');}
    if(modal?.dataset.postId){
      const id=String(modal.dataset.postId);
      const stats=countCache.get(id);
      if(stats&&rail)rail.querySelectorAll('.eb-media-views').forEach(el=>applyBadge(el,stats,modal.dataset.mediaKind==='video'?'video':'image'));
      else queueCounts([id]);
    }
  }
  function ensureMoments(){
    document.querySelectorAll('#momentsStrip [data-moment-post]').forEach(tile=>badge(tile,'moment'));
  }
  function isVisible(media){
    if(document.hidden||!media?.isConnected)return false;
    const rect=media.getBoundingClientRect();
    const width=Math.max(0,Math.min(rect.right,innerWidth)-Math.max(rect.left,0));
    const height=Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0));
    return rect.width>0&&rect.height>0&&(width*height)/(rect.width*rect.height)>=.55;
  }
  function sessionInfo(media){
    const root=media.closest('.post')||$('#egybookVideoModal');
    const id=getMediaPostId(media)||postId(root);
    return validId(id)?id:'';
  }
  function beginSession(media){
    if(!media||media.tagName!=='VIDEO'||!isVisible(media))return;
    const id=sessionInfo(media);if(!id)return;
    const now=performance.now(),current=Number(media.currentTime)||0;
    let state=mediaSessions.get(media);
    if(!state||state.postId!==id||state.completed){
      state={postId:id,sessionId:uuid(),watchedSeconds:0,lastTime:current,lastAt:now,duration:Number(media.duration)||0,counted:false,extended:false,lastSyncPercent:0,lastSyncAt:0,completed:false};
      mediaSessions.set(media,state);
    }else{
      state.lastTime=current;state.lastAt=now;state.duration=Number(media.duration)||state.duration||0;
    }
  }
  async function sendSession(media,state,{force=false}={}){
    if(!state||state.watchedSeconds<1.5||state.syncPending)return;
    const duration=Number(media.duration)||state.duration||0;
    const percent=duration>0?clamp(state.watchedSeconds/duration*100,0,100):null;
    const now=Date.now();
    if(!state.counted){
      const threshold=duration>0?Math.min(3,Math.max(1.5,duration*.35)):3;
      if(state.watchedSeconds<threshold||now-(state.lastAttemptAt||0)<8000)return;
      state.lastAttemptAt=now;
      state.syncPending=true;
      try{
        const result=await record(state.postId,'video',state.sessionId,state.watchedSeconds,duration);
        if(!result.ok)return;
        state.counted=true;state.extended=result.extended;
        state.lastSyncPercent=percent||0;state.lastSyncAt=Date.now();
      }finally{state.syncPending=false;}
      return;
    }
    if(!state.extended||percent===null)return;
    if(!force&&Math.abs(percent-state.lastSyncPercent)<8)return;
    // Pause/resume must not generate a write on every interaction. The final
    // ended event is allowed to flush immediately; normal syncs are throttled.
    if(!media.ended&&now-state.lastSyncAt<10000)return;
    state.syncPending=true;
    try{
      const result=await record(state.postId,'video',state.sessionId,state.watchedSeconds,duration);
      if(result.ok){state.lastSyncPercent=percent;state.lastSyncAt=Date.now();queueCounts([state.postId]);}
    }finally{state.syncPending=false;}
  }
  function accumulate(media,{allowPaused=false,forceSync=false}={}){
    let state=mediaSessions.get(media);
    if(!state){beginSession(media);state=mediaSessions.get(media);}
    if(!state||(!allowPaused&&media.paused)||!isVisible(media))return;
    const now=performance.now(),current=Number(media.currentTime)||0;
    const wall=Math.max(.01,(now-state.lastAt)/1000);
    const delta=current-state.lastTime;
    // Count only time that plausibly elapsed in real playback; scrubbing/seeking
    // is not counted as watched time.
    if(delta>0&&delta<=Math.min(6,Math.max(1.2,wall*1.8)))state.watchedSeconds+=Math.min(delta,wall*1.8);
    state.lastTime=current;state.lastAt=now;state.duration=Number(media.duration)||state.duration||0;
    void sendSession(media,state,{force:forceSync});
  }
  function isTrackedMedia(media){
    return !!media&&media.tagName==='VIDEO'&&media.matches('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer');
  }
  function observeMedia(media){
    if(!media||observed.has(media))return;
    observed.add(media);
    if(io&&media.tagName==='VIDEO')io.observe(media);
  }
  function addPostId(post,ids){
    ensurePost(post);
    const id=postId(post);if(validId(id))ids.add(id);
  }
  function refresh(){
    const ids=new Set();
    document.querySelectorAll('#postsList .post,#profilePostsList .post').forEach(post=>addPostId(post,ids));
    ensureMoments();ensurePlayer();
    document.querySelectorAll('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer').forEach(observeMedia);
    document.querySelectorAll('#momentsStrip [data-moment-post]').forEach(tile=>{const id=postId(tile);if(validId(id))ids.add(id);});
    queueCounts([...ids]);
  }
  function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,240);}
  function processAddedNode(node,ids){
    if(!node||node.nodeType!==1)return;
    const isFeedPost=post=>post&&(
      post.closest('#postsList')||post.closest('#profilePostsList')
    );
    const ancestor=node.matches?.('.post')?node:node.closest?.('.post');
    if(ancestor&&isFeedPost(ancestor))addPostId(ancestor,ids);
    node.querySelectorAll?.('.post').forEach(post=>{if(isFeedPost(post))addPostId(post,ids);});
    if(node.matches?.('[data-moment-post]')){
      badge(node,'moment');const id=postId(node);if(validId(id))ids.add(id);
    }
    node.querySelectorAll?.('#momentsStrip [data-moment-post], [data-moment-post]').forEach(tile=>{
      badge(tile,'moment');const id=postId(tile);if(validId(id))ids.add(id);
    });
    node.querySelectorAll?.('video.egybook-feed-video,#egybookVideoPlayer').forEach(observeMedia);
  }
  function handleMutations(records){
    const ids=new Set();
    records.forEach(record=>{
      const parentPost=record.target?.closest?.('.post');
      if(parentPost&&(parentPost.closest('#postsList')||parentPost.closest('#profilePostsList')))addPostId(parentPost,ids);
      record.addedNodes.forEach(node=>processAddedNode(node,ids));
    });
    queueCounts([...ids]);
  }

  if('IntersectionObserver'in window){
    io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      const media=entry.target;
      if(entry.isIntersecting&&entry.intersectionRatio>=.55&&!media.paused)beginSession(media);
    }),{threshold:[.55,.7]});
  }
  document.addEventListener('play',event=>{
    const media=event.target;
    if(media?.tagName==='VIDEO'&&media.matches('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer'))beginSession(media);
  },true);
  document.addEventListener('timeupdate',event=>{
    const media=event.target;
    if(media?.tagName==='VIDEO'&&media.matches('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer'))accumulate(media);
  },true);
  document.addEventListener('seeking',event=>{
    const state=mediaSessions.get(event.target);
    if(state){state.lastTime=Number(event.target.currentTime)||0;state.lastAt=performance.now();}
  },true);
  document.addEventListener('pause',event=>{
    const media=event.target;if(!isTrackedMedia(media))return;
    accumulate(media,{allowPaused:true,forceSync:true});
  },true);
  document.addEventListener('ended',event=>{
    const media=event.target;if(!isTrackedMedia(media))return;
    accumulate(media,{allowPaused:true,forceSync:true});
    const state=mediaSessions.get(media);if(state)state.completed=true;
  },true);
  document.addEventListener('egybook:evp-post-context',event=>{
    const player=$('#egybookVideoPlayer');
    if(player){const state=mediaSessions.get(player);if(state)accumulate(player,{allowPaused:true,forceSync:true});mediaSessions.delete?.(player);}
    requestAnimationFrame(()=>{
      ensurePlayer();
      const id=String(event.detail?.post?.dataset?.postId||'');
      if(validId(id))queueCounts([id]);
    });
  });
  document.addEventListener('egybook:media-view-open',event=>{
    const detail=event.detail||{};
    if(!detail.postId||detail.kind!=='image')return;
    const sequence=++imageSequence;
    imageTimers.forEach(timer=>clearTimeout(timer));imageTimers.clear();
    const timer=setTimeout(()=>{
      imageTimers.delete(timer);
      if(sequence!==imageSequence||document.hidden||!detail.root?.isConnected)return;
      const modal=$('#egybookVideoModal'),viewer=$('#imageViewer');
      const mediaOpen=!!(viewer&&!viewer.hidden)||!!(modal?.classList.contains('open')&&modal.dataset.mediaKind!=='video');
      if(mediaOpen)void record(String(detail.postId),'image',uuid());
    },1800);
    imageTimers.add(timer);
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      // No polling or timers continue while the page is backgrounded.
      imageTimers.forEach(timer=>clearTimeout(timer));imageTimers.clear();imageSequence++;
    }
  });
  document.addEventListener('egybook:pagechange',scheduleRefresh);
  document.addEventListener('egybook:reels-feed-refresh',scheduleRefresh);
  document.addEventListener('egybook:moment-feed-refresh',scheduleRefresh);

  ['postsList','profilePostsList','momentsStrip'].forEach(id=>{
    const node=document.getElementById(id);
    if(node)new MutationObserver(handleMutations).observe(node,{childList:true,subtree:true});
  });
  client=getClient();
  if(client?.auth?.onAuthStateChange)client.auth.onAuthStateChange(()=>{
    userPromise=null;retryAfter.clear();pendingIds.clear();loadedIds.clear();scheduleRefresh();
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});
  else refresh();
  window.EgyBookViews=Object.freeze({version:38,refresh,record,format:fmt});
})();

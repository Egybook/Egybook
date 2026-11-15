/* EgyBook media views v42 — isolated badge integrity across cloned comment routes. */
(()=>{
  'use strict';
  if(window.EgyBookViews?.version===42)return;

  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const countCache=new Map();
  const COUNT_CACHE_TTL_MS=12000;
  const ACTIVE_REEL_STATS_TTL_MS=2500;
  const ACTIVE_REEL_RETRY_GUARD_MS=1800;
  const loadedIds=new Set();
  const pendingIds=new Set();
  const retryAfter=new Map();
  const mediaSessions=new WeakMap();
  const observed=new WeakSet();
  const badgeObservers=new WeakMap();
  const fetchQueue=new Set();
  const imageTimers=new Set();
  const musicViewSessions=new Map();
  const activeReelRefreshAt=new Map();
  let activeReelPostId='';
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
    return String(root.dataset?.postId||root.dataset?.momentPost||root.dataset?.reelId||root.closest?.('.post')?.dataset?.postId||root.closest?.('#egybookVideoModal')?.dataset?.postId||'');
  }
  function getMediaPostId(media){
    const post=media?.closest?.('.post');
    if(post?.dataset.postId)return String(post.dataset.postId);
    const modal=media?.closest?.('#egybookVideoModal')||$('#egybookVideoModal');
    return String(modal?.dataset.postId||'');
  }
  function isReelsPlayerContext(modal){
    return !!modal&&modal.dataset.evpContext==='reels'&&modal.classList.contains('evp-reels-context');
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
  function isMusicImage(post){
    if(!post||String(post.dataset.mediaType||'').toLowerCase()!=='image')return false;
    return !!(post.dataset.musicTrackId||post.dataset.audioSourcePostId||post.querySelector('[data-post-music-player][data-track-id],.post-music-player'));
  }
  function isCountablePost(post){
    if(!post?.matches?.('.post'))return false;
    const type=String(post.dataset.mediaType||'').toLowerCase();
    return ['video','reel','moment_video'].includes(type)||isMusicImage(post);
  }
  function mediaKindForPost(post){
    return ['video','reel','moment_video'].includes(String(post?.dataset.mediaType||'').toLowerCase())?'video':'image';
  }
  function statsFor(root){
    const id=postId(root);
    return id?countCache.get(id)||null:null;
  }
  function applyBadge(el,stats,kind='video'){
    if(!el)return;
    // A view badge is a dedicated, non-interactive component. Remove legacy
    // action attributes/classes before rebuilding its three owned children.
    const place=el.classList.contains('eb-media-views-moment')?'moment':
      el.classList.contains('eb-media-views-player')?'player':
      el.classList.contains('eb-media-views-reels')?'reels':'preview';
    el.className=`eb-media-views eb-media-views-${place}`;
    el.removeAttribute('data-action');
    el.removeAttribute('aria-pressed');
    el.removeAttribute('onclick');
    let icon=el.querySelector(':scope > svg.eb-media-view-icon');
    let value=el.querySelector(':scope > .eb-media-views-value');
    let percent=el.querySelector(':scope > .eb-media-view-completion');
    if(!icon)icon=makeEyeIcon();
    icon.className.baseVal='eb-media-view-icon';
    icon.setAttribute('aria-hidden','true');
    if(!value){value=document.createElement('span');}
    value.className='eb-media-views-value';
    if(!percent){percent=document.createElement('span');}
    percent.className='eb-media-view-completion';
    const children=Array.from(el.childNodes);
    const normalized=children.length===3&&children[0]===icon&&children[1]===value&&children[2]===percent;
    if(!normalized)el.replaceChildren(icon,value,percent);
    el.setAttribute('role','img');
    el.setAttribute('aria-label','إحصائيات المشاهدة');
    const hasCount=stats&&Number.isFinite(Number(stats.count));
    const nextValue=hasCount?fmt(stats.count):'…';
    if(value.textContent!==nextValue)value.textContent=nextValue;
    const showCompletion=['video','music'].includes(kind)&&!!stats&&hasNumber(stats.avgCompletion);
    percent.hidden=!showCompletion;
    if(showCompletion){
      const nextPercent=`${Math.round(stats.avgCompletion)}٪`;
      if(percent.textContent!==nextPercent)percent.textContent=nextPercent;
    }else if(percent.textContent){
      // Clear hidden legacy content (including accidental Like labels) as well
      // as hiding the element. This is safe even if another stylesheet changes
      // the browser's default [hidden] presentation.
      percent.textContent='';
    }
    const nextTitle=hasCount
      ?`عدد المشاهدات: ${Number(stats.count)||0}${showCompletion?` • متوسط الإكمال: ${Math.round(stats.avgCompletion)}٪`:''}`
      :'إحصائيات المشاهدة غير متاحة حاليًا';
    if(el.title!==nextTitle)el.title=nextTitle;
  }
  function watchBadgeIntegrity(el,kind){
    if(!el||badgeObservers.has(el)||!('MutationObserver'in window))return;
    const observer=new MutationObserver(()=>{
      const icon=el.querySelector(':scope > svg.eb-media-view-icon');
      const value=el.querySelector(':scope > .eb-media-views-value');
      const percent=el.querySelector(':scope > .eb-media-view-completion');
      const children=Array.from(el.childNodes);
      const structure=children.length===3&&children[0]===icon&&children[1]===value&&children[2]===percent;
      const foreignLikeLabel=/إعجاب|اعجاب/.test(el.textContent||'');
      if(!structure||foreignLikeLabel){
        const id=String(el.dataset.mediaViewPostId||'');
        applyBadge(el,id?countCache.get(id)||null:null,el.dataset.mediaViewKind||kind);
      }
    });
    observer.observe(el,{childList:true,characterData:true,subtree:true});
    badgeObservers.set(el,observer);
  }
  function badge(root,place='preview'){
    if(!root)return null;
    const post=root.matches?.('.post')?root:root.closest?.('.post');
    const isMomentTile=root.matches?.('[data-moment-post]');
    const modal=root.closest?.('#egybookVideoModal')||root.matches?.('#egybookVideoModal')?root.closest?.('#egybookVideoModal')||root: null;
    const modalKind=String(modal?.dataset.mediaKind||'').toLowerCase();
    const modalBadgeAllowed=place==='player'&&isReelsPlayerContext(modal)&&['video','reel'].includes(modalKind);
    const allowed=!!(isMomentTile||(post&&isCountablePost(post))||modalBadgeAllowed);
    let el=root.querySelector(':scope > .eb-media-views');
    if(!allowed){if(el){badgeObservers.get(el)?.disconnect();el.remove();}return null;}
    if(el&&el.tagName!=='SPAN'){badgeObservers.get(el)?.disconnect();el.remove();el=null;}
    if(!el){el=document.createElement('span');el.className=`eb-media-views eb-media-views-${place}`;el.setAttribute('aria-label','إحصائيات المشاهدة');root.append(el);}
    else if(el.className!==`eb-media-views eb-media-views-${place}`)el.className=`eb-media-views eb-media-views-${place}`;
    const id=postId(root);
    if(id)el.dataset.mediaViewPostId=id;else delete el.dataset.mediaViewPostId;
    const kind=isMomentTile?'music':post?(isMusicImage(post)?'music':mediaKindForPost(post)):(['video','reel'].includes(modalKind)?'video':(['audio','source-audio'].includes(modalKind)?'music':'image'));
    el.dataset.mediaViewKind=kind;
    applyBadge(el,statsFor(root)||null,kind);
    watchBadgeIntegrity(el,kind);
    return el;
  }
  function updateBadgeForId(el,id,stats){
    const owner=el.closest?.('.post');
    const moment=el.closest?.('[data-moment-post]');
    const modal=el.closest?.('#egybookVideoModal');
    const matches=String(owner?.dataset.postId||moment?.dataset.momentPost||modal?.dataset.postId||'')===String(id);
    if(!matches)return;
    if(owner&&!isCountablePost(owner)){badgeObservers.get(el)?.disconnect();el.remove();return;}
    const modalKind=String(modal?.dataset.mediaKind||'').toLowerCase();
    if(modal&&!isReelsPlayerContext(modal)){badgeObservers.get(el)?.disconnect();el.remove();return;}
    const kind=owner?(isMusicImage(owner)?'music':mediaKindForPost(owner)):(moment?'music':'video');
    el.dataset.mediaViewKind=kind;
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
      avgCompletion:hasNumber(stats?.avgCompletion)?clamp(stats.avgCompletion,0,100):null,
      fetchedAt:Date.now()
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
  function invalidateAndQueue(id){
    id=String(id||'');if(!validId(id))return;
    loadedIds.delete(id);countCache.delete(id);retryAfter.delete(id);queueCounts([id]);
  }
  function queueCounts(ids,{force=false,priority=false}={}){
    const queued=[];
    ids.forEach(id=>{
      if(!validId(id)||pendingIds.has(id)||Date.now()<(retryAfter.get(id)||0))return;
      if(force)loadedIds.delete(id);
      if(loadedIds.has(id)){
        const cached=countCache.get(id);
        if(cached&&Date.now()-(cached.fetchedAt||0)<COUNT_CACHE_TTL_MS)return;
        loadedIds.delete(id);
      }
      pendingIds.add(id);
      if(priority)queued.push(id);else fetchQueue.add(id);
    });
    if(priority&&queued.length){
      const ordered=new Set([...queued,...fetchQueue]);
      fetchQueue.clear();ordered.forEach(id=>fetchQueue.add(id));
    }
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
      if(inserted)window.dispatchEvent(new CustomEvent('egybook:media-view-counted',{detail:{postId:id,kind:mediaKind}}));
      // The SQL RPC returns false when it updated an existing session row.
      // Completion still changed, so invalidate aggregates on every successful write.
      invalidateAndQueue(id);
      return {ok:true,inserted,extended};
    }catch(error){
      console.warn('[EgyBook views] record request failed:',error?.message||error);
      return {ok:false,inserted:false,extended:false};
    }
  }

  function ensurePost(post){
    if(!post?.matches?.('.post'))return;
    if(!isCountablePost(post)){post.querySelectorAll(':scope .eb-media-views').forEach(el=>{badgeObservers.get(el)?.disconnect();el.remove();});return;}
    const media=post.querySelector('.post-image,video.egybook-feed-video');
    if(!media)return;
    let wrap=media.parentElement;
    if(!wrap?.classList.contains('eb-view-preview-wrap')){
      if(wrap?.classList.contains('post-media-single-wrap'))wrap.classList.add('eb-view-preview-wrap');
      else{const parent=media.parentNode;if(!parent)return;wrap=document.createElement('div');wrap.className='eb-view-preview-wrap';parent.insertBefore(wrap,media);wrap.append(media);}
    }
    badge(wrap,'preview');
  }
  function queueActiveReelStats(id,{immediate=false}={}){
    const now=Date.now();
    const cached=countCache.get(id);
    const cacheAge=cached?now-(cached.fetchedAt||0):Infinity;
    if(!immediate&&cacheAge<ACTIVE_REEL_STATS_TTL_MS)return;
    const lastRequest=activeReelRefreshAt.get(id)||0;
    if(!immediate&&now-lastRequest<ACTIVE_REEL_RETRY_GUARD_MS)return;
    activeReelRefreshAt.set(id,now);
    // Switching to a new Reel bypasses the preview cache immediately. The
    // badge is already rebound to this ID, so no previous Reel value can leak.
    queueCounts([id],{force:true,priority:true});
    // Bound this bookkeeping map for long sessions with many unique Reels.
    if(activeReelRefreshAt.size>300){
      const cutoff=now-120000;
      for(const [key,time] of activeReelRefreshAt){if(time<cutoff)activeReelRefreshAt.delete(key);}
      while(activeReelRefreshAt.size>240)activeReelRefreshAt.delete(activeReelRefreshAt.keys().next().value);
    }
  }
  function ensurePlayer(){
    const rail=$('#evpPostRail'),box=$('#egybookVideoBox'),modal=$('#egybookVideoModal');
    const kind=String(modal?.dataset.mediaKind||'').toLowerCase();
    const id=String(modal?.dataset.postId||'');
    const reelsPlayerAllowed=isReelsPlayerContext(modal)&&['video','reel'].includes(kind)&&validId(id);
    if(rail&&box&&reelsPlayerAllowed){
      box.classList.add('eb-view-positioned');
      box.querySelectorAll(':scope > .eb-media-views').forEach(el=>{badgeObservers.get(el)?.disconnect();el.remove();});
      const el=badge(rail,'player');
      if(el){
        // The player rail node is reused. Always bind and paint from the active
        // Reel ID before requesting fresh aggregates, never from the prior Reel.
        el.dataset.mediaViewPostId=id;
        applyBadge(el,countCache.get(id)||null,'video');
      }
      const changedReel=activeReelPostId!==id;
      activeReelPostId=id;
      modal.dataset.viewsActivePostId=id;
      queueActiveReelStats(id,{immediate:changedReel});
    }else{
      activeReelPostId='';
      delete modal?.dataset.viewsActivePostId;
      rail?.querySelectorAll(':scope > .eb-media-views').forEach(el=>{
        badgeObservers.get(el)?.disconnect();
        el.remove();
      });
      box?.querySelectorAll(':scope > .eb-media-views').forEach(el=>{
        badgeObservers.get(el)?.disconnect();
        el.remove();
      });
      box?.classList.remove('eb-view-positioned');
    }
    // Normal video/photo/music viewers and Moments players intentionally do
    // not show an in-player counter. Preview cards and Moment thumbnails own it.
    const image=$('#imageViewer');
    image?.querySelectorAll(':scope > .eb-media-views').forEach(el=>{
      badgeObservers.get(el)?.disconnect();
      el.remove();
    });
    image?.classList.remove('eb-view-positioned');
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
      state={postId:id,sessionId:uuid(),mediaKind:'video',watchedSeconds:0,lastTime:current,lastAt:now,duration:Number(media.duration)||0,counted:false,extended:false,lastSyncPercent:0,lastSyncAt:0,completed:false};
      mediaSessions.set(media,state);
    }else{
      state.lastTime=current;state.lastAt=now;state.duration=Number(media.duration)||state.duration||0;
    }
  }
  async function sendSession(media,state,{force=false}={}){
    if(!state||state.watchedSeconds<1.5||state.syncPending)return;
    const duration=state.mediaKind==='image'?(state.duration||0):(Number(media.duration)||state.duration||0);
    const percent=duration>0?clamp(state.watchedSeconds/duration*100,0,100):null;
    const now=Date.now();
    if(!state.counted){
      const threshold=duration>0?Math.min(3,Math.max(1.5,duration*.35)):3;
      if(state.watchedSeconds<threshold||now-(state.lastAttemptAt||0)<8000)return;
      state.lastAttemptAt=now;
      state.syncPending=true;
      try{
        const result=await record(state.postId,state.mediaKind||'video',state.sessionId,state.watchedSeconds,duration);
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
    if(!force&&!media.ended&&now-state.lastSyncAt<10000)return;
    state.syncPending=true;
    try{
      const result=await record(state.postId,state.mediaKind||'video',state.sessionId,state.watchedSeconds,duration);
      if(result.ok){state.lastSyncPercent=percent;state.lastSyncAt=Date.now();}
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
  function musicAudioContext(media){
    const modal=$('#egybookVideoModal');
    const expectedKind=media?.id==='egybookVideoSourceAudio'?'source-audio':'audio';
    if(!modal?.classList.contains('open')||String(modal.dataset.mediaKind||'').toLowerCase()!==expectedKind)return null;
    const id=String(modal.dataset.postId||'');
    if(!validId(id))return null;
    const post=document.querySelector(`.post[data-post-id="${id}"]`);
    if(!isMusicImage(post))return null;
    return {id,modal,post};
  }
  function beginMusicAudioSession(audio){
    const context=musicAudioContext(audio);if(!context)return null;
    let state=mediaSessions.get(audio);
    if(state&&state.postId===context.id)return state;
    const start=Number(audio.dataset.clipStart)||0;
    const end=Number(audio.dataset.clipEnd)||0;
    const duration=end>start?end-start:(Number(audio.duration)||0);
    const sessionId=musicViewSessions.get(context.id)||uuid();
    musicViewSessions.set(context.id,sessionId);
    state={postId:context.id,sessionId,mediaKind:'image',watchedSeconds:0,lastTime:Number(audio.currentTime)||start,lastAt:performance.now(),duration,counted:false,extended:false,lastSyncPercent:0,lastSyncAt:0,completed:false};
    mediaSessions.set(audio,state);return state;
  }
  function accumulateMusicAudio(audio,{forceSync=false,allowPaused=false}={}){
    const context=musicAudioContext(audio);if(!context)return;
    let state=mediaSessions.get(audio)||beginMusicAudioSession(audio);if(!state||(!allowPaused&&audio.paused))return;
    const now=performance.now(),current=Number(audio.currentTime)||0;
    const wall=Math.max(.01,(now-state.lastAt)/1000),delta=current-state.lastTime;
    if(delta>0&&delta<=Math.min(6,Math.max(1.2,wall*1.8)))state.watchedSeconds+=Math.min(delta,wall*1.8);
    state.lastTime=current;state.lastAt=now;
    const start=Number(audio.dataset.clipStart)||0,end=Number(audio.dataset.clipEnd)||0;
    if(end>start)state.duration=end-start;else if(Number(audio.duration)>0)state.duration=Number(audio.duration);
    void sendSession(audio,state,{force:forceSync});
  }
  function isMusicSourceMedia(media){return !!media&&media.tagName==='VIDEO'&&media.id==='egybookVideoSourceAudio';}
  function isMusicTrackAudio(media){return !!media&&media.tagName==='AUDIO'&&media.id==='egybookVideoAudio';}
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
    document.querySelectorAll('#postsList .post,#profilePostsList .post').forEach(post=>{ensurePost(post);if(isCountablePost(post)){const id=postId(post);if(validId(id))ids.add(id);}});
    ensureMoments();ensurePlayer();
    document.querySelectorAll('#postsList video.egybook-feed-video,#profilePostsList video.egybook-feed-video,#egybookVideoPlayer').forEach(observeMedia);
    document.querySelectorAll('#momentsStrip [data-moment-post]').forEach(tile=>{const id=postId(tile);if(validId(id))ids.add(id);});
    const modal=$('#egybookVideoModal');if(modal&&['video','reel'].includes(String(modal.dataset.mediaKind||'').toLowerCase())&&validId(modal.dataset.postId))ids.add(String(modal.dataset.postId));
    queueCounts([...ids]);
  }
  function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,240);}
  function processAddedNode(node,ids){
    if(!node||node.nodeType!==1)return;
    const isFeedPost=post=>post&&(
      post.closest('#postsList')||post.closest('#profilePostsList')
    );
    const ancestor=node.matches?.('.post')?node:node.closest?.('.post');
    if(ancestor&&isFeedPost(ancestor)){ensurePost(ancestor);if(isCountablePost(ancestor))addPostId(ancestor,ids);}
    node.querySelectorAll?.('.post').forEach(post=>{if(isFeedPost(post)){ensurePost(post);if(isCountablePost(post))addPostId(post,ids);}});
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
      if(parentPost&&(parentPost.closest('#postsList')||parentPost.closest('#profilePostsList'))){ensurePost(parentPost);if(isCountablePost(parentPost))addPostId(parentPost,ids);}
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
  const isTrackedMusicMedia=media=>isMusicTrackAudio(media)||isMusicSourceMedia(media);
  document.addEventListener('play',event=>{
    const media=event.target;if(isTrackedMusicMedia(media))beginMusicAudioSession(media);
  },true);
  document.addEventListener('timeupdate',event=>{
    const media=event.target;if(isTrackedMusicMedia(media))accumulateMusicAudio(media);
  },true);
  document.addEventListener('pause',event=>{
    const media=event.target;if(isTrackedMusicMedia(media))accumulateMusicAudio(media,{forceSync:true,allowPaused:true});
  },true);
  document.addEventListener('ended',event=>{
    const media=event.target;if(!isTrackedMusicMedia(media))return;
    accumulateMusicAudio(media,{forceSync:true,allowPaused:true});const state=mediaSessions.get(media);if(state)state.completed=true;
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
    ['egybookVideoAudio','egybookVideoSourceAudio'].forEach(id=>{const media=$('#'+id),state=media&&mediaSessions.get(media);if(state){accumulateMusicAudio(media,{forceSync:true,allowPaused:true});mediaSessions.delete(media);musicViewSessions.delete(state.postId);}});
    const player=$('#egybookVideoPlayer');
    if(player){const state=mediaSessions.get(player);if(state)accumulate(player,{allowPaused:true,forceSync:true});mediaSessions.delete?.(player);}
    requestAnimationFrame(()=>{
      ensurePlayer();
      const id=String(event.detail?.post?.dataset?.postId||'');
      if(validId(id)){ensurePost(event.detail.post);queueCounts([id]);}
    });
  });
  document.addEventListener('egybook:evp-post-close',event=>{
    const id=String(event.detail?.postId||'');
    ['egybookVideoAudio','egybookVideoSourceAudio'].forEach(mediaId=>{
      const media=$('#'+mediaId),state=media&&mediaSessions.get(media);
      if(state&&(!id||state.postId===id)){
        accumulateMusicAudio(media,{forceSync:true,allowPaused:true});
        mediaSessions.delete(media);
      }
    });
    if(id)musicViewSessions.delete(id);else musicViewSessions.clear();
    activeReelPostId='';
  });
  document.addEventListener('egybook:media-view-open',event=>{
    const detail=event.detail||{};
    if(!detail.postId||detail.kind!=='image'||!isMusicImage(detail.root?.matches?.('.post')?detail.root:detail.root?.closest?.('.post')))return;
    const sequence=++imageSequence;
    imageTimers.forEach(timer=>clearTimeout(timer));imageTimers.clear();
    const id=String(detail.postId);
    if(!musicViewSessions.has(id))musicViewSessions.set(id,uuid());
    const timer=setTimeout(()=>{
      imageTimers.delete(timer);
      if(sequence!==imageSequence||document.hidden||!detail.root?.isConnected)return;
      const modal=$('#egybookVideoModal');
      const kind=String(modal?.dataset.mediaKind||'').toLowerCase();
      const mediaOpen=!!(modal?.classList.contains('open')&&modal.dataset.postId===id&&['audio','source-audio'].includes(kind));
      if(mediaOpen){
        const media=kind==='source-audio'?$('#egybookVideoSourceAudio'):$('#egybookVideoAudio');
        const start=Number(media?.dataset.clipStart)||0,end=Number(media?.dataset.clipEnd)||0;
        void record(id,'image',musicViewSessions.get(id),0,end>start?end-start:null);
      }
    },1800);
    imageTimers.add(timer);
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      // No polling or timers continue while the page is backgrounded.
      imageTimers.forEach(timer=>clearTimeout(timer));imageTimers.clear();imageSequence++;musicViewSessions.clear();
    }
  });
  document.addEventListener('egybook:evp-player-ready',ensurePlayer);

  document.addEventListener('egybook:post-viewer-mounted',event=>{
    const post=event.detail?.post;
    requestAnimationFrame(()=>{
      // A post route uses cloneNode(true); MutationObservers are not cloned.
      // Rebind the badge integrity observer to the mounted clone immediately,
      // before its comments sheet can trigger another render.
      if(post?.isConnected&&post.matches?.('.post')){
        ensurePost(post);
        const id=postId(post);
        if(validId(id))queueCounts([id],{priority:true});
      }
    });
  });
  document.addEventListener('egybook:comments-panel-opened',event=>{
    const post=event.detail?.post;
    requestAnimationFrame(()=>{
      if(post?.isConnected){
        // Recreate only the dedicated media counter after the comments sheet
        // opens. This breaks any legacy DOM-node reuse that could inject the
        // Like action label into the eye badge; the real Like button is untouched.
        const media=post.querySelector('.post-image,video.egybook-feed-video');
        const wrap=media?.parentElement;
        const oldBadge=wrap?.querySelector(':scope > .eb-media-views');
        if(oldBadge){badgeObservers.get(oldBadge)?.disconnect();oldBadge.remove();}
        ensurePost(post);
      }
      ensurePlayer();
    });
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
    userPromise=null;retryAfter.clear();pendingIds.clear();loadedIds.clear();countCache.clear();scheduleRefresh();
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});
  else refresh();
  window.EgyBookViews=Object.freeze({version:42,refresh,record,format:fmt});
})();

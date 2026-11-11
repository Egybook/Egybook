/* EgyBook video viewer: independent author/description and last-comment footer. */
(() => {
  'use strict';
  const box = document.getElementById('egybookVideoBox');
  if (!box) return;

  let footer = document.getElementById('evpPostDetails');
  if (!footer) {
    footer = document.createElement('section');
    footer.id = 'evpPostDetails';
    footer.className = 'evp-post-details';
    footer.dir = 'auto';
    footer.innerHTML = `
      <div class="evp-post-copy" id="evpPostCopy" hidden>
        <div class="evp-post-author-line"><strong id="evpPostAuthor"></strong><span id="evpPostAge"></span></div>
        <p id="evpPostDescription"></p><button type="button" id="evpPostMore" hidden>المزيد</button>
      </div>
      <button type="button" class="evp-last-comment" id="evpLastComment" hidden aria-label="فتح آخر تعليق">
        <span class="evp-last-comment-avatar" id="evpLastCommentAvatar"></span>
        <span class="evp-last-comment-copy"><strong id="evpLastCommentName"></strong><span id="evpLastCommentText"></span></span>
      </button>
      <button type="button" class="evp-all-comments" id="evpAllComments">عرض كل التعليقات</button>`;
    box.append(footer);
  }

  const $ = id => document.getElementById(id);
  let activePostId = '';
  const setPost = post => {
    activePostId = String(post?.dataset?.postId || '');
    const copy = $('evpPostCopy');
    if (!post) { copy.hidden = true; $('evpLastComment').hidden = true; $('evpAllComments').hidden = true; return; }
    const author = post.querySelector('.post-author .author-name')?.textContent?.trim() || 'عضو EgyBook';
    const text = post.querySelector('.post-text')?.textContent?.trim() || '';
    $('evpPostAuthor').textContent = author;
    $('evpPostDescription').textContent = text;
    copy.hidden = !text && !author;
    const more = $('evpPostMore');
    more.hidden = text.length <= 115;
    $('evpPostDescription').classList.remove('is-expanded');
    more.textContent = 'المزيد'; more.setAttribute('aria-expanded','false');
    $('evpLastComment').hidden = true;
    $('evpAllComments').hidden = false;
  };

  window.addEventListener('egybook:evp-post-context', event => setPost(event.detail?.post || null));
  window.addEventListener('egybook:evp-last-comment', event => {
    const {postId, comment} = event.detail || {};
    if (String(postId || '') !== activePostId) return;
    const button = $('evpLastComment');
    if (!comment?.text) { button.hidden = true; return; }
    $('evpLastCommentName').textContent = comment.name || 'عضو EgyBook';
    $('evpLastCommentText').textContent = comment.text;
    const avatar = $('evpLastCommentAvatar');
    avatar.style.backgroundImage = comment.avatar ? `url("${String(comment.avatar).replace(/"/g,'%22')}")` : '';
    avatar.textContent = comment.avatar ? '' : (comment.name || 'ع').trim().slice(0,1);
    button.hidden = false;
  });

  $('evpPostMore').addEventListener('click', () => {
    const text = $('evpPostDescription'), expanded = text.classList.toggle('is-expanded');
    $('evpPostMore').textContent = expanded ? 'عرض أقل' : 'المزيد';
    $('evpPostMore').setAttribute('aria-expanded', String(expanded));
  });
  const openComments = () => document.querySelector('#evpPostRail [data-evp="post-comment"]')?.click();
  $('evpLastComment').addEventListener('click', openComments);
  $('evpAllComments').addEventListener('click', openComments);
})();

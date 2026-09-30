/* HN Firehose — a live Hacker News reader inspired by hnrss.
   Data: Algolia HN Search API (same source hnrss is built on). */

const API = "https://hn.algolia.com/api/v1";
const REFRESH_MS = 60_000;

const FEEDS = {
  frontpage: {
    title: "Front Page",
    desc: "Posts currently on the Hacker News front page.",
    endpoint: "search",
    tags: "front_page",
    hnrss: "frontpage",
    live: true,
  },
  newest: {
    title: "Newest",
    desc: "The firehose: every new post, as it is submitted.",
    endpoint: "search_by_date",
    tags: "story",
    hnrss: "newest",
    live: true,
  },
  newcomments: {
    title: "New Comments",
    desc: "The comment firehose: every new comment, site-wide.",
    endpoint: "search_by_date",
    tags: "comment",
    hnrss: "newcomments",
    live: true,
    isComments: true,
  },
  ask: {
    title: "Ask HN",
    desc: "Latest Ask HN self-posts.",
    endpoint: "search_by_date",
    tags: "ask_hn",
    hnrss: "ask",
    live: true,
  },
  show: {
    title: "Show HN",
    desc: "Latest Show HN posts.",
    endpoint: "search_by_date",
    tags: "show_hn",
    hnrss: "show",
    live: true,
  },
  jobs: {
    title: "Jobs",
    desc: "Job postings from YC-funded startups.",
    endpoint: "search_by_date",
    tags: "job",
    hnrss: "jobs",
    live: true,
  },
  polls: {
    title: "Polls",
    desc: "Latest polls submitted to Hacker News.",
    endpoint: "search_by_date",
    tags: "poll",
    hnrss: "polls",
    live: true,
  },
};

const state = {
  feed: "frontpage",
  q: "",
  points: 0,
  comments: 0,
  count: 30,
  page: 0,
  live: true,
  loading: false,
  hasMore: false,
  seenIds: new Set(),
  pendingItems: [],
  timer: null,
};

const $ = (id) => document.getElementById(id);
const streamEl = $("stream");
const statusEl = $("stream-status");

/* ---------------- URL builders ---------------- */

function algoliaUrl(page = 0) {
  const feed = FEEDS[state.feed];
  const p = new URLSearchParams();
  p.set("tags", feed.tags);
  p.set("hitsPerPage", String(state.count));
  p.set("page", String(page));
  if (state.q) p.set("query", state.q);

  const numeric = [];
  if (state.points > 0) numeric.push(`points>=${state.points}`);
  if (state.comments > 0 && !feed.isComments) numeric.push(`num_comments>=${state.comments}`);
  if (numeric.length) p.set("numericFilters", numeric.join(","));

  return `${API}/${feed.endpoint}?${p}`;
}

function hnrssUrl(ext = "") {
  const feed = FEEDS[state.feed];
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.points > 0) p.set("points", String(state.points));
  if (state.comments > 0) p.set("comments", String(state.comments));
  if (state.count !== 20) p.set("count", String(state.count));
  const qs = p.toString();
  return `https://hnrss.org/${feed.hnrss}${ext}${qs ? "?" + qs : ""}`;
}

/* ---------------- Rendering ---------------- */

function timeAgo(unixSeconds) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(unixSeconds * 1000).toLocaleDateString();
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

/* Comment bodies from Algolia are pre-sanitized HTML (p, a, pre, code, i).
   Still, strip anything unexpected before injecting. */
function sanitizeCommentHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html ?? "";
  const allowed = new Set(["P", "A", "PRE", "CODE", "I", "EM", "B", "STRONG", "BR"]);
  tpl.content.querySelectorAll("*").forEach((el) => {
    if (!allowed.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach((attr) => {
      if (el.tagName === "A" && attr.name === "href" && /^https?:/i.test(el.getAttribute("href") || "")) return;
      el.removeAttribute(attr.name);
    });
    if (el.tagName === "A") { el.target = "_blank"; el.rel = "noopener nofollow"; }
  });
  return tpl.innerHTML;
}

function renderItem(hit, fresh = false) {
  const li = document.createElement("li");
  li.className = "item" + (fresh ? " fresh" : "");
  const hnLink = `https://news.ycombinator.com/item?id=${hit.story_id || hit.objectID}`;
  const isComment = !!hit.comment_text && hit._tags?.includes("comment");

  if (isComment) {
    li.innerHTML = `
      <div class="item-score"><b>💬</b><span>reply</span></div>
      <div class="item-main">
        <h3 class="item-title">
          <a href="https://news.ycombinator.com/item?id=${hit.objectID}" target="_blank" rel="noopener">
            ${esc(hit.author)} <span class="item-domain">commented</span>
          </a>
        </h3>
        <div class="comment-body clamped" title="Click to expand">${sanitizeCommentHtml(hit.comment_text)}</div>
        <div class="comment-context">
          on <a href="${esc(hnLink)}" target="_blank" rel="noopener">${esc(hit.story_title || "a thread")}</a>
          · ${timeAgo(hit.created_at_i)}
          · <button class="thread-toggle" data-id="${esc(hit.objectID)}" data-kind="comment" aria-expanded="false">replies</button>
        </div>
        <div class="thread" hidden></div>
      </div>`;
    return li;
  }

  const url = hit.url || hnLink;
  const domain = hit.url ? domainOf(hit.url) : "";
  const tag =
    hit._tags?.includes("show_hn") ? "Show HN" :
    hit._tags?.includes("ask_hn") ? "Ask HN" :
    hit._tags?.includes("job") ? "Job" :
    hit._tags?.includes("poll") ? "Poll" : "";

  li.innerHTML = `
    <div class="item-score"><b>${hit.points ?? "–"}</b><span>pts</span></div>
    <div class="item-main">
      <h3 class="item-title">
        <a href="${esc(url)}" target="_blank" rel="noopener">${esc(hit.title || "(untitled)")}</a>
        ${domain ? `<span class="item-domain">${esc(domain)}</span>` : ""}
      </h3>
      <div class="item-meta">
        ${tag ? `<span class="badge">${tag}</span>` : ""}
        <span>by <a class="author" href="https://news.ycombinator.com/user?id=${esc(hit.author)}" target="_blank" rel="noopener">${esc(hit.author)}</a></span>
        <span>${timeAgo(hit.created_at_i)}</span>
        <button class="thread-toggle" data-id="${esc(hit.story_id || hit.objectID)}" data-kind="story" aria-expanded="false">${hit.num_comments ?? 0} comments</button>
        <a class="hn-link" href="${esc(hnLink)}" target="_blank" rel="noopener" title="Open on Hacker News">HN ↗</a>
      </div>
      <div class="thread" hidden></div>
    </div>`;
  return li;
}

/* ---------------- Comment threads ----------------
   Clicking "N comments" on a story (or "replies" on a comment) loads the
   full item from Algolia's /items endpoint and renders the nested thread
   inline, HN-style: collapsible sub-threads, permalinks, deleted-comment
   placeholders. Threads are cached per item for the life of the page. */

const THREAD_CACHE_MS = 60_000;
const threadCache = new Map(); // id -> { item, at }

async function fetchItem(id, { force = false } = {}) {
  const cached = threadCache.get(id);
  if (cached && !force && Date.now() - cached.at < THREAD_CACHE_MS) return cached.item;
  const res = await fetch(`${API}/items/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const item = await res.json();
  threadCache.set(id, { item, at: Date.now() });
  return item;
}

function isDeleted(node) {
  return !node.author && !node.text;
}

/* Number of live (non-deleted) comments in a subtree, excluding the root. */
function countReplies(node) {
  let n = 0;
  for (const c of node.children ?? []) n += (isDeleted(c) ? 0 : 1) + countReplies(c);
  return n;
}

function renderComment(node, depth) {
  const replies = countReplies(node);
  const deleted = isDeleted(node);
  if (deleted && replies === 0) return "";

  const kids = (node.children ?? [])
    .slice()
    .sort((a, b) => (a.created_at_i ?? 0) - (b.created_at_i ?? 0))
    .map((c) => renderComment(c, depth + 1))
    .join("");

  const permalink = `https://news.ycombinator.com/item?id=${node.id}`;
  const head = deleted
    ? `<span class="c-deleted">[deleted]</span>`
    : `<a class="author" href="https://news.ycombinator.com/user?id=${esc(node.author)}" target="_blank" rel="noopener">${esc(node.author)}</a>
       <a class="c-time" href="${esc(permalink)}" target="_blank" rel="noopener" title="Permalink on Hacker News">${timeAgo(node.created_at_i)}</a>`;

  return `
    <li class="c" id="c-${esc(String(node.id))}" data-replies="${replies}" style="--depth:${depth}">
      <div class="c-head">
        <button class="c-toggle" aria-expanded="true" title="Collapse thread"><span class="c-toggle-open">[–]</span><span class="c-toggle-closed">[+] ${replies + 1}</span></button>
        ${head}
      </div>
      ${deleted ? "" : `<div class="c-body">${sanitizeCommentHtml(node.text)}</div>`}
      ${kids ? `<ol class="c-children">${kids}</ol>` : ""}
    </li>`;
}

function renderThread(container, item, kind) {
  const total = countReplies(item);
  const noun = kind === "comment" ? "repl" : "comment";
  const label = total === 1 ? `1 ${noun}y` : `${total} ${noun}${noun === "repl" ? "ies" : "s"}`;
  const hnLink = `https://news.ycombinator.com/item?id=${item.id}`;
  const list = (item.children ?? [])
    .slice()
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.created_at_i ?? 0) - (b.created_at_i ?? 0))
    .map((c) => renderComment(c, 0))
    .join("");

  container.innerHTML = `
    <div class="thread-head">
      <span class="thread-count">${label}</span>
      <button class="thread-refresh" type="button">refresh</button>
      <a href="${esc(hnLink)}" target="_blank" rel="noopener">open on HN ↗</a>
      <button class="thread-close" type="button">close</button>
    </div>
    ${kind === "story" && item.text ? `<div class="thread-story-text">${sanitizeCommentHtml(item.text)}</div>` : ""}
    ${list ? `<ol class="comments">${list}</ol>` : `<p class="thread-empty">No ${noun === "repl" ? "replies" : "comments"} yet.</p>`}`;
}

async function loadThread(container, id, kind, { force = false } = {}) {
  container.hidden = false;
  container.dataset.id = id;
  if (!container.dataset.loaded || force) {
    container.innerHTML = `<div class="thread-status"><span class="spinner" aria-hidden="true"></span> Loading thread…</div>`;
  }
  try {
    const item = await fetchItem(id, { force });
    // Guard against a stale response after the thread was closed/reopened for another id.
    if (container.dataset.id !== String(id)) return;
    renderThread(container, item, kind);
    container.dataset.loaded = "1";
  } catch (err) {
    container.innerHTML = `<div class="thread-status error">Could not load the thread (${esc(err.message)}). <button class="thread-refresh" type="button">Retry</button></div>`;
  }
}

function setThreadOpen(li, open) {
  const container = li.querySelector(":scope > .item-main > .thread");
  const toggle = li.querySelector(":scope > .item-main .thread-toggle");
  if (!container || !toggle) return;
  toggle.setAttribute("aria-expanded", String(open));
  li.classList.toggle("thread-open", open);
  if (open) {
    loadThread(container, toggle.dataset.id, toggle.dataset.kind);
  } else {
    container.hidden = true;
  }
}

streamEl.addEventListener("click", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;

  const toggle = e.target.closest(".thread-toggle");
  if (toggle) {
    setThreadOpen(li, toggle.getAttribute("aria-expanded") !== "true");
    return;
  }

  if (e.target.closest(".thread-close")) { setThreadOpen(li, false); return; }

  const refresh = e.target.closest(".thread-refresh");
  if (refresh) {
    const container = refresh.closest(".thread");
    const t = li.querySelector(":scope > .item-main .thread-toggle");
    loadThread(container, t.dataset.id, t.dataset.kind, { force: true });
    return;
  }

  const collapse = e.target.closest(".c-toggle");
  if (collapse) {
    const c = collapse.closest(".c");
    const collapsed = c.classList.toggle("collapsed");
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.title = collapsed ? "Expand thread" : "Collapse thread";
    return;
  }

  // Firehose comment previews are clamped to a few lines; click to read the whole thing.
  const preview = e.target.closest(".comment-body.clamped, .comment-body.expanded");
  if (preview && !e.target.closest("a")) {
    preview.classList.toggle("clamped");
    preview.classList.toggle("expanded");
  }
});

/* ---------------- Data flow ---------------- */

async function fetchFeed(page = 0) {
  const res = await fetch(algoliaUrl(page));
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function loadFeed({ reset = true } = {}) {
  if (state.loading) return;
  state.loading = true;
  const feed = FEEDS[state.feed];
  if (reset) {
    state.page = 0;
    state.hasMore = false;
    state.seenIds.clear();
    state.pendingItems = [];
    hideNewItemsBar();
    streamEl.replaceChildren();
    statusEl.hidden = false;
    statusEl.classList.remove("error");
    statusEl.textContent = "Loading…";
    $("scroll-sentinel").hidden = true;
  }

  try {
    const data = await fetchFeed(state.page);
    statusEl.hidden = true;
    const hits = data.hits.filter((h) => !state.seenIds.has(h.objectID));
    hits.forEach((h) => {
      state.seenIds.add(h.objectID);
      streamEl.appendChild(renderItem(h));
    });
    if (reset && hits.length === 0) {
      statusEl.hidden = false;
      statusEl.textContent = "No items match these filters.";
    }
    state.hasMore = state.page + 1 < (data.nbPages ?? 1);
    $("scroll-sentinel").hidden = !state.hasMore;
    updateStats();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.classList.add("error");
    statusEl.textContent = `Could not load the ${feed.title} feed (${err.message}). Retrying on next refresh.`;
  } finally {
    state.loading = false;
    // If the sentinel is still on screen (short page / tall viewport), keep filling.
    checkSentinel();
  }
}

function loadNextPage() {
  if (state.loading || !state.hasMore) return;
  state.page += 1;
  loadFeed({ reset: false });
}

async function pollForNew() {
  if (!state.live || document.hidden) return;
  try {
    const data = await fetchFeed(0);
    const fresh = data.hits.filter((h) => !state.seenIds.has(h.objectID));
    if (!fresh.length) { updateStats(); return; }

    if (window.scrollY < 80) {
      prependItems(fresh);
    } else {
      // Don't yank the page out from under the reader; queue them.
      fresh.forEach((h) => state.seenIds.add(h.objectID));
      state.pendingItems = fresh.concat(state.pendingItems);
      showNewItemsBar(state.pendingItems.length);
    }
    updateStats();
  } catch {
    /* transient network error — next poll will retry */
  }
}

function prependItems(hits) {
  [...hits].reverse().forEach((h) => {
    state.seenIds.add(h.objectID);
    streamEl.prepend(renderItem(h, true));
  });
  // Keep the DOM bounded during long live sessions.
  while (streamEl.children.length > 300) streamEl.lastElementChild.remove();
}

function showNewItemsBar(n) {
  $("new-items-count").textContent = n;
  $("new-items-bar").hidden = false;
}

function hideNewItemsBar() {
  $("new-items-bar").hidden = true;
  state.pendingItems = [];
}

function updateStats() {
  $("stat-items").textContent = streamEl.children.length;
  $("stat-updated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("stat-refresh").textContent = state.live ? `${REFRESH_MS / 1000}s` : "paused";
}

/* ---------------- UI wiring ---------------- */

function switchFeed(name) {
  state.feed = name;
  document.querySelectorAll(".feed-tab").forEach((b) => b.classList.toggle("active", b.dataset.feed === name));
  const feed = FEEDS[name];
  $("stream-title").textContent = feed.title;
  $("stream-desc").textContent = feed.desc;
  updateRssPanel();
  loadFeed();
}

function updateRssPanel() {
  $("rss-url").textContent = hnrssUrl();
  $("open-jsonfeed").href = hnrssUrl(".jsonfeed");
}

function readFilters() {
  state.q = $("filter-q").value.trim();
  state.points = Math.max(0, parseInt($("filter-points").value, 10) || 0);
  state.comments = Math.max(0, parseInt($("filter-comments").value, 10) || 0);
  state.count = parseInt($("filter-count").value, 10) || 30;
}

function startPolling() {
  clearInterval(state.timer);
  state.timer = setInterval(pollForNew, REFRESH_MS);
}

$("feed-nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".feed-tab");
  if (btn) switchFeed(btn.dataset.feed);
});

$("apply-filters").addEventListener("click", () => {
  readFilters();
  updateRssPanel();
  loadFeed();
});

$("filter-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("apply-filters").click();
});

$("clear-filters").addEventListener("click", () => {
  $("filter-q").value = "";
  $("filter-points").value = "";
  $("filter-comments").value = "";
  $("filter-count").value = "30";
  $("apply-filters").click();
});

/* Infinite scroll: IntersectionObserver where available, plus a plain
   scroll-position check as a fallback for environments that throttle IO. */
function nearSentinel() {
  const sentinel = $("scroll-sentinel");
  if (sentinel.hidden) return false;
  return sentinel.getBoundingClientRect().top < window.innerHeight + 600;
}

function checkSentinel() {
  if (state.hasMore && !state.loading && nearSentinel()) loadNextPage();
}

if ("IntersectionObserver" in window) {
  new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) checkSentinel(); },
    { rootMargin: "600px 0px" } // start fetching well before the bottom
  ).observe($("scroll-sentinel"));
}
window.addEventListener("scroll", checkSentinel, { passive: true });
window.addEventListener("resize", checkSentinel, { passive: true });

$("new-items-btn").addEventListener("click", () => {
  const items = state.pendingItems;
  state.pendingItems = [];
  $("new-items-bar").hidden = true;
  [...items].reverse().forEach((h) => streamEl.prepend(renderItem(h, true)));
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateStats();
});

$("live-toggle").addEventListener("click", () => {
  state.live = !state.live;
  const btn = $("live-toggle");
  btn.classList.toggle("live", state.live);
  btn.setAttribute("aria-pressed", String(state.live));
  $("live-label").textContent = state.live ? "LIVE" : "PAUSED";
  if (state.live) pollForNew();
  updateStats();
});

$("copy-rss").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(hnrssUrl());
    $("copy-rss").textContent = "Copied!";
    setTimeout(() => ($("copy-rss").textContent = "Copy URL"), 1400);
  } catch { /* clipboard unavailable */ }
});

$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("hnf-theme", next);
});

$("brand").addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.live) pollForNew();
});

/* ---------------- Boot ---------------- */

const savedTheme = localStorage.getItem("hnf-theme");
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.dataset.theme = "dark";
}

updateRssPanel();
loadFeed();
startPolling();

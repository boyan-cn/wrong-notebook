(() => {
  "use strict";

  const appEl = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  const TOKEN_KEY = "nb_token";
  const DEFAULT_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "科学", "其他"];
  const DEFAULT_GRADES = [
    "小学一年级", "小学二年级", "小学三年级", "小学四年级", "小学五年级", "小学六年级",
    "初中一年级", "初中二年级", "初中三年级",
    "高中一年级", "高中二年级", "高中三年级",
  ];
  const SUBJECT_COLORS = {
    语文: ["#e8f1fb", "#2f6fae"],
    数学: ["#fbeceb", "#b94433"],
    英语: ["#e9f6ef", "#2f855a"],
    物理: ["#ecebfa", "#4b57c9"],
    化学: ["#fdf0e4", "#b06a17"],
    生物: ["#eaf6ea", "#3c7a3a"],
    政治: ["#f6ebf6", "#994d92"],
    历史: ["#f5efe3", "#8a6a2f"],
    地理: ["#e8f4f6", "#2b7a85"],
    科学: ["#eef1f8", "#4a5c85"],
    其他: ["#f1f0ec", "#6c6a63"],
  };
  const LEVEL_LABELS = { easy: "简单", medium: "适中", hard: "困难" };
  const LEVEL_ORDER = ["easy", "medium", "hard"];

  const ICONS = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path></svg>',
    camera: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>',
    cameraSm: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>',
    book: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"></path><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"></path><path d="M8 7h8M8 11h5"></path></svg>',
  };

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    subjects: DEFAULT_SUBJECTS.slice(),
    grades: DEFAULT_GRADES.slice(),
    authTab: "login",
    filters: { subject: "", status: "", q: "", page: 1 },
    list: null,
    loadingList: false,
    searchTimer: null,
    detail: null,
    add: null,
    qa: { messages: [], imagePath: "", imagePreview: "", uploading: false, busy: false, adding: false, error: "" },
    providers: null,
    modalKind: null,
  };

  let listSeq = 0;

  // -------------------------------------------------------------- 基础工具

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
  const nl2br = (value) => esc(value).replace(/\r?\n/g, "<br>");
  const pad = (value) => String(value).padStart(2, "0");

  function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fmtDay(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  }

  function subjectPill(name) {
    const pair = SUBJECT_COLORS[name] || SUBJECT_COLORS["其他"];
    return `<span class="subject-pill" style="background:${pair[0]};color:${pair[1]}">${esc(name)}</span>`;
  }

  function subjectOptions(selected) {
    return state.subjects
      .map((name) => `<option value="${esc(name)}"${name === selected ? " selected" : ""}>${esc(name)}</option>`)
      .join("");
  }

  function gradeOptions(selected) {
    return state.grades
      .map((name) => `<option value="${esc(name)}"${name === selected ? " selected" : ""}>${esc(name)}</option>`)
      .join("");
  }

  function applyMeta(data) {
    state.subjects = Array.isArray(data.subjects) && data.subjects.length ? data.subjects : DEFAULT_SUBJECTS.slice();
    state.grades = Array.isArray(data.grades) && data.grades.length ? data.grades : DEFAULT_GRADES.slice();
  }

  async function loadMeta() {
    try {
      applyMeta(await api("/api/subjects"));
    } catch (error) {
      state.subjects = DEFAULT_SUBJECTS.slice();
      state.grades = DEFAULT_GRADES.slice();
    }
  }

  function knowledgeChips(text, limit = 3) {
    const parts = String(text || "")
      .split(/[、,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return parts
      .slice(0, limit)
      .map((item, index) => `<span class="kp-chip${index > 0 ? " alt" : ""}">${esc(item)}</span>`)
      .join("");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取图片文件"));
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file, crop = null) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const sx = crop ? Math.round(image.width * crop.x) : 0;
          const sy = crop ? Math.round(image.height * crop.y) : 0;
          const sw = crop ? Math.max(1, Math.round(image.width * crop.w)) : image.width;
          const sh = crop ? Math.max(1, Math.round(image.height * crop.h)) : image.height;
          const maxSide = 1600;
          const scale = Math.min(1, maxSide / Math.max(sw, sh));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(file);
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.84);
        };
        image.onerror = () => resolve(file);
        image.src = String(reader.result);
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  // -------------------------------------------------------------- 请求与提示

  async function api(path, options = {}) {
    const opts = { ...options };
    const headers = new Headers(opts.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (opts.body && !(opts.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      opts.body = JSON.stringify(opts.body);
    }
    let response;
    try {
      response = await fetch(path, { ...opts, headers });
    } catch (error) {
      throw new Error("网络连接失败，请检查服务是否正常运行");
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = null;
      }
    }
    if (!response.ok) {
      if (response.status === 401 && state.user) {
        expireSession();
      }
      let message = data && data.detail;
      if (Array.isArray(message)) {
        message = message.map((item) => item.msg || "请求参数不正确").join("；");
      }
      throw new Error(message || `请求失败（${response.status}）`);
    }
    return data;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === "success" ? "✓" : type === "error" ? "!" : "i";
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
    toastRoot.appendChild(toast);
    const timeout = type === "error" ? 5000 : 2800;
    setTimeout(() => {
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 260);
    }, timeout);
  }

  function expireSession() {
    state.token = "";
    state.user = null;
    state.list = null;
    localStorage.removeItem(TOKEN_KEY);
    closeModal();
    renderAuth();
    showToast("登录已过期，请重新登录", "error");
  }

  // -------------------------------------------------------------- 弹窗

  function modalFrame({ title, subtitle = "", body, footer = "", size = "md" }) {
    return `
      <div class="modal-overlay">
        <div class="modal modal-${size}" role="dialog" aria-modal="true">
          <div class="modal-head">
            <div>
              <h2 class="modal-title">${title}</h2>
              ${subtitle ? `<p class="modal-sub">${subtitle}</p>` : ""}
            </div>
            <button type="button" class="icon-btn" data-action="close-modal" aria-label="关闭">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
        </div>
      </div>`;
  }

  function setModal(html, kind) {
    state.modalKind = kind;
    modalRoot.innerHTML = html;
    document.body.classList.add("modal-open");
    const overlay = modalRoot.querySelector(".modal-overlay");
    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeModal();
      });
    }
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    state.modalKind = null;
    state.detail = null;
    state.add = null;
    document.body.classList.remove("modal-open");
  }

  // -------------------------------------------------------------- 启动与认证

  async function boot() {
    if (!state.token) {
      renderAuth();
      return;
    }
    try {
      const me = await api("/api/auth/me");
      state.user = me.user;
      await loadMeta();
      if (!location.hash) {
        history.replaceState(null, "", `${location.pathname}${location.search}#/list`);
      }
      if (location.hash.startsWith("#/settings") && state.user.role !== "admin") {
        history.replaceState(null, "", `${location.pathname}${location.search}#/list`);
      }
      renderShell();
      route();
    } catch (error) {
      state.token = "";
      state.user = null;
      localStorage.removeItem(TOKEN_KEY);
      renderAuth();
    }
  }

  function renderAuth() {
    const isLogin = state.authTab !== "register";
    appEl.innerHTML = `
      <div class="auth-page">
        <section class="auth-hero">
          <span class="hero-badge">错题本 · AI 学习助手</span>
          <h1>每一道错题，<br>都值得被认真对待。</h1>
          <p>拍下错题，AI 帮你识别题目、分析错因、梳理知识点；还能举一反三，按难度生成同类练习，直到真正掌握。</p>
          <ul class="hero-points">
            <li class="hero-point"><span class="dot">01</span>拍照上传，自动识别题目与作答</li>
            <li class="hero-point"><span class="dot">02</span>AI 分析错因，给出分步解题思路</li>
            <li class="hero-point"><span class="dot">03</span>按简单 / 适中 / 困难生成巩固练习</li>
          </ul>
        </section>
        <section class="auth-panel">
          <div class="auth-card">
            <div class="auth-brand">
              <span class="brand-mark">错</span>
              <div><strong>错题本</strong><small>WRONG NOTEBOOK</small></div>
            </div>
            <div class="auth-tabs">
              <button type="button" class="auth-tab${isLogin ? " active" : ""}" data-auth-tab="login">登录</button>
              <button type="button" class="auth-tab${isLogin ? "" : " active"}" data-auth-tab="register">注册</button>
            </div>
            <div class="auth-error" id="auth-error" hidden></div>
            <form class="auth-form" id="auth-form" autocomplete="on">
              ${
                isLogin
                  ? `<div class="field"><label>用户名或手机号</label><input class="input" name="account" autocomplete="username" required placeholder="请输入用户名或手机号"></div>
                     <div class="field"><label>密码</label><input class="input" name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></div>`
                  : `<div class="field"><label>用户名</label><input class="input" name="username" required maxlength="20" placeholder="2-20 位中文、字母、数字或下划线"></div>
                     <div class="field"><label>手机号</label><input class="input" name="phone" required inputmode="numeric" maxlength="11" placeholder="用于登录的 11 位手机号"></div>
                     <div class="field"><label>孩子年级 <span class="req">*</span></label>
                       <select class="select" name="grade" required>
                         <option value="">请选择年级</option>
                         ${gradeOptions("")}
                       </select>
                     </div>
                     <div class="field"><label>密码</label><input class="input" name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="至少 6 位"></div>
                     <div class="field"><label>确认密码</label><input class="input" name="confirm" type="password" autocomplete="new-password" required minlength="6" placeholder="再次输入密码"></div>`
              }
              <button type="submit" class="btn btn-primary btn-block" id="auth-submit">${isLogin ? "登录" : "注册并进入"}</button>
            </form>
            <p class="auth-foot">${isLogin ? "还没有账号？点击上方「注册」" : "注册后即可开始整理错题"}</p>
          </div>
          <p class="auth-note">管理员账号由部署环境初始化，登录后可配置 AI 服务商。</p>
        </section>
      </div>`;
    bindAuthEvents(isLogin);
  }

  function bindAuthEvents(isLogin) {
    appEl.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.authTab = button.dataset.authTab;
        renderAuth();
      });
    });

    const form = document.getElementById("auth-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = document.getElementById("auth-submit");
      const named = (name) => form.elements.namedItem(name);
      const password = named("password").value;
      let payload;

      if (isLogin) {
        const account = named("account").value.trim();
        if (!account) {
          showAuthError("请输入用户名或手机号");
          return;
        }
        payload = { account, password };
      } else {
        const username = named("username").value.trim();
        const phone = named("phone").value.trim();
        const grade = named("grade").value;
        const confirm = named("confirm").value;
        if (username.length < 2) {
          showAuthError("用户名至少需要 2 个字符");
          return;
        }
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          showAuthError("请输入正确的 11 位手机号");
          return;
        }
        if (!grade) {
          showAuthError("请选择孩子所在年级");
          return;
        }
        if (password.length < 6) {
          showAuthError("密码至少需要 6 位");
          return;
        }
        if (password !== confirm) {
          showAuthError("两次输入的密码不一致");
          return;
        }
        payload = { username, phone, password, grade };
      }

      submit.disabled = true;
      submit.textContent = "请稍候…";
      try {
        const result = await api(`/api/auth/${isLogin ? "login" : "register"}`, { method: "POST", body: payload });
        state.token = result.token;
        state.user = result.user;
        localStorage.setItem(TOKEN_KEY, result.token);
        await loadMeta();
        state.authTab = "login";
        state.list = null;
        state.filters = { subject: "", status: "", q: "", page: 1 };
        const targetHash = state.user.role === "admin" && location.hash.startsWith("#/settings") ? "#/settings" : "#/list";
        history.replaceState(null, "", `${location.pathname}${location.search}${targetHash}`);
        renderShell();
        route();
      } catch (error) {
        showAuthError(error.message);
        submit.disabled = false;
        submit.textContent = isLogin ? "登录" : "注册并进入";
      }
    });
  }

  function showAuthError(message) {
    const box = document.getElementById("auth-error");
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function renderShell() {
    const user = state.user;
    appEl.innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="#/list">
            <span class="brand-mark">错</span>
            <span class="brand-text"><strong>错题本</strong><small>WRONG NOTEBOOK</small></span>
          </a>
          <nav class="nav">
            <a class="nav-link" data-nav="list" href="#/list">错题本</a>
            ${user.role === "admin" ? '<a class="nav-link" data-nav="settings" href="#/settings">AI 设置</a>' : ""}
          </nav>
          <div class="user-area">
            <span class="avatar">${esc((user.username || "?").slice(0, 1).toUpperCase())}</span>
            <span class="user-name">${esc(user.username)}${user.role === "admin" ? '<span class="role-badge">管理员</span>' : ""}</span>
            <button type="button" class="grade-badge${user.grade ? "" : " missing"}" data-action="edit-grade" title="点击修改年级">${
              user.grade ? esc(user.grade) : "设置年级"
            }</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="change-password">修改密码</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="logout">退出</button>
          </div>
        </div>
      </header>
      <main class="page" id="main"></main>`;
  }

  function signOut() {
    state.token = "";
    state.user = null;
    state.subjects = DEFAULT_SUBJECTS.slice();
    state.list = null;
    state.qa = { messages: [], imagePath: "", imagePreview: "", uploading: false, busy: false, adding: false, error: "" };
    state.providers = null;
    state.filters = { subject: "", status: "", q: "", page: 1 };
    localStorage.removeItem(TOKEN_KEY);
    closeModal();
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    renderAuth();
  }

  // -------------------------------------------------------------- 路由

  function route() {
    if (!state.user) return;
    const hash = location.hash || "#/list";
    document.querySelectorAll("[data-nav]").forEach((link) => {
      const isSettings = hash.startsWith("#/settings");
      link.classList.toggle("active", isSettings ? link.dataset.nav === "settings" : link.dataset.nav === "list");
    });
    if (hash.startsWith("#/settings")) {
      if (state.user.role !== "admin") {
        history.replaceState(null, "", `${location.pathname}${location.search}#/list`);
        route();
        return;
      }
      renderSettingsPage();
      loadProviders();
    } else {
      renderListPage();
      loadQuestions();
    }
  }

  // -------------------------------------------------------------- 错题列表

  function renderListPage() {
    const main = document.getElementById("main");
    if (!main) return;
    main.innerHTML = `
      <section class="page-head">
        <div>
          <h1 class="page-title">我的错题本</h1>
          <p class="page-sub">按科目整理错题，随时回看 AI 分析与举一反三练习。</p>
        </div>
        <button type="button" class="btn btn-primary" data-action="open-add">＋ 添加错题</button>
      </section>
      <section class="stats-row" id="stats-row"></section>
      <section class="qa-card">
        <div class="qa-head">
          <div>
            <h2 class="qa-title">问 AI 老师</h2>
            <p class="qa-sub">${
              state.user.grade
                ? `不懂的题目、概念或方法，直接提问，回答会按「${esc(state.user.grade)}」的知识范围讲解。`
                : "不懂的题目、概念或方法，直接提问。可在顶栏设置年级，回答会更贴合孩子的水平。"
            }</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="clear-qa">清空对话</button>
        </div>
        <div class="consult-log qa-log" id="qa-log"></div>
        <div class="qa-attach" id="qa-attach" hidden>
          <img id="qa-attach-img" alt="已选择的题目照片">
          <div class="qa-attach-info">
            <strong>已附带题目照片</strong>
            <small>提问时会连同照片一起发给老师</small>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-qa-remove-photo">移除</button>
        </div>
        <div class="consult-input-row">
          <textarea class="textarea" id="qa-input" rows="2" maxlength="1000" placeholder="例如：为什么除以一个分数等于乘它的倒数？"></textarea>
          <button type="button" class="btn btn-primary" id="btn-qa">发送</button>
        </div>
        <div class="qa-foot">
          <button type="button" class="btn btn-ghost btn-sm" id="btn-qa-photo">${ICONS.cameraSm} 拍照 / 上传题目</button>
          <button type="button" class="btn btn-soft btn-sm" id="btn-qa-add" hidden>＋ 把这题加入错题本</button>
        </div>
        <input type="file" id="qa-file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="consult-error" id="qa-error" hidden></div>
      </section>
      <section class="toolbar">
        <div class="search-box">
          ${ICONS.search}
          <input id="search-input" type="search" placeholder="搜索题目、知识点…" value="${esc(state.filters.q)}" maxlength="100">
        </div>
        <div class="status-tabs" id="status-tabs"></div>
      </section>
      <div class="subject-chips" id="subject-chips"></div>
      <section id="list-results"></section>`;
    renderStats();
    renderSubjectChips();
    renderStatusTabs();
    renderListResults();
    renderQaPanel();

    const qaBtn = document.getElementById("btn-qa");
    if (qaBtn) qaBtn.addEventListener("click", sendQa);
    const qaInput = document.getElementById("qa-input");
    if (qaInput) {
      qaInput.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          sendQa();
        }
      });
    }
    const qaPhotoBtn = document.getElementById("btn-qa-photo");
    const qaFile = document.getElementById("qa-file");
    if (qaPhotoBtn && qaFile) qaPhotoBtn.addEventListener("click", () => qaFile.click());
    if (qaFile) {
      qaFile.addEventListener("change", () => {
        const file = qaFile.files && qaFile.files[0];
        qaFile.value = "";
        if (file) pickQaFile(file);
      });
    }
    const qaRemovePhoto = document.getElementById("btn-qa-remove-photo");
    if (qaRemovePhoto) qaRemovePhoto.addEventListener("click", removeQaPhoto);
    const qaAddBtn = document.getElementById("btn-qa-add");
    if (qaAddBtn) qaAddBtn.addEventListener("click", qaAddToNotebook);

    const search = document.getElementById("search-input");
    if (search) {
      search.addEventListener("input", () => {
        state.filters.q = search.value;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          state.filters.page = 1;
          loadQuestions();
        }, 350);
      });
    }
  }

  function renderStats() {
    const box = document.getElementById("stats-row");
    if (!box) return;
    const stats = (state.list && state.list.stats) || { total: 0, todo: 0, mastered: 0 };
    box.innerHTML = `
      <div class="stat-card"><span class="stat-num">${stats.total ?? 0}</span><span class="stat-label">错题总数</span></div>
      <div class="stat-card accent"><span class="stat-num">${stats.todo ?? 0}</span><span class="stat-label">待复习</span></div>
      <div class="stat-card green"><span class="stat-num">${stats.mastered ?? 0}</span><span class="stat-label">已掌握</span></div>`;
  }

  function renderSubjectChips() {
    const box = document.getElementById("subject-chips");
    if (!box) return;
    const chips = [
      `<button type="button" class="chip${state.filters.subject ? "" : " active"}" data-action="filter-subject" data-value="">全部</button>`,
    ];
    state.subjects.forEach((name) => {
      chips.push(
        `<button type="button" class="chip${state.filters.subject === name ? " active" : ""}" data-action="filter-subject" data-value="${esc(name)}">${esc(name)}</button>`
      );
    });
    box.innerHTML = chips.join("");
  }

  function renderStatusTabs() {
    const box = document.getElementById("status-tabs");
    if (!box) return;
    const tabs = [
      ["", "全部"],
      ["todo", "待复习"],
      ["mastered", "已掌握"],
    ];
    box.innerHTML = tabs
      .map(
        ([value, label]) =>
          `<button type="button" class="tab-btn${state.filters.status === value ? " active" : ""}" data-action="filter-status" data-value="${value}">${label}</button>`
      )
      .join("");
  }

  function renderListResults() {
    const box = document.getElementById("list-results");
    if (!box) return;
    let html = state.loadingList ? '<div class="loading-inline"></div>' : "";

    if (!state.list) {
      box.innerHTML = `${html}<div class="spinner-wrap"><div class="spinner"></div><p>正在加载错题…</p></div>`;
      return;
    }

    const items = state.list.items || [];
    if (!items.length) {
      if (state.loadingList) {
        box.innerHTML = `${html}<div class="spinner-wrap"><div class="spinner"></div><p>正在筛选…</p></div>`;
        return;
      }
      const hasFilter = Boolean(state.filters.subject || state.filters.status || state.filters.q);
      html += `
        <div class="empty-state">
          <div class="empty-art">${ICONS.book}</div>
          <h3>${hasFilter ? "没有符合筛选条件的错题" : "错题本还是空的"}</h3>
          <p>${hasFilter ? "换个科目或关键词试试，也可以清除筛选查看全部错题。" : "把孩子的错题拍下来，交给 AI 分析，从第一道题开始积累。"}</p>
          ${
            hasFilter
              ? '<button type="button" class="btn btn-ghost" data-action="clear-filters">清除筛选</button>'
              : '<button type="button" class="btn btn-primary" data-action="open-add">＋ 添加第一道错题</button>'
          }
        </div>`;
      box.innerHTML = html;
      return;
    }

    html += `<div class="q-grid">${items.map(questionCard).join("")}</div>`;

    const totalPages = Math.max(1, Math.ceil(state.list.total / (state.list.page_size || 12)));
    if (totalPages > 1) {
      html += `
        <div class="pagination">
          <button type="button" class="page-btn" data-action="list-prev" ${state.filters.page <= 1 ? "disabled" : ""}>上一页</button>
          <span>第 ${state.filters.page} / ${totalPages} 页 · 共 ${state.list.total} 道</span>
          <button type="button" class="page-btn" data-action="list-next" ${state.filters.page >= totalPages ? "disabled" : ""}>下一页</button>
        </div>`;
    }
    box.innerHTML = html;
  }

  function questionCard(item) {
    const pair = SUBJECT_COLORS[item.subject] || SUBJECT_COLORS["其他"];
    const thumb = item.image_path
      ? `<img src="${esc(item.image_path)}" alt="${esc(item.title)}" loading="lazy">`
      : `<div class="thumb-empty">${esc(item.subject.slice(0, 1))}</div>`;
    const kp = knowledgeChips(item.knowledge_points);
    return `
      <article class="q-card" data-action="open-detail" data-id="${item.id}" role="button" tabindex="0" aria-label="查看错题：${esc(item.title)}">
        <div class="thumb">
          ${thumb}
          <span class="subject-tag" style="background:${pair[0]};color:${pair[1]}">${esc(item.subject)}</span>
          <span class="status-pill ${item.status}">${item.status === "mastered" ? "已掌握" : "待复习"}</span>
        </div>
        <div class="q-body">
          <h3 class="q-title">${esc(item.title)}</h3>
          ${kp ? `<div class="kp-row">${kp}</div>` : ""}
          <p class="excerpt">${esc(item.excerpt || "暂无题目文字")}</p>
          <div class="q-meta"><span>${fmtDay(item.created_at)}</span><span>#${item.id}</span></div>
        </div>
      </article>`;
  }

  async function loadQuestions() {
    if (!document.getElementById("list-results")) return;
    const seq = ++listSeq;
    state.loadingList = true;
    renderListResults();
    const params = new URLSearchParams();
    if (state.filters.subject) params.set("subject", state.filters.subject);
    if (state.filters.status) params.set("status", state.filters.status);
    if (state.filters.q) params.set("q", state.filters.q);
    params.set("page", String(state.filters.page));
    params.set("page_size", "12");
    try {
      const data = await api(`/api/questions?${params.toString()}`);
      if (seq !== listSeq || !document.getElementById("list-results")) return;
      state.list = data;
    } catch (error) {
      if (seq !== listSeq) return;
      showToast(error.message, "error");
      if (!state.list) {
        state.list = { items: [], total: 0, page: 1, page_size: 12, stats: { total: 0, todo: 0, mastered: 0 } };
      }
    } finally {
      if (seq === listSeq) {
        state.loadingList = false;
        renderListResults();
        renderStats();
      }
    }
  }

  function setFilters(patch) {
    Object.assign(state.filters, patch);
    if (!Object.prototype.hasOwnProperty.call(patch, "page")) state.filters.page = 1;
    renderListPage();
    loadQuestions();
  }

  // -------------------------------------------------------------- 添加错题

  function openAddModal() {
    state.add = {
      step: 1,
      file: null,
      preview: "",
      crop: null,
      cropPreview: "",
      image_path: "",
      ai: null,
      aiError: "",
      error: "",
      busy: false,
      analyzing: false,
      subject: "",
      consult: { messages: [], busy: false, error: "" },
    };
    renderAddModal();
  }

  function renderAddModal() {
    const add = state.add;
    if (!add) return;
    const subtitle = add.step === 1 ? "第 1 步 / 共 2 步 · 上传题目照片" : "第 2 步 / 共 2 步 · 确认 AI 分析结果";
    let body = "";
    let footer = "";

    if (add.busy) {
      body = `
        <div class="spinner-wrap">
          <div class="spinner"></div>
          <p>${add.analyzing ? "AI 正在识别题目并分析错因，通常需要 10–30 秒…" : "正在上传照片…"}</p>
        </div>`;
    } else if (add.step === 1) {
      const editor = add.preview
        ? `<div class="crop-stage">
             <div class="crop-wrap" id="crop-wrap">
               <img id="crop-img" src="${add.preview}" alt="待裁剪的题目照片">
               <div class="crop-shade" id="crop-shade-top"></div>
               <div class="crop-shade" id="crop-shade-bottom"></div>
               <div class="crop-shade" id="crop-shade-left"></div>
               <div class="crop-shade" id="crop-shade-right"></div>
               <div class="crop-box" id="crop-box">
                 <span class="crop-handle nw" data-handle="nw"></span>
                 <span class="crop-handle ne" data-handle="ne"></span>
                 <span class="crop-handle sw" data-handle="sw"></span>
                 <span class="crop-handle se" data-handle="se"></span>
               </div>
             </div>
           </div>
           <div class="crop-bar">
             <span class="crop-tip">拖动框内可移动，拖四角可缩放；也可在图片上重新拉框</span>
             <div class="crop-actions">
               <button type="button" class="btn btn-ghost btn-sm" id="btn-crop-reset">全选</button>
               <button type="button" class="btn btn-ghost btn-sm" id="btn-rechoose">重新选择</button>
             </div>
           </div>`
        : `<div class="dropzone" id="dropzone">
             <div class="drop-icon">${ICONS.camera}</div>
             <strong>点击选择或拖入题目照片</strong>
             <small>拍照时请保证题目完整、字迹清晰、光线充足</small>
           </div>`;
      body = `
        <div class="step-hint">上传题目照片</div>
        ${editor}
        <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" hidden>
        <p class="hint-text">支持 JPG、PNG、WEBP；可框选题目区域去掉多余部分，上传前自动压缩，单张不超过 12MB。</p>
        ${add.error ? `<div class="form-error">${esc(add.error)}</div>` : ""}`;
      footer = `
        <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
        ${add.preview ? '<button type="button" class="btn btn-soft" id="btn-add-manual">跳过 AI 手动填写</button>' : ""}
        <button type="button" class="btn btn-primary" id="btn-add-analyze"${add.preview ? "" : " disabled"}>AI 智能分析</button>`;
    } else {
      const ai = add.ai || {};
      const selected = add.subject || ai.subject || "";
      body = `
        <div class="step-hint">确认分析结果</div>
        ${add.aiError ? `<div class="banner banner-warn"><span class="banner-icon">!</span><div>AI 分析未能完成：${esc(add.aiError)}<br>你仍可手动填写内容后保存。</div></div>` : ""}
        ${add.preview ? `<div class="add-preview"><img src="${add.cropPreview || add.preview}" alt="题目照片"></div>` : ""}
        <form id="save-question-form">
          <div class="form-grid">
            <div class="field">
              <label for="save-subject">科目 <span class="req">*</span></label>
              <select class="select" id="save-subject" name="subject" required>
                <option value="">请选择科目</option>
                ${subjectOptions(selected)}
              </select>
            </div>
            <div class="field">
              <label for="save-title">标题 <span class="optional">（可选，留空自动生成）</span></label>
              <input class="input" id="save-title" name="title" maxlength="120" placeholder="例如：二次函数与坐标轴交点">
            </div>
          </div>
          <div class="field">
            <label for="save-question-text">题目原文</label>
            <textarea class="textarea" id="save-question-text" name="question_text" rows="4" maxlength="20000" placeholder="AI 将自动识别，你也可以手动修正">${esc(ai.question_text || "")}</textarea>
          </div>
          <div class="field">
            <label for="save-answer">正确答案</label>
            <textarea class="textarea" id="save-answer" name="answer_text" rows="3" maxlength="10000" placeholder="正确答案或学生的错误作答">${esc(ai.answer_text || "")}</textarea>
          </div>
          <div class="field">
            <label for="save-kp">知识点 <span class="optional">（用顿号分隔）</span></label>
            <input class="input" id="save-kp" name="knowledge_points" maxlength="2000" value="${esc(ai.knowledge_points || "")}" placeholder="例如：二次函数、判别式、根的分布">
          </div>
          <div class="field">
            <label for="save-reason">错因分析</label>
            <textarea class="textarea" id="save-reason" name="error_reason" rows="3" maxlength="4000" placeholder="孩子为什么做错">${esc(ai.error_reason || "")}</textarea>
          </div>
          <div class="field">
            <label for="save-solution">解题思路</label>
            <textarea class="textarea" id="save-solution" name="solution" rows="5" maxlength="20000" placeholder="分步骤的正确答案与思路">${esc(ai.solution || "")}</textarea>
          </div>
          <div class="consult-card">
            <div class="consult-head">
              <strong class="consult-title">我有疑问</strong>
              <p class="consult-sub">对答案或解题思路有不同意见？先和专家聊聊，确认无误后再保存错题。</p>
            </div>
            <div class="consult-log" id="consult-log"></div>
            <div class="consult-input-row">
              <textarea class="textarea" id="consult-input" rows="2" maxlength="1000" placeholder="例如：第 3 步为什么要除以原来的面积？我觉得答案应该是 6 倍"></textarea>
              <button type="button" class="btn btn-soft" id="btn-consult">发送</button>
            </div>
            <div class="consult-error" id="consult-error" hidden></div>
          </div>
          <div class="form-error" id="add-save-error" hidden></div>
        </form>`;
      footer = `
        <button type="button" class="btn btn-ghost" id="btn-add-back">返回重选</button>
        <button type="submit" class="btn btn-primary" id="btn-save-question" form="save-question-form">保存错题</button>`;
    }

    setModal(modalFrame({ title: "添加错题", subtitle, body, footer, size: "md" }), "add");
    bindAddEvents();
  }

  function bindAddEvents() {
    const add = state.add;
    if (!add || add.busy) return;

    if (add.step === 1) {
      const zone = document.getElementById("dropzone");
      const input = document.getElementById("file-input");
      if (input) {
        input.addEventListener("change", () => {
          const file = input.files && input.files[0];
          if (file) pickAddFile(file);
        });
      }
      if (zone && input) {
        zone.addEventListener("click", () => input.click());
        zone.addEventListener("dragover", (event) => {
          event.preventDefault();
          zone.classList.add("dragging");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
        zone.addEventListener("drop", (event) => {
          event.preventDefault();
          zone.classList.remove("dragging");
          const file = event.dataTransfer.files && event.dataTransfer.files[0];
          if (file) pickAddFile(file);
        });
      }
      const analyzeBtn = document.getElementById("btn-add-analyze");
      if (analyzeBtn) analyzeBtn.addEventListener("click", () => addStart(true));
      const manualBtn = document.getElementById("btn-add-manual");
      if (manualBtn) manualBtn.addEventListener("click", () => addStart(false));
      const rechooseBtn = document.getElementById("btn-rechoose");
      if (rechooseBtn && input) rechooseBtn.addEventListener("click", () => input.click());
      bindCropEditor();
    } else {
      const back = document.getElementById("btn-add-back");
      if (back) {
        back.addEventListener("click", () => {
          state.add.step = 1;
          state.add.aiError = "";
          state.add.consult = { messages: [], busy: false, error: "" };
          renderAddModal();
        });
      }
      const form = document.getElementById("save-question-form");
      if (form) form.addEventListener("submit", saveNewQuestion);
      const consultBtn = document.getElementById("btn-consult");
      if (consultBtn) consultBtn.addEventListener("click", sendConsult);
      const consultInput = document.getElementById("consult-input");
      if (consultInput) {
        consultInput.addEventListener("keydown", (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            sendConsult();
          }
        });
      }
      const consultCard = document.querySelector(".consult-card");
      if (consultCard) {
        consultCard.addEventListener("click", (event) => {
          const apply = event.target.closest("[data-consult-apply]");
          if (apply) applyConsultRevision(Number(apply.dataset.consultApply));
        });
      }
      renderConsultPanel();
    }
  }

  // -------------------------------------------------------------- 框选裁剪

  function bindCropEditor() {
    const wrap = document.getElementById("crop-wrap");
    const box = document.getElementById("crop-box");
    const add = state.add;
    if (!wrap || !box || !add || !add.preview) return;
    const shades = {
      top: document.getElementById("crop-shade-top"),
      bottom: document.getElementById("crop-shade-bottom"),
      left: document.getElementById("crop-shade-left"),
      right: document.getElementById("crop-shade-right"),
    };
    if (!add.crop) add.crop = { x: 0, y: 0, w: 1, h: 1 };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const apply = () => {
      const c = add.crop;
      box.style.left = `${c.x * 100}%`;
      box.style.top = `${c.y * 100}%`;
      box.style.width = `${c.w * 100}%`;
      box.style.height = `${c.h * 100}%`;
      shades.top.style.left = "0";
      shades.top.style.top = "0";
      shades.top.style.width = "100%";
      shades.top.style.height = `${c.y * 100}%`;
      shades.bottom.style.left = "0";
      shades.bottom.style.top = `${(c.y + c.h) * 100}%`;
      shades.bottom.style.width = "100%";
      shades.bottom.style.height = `${(1 - c.y - c.h) * 100}%`;
      shades.left.style.left = "0";
      shades.left.style.top = `${c.y * 100}%`;
      shades.left.style.width = `${c.x * 100}%`;
      shades.left.style.height = `${c.h * 100}%`;
      shades.right.style.left = `${(c.x + c.w) * 100}%`;
      shades.right.style.top = `${c.y * 100}%`;
      shades.right.style.width = `${(1 - c.x - c.w) * 100}%`;
      shades.right.style.height = `${c.h * 100}%`;
    };
    apply();

    const resetBtn = document.getElementById("btn-crop-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        add.crop = { x: 0, y: 0, w: 1, h: 1 };
        add.image_path = "";
        apply();
      });
    }

    const minSize = 0.08;
    let drag = null;

    const pointOf = (event) => {
      const rect = wrap.getBoundingClientRect();
      return {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
        rect,
      };
    };

    wrap.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const handle = event.target.closest("[data-handle]");
      const point = pointOf(event);
      drag = {
        mode: handle ? handle.dataset.handle : event.target.closest(".crop-box") ? "move" : "new",
        anchorX: point.x,
        anchorY: point.y,
        startX: point.x,
        startY: point.y,
        crop: { ...add.crop },
      };
      if (drag.mode === "new") {
        add.crop = { x: point.x, y: point.y, w: minSize, h: minSize };
        apply();
      }
      wrap.classList.add("dragging");
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 部分浏览器不支持指针捕获 */
      }
    });

    wrap.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      const point = pointOf(event);
      const c0 = drag.crop;
      if (drag.mode === "new") {
        const x1 = Math.min(drag.anchorX, point.x);
        const y1 = Math.min(drag.anchorY, point.y);
        const x2 = Math.max(drag.anchorX, point.x);
        const y2 = Math.max(drag.anchorY, point.y);
        add.crop = {
          x: x1,
          y: y1,
          w: clamp(x2 - x1, minSize, 1),
          h: clamp(y2 - y1, minSize, 1),
        };
      } else if (drag.mode === "move") {
        add.crop = {
          x: clamp(c0.x + (point.x - drag.startX), 0, 1 - c0.w),
          y: clamp(c0.y + (point.y - drag.startY), 0, 1 - c0.h),
          w: c0.w,
          h: c0.h,
        };
      } else {
        const next = { ...c0 };
        if (drag.mode.includes("w")) {
          const right = c0.x + c0.w;
          next.x = clamp(point.x, 0, right - minSize);
          next.w = right - next.x;
        }
        if (drag.mode.includes("e")) {
          next.w = clamp(c0.w + (point.x - drag.startX), minSize, 1 - c0.x);
        }
        if (drag.mode.includes("n")) {
          const bottom = c0.y + c0.h;
          next.y = clamp(point.y, 0, bottom - minSize);
          next.h = bottom - next.y;
        }
        if (drag.mode.includes("s")) {
          next.h = clamp(c0.h + (point.y - drag.startY), minSize, 1 - c0.y);
        }
        add.crop = next;
      }
      add.image_path = "";
      apply();
    });

    const finish = () => {
      if (!drag) return;
      drag = null;
      wrap.classList.remove("dragging");
    };
    wrap.addEventListener("pointerup", finish);
    wrap.addEventListener("pointercancel", finish);
  }

  async function pickAddFile(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("仅支持 JPG、PNG、WEBP 格式的图片", "error");
      return;
    }
    const add = state.add;
    if (!add) return;
    add.file = file;
    add.preview = "";
    add.crop = null;
    add.cropPreview = "";
    add.image_path = "";
    add.ai = null;
    add.aiError = "";
    add.subject = "";
    add.error = "";
    add.consult = { messages: [], busy: false, error: "" };
    try {
      add.preview = await fileToDataUrl(file);
    } catch (error) {
      showToast(error.message, "error");
      return;
    }
    if (state.modalKind === "add") renderAddModal();
  }

  async function addStart(useAI) {
    const add = state.add;
    if (!add || !add.file || add.busy) return;
    add.busy = true;
    add.analyzing = false;
    add.error = "";
    renderAddModal();
    try {
      const blob = await compressImage(add.file, add.crop);
      add.cropPreview = await fileToDataUrl(blob).catch(() => "");
      if (state.modalKind !== "add") return;
      if (!add.image_path) {
        const formData = new FormData();
        formData.append("file", blob, "question.jpg");
        const uploaded = await api("/api/uploads", { method: "POST", body: formData });
        add.image_path = uploaded.path;
      }
      if (state.modalKind !== "add") return;
      if (useAI) {
        add.analyzing = true;
        renderAddModal();
        try {
          const result = await api("/api/questions/analyze", {
            method: "POST",
            body: { image_path: add.image_path },
          });
          add.ai = result;
          add.aiError = "";
          add.subject = result.subject || "";
        } catch (error) {
          add.ai = null;
          add.aiError = error.message;
        }
        if (state.modalKind !== "add") return;
      }
      add.busy = false;
      add.analyzing = false;
      add.step = 2;
      renderAddModal();
    } catch (error) {
      if (state.modalKind !== "add") return;
      add.busy = false;
      add.analyzing = false;
      add.error = error.message;
      renderAddModal();
    }
  }

  async function saveNewQuestion(event) {
    event.preventDefault();
    const add = state.add;
    const form = event.currentTarget;
    if (!add) return;
    const valueOf = (name) => {
      const field = form.elements.namedItem(name);
      return field ? field.value : "";
    };
    const payload = {
      subject: valueOf("subject"),
      title: valueOf("title").trim(),
      image_path: add.image_path,
      question_text: valueOf("question_text"),
      answer_text: valueOf("answer_text"),
      knowledge_points: valueOf("knowledge_points"),
      error_reason: valueOf("error_reason"),
      solution: valueOf("solution"),
    };
    const errorBox = document.getElementById("add-save-error");
    const submit = document.getElementById("btn-save-question");
    if (!payload.subject) {
      if (errorBox) {
        errorBox.textContent = "请选择科目";
        errorBox.hidden = false;
      }
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.textContent = "保存中…";
    }
    try {
      const result = await api("/api/questions", { method: "POST", body: payload });
      closeModal();
      showToast("错题已保存", "success");
      await loadQuestions();
      openDetail(result.question.id);
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "保存错题";
      }
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } else {
        showToast(error.message, "error");
      }
    }
  }

  // -------------------------------------------------------------- 主页提问

  function renderQaPanel() {
    const log = document.getElementById("qa-log");
    if (!log) return;
    const qa = state.qa;
    const items = qa.messages.map((item, index) => consultMessageHtml(item, index, "老师")).join("");
    const typing = qa.busy
      ? `<div class="consult-msg expert">
           <span class="consult-role">老师</span>
           <div class="consult-bubble"><div class="consult-typing"><span></span><span></span><span></span></div></div>
         </div>`
      : "";
    log.innerHTML = items + typing || `<p class="consult-empty">有不懂的题目、概念或方法，直接问 AI 老师；也可以拍下题目让老师看图讲解。</p>`;

    const btn = document.getElementById("btn-qa");
    if (btn) {
      btn.disabled = qa.busy || qa.uploading;
      btn.textContent = qa.busy ? "老师思考中…" : qa.uploading ? "照片上传中…" : "发送";
    }
    const input = document.getElementById("qa-input");
    if (input) input.disabled = qa.busy;
    const photoBtn = document.getElementById("btn-qa-photo");
    if (photoBtn) {
      photoBtn.disabled = qa.uploading || qa.busy;
      photoBtn.innerHTML = qa.uploading
        ? "照片处理中…"
        : `${ICONS.cameraSm} ${qa.imagePreview ? "更换题目照片" : "拍照 / 上传题目"}`;
    }
    const attach = document.getElementById("qa-attach");
    if (attach) attach.hidden = !qa.imagePreview;
    const attachImg = document.getElementById("qa-attach-img");
    if (attachImg && qa.imagePreview) attachImg.src = qa.imagePreview;
    const addBtn = document.getElementById("btn-qa-add");
    if (addBtn) addBtn.hidden = !(qa.messages.length || qa.imagePath);
    const error = document.getElementById("qa-error");
    if (error) {
      error.textContent = qa.error || "";
      error.hidden = !qa.error;
    }
    log.scrollTop = log.scrollHeight;
  }

  async function pickQaFile(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("仅支持 JPG、PNG、WEBP 格式的图片", "error");
      return;
    }
    const qa = state.qa;
    if (qa.uploading || qa.busy) return;
    qa.uploading = true;
    qa.error = "";
    renderQaPanel();
    try {
      const blob = await compressImage(file);
      qa.imagePreview = await fileToDataUrl(blob);
      const formData = new FormData();
      formData.append("file", blob, "question.jpg");
      const uploaded = await api("/api/uploads", { method: "POST", body: formData });
      qa.imagePath = uploaded.path;
    } catch (error) {
      qa.imagePath = "";
      qa.imagePreview = "";
      qa.error = error.message;
    } finally {
      qa.uploading = false;
      renderQaPanel();
    }
  }

  function removeQaPhoto() {
    const qa = state.qa;
    if (qa.uploading) return;
    qa.imagePath = "";
    qa.imagePreview = "";
    renderQaPanel();
  }

  async function sendQa() {
    const qa = state.qa;
    if (qa.busy) return;
    if (qa.uploading) {
      qa.error = "照片还在上传，请稍等一下";
      renderQaPanel();
      return;
    }
    const input = document.getElementById("qa-input");
    if (!input) return;
    let text = input.value.trim();
    if (!text && !qa.imagePath) {
      qa.error = "请输入你的问题，或先拍下题目照片";
      renderQaPanel();
      return;
    }
    if (!text) text = "请帮我讲解这道题，并指出解题的关键步骤。";
    qa.messages.push({ role: "user", content: text });
    qa.busy = true;
    qa.error = "";
    input.value = "";
    renderQaPanel();
    try {
      const history = qa.messages
        .slice(-12)
        .map((item) => ({ role: item.role, content: item.content }));
      const result = await api("/api/ai/ask", {
        method: "POST",
        body: { subject: "", messages: history, image_path: qa.imagePath || "" },
      });
      qa.messages.push({ role: "assistant", content: result.reply });
    } catch (error) {
      qa.error = error.message;
    } finally {
      qa.busy = false;
      renderQaPanel();
    }
  }

  async function qaAddToNotebook() {
    const qa = state.qa;
    if (qa.busy || qa.uploading || qa.adding) return;
    const lastUser = [...qa.messages].reverse().find((item) => item.role === "user");
    const lastReply = [...qa.messages].reverse().find((item) => item.role === "assistant");
    const fallbackAi = {
      question_text: lastUser ? lastUser.content : "",
      solution: lastReply ? lastReply.content : "",
    };
    const hasImage = Boolean(qa.imagePath);
    qa.adding = true;
    state.add = {
      step: 2,
      file: null,
      preview: hasImage ? qa.imagePreview : "",
      crop: null,
      cropPreview: hasImage ? qa.imagePreview : "",
      image_path: qa.imagePath || "",
      ai: hasImage ? null : fallbackAi,
      aiError: "",
      error: "",
      busy: hasImage,
      analyzing: hasImage,
      subject: "",
      consult: { messages: [], busy: false, error: "" },
    };
    renderAddModal();
    if (!hasImage) {
      qa.adding = false;
      return;
    }
    try {
      const result = await api("/api/questions/analyze", {
        method: "POST",
        body: { image_path: qa.imagePath },
      });
      if (state.modalKind !== "add") return;
      state.add.ai = result;
      state.add.subject = result.subject || "";
    } catch (error) {
      if (state.modalKind !== "add") return;
      state.add.ai = fallbackAi;
      state.add.aiError = error.message;
    } finally {
      qa.adding = false;
    }
    if (state.modalKind !== "add") return;
    state.add.busy = false;
    state.add.analyzing = false;
    state.add.step = 2;
    renderAddModal();
  }

  function clearQa() {
    if (state.qa.busy) {
      showToast("等老师回答完再清空吧", "error");
      return;
    }
    if (!state.qa.messages.length && !state.qa.imagePath) return;
    state.qa = { messages: [], imagePath: "", imagePreview: "", uploading: false, busy: false, adding: false, error: "" };
    renderQaPanel();
  }

  // -------------------------------------------------------------- 我有疑问

  function consultMessageHtml(message, index, expertLabel = "专家") {
    const mine = message.role === "user";
    const revisedCount = message.revised ? Object.keys(message.revised).length : 0;
    return `
      <div class="consult-msg ${mine ? "mine" : "expert"}">
        <span class="consult-role">${mine ? "我" : esc(expertLabel)}</span>
        <div class="consult-bubble">
          <div class="consult-text">${esc(message.content || "")}</div>
          ${revisedCount ? `<button type="button" class="btn btn-ghost btn-sm consult-apply" data-consult-apply="${index}">应用专家的修改</button>` : ""}
        </div>
      </div>`;
  }

  function renderConsultPanel() {
    const add = state.add;
    if (!add || !add.consult) return;
    const log = document.getElementById("consult-log");
    if (!log) return;
    const consult = add.consult;
    const items = consult.messages.map(consultMessageHtml).join("");
    const typing = consult.busy
      ? `<div class="consult-msg expert">
           <span class="consult-role">专家</span>
           <div class="consult-bubble"><div class="consult-typing"><span></span><span></span><span></span></div></div>
         </div>`
      : "";
    const content = items + typing;
    log.innerHTML = content || `<p class="consult-empty">还没有提问。把你的疑问告诉专家，他会解释清楚或给出修订方案。</p>`;

    const btn = document.getElementById("btn-consult");
    if (btn) {
      btn.disabled = consult.busy;
      btn.textContent = consult.busy ? "专家思考中…" : "发送";
    }
    const input = document.getElementById("consult-input");
    if (input) input.disabled = consult.busy;
    const error = document.getElementById("consult-error");
    if (error) {
      error.textContent = consult.error || "";
      error.hidden = !consult.error;
    }
    log.scrollTop = log.scrollHeight;
  }

  async function sendConsult() {
    const add = state.add;
    if (!add || !add.consult || add.consult.busy) return;
    if (state.modalKind !== "add" || add.step !== 2) return;
    const input = document.getElementById("consult-input");
    const form = document.getElementById("save-question-form");
    if (!input || !form) return;
    const text = input.value.trim();
    if (!text) {
      add.consult.error = "请先输入你的疑问";
      renderConsultPanel();
      return;
    }
    const valueOf = (name) => {
      const field = form.elements.namedItem(name);
      return field ? field.value : "";
    };
    add.consult.messages.push({ role: "user", content: text });
    add.consult.busy = true;
    add.consult.error = "";
    input.value = "";
    renderConsultPanel();
    try {
      const history = add.consult.messages
        .slice(-12)
        .map((item) => ({ role: item.role, content: item.content }));
      const result = await api("/api/questions/consult", {
        method: "POST",
        body: {
          subject: valueOf("subject"),
          question_text: valueOf("question_text"),
          answer_text: valueOf("answer_text"),
          knowledge_points: valueOf("knowledge_points"),
          error_reason: valueOf("error_reason"),
          solution: valueOf("solution"),
          messages: history,
        },
      });
      add.consult.messages.push({
        role: "assistant",
        content: result.reply,
        revised: result.revised || {},
      });
    } catch (error) {
      add.consult.error = error.message;
    } finally {
      add.consult.busy = false;
      if (state.modalKind === "add" && state.add === add) renderConsultPanel();
    }
  }

  function applyConsultRevision(index) {
    const add = state.add;
    if (!add || !add.consult) return;
    const message = add.consult.messages[index];
    if (!message || !message.revised) return;
    const fieldMap = {
      question_text: "save-question-text",
      answer_text: "save-answer",
      knowledge_points: "save-kp",
      error_reason: "save-reason",
      solution: "save-solution",
    };
    let applied = 0;
    Object.entries(message.revised).forEach(([key, value]) => {
      const element = document.getElementById(fieldMap[key]);
      if (element) {
        element.value = value;
        applied += 1;
      }
    });
    if (!applied) {
      showToast("这条回复没有可应用的修改", "error");
      return;
    }
    showToast("已应用专家的修改，请确认后保存", "success");
  }

  // -------------------------------------------------------------- 错题详情

  async function openDetail(id) {
    state.detail = { loading: true, editing: false, generating: null, question: null, exercises: [] };
    renderDetail();
    try {
      const data = await api(`/api/questions/${id}`);
      if (state.modalKind !== "detail") return;
      state.detail = {
        loading: false,
        editing: false,
        generating: null,
        question: data.question,
        exercises: data.exercises || [],
      };
      renderDetail();
    } catch (error) {
      if (state.modalKind !== "detail") return;
      closeModal();
      showToast(error.message, "error");
    }
  }

  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    if (detail.loading) {
      setModal(
        modalFrame({
          title: "错题详情",
          body: '<div class="spinner-wrap"><div class="spinner"></div><p>正在加载错题…</p></div>',
          size: "lg",
        }),
        "detail"
      );
      return;
    }

    const question = detail.question;
    if (!question) return;
    const isMastered = question.status === "mastered";
    const actions = detail.editing
      ? ""
      : `<button type="button" class="btn btn-soft btn-sm" data-action="detail-toggle-status">${
          isMastered ? "↩ 重新标记为待复习" : "✓ 标记为已掌握"
        }</button>
         <button type="button" class="btn btn-ghost btn-sm" data-action="detail-edit">编辑内容</button>
         <button type="button" class="btn btn-danger btn-sm" data-action="detail-delete">删除错题</button>`;

    const imageBlock = question.image_path
      ? `<a href="${esc(question.image_path)}" target="_blank" rel="noopener"><img src="${esc(question.image_path)}" alt="错题原图"></a>
         <a class="image-link" href="${esc(question.image_path)}" target="_blank" rel="noopener">查看原图 ↗</a>`
      : '<div class="no-image">这道错题没有上传图片</div>';

    const body = `
      <div class="detail-head-info">
        ${subjectPill(question.subject)}
        <span class="status-pill inline ${isMastered ? "mastered" : "todo"}">${isMastered ? "已掌握" : "待复习"}</span>
        <span class="meta-inline">添加于 ${fmtDate(question.created_at)}</span>
      </div>
      <h1 class="detail-title">${esc(question.title)}</h1>
      <div class="meta-row">
        <span>#${question.id}</span>
        ${question.updated_at && question.updated_at !== question.created_at ? `<span>最近更新 ${fmtDate(question.updated_at)}</span>` : ""}
      </div>
      <div class="detail-actions">${actions}</div>
      <div class="detail-grid">
        <div class="detail-image">${imageBlock}</div>
        <div class="detail-main">${detail.editing ? detailEditHtml(question) : detailViewHtml(question)}</div>
      </div>
      ${detailExercisesHtml(detail.exercises || [], detail.generating)}`;

    setModal(
      modalFrame({
        title: "错题详情",
        subtitle: `#${question.id} · ${esc(question.subject)}`,
        body,
        footer: '<button type="button" class="btn btn-ghost" data-action="close-modal">关闭</button>',
        size: "lg",
      }),
      "detail"
    );
    bindDetailEvents();
  }

  function detailViewHtml(question) {
    const answer = question.answer_text
      ? `<div class="prose">${nl2br(question.answer_text)}</div>`
      : '<p class="detail-empty">暂无答案</p>';
    const knowledge = question.knowledge_points
      ? `<div class="kp-list">${knowledgeChips(question.knowledge_points, 99)}</div>`
      : '<p class="detail-empty">暂无知识点</p>';
    return `
      <div class="detail-section">
        <h3 class="section-title">题目原文</h3>
        ${question.question_text ? `<div class="prose">${nl2br(question.question_text)}</div>` : '<p class="detail-empty">暂无题目文字</p>'}
      </div>
      <div class="detail-section">
        <h3 class="section-title">正确答案</h3>
        ${answer}
      </div>
      <div class="detail-section">
        <h3 class="section-title">知识点</h3>
        ${knowledge}
      </div>
      <div class="detail-section">
        <h3 class="section-title">错因分析</h3>
        ${question.error_reason ? `<div class="prose">${nl2br(question.error_reason)}</div>` : '<p class="detail-empty">暂无错因分析</p>'}
      </div>
      <div class="detail-section">
        <h3 class="section-title">解题思路</h3>
        ${question.solution ? `<div class="prose">${nl2br(question.solution)}</div>` : '<p class="detail-empty">暂无解题思路</p>'}
      </div>`;
  }

  function detailEditHtml(question) {
    return `
      <form id="detail-edit-form" class="edit-form">
        <div class="form-grid">
          <div class="field">
            <label>科目 <span class="req">*</span></label>
            <select class="select" name="subject" required>
              <option value="">请选择科目</option>
              ${subjectOptions(question.subject)}
            </select>
          </div>
          <div class="field">
            <label>标题</label>
            <input class="input" name="title" maxlength="120" value="${esc(question.title)}">
          </div>
        </div>
        <div class="field">
          <label>题目原文</label>
          <textarea class="textarea" name="question_text" rows="4" maxlength="20000">${esc(question.question_text)}</textarea>
        </div>
        <div class="field">
          <label>正确答案</label>
          <textarea class="textarea" name="answer_text" rows="3" maxlength="10000">${esc(question.answer_text)}</textarea>
        </div>
        <div class="field">
          <label>知识点 <span class="optional">（用顿号分隔）</span></label>
          <input class="input" name="knowledge_points" maxlength="2000" value="${esc(question.knowledge_points)}">
        </div>
        <div class="field">
          <label>错因分析</label>
          <textarea class="textarea" name="error_reason" rows="3" maxlength="4000">${esc(question.error_reason)}</textarea>
        </div>
        <div class="field">
          <label>解题思路</label>
          <textarea class="textarea" name="solution" rows="5" maxlength="20000">${esc(question.solution)}</textarea>
        </div>
        <div class="form-error" id="detail-edit-error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="detail-cancel-edit">取消</button>
          <button type="submit" class="btn btn-primary" id="detail-save-btn">保存修改</button>
        </div>
      </form>`;
  }

  function detailExercisesHtml(exercises, generating) {
    const sorted = exercises.slice().sort((a, b) => {
      const diff = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
      return diff !== 0 ? diff : a.id - b.id;
    });

    const levelButtons = LEVEL_ORDER.map((level) => {
      const active = generating === level;
      const disabled = generating ? " disabled" : "";
      return `<button type="button" class="level-btn" data-action="generate-exercise" data-value="${level}"${disabled}>${
        active ? '<span class="spinner sm"></span>生成中…' : `生成${LEVEL_LABELS[level]}题`
      }</button>`;
    }).join("");

    let listHtml = "";
    if (sorted.length) {
      listHtml = `<div class="ex-list">${sorted
        .map(
          (item) => `
        <article class="ex-card">
          <div class="ex-head">
            <span class="level-tag ${esc(item.level)}">${esc(LEVEL_LABELS[item.level] || item.level)}</span>
            <span class="ex-no">生成于 ${fmtDay(item.created_at)}</span>
          </div>
          <div class="ex-content">${esc(item.content)}</div>
          <button type="button" class="btn btn-ghost btn-sm answer-toggle">查看答案</button>
          <div class="answer-box" hidden><strong>参考答案</strong>${esc(item.answer || "暂无")}<strong>解题思路</strong>${esc(item.explanation || "暂无")}</div>
        </article>`
        )
        .join("")}</div>`;
    } else {
      listHtml = '<div class="ex-empty">还没有生成练习，选一个难度让 AI 出 3 道同类题吧。</div>';
    }

    return `
      <section class="exercises-section" id="exercises-section">
        <div class="exercises-head">
          <div>
            <h3>举一反三</h3>
            <p>围绕这道错题的知识点，按难度生成同类练习。</p>
          </div>
          <div class="level-buttons">${levelButtons}</div>
        </div>
        ${listHtml}
      </section>`;
  }

  function bindDetailEvents() {
    const form = document.getElementById("detail-edit-form");
    if (form) form.addEventListener("submit", saveDetailEdit);
    modalRoot.querySelectorAll(".answer-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const box = button.nextElementSibling;
        if (!box) return;
        const willShow = box.hasAttribute("hidden");
        if (willShow) box.removeAttribute("hidden");
        else box.setAttribute("hidden", "");
        button.textContent = willShow ? "收起答案" : "查看答案";
      });
    });
  }

  async function saveDetailEdit(event) {
    event.preventDefault();
    const detail = state.detail;
    if (!detail || !detail.question) return;
    const form = event.currentTarget;
    const valueOf = (name) => {
      const field = form.elements.namedItem(name);
      return field ? field.value : "";
    };
    const submit = document.getElementById("detail-save-btn");
    const errorBox = document.getElementById("detail-edit-error");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "保存中…";
    }
    try {
      const result = await api(`/api/questions/${detail.question.id}`, {
        method: "PATCH",
        body: {
          subject: valueOf("subject"),
          title: valueOf("title"),
          question_text: valueOf("question_text"),
          answer_text: valueOf("answer_text"),
          knowledge_points: valueOf("knowledge_points"),
          error_reason: valueOf("error_reason"),
          solution: valueOf("solution"),
        },
      });
      detail.question = result.question;
      detail.editing = false;
      renderDetail();
      showToast("修改已保存", "success");
      loadQuestions();
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "保存修改";
      }
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } else {
        showToast(error.message, "error");
      }
    }
  }

  async function toggleQuestionStatus() {
    const detail = state.detail;
    if (!detail || !detail.question) return;
    const next = detail.question.status === "mastered" ? "todo" : "mastered";
    try {
      const result = await api(`/api/questions/${detail.question.id}`, {
        method: "PATCH",
        body: { status: next },
      });
      detail.question = result.question;
      renderDetail();
      showToast(next === "mastered" ? "已标记为掌握" : "已重新加入复习", "success");
      loadQuestions();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteCurrentQuestion() {
    const detail = state.detail;
    if (!detail || !detail.question) return;
    if (!window.confirm("确定删除这道错题吗？已生成的练习也会一并删除。")) return;
    try {
      await api(`/api/questions/${detail.question.id}`, { method: "DELETE" });
      closeModal();
      showToast("错题已删除", "success");
      loadQuestions();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function generateExercise(level) {
    const detail = state.detail;
    if (!detail || !detail.question || detail.generating) return;
    detail.generating = level;
    renderDetail();
    try {
      const result = await api(`/api/questions/${detail.question.id}/exercises`, {
        method: "POST",
        body: { level },
      });
      detail.exercises = [...(detail.exercises || []), ...(result.exercises || [])];
      showToast(`已生成 ${result.exercises.length} 道${LEVEL_LABELS[level] || ""}练习题`, "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      detail.generating = null;
      renderDetail();
      const section = document.getElementById("exercises-section");
      if (section) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // -------------------------------------------------------------- 管理员设置

  function renderSettingsPage() {
    const main = document.getElementById("main");
    if (!main) return;
    main.innerHTML = `
      <section class="page-head">
        <div>
          <h1 class="page-title">AI 服务设置</h1>
          <p class="page-sub">只有管理员可以配置 AI 服务，普通用户直接使用默认服务。</p>
        </div>
        <button type="button" class="btn btn-primary" data-action="add-provider">＋ 添加 AI 服务</button>
      </section>
      <div class="settings-note">
        <span class="banner-icon">i</span>
        <div><strong>普通用户无查看权限。</strong>你在这里添加的服务商、模型与 API Key 只对管理员可见。系统会使用标记为「默认」的服务分析错题与生成练习。</div>
      </div>
      <section id="providers-panel">
        <div class="spinner-wrap"><div class="spinner"></div><p>正在加载 AI 服务…</p></div>
      </section>
      <section class="settings-help">
        <h3>如何填写</h3>
        <ul>
          <li>BaseURL 填写兼容 OpenAI 接口的地址，通常包含 <code>/v1</code>，例如 <code>https://api.openai.com/v1</code>。</li>
          <li>模型需要具备图片理解能力，例如 <code>gpt-4o</code>、<code>qwen-vl-max</code>、<code>glm-4v</code> 等；纯文本模型无法识别照片。</li>
          <li>保存后点「测试连接」验证接口连通性；「设为默认」后立即对普通用户生效。</li>
          <li>API Key 只保存在服务器的 SQLite 数据库中，请妥善备份部署目录。</li>
        </ul>
      </section>`;
  }

  async function loadProviders() {
    const panel = document.getElementById("providers-panel");
    if (!panel) return;
    try {
      const data = await api("/api/admin/providers");
      state.providers = data.providers || [];
      renderProviders();
    } catch (error) {
      if (!document.getElementById("providers-panel")) return;
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-art">!</div>
          <h3>加载失败</h3>
          <p>${esc(error.message)}</p>
          <button type="button" class="btn btn-ghost" data-action="reload-providers">重试</button>
        </div>`;
    }
  }

  function renderProviders() {
    const panel = document.getElementById("providers-panel");
    if (!panel) return;
    const providers = state.providers || [];
    if (!providers.length) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-art">${ICONS.book}</div>
          <h3>还没有配置 AI 服务</h3>
          <p>添加一个兼容 OpenAI 接口、支持图片理解的模型，孩子的错题照片才能被自动分析。</p>
          <button type="button" class="btn btn-primary" data-action="add-provider">＋ 添加 AI 服务</button>
        </div>`;
      return;
    }
    panel.innerHTML = `<div class="provider-grid">${providers.map(providerCard).join("")}</div>`;
  }

  function providerCard(provider) {
    return `
      <article class="provider-card">
        <div class="provider-head">
          <span class="provider-name">${esc(provider.name)}</span>
          ${provider.is_default ? '<span class="default-badge">默认使用</span>' : ""}
        </div>
        <div class="provider-row"><span class="key">模型</span><span class="value">${esc(provider.model)}</span></div>
        <div class="provider-row"><span class="key">BaseURL</span><span class="value">${esc(provider.base_url)}</span></div>
        <div class="provider-row"><span class="key">API Key</span><span class="value">${esc(provider.api_key_masked || "未设置")}</span></div>
        <div class="provider-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="test-provider" data-id="${provider.id}">测试连接</button>
          ${
            provider.is_default
              ? ""
              : `<button type="button" class="btn btn-soft btn-sm" data-action="set-default-provider" data-id="${provider.id}">设为默认</button>`
          }
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit-provider" data-id="${provider.id}">编辑</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-provider" data-id="${provider.id}">删除</button>
        </div>
      </article>`;
  }

  function openProviderModal(provider) {
    const isEdit = Boolean(provider);
    const body = `
      <div class="banner banner-warn">
        <span class="banner-icon">!</span>
        <div>请填写兼容 OpenAI Chat Completions 接口的服务，并选择<strong>支持图片理解</strong>的模型，例如 GPT-4o、Qwen-VL-Max、GLM-4V 等。</div>
      </div>
      <form id="provider-form">
        <div class="field">
          <label>实例名称 <span class="req">*</span></label>
          <input class="input" name="name" maxlength="60" required value="${isEdit ? esc(provider.name) : ""}" placeholder="例如：OpenAI 主力">
        </div>
        <div class="field">
          <label>BaseURL <span class="req">*</span></label>
          <input class="input" name="base_url" required value="${isEdit ? esc(provider.base_url) : ""}" placeholder="https://api.openai.com/v1">
        </div>
        <div class="form-grid">
          <div class="field">
            <label>模型名称 <span class="req">*</span></label>
            <input class="input" name="model" required value="${isEdit ? esc(provider.model) : ""}" placeholder="gpt-4o">
          </div>
          <div class="field">
            <label>API Key ${isEdit ? '<span class="optional">（留空保持原 Key）</span>' : '<span class="req">*</span>'}</label>
            <input class="input" name="api_key" type="password" autocomplete="off"${isEdit ? "" : " required"} placeholder="${isEdit ? "留空则不修改" : "sk-..."}">
          </div>
        </div>
        ${
          isEdit
            ? ""
            : '<label class="checkbox-line"><input type="checkbox" name="is_default" checked> 设为默认使用的 AI 服务</label>'
        }
        <div class="form-error" id="provider-error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
          <button type="submit" class="btn btn-primary" id="provider-submit">${isEdit ? "保存修改" : "添加服务"}</button>
        </div>
      </form>`;
    setModal(
      modalFrame({
        title: isEdit ? "编辑 AI 服务" : "添加 AI 服务",
        subtitle: "仅管理员可配置",
        body,
        size: "md",
      }),
      "provider"
    );
    const form = document.getElementById("provider-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const valueOf = (name) => {
        const field = form.elements.namedItem(name);
        return field ? field.value.trim() : "";
      };
      const submit = document.getElementById("provider-submit");
      const errorBox = document.getElementById("provider-error");
      const payload = {
        name: valueOf("name"),
        base_url: valueOf("base_url"),
        model: valueOf("model"),
        api_key: valueOf("api_key"),
      };
      if (!isEdit) {
        const checkbox = form.elements.namedItem("is_default");
        payload.is_default = checkbox ? checkbox.checked : false;
      }
      if (submit) {
        submit.disabled = true;
        submit.textContent = "保存中…";
      }
      try {
        await api(isEdit ? `/api/admin/providers/${provider.id}` : "/api/admin/providers", {
          method: isEdit ? "PUT" : "POST",
          body: payload,
        });
        closeModal();
        showToast(isEdit ? "AI 服务已更新" : "AI 服务已添加", "success");
        loadProviders();
      } catch (error) {
        if (submit) {
          submit.disabled = false;
          submit.textContent = isEdit ? "保存修改" : "添加服务";
        }
        if (errorBox) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
        } else {
          showToast(error.message, "error");
        }
      }
    });
  }

  async function testProvider(button, providerId) {
    const original = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner sm"></span>测试中';
    try {
      const result = await api(`/api/admin/providers/${providerId}/test`, { method: "POST" });
      showToast(result.message || "连接成功", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  async function setDefaultProvider(providerId) {
    try {
      await api(`/api/admin/providers/${providerId}/default`, { method: "POST" });
      showToast("已设为默认 AI 服务", "success");
      loadProviders();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteProvider(providerId) {
    if (!window.confirm("确定删除这个 AI 服务吗？")) return;
    try {
      await api(`/api/admin/providers/${providerId}`, { method: "DELETE" });
      showToast("AI 服务已删除", "success");
      loadProviders();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  // -------------------------------------------------------------- 修改年级

  function openGradeModal() {
    const current = (state.user && state.user.grade) || "";
    const body = `
      <form id="grade-form">
        <p class="hint-text" style="margin:0 0 14px">年级会用于 AI 分析错因和出题：讲解方法、知识范围与题目难度都会按所选年级调整。</p>
        <div class="field">
          <label>孩子所在年级 <span class="req">*</span></label>
          <select class="select" name="grade" required>
            <option value="">请选择年级</option>
            ${gradeOptions(current)}
          </select>
        </div>
        <div class="form-error" id="grade-error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
          <button type="submit" class="btn btn-primary" id="grade-submit">保存</button>
        </div>
      </form>`;
    setModal(modalFrame({ title: "设置年级", body, size: "sm" }), "grade");
    const form = document.getElementById("grade-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const field = form.elements.namedItem("grade");
      const submit = document.getElementById("grade-submit");
      const errorBox = document.getElementById("grade-error");
      const grade = field ? field.value : "";
      if (!grade) {
        errorBox.textContent = "请选择年级";
        errorBox.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = "保存中…";
      try {
        const result = await api("/api/auth/grade", { method: "PUT", body: { grade } });
        state.user = result.user;
        closeModal();
        renderShell();
        route();
        showToast(`年级已设置为${grade}`, "success");
      } catch (error) {
        submit.disabled = false;
        submit.textContent = "保存";
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
    });
  }

  // -------------------------------------------------------------- 修改密码

  function openPasswordModal() {
    const body = `
      <form id="password-form">
        <div class="field">
          <label>当前密码</label>
          <input class="input" type="password" name="old_password" autocomplete="current-password" required placeholder="请输入当前密码">
        </div>
        <div class="field">
          <label>新密码</label>
          <input class="input" type="password" name="new_password" autocomplete="new-password" required minlength="6" placeholder="至少 6 位">
        </div>
        <div class="field">
          <label>确认新密码</label>
          <input class="input" type="password" name="confirm" autocomplete="new-password" required minlength="6" placeholder="再次输入新密码">
        </div>
        <div class="form-error" id="password-error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
          <button type="submit" class="btn btn-primary" id="password-submit">确认修改</button>
        </div>
      </form>`;
    setModal(modalFrame({ title: "修改密码", body, size: "sm" }), "password");
    const form = document.getElementById("password-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const valueOf = (name) => {
        const field = form.elements.namedItem(name);
        return field ? field.value : "";
      };
      const submit = document.getElementById("password-submit");
      const errorBox = document.getElementById("password-error");
      const newPassword = valueOf("new_password");
      if (newPassword !== valueOf("confirm")) {
        errorBox.textContent = "两次输入的新密码不一致";
        errorBox.hidden = false;
        return;
      }
      if (newPassword.length < 6) {
        errorBox.textContent = "新密码至少需要 6 位";
        errorBox.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = "保存中…";
      try {
        await api("/api/auth/password", {
          method: "PUT",
          body: { old_password: valueOf("old_password"), new_password: newPassword },
        });
        closeModal();
        showToast("密码已修改", "success");
      } catch (error) {
        submit.disabled = false;
        submit.textContent = "确认修改";
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
    });
  }

  // -------------------------------------------------------------- 全局事件

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    const id = Number(target.dataset.id || 0);
    const value = target.dataset.value || "";

    switch (action) {
      case "logout":
        signOut();
        break;
      case "change-password":
        openPasswordModal();
        break;
      case "edit-grade":
        openGradeModal();
        break;
      case "close-modal":
        closeModal();
        break;
      case "clear-qa":
        clearQa();
        break;
      case "open-add":
        openAddModal();
        break;
      case "open-detail":
        openDetail(id);
        break;
      case "filter-subject":
        setFilters({ subject: value, page: 1 });
        break;
      case "filter-status":
        setFilters({ status: value, page: 1 });
        break;
      case "clear-filters":
        setFilters({ subject: "", status: "", q: "", page: 1 });
        break;
      case "list-prev":
        setFilters({ page: Math.max(1, state.filters.page - 1) });
        break;
      case "list-next":
        setFilters({ page: state.filters.page + 1 });
        break;
      case "detail-toggle-status":
        toggleQuestionStatus();
        break;
      case "detail-edit":
        if (state.detail) {
          state.detail.editing = true;
          renderDetail();
        }
        break;
      case "detail-cancel-edit":
        if (state.detail) {
          state.detail.editing = false;
          renderDetail();
        }
        break;
      case "detail-delete":
        deleteCurrentQuestion();
        break;
      case "generate-exercise":
        generateExercise(value);
        break;
      case "add-provider":
        openProviderModal(null);
        break;
      case "edit-provider": {
        const provider = (state.providers || []).find((item) => item.id === id);
        if (provider) openProviderModal(provider);
        break;
      }
      case "delete-provider":
        deleteProvider(id);
        break;
      case "set-default-provider":
        setDefaultProvider(id);
        break;
      case "test-provider":
        testProvider(target, id);
        break;
      case "reload-providers":
        loadProviders();
        break;
      default:
        break;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modalKind) {
      closeModal();
    }
    if (event.key === "Enter" && event.target.matches('[data-action="open-detail"]')) {
      event.preventDefault();
      event.target.click();
    }
  });

  window.addEventListener("hashchange", route);

  boot();
})();

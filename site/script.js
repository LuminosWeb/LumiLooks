"use strict";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOut = t => 1 - (1 - t) ** 3;

/* ---------- Thème ---------- */
const themeButton = document.querySelector(".theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');
function setTheme(light) {
  root.dataset.theme = light ? "light" : "dark";
  themeButton.setAttribute("aria-label", light ? "Passer en mode sombre" : "Passer en mode clair");
  themeColor.content = getComputedStyle(root).getPropertyValue("--site-bg").trim();
}
setTheme(root.dataset.theme === "light");
themeButton.hidden = false;
// Changement de thème : le nouveau thème s’ouvre en cercle depuis le bouton, comme sur luminosweb.com.
themeButton.addEventListener("click", () => {
  const light = root.dataset.theme !== "light";
  const apply = () => {
    setTheme(light);
    try { localStorage.setItem("lumilooks-site-theme", root.dataset.theme); } catch {}
  };
  if (typeof document.startViewTransition !== "function" || reducedMotion.matches) return apply();
  const box = themeButton.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  root.style.setProperty("--theme-reveal-x", `${x}px`);
  root.style.setProperty("--theme-reveal-y", `${y}px`);
  root.style.setProperty("--theme-reveal-radius", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  root.setAttribute("data-theme-transition", "");
  document.startViewTransition(apply).finished.finally(() => root.removeAttribute("data-theme-transition"));
});

/* ---------- Système de l’ordinateur : bouton principal et carte recommandée ---------- */
(function matchDownloadToSystem() {
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  let os = null;
  if (/android|iphone|ipad|ipod/i.test(ua) || navigator.userAgentData?.mobile || (/mac/i.test(platform) && navigator.maxTouchPoints > 1)) os = "mobile";
  else if (/win/i.test(platform) || /windows/i.test(ua)) os = "windows";
  else if (/mac/i.test(platform) || /mac os x/i.test(ua)) os = "mac";
  else if (/linux|x11|cros/i.test(platform + ua)) os = "linux";
  if (!os) return;
  // Le bouton « Télécharger pour Windows » reste toujours affiché ; macOS et Linux reçoivent en plus leur propre bouton.
  const other = document.querySelector("[data-os-other]");
  const note = document.querySelector("[data-os-note]");
  if (os === "mac" || os === "linux") {
    other.querySelector("[data-os-label]").textContent = os === "mac" ? "Télécharger pour macOS" : "Télécharger pour Linux";
    other.hidden = false;
    note.textContent = os === "mac" ? "macOS 13 ou plus récent : puce Apple ou Intel, à choisir plus bas." : "Paquet .deb ou AppImage, à choisir plus bas.";
  } else if (os === "mobile") {
    note.textContent = "LumiLooks s’installe sur ordinateur : Windows, macOS et Linux.";
  }
  const card = document.querySelector(`.download-group[data-os="${os}"]`);
  if (card) {
    card.setAttribute("data-os-current", "");
    card.querySelector(".os-match").hidden = false;
  }
})();

/* ---------- Comparateur du hero ---------- */
const hero = document.querySelector(".hero");
const comparison = document.querySelector("#comparison-image");
const range = document.querySelector("#compare-range");
const compareToggle = document.querySelector(".compare-toggle");

function setSplit(position) {
  comparison.style.setProperty("--split", `${position}%`);
  const value = String(Math.round(position));
  if (range.value !== value) range.value = value;
  const valueText = `${range.value} % d’image originale`;
  if (range.getAttribute("aria-valuetext") !== valueText) range.setAttribute("aria-valuetext", valueText);
}

const comparator = (() => {
  const low = 30, high = 70, leg = 2600, hold = 900;
  let enabled = true, inView = true, frame = 0, lastTime, phase = "idle";
  let from = 42, to = high, elapsed = 0;

  function running() { return enabled && inView && !document.hidden && !reducedMotion.matches && phase !== "intro"; }
  function sync() {
    compareToggle.hidden = reducedMotion.matches;
    compareToggle.setAttribute("aria-label", enabled ? "Mettre en pause le comparateur" : "Relancer le comparateur");
    compareToggle.querySelector("use").setAttribute("href", enabled ? "#i-player-pause" : "#i-player-play");
    if (running()) { if (!frame) frame = requestAnimationFrame(tick); }
    else { cancelAnimationFrame(frame); frame = 0; lastTime = undefined; }
  }
  function tick(now) {
    elapsed += now - (lastTime ?? now);
    lastTime = now;
    const progress = Math.min(Math.max(elapsed - hold, 0) / leg, 1);
    setSplit(from + (to - from) * easeInOut(progress));
    if (progress === 1) { from = to; to = to === high ? low : high; elapsed = 0; }
    frame = requestAnimationFrame(tick);
  }
  function pause() { enabled = false; sync(); }
  range.addEventListener("input", () => { setSplit(Number(range.value)); from = Number(range.value); to = from < 50 ? high : low; elapsed = hold; });
  range.addEventListener("pointerdown", pause);
  range.addEventListener("keydown", pause);
  compareToggle.addEventListener("click", () => { enabled = !enabled; from = Number(range.value); elapsed = 0; sync(); });
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);
  if ("IntersectionObserver" in window) new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: .2 }).observe(comparison);

  // Ouverture : l’original occupe l’image, puis l’étalonnage se dévoile de droite à gauche.
  async function intro() {
    const images = [...comparison.querySelectorAll("img")];
    if (reducedMotion.matches) { setSplit(42); hero.classList.add("is-ready"); sync(); return; }
    phase = "intro";
    setSplit(100);
    await Promise.race([Promise.all(images.map(img => img.decode().catch(() => {}))), new Promise(r => setTimeout(r, 2500))]);
    hero.classList.add("is-ready");
    const start = performance.now() + 350, duration = 1700;
    await new Promise(resolve => {
      function step(now) {
        if (phase !== "intro") return resolve();
        const t = Math.min(Math.max(now - start, 0) / duration, 1);
        setSplit(100 - 58 * easeInOut(t));
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
    phase = "loop"; from = 42; to = high; elapsed = 0;
    sync();
  }
  range.addEventListener("pointerdown", () => { if (phase === "intro") { phase = "loop"; hero.classList.add("is-ready"); } }, { capture: true });
  return { intro, sync };
})();
comparator.intro();

/* ---------- Labo : une fenêtre de LumiLooks dans le navigateur ---------- */
(function lab() {
  const section = document.querySelector("#labo");
  const app = section.querySelector(".lab-app");
  const viewer = app.querySelector(".lab-viewer");
  const media = app.querySelector(".lab-media");
  const canvas = app.querySelector(".lab-canvas");
  const wipeCanvas = app.querySelector(".lab-wipe canvas");
  const message = app.querySelector(".lab-message");
  const fileInput = app.querySelector('input[type="file"]');
  const fileName = app.querySelector(".lab-file-name");
  const fileSize = app.querySelector(".lab-file-size");
  const list = app.querySelector(".lab-look-list");
  const intensityInput = app.querySelector(".lab-intensity input");
  const intensityOutput = app.querySelector(".lab-intensity output");
  const compareButton = app.querySelector(".lab-compare");
  const split = app.querySelector(".lab-split");
  const current = app.querySelector(".lab-current");
  const playButton = app.querySelector(".lab-play");
  const lookIds = ["luminos", "golden", "cinema", "portra", "chrome", "retro", "nordic", "noir"];
  let renderer, thumbs, presets, source;
  let look = "golden", intensity = 100, comparing = false, position = 0, revealed = false;
  let wipeFrame = 0, splitFrame = 0, thumbJob = 0, markSeen;
  const seen = new Promise(resolve => { markSeen = resolve; });
  const animated = () => !reducedMotion.matches;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function say(text) { message.textContent = text; }
  function draw(options = {}) {
    if (!renderer || !source) return;
    renderer.update({ ...presets.find(p => p.id === look).settings, intensity });
    renderer.render(source, source.width, source.height, { compare: comparing && position > 0, split: position / 100, seed: 1, ...options });
  }

  // Changement d’image : l’état précédent est figé sur un calque, puis balayé de gauche à droite.
  function wipe(drawBefore) {
    if (!source) return;
    if (!animated()) return draw();
    drawBefore?.();
    wipeCanvas.width = canvas.width;
    wipeCanvas.height = canvas.height;
    wipeCanvas.getContext("2d").drawImage(canvas, 0, 0);
    draw();
    cancelAnimationFrame(wipeFrame);
    media.dataset.wiping = "";
    const start = performance.now();
    (function step(now) {
      const t = Math.min((now - start) / 760, 1);
      media.style.setProperty("--wipe", `${(easeInOut(t) * 100).toFixed(2)}%`);
      if (t < 1) wipeFrame = requestAnimationFrame(step);
      else delete media.dataset.wiping;
    })(start);
  }
  function reveal() {
    revealed = true;
    wipe(() => draw({ bypass: true }));
  }

  function showCurrent() {
    const preset = presets.find(p => p.id === look);
    current.querySelector("i").style.setProperty("--swatch", preset.color);
    current.querySelector(".lab-current-name").textContent = preset.name;
    current.querySelector(".lab-current-category").textContent = preset.category;
    current.classList.remove("is-changing");
    void current.offsetWidth;
    current.classList.add("is-changing");
  }
  function setLook(id) {
    revealed = true;
    if (id === look) return;
    look = id;
    list.querySelectorAll(".lab-look").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.look === id)));
    showCurrent();
    wipe();
  }

  function setPosition(value) {
    position = value;
    media.style.setProperty("--lab-split", `${value}%`);
    if (split.value !== String(value)) split.value = String(value);
    split.setAttribute("aria-valuetext", `${Math.round(value)} % d’original`);
    draw();
  }
  function slideSplit(to, done) {
    cancelAnimationFrame(splitFrame);
    if (!animated()) { setPosition(to); return done?.(); }
    const from = position, start = performance.now();
    (function step(now) {
      const t = Math.min((now - start) / 560, 1);
      setPosition(from + (to - from) * easeInOut(t));
      if (t < 1) splitFrame = requestAnimationFrame(step);
      else done?.();
    })(start);
  }
  function setComparing(on) {
    comparing = on;
    revealed = true;
    compareButton.setAttribute("aria-pressed", String(on));
    if (on) {
      media.dataset.comparing = "";
      split.hidden = false;
      setPosition(0);
      slideSplit(50);
    } else {
      slideSplit(0, () => {
        if (comparing) return;
        delete media.dataset.comparing;
        split.hidden = true;
      });
    }
  }

  // Miniatures : la photo recadrée en 4:3, rendue avec chaque look, une après l’autre.
  async function paintThumbs() {
    const job = ++thumbJob;
    const tiles = [...list.querySelectorAll(".lab-look")];
    tiles.forEach(tile => tile.classList.remove("is-developed"));
    await seen;
    if (job !== thumbJob) return;
    if (!thumbs) return tiles.forEach(tile => tile.classList.add("is-developed"));
    const w = 320, h = 240, crop = document.createElement("canvas");
    crop.width = w; crop.height = h;
    const scale = Math.max(w / source.width, h / source.height), sw = w / scale, sh = h / scale;
    crop.getContext("2d").drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, w, h);
    for (const tile of tiles) {
      await wait(animated() ? 85 : 0);
      if (job !== thumbJob) return;
      thumbs.update({ ...presets.find(p => p.id === tile.dataset.look).settings, intensity: 100 });
      thumbs.render(crop, w, h, { seed: 1 });
      tile.querySelector("canvas").getContext("2d").drawImage(thumbs.canvas, 0, 0, w, h);
      tile.classList.add("is-developed");
    }
  }

  // La source est toujours un canevas réduit : une photo y est dessinée une fois, une vidéo à chaque image.
  function setSource(c, name, details) {
    const previous = source;
    source = c;
    try {
      draw({ bypass: true });
    } catch (error) {
      source = previous;
      throw error;
    }
    media.style.setProperty("--ar", (c.width / c.height).toFixed(4));
    fileName.textContent = name;
    fileName.title = name;
    fileSize.textContent = details;
    app.dataset.state = "ready";
    compareButton.disabled = false;
    paintThumbs();
    if (revealed) reveal();
    else seen.then(() => { if (!revealed) reveal(); });
  }
  function frameCanvas(width, height, max) {
    const scale = Math.min(1, max / Math.max(width, height));
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale); c.height = Math.round(height * scale);
    return c;
  }
  function useSource(image, width, height, name) {
    const c = frameCanvas(width, height, 1600);
    c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
    setSource(c, name, `${width} × ${height}`);
  }

  // Vidéo : lue en boucle et sans son ; chaque image passe par le moteur.
  let video = null, videoUrl = "", videoFrame = 0, pausedByUser = false, pausedByView = false, viewerVisible = true;
  function syncPlayButton() {
    playButton.hidden = !video;
    if (!video) return;
    const playing = !video.paused;
    playButton.querySelector("use").setAttribute("href", playing ? "#i-player-pause" : "#i-player-play");
    playButton.querySelector("span").textContent = playing ? "Pause" : "Lecture";
    playButton.setAttribute("aria-label", playing ? "Mettre la vidéo en pause" : "Lire la vidéo");
  }
  function videoTick() {
    videoFrame = 0;
    if (!video || video.paused) return;
    source.getContext("2d").drawImage(video, 0, 0, source.width, source.height);
    draw();
    videoFrame = requestAnimationFrame(videoTick);
  }
  function stopVideo() {
    cancelAnimationFrame(videoFrame);
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoUrl);
    video = null;
    syncPlayButton();
  }
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  async function openVideo(file) {
    const element = document.createElement("video");
    element.muted = true; element.loop = true; element.playsInline = true; element.preload = "auto";
    const url = URL.createObjectURL(file);
    element.src = url;
    try {
      await new Promise((resolve, reject) => {
        element.addEventListener("loadeddata", resolve, { once: true });
        element.addEventListener("error", reject, { once: true });
      });
      if (!element.videoWidth) throw new Error("vidéo sans image");
    } catch {
      URL.revokeObjectURL(url);
      return say("Votre navigateur ne lit pas cette vidéo. Essayez un MP4 (H.264) ou un WebM.");
    }
    stopVideo();
    video = element; videoUrl = url; pausedByUser = false; pausedByView = false;
    const c = frameCanvas(video.videoWidth, video.videoHeight, 1280);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    revealed = true;
    setSource(c, file.name, `${video.videoWidth} × ${video.videoHeight} · ${clock(video.duration || 0)}`);
    video.addEventListener("play", () => { cancelAnimationFrame(videoFrame); videoFrame = requestAnimationFrame(videoTick); syncPlayButton(); });
    video.addEventListener("pause", syncPlayButton);
    syncPlayButton();
    if (viewerVisible) video.play().catch(syncPlayButton);
    else pausedByView = true;
  }
  async function openFile(file) {
    if (!file || !/^(image|video)\//.test(file.type)) return say("Choisissez une photo ou une vidéo : JPG, PNG, WebP, MP4 ou WebM.");
    say("");
    if (file.type.startsWith("video/")) return openVideo(file);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      stopVideo();
      revealed = true;
      useSource(bitmap, bitmap.width, bitmap.height, file.name);
      bitmap.close?.();
    } catch {
      say("Votre navigateur ne lit pas ce format. Essayez un JPG, un PNG ou un WebP.");
    }
  }
  playButton.addEventListener("click", () => {
    if (!video) return;
    if (video.paused) { pausedByUser = false; video.play().catch(() => {}); }
    else { pausedByUser = true; video.pause(); }
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      viewerVisible = entry.isIntersecting;
      if (!video) return;
      if (!viewerVisible && !video.paused) { pausedByView = true; video.pause(); }
      else if (viewerVisible && pausedByView && !pausedByUser) { pausedByView = false; video.play().catch(() => {}); }
    }).observe(viewer);
  }

  function buildList() {
    for (const id of lookIds) {
      const preset = presets.find(p => p.id === id);
      if (!preset) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lab-look";
      button.dataset.look = id;
      button.title = preset.description;
      button.setAttribute("aria-pressed", String(id === look));
      button.innerHTML = `<span class="lab-thumb" style="--swatch:${preset.color}"><canvas width="320" height="240"></canvas></span><strong></strong><small></small>`;
      button.querySelector("strong").textContent = preset.name;
      button.querySelector("small").textContent = preset.category;
      button.addEventListener("click", () => setLook(id));
      list.append(button);
    }
  }
  function start() {
    if (renderer || !window.LumiEngine) return;
    presets = window.LumiEngine.presets;
    buildList();
    showCurrent();
    current.classList.remove("is-changing");
    try {
      renderer = new window.LumiEngine.ColorRenderer(canvas);
    } catch {
      app.dataset.state = "unsupported";
      app.querySelectorAll("button, input").forEach(el => { el.disabled = true; });
      list.querySelectorAll(".lab-look").forEach(tile => tile.classList.add("is-developed"));
      return say("Votre navigateur n’affiche pas WebGL 2. Téléchargez LumiLooks pour essayer les looks sur votre ordinateur.");
    }
    try { thumbs = new window.LumiEngine.ColorRenderer(document.createElement("canvas")); } catch { thumbs = null; }
    app.dataset.state = "empty";
    const sample = new Image();
    sample.src = "./assets/lab-sample.jpg";
    sample.decode().then(() => {
      if (app.dataset.state === "empty") useSource(sample, sample.naturalWidth, sample.naturalHeight, "lac-de-braies.jpg");
    }).catch(() => {});
  }

  fileInput.addEventListener("change", () => { openFile(fileInput.files[0]); fileInput.value = ""; });
  intensityInput.addEventListener("input", () => {
    intensity = Number(intensityInput.value);
    intensityOutput.textContent = `${intensity} %`;
    intensityInput.style.setProperty("--fill", `${intensity}%`);
    revealed = true;
    draw();
  });
  compareButton.addEventListener("click", () => setComparing(!comparing));
  split.addEventListener("input", () => { cancelAnimationFrame(splitFrame); setPosition(Number(split.value)); });
  app.addEventListener("dragover", event => { event.preventDefault(); app.classList.add("is-dragover"); });
  app.addEventListener("dragleave", event => { if (!app.contains(event.relatedTarget)) app.classList.remove("is-dragover"); });
  app.addEventListener("drop", event => {
    event.preventDefault();
    app.classList.remove("is-dragover");
    openFile(event.dataTransfer.files[0]);
  });
  if ("IntersectionObserver" in window) {
    const loader = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { start(); loader.disconnect(); }
    }, { rootMargin: "400px 0px" });
    loader.observe(section);
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { markSeen(); watcher.disconnect(); }
    }, { threshold: .45 });
    watcher.observe(viewer);
  } else {
    start();
    markSeen();
  }
})();

/* ---------- Pellicule de looks ---------- */
(function filmstrip() {
  const strip = document.querySelector(".filmstrip");
  const track = strip.querySelector(".filmstrip-track");
  const toggle = document.querySelector(".strip-toggle");
  const originals = [...track.children];
  function setup() {
    const animate = !reducedMotion.matches;
    track.querySelectorAll("[data-clone]").forEach(li => li.remove());
    strip.classList.toggle("is-animated", animate);
    toggle.hidden = !animate;
    if (!animate) return;
    for (const li of originals) {
      const clone = li.cloneNode(true);
      clone.dataset.clone = "";
      clone.setAttribute("aria-hidden", "true");
      track.append(clone);
    }
    strip.style.setProperty("--strip-duration", `${originals.length * 6}s`);
  }
  toggle.addEventListener("click", () => {
    const paused = strip.toggleAttribute("data-paused");
    toggle.querySelector("span").textContent = paused ? "Reprendre" : "Pause";
    toggle.querySelector("use").setAttribute("href", paused ? "#i-player-play" : "#i-player-pause");
    toggle.setAttribute("aria-label", paused ? "Reprendre le défilement des looks" : "Mettre en pause le défilement des looks");
  });
  reducedMotion.addEventListener("change", setup);
  setup();
})();

/* ---------- Atelier ---------- */
const gallery = document.querySelector("[data-gallery]");
const tabs = [...gallery.querySelectorAll("[data-gallery-tab]")];
const panels = [...gallery.querySelectorAll("[data-gallery-panel]")];
const tabList = gallery.querySelector(".gallery-tabs");
let selectedTab = 0;

function selectTab(index, focus = false) {
  selectedTab = index;
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panels[i].toggleAttribute("data-active", selected);
  });
  if (focus) tabs[index].focus();
  else if (tabList.scrollWidth > tabList.clientWidth) tabList.scrollTo({ left: tabs[index].offsetLeft - tabList.offsetLeft - 16, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

tabList.setAttribute("role", "tablist");
gallery.querySelector(".gallery-panels").setAttribute("data-enhanced", "");
tabs.forEach((tab, index) => {
  tab.id = `feature-tab-${index}`;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panels[index].id);
  panels[index].setAttribute("role", "tabpanel");
  panels[index].setAttribute("aria-labelledby", tab.id);
  tab.addEventListener("click", event => { event.preventDefault(); selectTab(index); });
  tab.addEventListener("keydown", event => {
    if (event.key === " ") { event.preventDefault(); selectTab(index); return; }
    let next;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(next, true);
  });
});
selectTab(Math.max(0, panels.findIndex(panel => `#${panel.id}` === location.hash)));

(function galleryTour() {
  if (!("IntersectionObserver" in window)) return;
  const toggle = document.querySelector(".gallery-toggle");
  const toggleIcon = toggle.querySelector("use");
  const toggleText = toggle.querySelector("span");
  let enabled = selectedTab === 0, inView = false, timer = 0;

  function updateControl() {
    toggle.hidden = reducedMotion.matches;
    toggleText.textContent = enabled ? "Pause" : "Lancer la visite";
    toggleIcon.setAttribute("href", enabled ? "#i-player-pause" : "#i-player-play");
    toggle.setAttribute("aria-label", enabled ? "Mettre en pause la visite de l’atelier" : "Lancer la visite de l’atelier");
  }
  function schedule() {
    clearTimeout(timer);
    gallery.toggleAttribute("data-touring", enabled && inView && !reducedMotion.matches && !document.hidden);
    if (!enabled || !inView || reducedMotion.matches || document.hidden) return;
    panels[(selectedTab + 1) % tabs.length].querySelector("img").loading = "eager";
    timer = setTimeout(() => { selectTab((selectedTab + 1) % tabs.length); schedule(); }, 7000);
  }
  function stop() { enabled = false; schedule(); updateControl(); }
  toggle.addEventListener("click", () => {
    if (enabled) return stop();
    enabled = true; updateControl(); schedule();
  });
  new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio >= .35; schedule(); }, { threshold: .35 }).observe(gallery);
  gallery.addEventListener("pointerdown", stop);
  gallery.addEventListener("focusin", stop);
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", () => { updateControl(); schedule(); });
  updateControl();
})();

/* ---------- Agrandissement des captures ---------- */
const dialog = document.querySelector(".image-dialog");
const enlarged = dialog.querySelector("img");
const imageViewer = dialog.querySelector(".image-viewer");
let opener = null;
for (const link of document.querySelectorAll("[data-zoom]")) {
  link.addEventListener("click", event => {
    if (typeof dialog.showModal !== "function" || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    opener = link;
    enlarged.src = link.href;
    enlarged.alt = link.querySelector("img").alt;
    dialog.showModal();
    imageViewer.scrollTo(0, 0);
  });
}
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener("close", () => opener?.focus());

/* ---------- Film : lecture muette quand il est visible ---------- */
(function playFilmInView() {
  if (!("IntersectionObserver" in window)) return;
  const film = document.querySelector(".film-section video");
  film.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(film.duration)) document.querySelector("#film-duration").textContent = `${Math.round(film.duration)} secondes`;
  });
  let inView = false, autoplay = true, startedByPage = false, pausedByPage = false;
  function syncPlayback() {
    if (!autoplay) return;
    if (!inView || document.hidden || reducedMotion.matches) {
      if (startedByPage && !film.paused) { pausedByPage = true; film.pause(); }
    } else if (film.paused && !film.ended && film.muted) {
      startedByPage = true;
      film.play().catch(() => { startedByPage = false; });
    }
  }
  new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio >= .5; syncPlayback(); }, { threshold: .5 }).observe(film);
  film.addEventListener("play", () => { if (!startedByPage) autoplay = false; });
  film.addEventListener("pause", () => { if (!pausedByPage) autoplay = false; pausedByPage = false; });
  film.addEventListener("volumechange", () => { if (!film.muted) autoplay = false; });
  document.addEventListener("visibilitychange", syncPlayback);
  reducedMotion.addEventListener("change", syncPlayback);
})();

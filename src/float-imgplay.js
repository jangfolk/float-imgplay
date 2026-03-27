/*!
 * FloatImgPlay v1.0.0
 * Image-to-sound player. Scans pixel data and generates rule-based music via Web Audio API.
 * class-based / drop-in usage
 */

export class FloatImgPlay {
  constructor(options = {}) {
    this.options = this._mergeDeep(this._defaults(), options);
    this.instances = new Map();
    this.audioCtx = null;
    this.globalUnlocked = false;

    this._boundUnlock = this._unlockAudio.bind(this);
    this._boundOnVisibilityChange = this._onDocumentVisibilityChange.bind(this);
    this._boundTick = this._throttle(this._tickVisibility.bind(this), 120);
  }

  init() {
    this._bindGlobalUnlock();
    document.addEventListener("visibilitychange", this._boundOnVisibilityChange, { passive: true });
    window.addEventListener("scroll", this._boundTick, { passive: true });
    window.addEventListener("resize", this._boundTick, { passive: true });

    const nodes = Array.from(document.querySelectorAll(this.options.selector));
    nodes.forEach((el) => this.register(el));
    this._tickVisibility();
    return this;
  }

  destroy() {
    document.removeEventListener("visibilitychange", this._boundOnVisibilityChange);
    window.removeEventListener("scroll", this._boundTick);
    window.removeEventListener("resize", this._boundTick);
    this.instances.forEach((inst) => this.unregister(inst.el));
    this.instances.clear();
  }

  register(el, perElementOptions = {}) {
    if (!el || this.instances.has(el)) return;

    const opts = this._mergeDeep(this._clone(this.options), perElementOptions);
    const source = this._resolveSource(el);
    if (!source) return;

    const inst = {
      el,
      opts,
      source,
      isPlaying: false,
      hasRenderedUI: false,
      isVisibleInViewport: false,
      isActuallyVisible: false,
      isDocVisible: document.visibilityState === "visible",
      pendingAutoplay: false,
      activeNodes: [],
      stopTimerIds: [],
      currentScore: null,
      currentMeta: null,
      observer: null,
      ui: null,
    };

    this._buildUI(inst);
    this._prepareAnalysis(inst);
    this._bindInstanceEvents(inst);
    this._setupIntersectionObserver(inst);

    this.instances.set(el, inst);

    if (inst.opts.autoplay) {
      inst.pendingAutoplay = true;
      this._maybeAutoplay(inst);
    }
  }

  unregister(el) {
    const inst = this.instances.get(el);
    if (!inst) return;

    this.stop(el);

    if (inst.observer) inst.observer.disconnect();

    if (inst.ui?.playBtn) inst.ui.playBtn.removeEventListener("click", inst._onPlayClick);
    if (inst.ui?.volumeInput) inst.ui.volumeInput.removeEventListener("input", inst._onVolumeInput);
    if (inst.el) inst.el.removeEventListener("click", inst._onElClick);

    if (inst.ui?.root && inst.ui.root.parentNode) {
      inst.ui.root.parentNode.removeChild(inst.ui.root);
    }

    this.instances.delete(el);
  }

  play(target) {
    const inst = this._getInstance(target);
    if (!inst) return;
    this._playInstance(inst);
  }

  stop(target) {
    const inst = this._getInstance(target);
    if (!inst) return;
    this._stopInstance(inst);
  }

  pause(target) {
    this.stop(target);
  }

  refresh() {
    this.instances.forEach((inst) => {
      inst.source = this._resolveSource(inst.el) || inst.source;
      this._prepareAnalysis(inst);
    });
    this._tickVisibility();
  }

  _defaults() {
    return {
      selector: ".float-imgplay",
      autoplay: false,
      autoplayWhenVisibleOnly: true,
      stopWhenHidden: true,
      showPlayOverlay: true,
      showVolumeControl: true,
      overlayIcon: "\u25B6",
      overlayPlayText: "",
      occlusionSamplePoints: [
        [0.5, 0.5],
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
        [0.8, 0.8]
      ],
      visibilityThreshold: 0.25,
      zIndexUI: 12,
      classNames: {
        initialized: "float-imgplay--ready",
        playing: "float-imgplay--playing",
        paused: "float-imgplay--paused",
        ui: "float-imgplay-ui",
        playBtn: "float-imgplay-play",
        volumeWrap: "float-imgplay-volume",
        volumeInput: "float-imgplay-volume-input"
      },
      audio: {
        masterVolume: 0.25,
        pitchShiftSemitones: 0,
        waveform: "triangle",
        tempo: 100,
        noteDurationBeats: 0.5,
        restThreshold: 28,
        sampleColumns: 24,
        sampleRows: [0.25, 0.5, 0.75],
        filterType: "lowpass",
        filterBaseHz: 900,
        filterVelocityAmount: 3000,
        attack: 0.02,
        release: 0.03,
        scaleMode: "auto",
        rootMode: "filename-first-char",
        fixedRootMidi: 60,
        octaveContrastThreshold: 100,
        octaveShiftSemitones: 12,
        brightDuration: 0.26,
        blueDuration: 0.46,
        neutralDuration: 0.34
      }
    };
  }

  _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  _mergeDeep(target, source) {
    const out = Array.isArray(target) ? [...target] : { ...target };
    if (!source || typeof source !== "object") return out;

    Object.keys(source).forEach((key) => {
      const sv = source[key];
      const tv = out[key];
      if (Array.isArray(sv)) {
        out[key] = [...sv];
      } else if (sv && typeof sv === "object") {
        out[key] = this._mergeDeep(tv && typeof tv === "object" ? tv : {}, sv);
      } else {
        out[key] = sv;
      }
    });
    return out;
  }

  _bindGlobalUnlock() {
    ["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
      window.addEventListener(evt, this._boundUnlock, { passive: true, once: false });
    });
  }

  async _unlockAudio() {
    try {
      const ctx = this._ensureAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      this.globalUnlocked = true;
      this.instances.forEach((inst) => {
        if (inst.pendingAutoplay) this._maybeAutoplay(inst);
      });
    } catch (err) {
      console.warn("[FloatImgPlay] Audio unlock failed:", err);
    }
  }

  _ensureAudioContext() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AC();
    }
    return this.audioCtx;
  }

  _resolveSource(el) {
    if (!el) return null;

    if (el.tagName === "IMG" && el.currentSrc || el.tagName === "IMG" && el.src) {
      const src = el.currentSrc || el.src;
      return { type: "img", url: src, fileName: this._fileNameFromUrl(src), imgEl: el };
    }

    const childImg = el.querySelector("img");
    if (childImg && (childImg.currentSrc || childImg.src)) {
      const src = childImg.currentSrc || childImg.src;
      return { type: "img-child", url: src, fileName: this._fileNameFromUrl(src), imgEl: childImg };
    }

    const bg = getComputedStyle(el).backgroundImage;
    const url = this._extractCssUrl(bg);
    if (url) {
      return { type: "background", url, fileName: this._fileNameFromUrl(url), imgEl: null };
    }

    return null;
  }

  _extractCssUrl(bgValue) {
    if (!bgValue || bgValue === "none") return null;
    const m = bgValue.match(/url\((['"]?)(.*?)\1\)/i);
    return m ? m[2] : null;
  }

  _fileNameFromUrl(url) {
    try {
      const clean = url.split("?")[0].split("#")[0];
      return clean.substring(clean.lastIndexOf("/") + 1) || "image";
    } catch {
      return "image";
    }
  }

  _buildUI(inst) {
    if (inst.hasRenderedUI) return;

    const { classNames, showPlayOverlay, showVolumeControl, overlayIcon, overlayPlayText, zIndexUI, audio } = inst.opts;
    const el = inst.el;

    const currentPosition = getComputedStyle(el).position;
    if (currentPosition === "static") {
      el.style.position = "relative";
    }
    el.style.overflow = el.style.overflow || "hidden";

    const uiRoot = document.createElement("div");
    uiRoot.className = classNames.ui;
    Object.assign(uiRoot.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: String(zIndexUI)
    });

    let playBtn = null;
    if (showPlayOverlay) {
      playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = classNames.playBtn;
      playBtn.setAttribute("aria-label", "Play image audio");
      this._setPlayBtnContent(playBtn, overlayIcon, overlayPlayText);
      Object.assign(playBtn.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "auto",
        border: "0",
        borderRadius: "999px",
        padding: "12px 16px",
        fontSize: "18px",
        lineHeight: "1",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        backdropFilter: "blur(10px)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "56px",
        minHeight: "56px"
      });
      uiRoot.appendChild(playBtn);
    }

    let volumeWrap = null;
    let volumeInput = null;
    if (showVolumeControl) {
      volumeWrap = document.createElement("div");
      volumeWrap.className = classNames.volumeWrap;
      Object.assign(volumeWrap.style, {
        position: "absolute",
        right: "10px",
        bottom: "10px",
        pointerEvents: "auto",
        background: "rgba(0,0,0,0.48)",
        color: "#fff",
        padding: "8px 10px",
        borderRadius: "14px",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        gap: "8px"
      });

      const label = document.createElement("span");
      label.textContent = "\u{1F50A}";
      label.style.fontSize = "12px";

      volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "1";
      volumeInput.step = "0.01";
      volumeInput.value = String(audio.masterVolume);
      volumeInput.className = classNames.volumeInput;
      volumeInput.style.width = "88px";

      volumeWrap.appendChild(label);
      volumeWrap.appendChild(volumeInput);
      uiRoot.appendChild(volumeWrap);
    }

    el.classList.add(classNames.initialized);
    el.appendChild(uiRoot);

    inst.ui = { root: uiRoot, playBtn, volumeWrap, volumeInput };
    inst.hasRenderedUI = true;
  }

  // Sets play button content using safe DOM methods.
  // overlayIcon and overlayPlayText are developer-configured options
  // (defaults to Unicode characters), not user-supplied input.
  _setPlayBtnContent(btn, icon, playText) {
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    const iconSpan = document.createElement("span");
    iconSpan.textContent = icon;
    btn.appendChild(iconSpan);
    if (playText) {
      const textSpan = document.createElement("span");
      textSpan.style.marginLeft = "8px";
      textSpan.textContent = playText;
      btn.appendChild(textSpan);
    }
  }

  _setPauseBtnContent(btn) {
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    const iconSpan = document.createElement("span");
    iconSpan.textContent = "\u275A\u275A";
    btn.appendChild(iconSpan);
  }

  _bindInstanceEvents(inst) {
    inst._onPlayClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (inst.isPlaying) {
        this._stopInstance(inst);
      } else {
        this._playInstance(inst);
      }
    };

    inst._onElClick = (e) => {
      if (inst.ui?.volumeInput && (e.target === inst.ui.volumeInput || inst.ui.volumeWrap?.contains(e.target))) {
        return;
      }
      if (!inst.ui?.playBtn) {
        if (inst.isPlaying) this._stopInstance(inst);
        else this._playInstance(inst);
      }
    };

    inst._onVolumeInput = (e) => {
      const v = Number(e.target.value);
      inst.opts.audio.masterVolume = v;
    };

    if (inst.ui?.playBtn) inst.ui.playBtn.addEventListener("click", inst._onPlayClick);
    if (inst.ui?.volumeInput) inst.ui.volumeInput.addEventListener("input", inst._onVolumeInput);
    inst.el.addEventListener("click", inst._onElClick);
  }

  _setupIntersectionObserver(inst) {
    if (!("IntersectionObserver" in window)) {
      inst.isVisibleInViewport = true;
      return;
    }

    inst.observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      inst.isVisibleInViewport = !!entry && entry.isIntersecting && entry.intersectionRatio >= inst.opts.visibilityThreshold;
      this._tickSingle(inst);
    }, {
      root: null,
      threshold: [0, inst.opts.visibilityThreshold, 0.5, 0.75, 1]
    });

    inst.observer.observe(inst.el);
  }

  _prepareAnalysis(inst) {
    this._analyzeSource(inst).then(({ score, meta }) => {
      inst.currentScore = score;
      inst.currentMeta = meta;
    }).catch((err) => {
      console.warn("[FloatImgPlay] analyze failed:", err);
    });
  }

  async _analyzeSource(inst) {
    const img = await this._loadImage(inst.source.url);
    const { score, meta } = this._analyzeImage(img, inst.source.fileName, inst.opts.audio);
    return { score, meta };
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  _analyzeImage(img, fileName, audioOpts) {
    const maxSize = 64;
    let w = img.width;
    let h = img.height;

    if (w > h) {
      h = Math.max(1, Math.round(h * (maxSize / w)));
      w = maxSize;
    } else {
      w = Math.max(1, Math.round(w * (maxSize / h)));
      h = maxSize;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const avg = this._averageRGB(data);

    const scale = this._getScale(audioOpts.scaleMode, avg);
    const rootMidi = audioOpts.rootMode === "fixed"
      ? audioOpts.fixedRootMidi
      : this._charToKey((fileName?.[0] || "c").toLowerCase());

    const rows = (audioOpts.sampleRows || [0.25, 0.5, 0.75]).map(v => Math.max(0, Math.min(h - 1, Math.floor(h * v))));
    const step = Math.max(1, Math.floor(w / Math.max(1, audioOpts.sampleColumns)));
    const notes = [];

    for (let x = 0; x < w; x += step) {
      let rr = 0, gg = 0, bb = 0;

      for (const y of rows) {
        const idx = (y * w + x) * 4;
        rr += data[idx];
        gg += data[idx + 1];
        bb += data[idx + 2];
      }

      rr /= rows.length;
      gg /= rows.length;
      bb /= rows.length;

      const brightness = (rr + gg + bb) / 3;
      const saturation = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
      const contrastish = Math.abs(rr - bb);

      const scaleIndex = Math.floor((brightness / 255) * (scale.length - 1));
      const octaveShift = contrastish > audioOpts.octaveContrastThreshold ? audioOpts.octaveShiftSemitones : 0;
      const midi = rootMidi + scale[scaleIndex] + octaveShift + audioOpts.pitchShiftSemitones;

      let duration = audioOpts.neutralDuration;
      if (bb > rr && bb > gg) duration = audioOpts.blueDuration;
      else if (rr > bb && rr > gg) duration = audioOpts.brightDuration;

      const velocity = this._clamp(0.08 + (saturation / 255) * 0.22, 0.08, 0.36);
      const isRest = brightness < audioOpts.restThreshold;

      notes.push({
        midi,
        freq: this._midiToFreq(midi),
        durationSeconds: this._beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo) * (duration / audioOpts.neutralDuration),
        velocity,
        isRest
      });
    }

    return {
      meta: {
        fileName,
        avg,
        scale,
        rootMidi
      },
      score: notes
    };
  }

  _averageRGB(data) {
    let r = 0, g = 0, b = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / total, g: g / total, b: b / total };
  }

  _getScale(mode, avg) {
    if (mode === "major") return [0, 2, 4, 5, 7, 9, 11, 12];
    if (mode === "minor") return [0, 2, 3, 5, 7, 8, 10, 12];
    if (mode === "pentatonic") return [0, 3, 5, 7, 10, 12];

    if (avg.r > avg.b + 20) return [0, 2, 4, 5, 7, 9, 11, 12];
    if (avg.b > avg.r + 20) return [0, 2, 3, 5, 7, 8, 10, 12];
    return [0, 3, 5, 7, 10, 12];
  }

  _charToKey(letter) {
    const map = {
      a: 60, b: 62, c: 64, d: 65, e: 67, f: 69, g: 71,
      h: 60, i: 62, j: 64, k: 65, l: 67, m: 69, n: 71,
      o: 60, p: 62, q: 63, r: 65, s: 67, t: 68, u: 70,
      v: 72, w: 61, x: 63, y: 66, z: 68
    };
    return map[letter] ?? 60;
  }

  _beatsToSeconds(beats, tempo) {
    return (60 / tempo) * beats;
  }

  _midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  async _playInstance(inst) {
    if (!inst.currentScore || !inst.currentMeta) {
      await this._prepareAnalysis(inst);
      if (!inst.currentScore) return;
    }

    const ctx = this._ensureAudioContext();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }

    if (inst.opts.autoplayWhenVisibleOnly && !this._canPlayNow(inst)) {
      inst.pendingAutoplay = true;
      return;
    }

    this._stopInstance(inst);

    const now = ctx.currentTime + 0.03;
    let t = now;
    const nodes = [];
    const timers = [];

    inst.currentScore.forEach((note) => {
      const totalVol = inst.opts.audio.masterVolume;
      const waveType = inst.opts.audio.waveform;
      const attack = inst.opts.audio.attack;
      const release = inst.opts.audio.release;
      const filterBaseHz = inst.opts.audio.filterBaseHz;
      const filterVelocityAmount = inst.opts.audio.filterVelocityAmount;
      const filterType = inst.opts.audio.filterType;

      if (!note.isRest) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = waveType;
        osc.frequency.setValueAtTime(note.freq, t);

        filter.type = filterType;
        filter.frequency.setValueAtTime(filterBaseHz + note.velocity * filterVelocityAmount, t);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.velocity * totalVol), t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, note.durationSeconds));

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + note.durationSeconds + release);

        nodes.push(osc, gain, filter);
      }

      t += note.durationSeconds + 0.02;
    });

    const totalDuration = Math.max(0, t - now);
    const timerId = window.setTimeout(() => {
      inst.isPlaying = false;
      inst.el.classList.remove(inst.opts.classNames.playing);
      inst.el.classList.add(inst.opts.classNames.paused);
      if (inst.ui?.playBtn) this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
    }, totalDuration * 1000 + 50);

    timers.push(timerId);
    inst.activeNodes = nodes;
    inst.stopTimerIds = timers;
    inst.isPlaying = true;
    inst.pendingAutoplay = false;
    inst.el.classList.add(inst.opts.classNames.playing);
    inst.el.classList.remove(inst.opts.classNames.paused);

    if (inst.ui?.playBtn) {
      this._setPauseBtnContent(inst.ui.playBtn);
    }
  }

  _stopInstance(inst) {
    inst.stopTimerIds.forEach((id) => clearTimeout(id));
    inst.stopTimerIds = [];

    inst.activeNodes.forEach((node) => {
      try {
        if (typeof node.stop === "function") node.stop(0);
      } catch {}
      try {
        if (typeof node.disconnect === "function") node.disconnect();
      } catch {}
    });

    inst.activeNodes = [];
    inst.isPlaying = false;

    inst.el.classList.remove(inst.opts.classNames.playing);
    inst.el.classList.add(inst.opts.classNames.paused);

    if (inst.ui?.playBtn) {
      this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
    }
  }

  _onDocumentVisibilityChange() {
    this.instances.forEach((inst) => {
      inst.isDocVisible = document.visibilityState === "visible";
      if (inst.opts.stopWhenHidden && !inst.isDocVisible) {
        this._stopInstance(inst);
      } else {
        this._tickSingle(inst);
      }
    });
  }

  _tickVisibility() {
    this.instances.forEach((inst) => this._tickSingle(inst));
  }

  _tickSingle(inst) {
    inst.isActuallyVisible = this._isActuallyVisible(inst);

    if (inst.opts.stopWhenHidden && inst.isPlaying && !inst.isActuallyVisible) {
      this._stopInstance(inst);
    }

    if (inst.pendingAutoplay) {
      this._maybeAutoplay(inst);
    }
  }

  _maybeAutoplay(inst) {
    if (!inst.opts.autoplay) return;
    if (!this.globalUnlocked) return;
    if (!this._canPlayNow(inst)) return;
    this._playInstance(inst);
  }

  _canPlayNow(inst) {
    if (!inst.isDocVisible && inst.opts.stopWhenHidden) return false;
    if (inst.opts.autoplayWhenVisibleOnly && !inst.isActuallyVisible) return false;
    return true;
  }

  _isActuallyVisible(inst) {
    const el = inst.el;
    if (!el || !document.documentElement.contains(el)) return false;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (document.visibilityState !== "visible") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    if (!inst.isVisibleInViewport) return false;

    return this._isTopMostEnough(el, rect, inst.opts.occlusionSamplePoints);
  }

  _isTopMostEnough(el, rect, samplePoints) {
    let visibleHits = 0;
    let total = 0;

    for (const [rx, ry] of samplePoints) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;

      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      total++;

      const top = document.elementFromPoint(x, y);
      if (!top) continue;

      if (top === el || el.contains(top) || top.contains(el)) {
        visibleHits++;
      }
    }

    if (total === 0) return false;
    return (visibleHits / total) >= 0.4;
  }

  _getInstance(target) {
    if (!target) return null;
    if (this.instances.has(target)) return this.instances.get(target);
    if (typeof target === "string") {
      const el = document.querySelector(target);
      return el ? this.instances.get(el) : null;
    }
    return null;
  }

  _throttle(fn, wait) {
    let last = 0;
    let timeout = null;
    let lastArgs = null;

    return (...args) => {
      const now = Date.now();
      lastArgs = args;

      const invoke = () => {
        last = now;
        timeout = null;
        fn(...lastArgs);
      };

      if (now - last >= wait) {
        invoke();
      } else if (!timeout) {
        timeout = setTimeout(invoke, wait - (now - last));
      }
    };
  }
}

export default FloatImgPlay;

/*!
 * FloatImgPlay v2.0.0
 * Image-to-sound player. Scans pixel data and generates rule-based music via Web Audio API.
 * Modular architecture with Engine interface and Mode Router.
 */

import { mergeDeep, clone, throttle, fileNameFromUrl, extractCssUrl } from "./utils/helpers.js";
import { ImageEngine } from "./engines/image-engine.js";
import { MidiEngine } from "./engines/midi-engine.js";
import { AudioEngine } from "./engines/audio-engine.js";
import { MetaParser } from "./parsers/meta-parser.js";
export { ImageEngine, MidiEngine, AudioEngine, MetaParser };

export class FloatImgPlay {
  constructor(options = {}) {
    this.options = mergeDeep(this._defaults(), options);
    this.instances = new Map();
    this.audioCtx = null;
    this.globalUnlocked = false;

    this.engines = {
      midi: new MidiEngine(),
      audio: new AudioEngine(),
      image: new ImageEngine()
    };

    this._boundUnlock = this._unlockAudio.bind(this);
    this._boundOnVisibilityChange = this._onDocumentVisibilityChange.bind(this);
    this._boundTick = throttle(this._tickVisibility.bind(this), 120);
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

    const opts = mergeDeep(clone(this.options), perElementOptions);
    const source = this._resolveSource(el);
    if (!source) return;

    const meta = MetaParser.parse(source);
    const engine = this._resolveEngine(source, meta);

    const inst = {
      el,
      opts,
      source,
      meta,
      engine,
      isPlaying: false,
      hasRenderedUI: false,
      isVisibleInViewport: false,
      isActuallyVisible: false,
      isDocVisible: document.visibilityState === "visible",
      pendingAutoplay: false,
      playHandle: null,
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

    // Async meta parse — may upgrade engine if meta found
    MetaParser.parseAsync(source).then((asyncMeta) => {
      if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
        inst.meta = asyncMeta;
        inst.engine = this._resolveEngine(source, asyncMeta);
        if (asyncMeta.engine) {
          inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
        }
        this._prepareAnalysis(inst);
      }
    }).catch(() => {});

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
      inst.meta = MetaParser.parse(inst.source);
      inst.engine = this._resolveEngine(inst.source, inst.meta);
      this._prepareAnalysis(inst);

      MetaParser.parseAsync(inst.source).then((asyncMeta) => {
        if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
          inst.meta = asyncMeta;
          inst.engine = this._resolveEngine(inst.source, asyncMeta);
          if (asyncMeta.engine) {
            inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
          }
          this._prepareAnalysis(inst);
        }
      }).catch(() => {});
    });
    this._tickVisibility();
  }

  // --- Mode Router ---

  _resolveEngine(source, meta) {
    if (this.engines.midi.canHandle(source, meta)) return this.engines.midi;
    if (this.engines.audio.canHandle(source, meta)) return this.engines.audio;
    return this.engines.image;
  }

  // --- Defaults ---

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

  // --- Audio Context ---

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

  // --- Source Resolution ---

  _resolveSource(el) {
    if (!el) return null;

    if (el.tagName === "IMG" && el.currentSrc || el.tagName === "IMG" && el.src) {
      const src = el.currentSrc || el.src;
      return { type: "img", url: src, fileName: fileNameFromUrl(src), imgEl: el };
    }

    const childImg = el.querySelector("img");
    if (childImg && (childImg.currentSrc || childImg.src)) {
      const src = childImg.currentSrc || childImg.src;
      return { type: "img-child", url: src, fileName: fileNameFromUrl(src), imgEl: childImg };
    }

    const bg = getComputedStyle(el).backgroundImage;
    const url = extractCssUrl(bg);
    if (url) {
      return { type: "background", url, fileName: fileNameFromUrl(url), imgEl: null };
    }

    return null;
  }

  // --- Analysis (delegates to engine) ---

  _prepareAnalysis(inst) {
    inst.engine.analyze(inst.source, inst.opts.audio).then(({ score, meta }) => {
      inst.currentScore = score;
      inst.currentMeta = meta;
    }).catch((err) => {
      console.warn("[FloatImgPlay] analyze failed:", err);
    });
  }

  // --- Play / Stop (delegates to engine) ---

  async _playInstance(inst) {
    if (!inst.currentScore || !inst.currentMeta) {
      try {
        const result = await inst.engine.analyze(inst.source, inst.opts.audio);
        inst.currentScore = result.score;
        inst.currentMeta = result.meta;
      } catch {
        return;
      }
    }

    const ctx = this._ensureAudioContext();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }

    if (inst.opts.autoplayWhenVisibleOnly && !this._canPlayNow(inst)) {
      inst.pendingAutoplay = true;
      return;
    }

    // MidiEngine: fetch/parse MIDI before play
    if (inst.engine instanceof MidiEngine && inst.meta?.midi && !inst.currentScore?.notes) {
      try {
        let parsed;
        if (inst.meta.midi.data) {
          parsed = MidiEngine.parseBase64(inst.meta.midi.data);
        } else if (inst.meta.midi.url) {
          parsed = await MidiEngine.fetchAndParse(inst.meta.midi.url);
        }
        if (parsed) inst.currentScore = parsed;
      } catch (err) {
        console.warn("[FloatImgPlay] MIDI parse failed:", err);
        return;
      }
    }

    // AudioEngine: fetch and decode audio buffer before play
    if (inst.engine instanceof AudioEngine && inst.meta?.audio?.url && !inst.currentScore?.audioBuffer) {
      try {
        const audioBuffer = await AudioEngine.fetchAndDecode(inst.meta.audio.url, ctx);
        inst.currentScore = { audioBuffer, audioUrl: inst.meta.audio.url };
      } catch (err) {
        console.warn("[FloatImgPlay] Audio fetch failed:", err);
        return;
      }
    }

    this._stopInstance(inst);

    const handle = inst.engine.play(inst.currentScore, ctx, inst.opts.audio);
    inst.playHandle = handle;

    const timerId = window.setTimeout(() => {
      inst.isPlaying = false;
      inst.el.classList.remove(inst.opts.classNames.playing);
      inst.el.classList.add(inst.opts.classNames.paused);
      if (inst.ui?.playBtn) this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
    }, handle.totalDuration * 1000 + 50);

    if (!handle.timers) handle.timers = [];
    handle.timers.push(timerId);

    inst.isPlaying = true;
    inst.pendingAutoplay = false;
    inst.el.classList.add(inst.opts.classNames.playing);
    inst.el.classList.remove(inst.opts.classNames.paused);

    if (inst.ui?.playBtn) {
      this._setPauseBtnContent(inst.ui.playBtn);
    }
  }

  _stopInstance(inst) {
    if (inst.playHandle) {
      inst.engine.stop(inst.playHandle);
      inst.playHandle = null;
    }

    inst.isPlaying = false;
    inst.el.classList.remove(inst.opts.classNames.playing);
    inst.el.classList.add(inst.opts.classNames.paused);

    if (inst.ui?.playBtn) {
      this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
    }
  }

  // --- UI ---

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

  // --- Events ---

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

  // --- Visibility ---

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

  // --- Instance lookup ---

  _getInstance(target) {
    if (!target) return null;
    if (this.instances.has(target)) return this.instances.get(target);
    if (typeof target === "string") {
      const el = document.querySelector(target);
      return el ? this.instances.get(el) : null;
    }
    return null;
  }
}

export default FloatImgPlay;

/*!
 * Float:ImgPlay v2.0.0 — Modular Architecture
 * Image-to-sound player. Scans pixel data and generates rule-based music via Web Audio API.
 * Modular architecture with Engine interface and Mode Router.
 */

import { mergeDeep, clone, throttle, fileNameFromUrl, extractCssUrl } from "./utils/helpers.js";
import { ImageEngine } from "./engines/image-engine.js";
import { MidiEngine } from "./engines/midi-engine.js";
import { AudioEngine } from "./engines/audio-engine.js";
import { MetaParser } from "./parsers/meta-parser.js";
import { MidiExport } from "./export/midi-export.js";
import { MetaEmbed } from "./embed/meta-embed.js";
import { INSTRUMENT_PRESETS, ENSEMBLE_PRESETS, resolveInstrument, resolveEnsemble } from "./instruments/presets.js";
import { ALGORITHMS, getAlgorithm, registerAlgorithm } from "./algorithms/index.js";
export { ImageEngine, MidiEngine, AudioEngine, MetaParser, MidiExport, MetaEmbed };
export { INSTRUMENT_PRESETS, ENSEMBLE_PRESETS, resolveInstrument, resolveEnsemble };
export { ALGORITHMS, getAlgorithm, registerAlgorithm };

export class FloatImgPlay {
  constructor(options = {}) {
    this.options = mergeDeep(this._defaults(), options);
    this._resolveInstruments();
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
    if (inst.ui?.speedInput) inst.ui.speedInput.removeEventListener("input", inst._onSpeedInput);
    if (inst.ui?.settingsBtn) inst.ui.settingsBtn.removeEventListener("click", inst._onSettingsClick);
    if (inst.ui?.loopBtn) inst.ui.loopBtn.removeEventListener("click", inst._onLoopClick);
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

  playAll() {
    this.instances.forEach((inst) => {
      this._playInstance(inst);
    });
    return this;
  }

  stopAll() {
    this.instances.forEach((inst) => {
      this._stopInstance(inst);
    });
    return this;
  }

  exportConfig() {
    const config = {
      version: "2.0.0",
      type: "float-imgplay-config",
      audio: { ...this.options.audio },
      instrument: null,
      ensemble: null,
      algorithm: this.options.audio.algorithm || "rgba-digit"
    };

    // Remove internal _instruments from export
    delete config.audio._instruments;

    if (this.options.ensemble) {
      config.ensemble = this.options.ensemble;
    } else if (this.options.instruments && this.options.instruments.length > 0) {
      config.instrument = this.options.instruments;
    }

    return config;
  }

  importConfig(config) {
    if (!config || config.type !== "float-imgplay-config") {
      console.warn("[Float:ImgPlay] Invalid config format");
      return this;
    }

    // Apply audio settings
    if (config.audio) {
      Object.keys(config.audio).forEach((key) => {
        if (key !== "_instruments") {
          this.options.audio[key] = config.audio[key];
        }
      });
    }

    // Apply algorithm
    if (config.algorithm) {
      this.options.audio.algorithm = config.algorithm;
    }

    // Apply instrument/ensemble
    if (config.ensemble) {
      this.options.ensemble = config.ensemble;
      this.options.instruments = null;
    } else if (config.instrument) {
      this.options.instruments = config.instrument;
      this.options.ensemble = null;
    }

    // Re-resolve instruments
    this._resolveInstruments();

    // Re-analyze all instances
    this.instances.forEach((inst) => {
      inst.opts.audio = { ...this.options.audio };
      if (this.options.audio._instruments) {
        inst.opts.audio._instruments = this.options.audio._instruments;
      }
      this._stopInstance(inst);
      inst.currentScore = null;
      inst.currentMeta = null;
      this._prepareAnalysis(inst);
    });

    return this;
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
      showSpeedControl: false,
      showSettingsButton: false,
      showLoopButton: false,
      loop: false,
      clickToPlay: true,
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
        volumeInput: "float-imgplay-volume-input",
        speedWrap: "float-imgplay-speed",
        speedInput: "float-imgplay-speed-input",
        settingsBtn: "float-imgplay-settings",
        settingsPopup: "float-imgplay-settings-popup"
      },
      audio: {
        algorithm: "rgba-digit",
        masterVolume: 0.25,
        pitchShiftSemitones: 0,
        waveform: "triangle",
        tempo: 100,
        noteDurationBeats: 0.5,
        restThreshold: 28,
        sampleColumns: 0, // 0 = auto (scales with image width)
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
      },
      security: {
        allowedDomains: [],
        maxFileSize: 10485760,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"]
      }
    };
  }

  // --- Instrument Resolution ---

  _resolveInstruments() {
    const opts = this.options;

    // Priority: ensemble > instruments > audio (single, backward compat)
    if (opts.ensemble) {
      try {
        opts.audio._instruments = resolveEnsemble(opts.ensemble);
      } catch {
        opts.audio._instruments = null;
      }
    } else if (opts.instruments && opts.instruments.length > 0) {
      try {
        opts.audio._instruments = opts.instruments.map(resolveInstrument);
      } catch {
        opts.audio._instruments = null;
      }
    } else {
      opts.audio._instruments = null;
    }
  }

  // --- Security ---

  _checkUrlAllowed(url) {
    const domains = this.options.security?.allowedDomains;
    if (!domains || domains.length === 0) return true;
    try {
      const parsed = new URL(url, window.location.href);
      return domains.some((d) => parsed.hostname === d || parsed.hostname.endsWith("." + d));
    } catch {
      return false;
    }
  }

  _checkMimeType(mimeType) {
    const allowed = this.options.security?.allowedMimeTypes;
    if (!allowed || allowed.length === 0) return true;
    if (!mimeType) return false;
    const normalized = mimeType.split(";")[0].trim().toLowerCase();
    return allowed.some((t) => t.toLowerCase() === normalized);
  }

  async _checkResourceSecurity(url) {
    const maxSize = this.options.security?.maxFileSize;
    const allowedMimes = this.options.security?.allowedMimeTypes;
    if ((!maxSize || maxSize <= 0) && (!allowedMimes || allowedMimes.length === 0)) return true;

    try {
      const res = await fetch(url, { method: "HEAD", mode: "cors" });
      if (!res.ok) return true; // let the actual fetch handle the error

      if (maxSize && maxSize > 0) {
        const contentLength = res.headers.get("content-length");
        if (contentLength && Number(contentLength) > maxSize) {
          console.warn("[Float:ImgPlay] File exceeds maxFileSize (" + maxSize + " bytes):", url);
          return false;
        }
      }

      if (allowedMimes && allowedMimes.length > 0) {
        const contentType = res.headers.get("content-type");
        if (contentType && !this._checkMimeType(contentType)) {
          console.warn("[Float:ImgPlay] MIME type not allowed (" + contentType + "):", url);
          return false;
        }
      }

      return true;
    } catch {
      return true; // allow if HEAD fails (CORS, etc.)
    }
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
      console.warn("[Float:ImgPlay] Audio unlock failed:", err);
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
      if (!this._checkUrlAllowed(src)) {
        console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", src);
        return null;
      }
      return { type: "img", url: src, fileName: fileNameFromUrl(src), imgEl: el };
    }

    const childImg = el.querySelector("img");
    if (childImg && (childImg.currentSrc || childImg.src)) {
      const src = childImg.currentSrc || childImg.src;
      if (!this._checkUrlAllowed(src)) {
        console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", src);
        return null;
      }
      return { type: "img-child", url: src, fileName: fileNameFromUrl(src), imgEl: childImg };
    }

    const bg = getComputedStyle(el).backgroundImage;
    const url = extractCssUrl(bg);
    if (url) {
      if (!this._checkUrlAllowed(url)) {
        console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", url);
        return null;
      }
      return { type: "background", url, fileName: fileNameFromUrl(url), imgEl: null };
    }

    return null;
  }

  // --- Analysis (delegates to engine) ---

  async _prepareAnalysis(inst) {
    try {
      const securityOk = await this._checkResourceSecurity(inst.source.url);
      if (!securityOk) return;
      const { score, meta } = await inst.engine.analyze(inst.source, inst.opts.audio);
      inst.currentScore = score;
      inst.currentMeta = meta;
    } catch (err) {
      console.warn("[Float:ImgPlay] analyze failed:", err);
    }
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
          if (!this._checkUrlAllowed(inst.meta.midi.url)) {
            console.warn("[Float:ImgPlay] MIDI URL blocked by allowedDomains:", inst.meta.midi.url);
            return;
          }
          const midiSecure = await this._checkResourceSecurity(inst.meta.midi.url);
          if (!midiSecure) return;
          parsed = await MidiEngine.fetchAndParse(inst.meta.midi.url);
        }
        if (parsed) inst.currentScore = parsed;
      } catch (err) {
        console.warn("[Float:ImgPlay] MIDI parse failed:", err);
        return;
      }
    }

    // AudioEngine: fetch and decode audio buffer before play
    if (inst.engine instanceof AudioEngine && inst.meta?.audio?.url && !inst.currentScore?.audioBuffer) {
      try {
        if (!this._checkUrlAllowed(inst.meta.audio.url)) {
          console.warn("[Float:ImgPlay] Audio URL blocked by allowedDomains:", inst.meta.audio.url);
          return;
        }
        const audioSecure = await this._checkResourceSecurity(inst.meta.audio.url);
        if (!audioSecure) return;
        const audioBuffer = await AudioEngine.fetchAndDecode(inst.meta.audio.url, ctx);
        inst.currentScore = { audioBuffer, audioUrl: inst.meta.audio.url };
      } catch (err) {
        console.warn("[Float:ImgPlay] Audio fetch failed:", err);
        return;
      }
    }

    this._stopInstance(inst);

    const handle = inst.engine.play(inst.currentScore, ctx, inst.opts.audio);
    inst.playHandle = handle;

    const timerId = window.setTimeout(() => {
      if (inst.opts.loop && inst.isPlaying) {
        this._stopInstance(inst);
        this._playInstance(inst);
        return;
      }
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

    const { classNames, showPlayOverlay, showVolumeControl, showSpeedControl, showSettingsButton, showLoopButton, overlayIcon, overlayPlayText, zIndexUI, audio } = inst.opts;
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
        right: "6px",
        top: "50%",
        transform: "translateY(-50%)",
        pointerEvents: "auto",
        background: "rgba(0,0,0,0.48)",
        color: "#fff",
        padding: "8px 10px",
        borderRadius: "14px",
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px"
      });

      volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "1";
      volumeInput.step = "0.01";
      volumeInput.value = String(audio.masterVolume);
      volumeInput.className = classNames.volumeInput;
      volumeInput.setAttribute("orient", "vertical");
      Object.assign(volumeInput.style, {
        writingMode: "vertical-lr",
        direction: "rtl",
        width: "20px",
        height: "70px",
        appearance: "slider-vertical",
        WebkitAppearance: "slider-vertical"
      });

      const label = document.createElement("span");
      label.textContent = "\u{1F50A}";
      label.style.fontSize = "11px";

      volumeWrap.appendChild(volumeInput);
      volumeWrap.appendChild(label);
      uiRoot.appendChild(volumeWrap);
    }

    let speedWrap = null;
    let speedInput = null;
    let speedLabel = null;
    if (showSpeedControl) {
      speedWrap = document.createElement("div");
      speedWrap.className = classNames.speedWrap;
      Object.assign(speedWrap.style, {
        position: "absolute",
        left: "8px",
        bottom: "8px",
        pointerEvents: "auto",
        background: "rgba(0,0,0,0.48)",
        color: "#fff",
        padding: "8px 10px",
        borderRadius: "14px",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        gap: "6px"
      });

      const turtleSpan = document.createElement("span");
      turtleSpan.textContent = "\u{1F422}";

      speedInput = document.createElement("input");
      speedInput.type = "range";
      speedInput.min = "40";
      speedInput.max = "240";
      speedInput.step = "1";
      speedInput.value = String(audio.tempo);
      speedInput.className = classNames.speedInput;
      speedInput.style.width = "70px";

      const rabbitSpan = document.createElement("span");
      rabbitSpan.textContent = "\u{1F407}";

      speedLabel = document.createElement("span");
      speedLabel.textContent = String(audio.tempo);

      speedWrap.appendChild(turtleSpan);
      speedWrap.appendChild(speedInput);
      speedWrap.appendChild(rabbitSpan);
      speedWrap.appendChild(speedLabel);
      uiRoot.appendChild(speedWrap);
    }

    let settingsBtn = null;
    let settingsPopupEl = null;
    if (showSettingsButton) {
      settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = classNames.settingsBtn;
      settingsBtn.setAttribute("aria-label", "Settings");
      settingsBtn.textContent = "\u2699";
      Object.assign(settingsBtn.style, {
        position: "absolute",
        top: "8px",
        left: "8px",
        pointerEvents: "auto",
        border: "0",
        borderRadius: "50%",
        width: "32px",
        height: "32px",
        fontSize: "16px",
        lineHeight: "1",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        backdropFilter: "blur(10px)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      });
      uiRoot.appendChild(settingsBtn);

      settingsPopupEl = this._buildSettingsPopup(inst);
      uiRoot.appendChild(settingsPopupEl);
    }

    let loopBtn = null;
    if (showLoopButton) {
      loopBtn = document.createElement("button");
      loopBtn.type = "button";
      loopBtn.className = "float-imgplay-loop";
      loopBtn.setAttribute("aria-label", "Loop");
      loopBtn.textContent = "\u{1F501}";
      const loopTop = showSettingsButton ? "44px" : "8px";
      Object.assign(loopBtn.style, {
        position: "absolute",
        top: loopTop,
        left: "8px",
        pointerEvents: "auto",
        border: "0",
        borderRadius: "50%",
        width: "32px",
        height: "32px",
        fontSize: "14px",
        lineHeight: "1",
        background: inst.opts.loop ? "rgba(108,92,231,0.7)" : "rgba(0,0,0,0.55)",
        color: "#fff",
        backdropFilter: "blur(10px)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s"
      });
      uiRoot.appendChild(loopBtn);
    }

    el.classList.add(classNames.initialized);
    el.appendChild(uiRoot);

    inst.ui = { root: uiRoot, playBtn, volumeWrap, volumeInput, speedWrap, speedInput, speedLabel, settingsBtn, settingsPopup: settingsPopupEl, loopBtn };
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

  _buildSettingsPopup(inst) {
    const { classNames } = inst.opts;
    const popup = document.createElement("div");
    popup.className = classNames.settingsPopup;
    Object.assign(popup.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.88)",
      backdropFilter: "blur(12px)",
      overflowY: "auto",
      padding: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      zIndex: String(inst.opts.zIndexUI + 10),
      fontSize: "11px",
      color: "#fff"
    });

    // --- Header row ---
    const header = document.createElement("div");
    Object.assign(header.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });
    const title = document.createElement("span");
    title.textContent = "Settings";
    title.style.fontWeight = "bold";
    title.style.fontSize = "13px";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "\u2715";
    Object.assign(closeBtn.style, {
      background: "none", border: "0", color: "#fff", fontSize: "14px", cursor: "pointer", padding: "4px"
    });
    header.appendChild(title);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // --- State ---
    let selectedInstrument = null;
    let selectedEnsemble = null;
    let selectedAlgorithm = inst.opts.audio.algorithm || "rgba-digit";

    const pillStyle = {
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(255,255,255,0.08)",
      borderRadius: "12px",
      padding: "3px 8px",
      fontSize: "10px",
      color: "#fff",
      cursor: "pointer"
    };
    const activePillStyle = {
      background: "rgba(108,92,231,0.5)",
      border: "1px solid #6c5ce7"
    };

    const algoPills = [];

    function highlightPills() {
      instrPills.forEach((p) => {
        if ((selectedInstrument === null && p._presetKey === "none") || p._presetKey === selectedInstrument) {
          Object.assign(p.style, activePillStyle);
        } else {
          p.style.background = "rgba(255,255,255,0.08)";
          p.style.border = "1px solid rgba(255,255,255,0.2)";
        }
      });
      ensemblePills.forEach((p) => {
        if (p._presetKey === selectedEnsemble) {
          Object.assign(p.style, activePillStyle);
        } else {
          p.style.background = "rgba(255,255,255,0.08)";
          p.style.border = "1px solid rgba(255,255,255,0.2)";
        }
      });
      algoPills.forEach((p) => {
        if (p._presetKey === selectedAlgorithm) {
          Object.assign(p.style, activePillStyle);
        } else {
          p.style.background = "rgba(255,255,255,0.08)";
          p.style.border = "1px solid rgba(255,255,255,0.2)";
        }
      });
    }

    // --- Instruments section ---
    const instrTitle = document.createElement("div");
    instrTitle.textContent = "Instruments";
    instrTitle.style.fontWeight = "bold";
    popup.appendChild(instrTitle);

    const instrGrid = document.createElement("div");
    Object.assign(instrGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

    const instrPills = [];

    // "none" / Default pill
    const nonePill = document.createElement("button");
    nonePill.type = "button";
    nonePill.textContent = "Default";
    nonePill._presetKey = "none";
    Object.assign(nonePill.style, pillStyle);
    nonePill.addEventListener("click", () => {
      selectedInstrument = null;
      selectedEnsemble = null;
      highlightPills();
    });
    instrPills.push(nonePill);
    instrGrid.appendChild(nonePill);

    Object.keys(INSTRUMENT_PRESETS).forEach((key) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = INSTRUMENT_PRESETS[key].name;
      pill._presetKey = key;
      Object.assign(pill.style, pillStyle);
      pill.addEventListener("click", () => {
        selectedInstrument = key;
        selectedEnsemble = null;
        highlightPills();
      });
      instrPills.push(pill);
      instrGrid.appendChild(pill);
    });
    popup.appendChild(instrGrid);

    // --- Ensembles section ---
    const ensTitle = document.createElement("div");
    ensTitle.textContent = "Ensembles";
    ensTitle.style.fontWeight = "bold";
    popup.appendChild(ensTitle);

    const ensGrid = document.createElement("div");
    Object.assign(ensGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

    const ensemblePills = [];
    Object.keys(ENSEMBLE_PRESETS).forEach((key) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = ENSEMBLE_PRESETS[key].name;
      pill._presetKey = key;
      Object.assign(pill.style, pillStyle);
      pill.addEventListener("click", () => {
        selectedEnsemble = key;
        selectedInstrument = null;
        highlightPills();
      });
      ensemblePills.push(pill);
      ensGrid.appendChild(pill);
    });
    popup.appendChild(ensGrid);

    // --- Algorithms section ---
    const algoTitle = document.createElement("div");
    algoTitle.textContent = "Algorithm";
    algoTitle.style.fontWeight = "bold";
    popup.appendChild(algoTitle);

    const algoGrid = document.createElement("div");
    Object.assign(algoGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

    Object.keys(ALGORITHMS).forEach((key) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = ALGORITHMS[key].name;
      pill._presetKey = key;
      Object.assign(pill.style, pillStyle);
      pill.addEventListener("click", () => {
        selectedAlgorithm = key;
        highlightPills();
      });
      algoPills.push(pill);
      algoGrid.appendChild(pill);
    });
    popup.appendChild(algoGrid);

    // --- Advanced toggle ---
    const advToggle = document.createElement("button");
    advToggle.type = "button";
    advToggle.textContent = "\u25B8 Advanced";
    Object.assign(advToggle.style, {
      background: "none", border: "0", color: "#fff", fontSize: "11px", cursor: "pointer",
      padding: "4px 0", textAlign: "left"
    });
    popup.appendChild(advToggle);

    // --- Advanced panel ---
    const advPanel = document.createElement("div");
    Object.assign(advPanel.style, { display: "none", flexDirection: "column", gap: "4px" });

    advToggle.addEventListener("click", () => {
      if (advPanel.style.display === "none") {
        advPanel.style.display = "flex";
        advToggle.textContent = "\u25BE Advanced";
      } else {
        advPanel.style.display = "none";
        advToggle.textContent = "\u25B8 Advanced";
      }
    });

    const selectStyle = { background: "#252542", border: "1px solid #3a3a5a", color: "#fff", fontSize: "10px", borderRadius: "4px", padding: "2px 4px" };

    const advInputs = {};

    const advOptions = [
      { key: "waveform", label: "Waveform", type: "select", options: ["sine", "square", "sawtooth", "triangle"] },
      { key: "tempo", label: "Tempo", type: "range", min: 40, max: 240, step: 1 },
      { key: "masterVolume", label: "Volume", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "scaleMode", label: "Scale", type: "select", options: ["auto", "major", "minor", "pentatonic", "blues", "chromatic", "dorian", "mixolydian"] },
      { key: "rootMode", label: "Root Mode", type: "select", options: ["filename-first-char", "fixed", "auto"] },
      { key: "fixedRootMidi", label: "Root MIDI", type: "range", min: 36, max: 84, step: 1 },
      { key: "pitchShiftSemitones", label: "Pitch Shift", type: "range", min: -24, max: 24, step: 1 },
      { key: "filterType", label: "Filter", type: "select", options: ["lowpass", "highpass", "bandpass", "notch"] },
      { key: "filterBaseHz", label: "Filter Hz", type: "range", min: 100, max: 8000, step: 1 },
      { key: "filterVelocityAmount", label: "Filter Vel", type: "range", min: 0, max: 8000, step: 1 },
      { key: "attack", label: "Attack", type: "range", min: 0.001, max: 0.5, step: 0.001 },
      { key: "release", label: "Release", type: "range", min: 0.001, max: 0.5, step: 0.001 },
      { key: "noteDurationBeats", label: "Note Dur", type: "range", min: 0.1, max: 2, step: 0.05 },
      { key: "sampleColumns", label: "Columns", type: "range", min: 0, max: 256, step: 1 },
      { key: "restThreshold", label: "Rest Thresh", type: "range", min: 0, max: 128, step: 1 },
      { key: "brightDuration", label: "Bright Dur", type: "range", min: 0.05, max: 1, step: 0.01 },
      { key: "blueDuration", label: "Blue Dur", type: "range", min: 0.05, max: 1, step: 0.01 },
      { key: "neutralDuration", label: "Neutral Dur", type: "range", min: 0.05, max: 1, step: 0.01 }
    ];

    advOptions.forEach((opt) => {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px" });

      const lbl = document.createElement("label");
      lbl.textContent = opt.label;
      lbl.style.minWidth = "70px";
      lbl.style.fontSize = "10px";
      row.appendChild(lbl);

      const currentVal = inst.opts.audio[opt.key];

      if (opt.type === "range") {
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(opt.min);
        input.max = String(opt.max);
        input.step = String(opt.step);
        input.value = String(currentVal);
        input.style.flex = "1";
        input.style.height = "14px";
        row.appendChild(input);

        const valSpan = document.createElement("span");
        valSpan.textContent = String(currentVal);
        valSpan.style.minWidth = "32px";
        valSpan.style.fontSize = "10px";
        valSpan.style.textAlign = "right";
        row.appendChild(valSpan);

        input.addEventListener("input", () => {
          valSpan.textContent = input.value;
        });

        advInputs[opt.key] = input;
      } else if (opt.type === "select") {
        const sel = document.createElement("select");
        Object.assign(sel.style, selectStyle);
        sel.style.flex = "1";
        opt.options.forEach((o) => {
          const optEl = document.createElement("option");
          optEl.value = o;
          optEl.textContent = o;
          if (o === String(currentVal)) optEl.selected = true;
          sel.appendChild(optEl);
        });
        row.appendChild(sel);
        advInputs[opt.key] = sel;
      }

      advPanel.appendChild(row);
    });

    popup.appendChild(advPanel);

    // --- Button row ---
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "6px", marginTop: "4px" });

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "Apply";
    Object.assign(applyBtn.style, {
      flex: "1", padding: "6px", border: "0", borderRadius: "6px",
      background: "#6c5ce7", color: "#fff", fontSize: "11px", cursor: "pointer"
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Reset";
    Object.assign(resetBtn.style, {
      flex: "1", padding: "6px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px",
      background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "11px", cursor: "pointer"
    });

    btnRow.appendChild(applyBtn);
    btnRow.appendChild(resetBtn);
    popup.appendChild(btnRow);

    // --- Event wiring ---
    closeBtn.addEventListener("click", () => { popup.style.display = "none"; });

    applyBtn.addEventListener("click", () => {
      this._applySettingsToInstance(inst, selectedInstrument, selectedEnsemble, advInputs, selectedAlgorithm);
      popup.style.display = "none";
    });

    resetBtn.addEventListener("click", () => {
      selectedInstrument = null;
      selectedEnsemble = null;
      selectedAlgorithm = "rgba-digit";
      highlightPills();
      const defaults = this._defaults().audio;
      Object.keys(advInputs).forEach((key) => {
        const el = advInputs[key];
        if (defaults[key] !== undefined) {
          el.value = String(defaults[key]);
          // Update value display for range inputs
          if (el.type === "range") {
            const valSpan = el.parentElement.querySelector("span");
            if (valSpan) valSpan.textContent = String(defaults[key]);
          }
        }
      });
    });

    // Initial highlight
    highlightPills();

    popup.style.display = "none";
    return popup;
  }

  _applySettingsToInstance(inst, instrumentName, ensembleName, advInputs, algorithmName) {
    // Read advanced values
    Object.keys(advInputs).forEach((key) => {
      const el = advInputs[key];
      const val = el.value;
      if (el.type === "range") {
        inst.opts.audio[key] = Number(val);
      } else {
        inst.opts.audio[key] = val;
      }
    });

    // Apply algorithm
    if (algorithmName) {
      inst.opts.audio.algorithm = algorithmName;
    }

    // Resolve instrument/ensemble
    if (ensembleName) {
      try {
        inst.opts.audio._instruments = resolveEnsemble(ensembleName);
      } catch { inst.opts.audio._instruments = null; }
    } else if (instrumentName) {
      try {
        inst.opts.audio._instruments = [resolveInstrument(instrumentName)];
      } catch { inst.opts.audio._instruments = null; }
    } else {
      inst.opts.audio._instruments = null;
    }

    // Re-analyze and stop current playback
    this._stopInstance(inst);
    inst.currentScore = null;
    inst.currentMeta = null;
    this._prepareAnalysis(inst);

    // Sync speed/volume sliders if present
    if (inst.ui?.speedInput) {
      inst.ui.speedInput.value = String(inst.opts.audio.tempo);
      if (inst.ui.speedLabel) inst.ui.speedLabel.textContent = inst.opts.audio.tempo + "";
    }
    if (inst.ui?.volumeInput) {
      inst.ui.volumeInput.value = String(inst.opts.audio.masterVolume);
    }
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
      if (inst.ui?.speedInput && (e.target === inst.ui.speedInput || inst.ui.speedWrap?.contains(e.target))) {
        return;
      }
      if (inst.ui?.settingsBtn && (e.target === inst.ui.settingsBtn || inst.ui.settingsPopup?.contains(e.target))) {
        return;
      }
      if (inst.ui?.loopBtn && e.target === inst.ui.loopBtn) {
        return;
      }
      if (inst.opts.clickToPlay === false) {
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

    inst._onSpeedInput = (e) => {
      const bpm = Number(e.target.value);
      inst.opts.audio.tempo = bpm;
      if (inst.ui?.speedLabel) inst.ui.speedLabel.textContent = bpm + "";
      if (inst.isPlaying) {
        this._stopInstance(inst);
        inst.currentScore = null;
        this._prepareAnalysis(inst);
        this._playInstance(inst);
      }
    };

    if (inst.ui?.playBtn) inst.ui.playBtn.addEventListener("click", inst._onPlayClick);
    if (inst.ui?.volumeInput) inst.ui.volumeInput.addEventListener("input", inst._onVolumeInput);
    if (inst.ui?.speedInput) inst.ui.speedInput.addEventListener("input", inst._onSpeedInput);

    if (inst.ui?.settingsBtn) {
      inst._onSettingsClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inst.ui.settingsPopup) {
          inst.ui.settingsPopup.style.display = inst.ui.settingsPopup.style.display === "none" ? "flex" : "none";
        }
      };
      inst.ui.settingsBtn.addEventListener("click", inst._onSettingsClick);
    }

    if (inst.ui?.loopBtn) {
      inst._onLoopClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        inst.opts.loop = !inst.opts.loop;
        inst.ui.loopBtn.style.background = inst.opts.loop ? "rgba(108,92,231,0.7)" : "rgba(0,0,0,0.55)";
      };
      inst.ui.loopBtn.addEventListener("click", inst._onLoopClick);
    }

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

  // --- Static: Config Export/Import ---

  static downloadConfig(config, filename = "imgplay-preset.json") {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static loadConfigFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const config = JSON.parse(e.target.result);
          resolve(config);
        } catch (err) {
          reject(new Error("[Float:ImgPlay] Invalid JSON: " + err.message));
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
}

export default FloatImgPlay;

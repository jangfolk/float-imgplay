# Float:ImgPlay v2 Design Spec

## Overview

Float:ImgPlay는 이미지를 재생 가능한 미디어 객체로 변환하는 웹 기반 엔진이다.
핵심 개념: "이미지는 보는 것이 아니라, 재생되는 것이다"

## Architecture

```
src/
  float-imgplay.js          ← Core (진입점, Mode Router, UI, Visibility)
  engines/
    image-engine.js         ← 픽셀 분석 + Web Audio 합성
    midi-engine.js          ← MIDI 파싱 + 재생
    audio-engine.js         ← mp3/wav 스트리밍 재생
  parsers/
    meta-parser.js          ← PNG tEXt / EXIF / sidecar JSON 파싱
  utils/
    helpers.js              ← mergeDeep, clone, throttle, clamp 등 유틸
  export/
    midi-export.js          ← 이미지 분석 결과 → Standard MIDI File
```

## Engine Interface

모든 엔진은 동일한 인터페이스를 따른다:

```js
class Engine {
  canHandle(source, meta)           // → boolean
  async analyze(source, audioOpts)  // → { score: Note[], meta: object }
  play(score, audioCtx, audioOpts)  // → { nodes: AudioNode[], timers: number[] }
  stop(handle)                      // → void
}
```

## Mode Router

```
meta = MetaParser.parse(source)

if (meta.midi)  → MidiEngine
if (meta.audio) → AudioEngine
else            → ImageEngine (default)
```

## Meta Format

이미지에 임베딩되거나 sidecar JSON으로 제공:

```json
{
  "imgplay": {
    "mode": "auto",
    "midi": { "url": "...", "data": "..." },
    "audio": { "url": "...", "type": "mp3" },
    "engine": { "waveform": "sine", "tempo": 120 }
  }
}
```

지원 소스:
- PNG tEXt chunk (key: "imgplay")
- EXIF UserComment
- Sidecar JSON (`<image-url>.imgplay.json`)

## Phases

### Phase 1: 모듈 리팩터링 + Mode Router 골격
- 단일 파일 → 모듈 분리
- Engine 인터페이스 정의
- ImageEngine 추출 (기존 로직)
- MidiEngine/AudioEngine 스텁
- MetaParser 스텁 (항상 빈 meta)
- Mode Router (항상 ImageEngine으로 폴백)
- 동작 변화 없음

### Phase 2: Meta Parser
- PNG tEXt 파싱 (바이너리)
- EXIF UserComment 파싱
- Sidecar JSON fetch
- Mode Router 실제 분기 활성화

### Phase 3: Audio Engine
- meta.audio.url → Audio/fetch + decode → AudioBufferSourceNode
- play/stop/pause 지원
- UI 연동 (기존 play overlay 재활용)

### Phase 4: MIDI Engine
- Standard MIDI File 파싱 (자체 구현, 외부 의존성 없음)
- MIDI notes → Web Audio 합성 재생
- 또는 Tone.js 옵션 (devDependency)

### Phase 5: MIDI Export
- ImageEngine 분석 결과 (score) → Standard MIDI File 바이너리
- Blob → 다운로드 트리거
- UI에 export 버튼 옵션 추가

### Phase 6: 보안 레이어
- allowedDomains 옵션 (URL 화이트리스트)
- maxFileSize 옵션 (기본 10MB)
- MIME type 체크
- crossOrigin 처리 강화

## Security

```js
{
  security: {
    allowedDomains: [],      // 빈 배열 = 제한 없음
    maxFileSize: 10485760,   // 10MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  }
}
```

## Build

- Rollup이 `src/float-imgplay.js`를 진입점으로 모든 모듈을 번들링
- 최종 dist 출력 형식 동일 (ESM/UMD/IIFE/IIFE.min + CSS)
- 런타임 외부 의존성 0개 유지 (Phase 4에서 Tone.js 검토)

## Naming

- npm: `float-imgplay`
- Class: `FloatImgPlay`
- CSS: `.float-imgplay`
- Global: `window.FloatImgPlay`

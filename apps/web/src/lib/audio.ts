/**
 * Voice notes: record with the browser's own codec (WebM/Opus on Android,
 * MP4/AAC on iOS), then decode and re-encode as the mono 16-bit PCM WAV that
 * Muse Voice Transcribe accepts. Converting here keeps ffmpeg off the server.
 */

/** 24 kHz is the rate Muse Voice Transcribe prefers. */
export const SAMPLE_RATE = 24_000;

/** Encodes samples in [-1, 1] as a mono 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decodes any recording the browser can play and resamples it to mono WAV. */
export async function toWav(recording: Blob, sampleRate = SAMPLE_RATE): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * sampleRate),
      sampleRate,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination); // a mono destination mixes the channels down
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), sampleRate);
  } finally {
    await context.close();
  }
}

/** One recording from the microphone. */
export class NoteRecorder {
  #stream: MediaStream | undefined;
  #recorder: MediaRecorder | undefined;
  #chunks: Blob[] = [];

  async start(): Promise<void> {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.#recorder = new MediaRecorder(this.#stream);
    this.#recorder.ondataavailable = (event) => this.#chunks.push(event.data);
    this.#recorder.start();
  }

  /** Stops recording and returns the note as WAV. */
  async stop(): Promise<Blob> {
    const recorder = this.#recorder;
    if (!recorder) throw new Error('Not recording');
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    this.cancel();
    return toWav(new Blob(this.#chunks, { type: recorder.mimeType }));
  }

  /** Releases the microphone. */
  cancel(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = undefined;
  }
}

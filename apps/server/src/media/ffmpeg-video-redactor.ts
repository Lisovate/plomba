import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ValidationError } from '../errors.ts';
import type { PixelBox, Segmenter, VideoInput, VideoRedactor } from '../ports.ts';
import { blurRegions } from './images.ts';

const CONCEPTS = ['person', 'license plate'];

/** Checked once by the composition root; missing tools disable video evidence. */
export async function videoRedactionAvailable(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export class FfmpegVideoRedactor implements VideoRedactor {
  readonly #segmenter: Segmenter;

  constructor(segmenter: Segmenter) {
    this.#segmenter = segmenter;
  }

  async redact(video: Parameters<VideoRedactor['redact']>[0]) {
    const dir = await mkdtemp(join(tmpdir(), 'plomba-blur-'));
    try {
      const input = join(dir, 'source');
      await writeFile(input, video.data);
      const rate = await frameRate(input);
      let trackedVideo: VideoInput;
      if (video.mimeType === 'video/webm') {
        // SAM reads MP4/MOV. Keep WebM's decoded frames in the same order for it.
        const converted = join(dir, 'model.mp4');
        await ffmpeg(
          '-i',
          input,
          '-map',
          '0:v:0',
          '-fps_mode',
          'passthrough',
          ...MP4_OPTIONS,
          converted,
        );
        trackedVideo = { data: new Uint8Array(await readFile(converted)), mimeType: 'video/mp4' };
      } else {
        trackedVideo = { data: video.data, mimeType: video.mimeType };
      }

      const boxes = new Map<number, PixelBox[]>();
      for (const concept of CONCEPTS) {
        for (const { frame, objects } of await this.#segmenter.track(trackedVideo, concept)) {
          boxes.set(frame, [...(boxes.get(frame) ?? []), ...objects.map((object) => object.box)]);
        }
      }

      // Never duplicate or drop decoded frames: tracking uses their zero-based indices.
      const pattern = join(dir, '%06d.png');
      await ffmpeg(
        '-i',
        input,
        '-map',
        '0:v:0',
        '-fps_mode',
        'passthrough',
        '-threads',
        '1',
        pattern,
      );
      const files = (await readdir(dir)).filter((file) => /^\d+\.png$/.test(file)).sort();
      if (files.length === 0) throw new ValidationError('The upload has no readable video frames');
      let regions = 0;
      for (const [index, file] of files.entries()) {
        const frameBoxes = boxes.get(index) ?? [];
        if (frameBoxes.length === 0) continue;
        const path = join(dir, file);
        const png = await readFile(path);
        const { width = 0, height = 0 } = await sharp(png).metadata();
        const jpeg = await sharp(png).jpeg({ quality: 95 }).toBuffer();
        const redacted = await blurRegions(
          { data: new Uint8Array(jpeg), mimeType: 'image/jpeg', width, height },
          frameBoxes,
        );
        await writeFile(path, await sharp(redacted.data).png().toBuffer());
        regions += frameBoxes.length;
      }

      const output = join(dir, 'redacted.mp4');
      await ffmpeg('-framerate', rate, '-i', pattern, ...MP4_OPTIONS, output);
      return {
        data: new Uint8Array(await readFile(output)),
        mimeType: 'video/mp4' as const,
        regions,
      };
    } finally {
      // Temporary originals and frames must also go away when a model or encoder fails.
      await rm(dir, { recursive: true, force: true });
    }
  }
}

const MP4_OPTIONS = [
  '-c:v',
  'libx264',
  '-threads',
  '2',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '23',
  '-movflags',
  '+faststart',
  '-an',
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
];

async function frameRate(file: string): Promise<string> {
  const output = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=avg_frame_rate,r_frame_rate',
    '-of',
    'json',
    file,
  ]);
  const { streams } = JSON.parse(output) as {
    streams?: { avg_frame_rate?: string; r_frame_rate?: string }[];
  };
  for (const rate of [streams?.[0]?.avg_frame_rate, streams?.[0]?.r_frame_rate]) {
    if (!rate || !/^\d+\/\d+$/.test(rate)) continue;
    const [numerator = 0, denominator = 0] = rate.split('/').map(Number);
    if (numerator > 0 && denominator > 0) return rate;
  }
  throw new ValidationError('The upload has no readable video frame rate');
}

async function ffmpeg(...args: string[]): Promise<void> {
  await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args]);
}

/** No shell, bounded diagnostics and a deadline; decoding must not block the server. */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-64 * 1024);
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-16 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

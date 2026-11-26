import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { z } from 'zod';
// 本機 FFmpeg（02「影片合成」）：裁切、放大到 1920×1080、串接、燒錄 ASS 字幕、加背景音樂、loudnorm 統一響度；輸出 H.264、24 fps、AAC
// 後製：各格響度對齊、剪接點聲音交叉淡化、背景音樂遇人聲自動壓低、片頭片尾淡入淡出、極細膠片顆粒統一質感

/** 成品規格（01 F15、02） */
export const FINAL_SPEC = { width: 1920, height: 1080, fps: 24 } as const;

export type ComposeClip = {
  /** 片段檔案的絕對路徑 */
  path: string;
  /** 卡片秒數：從頭裁到這個長度 */
  durationSec: number;
};

export type ComposeInput = {
  clips: readonly ComposeClip[];
  /** 背景音樂檔案；沒有時只有各格自帶的聲音 */
  music: string | null;
  /** ASS 字幕檔的路徑 */
  subtitlesPath: string;
  output: string;
};

export type MediaInfo = { width: number | null; height: number | null; fps: number | null; durationSec: number; hasAudio: boolean };

export type Ffmpeg = {
  compose(input: ComposeInput): Promise<void>;
  probe(file: string): Promise<MediaInfo>;
  /**
   * 擷取一個畫面，縮成 width×height 的灰階像素（偏差比對用）。
   * atSec 是影片的時間點；圖片檔傳 null。
   */
  grayFrame(file: string, atSec: number | null, size: { width: number; height: number }): Promise<Uint8Array>;
  /** 把幾張圖依版面拼成一張 PNG（每格等比縮放、補邊），參考圖拼接用 */
  sheet(input: { files: readonly string[]; cols: number; rows: number; cellWidth: number; cellHeight: number; output: string }): Promise<void>;
};

export class FfmpegError extends Error {
  override name = 'FfmpegError';
}

type Run = (args: readonly string[]) => Promise<Buffer>;

function runner(binary: string): Run {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(binary, [...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const detail = Buffer.from(stderr).toString('utf8').trim().split('\n').slice(-3).join(' ');
          reject(new FfmpegError(detail || error.message));
          return;
        }
        resolve(Buffer.from(stdout));
      });
    });
}

/** 濾鏡參數裡的檔案路徑：跳脫 \ ' : */
function filterPath(file: string): string {
  return `'${file.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')}'`;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 100) / 100;
}

type ProbeJson = { streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string }[]; format?: { duration?: string } };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 成品響度（02）：I=-16、TP=-1.5、LRA=11 */
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';

const LoudnormMeasureSchema = z.object({ input_i: z.string() });

/** 峰值限制器：-2 dBFS（取樣峰值，留 0.5 dB 給真實峰值），快速起音、短釋放，不改變整體響度 */
const PEAK_LIMITER = `alimiter=limit=${Math.pow(10, -2 / 20).toFixed(4)}:attack=5:release=50:level=false`;

/** 整支成品拉到 -16 LUFS 需要的固定增益（dB），最多 +40 dB */
export function masterGainDb(integratedLufs: number): number {
  return round(Math.min(40, -16 - integratedLufs));
}

/** 各格對齊的目標響度（LUFS）；最後再由 loudnorm 統一拉到 -16 */
const CLIP_TARGET_LUFS = -23;

export type FinishingPlan = {
  /** 各格的增益（dB）：拉到相同響度，最多加 6 dB、減 12 dB；量不到響度（靜音、只有極小環境音）不動 */
  gainsDb: number[];
  /** 剪接點的聲音交叉淡化秒數 */
  audioOverlapSec: number;
  /** 片頭從黑淡入、片尾淡出到黑的秒數（成品太短時按比例縮短） */
  fadeInSec: number;
  fadeOutSec: number;
  /** 片頭聲音淡入秒數：很短，不吃掉第一句旁白 */
  audioFadeInSec: number;
  musicFadeInSec: number;
  musicFadeOutSec: number;
  /** 膠片顆粒強度（noise 濾鏡的 alls） */
  grain: number;
};

/** 成品後製的參數（純函式）：響度對齊、交叉淡化、淡入淡出 */
export function finishingPlan(durations: readonly number[], loudnessLufs: readonly (number | null)[]): FinishingPlan {
  const total = durations.reduce((sum, d) => sum + d, 0);
  const shortest = durations.length > 0 ? Math.min(...durations) : 0;
  const gainsDb = durations.map((_, index) => {
    const level = loudnessLufs[index];
    if (level === null || level === undefined) return 0;
    return round(Math.min(6, Math.max(-12, CLIP_TARGET_LUFS - level)));
  });
  return {
    gainsDb,
    audioOverlapSec: round(Math.min(0.12, shortest / 4)),
    fadeInSec: round(Math.min(0.4, total / 8)),
    fadeOutSec: round(Math.min(1, total / 6)),
    audioFadeInSec: round(Math.min(0.08, total / 8)),
    musicFadeInSec: round(Math.min(1.5, total / 4)),
    musicFadeOutSec: round(Math.min(2.5, total / 3)),
    grain: 3,
  };
}

export function createFfmpeg(options: { ffmpegPath?: string | undefined; ffprobePath?: string | undefined } = {}): Ffmpeg {
  const ffmpeg = runner(options.ffmpegPath || 'ffmpeg');
  const ffprobe = runner(options.ffprobePath || 'ffprobe');

  async function probe(file: string): Promise<MediaInfo> {
    const json = JSON.parse((await ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).toString('utf8')) as ProbeJson;
    const video = json.streams?.find((s) => s.codec_type === 'video');
    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: parseRate(video?.r_frame_rate),
      durationSec: Number(json.format?.duration ?? 0),
      hasAudio: Boolean(json.streams?.some((s) => s.codec_type === 'audio')),
    };
  }

  /** 一個片段前 durationSec 秒的整合響度（LUFS）；沒有聲音或全靜音時回傳 null */
  async function loudness(file: string, durationSec: number): Promise<number | null> {
    const stderr = await new Promise<string>((resolve) => {
      execFile(
        options.ffmpegPath || 'ffmpeg',
        ['-hide_banner', '-nostats', '-t', String(durationSec), '-i', file, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (_error, _stdout, err) => resolve(String(err)),
      );
    });
    const summary = stderr.split('Summary:').at(-1) ?? '';
    const value = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    return Number.isFinite(value) && value > -60 ? value : null;
  }

  /** 響度第一段：只跑聲音，回傳整合響度（LUFS）；量不到時回傳 null（退回單段 loudnorm） */
  async function measureLoudnorm(inputArgs: readonly string[], graph: string): Promise<number | null> {
    const stderr = await new Promise<string>((resolve) => {
      execFile(
        options.ffmpegPath || 'ffmpeg',
        [...inputArgs.filter((arg) => arg !== '-loglevel' && arg !== 'error'), '-nostats', '-filter_complex', graph, '-map', '[m]', '-f', 'null', '-'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (_error, _stdout, err) => resolve(String(err)),
      );
    });
    const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)?.[0];
    if (!json) return null;
    const parsed = LoudnormMeasureSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const integrated = Number(parsed.data.input_i);
    return Number.isFinite(integrated) && integrated > -70 ? integrated : null;
  }

  async function compose(input: ComposeInput): Promise<void> {
    const { width, height, fps } = FINAL_SPEC;
    const total = input.clips.reduce((sum, clip) => sum + clip.durationSec, 0);
    try {
      const infos = await Promise.all(input.clips.map((clip) => probe(clip.path)));
      const levels = await Promise.all(input.clips.map((clip, index) => (infos[index]?.hasAudio ? loudness(clip.path, clip.durationSec) : Promise.resolve(null))));
      const plan = finishingPlan(input.clips.map((clip) => clip.durationSec), levels);
      const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
      for (const clip of input.clips) args.push('-i', clip.path);
      if (input.music) args.push('-i', input.music);

      const filters: string[] = [];
      const x = plan.audioOverlapSec;
      input.clips.forEach((clip, index) => {
        const d = clip.durationSec;
        // 從頭裁到卡片秒數；不足時延長最後一個畫面；以 lanczos 放大到 1920×1080，補邊不變形
        filters.push(
          // 先裁切與換成 24 fps 再放大，少處理用不到的畫面
          `[${index}:v]trim=0:${d},setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${d},trim=0:${d},` +
            `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`,
        );
        // 聲音多留 x 秒，和下一格交叉淡化（剪接點不爆音、環境音不斷層）；各格先拉到相同響度
        const gain = plan.gainsDb[index] ?? 0;
        const length = d + x;
        filters.push(
          infos[index]?.hasAudio
            ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${length},asetpts=PTS-STARTPTS,volume=${gain}dB[a${index}]`
            : `anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp,atrim=0:${length},asetpts=PTS-STARTPTS[a${index}]`,
        );
      });
      const videos = input.clips.map((_, index) => `[v${index}]`).join('');
      filters.push(`${videos}concat=n=${input.clips.length}:v=1:a=0[vc]`);
      // 交叉淡化串接聲音：每次重疊 x 秒，下一格仍從剪接點開始
      let audio = 'a0';
      for (let index = 1; index < input.clips.length; index += 1) {
        const next = `ax${index}`;
        filters.push(`[${audio}][a${index}]acrossfade=d=${x}:c1=tri:c2=tri[${next}]`);
        audio = next;
      }
      filters.push(`[${audio}]atrim=0:${total},asetpts=PTS-STARTPTS[ac]`);
      // 字幕燒錄後整體加極細的膠片顆粒（統一各格 AI 畫面的質感），片頭從黑淡入、片尾淡出到黑
      filters.push(
        `[vc]ass=${filterPath(input.subtitlesPath)},noise=alls=${plan.grain}:allf=t,` +
          `fade=t=in:st=0:d=${plan.fadeInSec},fade=t=out:st=${round(total - plan.fadeOutSec)}:d=${plan.fadeOutSec}[vout]`,
      );
      const tail = `afade=t=in:st=0:d=${plan.audioFadeInSec},afade=t=out:st=${round(total - plan.fadeOutSec)}:d=${plan.fadeOutSec}`;
      let premaster = 'ac';
      if (input.music) {
        const m = input.clips.length;
        // 背景音樂：前後淡入淡出；有人聲時自動壓低（ducking）
        filters.push(
          `[${m}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS,volume=0.35,` +
            `afade=t=in:st=0:d=${plan.musicFadeInSec},afade=t=out:st=${round(total - plan.musicFadeOutSec)}:d=${plan.musicFadeOutSec}[music]`,
        );
        filters.push('[ac]asplit=2[dialog][key]');
        filters.push('[music][key]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500:makeup=1[ducked]');
        filters.push('[dialog][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]');
        premaster = 'mix';
      }
      // 兩段式響度：先量整支的整合響度，再以固定增益拉到 -16 LUFS、峰值限制器壓在 -1.5 dBTP 以下；
      // 不用單段 loudnorm 的動態增益，開頭幾秒才不會忽大忽小（loudnorm 的 linear 模式在增益大時也會退回動態）
      const audioOnly = filters.filter((filter) => !filter.includes('[vc]') && !/\[v\d+\]$/.test(filter));
      const measured = await measureLoudnorm(args, [...audioOnly, `[${premaster}]${LOUDNORM}:print_format=json[m]`].join(';'));
      const second = measured === null ? LOUDNORM : `volume=${masterGainDb(measured)}dB,${PEAK_LIMITER}`;
      filters.push(`[${premaster}]${second},aresample=48000,${tail}[aout]`);
      args.push(
        '-filter_complex', filters.join(';'),
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '192k',
        '-t', String(total),
        '-movflags', '+faststart',
        input.output,
      );
      await ffmpeg(args);
    } catch (error: unknown) {
      rmSync(input.output, { force: true });
      throw new FfmpegError(`合成失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function grayFrame(file: string, atSec: number | null, size: { width: number; height: number }): Promise<Uint8Array> {
    const seek = atSec === null ? [] : ['-ss', String(atSec)];
    const bytes = await ffmpeg([
      '-hide_banner', '-loglevel', 'error',
      ...seek,
      '-i', file,
      '-frames:v', '1',
      '-vf', `scale=${size.width}:${size.height},format=gray`,
      '-f', 'rawvideo', 'pipe:1',
    ]);
    if (bytes.length !== size.width * size.height) throw new FfmpegError(`擷取畫面失敗：${file}`);
    return new Uint8Array(bytes);
  }

  async function sheet(input: { files: readonly string[]; cols: number; rows: number; cellWidth: number; cellHeight: number; output: string }): Promise<void> {
    const { files, cols, rows, cellWidth: w, cellHeight: h } = input;
    const scaled = files.map(
      (_, index) => `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[c${index}]`,
    );
    const filters = [...scaled];
    let output: string;
    if (files.length === 1) {
      output = 'c0';
    } else {
      // 空的格子補白
      const cells = files.map((_, index) => `[c${index}]`);
      for (let index = files.length; index < cols * rows; index += 1) {
        filters.push(`color=c=white:s=${w}x${h}:d=1[e${index}]`);
        cells.push(`[e${index}]`);
      }
      const layout = Array.from({ length: cols * rows }, (_, index) => `${(index % cols) * w}_${Math.floor(index / cols) * h}`).join('|');
      filters.push(`${cells.join('')}xstack=inputs=${cols * rows}:layout=${layout}[out]`);
      output = 'out';
    }
    await ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      ...files.flatMap((file) => ['-i', file]),
      '-filter_complex', filters.join(';'),
      '-map', `[${output}]`,
      '-frames:v', '1',
      input.output,
    ]);
  }

  return { compose, probe, grayFrame, sheet };
}

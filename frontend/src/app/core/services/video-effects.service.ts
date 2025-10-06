import { Injectable } from '@angular/core';
import { VideoBackgroundSettings } from './settings.service';

@Injectable({ providedIn: 'root' })
export class VideoEffectsService {
  private processingCanvas?: HTMLCanvasElement;
  private processingCtx?: CanvasRenderingContext2D | null;
  private outputStream?: MediaStream;
  private animationHandle: number | null = null;
  private backgroundImageElement: HTMLImageElement | null = null;
  private videoElement?: HTMLVideoElement;
  private warmupVideo?: HTMLVideoElement;

  // MediaPipe Selfie Segmentation integration
  private mpLoaded = false;
  private mpLoadingPromise: Promise<void> | null = null;
  private selfieSegmentation: any = null;
  private lastSegmentationMask: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null = null;
  private segmentationBusy = false;
  private lastSegmentationAt = 0;
  private readonly segmentationIntervalMs = 100; // ~10fps to reduce load/log spam
  private resultsHandlerRegistered = false;

  // Preload models/assets ahead of time to reduce first-frame latency
  public async preload(): Promise<void> {
    try {
      await this.ensureSelfieSegmentation();
    } catch {}
  }

  async apply(input: MediaStream, settings: VideoBackgroundSettings): Promise<MediaStream> {
    // Stop any previous processing BEFORE creating a new pipeline
    this.stop();

    if (settings.mode === 'none') {
      return input;
    }

    const track = input.getVideoTracks()[0];
    if (!track) {
      return input;
    }

    // Prepare canvas/context
    const processorCanvas = this.processingCanvas || document.createElement('canvas');
    // Ensure canvas is attached to DOM so captureStream reliably produces frames
    if (!processorCanvas.isConnected) {
      processorCanvas.style.display = 'none';
      document.body.appendChild(processorCanvas);
    }
    const ctx = processorCanvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx) return input;
    this.processingCanvas = processorCanvas;
    this.processingCtx = ctx;

    // Create output stream from canvas
    const processorStream = processorCanvas.captureStream(30);
    this.outputStream = processorStream;

    // Create or reuse the video element for input frames
    const videoEl = this.videoElement || document.createElement('video');
    this.videoElement = videoEl;
    videoEl.autoplay = true;
    videoEl.muted = true;
    (videoEl as any).playsInline = true;
    videoEl.srcObject = new MediaStream([track]);

    await new Promise<void>(resolve => {
      // Wait until the video element has real dimensions and current data
      const tryResolve = () => {
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          cleanup();
          resolve();
        }
      };
      const onLoadedMeta = () => tryResolve();
      const onLoadedData = () => tryResolve();
      const onPlaying = () => tryResolve();
      const onResize = () => tryResolve();
      const onError = () => { cleanup(); resolve(); };
      const cleanup = () => {
        videoEl.removeEventListener('loadedmetadata', onLoadedMeta);
        videoEl.removeEventListener('loadeddata', onLoadedData);
        videoEl.removeEventListener('playing', onPlaying);
        videoEl.removeEventListener('resize', onResize as any);
        videoEl.removeEventListener('error', onError);
      };
      videoEl.addEventListener('loadedmetadata', onLoadedMeta);
      videoEl.addEventListener('loadeddata', onLoadedData);
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('resize', onResize as any);
      videoEl.addEventListener('error', onError);
      // Also try an immediate resolve in case we're already ready
      tryResolve();
      // And a short timeout fallback to avoid hanging forever
      setTimeout(() => { cleanup(); resolve(); }, 1500);
    });
    try { await videoEl.play(); } catch {}

    // Canvas dimensions based on source video
    const targetWidth = 640; // lower resolution for faster processing and quicker startup
    const ratio = videoEl.videoHeight ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9;
    const width = Math.min(targetWidth, videoEl.videoWidth || targetWidth);
    const height = Math.round(width / ratio);
    processorCanvas.width = width;
    processorCanvas.height = height;

    // Load background image if needed
    if (settings.mode === 'image' && settings.imageDataUrl) {
      this.backgroundImageElement = new Image();
      this.backgroundImageElement.src = settings.imageDataUrl;
      try {
        await this.waitImage(this.backgroundImageElement);
      } catch {}
    } else {
      this.backgroundImageElement = null;
    }

    // Kick MediaPipe load in the background; don't block initial rendering
    // so we can start with non-segmented frames immediately.
    try { this.ensureSelfieSegmentation(); } catch {}

    // Configure blur amount
    const blurPx = this.mapBlur(settings.blurLevel);

    // Prepare a temporary canvas for blurred frames
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    // Hook results callback once
    if (this.selfieSegmentation && !this.resultsHandlerRegistered) {
      this.selfieSegmentation.onResults((results: any) => {
        this.lastSegmentationMask = results.segmentationMask || null;
      });
      this.resultsHandlerRegistered = true;
    }

    const render = () => {
      if (!this.processingCtx) return;
      const drawCtx = this.processingCtx;

      // Schedule next segmentation run (throttled)
      if (this.selfieSegmentation && !this.segmentationBusy) {
        const now = performance.now();
        if (now - this.lastSegmentationAt >= this.segmentationIntervalMs) {
          this.segmentationBusy = true;
          this.lastSegmentationAt = now;
          try {
            // Only send to MediaPipe when video has real frames and dimensions
            if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0 && !videoEl.paused && !videoEl.ended) {
              this.selfieSegmentation.send({ image: videoEl }).finally(() => {
                this.segmentationBusy = false;
              });
            } else {
              this.segmentationBusy = false;
            }
          } catch {
            this.segmentationBusy = false;
          }
        }
      }

      // Clear frame
      drawCtx.clearRect(0, 0, width, height);

      if (settings.mode === 'blur') {
        // Prepare blurred background in temp canvas
        if (tempCtx) {
          tempCtx.clearRect(0, 0, width, height);
          tempCtx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
          tempCtx.drawImage(videoEl, 0, 0, width, height);
          tempCtx.filter = 'none';
        }

        if (this.lastSegmentationMask) {
          const mask: any = this.lastSegmentationMask as any;
          const maskW = (mask && (mask.width || mask.videoWidth)) || 0;
          const maskH = (mask && (mask.height || mask.videoHeight)) || 0;
          if (maskW > 0 && maskH > 0) {
          // MediaPipe recommended order: mask -> source-in (person) -> destination-over (background)
          drawCtx.save();
          drawCtx.drawImage(mask, 0, 0, width, height);
          drawCtx.globalCompositeOperation = 'source-in';
          drawCtx.drawImage(videoEl, 0, 0, width, height);
          drawCtx.globalCompositeOperation = 'destination-over';
          if (tempCtx) {
            drawCtx.drawImage(tempCanvas, 0, 0, width, height);
          } else {
            drawCtx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
            drawCtx.drawImage(videoEl, 0, 0, width, height);
            drawCtx.filter = 'none';
          }
          drawCtx.restore();
          } else {
          // No mask yet: show full-frame blur immediately
          drawCtx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
          drawCtx.drawImage(videoEl, 0, 0, width, height);
          drawCtx.filter = 'none';
          }
        }
      } else if (settings.mode === 'image') {
        if (this.lastSegmentationMask) {
          const mask: any = this.lastSegmentationMask as any;
          const maskW = (mask && (mask.width || mask.videoWidth)) || 0;
          const maskH = (mask && (mask.height || mask.videoHeight)) || 0;
          if (maskW > 0 && maskH > 0) {
          drawCtx.save();
          // Mask then draw person
          drawCtx.drawImage(mask, 0, 0, width, height);
          drawCtx.globalCompositeOperation = 'source-in';
          drawCtx.drawImage(videoEl, 0, 0, width, height);
          // Draw background behind
          drawCtx.globalCompositeOperation = 'destination-over';
          if (this.backgroundImageElement) {
            this.drawContainNoUpscale(drawCtx, this.backgroundImageElement, width, height);
          } else {
            drawCtx.fillStyle = '#000';
            drawCtx.fillRect(0, 0, width, height);
          }
          drawCtx.restore();
          } else {
          // No mask yet: keep original video to avoid empty preview
          drawCtx.drawImage(videoEl, 0, 0, width, height);
          }
        }
      }

      this.animationHandle = requestAnimationFrame(render);
    };

    // Kick the first frame to ensure captureStream has content
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(videoEl, 0, 0, width, height);
    }
    this.animationHandle = requestAnimationFrame(render);

    // Compose output stream: replace video track but preserve audio from input
    const outputVideoTrack = processorStream.getVideoTracks()[0];
    if (!outputVideoTrack) {
      // Fallback if canvas capture failed
      return input;
    }
    // Ensure the captured track is actually producing before returning
    // Some browsers start canvas capture tracks muted until at least one frame is rendered
    // and the track has a chance to unmute. We already drew once; wait briefly for unmute/live.
    try {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const tryResolve = () => {
          if (!resolved && !outputVideoTrack.muted && outputVideoTrack.readyState === 'live') {
            resolved = true;
            cleanup();
            resolve();
          }
        };
        const onUnmute = () => tryResolve();
        const onEnded = () => { cleanup(); resolve(); };
        const cleanup = () => {
          outputVideoTrack.removeEventListener('unmute', onUnmute as any);
          outputVideoTrack.removeEventListener('ended', onEnded as any);
        };
        outputVideoTrack.addEventListener('unmute', onUnmute as any);
        outputVideoTrack.addEventListener('ended', onEnded as any);
        // Also tick a couple frames to give the pipeline time to start
        requestAnimationFrame(() => requestAnimationFrame(() => tryResolve()));
        // Fallback timeout so we don't hang if browser never fires unmute
        setTimeout(() => { cleanup(); resolve(); }, 800);
      });
    } catch {}
    const composed = new MediaStream();
    composed.addTrack(outputVideoTrack);
    input.getAudioTracks().forEach(t => composed.addTrack(t));

    // Warmup sink video to kick the processed stream immediately
    try {
      if (!this.warmupVideo) {
        this.warmupVideo = document.createElement('video');
        this.warmupVideo.muted = true;
        (this.warmupVideo as any).playsInline = true;
        this.warmupVideo.autoplay = true;
        this.warmupVideo.style.position = 'fixed';
        this.warmupVideo.style.left = '-99999px';
        this.warmupVideo.style.bottom = '0';
        document.body.appendChild(this.warmupVideo);
      }
      this.warmupVideo.srcObject = composed;
      try { await this.warmupVideo.play(); } catch {}
    } catch {}
    return composed;
  }

  stop() {
    if (this.animationHandle) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
    if (this.outputStream) {
      this.outputStream.getTracks().forEach(t => t.stop());
      this.outputStream = undefined;
    }
    // Do not destroy selfieSegmentation to allow reuse; just clear mask
    this.lastSegmentationMask = null;
    // Cleanup processing elements
    try {
      if (this.processingCanvas && this.processingCanvas.isConnected) {
        this.processingCanvas.remove();
      }
    } catch {}
    this.processingCanvas = undefined;
    this.processingCtx = null;
    try {
      if (this.videoElement) {
        this.videoElement.srcObject = null as any;
      }
    } catch {}
    this.videoElement = undefined;
    try {
      if (this.warmupVideo) {
        this.warmupVideo.pause();
        this.warmupVideo.srcObject = null as any;
        if (this.warmupVideo.isConnected) {
          this.warmupVideo.remove();
        }
      }
    } catch {}
    this.warmupVideo = undefined;
  }

  private mapBlur(level: VideoBackgroundSettings['blurLevel']): number {
    switch (level) {
      case 'low':
        return 6;
      case 'high':
        return 14;
      case 'none':
      default:
        return 0;
    }
  }

  private waitImage(img: HTMLImageElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (img.complete) return resolve();
      img.onload = () => resolve();
      img.onerror = reject;
    });
  }

  private drawContainNoUpscale(ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    // Scale to fit inside target while preserving aspect ratio; never upscale
    const scale = Math.min(width / iw, height / ih, 1);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.round((width - dw) / 2);
    const dy = Math.round((height - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  private async ensureSelfieSegmentation(): Promise<void> {
    if (this.mpLoaded) return;
    if (this.mpLoadingPromise) {
      await this.mpLoadingPromise;
      return;
    }

    this.mpLoadingPromise = new Promise<void>((resolve) => {
      const existing = document.querySelector('script[data-mp-selfie]') as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => resolve());
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-mp-selfie', '');
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
      }
    });

    await this.mpLoadingPromise;

    try {
      const SelfieSegmentationNS = (window as any).SelfieSegmentation;
      const Ctor = SelfieSegmentationNS?.SelfieSegmentation || SelfieSegmentationNS;
      if (Ctor) {
        this.selfieSegmentation = new Ctor({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
        });
        if (this.selfieSegmentation.setOptions) {
          // Disable selfieMode to avoid horizontally flipped masks
          this.selfieSegmentation.setOptions({ modelSelection: 1, selfieMode: false });
        }
        this.mpLoaded = true;
      }
    } catch {
      // If loading fails, we will fallback to simple blur/image without segmentation
      this.selfieSegmentation = null;
      this.mpLoaded = false;
    }
  }
}



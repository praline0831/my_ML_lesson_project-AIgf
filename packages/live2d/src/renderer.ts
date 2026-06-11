// Live2D rendering engine

import { Live2DModel } from 'pixi-live2d-display-advanced/cubism4';
import * as PIXI from 'pixi.js';

(window as any).PIXI = PIXI;

PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL_LEGACY;

export interface Live2DOptions {
  modelPath: string;
  width: number;
  height: number;
}

export class Live2DRenderer {
  private app: PIXI.Application | null = null;
  private isDestroyed = false;
  private isLoading = false;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL_LEGACY;
    console.log('[Live2D] Creating PIXI Application...');
    try {
      this.app = new PIXI.Application({
        view: canvas,
        width,
        height,
        backgroundAlpha: 1,
        backgroundColor: 0xffffff,
        autoStart: true,
        antialias: false,
      });

      const testRect = new PIXI.Graphics();
      testRect.beginFill(0xff0000);
      testRect.drawRect(50, 50, 100, 100);
      testRect.endFill();
      this.app.stage.addChild(testRect);

      console.log('[Live2D] PIXI Application created, renderer type:', this.app.renderer.type);
      console.log('[Live2D] Added red test rectangle');
    } catch (e) {
      console.error('[Live2D] Failed to create PIXI Application:', e);
    }
  }

  async loadModel(path: string): Promise<void> {
    if (this.isDestroyed) {
      console.log('[Live2D] Renderer already destroyed, skip loading');
      return;
    }

    this.isLoading = true;
    console.log('[Live2D] Loading model from:', path);
    try {
      const model = await Live2DModel.from(path);
      console.log('[Live2D] Model loaded:', model);

      if (this.isDestroyed || !this.app) {
        console.log('[Live2D] Renderer was destroyed, cleaning up model');
        model.destroy();
        this.isLoading = false;
        return;
      }

      this.app.stage.addChild(model as any);
      console.log('[Live2D] Model added to stage');
      this.isLoading = false;

      const scaleX = this.app.screen.width / model.width;
      const scaleY = this.app.screen.height / model.height;
      const scale = Math.min(scaleX, scaleY) * 0.9;
      model.scale.set(scale);

      model.x = (this.app.screen.width - model.width * scale) / 2;
      model.y = (this.app.screen.height - model.height * scale) / 2;

      console.log('[Live2D] Model positioned:', { x: model.x, y: model.y, scale });

      model.on('hit', (hitAreas: string[]) => {
        console.log('[Live2D] Hit:', hitAreas);
        if (hitAreas.includes('body')) {
          model.motion('TapBody');
        }
      });
    } catch (e) {
      this.isLoading = false;
      console.error('[Live2D] Failed to load model:', e);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }
}
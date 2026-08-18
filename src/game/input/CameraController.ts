import Phaser from 'phaser';

export interface CameraControllerOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;         // 每次滚轮缩放的倍率
  edgeScrollMargin?: number; // 距视口边缘多少像素触发边缘滚屏
  edgeScrollSpeed?: number;  // 边缘滚屏速度（世界像素/秒）
  leftButtonPan?: boolean;   // 阶段三框选接入后改为 false，左键拖拽让给框选
}

/**
 * 摄像机控制：拖拽平移、滚轮锚点缩放、边缘滚屏。
 * 全部是渲染层的纯视觉操作，不产生游戏命令、不写 GameState（docs/01-architecture.md）。
 * 缩放时以鼠标为锚点，保证鼠标下的世界点不漂移。
 */
export class CameraController {
  private cam: Phaser.Cameras.Scene2D.Camera;
  private input: Phaser.Input.InputPlugin;
  private opts: Required<CameraControllerOptions>;
  private dragging = false;
  private pointerActive = false; // 鼠标是否真的在画布上（防止启动时幽灵指针触发边缘滚屏）
  private lastX = 0;
  private lastY = 0;

  constructor(scene: Phaser.Scene, cam: Phaser.Cameras.Scene2D.Camera, opts?: CameraControllerOptions) {
    this.cam = cam;
    this.input = scene.input;
    this.opts = {
      minZoom: 0.5,
      maxZoom: 3,
      zoomStep: 1.1,
      edgeScrollMargin: 24,
      edgeScrollSpeed: 600,
      leftButtonPan: true,
      ...opts,
    };

    // 边缘滚屏依赖鼠标位置；鼠标未进入画布时 Phaser 的指针坐标可能是 (0,0) 残值，
    // 若不拦截会在启动瞬间把相机顶到地图角落。用 DOM 事件跟踪真实的进出。
    const canvas = scene.game.canvas as HTMLCanvasElement;
    canvas.addEventListener('pointerenter', () => { this.pointerActive = true; });
    canvas.addEventListener('pointerleave', () => { this.pointerActive = false; });
    scene.input.on('pointerdown', () => { this.pointerActive = true; });
    scene.input.on('pointermove', () => { this.pointerActive = true; });

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown() || (this.opts.leftButtonPan && p.leftButtonDown())) {
        this.dragging = true;
        this.lastX = p.x;
        this.lastY = p.y;
      }
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.middleButtonDown() && !(this.opts.leftButtonPan && p.leftButtonDown())) {
        this.dragging = false;
      }
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.cam.scrollX -= p.x - this.lastX;
      this.cam.scrollY -= p.y - this.lastY;
      this.lastX = p.x;
      this.lastY = p.y;
    });

    // 滚轮以鼠标位置为锚缩放：先取锚点的世界坐标，缩放后反算 scroll 使锚点不动。
    // Phaser 的 getWorldPoint 约定是 worldX = screenX / zoom + scrollX，
    // 由 anchor = p / zoom_old + scroll_old = p / next + scroll_new 反解出：
    //   scroll_new = anchor - p / next
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const factor = dy > 0 ? 1 / this.opts.zoomStep : this.opts.zoomStep;
      const anchor = this.cam.getWorldPoint(p.x, p.y);
      const next = Phaser.Math.Clamp(this.cam.zoom * factor, this.opts.minZoom, this.opts.maxZoom);
      this.cam.zoom = next;
      this.cam.scrollX = anchor.x - p.x / next;
      this.cam.scrollY = anchor.y - p.y / next;
    });
  }

  /** 每帧调用，dt 单位是秒。负责边缘滚屏。 */
  update(dt: number, viewportWidth: number, viewportHeight: number): void {
    if (this.dragging || !this.pointerActive) return;
    const p = this.input.activePointer;
    const m = this.opts.edgeScrollMargin;
    let dx = 0;
    let dy = 0;
    if (p.x <= m) dx -= 1;
    else if (p.x >= viewportWidth - m) dx += 1;
    if (p.y <= m) dy -= 1;
    else if (p.y >= viewportHeight - m) dy += 1;
    if (dx !== 0 || dy !== 0) {
      // 世界距离 = 屏幕距离 / zoom，缩放后滚屏速度保持一致
      const speed = (this.opts.edgeScrollSpeed * dt) / this.cam.zoom;
      this.cam.scrollX += dx * speed;
      this.cam.scrollY += dy * speed;
    }
  }
}
